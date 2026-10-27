//! What a hunt says about itself: where its website is (the docs, and the
//! privacy notice and terms of use people agree to), who runs it, and where
//! its source is; and the footer under its pages.
//!
//! hunt is free software (the GNU AGPL v3), made by Arabesque Labs, who also
//! run it for others. Their website, careerhunt.app, is kept apart from hunt,
//! with their other websites: it has the docs, screenshots and legal pages.
//! A hunt run for others names its website with `HUNT_SITE_URL`, and people
//! agree to its terms when they ask for an account. Without one, as for
//! someone running hunt for themselves, the footer links to the docs on
//! GitHub. Either way it links to the source, as the AGPL asks of a service
//! people use over a network.

use crate::error::Result;

/// The version of the terms of use people agree to: the date on the
/// website's terms (careerhunt.app's, for Arabesque Labs' hunt), kept with
/// an account when its holder agrees. Change it when they change.
pub const UPDATED: &str = "2026-10-08";
/// Where hunt's source is: the footer's link, unless `HUNT_SOURCE_URL` (a
/// changed copy's, say) is set.
pub const SOURCE: &str = "https://github.com/ArabesqueLabs/hunt";
/// When hunt was first published, for its copyright line.
const FIRST_YEAR: i16 = 2026;

#[derive(Debug, Clone)]
pub struct Site {
    /// The website with the docs and the legal pages (`/privacy/`, `/terms/`,
    /// `/data-deletion/`, and in Arabic under `/ar/`), without a trailing
    /// `/`: set for a hunt run for others, whose terms people agree to.
    pub url: Option<String>,
    /// Who runs this hunt, as its pages name them ("Arabesque Labs Ltd").
    pub operator: Option<String>,
    pub source: String,
}

impl Default for Site {
    /// Someone's own hunt: no website, nobody named, hunt's own source.
    fn default() -> Self {
        Site {
            url: None,
            operator: None,
            source: SOURCE.into(),
        }
    }
}

impl Site {
    /// From the environment: `HUNT_SITE_URL` (the website), `HUNT_OPERATOR`
    /// (who runs this hunt) and `HUNT_SOURCE_URL` (where a changed copy's
    /// source is), each optional.
    pub fn from_env() -> Result<Self> {
        let var = |name: &str| {
            std::env::var(name)
                .ok()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        };
        if var("HUNT_LEGAL_COMPANY").is_some() && var("HUNT_SITE_URL").is_none() {
            return Err(crate::error::invalid(
                "HUNT_LEGAL_COMPANY is set, but hunt no longer serves the legal pages: \
                 set HUNT_SITE_URL to the website that has them (and HUNT_OPERATOR to \
                 the company's name), and drop HUNT_LEGAL_*",
            ));
        }
        Ok(Site {
            url: var("HUNT_SITE_URL").map(|u| u.trim_end_matches('/').to_string()),
            operator: var("HUNT_OPERATOR"),
            source: var("HUNT_SOURCE_URL").unwrap_or_else(|| SOURCE.into()),
        })
    }

    /// Where a page of the website is (`path` like "/terms/"), or, without a
    /// website, none.
    pub fn page(&self, path: &str) -> Option<String> {
        self.url.as_ref().map(|u| format!("{u}{path}"))
    }

    /// The docs: on the website, or the README on GitHub.
    pub fn docs(&self) -> String {
        self.page("/docs/")
            .unwrap_or_else(|| format!("https://careerhunt.app/docs/"))
    }

    /// The footer under the app's pages: who made hunt, the docs and the
    /// source; with a website, its privacy notice and terms too. In English:
    /// the app's own translation turns it to the person's language.
    pub fn footer(&self) -> String {
        let year = jiff::Zoned::now().year().max(FIRST_YEAR);
        let years = if year > FIRST_YEAR {
            format!("{FIRST_YEAR}–{year}")
        } else {
            year.to_string()
        };
        let link = |href: &str, words: &str| {
            format!(
                r#"<li><a href="{}" target="_blank" rel="noopener">{words}</a></li>"#,
                escape(href)
            )
        };
        let mut links = vec![link(&self.docs(), "Docs")];
        if self.url.is_some() {
            for (path, words) in [
                ("/privacy/", "Privacy notice"),
                ("/terms/", "Terms of use"),
                ("/privacy/#cookies", "Cookies"),
            ] {
                links.extend(self.page(path).map(|href| link(&href, words)));
            }
        }
        links.push(link(&self.source, "Source code"));
        include_str!("web/footer.html")
            .replace("{{links}}", &links.join("\n      "))
            .replace("{{years}}", &years)
    }
}

/// Text made safe to put in HTML, in an attribute too.
fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn someones_own_hunt_links_the_docs_and_source_on_github() {
        let footer = Site::default().footer();
        assert!(!footer.contains("{{"));
        assert!(!footer.contains("/privacy"));
        assert!(footer.contains(&format!(r#"href="{SOURCE}#readme""#)));
        assert!(footer.contains(&format!(r#"href="{SOURCE}""#)));
        assert!(footer.contains("GNU AGPL"));
        assert!(footer.contains("Made with"));
    }

    #[test]
    fn a_hunt_run_for_others_links_its_websites_pages() {
        let site = Site {
            url: Some("https://careerhunt.app".into()),
            operator: Some("Arabesque Labs Ltd".into()),
            ..Site::default()
        };
        let footer = site.footer();
        for page in ["/docs/", "/privacy/", "/terms/", "/privacy/#cookies"] {
            assert!(
                footer.contains(&format!(r#"href="https://careerhunt.app{page}""#)),
                "{page}"
            );
        }
        assert!(footer.contains(SOURCE));
    }

    #[test]
    fn the_arabic_docs_keep_up_with_the_english() {
        // careerhunt.app shows both as its docs: the same sections, in each.
        let sections = |readme: &str| readme.lines().filter(|l| l.starts_with("## ")).count();
        assert_eq!(
            sections(include_str!("../README.ar.md")),
            sections(include_str!("../README.md")),
            "README.ar.md has a section more or fewer than README.md"
        );
    }

    #[test]
    fn each_web_ui_page_is_in_both_languages() {
        // careerhunt.app shows docs/web-ui/'s pages, in index.json's order,
        // under The web UI: each in English and in Arabic.
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("docs/web-ui");
        let pages: Vec<String> =
            serde_json::from_str(include_str!("../docs/web-ui/index.json")).unwrap();
        for page in pages {
            for file in [format!("{page}.md"), format!("{page}.ar.md")] {
                assert!(dir.join(&file).is_file(), "docs/web-ui/{file} is missing");
            }
        }
    }
}
