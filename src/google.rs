//! Signing in with Google (OAuth 2.0), and reading Gmail through its API.
//!
//! With Google sign-in, hunt asks only to read mail and to manage labels
//! (`gmail.readonly`, `gmail.labels`): it can't send, change or delete mail.
//! Gmail's IMAP would need full access, so signed in, hunt reads Gmail
//! through the Gmail API instead; it searches with the same syntax, and its
//! message and thread ids are IMAP's, in hex.
//!
//! The OAuth client is yours: made in Google Cloud and given to hunt as the
//! JSON file Google offers to download.

use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::error::{Error, Result, invalid};
use crate::mail::{Mailbox, Message, Search, parse_message};

/// What hunt asks to do with your Gmail.
pub const SCOPES: &str =
    "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.labels";

/// The path Google sends you back to after signing in.
pub const CALLBACK: &str = "/api/mail/google/callback";

/// Searches stop after this many messages each.
const MAX_RESULTS: usize = 2000;

/// An OAuth client, as in the JSON file Google Cloud offers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Client {
    pub client_id: String,
    pub client_secret: String,
    pub auth_uri: String,
    pub token_uri: String,
}

impl Client {
    /// Read the file Google Cloud gives for a client: `{"web": {…}}` or
    /// `{"installed": {…}}`.
    pub fn from_json(text: &str) -> Result<Client> {
        let v: Value = serde_json::from_str(text)
            .map_err(|_| invalid("that isn't the OAuth client's JSON file from Google Cloud"))?;
        let c = v.get("web").or_else(|| v.get("installed")).ok_or_else(|| {
            invalid("that JSON isn't an OAuth client (no \"web\" or \"installed\" in it)")
        })?;
        let s = |k: &str| c[k].as_str().unwrap_or("").trim().to_string();
        let client = Client {
            client_id: s("client_id"),
            client_secret: s("client_secret"),
            auth_uri: Some(s("auth_uri"))
                .filter(|u| !u.is_empty())
                .unwrap_or_else(|| "https://accounts.google.com/o/oauth2/auth".into()),
            token_uri: Some(s("token_uri"))
                .filter(|u| !u.is_empty())
                .unwrap_or_else(|| "https://oauth2.googleapis.com/token".into()),
        };
        if client.client_id.is_empty() || client.client_secret.is_empty() {
            return Err(invalid(
                "the OAuth client's file needs its client_id and client_secret",
            ));
        }
        Ok(client)
    }

    /// Where to send you to sign in. `verifier` is kept to finish signing in
    /// (PKCE); `state` comes back, to check it's this sign-in.
    pub fn auth_url(&self, redirect: &str, state: &str, verifier: &str) -> String {
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let q = [
            ("client_id", self.client_id.as_str()),
            ("redirect_uri", redirect),
            ("response_type", "code"),
            ("scope", SCOPES),
            ("access_type", "offline"),
            ("prompt", "consent"),
            ("state", state),
            ("code_challenge", &challenge),
            ("code_challenge_method", "S256"),
        ];
        let q: Vec<String> = q.iter().map(|(k, v)| format!("{k}={}", enc(v))).collect();
        format!("{}?{}", self.auth_uri, q.join("&"))
    }

    /// Finish signing in: the code Google sent back, for tokens.
    pub fn exchange(&self, code: &str, redirect: &str, verifier: &str) -> Result<Tokens> {
        let v = post_form(
            &self.token_uri,
            &[
                ("code", code),
                ("client_id", &self.client_id),
                ("client_secret", &self.client_secret),
                ("redirect_uri", redirect),
                ("grant_type", "authorization_code"),
                ("code_verifier", verifier),
            ],
        )?;
        let access = v["access_token"].as_str().unwrap_or("").to_string();
        if access.is_empty() {
            return Err(Error::Fetch("Google didn't give hunt access".into()));
        }
        let granted = v["scope"].as_str().unwrap_or(SCOPES);
        if !granted.contains("gmail.readonly") {
            return Err(invalid(
                "hunt wasn't allowed to read Gmail; sign in again and tick the boxes Google offers",
            ));
        }
        Ok(Tokens {
            access,
            refresh: v["refresh_token"].as_str().map(String::from),
        })
    }

    /// A fresh access token.
    pub fn refresh(&self, refresh_token: &str) -> Result<String> {
        let v = post_form(
            &self.token_uri,
            &[
                ("refresh_token", refresh_token),
                ("client_id", &self.client_id),
                ("client_secret", &self.client_secret),
                ("grant_type", "refresh_token"),
            ],
        )
        .map_err(|e| match e {
            Error::Invalid(m)
                if m.contains("invalid_grant")
                    || m.contains("expired")
                    || m.contains("revoked") =>
            {
                invalid("Google sign-in has expired or was revoked; sign in again in Settings")
            }
            other => other,
        })?;
        v["access_token"]
            .as_str()
            .map(String::from)
            .ok_or_else(|| Error::Fetch("Google didn't give hunt access".into()))
    }

    /// Withdraw hunt's access (best effort).
    pub fn revoke(&self, token: &str) {
        let url = match self.token_uri.strip_suffix("/token") {
            Some(base) => format!("{base}/revoke"),
            None => return,
        };
        let _ = post_form(&url, &[("token", token)]);
    }
}

/// What signing in gives: access now, and a way to get it again.
pub struct Tokens {
    pub access: String,
    pub refresh: Option<String>,
}

/// A signed-in Google account, as kept.
#[derive(Debug, Clone)]
pub struct Signin {
    pub client: Client,
    pub refresh_token: String,
}

/// Random, URL-safe: for a sign-in's state and PKCE verifier. Each
/// `RandomState` is seeded by the system's randomness.
pub fn random_token() -> String {
    let mut bytes = Vec::with_capacity(32);
    for i in 0..4u64 {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u64(i);
        bytes.extend_from_slice(&h.finish().to_le_bytes());
    }
    URL_SAFE_NO_PAD.encode(bytes)
}

fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(30)))
        .http_status_as_error(false)
        .build()
        .into()
}

/// A response's JSON, or what went wrong, in Google's words.
fn read(mut res: ureq::http::Response<ureq::Body>, what: &str) -> Result<Value> {
    let status = res.status().as_u16();
    let text = res
        .body_mut()
        .with_config()
        .limit(40 * 1024 * 1024)
        .read_to_string()
        .map_err(|e| Error::Fetch(format!("{what}: {e}")))?;
    let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    if (200..300).contains(&status) {
        return Ok(v);
    }
    let said = v["error"]["message"]
        .as_str()
        .or(v["error_description"].as_str())
        .or(v["error"].as_str())
        .unwrap_or("")
        .to_string();
    let said = format!(
        "{said} ({})",
        v["error"].as_str().unwrap_or(&status.to_string())
    );
    Err(match status {
        400 | 401 => invalid(format!("{what}: Google said {said}")),
        403 => invalid(format!(
            "{what}: Google refused ({said}). Is the Gmail API on for the project, and was hunt allowed to read Gmail?"
        )),
        404 => Error::NotFound(format!("{what}: not in Gmail")),
        _ => Error::Fetch(format!("{what}: Google said {said}")),
    })
}

fn post_form(url: &str, form: &[(&str, &str)]) -> Result<Value> {
    let res = agent()
        .post(url)
        .send_form(form.iter().copied())
        .map_err(|e| Error::Fetch(format!("couldn't reach Google: {e}")))?;
    read(res, "signing in")
}

// --- Gmail, through its API ------------------------------------------------------

/// Gmail through its API, signed in. UIDs are places in a list of message
/// ids seen, for the [`Mailbox`] interface.
pub struct GmailApi {
    base: String,
    access: String,
    ids: Vec<String>,
    labels: Option<HashMap<String, String>>,
}

/// Where the Gmail API is; `HUNT_GMAIL_API` replaces it, for tests.
fn api_base() -> String {
    std::env::var("HUNT_GMAIL_API").unwrap_or_else(|_| "https://gmail.googleapis.com".into())
}

/// Gmail's ids: hex in the API, decimal in IMAP (and as kept).
fn to_decimal(hex: &str) -> String {
    u64::from_str_radix(hex, 16).map_or_else(|_| hex.to_string(), |n| n.to_string())
}

fn to_hex(decimal: &str) -> String {
    decimal
        .parse::<u64>()
        .map_or_else(|_| decimal.to_string(), |n| format!("{n:x}"))
}

impl GmailApi {
    /// Signed in: a fresh access token from the kept one.
    pub fn connect(signin: &Signin) -> Result<GmailApi> {
        Ok(GmailApi::with_token(
            &signin.client.refresh(&signin.refresh_token)?,
        ))
    }

    pub fn with_token(access: &str) -> GmailApi {
        GmailApi {
            base: api_base(),
            access: access.to_string(),
            ids: Vec::new(),
            labels: None,
        }
    }

    fn get(&self, path: &str, query: &[(&str, &str)]) -> Result<Value> {
        let mut req = agent()
            .get(format!("{}/gmail/v1/users/me/{path}", self.base))
            .header("Authorization", format!("Bearer {}", self.access));
        for (k, v) in query {
            req = req.query(*k, *v);
        }
        let res = req
            .call()
            .map_err(|e| Error::Fetch(format!("couldn't reach Gmail: {e}")))?;
        read(res, "Gmail")
    }

    fn send(&self, method: &str, path: &str, body: &Value) -> Result<Value> {
        let url = format!("{}/gmail/v1/users/me/{path}", self.base);
        let auth = format!("Bearer {}", self.access);
        let a = agent();
        let res = match method {
            "PATCH" => a.patch(&url).header("Authorization", &auth).send_json(body),
            _ => a.post(&url).header("Authorization", &auth).send_json(body),
        }
        .map_err(|e| Error::Fetch(format!("couldn't reach Gmail: {e}")))?;
        read(res, "Gmail")
    }

    /// The address signed in.
    pub fn address(&self) -> Result<String> {
        Ok(self.get("profile", &[])?["emailAddress"]
            .as_str()
            .unwrap_or("")
            .to_lowercase())
    }

    fn uid(&mut self, id: &str) -> u32 {
        match self.ids.iter().position(|x| x == id) {
            Some(i) => i as u32 + 1,
            None => {
                self.ids.push(id.to_string());
                self.ids.len() as u32
            }
        }
    }

    fn label_ids(&mut self) -> Result<&HashMap<String, String>> {
        if self.labels.is_none() {
            let mut map = HashMap::new();
            for l in self.get("labels", &[])?["labels"]
                .as_array()
                .into_iter()
                .flatten()
            {
                if let (Some(name), Some(id)) = (l["name"].as_str(), l["id"].as_str()) {
                    map.insert(name.to_string(), id.to_string());
                }
            }
            self.labels = Some(map);
        }
        Ok(self.labels.as_ref().expect("just made"))
    }

    /// Message ids, page by page.
    fn list(&mut self, query: &[(&str, &str)]) -> Result<Vec<u32>> {
        let mut out = Vec::new();
        let mut page: Option<String> = None;
        loop {
            let mut q = query.to_vec();
            q.push(("maxResults", "500"));
            if let Some(p) = &page {
                q.push(("pageToken", p));
            }
            let v = self.get("messages", &q)?;
            for m in v["messages"].as_array().into_iter().flatten() {
                if let Some(id) = m["id"].as_str() {
                    out.push(self.uid(id));
                }
            }
            page = v["nextPageToken"].as_str().map(String::from);
            if page.is_none() || out.len() >= MAX_RESULTS {
                return Ok(out);
            }
        }
    }

    /// Make a label, and its parents first, so Gmail shows it nested.
    fn make_label(&mut self, name: &str) -> Result<()> {
        let parts: Vec<&str> = name.split('/').collect();
        for i in 1..=parts.len() {
            let path = parts[..i].join("/");
            if self.label_ids()?.contains_key(&path) {
                continue;
            }
            let made = self.send(
                "POST",
                "labels",
                &json!({ "name": path, "labelListVisibility": "labelShow", "messageListVisibility": "show" }),
            )?;
            let id = made["id"].as_str().unwrap_or("").to_string();
            self.labels
                .get_or_insert_with(HashMap::new)
                .insert(path, id);
        }
        Ok(())
    }
}

impl Mailbox for GmailApi {
    fn search(&mut self, search: &Search) -> Result<Vec<u32>> {
        match search {
            Search::Query(q) => self.list(&[("q", q.as_str())]),
            Search::Label(l) => match self.label_ids()?.get(l).cloned() {
                Some(id) => self.list(&[("labelIds", id.as_str())]),
                None => Ok(Vec::new()),
            },
            Search::Thread(t) => {
                let v = match self.get(&format!("threads/{}", to_hex(t)), &[("format", "minimal")])
                {
                    Err(Error::NotFound(_)) => return Ok(Vec::new()),
                    other => other?,
                };
                let ids: Vec<String> = v["messages"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|m| m["id"].as_str().map(String::from))
                    .collect();
                Ok(ids.iter().map(|id| self.uid(id)).collect())
            }
        }
    }

    fn ids(&mut self, uids: &[u32]) -> Result<Vec<(u32, String)>> {
        Ok(uids
            .iter()
            .filter_map(|u| Some((*u, to_decimal(self.ids.get(*u as usize - 1)?))))
            .collect())
    }

    fn fetch(&mut self, uids: &[u32]) -> Result<Vec<(u32, Message)>> {
        let names: HashMap<String, String> = self
            .label_ids()?
            .iter()
            .map(|(name, id)| (id.clone(), name.clone()))
            .collect();
        let mut out = Vec::new();
        for u in uids {
            let Some(id) = self.ids.get(*u as usize - 1).cloned() else {
                continue;
            };
            let v = match self.get(&format!("messages/{id}"), &[("format", "raw")]) {
                Err(Error::NotFound(_)) => continue,
                other => other?,
            };
            let raw = v["raw"].as_str().unwrap_or("");
            let bytes = URL_SAFE
                .decode(raw)
                .or_else(|_| URL_SAFE_NO_PAD.decode(raw.trim_end_matches('=')))
                .unwrap_or_default();
            let Some(mut m) = parse_message(&bytes) else {
                continue;
            };
            m.gm_msgid = Some(to_decimal(&id));
            m.gm_thrid = v["threadId"].as_str().map(to_decimal);
            m.labels = v["labelIds"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|l| l.as_str())
                .map(|l| names.get(l).cloned().unwrap_or_else(|| l.to_string()))
                .collect();
            out.push((*u, m));
        }
        Ok(out)
    }

    fn labels(&mut self) -> Result<Vec<String>> {
        Ok(self.label_ids()?.keys().cloned().collect())
    }

    fn create_label(&mut self, name: &str) -> Result<()> {
        self.make_label(name)
    }

    fn rename_label(&mut self, from: &str, to: &str) -> Result<()> {
        if let Some(parent) = to.rsplit_once('/').map(|(p, _)| p.to_string()) {
            self.make_label(&parent)?;
        }
        let Some(id) = self.label_ids()?.get(from).cloned() else {
            return self.make_label(to);
        };
        self.send("PATCH", &format!("labels/{id}"), &json!({ "name": to }))?;
        if let Some(map) = self.labels.as_mut() {
            map.remove(from);
            map.insert(to.to_string(), id);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_client_file() {
        let c = Client::from_json(
            r#"{"web":{"client_id":"1-abc.apps.googleusercontent.com","project_id":"p","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","client_secret":"s3cret"}}"#,
        )
        .unwrap();
        assert_eq!(c.client_id, "1-abc.apps.googleusercontent.com");
        assert!(Client::from_json(r#"{"web":{"client_id":"x"}}"#).is_err());
        assert!(Client::from_json("{}").is_err());
        let url = c.auth_url(
            "http://127.0.0.1:4848/api/mail/google/callback",
            "st",
            "verifier",
        );
        assert!(url.starts_with(
            "https://accounts.google.com/o/oauth2/auth?client_id=1-abc.apps.googleusercontent.com&"
        ));
        assert!(url.contains(
            "redirect_uri=http%3A%2F%2F127.0.0.1%3A4848%2Fapi%2Fmail%2Fgoogle%2Fcallback"
        ));
        assert!(url.contains("scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.readonly%20"));
        assert!(url.contains("access_type=offline") && url.contains("code_challenge_method=S256"));
        assert!(
            !url.contains("s3cret"),
            "the secret stays out of the browser"
        );
    }

    #[test]
    fn ids_between_api_and_imap() {
        assert_eq!(to_decimal("1a2b3c4d5e6f7081"), "1885667171979194497");
        assert_eq!(to_hex("1885667171979194497"), "1a2b3c4d5e6f7081");
        let a = random_token();
        assert_eq!(a.len(), 43);
        assert_ne!(a, random_token());
    }
}
