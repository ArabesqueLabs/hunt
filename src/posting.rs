//! Importing a job posting from its link.
//!
//! Where a platform has a public API that says more than its pages, that's
//! used: Greenhouse, Lever (for the workplace type and salary), Workable,
//! and LinkedIn's public job view. Apple's careers pages carry their job as
//! data for their own scripts, which is read from the page. Everything else, Ashby included, is read
//! from the page: schema.org `JobPosting` data (JSON-LD, which job boards
//! embed for search engines), or failing that the page's title and
//! description. A pay range written in the description ("$180,000 – $220,000")
//! is used when the posting gives none as data. Nothing is saved here.

use regex::Regex;
use scraper::{ElementRef, Html, Node, Selector};
use serde::Serialize;
use serde_json::Value;

use crate::error::{Error, Result};
use crate::lookup::{
    clean, get_json, get_page, host_of, linkedin_company, normalize_url, truncate, website_of,
};

/// What a posting says, in the shape of an application. Anything not found
/// is `None`.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize)]
pub struct Posting {
    pub title: Option<String>,
    pub company: Option<String>,
    pub company_website: Option<String>,
    pub company_linkedin: Option<String>,
    /// Where the company's logo is, if the posting says.
    pub company_logo: Option<String>,
    /// The posting's own address, tidied.
    pub url: Option<String>,
    pub location: Option<String>,
    /// remote, hybrid or onsite.
    pub work_mode: Option<String>,
    /// full-time, part-time, contract, temporary or internship.
    pub employment: Option<String>,
    pub salary_min: Option<i64>,
    pub salary_max: Option<i64>,
    pub currency: Option<String>,
    /// year, month, day or hour.
    pub pay_period: Option<String>,
    pub posted_on: Option<String>,
    pub closes_on: Option<String>,
    /// The employer's ID for the role (a requisition or job number).
    pub reference: Option<String>,
    /// Plain text, with paragraphs and bullets kept.
    pub description: Option<String>,
    /// Where it came from: "Greenhouse", "LinkedIn", "the page"...
    pub platform: String,
}

/// The longest description kept.
const MAX_DESCRIPTION: usize = 20_000;

/// Fetch a posting from its link and read it.
pub fn fetch(url: &str) -> Result<Posting> {
    let url = normalize_url(url)?;
    let mut p = match platform(&url) {
        Platform::Greenhouse { board, id } => greenhouse(&board, &id)?,
        Platform::Lever { api, company, id } => lever(&url, &api, &company, &id)?,
        Platform::Workable { account, code } => workable(&account, &code)?,
        Platform::LinkedIn { id } => linkedin(&id)?,
        Platform::Apple => apple(&url)?,
        Platform::Levels { id } => levels(&url, &id)?,
        Platform::Page => {
            let page = get_page(&url)?;
            from_page(&page.text(), &page.url)
        }
    };
    if p.title.is_none() && p.company.is_none() {
        return Err(Error::Fetch(format!(
            "no job posting could be read from {url}"
        )));
    }
    p.url.get_or_insert(url);
    fill_from_text(&mut p);
    Ok(p)
}

#[derive(Debug, PartialEq, Eq)]
enum Platform {
    Greenhouse {
        board: String,
        id: String,
    },
    Lever {
        api: String,
        company: String,
        id: String,
    },
    Workable {
        account: String,
        code: String,
    },
    LinkedIn {
        id: String,
    },
    Apple,
    /// levels.fyi's own listings, by `jobId`.
    Levels {
        id: String,
    },
    Page,
}

/// A posting's link in one form, so the same posting is recognised however
/// it was copied: the platform's own id where it has one (Greenhouse,
/// Lever, Workable, LinkedIn); otherwise the address without its scheme,
/// `www.`, fragment, trailing slash and tracking parameters, lowercased.
pub fn canonical(url: &str) -> String {
    let url = url.trim();
    let full = if url.contains("://") {
        url.to_string()
    } else {
        format!("https://{url}")
    };
    match platform(&full) {
        Platform::Greenhouse { board, id } => {
            return format!("greenhouse:{}/{id}", board.to_lowercase());
        }
        Platform::Lever { company, id, .. } => {
            return format!("lever:{}/{}", company.to_lowercase(), id.to_lowercase());
        }
        Platform::Workable { account, code } => {
            return format!(
                "workable:{}/{}",
                account.to_lowercase(),
                code.to_lowercase()
            );
        }
        Platform::LinkedIn { id } => return format!("linkedin:{id}"),
        // Apple's links end in a slug of the title that varies; the number is the job.
        Platform::Apple => {
            if let Some(id) = full
                .split("/details/")
                .nth(1)
                .and_then(|t| t.split(['/', '-', '?']).next())
                .filter(|id| !id.is_empty())
            {
                return format!("apple:{id}");
            }
        }
        Platform::Levels { id } => return format!("levels:{id}"),
        Platform::Page => {}
    }
    let rest = full.split_once("://").map_or(full.as_str(), |(_, r)| r);
    let rest = rest.split('#').next().unwrap_or(rest);
    let (place, query) = rest.split_once('?').unwrap_or((rest, ""));
    let place = place.to_lowercase();
    let place = place
        .strip_prefix("www.")
        .unwrap_or(&place)
        .trim_end_matches('/');
    const TRACKING: &[&str] = &[
        "utm_",
        "gh_src",
        "gh_jid_src",
        "trk",
        "ref",
        "refid",
        "source",
        "src",
        "lever-source",
        "lever-origin",
        "fbclid",
        "gclid",
        "mc_",
        "_hs",
        "trackingid",
        "originalsubdomain",
        "position",
        "pagenum",
        "eid",
    ];
    let mut kept: Vec<String> = query
        .split('&')
        .filter(|kv| !kv.is_empty())
        .filter(|kv| {
            let key = kv.split('=').next().unwrap_or("").to_lowercase();
            !TRACKING
                .iter()
                .any(|t| key == *t || (t.ends_with('_') && key.starts_with(t)))
        })
        .map(str::to_string)
        .collect();
    kept.sort();
    if kept.is_empty() {
        place.to_string()
    } else {
        format!("{place}?{}", kept.join("&"))
    }
}

/// Hiring tools and job boards whose pages are job postings, besides those
/// hunt reads itself.
const JOB_HOSTS: &[&str] = &[
    "ashbyhq.com",
    "myworkdayjobs.com",
    "smartrecruiters.com",
    "recruitee.com",
    "teamtailor.com",
    "personio.de",
    "personio.com",
    "bamboohr.com",
    "jobvite.com",
    "icims.com",
    "breezy.hr",
    "welcometothejungle.com",
    "otta.com",
    "wellfound.com",
    "indeed.com",
    "glassdoor.com",
    "glassdoor.co.uk",
    "reed.co.uk",
    "totaljobs.com",
];

/// Whether a link looks like a job posting: one hunt reads, or one on a
/// hiring tool or a job board (a careers page counts when its path says so).
pub fn is_posting(url: &str) -> bool {
    let full = if url.contains("://") {
        url.trim().to_string()
    } else {
        format!("https://{}", url.trim())
    };
    if platform(&full) != Platform::Page {
        return true;
    }
    let host = host_of(&full);
    let path = full
        .split("://")
        .nth(1)
        .and_then(|r| r.split_once('/'))
        .map(|(_, p)| p.to_lowercase())
        .unwrap_or_default();
    if host.ends_with("linkedin.com") {
        return path.starts_with("jobs/");
    }
    JOB_HOSTS
        .iter()
        .any(|h| host == *h || host.ends_with(&format!(".{h}")))
        || [
            "careers/",
            "jobs/",
            "job/",
            "positions/",
            "openings/",
            "vacancies/",
        ]
        .iter()
        .any(|p| path.starts_with(p) || path.contains(&format!("/{p}")))
            && path.split('/').filter(|s| !s.is_empty()).count() >= 2
}

/// Which reader a link needs.
fn platform(url: &str) -> Platform {
    let host = host_of(url);
    let path: Vec<&str> = url
        .split("://")
        .nth(1)
        .and_then(|r| r.split_once('/'))
        .map(|(_, p)| p.split(['?', '#']).next().unwrap_or(""))
        .unwrap_or("")
        .split('/')
        .filter(|s| !s.is_empty())
        .collect();
    let query = |key: &str| {
        url.split_once('?').and_then(|(_, q)| {
            q.split(['&', '#'])
                .find_map(|kv| kv.strip_prefix(&format!("{key}=")).map(String::from))
        })
    };
    if host.ends_with("greenhouse.io") {
        // boards.greenhouse.io/acme/jobs/123, job-boards.greenhouse.io/acme/jobs/123,
        // or the embed: boards.greenhouse.io/embed/job_app?for=acme&token=123
        if let (Some(board), Some(id)) = (query("for"), query("token")) {
            return Platform::Greenhouse { board, id };
        }
        if let [board, "jobs", id, ..] = path.as_slice() {
            return Platform::Greenhouse {
                board: board.to_string(),
                id: id.to_string(),
            };
        }
    }
    if host.starts_with("jobs.")
        && host.ends_with("lever.co")
        && let [company, id, ..] = path.as_slice()
    {
        let api = if host.contains(".eu.") {
            "https://api.eu.lever.co"
        } else {
            "https://api.lever.co"
        };
        return Platform::Lever {
            api: api.into(),
            company: company.to_string(),
            id: id.to_string(),
        };
    }
    if host == "apply.workable.com"
        && let [account, "j", code, ..] = path.as_slice()
    {
        return Platform::Workable {
            account: account.to_string(),
            code: code.to_string(),
        };
    }
    if host == "jobs.apple.com" && path.contains(&"details") {
        return Platform::Apple;
    }
    if host.ends_with("levels.fyi") {
        if let Some(id) = query("jobId").filter(|id| !id.is_empty()) {
            return Platform::Levels { id };
        }
        // levels.fyi/jobs/view/<title>-at-<company>-<id>: a job levels.fyi
        // shows from LinkedIn, by LinkedIn's id.
        if let ["jobs", "view", slug, ..] = path.as_slice() {
            let tail = slug.rsplit('-').next().unwrap_or(slug);
            if tail.len() >= 6 && tail.bytes().all(|b| b.is_ascii_digit()) {
                return Platform::LinkedIn {
                    id: tail.to_string(),
                };
            }
        }
    }
    if host.ends_with("linkedin.com") {
        let digits = |s: &str| {
            let tail = s.rsplit('-').next().unwrap_or(s);
            (tail.len() >= 6 && tail.bytes().all(|b| b.is_ascii_digit())).then(|| tail.to_string())
        };
        let id = query("currentJobId").or_else(|| match path.as_slice() {
            ["jobs", "view", slug, ..] => digits(slug),
            ["jobs-guest", "jobs", "api", "jobPosting", id, ..] => digits(id),
            _ => None,
        });
        if let Some(id) = id {
            return Platform::LinkedIn { id };
        }
    }
    Platform::Page
}

// --- readers -----------------------------------------------------------------------

fn greenhouse(board: &str, id: &str) -> Result<Posting> {
    let j = get_json(&format!(
        "https://boards-api.greenhouse.io/v1/boards/{board}/jobs/{id}?pay_transparency=true"
    ))?;
    let s = |v: &Value| v.as_str().map(clean).filter(|s| !s.is_empty());
    let meta = |name: &str| {
        j["metadata"]
            .as_array()
            .into_iter()
            .flatten()
            .find_map(|m| {
                let n = m["name"].as_str()?.to_lowercase();
                n.contains(name).then(|| match &m["value"] {
                    Value::String(v) => Some(v.clone()),
                    Value::Array(a) => a.iter().filter_map(Value::as_str).next().map(String::from),
                    _ => None,
                })?
            })
    };
    // The content comes HTML-escaped: read it as text to get the HTML.
    let html = j["content"].as_str().map(|c| {
        Html::parse_fragment(c)
            .root_element()
            .text()
            .collect::<String>()
    });
    let mut p = Posting {
        platform: "Greenhouse".into(),
        title: s(&j["title"]),
        company: s(&j["company_name"]).or_else(|| Some(titlecase(board))),
        url: s(&j["absolute_url"]),
        location: s(&j["location"]["name"]),
        work_mode: meta("location type")
            .or_else(|| meta("workplace"))
            .or_else(|| meta("remote"))
            .and_then(|m| work_mode(&m)),
        employment: meta("employment").and_then(|e| employment(&e)),
        posted_on: s(&j["first_published"]).and_then(|d| date(&d)),
        closes_on: s(&j["application_deadline"]).and_then(|d| date(&d)),
        reference: s(&j["requisition_id"]),
        description: html.map(|h| html_to_text(&h)),
        ..Posting::default()
    };
    if let Some(pay) = j["pay_input_ranges"].as_array().and_then(|a| a.first()) {
        p.salary_min = pay["min_cents"].as_i64().map(|c| c / 100);
        p.salary_max = pay["max_cents"].as_i64().map(|c| c / 100);
        p.currency = s(&pay["currency_type"]);
        let title = pay["title"].as_str().unwrap_or("").to_lowercase();
        p.pay_period = Some(
            if title.contains("hour") {
                "hour"
            } else {
                "year"
            }
            .into(),
        );
    }
    if p.work_mode.is_none() {
        p.work_mode = p.location.as_deref().and_then(work_mode);
    }
    Ok(p)
}

/// Lever's pages carry `JobPosting` data; its API adds the workplace type
/// and any salary range.
fn lever(url: &str, api: &str, company: &str, id: &str) -> Result<Posting> {
    let mut p = match get_page(url) {
        Ok(page) => from_page(&page.text(), &page.url),
        Err(_) => Posting::default(),
    };
    p.platform = "Lever".into();
    let j = get_json(&format!("{api}/v0/postings/{company}/{id}?mode=json"))?;
    let s = |v: &Value| v.as_str().map(clean).filter(|s| !s.is_empty());
    p.title = p.title.or_else(|| s(&j["text"]));
    p.company = p.company.or_else(|| Some(titlecase(company)));
    p.url = s(&j["hostedUrl"]).or(p.url);
    p.location = p.location.or_else(|| s(&j["categories"]["location"]));
    p.work_mode = s(&j["workplaceType"])
        .and_then(|w| work_mode(&w))
        .or(p.work_mode);
    p.employment = p
        .employment
        .or_else(|| s(&j["categories"]["commitment"]).and_then(|c| employment(&c)));
    if p.posted_on.is_none() {
        p.posted_on = j["createdAt"].as_i64().and_then(|ms| {
            jiff::Timestamp::from_millisecond(ms)
                .ok()
                .map(|t| t.strftime("%Y-%m-%d").to_string())
        });
    }
    let range = &j["salaryRange"];
    if range.is_object() {
        p.salary_min = range["min"].as_i64();
        p.salary_max = range["max"].as_i64();
        p.currency = s(&range["currency"]);
        p.pay_period = s(&range["interval"]).and_then(|i| pay_period(&i));
    }
    if p.description.is_none() {
        let parts: Vec<String> = [s(&j["descriptionPlain"]), s(&j["additionalPlain"])]
            .into_iter()
            .flatten()
            .collect();
        p.description = (!parts.is_empty()).then(|| parts.join("\n\n"));
    }
    Ok(p)
}

fn workable(account: &str, code: &str) -> Result<Posting> {
    let j = get_json(&format!(
        "https://apply.workable.com/api/v2/accounts/{account}/jobs/{code}"
    ))?;
    let company = get_json(&format!(
        "https://apply.workable.com/api/v1/accounts/{account}"
    ))
    .ok();
    let s = |v: &Value| v.as_str().map(clean).filter(|s| !s.is_empty());
    let loc = &j["location"];
    let location = [s(&loc["city"]), s(&loc["region"]), s(&loc["country"])]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(", ");
    let html: String = ["description", "requirements", "benefits"]
        .iter()
        .filter_map(|k| j[*k].as_str())
        .collect::<Vec<_>>()
        .join("\n");
    Ok(Posting {
        platform: "Workable".into(),
        title: s(&j["title"]),
        company: company
            .as_ref()
            .and_then(|c| s(&c["name"]))
            .or_else(|| Some(titlecase(account))),
        company_website: company
            .as_ref()
            .and_then(|c| s(&c["url"]))
            .map(|u| website_of(&u)),
        company_logo: company.as_ref().and_then(|c| s(&c["logo"])),
        url: Some(format!("https://apply.workable.com/{account}/j/{code}/")),
        location: (!location.is_empty()).then_some(location),
        work_mode: s(&j["workplace"])
            .and_then(|w| work_mode(&w))
            .or_else(|| (j["remote"] == true).then(|| "remote".into())),
        employment: s(&j["type"]).and_then(|t| employment(&t)),
        posted_on: s(&j["published"]).and_then(|d| date(&d)),
        description: (!html.is_empty()).then(|| html_to_text(&html)),
        ..Posting::default()
    })
}

/// LinkedIn's public job view: what it shows to people who aren't signed in.
fn linkedin(id: &str) -> Result<Posting> {
    let page = get_page(&format!(
        "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{id}"
    ))?;
    let doc = Html::parse_document(&page.text());
    let text = |css: &str| -> Option<String> {
        let sel = Selector::parse(css).ok()?;
        doc.select(&sel)
            .map(|e| clean(&e.text().collect::<String>()))
            .find(|t| !t.is_empty())
    };
    let company_link = Selector::parse(".topcard__org-name-link")
        .ok()
        .and_then(|sel| doc.select(&sel).next())
        .and_then(|e| e.value().attr("href").map(String::from));
    // "Employment type: Full-time" and the like.
    let criteria = |name: &str| -> Option<String> {
        let sel = Selector::parse(".description__job-criteria-item").ok()?;
        let head = Selector::parse(".description__job-criteria-subheader").ok()?;
        let val = Selector::parse(".description__job-criteria-text").ok()?;
        doc.select(&sel).find_map(|item| {
            let h = clean(&item.select(&head).next()?.text().collect::<String>());
            if !h.eq_ignore_ascii_case(name) {
                return None;
            }
            Some(clean(&item.select(&val).next()?.text().collect::<String>()))
        })
    };
    let description = Selector::parse(".show-more-less-html__markup")
        .ok()
        .and_then(|sel| doc.select(&sel).next())
        .map(|e| element_text(e));
    let location = text(".topcard__flavor--bullet");
    let mut p = Posting {
        platform: "LinkedIn".into(),
        title: text(".top-card-layout__title").or_else(|| text("h2")),
        company: text(".topcard__org-name-link").or_else(|| text(".topcard__flavor")),
        company_linkedin: company_link.as_deref().and_then(linkedin_company),
        company_logo: Selector::parse("img.artdeco-entity-image")
            .ok()
            .and_then(|sel| doc.select(&sel).next())
            .and_then(|e| {
                e.value()
                    .attr("data-delayed-url")
                    .or_else(|| e.value().attr("src"))
            })
            .filter(|u| u.starts_with("http"))
            .map(String::from),
        url: Some(format!("https://www.linkedin.com/jobs/view/{id}")),
        work_mode: location.as_deref().and_then(work_mode),
        location,
        employment: criteria("Employment type").and_then(|e| employment(&e)),
        description,
        ..Posting::default()
    };
    if let Some(pay) = text(".compensation__salary") {
        salary_from_text(&mut p, &pay);
    }
    Ok(p)
}

/// levels.fyi: the page hands its scripts the job as JSON (`__NEXT_DATA__`),
/// with the company's details alongside.
fn levels(url: &str, id: &str) -> Result<Posting> {
    let page = get_page(&format!("https://www.levels.fyi/jobs?jobId={id}"))?;
    let data = next_data(&page.text())
        .ok_or_else(|| Error::Fetch(format!("{url} didn't have the job's details")))?;
    let job = &data["props"]["pageProps"]["initialJobDetails"];
    if !job.is_object() {
        return Err(Error::Fetch(format!(
            "levels.fyi has no job {id} (it may have closed)"
        )));
    }
    Ok(levels_posting(
        job,
        &format!("https://www.levels.fyi/jobs?jobId={id}"),
    ))
}

/// The JSON a Next.js page starts from.
pub(crate) fn next_data(html: &str) -> Option<Value> {
    let doc = Html::parse_document(html);
    let sel = Selector::parse("script#__NEXT_DATA__").ok()?;
    let text: String = doc.select(&sel).next()?.text().collect();
    serde_json::from_str(&text).ok()
}

fn levels_posting(j: &Value, url: &str) -> Posting {
    let s = |v: &Value| v.as_str().map(clean).filter(|s| !s.is_empty());
    let num = |v: &Value| {
        v.as_i64().or_else(|| {
            v.as_str()?
                .replace(',', "")
                .parse::<f64>()
                .ok()
                .map(|n| n.round() as i64)
        })
    };
    let company = &j["companyInfo"];
    let places: Vec<String> = j["locations"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|l| l.as_str().map(clean))
        .collect();
    let apply = s(&j["applicationUrl"]);
    let description = s(&j["description"]).map(|d| html_to_text(&d));
    let mut p = Posting {
        platform: "levels.fyi".into(),
        title: s(&j["title"]),
        company: s(&company["name"]),
        company_website: s(&company["website"]).map(|w| website_of(&w)),
        company_logo: s(&company["iconLarge"]).or_else(|| s(&company["icon"])),
        url: Some(url.to_string()),
        location: match places.len() {
            0 => None,
            1..=3 => Some(places.join(" / ")),
            n => Some(format!("{} +{} more", places[..3].join(" / "), n - 3)),
        },
        work_mode: s(&j["workArrangement"]).and_then(|w| match w.as_str() {
            "in_office" | "office" | "onsite" | "on_site" => Some("onsite".into()),
            other => work_mode(other),
        }),
        employment: j["employmentTypes"]
            .as_array()
            .and_then(|a| a.iter().filter_map(Value::as_str).find_map(employment)),
        salary_min: num(&j["minBaseSalary"]),
        salary_max: num(&j["maxBaseSalary"]),
        currency: s(&j["baseSalaryCurrency"]),
        posted_on: s(&j["postingDate"]).and_then(|d| date(&d)),
        closes_on: s(&j["expiryDate"]).and_then(|d| date(&d)),
        // Where to apply is the employer's own page; keep it with the text.
        description: match (apply, description) {
            (Some(a), Some(d)) => Some(format!("Apply: {a}\n\n{d}")),
            (Some(a), None) => Some(format!("Apply: {a}")),
            (None, d) => d,
        },
        ..Posting::default()
    };
    if p.salary_min.is_some() || p.salary_max.is_some() {
        p.pay_period = Some("year".into());
    }
    p
}

/// Apple's careers site: the page hands its scripts the job as JSON, in
/// `window.__staticRouterHydrationData = JSON.parse("…")`.
fn apple(url: &str) -> Result<Posting> {
    let page = get_page(url)?;
    let job = apple_job(&page.text()).ok_or_else(|| {
        Error::Fetch(format!(
            "{} didn't have the job's details where Apple's pages keep them",
            page.url
        ))
    })?;
    Ok(apple_posting(&job, &page.url))
}

/// The job's data from an Apple careers page.
fn apple_job(html: &str) -> Option<Value> {
    let re = Regex::new(
        r#"(?s)window\.__staticRouterHydrationData\s*=\s*JSON\.parse\(("(?:[^"\\]|\\.)*")\)"#,
    )
    .expect("a valid pattern");
    let literal = re.captures(html)?.get(1)?.as_str();
    // A JavaScript string literal of JSON: read the string, then the JSON.
    let inner: String = serde_json::from_str(literal).ok()?;
    let data: Value = serde_json::from_str(&inner).ok()?;
    let job = data["loaderData"]["jobDetails"]["jobsData"].clone();
    job.is_object().then_some(job)
}

fn apple_posting(j: &Value, url: &str) -> Posting {
    let s = |v: &Value| {
        v.as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from)
    };
    let places: Vec<String> = j["locations"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|l| {
            let mut parts: Vec<String> = Vec::new();
            for k in ["city", "stateProvince", "countryName"] {
                if let Some(v) = s(&l[k]).map(|v| clean(&v))
                    && !parts.contains(&v)
                {
                    parts.push(v);
                }
            }
            parts.join(", ")
        })
        .filter(|p| !p.is_empty())
        .collect();
    // Qualifications come one to a line; they read best as bullets.
    let bullets = |t: &str| {
        t.lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(|l| format!("• {l}"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let mut sections = Vec::new();
    for (title, key, list) in [
        ("Summary", "jobSummary", false),
        ("Description", "description", false),
        ("Minimum qualifications", "minimumQualifications", true),
        ("Preferred qualifications", "preferredQualifications", true),
    ] {
        if let Some(t) = s(&j[key]) {
            let body = if list { bullets(&t) } else { t };
            sections.push(format!("{title}\n\n{body}"));
        }
    }
    // The "Pay & Benefits" footer, where there is one, says the pay range.
    let pay: Option<String> = j["postingFooters"]
        .as_array()
        .into_iter()
        .flatten()
        .find_map(|f| {
            f["localizations"].as_object()?.values().find_map(|items| {
                items.as_array()?.iter().find_map(|it| {
                    let name = it["name"].as_str()?.to_lowercase();
                    name.contains("pay")
                        .then(|| html_to_text(it["content"].as_str().unwrap_or("")))
                })
            })
        });
    if let Some(pay) = &pay {
        sections.push(format!("Pay and benefits\n\n{pay}"));
    }
    let mut p = Posting {
        platform: "Apple".into(),
        title: s(&j["postingTitle"]),
        company: Some("Apple".into()),
        company_website: Some("https://www.apple.com".into()),
        company_linkedin: Some("https://www.linkedin.com/company/apple".into()),
        url: Some(url.to_string()),
        location: match places.len() {
            0 => None,
            1..=3 => Some(places.join(" / ")),
            n => Some(format!("{} +{} more", places[..3].join(" / "), n - 3)),
        },
        work_mode: (j["homeOffice"] == true).then(|| "remote".into()),
        employment: s(&j["employmentType"]).and_then(|e| {
            // Apple calls a permanent, full-time role "Standard".
            if e.eq_ignore_ascii_case("standard") {
                Some("full-time".into())
            } else {
                employment(&e)
            }
        }),
        posted_on: s(&j["postingDateMeta"])
            .or_else(|| s(&j["postDateInGMT"]))
            .and_then(|d| date(&d)),
        description: (!sections.is_empty()).then(|| sections.join("\n\n")),
        ..Posting::default()
    };
    if let Some(pay) = pay {
        salary_from_text(&mut p, &pay);
    }
    p
}

/// Any page: its `JobPosting` data, or its title and description.
fn from_page(html: &str, url: &str) -> Posting {
    let doc = Html::parse_document(html);
    let meta = |key: &str| -> Option<String> {
        ["property", "name"].iter().find_map(|attr| {
            let sel = Selector::parse(&format!("meta[{attr}='{key}']")).ok()?;
            doc.select(&sel)
                .filter_map(|e| e.value().attr("content"))
                .map(clean)
                .find(|v| !v.is_empty())
        })
    };
    let host = host_of(url);
    let platform = if host.ends_with("ashbyhq.com") {
        "Ashby"
    } else if host.ends_with("lever.co") {
        "Lever"
    } else if host.contains("smartrecruiters") {
        "SmartRecruiters"
    } else if host.ends_with("myworkdayjobs.com") {
        "Workday"
    } else {
        "the page"
    };
    let Some(job) = job_posting(&doc) else {
        // No structured data: what the page's title and description say.
        let title = meta("og:title").or_else(|| {
            let sel = Selector::parse("title").ok()?;
            doc.select(&sel)
                .next()
                .map(|e| clean(&e.text().collect::<String>()))
        });
        return Posting {
            platform: platform.into(),
            title,
            company: meta("og:site_name"),
            url: meta("og:url").or_else(|| Some(url.to_string())),
            description: meta("og:description").or_else(|| meta("description")),
            ..Posting::default()
        };
    };
    let s = |v: &Value| match v {
        Value::String(s) => Some(clean(s)).filter(|s| !s.is_empty()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    };
    let org = &job["hiringOrganization"];
    let org_links: Vec<String> = match &org["sameAs"] {
        Value::String(u) => vec![u.clone()],
        Value::Array(a) => a
            .iter()
            .filter_map(Value::as_str)
            .map(String::from)
            .collect(),
        _ => vec![],
    };
    let mut p = Posting {
        platform: platform.into(),
        title: s(&job["title"]),
        company: s(&org["name"]).or_else(|| (!org.is_object()).then(|| s(org)).flatten()),
        company_website: org_links
            .iter()
            .chain(s(&org["url"]).iter())
            .find(|u| !host_of(u).ends_with("linkedin.com"))
            .map(|u| website_of(u)),
        company_linkedin: org_links.iter().find_map(|u| linkedin_company(u)),
        company_logo: match &org["logo"] {
            Value::String(u) => Some(u.clone()),
            Value::Object(l) => l.get("url").and_then(Value::as_str).map(String::from),
            _ => None,
        },
        url: s(&job["url"])
            .or_else(|| meta("og:url"))
            .or_else(|| Some(url.to_string())),
        location: locations(&job),
        work_mode: (job["jobLocationType"].as_str() == Some("TELECOMMUTE"))
            .then(|| "remote".into()),
        employment: match &job["employmentType"] {
            Value::Array(a) => a.iter().filter_map(Value::as_str).find_map(employment),
            v => s(v).and_then(|e| employment(&e)),
        },
        posted_on: s(&job["datePosted"]).and_then(|d| date(&d)),
        closes_on: s(&job["validThrough"]).and_then(|d| date(&d)),
        reference: identifier(&job["identifier"]),
        description: s(&job["description"]).map(|d| html_to_text(&d)),
        ..Posting::default()
    };
    if p.work_mode.is_none() {
        p.work_mode = p.location.as_deref().and_then(work_mode);
    }
    // baseSalary: {currency, value: {minValue, maxValue, value, unitText}}
    let pay = &job["baseSalary"];
    let value = &pay["value"];
    let num = |v: &Value| {
        v.as_f64()
            .or_else(|| v.as_str()?.replace(',', "").parse().ok())
            .map(|n| n.round() as i64)
    };
    p.salary_min = num(&value["minValue"])
        .or_else(|| num(&value["value"]))
        .or_else(|| num(value));
    p.salary_max = num(&value["maxValue"]).or(p.salary_min);
    if p.salary_min.is_some() {
        p.currency = s(&pay["currency"]).or_else(|| s(&value["currency"]));
        p.pay_period = s(&value["unitText"])
            .or_else(|| s(&pay["unitText"]))
            .and_then(|u| pay_period(&u));
    }
    p
}

/// A JobPosting's `identifier`: text, or a `PropertyValue` (`{name, value}`).
fn identifier(v: &Value) -> Option<String> {
    let v = match v {
        Value::Array(a) => a.first()?,
        v => v,
    };
    match v {
        Value::String(t) => Some(clean(t)),
        Value::Number(n) => Some(n.to_string()),
        Value::Object(o) => o.get("value").and_then(|v| match v {
            Value::String(t) => Some(clean(t)),
            Value::Number(n) => Some(n.to_string()),
            _ => None,
        }),
        _ => None,
    }
    .filter(|t| !t.is_empty())
}

/// The first `JobPosting` on a page, including inside `@graph`.
fn job_posting(doc: &Html) -> Option<Value> {
    fn find(v: &Value) -> Option<Value> {
        match v {
            Value::Array(items) => items.iter().find_map(find),
            Value::Object(o) => {
                let is_job = match o.get("@type") {
                    Some(Value::String(t)) => t == "JobPosting",
                    Some(Value::Array(ts)) => ts.iter().any(|t| t == "JobPosting"),
                    _ => false,
                };
                if is_job {
                    Some(v.clone())
                } else {
                    o.get("@graph").and_then(find)
                }
            }
            _ => None,
        }
    }
    let sel = Selector::parse("script[type='application/ld+json']").ok()?;
    doc.select(&sel)
        .filter_map(|e| serde_json::from_str::<Value>(&e.text().collect::<String>()).ok())
        .find_map(|v| find(&v))
}

/// "Berlin, Germany / Remote (Spain, Italy, +3 more)".
fn locations(job: &Value) -> Option<String> {
    let place = |p: &Value| -> Option<String> {
        let a = &p["address"];
        if let Some(s) = a.as_str() {
            return Some(clean(s));
        }
        let part = |k: &str| match &a[k] {
            Value::String(s) => Some(clean(s)),
            Value::Object(o) => o.get("name").and_then(Value::as_str).map(clean),
            _ => None,
        };
        let parts: Vec<String> = ["addressLocality", "addressRegion", "addressCountry"]
            .iter()
            .filter_map(|k| part(k))
            .filter(|s| !s.is_empty())
            .fold(Vec::new(), |mut acc, s| {
                if !acc.contains(&s) {
                    acc.push(s);
                }
                acc
            });
        (!parts.is_empty()).then(|| parts.join(", "))
    };
    let list = |v: &Value| -> Vec<String> {
        match v {
            Value::Array(a) => a
                .iter()
                .filter_map(|p| place(p).or_else(|| p["name"].as_str().map(clean)))
                .collect(),
            Value::Null => vec![],
            v => place(v)
                .or_else(|| v["name"].as_str().map(clean))
                .into_iter()
                .collect(),
        }
    };
    let short = |mut l: Vec<String>| -> Option<String> {
        l.dedup();
        match l.len() {
            0 => None,
            1..=3 => Some(l.join(" / ")),
            n => Some(format!("{} +{} more", l[..3].join(" / "), n - 3)),
        }
    };
    let here = short(list(&job["jobLocation"]));
    let remote = job["jobLocationType"].as_str() == Some("TELECOMMUTE");
    let anywhere = short(list(&job["applicantLocationRequirements"]));
    match (here, remote, anywhere) {
        (Some(h), true, _) if !h.to_lowercase().contains("remote") => Some(format!("Remote, {h}")),
        (Some(h), _, _) => Some(h),
        (None, true, Some(a)) => Some(format!("Remote ({a})")),
        (None, true, None) => Some("Remote".into()),
        (None, false, a) => a,
    }
}

// --- reading text ----------------------------------------------------------------

/// What a posting's text says that its data didn't: the work mode and pay.
fn fill_from_text(p: &mut Posting) {
    if p.work_mode.is_none() {
        let hay = [p.title.as_deref(), p.location.as_deref()]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(" ");
        p.work_mode =
            work_mode(&hay).or_else(|| p.description.as_deref().and_then(work_mode_in_text));
    }
    if p.salary_min.is_none()
        && let Some(d) = p.description.clone()
    {
        salary_from_text(p, &d);
    }
    if let Some(d) = &p.description {
        p.description = Some(truncate(d, MAX_DESCRIPTION));
    }
}

/// The first pay range in some text: "$180,000 - $220,000 USD per year",
/// "£85k–£100k", "€60.000 – €75.000".
fn salary_from_text(p: &mut Posting, text: &str) {
    let re = Regex::new(
        r"(?i)([$£€]|\b(?:usd|gbp|eur|cad|aud)\s?)\s?(\d{1,3}(?:[,.\s]\d{3})+|\d+(?:\.\d+)?)\s?(k\b)?\s*(?:-|–|—|to|and)\s*(?:[$£€]|(?:usd|gbp|eur|cad|aud)\s?)?\s?(\d{1,3}(?:[,.\s]\d{3})+|\d+(?:\.\d+)?)\s?(k\b)?\s*(usd|gbp|eur|cad|aud)?",
    )
    .expect("a valid pattern");
    for c in re.captures_iter(text) {
        let amount = |n: &str, k: bool| -> Option<i64> {
            let digits: String = n
                .chars()
                .filter(|c| c.is_ascii_digit() || *c == '.')
                .collect();
            // "60.000" is sixty thousand; "85.5k" is 85,500.
            let v: f64 = if !k && n.matches(['.', ',', ' ']).count() >= 1 && n.len() > 4 {
                n.chars()
                    .filter(char::is_ascii_digit)
                    .collect::<String>()
                    .parse()
                    .ok()?
            } else {
                digits.parse().ok()?
            };
            Some((if k { v * 1000.0 } else { v }).round() as i64)
        };
        // "$120-140k": the k counts for both.
        let (k_lo, k_hi) = (c.get(3).is_some(), c.get(5).is_some());
        let (Some(lo), Some(hi)) = (
            amount(&c[2], k_lo || (k_hi && c[2].len() <= 3)),
            amount(&c[4], k_hi || (k_lo && c[4].len() <= 3)),
        ) else {
            continue;
        };
        if lo < 10 || hi < lo {
            continue;
        }
        let sym = c[1].trim().to_lowercase();
        let currency = match sym.as_str() {
            "$" => c
                .get(6)
                .map_or("USD".to_string(), |m| m.as_str().to_uppercase()),
            "£" => "GBP".into(),
            "€" => "EUR".into(),
            code => code.to_uppercase(),
        };
        let after: String = text[c.get(0).map_or(0, |m| m.end())..]
            .chars()
            .take(40)
            .collect::<String>()
            .to_lowercase();
        let period = if after.contains("hour") || after.contains("/hr") {
            "hour"
        } else if after.contains("month") {
            "month"
        } else if after.contains("day") && hi < 5000 {
            "day"
        } else if hi >= 1000 {
            "year"
        } else {
            continue;
        };
        p.salary_min = Some(lo);
        p.salary_max = Some(hi);
        p.currency = Some(currency);
        p.pay_period = Some(period.into());
        return;
    }
}

/// HTML as plain text, keeping paragraphs and bullets.
pub(crate) fn html_to_text(html: &str) -> String {
    let doc = Html::parse_fragment(html);
    element_text(doc.root_element())
}

fn element_text(el: ElementRef) -> String {
    fn walk(node: ego_tree::NodeRef<Node>, out: &mut String) {
        for child in node.children() {
            match child.value() {
                Node::Text(t) => {
                    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
                    if !t.is_empty() {
                        if !out.is_empty()
                            && !out.ends_with(['\n', ' '])
                            && !t.starts_with([',', '.', ';', ':', ')'])
                        {
                            out.push(' ');
                        }
                        out.push_str(&t);
                    }
                }
                Node::Element(e) => {
                    let name = e.name();
                    let block = matches!(
                        name,
                        "p" | "div"
                            | "section"
                            | "article"
                            | "ul"
                            | "ol"
                            | "li"
                            | "h1"
                            | "h2"
                            | "h3"
                            | "h4"
                            | "h5"
                            | "h6"
                            | "table"
                            | "tr"
                            | "blockquote"
                            | "pre"
                    );
                    match name {
                        "br" => out.push('\n'),
                        "script" | "style" => continue,
                        "li" => out.push_str("\n• "),
                        _ if block => out.push_str("\n\n"),
                        _ => {}
                    }
                    walk(child, out);
                    if block && name != "li" {
                        out.push_str("\n\n");
                    }
                }
                _ => {}
            }
        }
    }
    let mut out = String::new();
    walk(*el, &mut out);
    // Tidy: trim lines, no more than one blank line in a row.
    // A list's items sit together, with a blank line around the list.
    let mut tidy = String::new();
    let mut blank = false;
    let mut in_list = false;
    for line in out.lines().map(str::trim) {
        if line.is_empty() {
            blank = true;
            continue;
        }
        let bullet = line.starts_with('•');
        if !tidy.is_empty() {
            let together = (bullet && in_list) || !blank && !(bullet != in_list);
            tidy.push_str(if together { "\n" } else { "\n\n" });
        }
        blank = false;
        in_list = bullet;
        tidy.push_str(line);
    }
    tidy
}

// --- normalising -----------------------------------------------------------------

fn employment(s: &str) -> Option<String> {
    let k: String = s
        .to_lowercase()
        .chars()
        .filter(char::is_ascii_alphabetic)
        .collect();
    Some(
        match k.as_str() {
            "fulltime" | "full" | "permanent" => "full-time",
            "parttime" | "part" => "part-time",
            "contract" | "contractor" | "freelance" => "contract",
            "temporary" | "temp" | "seasonal" => "temporary",
            "intern" | "internship" => "internship",
            _ => return None,
        }
        .into(),
    )
}

/// The work mode some text mentions: "Remote - US", "Hybrid (London)", "On-site".
fn work_mode(s: &str) -> Option<String> {
    let s = s.to_lowercase();
    if s.contains("hybrid") {
        Some("hybrid".into())
    } else if s.contains("remote") || s == "telecommute" {
        Some("remote".into())
    } else if s.contains("on-site")
        || s.contains("onsite")
        || s.contains("on site")
        || s.contains("in office")
        || s.contains("in-office")
    {
        Some("onsite".into())
    } else {
        None
    }
}

/// The work mode a description states outright: "hybrid, 2 days in the
/// office", "this role is fully remote". Only plain phrases count, as words
/// like "hybrid cloud" or "remote teams" say nothing about where the job is.
fn work_mode_in_text(text: &str) -> Option<String> {
    let re = Regex::new(
        r"(?i)\b(?:(hybrid)(?:\s*[,(:]|\s+(?:role|position|working|work|model|setup|schedule|arrangement|policy|job))|(fully\s+remote|remote[- ]first|100%\s+remote|remote\s+(?:role|position|job))|(on[- ]?site\s+(?:role|position|job)|in\s+(?:the\s+)?office\s+(?:full[- ]time|five|5)\s*(?:days)?))",
    )
    .expect("a valid pattern");
    let c = re.captures(text)?;
    Some(
        if c.get(1).is_some() {
            "hybrid"
        } else if c.get(2).is_some() {
            "remote"
        } else {
            "onsite"
        }
        .into(),
    )
}

fn pay_period(s: &str) -> Option<String> {
    let s = s.to_lowercase();
    Some(
        if s.contains("year") || s.contains("annual") {
            "year"
        } else if s.contains("month") {
            "month"
        } else if s.contains("day") || s.contains("daily") {
            "day"
        } else if s.contains("hour") {
            "hour"
        } else {
            return None;
        }
        .into(),
    )
}

/// "2024-03-04T14:29:08Z" → "2024-03-04".
fn date(s: &str) -> Option<String> {
    let d = s.get(..10)?;
    d.parse::<jiff::civil::Date>().ok().map(|_| d.to_string())
}

/// "acme-corp" → "Acme Corp": a company's name from its board's slug, when
/// nothing better is said.
fn titlecase(slug: &str) -> String {
    slug.split(['-', '_'])
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut c = w.chars();
            c.next().map_or(String::new(), |f| {
                f.to_uppercase().collect::<String>() + c.as_str()
            })
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_go_to_the_right_reader() {
        let gh = |b: &str, i: &str| Platform::Greenhouse {
            board: b.into(),
            id: i.into(),
        };
        assert_eq!(
            platform("https://boards.greenhouse.io/anthropic/jobs/4461450008"),
            gh("anthropic", "4461450008")
        );
        assert_eq!(
            platform("https://job-boards.greenhouse.io/anthropic/jobs/4461450008?gh_src=x"),
            gh("anthropic", "4461450008")
        );
        assert_eq!(
            platform("https://boards.greenhouse.io/embed/job_app?for=acme&token=123"),
            gh("acme", "123")
        );
        assert_eq!(
            platform("https://jobs.lever.co/palantir/6ed76ce8-4156/apply"),
            Platform::Lever {
                api: "https://api.lever.co".into(),
                company: "palantir".into(),
                id: "6ed76ce8-4156".into()
            }
        );
        assert_eq!(
            platform("https://jobs.eu.lever.co/acme/abc"),
            Platform::Lever {
                api: "https://api.eu.lever.co".into(),
                company: "acme".into(),
                id: "abc".into()
            }
        );
        assert_eq!(
            platform("https://apply.workable.com/huggingface/j/DB4D7C0EC8/"),
            Platform::Workable {
                account: "huggingface".into(),
                code: "DB4D7C0EC8".into()
            }
        );
        let li = |i: &str| Platform::LinkedIn { id: i.into() };
        assert_eq!(
            platform("https://www.linkedin.com/jobs/view/4448884772/"),
            li("4448884772")
        );
        assert_eq!(
            platform(
                "https://uk.linkedin.com/jobs/view/senior-rust-engineer-at-grid-dynamics-4448884772"
            ),
            li("4448884772")
        );
        assert_eq!(
            platform(
                "https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4448884772"
            ),
            li("4448884772")
        );
        assert_eq!(
            platform("https://jobs.ashbyhq.com/ashby/7458d4e9"),
            Platform::Page
        );
        assert_eq!(platform("https://careers.acme.com/jobs/1"), Platform::Page);
        assert_eq!(
            platform(
                "https://jobs.apple.com/en-gb/details/200681759/Storage-Platform-Engineer-SRE-"
            ),
            Platform::Apple
        );
        assert_eq!(
            platform("https://jobs.apple.com/en-us/search?search=sre"),
            Platform::Page
        );
        assert_eq!(
            platform("https://www.levels.fyi/jobs?jobId=0ck398r2ll0mn&from=x"),
            Platform::Levels {
                id: "0ck398r2ll0mn".into()
            }
        );
        assert_eq!(
            platform("https://www.levels.fyi/jobs/view/senior-sre-at-nvidia-4468479696"),
            Platform::LinkedIn {
                id: "4468479696".into()
            }
        );
    }

    #[test]
    fn a_page_with_job_posting_data() {
        // As Ashby serves it.
        let html = r#"<html><head><script type="application/ld+json">{"@context":"https://schema.org/","@type":"JobPosting",
          "title":"Engineering Manager - EU","description":"<p>Hi!</p><ul><li>Lead a team</li><li>Ship</li></ul>",
          "datePosted":"2024-03-04","hiringOrganization":{"@type":"Organization","name":"Ashby","sameAs":"https://www.ashbyhq.com"},
          "jobLocation":{"@type":"Place","address":{"@type":"PostalAddress","addressLocality":"","addressCountry":"European Union"}},
          "employmentType":"FULL_TIME","jobLocationType":"TELECOMMUTE",
          "baseSalary":{"@type":"MonetaryAmount","currency":"EUR","value":{"@type":"QuantitativeValue","minValue":110000,"maxValue":185000,"unitText":"YEAR"}}}
          </script></head></html>"#;
        let p = from_page(html, "https://jobs.ashbyhq.com/ashby/7458d4e9");
        assert_eq!(p.platform, "Ashby");
        assert_eq!(p.title.as_deref(), Some("Engineering Manager - EU"));
        assert_eq!(p.company.as_deref(), Some("Ashby"));
        assert_eq!(
            p.company_website.as_deref(),
            Some("https://www.ashbyhq.com")
        );
        assert_eq!(p.location.as_deref(), Some("Remote, European Union"));
        assert_eq!(p.work_mode.as_deref(), Some("remote"));
        assert_eq!(p.employment.as_deref(), Some("full-time"));
        assert_eq!((p.salary_min, p.salary_max), (Some(110_000), Some(185_000)));
        assert_eq!(
            (p.currency.as_deref(), p.pay_period.as_deref()),
            (Some("EUR"), Some("year"))
        );
        assert_eq!(p.posted_on.as_deref(), Some("2024-03-04"));
        assert_eq!(
            p.description.as_deref(),
            Some("Hi!\n\n• Lead a team\n• Ship")
        );
    }

    #[test]
    fn a_role_id_from_job_posting_data() {
        let page = |id: &str| {
            format!(
                r#"<script type="application/ld+json">{{"@type":"JobPosting","title":"SRE","identifier":{id}}}</script>"#
            )
        };
        let id = |json: &str| from_page(&page(json), "https://careers.acme.com/jobs/1").reference;
        assert_eq!(
            id(r#"{"@type":"PropertyValue","name":"Acme","value":"R-1234"}"#).as_deref(),
            Some("R-1234")
        );
        assert_eq!(id(r#""JR0042""#).as_deref(), Some("JR0042"));
        assert_eq!(id("98765").as_deref(), Some("98765"));
        assert_eq!(id(r#"{"name":"Acme"}"#), None);
    }

    #[test]
    fn an_apple_careers_page() {
        // As jobs.apple.com serves it, cut down: the job is in the data its scripts start from.
        let job = serde_json::json!({ "loaderData": { "root": {}, "jobDetails": { "jobsData": {
            "postingTitle": "Storage Platform Engineer (SRE)",
            "jobSummary": "Apple Cloud infrastructure is BIG.",
            "description": "Join the Object Storage SRE team.",
            "minimumQualifications": "Distributed storage experience.\nGo or Rust.",
            "preferredQualifications": "Linux internals.",
            "locations": [{ "city": "London", "stateProvince": "England", "countryName": "United Kingdom" }],
            "postingDateMeta": "2026-09-04",
            "employmentType": "Standard",
            "homeOffice": false,
            "postingFooters": [{ "localizations": { "en_US": [
                { "name": "Pay & Benefits", "content": "<p>The base pay range for this role is between $129,300 and $194,700.</p>" },
                { "name": "EEO Statement", "content": "<p>Equal opportunity.</p>" }
            ] } }]
        } } } });
        let literal = serde_json::to_string(&job.to_string()).unwrap();
        let html = format!(
            "<html><script>window.__staticRouterHydrationData = JSON.parse({literal});</script></html>"
        );
        let data = apple_job(&html).expect("the job's data");
        let p = apple_posting(&data, "https://jobs.apple.com/en-gb/details/200681759/x");
        assert_eq!(p.title.as_deref(), Some("Storage Platform Engineer (SRE)"));
        assert_eq!(p.company.as_deref(), Some("Apple"));
        assert_eq!(
            p.location.as_deref(),
            Some("London, England, United Kingdom")
        );
        assert_eq!(p.employment.as_deref(), Some("full-time"));
        assert_eq!(p.work_mode, None);
        assert_eq!(p.posted_on.as_deref(), Some("2026-09-04"));
        assert_eq!(
            (p.salary_min, p.salary_max, p.currency.as_deref()),
            (Some(129_300), Some(194_700), Some("USD"))
        );
        let d = p.description.unwrap();
        assert!(
            d.starts_with("Summary\n\nApple Cloud infrastructure is BIG.\n\nDescription\n\nJoin"),
            "{d}"
        );
        assert!(
            d.contains(
                "Minimum qualifications\n\n• Distributed storage experience.\n• Go or Rust."
            ),
            "{d}"
        );
        assert!(!d.contains("Equal opportunity"), "only the pay footer: {d}");
    }

    #[test]
    fn the_same_posting_however_it_was_copied() {
        let same = |a: &str, b: &str| assert_eq!(canonical(a), canonical(b), "{a} vs {b}");
        same(
            "https://www.linkedin.com/jobs/view/4448884772/?trk=public_jobs",
            "https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4448884772",
        );
        same(
            "https://boards.greenhouse.io/anthropic/jobs/4461450008",
            "https://job-boards.greenhouse.io/anthropic/jobs/4461450008?gh_src=abc",
        );
        same(
            "https://jobs.apple.com/en-gb/details/200681759/Storage-Platform-Engineer-SRE-",
            "https://jobs.apple.com/en-gb/details/200681759/storage-platform-engineer-sre",
        );
        same(
            "https://www.Acme.com/careers/rust/?utm_source=x#apply",
            "acme.com/careers/rust",
        );
        assert_ne!(
            canonical("https://acme.com/jobs?id=1"),
            canonical("https://acme.com/jobs?id=2")
        );
        assert_ne!(
            canonical("https://jobs.lever.co/a/1"),
            canonical("https://jobs.lever.co/a/2")
        );
    }

    #[test]
    fn a_levels_fyi_job() {
        let job = serde_json::json!({
            "id": "0ck398r2ll0mn", "title": "Engineering Manager, Customer Studio",
            "description": "<p>Lead the team.</p>", "locations": ["San Francisco, California, United States"],
            "applicationUrl": "https://grnh.se/zzpkdb534us", "postingDate": "2026-10-01T23:59:18.000Z",
            "workArrangement": "remote", "employmentTypes": ["full_time"],
            "minBaseSalary": "220000", "maxBaseSalary": "400000", "baseSalaryCurrency": "USD",
            "companyInfo": { "name": "Hightouch", "website": "https://hightouch.com", "icon": "https://img.logo.dev/hightouch.com" }
        });
        let p = levels_posting(&job, "https://www.levels.fyi/jobs?jobId=0ck398r2ll0mn");
        assert_eq!(
            p.title.as_deref(),
            Some("Engineering Manager, Customer Studio")
        );
        assert_eq!(p.company.as_deref(), Some("Hightouch"));
        assert_eq!(p.company_website.as_deref(), Some("https://hightouch.com"));
        assert_eq!(
            p.company_logo.as_deref(),
            Some("https://img.logo.dev/hightouch.com")
        );
        assert_eq!(p.work_mode.as_deref(), Some("remote"));
        assert_eq!(p.employment.as_deref(), Some("full-time"));
        assert_eq!(
            (p.salary_min, p.salary_max, p.currency.as_deref()),
            (Some(220_000), Some(400_000), Some("USD"))
        );
        assert_eq!(p.posted_on.as_deref(), Some("2026-10-01"));
        assert_eq!(
            p.description.as_deref(),
            Some("Apply: https://grnh.se/zzpkdb534us\n\nLead the team.")
        );
        assert_eq!(
            canonical("https://www.levels.fyi/jobs?jobId=0ck398r2ll0mn"),
            "levels:0ck398r2ll0mn"
        );
    }

    #[test]
    fn a_page_without_it() {
        let html = r#"<html><head><title>Senior Rust Engineer - Acme Careers</title>
            <meta property="og:site_name" content="Acme"><meta name="description" content="Join us."></head></html>"#;
        let p = from_page(html, "https://careers.acme.com/jobs/1");
        assert_eq!(
            p.title.as_deref(),
            Some("Senior Rust Engineer - Acme Careers")
        );
        assert_eq!(p.company.as_deref(), Some("Acme"));
        assert_eq!(p.description.as_deref(), Some("Join us."));
    }

    #[test]
    fn pay_ranges_in_text() {
        let pay = |t: &str| {
            let mut p = Posting::default();
            salary_from_text(&mut p, t);
            (p.salary_min, p.salary_max, p.currency, p.pay_period)
        };
        let s = |s: &str| Some(s.to_string());
        assert_eq!(
            pay("The range is $180,000 - $220,000 USD per year."),
            (Some(180_000), Some(220_000), s("USD"), s("year"))
        );
        assert_eq!(
            pay("Salary: £85k–£100k + equity"),
            (Some(85_000), Some(100_000), s("GBP"), s("year"))
        );
        assert_eq!(
            pay("€60.000 – €75.000 brutto"),
            (Some(60_000), Some(75_000), s("EUR"), s("year"))
        );
        assert_eq!(
            pay("$55 - $70 per hour"),
            (Some(55), Some(70), s("USD"), s("hour"))
        );
        assert_eq!(
            pay("CAD 150,000 to 170,000"),
            (Some(150_000), Some(170_000), s("CAD"), s("year"))
        );
        assert_eq!(
            pay("$120-140k"),
            (Some(120_000), Some(140_000), s("USD"), s("year"))
        );
        assert_eq!(
            pay(
                "The base pay range for this role is between $129,300 and $194,700, and your base pay will depend on"
            ),
            (Some(129_300), Some(194_700), s("USD"), s("year"))
        );
        assert_eq!(pay("Spend $50 and $100 on gifts"), (None, None, None, None));
        assert_eq!(
            pay("We have 5-10 engineers and $2 coffee."),
            (None, None, None, None)
        );
    }

    #[test]
    fn words() {
        assert_eq!(employment("FULL_TIME").as_deref(), Some("full-time"));
        assert_eq!(employment("FullTime").as_deref(), Some("full-time"));
        assert_eq!(employment("Contractor").as_deref(), Some("contract"));
        assert_eq!(
            work_mode("Remote - European Union").as_deref(),
            Some("remote")
        );
        assert_eq!(work_mode("On-Site").as_deref(), Some("onsite"));
        assert_eq!(work_mode("London (Hybrid)").as_deref(), Some("hybrid"));
        assert_eq!(work_mode("London"), None);
        assert_eq!(
            work_mode_in_text("Hybrid, 2 days in the office.").as_deref(),
            Some("hybrid")
        );
        assert_eq!(
            work_mode_in_text("This is a hybrid role in Berlin").as_deref(),
            Some("hybrid")
        );
        assert_eq!(
            work_mode_in_text("We are remote-first.").as_deref(),
            Some("remote")
        );
        assert_eq!(
            work_mode_in_text("You'll work on our hybrid cloud with remote teams."),
            None
        );
        assert_eq!(titlecase("palantir-technologies"), "Palantir Technologies");
        assert_eq!(
            date("2026-09-21T00:00:00.000Z").as_deref(),
            Some("2026-09-21")
        );
    }

    #[test]
    fn html_as_text() {
        assert_eq!(
            html_to_text(
                "<h2>About</h2><p>We build <b>things</b>.</p><ul><li>One</li><li>Two</li></ul><p>Bye<br>now</p>"
            ),
            "About\n\nWe build things.\n\n• One\n• Two\n\nBye\nnow"
        );
    }
}
