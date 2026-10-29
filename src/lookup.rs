//! Importing what a company's website or LinkedIn page says about it.
//!
//! The page is fetched by the service and read for, in order of trust:
//! schema.org `Organization` data (JSON-LD, which many sites embed for
//! search engines), Open Graph and meta tags, the page title, and on
//! LinkedIn, the "About" details of a public company page. Nothing is
//! saved here; the caller decides what to keep.
//!
//! LinkedIn often refuses pages to anything but a signed-in browser. When it
//! does, that's reported as such, so the person can try the company's own
//! site instead.

use std::time::Duration;

use scraper::{Html, Selector};
use serde::Serialize;
use serde_json::Value;

use crate::error::{Error, Result, invalid};

/// What a page says about a company. Anything not found is `None`.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize)]
pub struct Found {
    pub name: Option<String>,
    pub website: Option<String>,
    pub linkedin: Option<String>,
    pub description: Option<String>,
    pub industry: Option<String>,
    pub size: Option<String>,
    pub headquarters: Option<String>,
    pub founded: Option<String>,
    /// Where its logo is: an image's address.
    pub logo: Option<String>,
    /// The page read, after any redirects.
    pub source: String,
}

/// The most read from a page.
const MAX_PAGE: u64 = 5 * 1024 * 1024;
/// Sites answer browsers; some turn other agents away.
const AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) \
                     Chrome/126.0 Safari/537.36";

/// Fetch a page and read what it says about the company.
pub fn fetch(url: &str) -> Result<Found> {
    let page = get_page(url)?;
    // levels.fyi's company pages carry the company as data for their scripts.
    if host_of(&page.url).ends_with("levels.fyi") && page.url.contains("/companies/") {
        return crate::posting::next_data(&page.text())
            .and_then(|d| levels_company(&d["props"]["pageProps"]["company"], &page.url))
            .ok_or_else(|| {
                Error::Fetch(format!("{} didn't have the company's details", page.url))
            });
    }
    let found = extract(&page.text(), &page.url);
    if found
        == (Found {
            source: found.source.clone(),
            ..Found::default()
        })
    {
        return Err(Error::Fetch(format!(
            "nothing about a company could be read from {}",
            page.url
        )));
    }
    Ok(found)
}

/// A fetched page or document.
pub(crate) struct Page {
    /// Where it was found, after redirects.
    pub url: String,
    pub body: Vec<u8>,
}

impl Page {
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }

    pub fn json(&self) -> Result<Value> {
        serde_json::from_slice(&self.body)
            .map_err(|_| Error::Fetch(format!("{} didn't answer with JSON", self.url)))
    }
}

/// Fetch a web page: HTML only, a successful status, no sign-in walls.
pub(crate) fn get_page(url: &str) -> Result<Page> {
    let url = normalize_url(url)?;
    let (page, kind) = get(&url, "text/html,application/xhtml+xml")?;
    if !kind.is_empty() && !kind.contains("html") {
        return Err(Error::Fetch(format!("{url} isn't a web page ({kind})")));
    }
    Ok(page)
}

/// The largest image fetched, as a logo.
pub(crate) const MAX_IMAGE: usize = 2 * 1024 * 1024;

/// Fetch an image: its bytes and type, checked by what's in it.
pub(crate) fn get_image(url: &str) -> Result<(Vec<u8>, &'static str)> {
    let url = normalize_url(url)?;
    let (page, declared) = get(&url, "image/*")?;
    if page.body.len() > MAX_IMAGE {
        return Err(Error::Fetch(format!("{url} is too big for a logo")));
    }
    let kind = crate::files::image_type(&page.body, &declared)
        .ok_or_else(|| Error::Fetch(format!("{url} isn't an image")))?;
    Ok((page.body, kind))
}

/// Fetch a JSON document from an API.
pub(crate) fn get_json(url: &str) -> Result<Value> {
    get(url, "application/json")?.0.json()
}

/// Fetch anything; returns the page and its content type. Redirects are
/// followed here rather than by the client, so a redirect's own body is
/// never read: some servers send malformed ones.
fn get(url: &str, accept: &str) -> Result<(Page, String)> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(15)))
        .http_status_as_error(false)
        .max_redirects(0)
        .user_agent(AGENT)
        .build()
        .into();
    let mut landed = url.to_string();
    let mut hops = 0;
    let mut res = loop {
        let res = agent
            .get(&landed)
            .header("Accept", accept)
            .header("Accept-Language", "en")
            .call()
            .map_err(|e| {
                // Say what went wrong in a few words, not the network stack's.
                let host = host_of(&landed);
                Error::Fetch(match e {
                    ureq::Error::HostNotFound => format!("couldn't find {host}"),
                    ureq::Error::Io(ref io) if io.to_string().contains("lookup address") => {
                        format!("couldn't find {host}")
                    }
                    ureq::Error::Io(_) | ureq::Error::ConnectionFailed => {
                        format!("couldn't reach {host}")
                    }
                    ureq::Error::Timeout(_) => format!("{host} took too long to answer"),
                    e => format!("couldn't fetch {landed}: {e}"),
                })
            })?;
        let next = res
            .status()
            .is_redirection()
            .then(|| res.headers().get("location").and_then(|l| l.to_str().ok()))
            .flatten()
            .map(|l| resolve(&landed, l));
        match next {
            Some(next) if hops < 8 => {
                hops += 1;
                landed = next;
            }
            Some(_) => return Err(Error::Fetch(format!("{url} redirects too many times"))),
            None => break res,
        }
    };
    let status = res.status().as_u16();
    if host_of(url).ends_with("linkedin.com")
        && (status == 999 || landed.contains("authwall") || landed.contains("/login"))
    {
        return Err(Error::Fetch(
            "LinkedIn wouldn't show that page without signing in. For a profile, open it \
             in your browser and use the hunt extension (Settings → Connected apps); \
             otherwise try another source, or fill the details in by hand."
                .into(),
        ));
    }
    if !(200..300).contains(&status) {
        return Err(Error::Fetch(format!("{url} answered {status}")));
    }
    let kind = res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    let body = res
        .body_mut()
        .with_config()
        .limit(MAX_PAGE)
        .read_to_vec()
        .map_err(|e| Error::Fetch(format!("couldn't read {url}: {e}")))?;
    Ok((Page { url: landed, body }, kind))
}

/// Read a page for what it says about a company. `url` is where it came from.
pub fn extract(html: &str, url: &str) -> Found {
    let doc = Html::parse_document(html);
    let on_linkedin = host_of(url).ends_with("linkedin.com");
    let org = organization(&doc);
    let meta = |key: &str| -> Option<String> {
        ["property", "name"].iter().find_map(|attr| {
            let sel = Selector::parse(&format!("meta[{attr}='{key}']")).ok()?;
            doc.select(&sel)
                .filter_map(|e| e.value().attr("content"))
                .map(clean)
                .find(|v| !v.is_empty())
        })
    };
    let text = |css: &str| -> Option<String> {
        let sel = Selector::parse(css).ok()?;
        doc.select(&sel)
            .map(|e| clean(&e.text().collect::<String>()))
            .find(|v| !v.is_empty())
    };
    let attr = |css: &str, name: &str| -> Option<String> {
        let sel = Selector::parse(css).ok()?;
        doc.select(&sel)
            .filter_map(|e| e.value().attr(name))
            .map(clean)
            .find(|v| !v.is_empty())
    };
    let org_str = |key: &str| {
        org.as_ref()
            .and_then(|o| o.get(key))
            .and_then(Value::as_str)
            .map(clean)
    };
    let same_as: Vec<String> = match org.as_ref().and_then(|o| o.get("sameAs")) {
        Some(Value::String(s)) => vec![s.clone()],
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(Value::as_str)
            .map(String::from)
            .collect(),
        _ => vec![],
    };
    // LinkedIn's public company pages list their details as "about-us__…".
    let about = |key: &str| text(&format!("[data-test-id='about-us__{key}'] dd"));

    let mut f = Found {
        source: url.to_string(),
        ..Found::default()
    };

    let title = text("title").or_else(|| meta("og:title"));
    f.name = org_str("name")
        .or_else(|| (!on_linkedin).then(|| meta("og:site_name")).flatten())
        .or_else(|| on_linkedin.then(|| text("h1")).flatten())
        .or_else(|| title.as_deref().and_then(name_from_title));

    let page_url = attr("link[rel='canonical']", "href")
        .or_else(|| meta("og:url"))
        .unwrap_or_else(|| url.to_string());
    if on_linkedin {
        f.linkedin = linkedin_company(&page_url).or_else(|| linkedin_company(url));
        // The link, not its text: the text carries hidden words for screen readers.
        f.website = attr("[data-test-id='about-us__website'] a", "href")
            .or_else(|| {
                about("website").and_then(|t| t.split_whitespace().next().map(String::from))
            })
            .or_else(|| {
                same_as
                    .iter()
                    .find(|u| !host_of(u).ends_with("linkedin.com"))
                    .cloned()
            })
            .or_else(|| org_str("url").filter(|u| !host_of(u).ends_with("linkedin.com")))
            .map(|u| website_of(&unwrap_redirect(&u)));
    } else {
        f.website = Some(website_of(&page_url));
        f.linkedin = same_as
            .iter()
            .find_map(|u| linkedin_company(u))
            .or_else(|| {
                let sel = Selector::parse("a[href*='linkedin.com/company/']").ok()?;
                doc.select(&sel)
                    .filter_map(|e| e.value().attr("href"))
                    .find_map(linkedin_company)
            });
    }

    f.description = (if on_linkedin {
        text("[data-test-id='about-us__description']")
            .or_else(|| meta("og:description").map(|d| strip_linkedin_followers(&d)))
            .or_else(|| org_str("description"))
    } else {
        org_str("description")
            .or_else(|| meta("og:description"))
            .or_else(|| meta("description"))
    })
    .map(|d| truncate(&d, 2000));

    f.industry = about("industry").or_else(|| org_str("industry"));
    f.size = about("size").or_else(|| org.as_ref().and_then(employees));
    f.headquarters = about("headquarters").or_else(|| org.as_ref().and_then(address));
    f.founded = about("foundedOn").or_else(|| org_str("foundingDate"));

    // The logo: the organisation's own, a touch icon (square, and large
    // enough), LinkedIn's company image, or failing those the site's icon.
    let org_logo = org.as_ref().and_then(|o| match o.get("logo")? {
        Value::String(s) => Some(s.clone()),
        Value::Object(l) => l
            .get("url")
            .or_else(|| l.get("contentUrl"))
            .and_then(Value::as_str)
            .map(String::from),
        _ => None,
    });
    let icon = || {
        let sel = Selector::parse("link[rel~='icon'], link[rel='shortcut icon']").ok()?;
        doc.select(&sel)
            .filter_map(|e| {
                let href = e.value().attr("href")?;
                let size: u32 = e
                    .value()
                    .attr("sizes")
                    .and_then(|s| s.split(['x', 'X']).next())
                    .and_then(|n| n.parse().ok())
                    .unwrap_or(if href.ends_with(".svg") { 512 } else { 16 });
                Some((size, href.to_string()))
            })
            .max_by_key(|(size, _)| *size)
            .map(|(_, href)| href)
    };
    f.logo = org_logo
        .or_else(|| attr("link[rel~='apple-touch-icon']", "href"))
        .or_else(|| {
            on_linkedin
                .then(|| {
                    attr("img.top-card-layout__entity-image", "src")
                        .or_else(|| attr("img.top-card-layout__entity-image", "data-delayed-url"))
                        .or_else(|| meta("og:image"))
                })
                .flatten()
        })
        .or_else(icon)
        .map(|href| resolve(url, &href));
    f
}

/// A company as levels.fyi describes it.
fn levels_company(c: &Value, url: &str) -> Option<Found> {
    let s = |v: &Value| v.as_str().map(clean).filter(|s| !s.is_empty());
    let name = s(&c["name"])?;
    let hq = [
        s(&c["hq_city"]),
        s(&c["hq_state"]).or_else(|| s(&c["hq_state_code"])),
        s(&c["hq_country"]),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(", ");
    Some(Found {
        name: Some(name),
        website: s(&c["website"]).map(|w| website_of(&w)),
        linkedin: s(&c["linkedin"]).and_then(|l| {
            linkedin_company(&l).or_else(|| {
                linkedin_company(&format!(
                    "https://www.linkedin.com/{}",
                    l.trim_start_matches('/')
                ))
            })
        }),
        description: s(&c["description"]).map(|d| truncate(&d, 2000)),
        industry: s(&c["industry"]),
        size: c["emp_count"]
            .as_i64()
            .map(|n| format!("{} employees", group_thousands(n))),
        headquarters: (!hq.is_empty()).then_some(hq),
        founded: c["year_founded"].as_i64().map(|y| y.to_string()),
        logo: s(&c["icon_large"]).or_else(|| s(&c["icon"])),
        source: url.to_string(),
    })
}

fn group_thousands(n: i64) -> String {
    let digits = n.to_string();
    let mut out = String::new();
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(ch);
    }
    out
}

/// The first schema.org organisation described on the page.
fn organization(doc: &Html) -> Option<Value> {
    const KINDS: &[&str] = &[
        "Organization",
        "Corporation",
        "LocalBusiness",
        "OnlineBusiness",
        "NGO",
        "EducationalOrganization",
        "GovernmentOrganization",
        "NewsMediaOrganization",
    ];
    fn find(v: &Value) -> Option<Value> {
        match v {
            Value::Array(items) => items.iter().find_map(find),
            Value::Object(o) => {
                let is_org = match o.get("@type") {
                    Some(Value::String(t)) => KINDS.contains(&t.as_str()),
                    Some(Value::Array(ts)) => ts
                        .iter()
                        .filter_map(Value::as_str)
                        .any(|t| KINDS.contains(&t)),
                    _ => false,
                };
                if is_org {
                    return Some(v.clone());
                }
                o.get("@graph")
                    .and_then(find)
                    .or_else(|| o.get("publisher").and_then(find))
            }
            _ => None,
        }
    }
    let sel = Selector::parse("script[type='application/ld+json']").ok()?;
    doc.select(&sel)
        .filter_map(|e| serde_json::from_str::<Value>(&e.text().collect::<String>()).ok())
        .find_map(|v| find(&v))
}

fn employees(org: &Value) -> Option<String> {
    let n = org.get("numberOfEmployees")?;
    let num = |v: Option<&Value>| -> Option<String> {
        v.and_then(|v| {
            v.as_i64()
                .map(|n| n.to_string())
                .or_else(|| v.as_str().map(String::from))
        })
    };
    match n {
        Value::Object(_) => match (
            num(n.get("value")),
            num(n.get("minValue")),
            num(n.get("maxValue")),
        ) {
            (Some(v), _, _) => Some(format!("{v} employees")),
            (None, Some(a), Some(b)) => Some(format!("{a}–{b} employees")),
            (None, Some(a), None) => Some(format!("{a}+ employees")),
            _ => None,
        },
        v => num(Some(v)).map(|v| format!("{v} employees")),
    }
}

fn address(org: &Value) -> Option<String> {
    let first = |v: &Value| match v {
        Value::Array(a) => a.first().cloned(),
        v => Some(v.clone()),
    };
    let a = first(org.get("address")?)?;
    if let Some(s) = a.as_str() {
        return Some(clean(s));
    }
    let part = |k: &str| match a.get(k) {
        Some(Value::String(s)) => Some(clean(s)),
        Some(Value::Object(o)) => o.get("name").and_then(Value::as_str).map(clean),
        _ => None,
    };
    let parts: Vec<String> = ["addressLocality", "addressRegion", "addressCountry"]
        .iter()
        .filter_map(|k| part(k))
        .filter(|p| !p.is_empty())
        .collect();
    (!parts.is_empty()).then(|| parts.join(", "))
}

// --- people ---------------------------------------------------------------------

/// What a LinkedIn profile says about someone. Anything not found is `None`.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize)]
pub struct FoundPerson {
    pub name: Option<String>,
    /// Their headline, or their current role.
    pub title: Option<String>,
    /// Where they work now.
    pub company: Option<String>,
    pub company_linkedin: Option<String>,
    pub location: Option<String>,
    pub about: Option<String>,
    /// Their profile's address, tidied.
    pub linkedin: Option<String>,
    /// Where their photo is.
    pub photo: Option<String>,
    /// The page read, after any redirects.
    pub source: String,
}

/// `https://www.linkedin.com/in/someone`, from any URL of a profile.
pub(crate) fn linkedin_profile(url: &str) -> Option<String> {
    let u = url.parse::<ureq::http::Uri>().ok()?;
    if !u.host()?.ends_with("linkedin.com") {
        return None;
    }
    let mut segs = u.path().split('/').filter(|s| !s.is_empty());
    match (segs.next(), segs.next()) {
        (Some("in"), Some(slug)) => Some(format!("https://www.linkedin.com/in/{slug}")),
        _ => None,
    }
}

/// What the browser extension collects from a LinkedIn profile open in
/// your browser, where you're signed in. It only collects text; reading it
/// is done here, so when LinkedIn changes its pages, hunt changes, not the
/// extension.
#[derive(Debug, Default, Clone, serde::Deserialize)]
#[serde(default)]
pub struct ProfilePage {
    pub url: String,
    /// The tab's title: "(3) Sam Lee | LinkedIn".
    pub title: String,
    /// The profile's heading: their name.
    pub name: String,
    /// The text of the top card: name, headline, location, buttons…
    pub top: String,
    pub about: String,
    pub experience: String,
    /// The label of the current-company link: "Current company: Acme. Click
    /// to skip to experience card".
    pub company: String,
    pub photo: String,
}

/// Lines of text, tidied, each once (screen readers' copies repeat them).
fn text_lines(s: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for l in s.lines().map(clean).filter(|l| !l.is_empty()) {
        if out.last() != Some(&l) {
            out.push(l);
        }
    }
    out
}

/// A line of a profile's top card that isn't about them: a button, a
/// connection degree, pronouns, a follower count.
fn profile_noise(l: &str) -> bool {
    let lower = l.to_lowercase();
    let lower = lower.trim_start_matches(['·', '•', ' ']);
    const BUTTONS: &[&str] = &[
        "message",
        "follow",
        "following",
        "connect",
        "more",
        "pending",
        "contact info",
        "open to",
        "add profile section",
        "enhance profile",
        "resources",
        "verified",
        "view in sales navigator",
        "visit my website",
        "add section",
        "save to pdf",
    ];
    lower.is_empty()
        || BUTTONS.contains(&lower)
        || lower.starts_with("talks about")
        || lower.contains("followers")
        || lower.contains("connections")
        || lower.contains("mutual connection")
        || lower.contains("degree connection")
        || ["1st", "2nd", "3rd", "3rd+"].contains(&lower)
        || (lower.len() <= 12 && lower.contains('/') && !lower.contains(' '))
}

/// Who a profile is about, from what the bookmark collected.
pub fn person_from_page(p: &ProfilePage) -> Result<FoundPerson> {
    let linkedin = linkedin_profile(&p.url).ok_or_else(|| {
        invalid(
            "open someone's LinkedIn profile (linkedin.com/in/…), then click the bookmark there",
        )
    })?;
    let from_title = {
        let t = clean(&p.title);
        let t = match t.strip_prefix('(').and_then(|r| r.split_once(") ")) {
            Some((n, rest)) if n.chars().all(|c| c.is_ascii_digit() || c == '+') => {
                rest.to_string()
            }
            _ => t,
        };
        t.split(" | ").next().unwrap_or("").to_string()
    };
    let name = Some(clean(&p.name))
        .filter(|n| !n.is_empty())
        .or_else(|| Some(from_title).filter(|n| !n.is_empty() && n != "LinkedIn"))
        .ok_or_else(|| {
            invalid("that page didn't show whose profile it is; let it load, then try again")
        })?;

    let lines: Vec<String> = text_lines(&p.top)
        .into_iter()
        .filter(|l| *l != name)
        .collect();
    let headline = lines.iter().find(|l| !profile_noise(l)).cloned();
    // The location sits just before "Contact info", on its line or the one
    // before.
    let location = lines
        .iter()
        .position(|l| l.to_lowercase().contains("contact info"))
        .and_then(|i| {
            let lower = lines[i].to_lowercase();
            let before = lines[i][..lower.find("contact info").unwrap_or(0)]
                .trim_end_matches(['·', '•', ' '])
                .trim()
                .to_string();
            if before.is_empty() {
                lines[..i].iter().rev().find(|l| !profile_noise(l)).cloned()
            } else {
                Some(before)
            }
        })
        .filter(|l| Some(l) != headline.as_ref());

    // Their current role, from the first entry under Experience.
    let exp: Vec<String> = text_lines(&p.experience)
        .into_iter()
        .filter(|l| !l.eq_ignore_ascii_case("experience"))
        .collect();
    let looks_like_span = |l: &str| {
        let l = l.to_lowercase();
        l.contains(" yr")
            || l.contains(" mo")
            || l.contains("present")
            || l.contains(" - ")
            || l.contains(" – ")
    };
    let (role, role_company) = match exp.as_slice() {
        // Several roles at one company: the company, its span, then roles.
        [company, span, rest @ ..]
            if looks_like_span(span) && !span.contains(" · ")
                || span.to_lowercase().starts_with("full-time ·") =>
        {
            (
                rest.iter()
                    .find(|l| !looks_like_span(l) && !l.contains(" · "))
                    .cloned(),
                Some(company.clone()),
            )
        }
        // One role: its title, then "Company · Full-time".
        [title, company, ..] => (
            Some(title.clone()),
            Some(company.split(" · ").next().unwrap_or(company).to_string()),
        ),
        _ => (None, None),
    };
    let current = p
        .company
        .strip_prefix("Current company: ")
        .map(|c| c.split(". Click").next().unwrap_or(c).trim().to_string())
        .filter(|c| !c.is_empty());
    // A headline like "Staff Engineer at Acme" says both.
    let (head_role, head_company) = match headline.as_deref().and_then(|h| h.rsplit_once(" at ")) {
        Some((r, c)) if !r.contains(" | ") && c.len() < 60 => {
            (Some(r.trim().to_string()), Some(c.trim().to_string()))
        }
        _ => (None, None),
    };
    let company = current.or(role_company).or(head_company);
    let title = role.or(head_role).or(headline);

    let about: Vec<String> = text_lines(&p.about)
        .into_iter()
        .filter(|l| !l.eq_ignore_ascii_case("about"))
        .map(|l| match l.strip_suffix("see more") {
            // Cut short on the page: say so.
            Some(cut) => format!("{}…", cut.trim_end_matches(['…', '.', ' '])),
            None => l,
        })
        .filter(|l| !l.is_empty() && l != "…")
        .collect();
    let about = (!about.is_empty()).then(|| truncate(&about.join("\n"), 2000));
    let photo = Some(p.photo.trim().to_string())
        .filter(|u| u.starts_with("https://") && host_of(u).ends_with("licdn.com"));
    Ok(FoundPerson {
        name: Some(name),
        title,
        company,
        company_linkedin: None,
        location,
        about,
        linkedin: Some(linkedin.clone()),
        photo,
        source: linkedin,
    })
}

/// Fetch a LinkedIn profile and read who it's about.
pub fn fetch_person(url: &str) -> Result<FoundPerson> {
    let url = normalize_url(url)?;
    let profile = linkedin_profile(&url)
        .ok_or_else(|| invalid("give a LinkedIn profile's address: linkedin.com/in/…"))?;
    let page = get_page(&profile)?;
    let found = extract_person(&page.text(), &page.url);
    if found.name.is_none() {
        return Err(Error::Fetch(
            "LinkedIn didn't show that profile without signing in. Fill the details in by hand."
                .into(),
        ));
    }
    Ok(found)
}

/// Read a profile page: its schema.org `Person` data, or failing that its
/// title ("Name - Headline | LinkedIn") and description.
pub fn extract_person(html: &str, url: &str) -> FoundPerson {
    let doc = Html::parse_document(html);
    let meta = |key: &str| -> Option<String> {
        let sel = Selector::parse(&format!("meta[property='{key}'], meta[name='{key}']")).ok()?;
        doc.select(&sel)
            .filter_map(|e| e.value().attr("content"))
            .map(clean)
            .find(|v| !v.is_empty())
    };
    fn find_person(v: &Value) -> Option<Value> {
        match v {
            Value::Array(a) => a.iter().find_map(find_person),
            Value::Object(o) => {
                if o.get("@type").and_then(Value::as_str) == Some("Person") {
                    Some(v.clone())
                } else {
                    o.get("@graph").and_then(find_person)
                }
            }
            _ => None,
        }
    }
    let person = Selector::parse("script[type='application/ld+json']")
        .ok()
        .and_then(|sel| {
            doc.select(&sel)
                .filter_map(|e| serde_json::from_str::<Value>(&e.text().collect::<String>()).ok())
                .find_map(|v| find_person(&v))
        });
    let p = person.unwrap_or(Value::Null);
    let text = |v: &Value| -> Option<String> {
        match v {
            Value::String(s) => Some(clean(s)).filter(|s| !s.is_empty()),
            Value::Array(a) => a
                .iter()
                .find_map(|x| x.as_str().map(clean).filter(|s| !s.is_empty())),
            _ => None,
        }
    };
    // "Satya Nadella - Chairman and CEO at Microsoft | LinkedIn"
    let (title_name, headline) = meta("og:title")
        .map(|t| {
            let t = t.trim_end_matches(" | LinkedIn").to_string();
            match t.split_once(" - ") {
                Some((name, headline)) => (
                    Some(name.trim().to_string()),
                    Some(headline.trim().to_string()),
                ),
                None => (Some(t), None),
            }
        })
        .unwrap_or((None, None));
    let job = match &p["worksFor"] {
        Value::Array(a) => a.first().cloned().unwrap_or(Value::Null),
        v => v.clone(),
    };
    let address = &p["address"];
    let location = text(&address["addressLocality"])
        .or_else(|| text(&job["location"]))
        .or_else(|| text(&address["addressCountry"]));
    let photo = match &p["image"] {
        Value::String(s) => Some(s.clone()),
        Value::Object(o) => o
            .get("contentUrl")
            .or_else(|| o.get("url"))
            .and_then(Value::as_str)
            .map(String::from),
        _ => None,
    }
    .or_else(|| meta("og:image"));
    FoundPerson {
        name: text(&p["name"]).or(title_name),
        title: headline.or_else(|| text(&p["jobTitle"])),
        company: text(&job["name"]),
        company_linkedin: job["url"].as_str().and_then(linkedin_company),
        location,
        about: text(&p["description"])
            .or_else(|| meta("og:description"))
            .map(|d| truncate(&d, 2000)),
        linkedin: linkedin_profile(url).or_else(|| p["url"].as_str().and_then(linkedin_profile)),
        photo: photo.filter(|u| u.starts_with("http")),
        source: url.to_string(),
    }
}

/// A company's name from a page title: "Home | Acme" or "Acme – Widgets for all".
fn name_from_title(title: &str) -> Option<String> {
    let title = title
        .trim_end_matches(" | LinkedIn")
        .trim_end_matches(" - LinkedIn");
    let mut parts: Vec<&str> = vec![title];
    for sep in [" | ", " - ", " – ", " — ", " · ", ": ", " \\ ", " / "] {
        parts = parts.iter().flat_map(|p| p.split(sep)).collect();
    }
    parts
        .into_iter()
        .map(str::trim)
        .filter(|p| {
            !p.is_empty()
                && !matches!(
                    p.to_lowercase().as_str(),
                    "home" | "homepage" | "home page" | "welcome"
                )
        })
        .min_by_key(|p| p.len())
        .map(String::from)
}

/// Where a redirect's `Location` points, from the page that sent it.
fn resolve(base: &str, location: &str) -> String {
    if location.contains("://") {
        return location.to_string();
    }
    let origin = website_of(base);
    if location.starts_with("//") {
        let scheme = origin.split("://").next().unwrap_or("https");
        return format!("{scheme}:{location}");
    }
    if location.starts_with('/') {
        return format!("{origin}{location}");
    }
    let dir = base.rsplit_once('/').map_or(base, |(d, _)| d);
    format!("{dir}/{location}")
}

/// The site's front door: scheme and host.
pub(crate) fn website_of(url: &str) -> String {
    match url.parse::<ureq::http::Uri>() {
        Ok(u) if u.host().is_some() => {
            let host = u.authority().map_or("", |a| a.as_str());
            let host = host.rsplit('@').next().unwrap_or(host);
            format!("{}://{host}", u.scheme_str().unwrap_or("https"))
        }
        _ => url.to_string(),
    }
}

/// LinkedIn wraps outbound links in a redirect; take the real address.
pub(crate) fn unwrap_redirect(url: &str) -> String {
    if host_of(url).ends_with("linkedin.com")
        && let Some(q) = url
            .split_once("url=")
            .map(|(_, q)| q.split('&').next().unwrap_or(q))
    {
        return percent_decode(q);
    }
    url.to_string()
}

/// `https://www.linkedin.com/company/acme`, from any URL of a company page.
pub(crate) fn linkedin_company(url: &str) -> Option<String> {
    let u = url.parse::<ureq::http::Uri>().ok()?;
    if !u.host()?.ends_with("linkedin.com") {
        return None;
    }
    let mut segs = u.path().split('/').filter(|s| !s.is_empty());
    match (segs.next(), segs.next()) {
        (Some(kind @ ("company" | "school" | "showcase")), Some(slug)) => {
            Some(format!("https://www.linkedin.com/{kind}/{slug}"))
        }
        _ => None,
    }
}

/// "Acme | 12,345 followers on LinkedIn. Widgets for all." → "Widgets for all."
fn strip_linkedin_followers(d: &str) -> String {
    match d.split_once(" on LinkedIn.") {
        Some((_, rest)) if !rest.trim().is_empty() => rest.trim().to_string(),
        _ => d.to_string(),
    }
}

/// Accept `acme.com` as well as `https://acme.com/about`.
pub fn normalize_url(url: &str) -> Result<String> {
    let url = url.trim();
    if url.is_empty() {
        return Err(invalid("give a website or LinkedIn address"));
    }
    let url = if url.contains("://") {
        url.to_string()
    } else {
        format!("https://{url}")
    };
    let u = url
        .parse::<ureq::http::Uri>()
        .map_err(|_| invalid(format!("not a web address: {url:?}")))?;
    match (u.scheme_str(), u.host()) {
        (Some("http" | "https"), Some(h))
            if h.contains('.') || h == "localhost" || h.parse::<std::net::IpAddr>().is_ok() =>
        {
            Ok(url)
        }
        _ => Err(invalid(format!("not a web address: {url:?}"))),
    }
}

pub(crate) fn host_of(url: &str) -> String {
    url.parse::<ureq::http::Uri>()
        .ok()
        .and_then(|u| u.host().map(str::to_lowercase))
        .unwrap_or_default()
}

pub(crate) fn clean(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(crate) fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    format!("{}…", s.chars().take(max).collect::<String>().trim_end())
}

pub(crate) fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16)
        {
            out.push(b);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_company_site_with_structured_data() {
        let html = r#"<html><head>
            <title>Home | Fathom</title>
            <link rel="canonical" href="https://www.fathom.io/about">
            <meta property="og:site_name" content="Fathom">
            <meta name="description" content="Meeting notes, done for you.">
            <script type="application/ld+json">{"@context":"https://schema.org","@graph":[
              {"@type":"WebSite","name":"Fathom website"},
              {"@type":["Organization","Corporation"],"name":"Fathom Video",
               "description":"AI meeting assistant.",
               "sameAs":["https://twitter.com/fathom","https://www.linkedin.com/company/fathom-video/about/"],
               "numberOfEmployees":{"@type":"QuantitativeValue","minValue":51,"maxValue":200},
               "foundingDate":"2020",
               "address":{"@type":"PostalAddress","addressLocality":"San Francisco","addressRegion":"CA","addressCountry":{"@type":"Country","name":"US"}}}
            ]}</script>
            </head><body><h1>Never take notes again</h1></body></html>"#;
        let f = extract(html, "https://fathom.io/");
        assert_eq!(f.name.as_deref(), Some("Fathom Video"));
        assert_eq!(f.website.as_deref(), Some("https://www.fathom.io"));
        assert_eq!(
            f.linkedin.as_deref(),
            Some("https://www.linkedin.com/company/fathom-video")
        );
        assert_eq!(f.description.as_deref(), Some("AI meeting assistant."));
        assert_eq!(f.size.as_deref(), Some("51–200 employees"));
        assert_eq!(f.headquarters.as_deref(), Some("San Francisco, CA, US"));
        assert_eq!(f.founded.as_deref(), Some("2020"));
    }

    #[test]
    fn a_plain_site_with_only_tags() {
        let html = r#"<html><head><title>Ashby – All-in-one recruiting software</title>
            <meta property="og:description" content="  Ashby is the   ATS for ambitious teams. ">
            </head><body><footer><a href="https://linkedin.com/company/ashbyhq">LinkedIn</a></footer></body></html>"#;
        let f = extract(html, "https://www.ashbyhq.com/blog/x");
        assert_eq!(f.name.as_deref(), Some("Ashby"));
        assert_eq!(f.website.as_deref(), Some("https://www.ashbyhq.com"));
        assert_eq!(
            f.linkedin.as_deref(),
            Some("https://www.linkedin.com/company/ashbyhq")
        );
        assert_eq!(
            f.description.as_deref(),
            Some("Ashby is the ATS for ambitious teams.")
        );
        assert_eq!(f.industry, None);
    }

    #[test]
    fn a_linkedin_company_page() {
        let html = r#"<html><head><title>Perplexity | LinkedIn</title>
            <meta property="og:description" content="Perplexity | 512,345 followers on LinkedIn. Where knowledge begins.">
            <link rel="canonical" href="https://www.linkedin.com/company/perplexity-ai">
            </head><body><h1>Perplexity</h1>
            <p data-test-id="about-us__description">Perplexity is an AI-powered answer engine.</p>
            <dl>
              <div data-test-id="about-us__website"><dt>Website</dt><dd><a href="https://www.linkedin.com/redir/redirect?url=https%3A%2F%2Fwww%2Eperplexity%2Eai&amp;urlhash=x">https://www.perplexity.ai</a></dd></div>
              <div data-test-id="about-us__industry"><dt>Industry</dt><dd>Software Development</dd></div>
              <div data-test-id="about-us__size"><dt>Company size</dt><dd>201-500 employees</dd></div>
              <div data-test-id="about-us__headquarters"><dt>Headquarters</dt><dd>San Francisco, California</dd></div>
              <div data-test-id="about-us__foundedOn"><dt>Founded</dt><dd>2022</dd></div>
            </dl></body></html>"#;
        let f = extract(
            html,
            "https://www.linkedin.com/company/perplexity-ai/about/",
        );
        assert_eq!(f.name.as_deref(), Some("Perplexity"));
        assert_eq!(
            f.linkedin.as_deref(),
            Some("https://www.linkedin.com/company/perplexity-ai")
        );
        assert_eq!(f.website.as_deref(), Some("https://www.perplexity.ai"));
        assert_eq!(
            f.description.as_deref(),
            Some("Perplexity is an AI-powered answer engine.")
        );
        assert_eq!(f.industry.as_deref(), Some("Software Development"));
        assert_eq!(f.size.as_deref(), Some("201-500 employees"));
        assert_eq!(f.headquarters.as_deref(), Some("San Francisco, California"));
        assert_eq!(f.founded.as_deref(), Some("2022"));
    }

    #[test]
    fn names_from_titles() {
        assert_eq!(
            name_from_title("Home \\ Anthropic").as_deref(),
            Some("Anthropic")
        );
        assert_eq!(name_from_title("Home | Fathom").as_deref(), Some("Fathom"));
        assert_eq!(
            name_from_title("Ashby – All-in-one recruiting software").as_deref(),
            Some("Ashby")
        );
        assert_eq!(name_from_title("Acme | LinkedIn").as_deref(), Some("Acme"));
    }

    #[test]
    fn redirects() {
        assert_eq!(
            resolve("https://a.com/x/y", "https://b.com/"),
            "https://b.com/"
        );
        assert_eq!(resolve("https://a.com/x/y", "/z"), "https://a.com/z");
        assert_eq!(resolve("https://a.com/x/y", "//c.com/"), "https://c.com/");
        assert_eq!(resolve("https://a.com/x/y", "z"), "https://a.com/x/z");
    }

    #[test]
    fn a_profile_sent_from_the_browser() {
        let page = ProfilePage {
            url: "https://www.linkedin.com/in/samlee/?originalSubdomain=uk".into(),
            title: "(3) Sam Lee | LinkedIn".into(),
            name: "Sam Lee".into(),
            top: "Sam Lee\nSam Lee\nShe/Her\n· 2nd\n2nd degree connection\nEngineering Manager, Platform | Hiring!\n\
                  Acme\nUniversity of Leeds\nLondon, England, United Kingdom\n·\nContact info\n1,204 followers\n\
                  500+ connections\nMessage\nFollow\nMore"
                .into(),
            about: "About\nAbout\nI build platform teams.\nI build platform teams.\nPreviously at Globex. …see more".into(),
            experience: "Experience\nEngineering Manager\nEngineering Manager\nAcme · Full-time\nJan 2023 - Present · 3 yrs 10 mos\nLondon"
                .into(),
            company: "Current company: Acme. Click to skip to experience card".into(),
            photo: "https://media.licdn.com/dms/image/v2/D4E03AQ/profile-displayphoto-shrink_400_400/0/1?e=1".into(),
        };
        let p = person_from_page(&page).unwrap();
        assert_eq!(p.name.as_deref(), Some("Sam Lee"));
        assert_eq!(p.title.as_deref(), Some("Engineering Manager"));
        assert_eq!(p.company.as_deref(), Some("Acme"));
        assert_eq!(
            p.location.as_deref(),
            Some("London, England, United Kingdom")
        );
        assert_eq!(
            p.linkedin.as_deref(),
            Some("https://www.linkedin.com/in/samlee")
        );
        assert_eq!(
            p.about.as_deref(),
            Some("I build platform teams.\nPreviously at Globex…")
        );
        assert!(p.photo.unwrap().contains("profile-displayphoto"));

        // Several roles at one company, and no current-company link.
        let page = ProfilePage {
            company: String::new(),
            experience: "Experience\nGlobex\nFull-time · 6 yrs\nPrincipal Engineer\nJan 2024 - Present · 2 yrs\nStaff Engineer\n2020 - 2024".into(),
            ..page
        };
        let p = person_from_page(&page).unwrap();
        assert_eq!(
            (p.title.as_deref(), p.company.as_deref()),
            (Some("Principal Engineer"), Some("Globex"))
        );

        // Only a headline: "Role at Company"; the name from the tab's title.
        let p = person_from_page(&ProfilePage {
            url: "https://www.linkedin.com/in/jo".into(),
            title: "Jo Park | LinkedIn".into(),
            top: "Jo Park\nSRE at Initech\nBerlin · Contact info".into(),
            ..ProfilePage::default()
        })
        .unwrap();
        assert_eq!(
            (
                p.name.as_deref(),
                p.title.as_deref(),
                p.company.as_deref(),
                p.location.as_deref()
            ),
            (
                Some("Jo Park"),
                Some("SRE"),
                Some("Initech"),
                Some("Berlin")
            )
        );
        assert!(
            person_from_page(&ProfilePage {
                url: "https://www.linkedin.com/company/acme".into(),
                ..ProfilePage::default()
            })
            .is_err()
        );
    }

    #[test]
    fn a_linkedin_profile() {
        let html = r#"<html><head>
            <meta property="og:title" content="Satya Nadella - Chairman and CEO at Microsoft | LinkedIn">
            <script type="application/ld+json">{"@context":"http://schema.org","@graph":[{"@type":"Person",
              "name":"Satya Nadella","jobTitle":["Chairman and CEO","Member Board Of Trustees"],
              "address":{"@type":"PostalAddress","addressCountry":"US","addressLocality":"Redmond, Washington, United States"},
              "worksFor":[{"@type":"Organization","name":"Microsoft","url":"https://www.linkedin.com/company/microsoft","location":"Greater Seattle Area"}],
              "image":{"@type":"ImageObject","contentUrl":"https://media.licdn.com/photo.jpg"},
              "description":"Empowering every person.","url":"https://www.linkedin.com/in/satyanadella"}]}</script>
            </head></html>"#;
        let p = extract_person(html, "https://uk.linkedin.com/in/satyanadella?trk=x");
        assert_eq!(p.name.as_deref(), Some("Satya Nadella"));
        assert_eq!(p.title.as_deref(), Some("Chairman and CEO at Microsoft"));
        assert_eq!(p.company.as_deref(), Some("Microsoft"));
        assert_eq!(
            p.company_linkedin.as_deref(),
            Some("https://www.linkedin.com/company/microsoft")
        );
        assert_eq!(
            p.location.as_deref(),
            Some("Redmond, Washington, United States")
        );
        assert_eq!(
            p.linkedin.as_deref(),
            Some("https://www.linkedin.com/in/satyanadella")
        );
        assert_eq!(
            p.photo.as_deref(),
            Some("https://media.licdn.com/photo.jpg")
        );
        assert_eq!(p.about.as_deref(), Some("Empowering every person."));
        // Only the title, as when the data isn't there.
        let bare = extract_person(
            r#"<meta property="og:title" content="Pat Chen - Technical Recruiter at Acme | LinkedIn">"#,
            "https://www.linkedin.com/in/patchen",
        );
        assert_eq!(
            (bare.name.as_deref(), bare.title.as_deref()),
            (Some("Pat Chen"), Some("Technical Recruiter at Acme"))
        );
        assert_eq!(
            linkedin_profile("https://www.linkedin.com/company/acme"),
            None
        );
    }

    #[test]
    fn addresses() {
        assert_eq!(normalize_url("acme.com").unwrap(), "https://acme.com");
        assert_eq!(
            normalize_url(" https://acme.com/x ").unwrap(),
            "https://acme.com/x"
        );
        assert_eq!(
            normalize_url("http://127.0.0.1:8080/").unwrap(),
            "http://127.0.0.1:8080/"
        );
        assert!(normalize_url("acme").is_err());
        assert!(normalize_url("ftp://acme.com").is_err());
        assert!(normalize_url("").is_err());
    }
}
