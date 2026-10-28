//! Signing in without Cloudflare: one person's hunt's owner, and the
//! addresses a sign-in proxy's header is taken from, for several people's.
//!
//! **hunt's own sign-in**: each account's email address and password (an
//! Argon2 hash, with the account: see [`crate::tenants`]), at /login. The
//! first is the owner's, made in a new hunt's launcher (or from
//! `HUNT_ADMIN_EMAIL` and `HUNT_ADMIN_PASSWORD` when hunt starts); others
//! sign up at /signup, while sign-ups are open or invited. Until there's an
//! owner, nothing needs signing in. Signing in sets a cookie, good for 30
//! days: the account, its expiry, signed with a key made from its
//! password's hash, so a new password ends its sessions. The CLI sends the
//! address and password itself (`Authorization: Basic`, from `HUNT_EMAIL`
//! and `HUNT_PASSWORD`). A wrong one costs a second. Apps (the browser
//! extension, an iOS Shortcut) send a personal access token instead
//! (`Authorization: Bearer hunt_…`), made in Settings: see
//! [`crate::tenants::Tenants::make_token`].
//!
//! **A sign-in proxy** (`HUNT_AUTH_HEADER`): Authelia, Authentik,
//! oauth2-proxy or Tailscale signs people in, and names them in a header
//! (`Remote-Email`, say); hunt takes it only from the proxy's addresses
//! (`HUNT_TRUSTED_PROXIES`, this machine unless said), so nobody reaching
//! hunt another way can claim to be anyone. See [`crate::tenants`].

use std::net::IpAddr;
use std::sync::Mutex;

use argon2::Argon2;
use argon2::password_hash::{
    PasswordHash, PasswordHasher, PasswordVerifier, SaltString, rand_core::OsRng,
};
use base64::Engine;
use sha2::{Digest, Sha256};

use crate::error::{Error, Result};

/// The sign-in cookie.
pub const COOKIE: &str = "hunt_session";
/// How long signing in lasts.
pub const SESSION_DAYS: i64 = 30;
/// The shortest password.
pub const MIN_LENGTH: usize = 8;

/// A password, kept as its Argon2 hash, and the key its sessions are
/// signed with.
pub struct Password {
    hash: String,
    key: [u8; 32],
    /// The last password that matched (its SHA-256), so the CLI's requests,
    /// each sending it, aren't each an Argon2 check.
    matched: Mutex<Option<[u8; 32]>>,
}

impl Password {
    /// A new password: its hash, to keep.
    pub fn hash(password: &str) -> Result<String> {
        if password.chars().count() < MIN_LENGTH {
            return Err(Error::Invalid(format!(
                "The password is too short: give it {MIN_LENGTH} characters or more"
            )));
        }
        let salt = SaltString::generate(&mut OsRng);
        Argon2::default()
            .hash_password(password.as_bytes(), &salt)
            .map(|h| h.to_string())
            .map_err(|e| Error::Invalid(format!("can't keep that password: {e}")))
    }

    /// One that was kept, from its hash.
    pub fn stored(hash: &str) -> Result<Password> {
        PasswordHash::new(hash).map_err(|e| Error::Db(format!("the stored password: {e}")))?;
        Ok(Password {
            hash: hash.to_string(),
            key: Sha256::digest(format!("hunt session key\n{hash}")).into(),
            matched: Mutex::new(None),
        })
    }

    /// Whether `given` is the password.
    pub fn matches(&self, given: &str) -> bool {
        let given_sum: [u8; 32] = Sha256::digest(given.as_bytes()).into();
        let mut last = self.matched.lock().unwrap_or_else(|e| e.into_inner());
        if last.is_some_and(|sum| same(&sum, &given_sum)) {
            return true;
        }
        let ok = PasswordHash::new(&self.hash).is_ok_and(|h| {
            Argon2::default()
                .verify_password(given.as_bytes(), &h)
                .is_ok()
        });
        if ok {
            *last = Some(given_sum);
        }
        ok
    }

    /// A session, for the cookie: good until `until` (seconds since 1970).
    pub fn session(&self, until: i64) -> String {
        format!(
            "{until}.{}",
            hex(&hmac(&self.key, until.to_string().as_bytes()))
        )
    }

    /// Whether a cookie's session is one of ours, and still good at `now`.
    pub fn valid(&self, session: &str, now: i64) -> bool {
        let Some((until, mac)) = session.split_once('.') else {
            return false;
        };
        let Ok(until) = until.parse::<i64>() else {
            return false;
        };
        until > now
            && same(
                mac.as_bytes(),
                hex(&hmac(&self.key, until.to_string().as_bytes())).as_bytes(),
            )
    }
}

/// An `Authorization: Basic` header's address and password (the CLI's).
pub fn basic(header: &str) -> Option<(String, String)> {
    let encoded = header.strip_prefix("Basic ")?;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .ok()?;
    let text = String::from_utf8(decoded).ok()?;
    let (email, password) = text.split_once(':')?;
    Some((email.to_string(), password.to_string()))
}

/// An `Authorization: Basic` header for an address and password.
pub fn basic_header(email: &str, password: &str) -> String {
    format!(
        "Basic {}",
        base64::engine::general_purpose::STANDARD.encode(format!("{email}:{password}"))
    )
}

/// HMAC-SHA256 (RFC 2104).
fn hmac(key: &[u8; 32], message: &[u8]) -> [u8; 32] {
    let mut block = [0u8; 64];
    block[..32].copy_from_slice(key);
    let pad = |byte: u8| block.map(|b| b ^ byte);
    let inner = Sha256::new()
        .chain_update(pad(0x36))
        .chain_update(message)
        .finalize();
    Sha256::new()
        .chain_update(pad(0x5c))
        .chain_update(inner)
        .finalize()
        .into()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Equal, in time that doesn't say how much of it was.
fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |d, (x, y)| d | (x ^ y)) == 0
}

/// An address, or a range of them (`10.0.0.0/8`, `fd00::/8`).
#[derive(Debug, Clone, PartialEq)]
pub struct Cidr {
    net: IpAddr,
    bits: u32,
}

impl Cidr {
    pub fn parse(text: &str) -> Result<Cidr> {
        let text = text.trim();
        let (addr, bits) = match text.split_once('/') {
            Some((a, b)) => (a, Some(b)),
            None => (text, None),
        };
        let bad = || Error::Invalid(format!("{text:?} isn't an address or a range (10.0.0.0/8)"));
        let net: IpAddr = addr.parse().map_err(|_| bad())?;
        let max = if net.is_ipv4() { 32 } else { 128 };
        let bits = match bits {
            Some(b) => b.parse().ok().filter(|b| *b <= max).ok_or_else(bad)?,
            None => max,
        };
        Ok(Cidr { net, bits })
    }

    /// The default: this machine.
    pub fn local() -> Vec<Cidr> {
        vec![
            Cidr::parse("127.0.0.1").unwrap(),
            Cidr::parse("::1").unwrap(),
        ]
    }

    pub fn contains(&self, ip: IpAddr) -> bool {
        // An IPv4 address seen through IPv6 (::ffff:10.0.0.1) is that address.
        let ip = match ip {
            IpAddr::V6(v6) => v6.to_ipv4_mapped().map(IpAddr::V4).unwrap_or(ip),
            v4 => v4,
        };
        let (a, b, width) = match (self.net, ip) {
            (IpAddr::V4(n), IpAddr::V4(i)) => (u32::from(n) as u128, u32::from(i) as u128, 32),
            (IpAddr::V6(n), IpAddr::V6(i)) => (u128::from(n), u128::from(i), 128),
            _ => return false,
        };
        if self.bits == 0 {
            return true;
        }
        let shift = width - self.bits;
        (a >> shift) == (b >> shift)
    }
}

/// Text made safe to put in a page.
fn html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// The sign-in page: an email address and password, where to go after, and
/// (while sign-ups are open) the way to sign up.
pub fn login_page(next: &str, wrong: bool, signups_open: bool) -> String {
    include_str!("web/login.html")
        .replace("{{next}}", &html(next))
        .replace(
            "{{error}}",
            if wrong {
                r#"<p class="al-error" id="login-error" role="alert">That email address and password don't match.</p>"#
            } else {
                ""
            },
        )
        .replace(
            "{{signup}}",
            if signups_open {
                r#"<p class="login-other">New here? <a href="/signup">Sign up</a>.</p>"#
            } else {
                ""
            },
        )
}

/// The sign-up page: an email address and password, a name and why, the
/// terms of use to agree to (where this hunt has some: `site`, its
/// website), and what was wrong with the last try.
pub fn signup_page(site: Option<&str>, wrong: Option<&str>) -> String {
    let terms = site.map(|site| {
        let site = html(site.trim_end_matches('/'));
        format!(
            r#"<label class="al-label al-choice agree"><input type="checkbox" name="agrees" required> I agree to the <a href="{site}/terms/" target="_blank">terms of use</a>, and have read the <a href="{site}/privacy/" target="_blank">privacy notice</a>.</label>"#
        )
    });
    include_str!("web/signup.html")
        .replace("{{terms}}", &terms.unwrap_or_default())
        .replace(
            "{{error}}",
            &wrong
                .map(|w| format!(r#"<p class="al-error" role="alert">{}</p>"#, html(w)))
                .unwrap_or_default(),
        )
}

/// Where to go after signing in: a path of this hunt's own, or the board.
pub fn safe_next(next: Option<&str>) -> String {
    match next {
        Some(n) if n.starts_with('/') && !n.starts_with("//") && !n.contains('\\') => n.to_string(),
        _ => "/".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn password(p: &str) -> Password {
        Password::stored(&Password::hash(p).unwrap()).unwrap()
    }

    #[test]
    fn a_session_is_good_till_it_ends_and_only_with_its_password() {
        let p = password("correct horse");
        let s = p.session(1_000);
        assert!(p.valid(&s, 999));
        assert!(!p.valid(&s, 1_000), "ended");
        assert!(
            !p.valid(&s.replace("1000.", "9999."), 999),
            "a later end, unsigned"
        );
        assert!(!password("another one").valid(&s, 999), "another password");
        assert!(!p.valid("nonsense", 0));
        assert!(p.matches("correct horse"));
        assert!(!p.matches("correct horsE"));
        assert!(Password::hash("short").is_err());
    }

    #[test]
    fn the_cli_sends_an_address_and_password() {
        let (email, pass) = basic(&basic_header("me@example.com", "a:colon")).unwrap();
        assert_eq!(
            (email.as_str(), pass.as_str()),
            ("me@example.com", "a:colon")
        );
        assert!(basic("Bearer x").is_none());
    }

    #[test]
    fn hmac_is_rfc_4231s() {
        // RFC 4231, test case 2 (its key padded to 32 bytes is the same key).
        let mut key = [0u8; 32];
        key[..4].copy_from_slice(b"Jefe");
        assert_eq!(
            hex(&hmac(&key, b"what do ya want for nothing?")),
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
    }

    #[test]
    fn addresses_are_in_their_ranges() {
        let net = Cidr::parse("10.0.0.0/8").unwrap();
        assert!(net.contains("10.1.2.3".parse().unwrap()));
        assert!(!net.contains("11.0.0.1".parse().unwrap()));
        assert!(
            net.contains("::ffff:10.0.0.1".parse().unwrap()),
            "IPv4 through IPv6"
        );
        assert!(Cidr::parse("::1").unwrap().contains("::1".parse().unwrap()));
        assert!(
            Cidr::parse("fd00::/8")
                .unwrap()
                .contains("fd12::1".parse().unwrap())
        );
        assert!(Cidr::parse("10.0.0.0/33").is_err());
        assert!(Cidr::parse("proxy").is_err());
    }

    #[test]
    fn signing_in_only_leads_to_this_hunts_own_pages() {
        assert_eq!(safe_next(Some("/board?x=1")), "/board?x=1");
        assert_eq!(safe_next(Some("//evil.example")), "/");
        assert_eq!(safe_next(Some("https://evil.example")), "/");
        assert_eq!(safe_next(None), "/");
    }
}
