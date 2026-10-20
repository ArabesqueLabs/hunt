//! Signing in without Cloudflare: a password for one person's hunt, and the
//! addresses a sign-in proxy's header is taken from, for several people's.
//!
//! **A password** (`HUNT_PASSWORD`): the app and its API need signing in,
//! at /login. Signing in sets a cookie, good for 30 days: its expiry, signed
//! with a key made from the password, so changing the password signs
//! everyone out. The CLI sends the password itself (`Authorization: Bearer`,
//! from its own `HUNT_PASSWORD`). A wrong one costs a second.
//!
//! **A sign-in proxy** (`HUNT_AUTH_HEADER`): Authelia, Authentik,
//! oauth2-proxy or Tailscale signs people in, and names them in a header
//! (`Remote-Email`, say); hunt takes it only from the proxy's addresses
//! (`HUNT_TRUSTED_PROXIES`, this machine unless said), so nobody reaching
//! hunt another way can claim to be anyone. See [`crate::tenants`].

use std::net::IpAddr;

use sha2::{Digest, Sha256};

use crate::error::{Error, Result};

/// The sign-in cookie.
pub const COOKIE: &str = "hunt_session";
/// How long signing in lasts.
pub const SESSION_DAYS: i64 = 30;

/// One person's hunt's password, and the key its sessions are signed with.
pub struct Password {
    password: String,
    key: [u8; 32],
}

impl Password {
    pub fn new(password: &str) -> Result<Password> {
        if password.chars().count() < 8 {
            return Err(Error::Invalid(
                "HUNT_PASSWORD is too short: give it 8 characters or more".into(),
            ));
        }
        Ok(Password {
            password: password.to_string(),
            key: Sha256::digest(format!("hunt session key\n{password}")).into(),
        })
    }

    /// Whether `given` is the password (in constant time).
    pub fn matches(&self, given: &str) -> bool {
        same(
            &Sha256::digest(given.as_bytes()),
            &Sha256::digest(self.password.as_bytes()),
        )
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

/// The sign-in page: the password, and where to go after.
pub fn login_page(next: &str, wrong: bool) -> String {
    include_str!("web/login.html")
        .replace(
            "{{next}}",
            &next
                .replace('&', "&amp;")
                .replace('"', "&quot;")
                .replace('<', "&lt;"),
        )
        .replace(
            "{{error}}",
            if wrong {
                r#"<p class="al-error" id="login-error" role="alert">That isn't the password.</p>"#
            } else {
                ""
            },
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

    #[test]
    fn a_session_is_good_till_it_ends_and_only_with_its_password() {
        let p = Password::new("correct horse").unwrap();
        let s = p.session(1_000);
        assert!(p.valid(&s, 999));
        assert!(!p.valid(&s, 1_000), "ended");
        assert!(
            !p.valid(&s.replace("1000.", "9999."), 999),
            "a later end, unsigned"
        );
        assert!(
            !Password::new("another one").unwrap().valid(&s, 999),
            "another password"
        );
        assert!(!p.valid("nonsense", 0));
        assert!(p.matches("correct horse"));
        assert!(!p.matches("correct horsE"));
        assert!(Password::new("short").is_err());
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
