//! Experiments: features still being tried out, on only for the accounts
//! named when hunt starts.
//!
//! `hunt serve --experiment name=you@example.com,other@example.com`
//! (or `HUNT_EXPERIMENTS`, experiments separated by `;`) turns an
//! experiment on for those accounts; named without accounts, it's on for
//! everyone. In one person's hunt there are no accounts: an experiment
//! named is on. An experiment that's off isn't there at all: its pages
//! aren't in the sidebar, and its API answers 404.

use crate::error::{Result, invalid};

/// Every experiment hunt has: its name, and what it is. None, for now.
pub const KNOWN: &[(&str, &str)] = &[];

/// Experiments that have become features, for everyone: still taken, so a
/// server started with one keeps starting, but they change nothing.
pub const GRADUATED: &[&str] = &["take-home"];

/// Which experiments are on, and for whom.
#[derive(Debug, Clone, Default)]
pub struct Experiments {
    /// An experiment's name, and the emails it's on for (empty: everyone).
    on: Vec<(String, Vec<String>)>,
}

impl Experiments {
    /// From `--experiment` values: `name` or `name=email,email`. An
    /// experiment hunt doesn't have is refused, so a typo isn't missed.
    pub fn parse(specs: &[String]) -> Result<Experiments> {
        Self::parse_from(specs, KNOWN)
    }

    fn parse_from(specs: &[String], known: &[(&str, &str)]) -> Result<Experiments> {
        let mut on: Vec<(String, Vec<String>)> = Vec::new();
        for spec in specs.iter().map(|s| s.trim()).filter(|s| !s.is_empty()) {
            let (name, who) = spec.split_once('=').unwrap_or((spec, ""));
            let name = name.trim().to_lowercase();
            if GRADUATED.contains(&name.as_str()) {
                continue;
            }
            if !known.iter().any(|(n, _)| *n == name) {
                let names: Vec<_> = known.iter().map(|(n, _)| *n).collect();
                return Err(invalid(format!(
                    "no experiment called {name:?}: {}",
                    if names.is_empty() {
                        "there are none now".to_string()
                    } else {
                        format!("there's {}", names.join(", "))
                    }
                )));
            }
            let emails: Vec<String> = who
                .split(',')
                .map(|e| e.trim().to_lowercase())
                .filter(|e| !e.is_empty())
                .collect();
            match on.iter_mut().find(|(n, _)| *n == name) {
                Some((_, all)) => all.extend(emails),
                None => on.push((name, emails)),
            }
        }
        Ok(Experiments { on })
    }

    /// Whether `name` is on for `email` (None: one person's hunt, with no
    /// accounts).
    pub fn on(&self, name: &str, email: Option<&str>) -> bool {
        self.on.iter().any(|(n, emails)| {
            n == name
                && (emails.is_empty()
                    || email.is_none_or(|e| emails.iter().any(|x| x.eq_ignore_ascii_case(e))))
        })
    }

    /// The experiments on for `email`, by name.
    pub fn for_email(&self, email: Option<&str>) -> Vec<&'static str> {
        KNOWN
            .iter()
            .map(|(n, _)| *n)
            .filter(|n| self.on(n, email))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An experiment, for trying them out.
    const TRY: &str = "try-me";
    const KNOWN: &[(&str, &str)] = &[(TRY, "Something new")];

    fn parse(s: &[&str]) -> Result<Experiments> {
        let specs: Vec<String> = s.iter().map(|s| s.to_string()).collect();
        Experiments::parse_from(&specs, KNOWN)
    }

    #[test]
    fn on_for_the_accounts_named() {
        let x = parse(&["try-me=Me@Example.com, other@example.com"]).unwrap();
        assert!(x.on(TRY, Some("me@example.com")));
        assert!(x.on(TRY, Some("OTHER@example.com")));
        assert!(!x.on(TRY, Some("someone@example.com")));
        // One person's hunt: no accounts, so it's yours.
        assert!(x.on(TRY, None));
    }

    #[test]
    fn named_alone_is_on_for_everyone() {
        let x = parse(&["try-me"]).unwrap();
        assert!(x.on(TRY, Some("anyone@example.com")));
    }

    #[test]
    fn off_unless_named() {
        let x = parse(&[]).unwrap();
        assert!(!x.on(TRY, None));
        assert!(!x.on(TRY, Some("me@example.com")));
    }

    #[test]
    fn named_twice_adds_up() {
        let x = parse(&["try-me=a@example.com", "try-me=b@example.com"]).unwrap();
        assert!(x.on(TRY, Some("a@example.com")));
        assert!(x.on(TRY, Some("b@example.com")));
    }

    #[test]
    fn an_unknown_experiment_is_refused() {
        let e = parse(&["try-mee=me@example.com"]).unwrap_err();
        assert!(e.to_string().contains("try-me"), "{e}");
    }

    #[test]
    fn take_home_pay_has_graduated() {
        // Still taken, so a server started with it keeps starting; it's no
        // longer an experiment.
        let x = Experiments::parse(&["take-home=me@example.com".into()]).unwrap();
        assert!(x.for_email(Some("me@example.com")).is_empty());
        assert!(Experiments::parse(&["nope".into()]).is_err());
    }
}
