//! Accounts, and who's asking.
//!
//! Every hunt has accounts: one person's has its owner alone (account 1, an
//! admin, made in the launcher), and more join only as its admins say
//! (sign-ups, closed on a new hunt, or an invite). Everyone shares one
//! database; every row someone keeps carries its owner (see
//! [`crate::scope`]), and each request runs as the account it comes from.
//! What a hunt held before it had accounts is account 1's.
//!
//! Who's asking: hunt's own sign-in, always (an email address and a
//! password, at /login: a session cookie, or the CLI's `Authorization:
//! Basic`); and, where it's set up, Cloudflare Access in front of hunt (its
//! signed token, checked against the team's keys, so a request that didn't
//! come through Access can't pass for anyone) or a sign-in proxy's header.
//! Someone new signs up (or asks, through Access); an admin approves (or
//! rejects) them. Admins can also be named when hunt starts
//! (`HUNT_ADMINS`); the first of them is account 1.
//!
//! Accounts are kept in the `account` table: who, their status (pending,
//! active, rejected, disabled), their role (user, admin), and the Access
//! service token their CLI uses, if any.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{Map, Value, json};

use crate::args;
use crate::auth::Password;
use crate::db::{Db, Sql};
use crate::error::{Error, Result, invalid};

/// Where who's asking comes from, beside hunt's own sign-in.
pub enum IdentitySource {
    /// Nowhere else: hunt's own sign-in alone.
    BuiltIn,
    /// Cloudflare Access: its signed token, checked against the team's keys
    /// for this application (its audience tag).
    Access {
        team: String,
        aud: String,
        keys: Mutex<Option<(Instant, jsonwebtoken::jwk::JwkSet)>>,
    },
    /// A header naming the person (`X-Hunt-User: me@example.com`), trusted
    /// as it is: for trying hunt out and for tests, never behind a network.
    Header(String),
    /// A sign-in proxy's header naming the person (`Remote-Email`), taken
    /// only from the proxy's addresses: Authelia, Authentik, oauth2-proxy,
    /// Tailscale (see [`crate::auth`]).
    Proxy {
        header: String,
        trusted: Vec<crate::auth::Cidr>,
    },
}

impl IdentitySource {
    pub fn access(team: &str, aud: &str) -> IdentitySource {
        IdentitySource::Access {
            team: team.to_string(),
            aud: aud.to_string(),
            keys: Mutex::new(None),
        }
    }
}

/// The cookie naming who's asking, when trying hunt out with a trusted
/// header (set by /dev/as): for a browser, which can't send the header.
pub const DEV_COOKIE: &str = "hunt_dev_user";

impl Tenants {
    /// Whether who's asking is taken on trust (trying hunt out), not from
    /// Cloudflare Access.
    pub fn trusts_header(&self) -> bool {
        matches!(self.identity, IdentitySource::Header(_))
    }
}

/// Who's asking: a person (their email), or a service token (its client
/// id, as the CLI sends it).
#[derive(Debug, Clone, Default, Serialize)]
pub struct Identity {
    pub email: Option<String>,
    pub token: Option<String>,
}

/// An account, as kept.
#[derive(Debug, Clone, Serialize)]
pub struct Account {
    pub id: i64,
    pub email: String,
    pub name: Option<String>,
    pub provider: Option<String>,
    pub reason: Option<String>,
    /// pending, active, rejected or disabled.
    pub status: String,
    /// user or admin.
    pub role: String,
    pub service_token: Option<String>,
    /// Their password's hash, to sign in with: never sent anywhere.
    #[serde(skip)]
    pub password_hash: Option<String>,
    /// Whether they sign in with a password of their own (or elsewhere, or
    /// not yet: invited).
    pub has_password: bool,
    pub requested_at: String,
    pub decided_at: Option<String>,
    pub decided_by: Option<String>,
    pub note: Option<String>,
    pub last_seen: Option<String>,
}

impl Account {
    pub fn is_admin(&self) -> bool {
        self.role == "admin" && self.status == "active"
    }
}

/// Why a request is turned away: not signed in (401), or signed in without
/// an account that may use hunt (403, with the account's status).
#[derive(Debug)]
pub enum Denied {
    NotSignedIn(String),
    NoAccess { status: String, identity: Identity },
}

pub struct Tenants {
    db: Arc<Mutex<Db>>,
    identity: IdentitySource,
    /// When each account was last noted as seen, to note it now and then.
    seen: Mutex<HashMap<i64, Instant>>,
    /// Each account's password, ready to check (by its hash, so a new one's
    /// read afresh).
    passwords: Mutex<HashMap<i64, (String, Arc<Password>)>>,
}

/// An account's rows, children first: what goes when it's removed with its data.
const REMOVE_ORDER: &[&str] = &[
    "activity",
    "tagging",
    "tag",
    "email",
    "mail_ignore",
    "setting",
    "memo",
    "story",
    "prep_item",
    "reminder",
    "link",
    "process_file",
    "step_person",
    "step",
    "note",
    "process_person",
    "process",
    "cycle",
    "posting",
    "version",
    "document",
    "application",
    "person",
    "company",
    "lane",
    "stage",
    "swimlane",
];

/// Settings new accounts start with, when an admin has set them.
const DEFAULTS: &[&str] = &[
    "locale.language",
    "locale.region",
    "locale.timezone",
    "locale.currency",
];

/// How long a toast with Undo stays, in seconds, unless admins change it.
pub const UNDO_SECONDS: u32 = 5;

/// What admins say of this hunt (General, in the admin centre), each with
/// the most characters it may have.
const SITE: &[(&str, usize)] = &[("name", 40), ("announcement", 280), ("contact", 254)];

/// What's asked of `v`'s fields among `keys` (those it has): each one's
/// value, checked, or none (empty) to go back to none.
fn site_changes(v: &Value, keys: &[&str]) -> Result<Vec<(String, Option<String>)>> {
    let mut out = Vec::new();
    for (k, most) in SITE.iter().filter(|(k, _)| keys.contains(k)) {
        let Some(x) = v.get(k) else {
            continue;
        };
        let value = x.as_str().map(str::trim).unwrap_or("");
        if value.chars().count() > *most {
            return Err(invalid(format!("{k}: at most {most} characters")));
        }
        if *k == "contact" && !value.is_empty() && !looks_like_email(value) {
            return Err(invalid(format!(
                "contact: an email address, like help@example.com, not {value:?}"
            )));
        }
        out.push((
            format!("site.{k}"),
            Some(value.to_string()).filter(|v| !v.is_empty()),
        ));
    }
    Ok(out)
}

pub(crate) fn looks_like_email(s: &str) -> bool {
    s.split_once('@').is_some_and(|(who, at)| {
        !who.is_empty() && at.contains('.') && !s.contains(char::is_whitespace)
    })
}

fn clean(s: Option<&str>) -> Option<String> {
    s.map(str::trim).filter(|s| !s.is_empty()).map(String::from)
}

fn text(v: &Value) -> Option<String> {
    v.as_str().map(String::from)
}

fn account(r: &Map<String, Value>) -> Account {
    Account {
        id: r["id"].as_i64().unwrap_or(0),
        email: text(&r["email"]).unwrap_or_default(),
        name: text(&r["name"]),
        provider: text(&r["provider"]),
        reason: text(&r["reason"]),
        status: text(&r["status"]).unwrap_or_default(),
        role: text(&r["role"]).unwrap_or_default(),
        service_token: text(&r["service_token"]),
        password_hash: text(&r["password_hash"]),
        has_password: r.get("password_hash").is_some_and(|v| !v.is_null()),
        requested_at: text(&r["requested_at"]).unwrap_or_default(),
        decided_at: text(&r["decided_at"]),
        decided_by: text(&r["decided_by"]),
        note: text(&r["note"]),
        last_seen: text(&r["last_seen"]),
    }
}

impl Tenants {
    /// Accounts in the shared database `db`. `admins` are made active
    /// admins; the first is account 1, the owner of what was there.
    pub fn open(
        db: Arc<Mutex<Db>>,
        admins: &[String],
        identity: IdentitySource,
    ) -> Result<Tenants> {
        let t = Tenants {
            db,
            identity,
            seen: Mutex::new(HashMap::new()),
            passwords: Mutex::new(HashMap::new()),
        };
        t.adopt_kept_owner()?;
        for (i, email) in admins.iter().filter_map(|e| clean(Some(e))).enumerate() {
            t.bootstrap_admin(&email.to_lowercase(), i == 0)?;
        }
        Ok(t)
    }

    /// Run `f` on the database, for nobody in particular (the accounts
    /// aren't anyone's rows).
    fn with<T>(&self, f: impl FnOnce(&Db) -> Result<T>) -> Result<T> {
        let db = self.db.lock().unwrap_or_else(|e| e.into_inner());
        let before = db.owner();
        db.set_owner(None);
        let out = f(&db);
        db.set_owner(before);
        out
    }

    /// An admin from the start: made (the first as account 1), or made
    /// active and an admin.
    fn bootstrap_admin(&self, email: &str, first: bool) -> Result<()> {
        self.with(|db| {
            let at = db.stamp();
            if db.int("SELECT count(*) FROM account WHERE lower(email) = lower(?1)", args![email])? > 0 {
                db.exec(
                    "UPDATE account SET role = 'admin', status = 'active' WHERE lower(email) = lower(?1)",
                    args![email],
                )?;
                return Ok(());
            }
            let one_free = db.int("SELECT count(*) FROM account WHERE id = 1", &[])? == 0;
            if first && one_free {
                db.exec(
                    "INSERT INTO account (id, email, status, role, requested_at, decided_at, decided_by) \
                     VALUES (1, ?1, 'active', 'admin', ?2, ?2, 'HUNT_ADMINS')",
                    args![email, at],
                )?;
                // PostgreSQL's ids come from a sequence, which an id given doesn't move.
                if db.dialect() == crate::store::Dialect::Postgres {
                    db.rows(
                        "SELECT setval(pg_get_serial_sequence('account', 'id'), (SELECT max(id) FROM account))",
                        &[],
                    )?;
                }
            } else {
                db.exec(
                    "INSERT INTO account (email, status, role, requested_at, decided_at, decided_by) \
                     VALUES (?1, 'active', 'admin', ?2, ?2, 'HUNT_ADMINS')",
                    args![email, at],
                )?;
            }
            Ok(())
        })?;
        // The others' hunts start with the usual stages.
        let a = self
            .find_email(email)?
            .ok_or_else(|| Error::NotFound(email.into()))?;
        self.seed_if_new(a.id)
    }

    /// Give a new account the usual stages and archive reasons, and the
    /// language, region, time zone and currency new accounts start with
    /// (General, in the admin centre).
    fn seed_if_new(&self, id: i64) -> Result<()> {
        let defaults: Vec<(String, String)> = DEFAULTS
            .iter()
            .filter_map(|k| {
                Some((
                    k.to_string(),
                    self.shared_setting(&format!("default.{k}")).ok()??,
                ))
            })
            .collect();
        let db = self.db.lock().unwrap_or_else(|e| e.into_inner());
        let before = db.owner();
        db.set_owner(Some(id));
        let out = (|| {
            if db.int("SELECT count(*) FROM stage", &[])? == 0 {
                db.atomic(|db| {
                    db.seed()?;
                    for (k, v) in &defaults {
                        db.set_setting(k, Some(v))?;
                    }
                    Ok(())
                })?;
            }
            Ok(())
        })();
        db.set_owner(before);
        out
    }

    // ---- who's asking ----------------------------------------------------------------

    /// Who a request is from, from its headers (or Access's cookie), and,
    /// behind a sign-in proxy, the address it came from (`peer`).
    /// Blocking: Access's keys may need fetching.
    pub fn identify(
        &self,
        headers: &axum::http::HeaderMap,
        peer: Option<std::net::IpAddr>,
    ) -> std::result::Result<Identity, Denied> {
        // hunt's own sign-in first: its cookie, or the CLI's address and password.
        if let Some(a) = self.signed_in(headers) {
            return Ok(Identity {
                email: Some(a.email.to_lowercase()),
                token: None,
            });
        }
        match &self.identity {
            IdentitySource::BuiltIn => Err(Denied::NotSignedIn(
                "sign in first, at /login (the CLI sends HUNT_EMAIL and HUNT_PASSWORD)".into(),
            )),
            IdentitySource::Proxy { header, trusted } => {
                // From anywhere else, the header could say anyone.
                if !peer.is_some_and(|ip| trusted.iter().any(|c| c.contains(ip))) {
                    return Err(Denied::NotSignedIn(
                        "not through the sign-in proxy: this address isn't one of HUNT_TRUSTED_PROXIES"
                            .into(),
                    ));
                }
                headers
                    .get(header.as_str())
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| clean(Some(v)))
                    .map(|email| Identity {
                        email: Some(email.to_lowercase()),
                        token: None,
                    })
                    .ok_or_else(|| {
                        Denied::NotSignedIn(format!(
                            "the sign-in proxy didn't say who's asking (no {header} header)"
                        ))
                    })
            }
            // The header, or (in a browser, which can't send one) the
            // cookie /dev/as sets.
            IdentitySource::Header(name) => headers
                .get(name.as_str())
                .and_then(|v| v.to_str().ok())
                .map(String::from)
                .or_else(|| cookie(headers, DEV_COOKIE))
                .and_then(|v| clean(Some(&v)))
                .map(|email| Identity {
                    email: Some(email.to_lowercase()),
                    token: None,
                })
                .ok_or_else(|| {
                    Denied::NotSignedIn(format!(
                        "no {name} header: open /dev/as?email=you@example.com to say who you are"
                    ))
                }),
            IdentitySource::Access { team, aud, keys } => {
                let token = headers
                    .get("cf-access-jwt-assertion")
                    .and_then(|v| v.to_str().ok())
                    .map(String::from)
                    .or_else(|| cookie(headers, "CF_Authorization"))
                    .ok_or_else(|| {
                        Denied::NotSignedIn("not signed in through Cloudflare Access".into())
                    })?;
                let claims = verify_access(&token, team, aud, keys).map_err(|e| {
                    Denied::NotSignedIn(format!("Access's token didn't check out: {e}"))
                })?;
                let email = claims["email"]
                    .as_str()
                    .filter(|e| !e.is_empty())
                    .map(str::to_lowercase);
                // A service token carries its client id, not an email.
                let token = claims["common_name"]
                    .as_str()
                    .filter(|_| email.is_none())
                    .map(String::from);
                if email.is_none() && token.is_none() {
                    return Err(Denied::NotSignedIn("Access's token names nobody".into()));
                }
                Ok(Identity { email, token })
            }
        }
    }

    /// The account of who's asking, if they have one.
    pub fn account_of(&self, who: &Identity) -> Result<Option<Account>> {
        if let Some(email) = &who.email {
            return self.find_email(email);
        }
        if let Some(token) = &who.token {
            return self.find("service_token = ?1", Sql::Text(token.clone()));
        }
        Ok(None)
    }

    /// Who's asking, and their account, if it may use hunt; else why not.
    pub fn active(
        &self,
        headers: &axum::http::HeaderMap,
        peer: Option<std::net::IpAddr>,
    ) -> std::result::Result<(Identity, Account), Denied> {
        let who = self.identify(headers, peer)?;
        match self.account_of(&who) {
            Ok(Some(a)) if a.status == "active" => {
                self.note_seen(&a);
                Ok((who, a))
            }
            Ok(Some(a)) => Err(Denied::NoAccess {
                status: a.status,
                identity: who,
            }),
            _ => Err(Denied::NoAccess {
                status: "none".into(),
                identity: who,
            }),
        }
    }

    fn note_seen(&self, a: &Account) {
        let due = {
            let mut seen = self.seen.lock().unwrap_or_else(|e| e.into_inner());
            let due = seen
                .get(&a.id)
                .is_none_or(|t| t.elapsed() > Duration::from_secs(300));
            if due {
                seen.insert(a.id, Instant::now());
            }
            due
        };
        if due {
            let _ = self.with(|db| {
                let at = db.stamp();
                db.exec(
                    "UPDATE account SET last_seen = ?1 WHERE id = ?2",
                    args![at, a.id],
                )
            });
        }
    }

    // ---- hunt's own sign-in ----------------------------------------------------------------

    /// Whether there's nobody yet: a new hunt, before its launcher's made
    /// its owner. Until then, nothing needs signing in.
    pub fn no_accounts(&self) -> Result<bool> {
        self.with(|db| Ok(db.int("SELECT count(*) FROM account", &[])? == 0))
    }

    /// Whether who's asking is told by hunt's own sign-in alone (not
    /// Cloudflare Access, a sign-in proxy, or a trusted header).
    pub fn built_in(&self) -> bool {
        matches!(self.identity, IdentitySource::BuiltIn)
    }

    /// An account's password, ready to check, if it has one.
    fn password_of(&self, a: &Account) -> Option<Arc<Password>> {
        let hash = a.password_hash.as_ref()?;
        let mut kept = self.passwords.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((h, p)) = kept.get(&a.id)
            && h == hash
        {
            return Some(p.clone());
        }
        let p = Arc::new(Password::stored(hash).ok()?);
        kept.insert(a.id, (hash.clone(), p.clone()));
        Some(p)
    }

    /// The account an email address and password are, if they are one
    /// (whatever its status: a pending one learns where it stands).
    pub fn sign_in(&self, email: &str, password: &str) -> Option<Account> {
        let a = self.find_email(email.trim()).ok()??;
        self.password_of(&a)?.matches(password).then_some(a)
    }

    /// A session for an account, for the cookie: good until `until`. Signed
    /// with a key from its password, so a new password ends it.
    pub fn session(&self, a: &Account, until: i64) -> Option<String> {
        Some(format!("{}.{}", a.id, self.password_of(a)?.session(until)))
    }

    /// Who's signed in with hunt's own sign-in: a session cookie still good,
    /// or (the CLI) an email address and password.
    fn signed_in(&self, headers: &axum::http::HeaderMap) -> Option<Account> {
        if let Some((email, password)) = headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(crate::auth::basic)
        {
            return self.sign_in(&email, &password);
        }
        let session = cookie(headers, crate::auth::COOKIE)?;
        let (id, rest) = session.split_once('.')?;
        let a = self.get(id.parse().ok()?).ok()?;
        self.password_of(&a)?
            .valid(rest, jiff::Timestamp::now().as_second())
            .then_some(a)
    }

    /// Change an account's email address or password (each kept when not
    /// given). Its sessions end with a new password.
    pub fn set_credentials(
        &self,
        id: i64,
        email: Option<&str>,
        password: Option<&str>,
    ) -> Result<Account> {
        if let Some(email) = email {
            let email = email.trim().to_lowercase();
            if !looks_like_email(&email) || email.chars().count() > 254 {
                return Err(invalid(format!(
                    "an email address, like you@example.com, not {email:?}"
                )));
            }
            if self.find_email(&email)?.is_some_and(|a| a.id != id) {
                return Err(Error::Conflict(format!("{email} is another account's")));
            }
            self.with(|db| {
                db.exec(
                    "UPDATE account SET email = ?1 WHERE id = ?2",
                    args![email, id],
                )
                .map(drop)
            })?;
        }
        if let Some(password) = password {
            let hash = Password::hash(password)?;
            self.with(|db| {
                db.exec(
                    "UPDATE account SET password_hash = ?1 WHERE id = ?2",
                    args![hash, id],
                )
                .map(drop)
            })?;
        }
        self.get(id)
    }

    /// The owner: a new hunt's first account (account 1, an admin), made by
    /// its launcher or from HUNT_ADMIN_EMAIL and HUNT_ADMIN_PASSWORD; or,
    /// when they're there, an admin with that address, given that password
    /// (the way back in when it's forgotten).
    pub fn make_owner(&self, email: &str, password: &str) -> Result<Account> {
        let email = email.trim().to_lowercase();
        if !looks_like_email(&email) || email.chars().count() > 254 {
            return Err(invalid(format!(
                "an email address, like you@example.com, not {email:?}"
            )));
        }
        let hash = Password::hash(password)?;
        let first = self.no_accounts()?;
        self.bootstrap_admin(&email, first)?;
        let a = self
            .find_email(&email)?
            .ok_or_else(|| Error::NotFound(email.clone()))?;
        self.with(|db| {
            db.exec(
                "UPDATE account SET password_hash = ?1, decided_by = coalesce(decided_by, 'setup') WHERE id = ?2",
                args![hash, a.id],
            )
            .map(drop)
        })?;
        self.get(a.id)
    }

    /// The owner, as hunts kept them before they had accounts (an address
    /// and a password's hash, with the settings): account 1 now.
    fn adopt_kept_owner(&self) -> Result<()> {
        let kept = |name: &str| -> Result<Option<String>> {
            self.with(|db| {
                db.text(
                    "SELECT value /* all owners */ FROM setting WHERE owner_id = 1 AND name = ?1",
                    args![name],
                )
            })
        };
        let (Some(email), Some(hash)) = (kept(crate::setup::EMAIL)?, kept(crate::setup::PASSWORD)?)
        else {
            return Ok(());
        };
        if self.no_accounts()? {
            self.bootstrap_admin(&email.to_lowercase(), true)?;
            self.with(|db| {
                db.exec(
                    "UPDATE account SET password_hash = ?1 WHERE id = 1",
                    args![hash],
                )
                .map(drop)
            })?;
        }
        self.with(|db| {
            db.exec(
                "DELETE FROM setting /* all owners */ WHERE owner_id = 1 AND name IN (?1, ?2)",
                args![crate::setup::EMAIL, crate::setup::PASSWORD],
            )
            .map(drop)
        })
    }

    /// Someone signing up with hunt's own sign-in: their account, pending
    /// an admin's say (or active, invited); an address with an account
    /// already, but no password (invited, or an admin named at the start),
    /// takes this one. Closed to anyone new while sign-ups are.
    pub fn sign_up(
        &self,
        email: &str,
        password: &str,
        name: Option<&str>,
        reason: Option<&str>,
        terms: Option<&str>,
    ) -> Result<Account> {
        let email = email.trim().to_lowercase();
        if !looks_like_email(&email) {
            return Err(invalid(format!(
                "an email address, like you@example.com, not {email:?}"
            )));
        }
        let hash = Password::hash(password)?;
        if let Some(a) = self.find_email(&email)? {
            if a.has_password {
                return Err(Error::Conflict(format!(
                    "{email} has an account already: sign in"
                )));
            }
            if a.status != "rejected" {
                self.with(|db| {
                    db.exec(
                        "UPDATE account SET password_hash = ?1, name = coalesce(name, ?2) WHERE id = ?3",
                        &[Sql::Text(hash.clone()), clean(name).into(), Sql::Integer(a.id)],
                    )
                    .map(drop)
                })?;
                return self.get(a.id);
            }
        }
        let who = Identity {
            email: Some(email.clone()),
            token: None,
        };
        let a = self.request(&who, name, reason, Some("password"), terms)?;
        self.with(|db| {
            db.exec(
                "UPDATE account SET password_hash = ?1 WHERE id = ?2",
                args![hash, a.id],
            )
            .map(drop)
        })?;
        self.get(a.id)
    }

    // ---- hunt-wide settings (the admins') --------------------------------------------------
    //
    // Kept as settings of owner 0, which no account is: nobody's rows, so no
    // account reads or changes them; read and written for every owner.

    fn shared_setting(&self, name: &str) -> Result<Option<String>> {
        self.with(|db| {
            db.text(
                "SELECT value /* all owners */ FROM setting WHERE owner_id = 0 AND name = ?1",
                args![name],
            )
        })
    }

    fn set_shared_setting(&self, name: &str, value: &str) -> Result<()> {
        self.with(|db| {
            db.exec(
                "INSERT INTO setting (owner_id, name, value) /* all owners */ VALUES (0, ?1, ?2) \
                 ON CONFLICT (owner_id, name) DO UPDATE SET value = ?2",
                args![name, value],
            )
            .map(drop)
        })
    }

    fn clear_shared_setting(&self, name: &str) -> Result<()> {
        self.with(|db| {
            db.exec(
                "DELETE FROM setting /* all owners */ WHERE owner_id = 0 AND name = ?1",
                args![name],
            )
            .map(drop)
        })
    }

    /// What admins say of this hunt, to everyone who opens it: its name
    /// (hunt's own, unless named), a notice on every page, and an address
    /// to write to for help. Each null when not set.
    pub fn site(&self) -> Result<Value> {
        let mut out = Map::new();
        for (k, _) in SITE {
            out.insert(
                k.to_string(),
                self.shared_setting(&format!("site.{k}"))?
                    .map_or(Value::Null, Value::from),
            );
        }
        Ok(Value::Object(out))
    }

    /// Change what admins say of this hunt; those left out stay, and an
    /// empty one goes back to none.
    pub fn set_site(&self, v: &Value) -> Result<Value> {
        let keys: Vec<&str> = SITE.iter().map(|(k, _)| *k).collect();
        for (name, value) in site_changes(v, &keys)? {
            match value {
                Some(value) => self.set_shared_setting(&name, &value)?,
                None => self.clear_shared_setting(&name)?,
            }
        }
        self.site()
    }

    /// Whether new people may ask for an account (admins can close it, so
    /// hunt isn't swamped). Open unless closed.
    pub fn signups_open(&self) -> Result<bool> {
        Ok(self.shared_setting("tenancy.signups")?.as_deref() != Some("closed"))
    }

    pub fn set_signups_open(&self, open: bool) -> Result<()> {
        self.set_shared_setting("tenancy.signups", if open { "open" } else { "closed" })
    }

    /// What new accounts start with: language, region, time zone, currency.
    pub fn defaults(&self) -> Result<Value> {
        let mut out = Map::new();
        for k in DEFAULTS {
            out.insert(
                k.replace("locale.", ""),
                self.shared_setting(&format!("default.{k}"))?
                    .map_or(Value::Null, Value::from),
            );
        }
        Ok(Value::Object(out))
    }

    /// Change what new accounts start with; an empty value, none.
    pub fn set_defaults(&self, v: &Value) -> Result<Value> {
        for k in DEFAULTS {
            let Some(x) = v.get(k.replace("locale.", "")) else {
                continue;
            };
            let value = x.as_str().map(str::trim).unwrap_or("");
            if *k == "locale.language"
                && !value.is_empty()
                && !crate::service::LANGUAGES
                    .iter()
                    .any(|(c, _, _)| *c == value)
            {
                return Err(invalid(format!(
                    "language: {value:?} isn't one hunt speaks"
                )));
            }
            if *k == "locale.currency"
                && !value.is_empty()
                && crate::fx::normalize_currency(value).is_none()
            {
                return Err(invalid(format!("currency: {value:?} isn't a currency")));
            }
            if value.is_empty() {
                self.clear_shared_setting(&format!("default.{k}"))?;
            } else {
                self.set_shared_setting(&format!("default.{k}"), value)?;
            }
        }
        self.defaults()
    }

    /// How long a toast with Undo stays, in seconds: 5 unless changed, and 0
    /// for until it's used or dismissed.
    pub fn undo_seconds(&self) -> Result<u32> {
        Ok(self
            .shared_setting("ui.undo_seconds")?
            .and_then(|v| v.parse().ok())
            .unwrap_or(UNDO_SECONDS))
    }

    pub fn set_undo_seconds(&self, seconds: u32) -> Result<()> {
        if seconds > 60 {
            return Err(invalid(format!(
                "undo_seconds: 60 at most (0 keeps it until it's used or dismissed), not {seconds}"
            )));
        }
        self.set_shared_setting("ui.undo_seconds", &seconds.to_string())
    }

    // ---- asking for an account ------------------------------------------------------------

    /// Ask for an account: pending until an admin decides. Asking again
    /// after a rejection asks again.
    pub fn request(
        &self,
        who: &Identity,
        name: Option<&str>,
        reason: Option<&str>,
        provider: Option<&str>,
        terms: Option<&str>,
    ) -> Result<Account> {
        let email = who.email.clone().ok_or_else(|| {
            invalid("a service token can't ask for an account; sign in as yourself")
        })?;
        let (name, reason, provider) = (clean(name), clean(reason), clean(provider));
        let existing = self.find_email(&email)?;
        // Closed: nobody new asks (an account already there is as it is).
        if !self.signups_open()? && existing.as_ref().is_none_or(|a| a.status == "rejected") {
            return Err(invalid(
                "hunt isn't taking new accounts just now: try again later",
            ));
        }
        match existing {
            Some(a) if a.status == "rejected" => self.with(|db| {
                let at = db.stamp();
                db.exec(
                    "UPDATE account SET status = 'pending', name = coalesce(?1, name), reason = ?2, \
                     provider = coalesce(?3, provider), requested_at = ?4, decided_at = NULL, \
                     decided_by = NULL, note = NULL WHERE id = ?5",
                    &[name.into(), reason.into(), provider.into(), Sql::Text(at), Sql::Integer(a.id)],
                )
                .map(drop)
            })?,
            Some(a) => return Ok(a),
            None => self.with(|db| {
                let at = db.stamp();
                db.exec(
                    "INSERT INTO account (email, name, reason, provider, status, role, requested_at) \
                     VALUES (?1, ?2, ?3, ?4, 'pending', 'user', ?5)",
                    &[Sql::Text(email.clone()), name.into(), reason.into(), provider.into(), Sql::Text(at)],
                )
                .map(drop)
            })?,
        }
        let account = self
            .find_email(&email)?
            .ok_or_else(|| Error::NotFound("the request went missing".into()))?;
        // Which terms they agreed to (if any), and when: kept with their own settings.
        let Some(terms) = terms else {
            return Ok(account);
        };
        self.with(|db| {
            let agreed = format!("{terms} {}", db.stamp());
            db.exec(
                "INSERT INTO setting (owner_id, name, value) /* all owners */ VALUES (?1, 'legal.terms', ?2) \
                 ON CONFLICT (owner_id, name) DO UPDATE SET value = ?2",
                args![account.id, agreed],
            )
            .map(drop)
        })?;
        Ok(account)
    }

    // ---- the admin centre -----------------------------------------------------------------

    /// Invite someone: an active account for their email address, whether
    /// or not sign-ups are open. Someone who asked already is let in.
    pub fn invite(&self, email: &str, name: Option<&str>, by: &Account) -> Result<Account> {
        let email = clean(Some(email))
            .filter(|e| e.contains('@'))
            .ok_or_else(|| invalid("invite whom? give an email address"))?
            .to_lowercase();
        match self.find_email(&email)? {
            Some(a) if a.status == "active" => {
                return Err(invalid(format!("{email} already has an account")));
            }
            Some(a) => {
                self.decide(a.id, "active", by, Some("Invited"))?;
            }
            None => self.with(|db| {
                let at = db.stamp();
                db.exec(
                    "INSERT INTO account (email, name, provider, status, role, requested_at, decided_at, decided_by, note) \
                     VALUES (?1, ?2, 'invite', 'active', 'user', ?3, ?3, ?4, 'Invited')",
                    &[Sql::Text(email.clone()), clean(name).into(), Sql::Text(at), Sql::Text(by.email.clone())],
                )
                .map(drop)
            })?,
        }
        let a = self
            .find_email(&email)?
            .ok_or_else(|| Error::NotFound(email.clone()))?;
        self.seed_if_new(a.id)?;
        Ok(a)
    }

    /// How each account uses hunt, without who they are: its number, role,
    /// status, when it joined and was last seen (days only), and how many of
    /// each thing it keeps, its files' size and its rows in all.
    pub fn usage(&self) -> Result<Value> {
        let accounts = self.list()?;
        self.with(|db| {
            let per = |sql: &str| -> Result<HashMap<i64, i64>> {
                Ok(db
                    .query(sql, &[])?
                    .iter()
                    .map(|r| (r["id"].as_i64().unwrap_or(0), r["n"].as_i64().unwrap_or(0)))
                    .collect())
            };
            let count = |table: &str, filter: &str| {
                per(&format!(
                    "SELECT owner_id AS id, count(*) AS n /* all owners */ FROM {table} {filter} GROUP BY owner_id"
                ))
            };
            let applications = count("application", "")?;
            let active = count("process", "WHERE status = 'active'")?;
            let closed = count("process", "WHERE status = 'archived'")?;
            let cycles = count("cycle", "")?;
            let companies = count("company", "")?;
            let people = count("person", "")?;
            let steps = count("step", "")?;
            let prep = count("prep_item", "")?;
            let documents = count("document", "")?;
            let changes = count("activity", "")?;
            let bytes = per("SELECT owner_id AS id, coalesce(sum(size), 0) AS n /* all owners */ FROM version GROUP BY owner_id")?;
            let mut rows_by: HashMap<i64, i64> = HashMap::new();
            for table in crate::scope::OWNED {
                for (id, n) in count(table, "")? {
                    *rows_by.entry(id).or_default() += n;
                }
            }
            let last_active: HashMap<i64, String> = db
                .query("SELECT owner_id AS id, max(at) AS at /* all owners */ FROM activity GROUP BY owner_id", &[])?
                .iter()
                .filter_map(|r| Some((r["id"].as_i64()?, r["at"].as_str()?.get(..10)?.to_string())))
                .collect();
            let get = |m: &HashMap<i64, i64>, id: i64| m.get(&id).copied().unwrap_or(0);
            let rows: Vec<Value> = accounts
                .iter()
                .map(|a| {
                    json!({
                        "id": a.id, "role": a.role, "status": a.status,
                        "joined": a.requested_at.get(..10),
                        "last_seen": a.last_seen.as_deref().and_then(|d| d.get(..10)),
                        "last_active": last_active.get(&a.id),
                        "applications": get(&applications, a.id), "active": get(&active, a.id),
                        "closed": get(&closed, a.id), "cycles": get(&cycles, a.id),
                        "companies": get(&companies, a.id), "people": get(&people, a.id),
                        "steps": get(&steps, a.id), "prep": get(&prep, a.id),
                        "documents": get(&documents, a.id), "file_bytes": get(&bytes, a.id),
                        "changes": get(&changes, a.id), "rows": get(&rows_by, a.id),
                    })
                })
                .collect();
            Ok(json!({ "accounts": rows }))
        })
    }

    /// Every account: the pending first, then the newest.
    pub fn list(&self) -> Result<Vec<Account>> {
        self.with(|db| {
            Ok(db
                .query(
                    "SELECT * FROM account ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END, requested_at DESC, id DESC",
                    &[],
                )?
                .iter()
                .map(account)
                .collect())
        })
    }

    pub fn get(&self, id: i64) -> Result<Account> {
        self.find("id = ?1", Sql::Integer(id))?
            .ok_or_else(|| Error::NotFound(format!("no account #{id}")))
    }

    /// Approve, reject, disable or enable an account, noting who did, and
    /// why. An account approved gets the usual stages, if it's new.
    pub fn decide(
        &self,
        id: i64,
        status: &str,
        by: &Account,
        note: Option<&str>,
    ) -> Result<Account> {
        if !matches!(status, "active" | "rejected" | "disabled") {
            return Err(invalid(format!(
                "an account can be active, rejected or disabled, not {status:?}"
            )));
        }
        let a = self.get(id)?;
        if a.id == by.id && status != "active" {
            return Err(invalid("you can't turn your own account away"));
        }
        self.with(|db| {
            let at = db.stamp();
            db.exec(
                "UPDATE account SET status = ?1, decided_at = ?2, decided_by = ?3, note = ?4 WHERE id = ?5",
                &[Sql::Text(status.into()), Sql::Text(at), Sql::Text(by.email.clone()), clean(note).into(), Sql::Integer(id)],
            )
        })?;
        if status == "active" {
            self.seed_if_new(id)?;
        }
        self.get(id)
    }

    /// Change an account's name, role, or CLI service token.
    pub fn change(&self, id: i64, v: &Value, by: &Account) -> Result<Account> {
        let a = self.get(id)?;
        if let Some(role) = v.get("role") {
            let role = role.as_str().unwrap_or("");
            if !matches!(role, "user" | "admin") {
                return Err(invalid(format!("a role is user or admin, not {role:?}")));
            }
            if a.id == by.id && role != "admin" {
                return Err(invalid(
                    "you can't take your own admin away; ask another admin",
                ));
            }
            self.with(|db| {
                db.exec(
                    "UPDATE account SET role = ?1 WHERE id = ?2",
                    args![role, id],
                )
            })?;
        }
        if let Some(name) = v.get("name") {
            let name = clean(name.as_str());
            self.with(|db| {
                db.exec(
                    "UPDATE account SET name = ?1 WHERE id = ?2",
                    &[name.into(), Sql::Integer(id)],
                )
            })?;
        }
        if let Some(token) = v.get("service_token") {
            let token = clean(token.as_str());
            self.with(|db| {
                db.exec(
                    "UPDATE account SET service_token = ?1 WHERE id = ?2",
                    &[token.into(), Sql::Integer(id)],
                )
            })
            .map_err(|_| invalid("another account has that service token"))?;
        }
        self.get(id)
    }

    /// Remove an account; with `data`, every row of theirs too.
    pub fn remove(&self, id: i64, by: &Account, data: bool) -> Result<Value> {
        let a = self.get(id)?;
        if a.id == by.id {
            return Err(invalid("you can't remove your own account"));
        }
        self.erase(a.id, data)
    }

    /// Why someone can't delete their own account, if they can't: the last
    /// admin, or the last account, would leave hunt with nobody to run it.
    pub fn why_not_delete(&self, me: &Account) -> Result<Option<&'static str>> {
        let accounts = self.list()?;
        let active = |a: &&Account| a.status == "active";
        if me.is_admin() && accounts.iter().filter(active).filter(|a| a.is_admin()).count() <= 1 {
            return Ok(Some(
                "you're the only admin: make someone else an admin first, so hunt still has one",
            ));
        }
        if accounts.iter().filter(|a| a.id != me.id).filter(active).count() == 0 {
            return Ok(Some("yours is the only account: hunt would have nobody to run it"));
        }
        Ok(None)
    }

    /// Someone deleting their own account, and everything in it, for good;
    /// not when [`Self::why_not_delete`] says why not.
    pub fn delete_own(&self, me: &Account) -> Result<Value> {
        if let Some(why) = self.why_not_delete(me)? {
            return Err(invalid(why));
        }
        self.erase(me.id, true)
    }

    /// An account gone, and (with `data`) every row of theirs.
    fn erase(&self, id: i64, data: bool) -> Result<Value> {
        let db = self.db.lock().unwrap_or_else(|e| e.into_inner());
        let before = db.owner();
        let out = db.atomic(|db| {
            let mut rows = 0;
            if data {
                db.set_owner(Some(id));
                for table in REMOVE_ORDER {
                    rows += db.exec(&format!("DELETE FROM {table}"), &[])?;
                }
                db.set_owner(None);
                db.prune_blobs()?;
            }
            db.set_owner(None);
            db.exec("DELETE FROM account WHERE id = ?1", args![id])?;
            Ok(json!({ "removed": id, "rows_removed": rows }))
        });
        db.set_owner(before);
        out
    }

    /// Each account with what it holds: applications and rows.
    pub fn overview(&self) -> Result<Value> {
        let accounts = self.list()?;
        let counts = self.with(|db| {
            let mut apps = HashMap::new();
            for r in db.query(
                "SELECT owner_id AS id, count(*) AS n FROM application GROUP BY owner_id",
                &[],
            )? {
                apps.insert(r["id"].as_i64().unwrap_or(0), r["n"].as_i64().unwrap_or(0));
            }
            // Which terms each agreed to, and when ("2026-10-08 <when>").
            let mut terms = HashMap::new();
            for r in db.query(
                "SELECT owner_id AS id, value /* all owners */ FROM setting WHERE name = 'legal.terms'",
                &[],
            )? {
                terms.insert(r["id"].as_i64().unwrap_or(0), r["value"].clone());
            }
            Ok((apps, terms))
        })?;
        let (counts, terms) = counts;
        let mut rows = Vec::new();
        for a in &accounts {
            let mut row = serde_json::to_value(a).unwrap_or(Value::Null);
            row["applications"] = json!(counts.get(&a.id).copied().unwrap_or(0));
            row["agreed_terms"] = terms.get(&a.id).cloned().unwrap_or(Value::Null);
            rows.push(row);
        }
        let count = |s: &str| accounts.iter().filter(|a| a.status == s).count();
        Ok(json!({
            "signups_open": self.signups_open()?,
            "defaults": self.defaults()?,
            "site": self.site()?,
            "undo_seconds": self.undo_seconds()?,
            "accounts": rows,
            "totals": {
                "active": count("active"), "pending": count("pending"),
                "rejected": count("rejected"), "disabled": count("disabled"),
                "admins": accounts.iter().filter(|a| a.role == "admin").count(),
                "applications": counts.values().sum::<i64>(),
            },
        }))
    }

    fn find_email(&self, email: &str) -> Result<Option<Account>> {
        self.with(|db| {
            Ok(db
                .query(
                    "SELECT * FROM account WHERE lower(email) = lower(?1)",
                    args![email],
                )?
                .first()
                .map(account))
        })
    }

    fn find(&self, filter: &str, value: Sql) -> Result<Option<Account>> {
        self.with(|db| {
            Ok(db
                .query(&format!("SELECT * FROM account WHERE {filter}"), &[value])?
                .first()
                .map(account))
        })
    }
}

// ---- Cloudflare Access's tokens -------------------------------------------------------------

/// A cookie's value, from the Cookie header.
pub(crate) fn cookie(headers: &axum::http::HeaderMap, name: &str) -> Option<String> {
    headers
        .get_all(axum::http::header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|kv| kv.trim().split_once('='))
        .find(|(k, _)| *k == name)
        .map(|(_, v)| v.to_string())
}

/// The team's address: `yourteam` → `https://yourteam.cloudflareaccess.com`.
pub fn team_url(team: &str) -> String {
    let t = team.trim().trim_end_matches('/');
    let t = t.strip_prefix("https://").unwrap_or(t);
    if t.contains('.') {
        format!("https://{t}")
    } else {
        format!("https://{t}.cloudflareaccess.com")
    }
}

/// Check an Access token: signed by the team's key, for this application
/// (`aud`), from the team, and in date. Its claims, if so.
fn verify_access(
    token: &str,
    team: &str,
    aud: &str,
    keys: &Mutex<Option<(Instant, jsonwebtoken::jwk::JwkSet)>>,
) -> Result<Value> {
    use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header};
    let header = decode_header(token).map_err(|e| invalid(e.to_string()))?;
    let kid = header
        .kid
        .ok_or_else(|| invalid("the token names no key"))?;
    // The team's keys, kept an hour; fetched again for a key not seen yet.
    let key = |set: &jsonwebtoken::jwk::JwkSet| set.find(&kid).cloned();
    let mut cached = keys.lock().unwrap_or_else(|e| e.into_inner());
    let fresh = cached
        .as_ref()
        .is_some_and(|(at, _)| at.elapsed() < Duration::from_secs(3600));
    let mut jwk = cached
        .as_ref()
        .filter(|_| fresh)
        .and_then(|(_, set)| key(set));
    if jwk.is_none() {
        let url = format!("{}/cdn-cgi/access/certs", team_url(team));
        let set: jsonwebtoken::jwk::JwkSet = ureq::get(&url)
            .call()
            .map_err(|e| Error::Fetch(format!("Access's keys ({url}): {e}")))?
            .body_mut()
            .read_json()
            .map_err(|e| Error::Fetch(format!("Access's keys ({url}): {e}")))?;
        jwk = key(&set);
        *cached = Some((Instant::now(), set));
    }
    drop(cached);
    let jwk = jwk.ok_or_else(|| invalid("signed with a key the team doesn't have"))?;
    let decoding = DecodingKey::from_jwk(&jwk).map_err(|e| invalid(e.to_string()))?;
    let mut v = Validation::new(Algorithm::RS256);
    v.set_audience(&[aud]);
    v.set_issuer(&[team_url(team)]);
    let data = decode::<Value>(token, &decoding, &v).map_err(|e| invalid(e.to_string()))?;
    Ok(data.claims)
}

/// Check an Access token against keys already in hand: for tests.
#[doc(hidden)]
pub fn verify_with_keys(
    token: &str,
    team: &str,
    aud: &str,
    keys: jsonwebtoken::jwk::JwkSet,
) -> Result<Value> {
    verify_access(token, team, aud, &Mutex::new(Some((Instant::now(), keys))))
}
