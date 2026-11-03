//! Whether a newer hunt has been released, for the sidebar's note by the
//! version. The service asks GitHub for hunt's latest release when it
//! starts and every [`EVERY`] after, in the background; nothing waits on
//! it, and a failed check just leaves the last answer (or none). Turned
//! off with `HUNT_UPDATE_CHECK=off`.

use std::sync::Mutex;
use std::time::Duration;

/// hunt's latest release (not drafts or pre-releases).
const LATEST: &str = "https://api.github.com/repos/ArabesqueLabs/hunt/releases/latest";
/// How often to ask again.
pub const EVERY: Duration = Duration::from_secs(12 * 60 * 60);

/// The latest release's version, as last heard (without the tag's `v`).
static HEARD: Mutex<Option<String>> = Mutex::new(None);

/// Whether this hunt checks for releases (it does, unless told not to).
pub fn enabled() -> bool {
    !std::env::var("HUNT_UPDATE_CHECK").is_ok_and(|v| {
        matches!(
            v.trim().to_ascii_lowercase().as_str(),
            "off" | "false" | "0" | "no"
        )
    })
}

/// Ask GitHub for the latest release, and remember it.
pub fn check() {
    let Ok(j) = crate::lookup::get_json(LATEST) else {
        return;
    };
    if let Some(tag) = j["tag_name"].as_str() {
        let v = tag.trim().trim_start_matches('v').to_string();
        if parse(&v).is_some() {
            *HEARD.lock().unwrap_or_else(|e| e.into_inner()) = Some(v);
        }
    }
}

/// The latest release, if it's newer than this hunt.
pub fn newer() -> Option<String> {
    let heard = HEARD.lock().unwrap_or_else(|e| e.into_inner()).clone()?;
    is_newer(&heard, env!("CARGO_PKG_VERSION")).then_some(heard)
}

/// `major.minor.patch`, as numbers (a pre-release's suffix dropped).
fn parse(v: &str) -> Option<(u64, u64, u64)> {
    let core = v.split(['-', '+']).next()?;
    let mut parts = core.split('.').map(|p| p.parse::<u64>().ok());
    let major = parts.next()??;
    let minor = parts.next().unwrap_or(Some(0))?;
    let patch = parts.next().unwrap_or(Some(0))?;
    Some((major, minor, patch))
}

fn is_newer(latest: &str, current: &str) -> bool {
    match (parse(latest), parse(current)) {
        (Some(l), Some(c)) => l > c,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_higher_version_is_newer() {
        assert!(is_newer("0.24.0", "0.23.1"));
        assert!(is_newer("1.0.0", "0.99.9"));
        assert!(is_newer("0.23.10", "0.23.9"));
        assert!(!is_newer("0.23.1", "0.23.1"));
        assert!(!is_newer("0.23.0", "0.23.1"));
        assert!(!is_newer("nonsense", "0.23.1"));
        assert!(is_newer("0.24", "0.23.1"));
    }
}
