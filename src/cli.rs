//! The `hunt` command. `hunt serve` runs the service; every other command
//! talks to it over the API, so the CLI and the web UI always agree.

use std::path::PathBuf;

use anyhow::{Context, Result, anyhow, bail};
use clap::{Parser, Subcommand};
use serde_json::{Map, Value, json};

use hunt::client::{Client, DEFAULT_URL};
use hunt::time;

#[derive(Parser)]
#[command(
    name = "hunt",
    version,
    about = "Track a job search: a board of hiring processes."
)]
struct Args {
    /// Where the service runs
    #[arg(long, global = true, env = "HUNT_URL", default_value = DEFAULT_URL)]
    url: String,
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Run the service: the API and the web UI
    Serve {
        #[arg(long, env = "HUNT_ADDR", default_value = "127.0.0.1:4848")]
        addr: String,
        /// The database: a SQLite file, or a postgres://user:pass@host/db or
        /// mysql://user:pass@host/db address [default: ~/.hunt/hunt.db]
        #[arg(long, env = "HUNT_DB")]
        db: Option<String>,
        /// Read mail from this JSON file instead of Gmail, for trying hunt
        /// out: {"password": "...", "messages": [...], "labels": [...]}
        #[arg(long, hide = true)]
        fake_mail: Option<PathBuf>,
        /// Several people, each with their own applications in the one
        /// database, signing in through Cloudflare Access. New people ask
        /// for an account; admins approve them
        #[arg(long, env = "HUNT_TENANTS", value_parser = clap::builder::BoolishValueParser::new(),
              action = clap::ArgAction::SetTrue)]
        tenants: bool,
        /// With --tenants: the admins, by email, comma-separated. The first
        /// keeps what the database held before
        #[arg(long, env = "HUNT_ADMINS", value_delimiter = ',')]
        admins: Vec<String>,
        /// With --tenants: your Cloudflare Zero Trust team (its name, or
        /// name.cloudflareaccess.com)
        #[arg(long, env = "HUNT_ACCESS_TEAM")]
        access_team: Option<String>,
        /// With --tenants: the Access application's audience (AUD) tag
        #[arg(long, env = "HUNT_ACCESS_AUD")]
        access_aud: Option<String>,
        /// With --tenants, instead of Access: trust this header to name who's
        /// asking. Only for trying hunt out, never where others can reach it
        #[arg(long, env = "HUNT_IDENTITY_HEADER", hide = true)]
        identity_header: Option<String>,
        /// Turn on an experiment, a feature still being tried out: `name`
        /// for everyone, or `name=you@example.com,…` for those accounts.
        /// Repeat it for several (in HUNT_EXPERIMENTS, separate them with
        /// `;`). There are none now (take-home has become a feature, and is
        /// still taken)
        #[arg(long = "experiment", env = "HUNT_EXPERIMENTS", value_delimiter = ';')]
        experiments: Vec<String>,
    },
    /// Show the board (the default)
    Board {
        /// Show every archived process, not just the last 30 days
        #[arg(long)]
        all: bool,
    },
    /// Add a process, and its application and company if they're new
    Add {
        /// The company [default: the posting's, with --link]
        company: Option<String>,
        #[arg(short, long)]
        role: Option<String>,
        /// The column to put it in [default: the first]
        #[arg(short, long)]
        stage: Option<String>,
        #[arg(long)]
        source: Option<String>,
        /// The job posting's link: what it says is filled in (Ashby,
        /// Greenhouse, Lever, Workable, LinkedIn, or a careers page)
        #[arg(long)]
        link: Option<String>,
        /// Something to do next, as a reminder
        #[arg(long)]
        next: Option<String>,
        /// When it's due: tomorrow, +3d, fri 15:00, 2026-10-09
        #[arg(long, allow_hyphen_values = true)]
        due: Option<String>,
        /// When you applied
        #[arg(long, allow_hyphen_values = true)]
        applied: Option<String>,
        /// The application this came through (an id, or a search)
        #[arg(long)]
        via: Option<String>,
    },
    /// Everything about one process
    Show { process: String },
    /// Move a process to another stage: a column of the board (reopening it
    /// if it was closed), or an inactive stage (closing it). Several
    /// at once: a comma-separated list (`globex,initech`), `tag:NAME` (the
    /// active processes of applications with that tag) or `stage:NAME`.
    Move {
        process: String,
        stage: String,
        /// Into one of the stage's lanes (e.g. accepted), by name or id
        #[arg(long)]
        lane: Option<String>,
        /// Put it at the top of the column (or lane), not the bottom
        #[arg(long)]
        top: bool,
    },
    /// Close a process, and say why: a reason's code or name, a lane of an
    /// inactive stage (`hunt list reasons`; e.g. rejected, role-filled,
    /// withdrew). It moves to that lane. Several
    /// at once, as for move: `globex,initech`, `tag:agency`, `stage:Applied`.
    #[command(visible_alias = "close")]
    Archive {
        process: String,
        reason: String,
        #[arg(short, long)]
        note: Option<String>,
    },
    /// Put a closed process back on the board
    #[command(visible_alias = "reopen")]
    Resume {
        process: String,
        /// The column [default: the one it reached]
        stage: Option<String>,
    },
    /// Add a reminder to a process: something to do next
    Next {
        process: String,
        what: String,
        #[arg(long, allow_hyphen_values = true)]
        due: Option<String>,
    },
    /// Add a note to a process
    Note { process: String, text: String },
    /// Add an interview step to a process
    Step {
        process: String,
        title: String,
        #[arg(long, allow_hyphen_values = true)]
        at: Option<String>,
        /// scheduled, done (waiting to hear), completed (nothing to
        /// hear), passed, failed, cancelled
        #[arg(long)]
        status: Option<String>,
    },
    /// Put someone on a process (created if new)
    Person {
        process: String,
        name: String,
        /// recruiter, hiring-manager, interviewer, referrer, other
        #[arg(long)]
        role: Option<String>,
    },
    /// Upload a new version of a document (made if new)
    Upload {
        /// The document: an id, or a name
        document: String,
        file: PathBuf,
        /// e.g. "rust-focused"
        #[arg(long)]
        tag: Option<String>,
        #[arg(short, long)]
        note: Option<String>,
        /// For a new document: resume, cover-letter, portfolio, reference,
        /// certificate, screenshot, job-description, assignment, offer,
        /// contract, nda, background-check, right-to-work,
        /// candidate-resource, feedback, other
        #[arg(long, default_value = "resume")]
        kind: String,
    },
    /// What's coming up: interview steps, next actions, deadlines
    Calendar {
        /// The first day [default: today]
        #[arg(long, allow_hyphen_values = true)]
        from: Option<String>,
        /// The last day [default: 30 days on]
        #[arg(long, allow_hyphen_values = true)]
        to: Option<String>,
        /// Words to find
        #[arg(short, long)]
        query: Option<String>,
        /// step, next, closes, applied, posted (comma-separated)
        #[arg(long)]
        kinds: Option<String>,
        /// Archived processes too
        #[arg(long)]
        all: bool,
    },
    /// Read what a company's website or LinkedIn page says about it, or
    /// someone's LinkedIn profile (linkedin.com/in/…)
    Lookup {
        /// The company's website, or its LinkedIn page
        #[arg(value_name = "URL")]
        page: String,
        /// Add the company, or fill in what an existing one is missing
        #[arg(long)]
        save: bool,
    },
    /// Save a version's file
    Download {
        /// The version's id (see `hunt list versions`)
        version: i64,
        /// Where to save it [default: its own name, here]
        #[arg(short, long)]
        out: Option<PathBuf>,
    },
    /// Record that a document went with a process
    Attach {
        process: String,
        /// The document: an id, or a name
        document: String,
        /// Which version [default: the latest]
        #[arg(long)]
        version: Option<i64>,
    },
    /// Take a document version off a process
    Detach { process: String, version_id: i64 },
    /// Show or change a record's tags: `+name` adds, `-name` removes, a bare
    /// name adds. Applications, companies, people and documents have tags.
    Tag {
        resource: String,
        id: i64,
        #[arg(allow_hyphen_values = true)]
        changes: Vec<String>,
    },
    /// List records: stages, lanes, companies, people, applications,
    /// processes, postings, steps, notes, documents, versions, memos, tags;
    /// or reasons, for closing (the lanes of the inactive stages).
    /// `--where tag=name` filters by tag.
    List {
        resource: String,
        /// Words to search for
        #[arg(short, long)]
        query: Option<String>,
        /// field=value filters
        #[arg(short, long = "where")]
        filter: Vec<String>,
    },
    /// Show one record's fields
    Get { resource: String, id: i64 },
    /// Create a record from field=value pairs
    New {
        resource: String,
        fields: Vec<String>,
    },
    /// Change a record: field=value pairs; field= clears
    Edit {
        resource: String,
        id: i64,
        fields: Vec<String>,
    },
    /// Delete a record
    Rm {
        resource: String,
        id: i64,
        /// For a stage with processes in it: where they go
        #[arg(long)]
        move_to: Option<String>,
    },
    /// Reorder the stages: every stage, left to right, by id or name
    Order { stages: Vec<String> },
    /// The change log, for everything or one record
    Log {
        resource: Option<String>,
        id: Option<i64>,
        #[arg(short = 'n', long, default_value_t = 30)]
        limit: usize,
    },
    /// The fields each kind of record has
    Fields { resource: Option<String> },
    /// Save everything tracked, files included, to a backup file
    Backup {
        /// Where [default: hunt-backup-<date>.json, here]
        #[arg(short, long)]
        out: Option<PathBuf>,
    },
    /// Replace everything with a backup file's contents
    Restore {
        file: PathBuf,
        /// Don't ask first
        #[arg(long)]
        yes: bool,
    },
    /// Emails about a process: add .eml files or pasted messages, list, read
    Mail {
        #[command(subcommand)]
        command: MailCommand,
    },
}

#[derive(Subcommand)]
enum MailCommand {
    /// Connect Gmail with an app password (asked for, or from
    /// $HUNT_GMAIL_APP_PASSWORD). Make one at
    /// https://myaccount.google.com/apppasswords (it needs 2-Step Verification).
    #[command(hide = true)]
    Connect {
        address: String,
        /// Sync on its own every so many minutes (0: only when asked)
        #[arg(long)]
        every: Option<i64>,
    },
    /// Forget the account (what was fetched stays)
    #[command(hide = true)]
    Disconnect,
    /// The connection, the last sync, and what waits in triage
    #[command(hide = true)]
    Status,
    /// Fetch new mail and match it to processes
    #[command(hide = true)]
    Sync,
    /// Emails waiting for a process, with suggestions
    #[command(hide = true)]
    Triage,
    /// A process's emails
    List { process: String },
    /// Read an email
    Show { email: i64 },
    /// Link an email (and the rest of its thread) to a process
    #[command(hide = true)]
    Link { email: i64, process: String },
    /// Take an email off its process, back to triage
    #[command(hide = true)]
    Unlink { email: i64 },
    /// Ignore an email; --sender or --domain: everything from them, from now on
    #[command(hide = true)]
    Ignore {
        email: i64,
        #[arg(long, conflicts_with = "domain")]
        sender: bool,
        #[arg(long)]
        domain: bool,
    },
    /// Remove an email from its process
    Rm { email: i64 },
    /// Add an email to a process: a file (.eml), or `-` for its text on
    /// stdin (e.g. `pbpaste | hunt mail import acme -` after Gmail's ⋮ →
    /// Show original → Copy to clipboard)
    Import { process: String, file: PathBuf },
    /// A process's Gmail search and label
    #[command(hide = true)]
    Search { process: String },
}

pub fn run() -> Result<()> {
    let args = Args::parse();
    let api = Client::new(&args.url);
    match args.command.unwrap_or(Command::Board { all: false }) {
        Command::Serve {
            addr,
            db,
            fake_mail,
            tenants,
            admins,
            access_team,
            access_aud,
            identity_header,
            experiments,
        } => {
            // Several people: who the admins are, and how to tell who's asking.
            let tenancy = if tenants {
                let admins: Vec<String> = admins
                    .iter()
                    .map(|a| a.trim().to_string())
                    .filter(|a| !a.is_empty())
                    .collect();
                if admins.is_empty() {
                    bail!("--tenants needs an admin: --admins you@example.com (or HUNT_ADMINS)");
                }
                let identity = match (identity_header, access_team, access_aud) {
                    (Some(h), _, _) => {
                        eprintln!(
                            "hunt: trusting the {h} header to say who's asking: only for trying hunt out"
                        );
                        hunt::tenants::IdentitySource::Header(h)
                    }
                    (None, Some(team), Some(aud)) => {
                        hunt::tenants::IdentitySource::access(&team, &aud)
                    }
                    _ => bail!(
                        "--tenants needs Cloudflare Access to say who's asking: --access-team and \
                         --access-aud (or HUNT_ACCESS_TEAM and HUNT_ACCESS_AUD)"
                    ),
                };
                Some(hunt::api::TenancyConfig { admins, identity })
            } else {
                None
            };
            let experiments = hunt::experiments::Experiments::parse(&experiments)?;
            let target = match db {
                Some(t) => t,
                None => std::env::home_dir()
                    .context("no home directory; pass --db")?
                    .join(".hunt/hunt.db")
                    .to_string_lossy()
                    .into_owned(),
            };
            let shown = hunt::db::describe(&target);
            let mut db = hunt::Db::open(&target).with_context(|| format!("opening {shown}"))?;
            if let Some(file) = fake_mail {
                let text = std::fs::read_to_string(&file)
                    .with_context(|| format!("reading {}", file.display()))?;
                db.mailbox = hunt::mail::Fake::from_json(&text)?.connector();
            }
            println!(
                "hunt on http://{addr}  (database {shown}{}, ctrl-c to stop)",
                if tenancy.is_some() {
                    ", several people"
                } else {
                    ""
                }
            );
            hunt::api::serve(db, &addr, tenancy, experiments)?;
        }
        Command::Board { all } => {
            let since = time::date(
                time::now()
                    .date()
                    .checked_sub(jiff::Span::new().days(30))
                    .unwrap_or(time::now().date()),
            );
            let q: Vec<(&str, &str)> = if all {
                vec![]
            } else {
                vec![("archived_since", since.as_str())]
            };
            print_board(&api.get("board", &q)?);
        }
        Command::Add {
            company,
            role,
            stage,
            source,
            link,
            next,
            due,
            applied,
            via,
        } => {
            let mut body = json!({});
            let b = body.as_object_mut().unwrap();
            if let Some(url) = &link {
                // What the posting says; what's given here wins.
                match api.post("applications/lookup", &json!({ "url": url })) {
                    Ok(found) => {
                        for (k, v) in found.as_object().into_iter().flatten() {
                            if !v.is_null() && k != "platform" {
                                b.insert(k.clone(), v.clone());
                            }
                        }
                        println!("read the posting from {}", s(&found["platform"]));
                    }
                    Err(e) => {
                        eprintln!("couldn't read the posting ({e}); keeping just its link");
                        b.insert("url".into(), url.clone().into());
                    }
                }
            }
            // Say so if this posting is already tracked; add it anyway.
            if let Some(url) = b.get("url").and_then(Value::as_str).or(link.as_deref()) {
                let same = api.get("applications/same-posting", &[("url", url)])?;
                for a in same.as_array().into_iter().flatten() {
                    let on_board: Vec<String> = a["processes"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .map(|p| format!("#{} {} in {}", p["id"], s(&p["status"]), s(&p["stage"])))
                        .collect();
                    eprintln!(
                        "warning: this posting is already tracked as application #{} {}{}",
                        a["id"],
                        s(&a["label"]),
                        if on_board.is_empty() {
                            String::new()
                        } else {
                            format!(" ({})", on_board.join(", "))
                        }
                    );
                }
            }
            if company.is_none() && !b.contains_key("company") {
                bail!("which company? give it, or a posting --link that names it");
            }
            put(b, "company", company);
            put(b, "title", role);
            put(b, "source", source);
            if let Some(s) = stage {
                b.insert("stage_id".into(), stage_id(&api, &s)?.into());
            }
            let due = due.map(|d| when(&d)).transpose()?.map(|d| d.as_datetime());
            if let Some(d) = applied {
                b.insert("applied_on".into(), when(&d)?.as_date().into());
            }
            if let Some(v) = via {
                b.insert("via_id".into(), find(&api, "applications", &v)?.into());
            }
            let card = api.post("processes", &body)?;
            if next.is_some() || due.is_some() {
                api.post(
                    "reminders",
                    &json!({ "process_id": card["id"], "title": next.as_deref().unwrap_or("Next action"), "due_at": due }),
                )?;
            }
            // The posting's logo for its company, if the company has none.
            if let Some(logo) = body.get("company_logo").and_then(Value::as_str) {
                let company = api.get(&format!("companies/{}", card["company_id"]), &[])?;
                if company["logo"].is_null() {
                    let _ = api.post(
                        &format!("companies/{}/logo/fetch", card["company_id"]),
                        &json!({ "url": logo }),
                    );
                }
            }
            println!("added #{} {}", card["id"], card_name(&card));
            println!("  in {}", s(&card["stage"]));
        }
        Command::Show { process } => {
            let id = find(&api, "processes", &process)?;
            print_detail(&api.get(&format!("processes/{id}/detail"), &[])?);
        }
        Command::Move {
            process,
            stage,
            lane,
            top,
        } => {
            let ids = select_processes(&api, &process)?;
            let stage = stage_id(&api, &stage)?;
            if ids.len() > 1 {
                let mut body = json!({ "ids": ids, "action": "move", "stage_id": stage });
                if let Some(lane) = lane {
                    body["lane_id"] = lane_id(&api, stage, &lane)?.into();
                }
                let res = api.post("processes/bulk", &body)?;
                println!(
                    "moved {} processes",
                    res["done"].as_array().map_or(0, Vec::len)
                );
                return Ok(());
            }
            let id = ids[0];
            let mut body = json!({ "stage_id": stage });
            if let Some(lane) = lane {
                body["lane_id"] = lane_id(&api, stage, &lane)?.into();
            }
            if top {
                body["index"] = 0.into();
            }
            let card = api.post(&format!("processes/{id}/move"), &body)?;
            match card["lane"].as_str() {
                Some(lane) => println!(
                    "#{} {} is in {} ({lane})",
                    id,
                    card_name(&card),
                    s(&card["stage"])
                ),
                None => println!("#{} {} is in {}", id, card_name(&card), s(&card["stage"])),
            }
        }
        Command::Archive {
            process,
            reason,
            note,
        } => {
            let ids = select_processes(&api, &process)?;
            if ids.len() > 1 {
                let res = api.post(
                    "processes/bulk",
                    &json!({ "ids": ids, "action": "archive", "reason": reason, "note": note }),
                )?;
                let skipped = res["skipped"].as_array().map_or(0, Vec::len);
                println!(
                    "closed {} processes ({reason}){}",
                    res["done"].as_array().map_or(0, Vec::len),
                    if skipped > 0 {
                        format!(", {skipped} already closed")
                    } else {
                        String::new()
                    }
                );
                return Ok(());
            }
            let id = ids[0];
            let mut body = json!({ "status": "archived", "archive_reason": reason });
            if note.is_some() {
                body["archive_note"] = note.into();
            }
            let p = api.patch(&format!("processes/{id}"), &body)?;
            // The reason by its name: its lane's.
            let code = s(&p["archive_reason"]).to_string();
            let meta = api.get("meta", &[])?;
            let why = meta["archive_reasons"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|r| s(&r["value"]) == code)
                .map_or(code.clone(), |r| s(&r["label"]).to_string());
            println!("closed #{id} {} ({why})", s(&p["label"]));
        }
        Command::Upload {
            document,
            file,
            tag,
            note,
            kind,
        } => {
            let data =
                std::fs::read(&file).with_context(|| format!("reading {}", file.display()))?;
            let doc = match find(&api, "documents", &document) {
                Ok(id) => id,
                Err(_) if document.parse::<i64>().is_err() => {
                    let made = api.post("documents", &json!({ "name": document, "kind": kind }))?;
                    println!("added document #{} {}", made["id"], s(&made["name"]));
                    id(&made["id"])
                }
                Err(e) => return Err(e),
            };
            let filename = file
                .file_name()
                .and_then(|n| n.to_str())
                .ok_or_else(|| anyhow!("{} has no usable file name", file.display()))?;
            let mut q = vec![("filename", filename)];
            if let Some(t) = &tag {
                q.push(("tag", t.as_str()));
            }
            if let Some(n) = &note {
                q.push(("note", n.as_str()));
            }
            let v = api.post_bytes(
                &format!("documents/{doc}/versions"),
                &q,
                "application/octet-stream",
                &data,
            )?;
            println!(
                "uploaded {} as version #{} ({})",
                filename,
                v["id"],
                s(&v["label"])
            );
        }
        Command::Calendar {
            from,
            to,
            query,
            kinds,
            all,
        } => {
            let now = time::now();
            let from = match from {
                Some(f) => when(&f)?.as_date(),
                None => time::date(now.date()),
            };
            let to = match to {
                Some(t) => when(&t)?.as_date(),
                None => time::date(
                    now.date()
                        .checked_add(jiff::Span::new().days(30))
                        .unwrap_or(now.date()),
                ),
            };
            let mut q = vec![("from", from.as_str()), ("to", to.as_str())];
            if all {
                q.push(("status", "all"));
            }
            if let Some(text) = &query {
                q.push(("q", text.as_str()));
            }
            if let Some(k) = &kinds {
                q.push(("kinds", k.as_str()));
            }
            let events = api.get("calendar", &q)?;
            let mut last_day = String::new();
            for e in events.as_array().into_iter().flatten() {
                let at = s(&e["at"]);
                let day = at.get(..10).unwrap_or(at);
                if day != last_day {
                    println!("\n{day}");
                    last_day = day.to_string();
                }
                let time = at.get(11..16).filter(|t| *t != "00:00").unwrap_or("     ");
                let kind = match s(&e["kind"]) {
                    "step" => "interview",
                    "next" => "to do",
                    "closes" => "deadline",
                    k => k,
                };
                let role = e["role"]
                    .as_str()
                    .map(|r| format!(" — {r}"))
                    .unwrap_or_default();
                println!(
                    "  {time}  {kind:<9}  {}  ({}{role})",
                    s(&e["title"]),
                    s(&e["company"])
                );
            }
            if last_day.is_empty() {
                println!("nothing from {from} to {to}");
            }
        }
        Command::Lookup { page, save } if page.contains("linkedin.com/in/") => {
            let found = api.post("people/lookup", &json!({ "url": page }))?;
            const FIELDS: [&str; 7] = [
                "name", "title", "company", "location", "linkedin", "photo", "about",
            ];
            for k in FIELDS {
                if let Some(v) = found[k].as_str() {
                    println!("{k:<9} {v}");
                }
            }
            if save {
                // The person kept with this profile, or by this name; else a new one.
                let profile = s(&found["linkedin"]).to_string();
                let name = s(&found["name"]).to_string();
                let existing = api
                    .get("people", &[("linkedin", profile.as_str())])?
                    .as_array()
                    .and_then(|a| a.first().cloned())
                    .or_else(|| {
                        api.get("people", &[("q", name.as_str())])
                            .ok()?
                            .as_array()?
                            .iter()
                            .find(|p| s(&p["name"]).eq_ignore_ascii_case(&name))
                            .cloned()
                    });
                let mut fields = Map::new();
                for k in ["name", "title", "location", "linkedin", "about"] {
                    if !found[k].is_null() && existing.as_ref().is_none_or(|p| p[k].is_null()) {
                        fields.insert(k.into(), found[k].clone());
                    }
                }
                if let Some(company) = found["company"].as_str()
                    && existing.as_ref().is_none_or(|p| p["company_id"].is_null())
                {
                    let id = match api
                        .get("companies", &[("q", company)])?
                        .as_array()
                        .into_iter()
                        .flatten()
                        .find(|c| s(&c["name"]).eq_ignore_ascii_case(company))
                    {
                        Some(c) => c["id"].clone(),
                        None => {
                            let mut body = json!({ "name": company });
                            if !found["company_linkedin"].is_null() {
                                body["linkedin"] = found["company_linkedin"].clone();
                            }
                            api.post("companies", &body)?["id"].clone()
                        }
                    };
                    fields.insert("company_id".into(), id);
                }
                let person = match &existing {
                    Some(p) if fields.is_empty() => {
                        println!("#{} {} already has all of that", p["id"], s(&p["name"]));
                        p.clone()
                    }
                    Some(p) => {
                        let keys: Vec<String> = fields.keys().cloned().collect();
                        let p =
                            api.patch(&format!("people/{}", p["id"]), &Value::Object(fields))?;
                        println!(
                            "filled in {} for #{} {}",
                            keys.join(", "),
                            p["id"],
                            s(&p["name"])
                        );
                        p
                    }
                    None => {
                        let p = api.post("people", &Value::Object(fields))?;
                        println!("added person #{} {}", p["id"], s(&p["name"]));
                        p
                    }
                };
                if let (true, Some(photo)) = (person["photo"].is_null(), found["photo"].as_str()) {
                    match api.post(
                        &format!("people/{}/photo/fetch", person["id"]),
                        &json!({ "url": photo }),
                    ) {
                        Ok(_) => println!("added their photo"),
                        Err(e) => eprintln!("couldn't add their photo: {e}"),
                    }
                }
            }
        }
        Command::Lookup { page, save } => {
            let found = api.post("companies/lookup", &json!({ "url": page }))?;
            if let Some(logo) = found["logo"].as_str() {
                println!("{:<13} {logo}", "logo");
            }
            const FIELDS: [&str; 8] = [
                "name",
                "website",
                "linkedin",
                "industry",
                "size",
                "headquarters",
                "founded",
                "description",
            ];
            for k in FIELDS {
                if let Some(v) = found[k].as_str() {
                    println!("{k:<13} {v}");
                }
            }
            if save {
                let name = found["name"].as_str().ok_or_else(|| {
                    anyhow!("no company name was found; add it with `hunt new companies`")
                })?;
                let existing = api
                    .get("companies", &[("q", name)])?
                    .as_array()
                    .into_iter()
                    .flatten()
                    .find(|c| s(&c["name"]).eq_ignore_ascii_case(name))
                    .cloned();
                let company_id = match existing {
                    // Fill in only what it's missing; what's there was chosen.
                    Some(c) => {
                        let gaps: Map<String, Value> = FIELDS
                            .iter()
                            .filter(|k| c[**k].is_null() && !found[**k].is_null())
                            .map(|k| (k.to_string(), found[*k].clone()))
                            .collect();
                        if gaps.is_empty() {
                            println!("#{} {} already has all of that", c["id"], s(&c["name"]));
                        } else {
                            let keys: Vec<String> = gaps.keys().cloned().collect();
                            api.patch(&format!("companies/{}", c["id"]), &Value::Object(gaps))?;
                            println!(
                                "filled in {} for #{} {}",
                                keys.join(", "),
                                c["id"],
                                s(&c["name"])
                            );
                        }
                        (c["logo"].is_null(), id(&c["id"]))
                    }
                    None => {
                        let body: Map<String, Value> = FIELDS
                            .iter()
                            .filter(|k| !found[**k].is_null())
                            .map(|k| (k.to_string(), found[*k].clone()))
                            .collect();
                        let made = api.post("companies", &Value::Object(body))?;
                        println!("added company #{} {}", made["id"], s(&made["name"]));
                        (true, id(&made["id"]))
                    }
                };
                // And its logo, if the page had one and the company hasn't.
                if let ((true, company), Some(logo)) = (company_id, found["logo"].as_str()) {
                    match api.post(
                        &format!("companies/{company}/logo/fetch"),
                        &json!({ "url": logo }),
                    ) {
                        Ok(_) => println!("added its logo"),
                        Err(e) => eprintln!("couldn't add its logo: {e}"),
                    }
                }
            }
        }
        Command::Download { version, out } => {
            let (data, name) = api.get_bytes(&format!("versions/{version}/file?download=1"))?;
            let path = out.unwrap_or_else(|| {
                PathBuf::from(name.unwrap_or_else(|| format!("version-{version}")))
            });
            if path.exists() {
                bail!("{} already exists; choose another with -o", path.display());
            }
            std::fs::write(&path, &data).with_context(|| format!("writing {}", path.display()))?;
            println!("saved {} ({} bytes)", path.display(), data.len());
        }
        Command::Attach {
            process,
            document,
            version,
        } => {
            let pid = find(&api, "processes", &process)?;
            let doc = find(&api, "documents", &document)?;
            let body = match version {
                Some(n) => {
                    let versions = api.get("versions", &[("document_id", &doc.to_string())])?;
                    let vid = versions
                        .as_array()
                        .into_iter()
                        .flatten()
                        .find(|v| v["number"] == n)
                        .and_then(|v| v["id"].as_i64())
                        .ok_or_else(|| anyhow!("that document has no version {n}"))?;
                    json!({ "version_id": vid })
                }
                None => json!({ "document_id": doc }),
            };
            let files = api.post(&format!("processes/{pid}/files"), &body)?;
            for f in files.as_array().into_iter().flatten() {
                println!(
                    "  #{:<4} {}  {}",
                    id(&f["id"]),
                    s(&f["label"]),
                    s(&f["filename"])
                );
            }
        }
        Command::Detach {
            process,
            version_id,
        } => {
            let pid = find(&api, "processes", &process)?;
            api.delete(&format!("processes/{pid}/files/{version_id}"), &[])?;
            println!("took version #{version_id} off #{pid}");
        }
        Command::Resume { process, stage } => {
            let id = find(&api, "processes", &process)?;
            let stage_id = match stage {
                Some(st) => stage_id(&api, &st)?,
                None => api.get(&format!("processes/{id}"), &[])?["reached_stage_id"]
                    .as_i64()
                    .unwrap_or(0),
            };
            let card = api.post(
                &format!("processes/{id}/move"),
                &json!({ "stage_id": stage_id }),
            )?;
            println!(
                "#{id} {} is back in {}",
                card_name(&card),
                s(&card["stage"])
            );
        }
        Command::Next { process, what, due } => {
            let id = find(&api, "processes", &process)?;
            let mut body = json!({ "process_id": id, "title": what });
            if let Some(d) = due {
                body["due_at"] = when(&d)?.as_datetime().into();
            }
            let r = api.post("reminders", &body)?;
            println!(
                "#{id} next: {} {}",
                s(&r["title"]),
                short_stamp(&r["due_at"])
            );
        }
        Command::Note { process, text } => {
            let id = find(&api, "processes", &process)?;
            let n = api.post("notes", &json!({ "process_id": id, "body": text }))?;
            println!("note #{} on #{id}", n["id"]);
        }
        Command::Step {
            process,
            title,
            at,
            status,
        } => {
            let id = find(&api, "processes", &process)?;
            let mut body = json!({ "process_id": id, "title": title });
            if let Some(a) = at {
                body["at"] = when(&a)?.as_datetime().into();
            }
            if status.is_some() {
                body["status"] = status.into();
            }
            let st = api.post("steps", &body)?;
            println!("step #{} {} {}", st["id"], s(&st["title"]), s(&st["at"]));
        }
        Command::Person {
            process,
            name,
            role,
        } => {
            let id = find(&api, "processes", &process)?;
            let people = api.post(
                &format!("processes/{id}/people"),
                &json!({ "name": name, "role": role }),
            )?;
            for p in people.as_array().into_iter().flatten() {
                println!("  {} {}", s(&p["name"]), opt(&p["role"]));
            }
        }
        Command::List {
            resource,
            query,
            filter,
        } => {
            let mut q: Vec<(String, String)> = Vec::new();
            if let Some(text) = query {
                q.push(("q".into(), text));
            }
            for f in filter {
                let (k, v) = f
                    .split_once('=')
                    .ok_or_else(|| anyhow!("--where takes field=value"))?;
                q.push((k.into(), v.into()));
            }
            let q: Vec<(&str, &str)> = q.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
            // Reasons for closing are lanes: those of the inactive stages.
            if resource == "reasons" {
                for r in api.get("meta", &[])?["archive_reasons"]
                    .as_array()
                    .into_iter()
                    .flatten()
                {
                    println!(
                        "{:<16} {}  ({}, lane #{})",
                        s(&r["value"]),
                        s(&r["label"]),
                        s(&r["stage"]),
                        id(&r["id"])
                    );
                }
                return Ok(());
            }
            for r in api.get(&resource, &q)?.as_array().into_iter().flatten() {
                println!("#{:<5} {}", id(&r["id"]), s(&r["label"]));
            }
        }
        Command::Tag {
            resource,
            id,
            changes,
        } => {
            let rec = api.get(&format!("{resource}/{id}"), &[])?;
            let mut tags: Vec<String> = rec["tags"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|t| t.as_str().map(String::from))
                .collect();
            if !changes.is_empty() {
                for c in &changes {
                    if let Some(name) = c.strip_prefix('-') {
                        tags.retain(|t| !t.eq_ignore_ascii_case(name.trim()));
                    } else {
                        tags.push(c.strip_prefix('+').unwrap_or(c).trim().to_string());
                    }
                }
                tags = serde_json::from_value(
                    api.put(&format!("{resource}/{id}/tags"), &json!({ "tags": tags }))?,
                )?;
            }
            println!(
                "#{id} {}: {}",
                s(&rec["label"]),
                if tags.is_empty() {
                    "no tags".into()
                } else {
                    tags.join(", ")
                }
            );
        }
        Command::Mail { command } => mail(&api, command)?,
        Command::Backup { out } => {
            let (data, name) = api.get_bytes("backup")?;
            let path = out.unwrap_or_else(|| {
                PathBuf::from(name.unwrap_or_else(|| "hunt-backup.json".into()))
            });
            if path.exists() {
                bail!("{} already exists; choose another with -o", path.display());
            }
            std::fs::write(&path, &data).with_context(|| format!("writing {}", path.display()))?;
            let counts: Value = serde_json::from_slice::<Value>(&data)
                .map(|b| b["counts"].clone())
                .unwrap_or_default();
            println!(
                "saved {} ({} processes, {} applications, {} files; {} bytes)",
                path.display(),
                id(&counts["process"]),
                id(&counts["application"]),
                id(&counts["version"]),
                data.len()
            );
        }
        Command::Restore { file, yes } => {
            let data =
                std::fs::read(&file).with_context(|| format!("reading {}", file.display()))?;
            if !yes {
                use std::io::{BufRead, IsTerminal, Write};
                if !std::io::stdin().is_terminal() {
                    bail!("restoring replaces everything; add --yes to mean it");
                }
                eprint!("Replace everything in hunt with {}? [y/N] ", file.display());
                std::io::stderr().flush().ok();
                let mut answer = String::new();
                std::io::stdin().lock().read_line(&mut answer)?;
                if !answer.trim().eq_ignore_ascii_case("y") {
                    bail!("left as it was");
                }
            }
            let counts = api.post_bytes(
                "backup",
                &[("confirm", "replace")],
                "application/json",
                &data,
            )?;
            println!(
                "restored {}: {} processes, {} applications, {} companies, {} people, {} files",
                file.display(),
                id(&counts["process"]),
                id(&counts["application"]),
                id(&counts["company"]),
                id(&counts["person"]),
                id(&counts["version"])
            );
        }
        Command::Get { resource, id } => {
            let rec = api.get(&format!("{resource}/{id}"), &[])?;
            print_record(&api, &resource, &rec)?;
        }
        Command::New { resource, fields } => {
            let body = pairs(&api, &resource, &fields)?;
            let rec = api.post(&resource, &Value::Object(body))?;
            println!("added #{} {}", rec["id"], s(&rec["label"]));
        }
        Command::Edit {
            resource,
            id,
            fields,
        } => {
            if fields.is_empty() {
                bail!("say what to change, as field=value; `hunt fields {resource}` lists them");
            }
            let body = pairs(&api, &resource, &fields)?;
            let rec = api.patch(&format!("{resource}/{id}"), &Value::Object(body))?;
            println!("updated #{id} {}", s(&rec["label"]));
        }
        Command::Rm {
            resource,
            id,
            move_to,
        } => {
            let to = move_to
                .map(|m| stage_id(&api, &m))
                .transpose()?
                .map(|i| i.to_string());
            let q: Vec<(&str, &str)> = to.iter().map(|t| ("move_to", t.as_str())).collect();
            let rec = api.delete(&format!("{resource}/{id}"), &q)?;
            println!("deleted #{id} {}", s(&rec["label"]));
        }
        Command::Order { stages } => {
            let ids = stages
                .iter()
                .map(|st| stage_id(&api, st))
                .collect::<Result<Vec<_>>>()?;
            for st in api
                .post("stages/order", &json!({ "ids": ids }))?
                .as_array()
                .into_iter()
                .flatten()
            {
                println!("#{:<3} {}", id(&st["id"]), s(&st["name"]));
            }
        }
        Command::Log {
            resource,
            id,
            limit,
        } => {
            let limit = limit.to_string();
            let mut q = vec![("limit", limit.as_str())];
            if let Some(r) = &resource {
                q.push(("entity", r.as_str()));
            }
            let id = id.map(|i| i.to_string());
            if let Some(i) = &id {
                q.push(("entity_id", i.as_str()));
            }
            for a in api.get("activity", &q)?.as_array().into_iter().flatten() {
                println!("{}  {}", short_stamp(&a["at"]), s(&a["summary"]));
            }
        }
        Command::Fields { resource } => {
            let meta = api.get("meta", &[])?;
            for r in meta["resources"].as_array().into_iter().flatten() {
                if resource
                    .as_deref()
                    .is_some_and(|want| r["name"] != want && r["entity"] != want)
                {
                    continue;
                }
                println!("{}", s(&r["name"]));
                for f in r["fields"].as_array().into_iter().flatten() {
                    let kind = match f["type"].as_str() {
                        Some("enum") => f["options"]
                            .as_array()
                            .into_iter()
                            .flatten()
                            .map(|o| s(&o[0]))
                            .collect::<Vec<_>>()
                            .join("|"),
                        Some("ref") => format!("{} id", s(&f["resource"])),
                        Some(t) => t.to_string(),
                        None => String::new(),
                    };
                    let req = if f["required"] == true {
                        " (required)"
                    } else {
                        ""
                    };
                    println!("  {:<14} {kind}{req}", s(&f["name"]));
                }
            }
        }
    }
    Ok(())
}

// --- input -------------------------------------------------------------------------

fn put(map: &mut Map<String, Value>, key: &str, v: Option<String>) {
    if let Some(v) = v {
        map.insert(key.into(), v.into());
    }
}

fn when(s: &str) -> Result<time::When> {
    Ok(time::parse_when(s, time::now())?)
}

/// A record's id from an id (`12`, `#12`) or a search that matches one.
fn mail(api: &Client, command: MailCommand) -> Result<()> {
    let line = |e: &Value| {
        format!(
            "#{:<5} {}  {:<28} {}",
            id(&e["id"]),
            s(&e["sent_at"]).get(..16).unwrap_or("").replace('T', " "),
            if e["outgoing"].as_i64() == Some(1) {
                "you".to_string()
            } else if s(&e["from_name"]).is_empty() {
                s(&e["from_addr"]).to_string()
            } else {
                s(&e["from_name"]).to_string()
            },
            s(&e["subject"])
        )
    };
    match command {
        MailCommand::Connect { address, every } => {
            let password = match std::env::var("HUNT_GMAIL_APP_PASSWORD") {
                Ok(p) if !p.trim().is_empty() => p,
                _ => read_secret("Gmail app password: ")?,
            };
            let mut body = json!({ "address": address, "password": password });
            if let Some(m) = every {
                body["interval"] = m.into();
            }
            let st = api.put("mail", &body)?;
            println!("connected {}; `hunt mail sync` to fetch", s(&st["address"]));
        }
        MailCommand::Disconnect => {
            api.delete("mail", &[])?;
            println!("disconnected");
        }
        MailCommand::Status => {
            let st = api.get("mail", &[])?;
            if st["connected"] != json!(true) {
                println!("not connected; `hunt mail connect you@gmail.com`");
                return Ok(());
            }
            println!("account   {}", s(&st["address"]));
            let every = st["interval"].as_i64().unwrap_or(0);
            println!(
                "syncs     {}",
                if every > 0 {
                    format!("every {every} min")
                } else {
                    "when asked".into()
                }
            );
            if !st["last_sync"].is_null() {
                let r = &st["last_report"];
                println!(
                    "last      {}{}",
                    s(&st["last_sync"]).replace('T', " "),
                    if st["last_error"].is_null() {
                        format!(
                            ": {} fetched, {} linked, {} to triage",
                            id(&r["fetched"]),
                            id(&r["linked"]),
                            id(&r["triage"])
                        )
                    } else {
                        format!(": failed: {}", s(&st["last_error"]))
                    }
                );
            }
            println!("triage    {}", id(&st["triage"]));
        }
        MailCommand::Sync => {
            let r = api.post("mail/sync", &json!({}))?;
            println!(
                "{} fetched, {} linked, {} to triage{}",
                id(&r["fetched"]),
                id(&r["linked"]),
                id(&r["triage"]),
                match id(&r["labels_made"]) {
                    0 => String::new(),
                    n => format!(", {n} labels made"),
                }
            );
        }
        MailCommand::Triage => {
            let all = api.get("emails", &[("status", "triage")])?;
            let all = all.as_array().cloned().unwrap_or_default();
            if all.is_empty() {
                println!("nothing waiting");
            }
            for e in all {
                println!("{}", line(&e));
                for p in e["suggested"].as_array().into_iter().flatten() {
                    println!(
                        "         → #{} {} — {}",
                        id(&p["id"]),
                        s(&p["company"]),
                        s(&p["title"])
                    );
                }
            }
        }
        MailCommand::List { process } => {
            let pid = find(api, "processes", &process)?;
            for e in api
                .get(&format!("processes/{pid}/emails"), &[])?
                .as_array()
                .into_iter()
                .flatten()
            {
                println!("{}", line(e));
            }
        }
        MailCommand::Show { email } => {
            let e = api.get(&format!("emails/{email}"), &[])?;
            println!("From:    {} <{}>", s(&e["from_name"]), s(&e["from_addr"]));
            println!("To:      {}", s(&e["to_addrs"]));
            println!("Date:    {}", s(&e["sent_at"]).replace('T', " "));
            println!("Subject: {}", s(&e["subject"]));
            if !e["gmail_url"].is_null() {
                println!("Gmail:   {}", s(&e["gmail_url"]));
            }
            println!("\n{}", s(&e["body"]));
        }
        MailCommand::Link { email, process } => {
            let pid = find(api, "processes", &process)?;
            let e = api.post(
                &format!("emails/{email}/link"),
                &json!({ "process_id": pid }),
            )?;
            println!("linked “{}” to #{pid}", s(&e["subject"]));
        }
        MailCommand::Rm { email } => {
            let e = api.delete(&format!("emails/{email}"), &[])?;
            println!("removed “{}”", s(&e["subject"]));
        }
        MailCommand::Unlink { email } => {
            let e = api.post(&format!("emails/{email}/unlink"), &json!({}))?;
            println!("“{}” is back in triage", s(&e["subject"]));
        }
        MailCommand::Ignore {
            email,
            sender,
            domain,
        } => {
            let rule = if sender {
                json!("sender")
            } else if domain {
                json!("domain")
            } else {
                Value::Null
            };
            let r = api.post(&format!("emails/{email}/ignore"), &json!({ "rule": rule }))?;
            println!("ignored {}", id(&r["ignored"]));
        }
        MailCommand::Import { process, file } => {
            let pid = find(api, "processes", &process)?;
            let data = if file.as_os_str() == "-" {
                let mut d = Vec::new();
                std::io::Read::read_to_end(&mut std::io::stdin(), &mut d)?;
                d
            } else {
                std::fs::read(&file).with_context(|| format!("reading {}", file.display()))?
            };
            let e = api.post_bytes(
                &format!("processes/{pid}/emails"),
                &[],
                "message/rfc822",
                &data,
            )?;
            println!("added “{}” to #{pid}", s(&e["subject"]));
        }
        MailCommand::Search { process } => {
            let pid = find(api, "processes", &process)?;
            let m = api.get(&format!("processes/{pid}/mail"), &[])?;
            println!(
                "label   {}",
                if m["label"].is_null() {
                    "(made at the next sync)"
                } else {
                    s(&m["label"])
                }
            );
            println!("from    {}", s(&m["since"]));
            if !m["query"].is_null() {
                println!("search  {}  (its own)", s(&m["query"]));
                println!("built   {}", s(&m["auto_query"]));
            } else {
                println!("search  {}", s(&m["auto_query"]));
            }
        }
    }
    Ok(())
}

/// A line read without echoing it, when typed at a terminal.
fn read_secret(prompt: &str) -> Result<String> {
    use std::io::{IsTerminal, Write};
    eprint!("{prompt}");
    std::io::stderr().flush().ok();
    let tty = std::io::stdin().is_terminal();
    let stty = |arg: &str| {
        if tty {
            let _ = std::process::Command::new("stty")
                .arg(arg)
                .stdin(std::process::Stdio::inherit())
                .status();
        }
    };
    stty("-echo");
    let mut line = String::new();
    let read = std::io::stdin().read_line(&mut line);
    stty("echo");
    if tty {
        eprintln!();
    }
    read?;
    Ok(line.trim().to_string())
}

fn find(api: &Client, resource: &str, text: &str) -> Result<i64> {
    if let Ok(id) = text.trim_start_matches('#').parse() {
        return Ok(id);
    }
    let found = api.get(resource, &[("q", text)])?;
    let found = found.as_array().cloned().unwrap_or_default();
    match found.as_slice() {
        [one] => Ok(one["id"].as_i64().unwrap_or(0)),
        [] => bail!("no {resource} match {text:?}"),
        many => bail!(
            "{text:?} matches several {resource}; use an id:\n{}",
            many.iter()
                .map(|r| format!("  #{} {}", r["id"], s(&r["label"])))
                .collect::<Vec<_>>()
                .join("\n")
        ),
    }
}

/// A stage's id from its id or name (or the start of its name).
/// Processes, by a comma-separated list of ids or searches, `tag:NAME` (the
/// active processes of applications tagged so) or `stage:NAME` (the active
/// processes in it). Each once, in order.
fn select_processes(api: &Client, text: &str) -> Result<Vec<i64>> {
    let mut ids: Vec<i64> = Vec::new();
    let add = |id: i64, ids: &mut Vec<i64>| {
        if !ids.contains(&id) {
            ids.push(id);
        }
    };
    for part in text.split(',').map(str::trim).filter(|p| !p.is_empty()) {
        if let Some(tag) = part.strip_prefix("tag:") {
            let apps = api.get("applications", &[("tag", tag)])?;
            for a in apps.as_array().into_iter().flatten() {
                let app = a["id"].to_string();
                let procs = api.get(
                    "processes",
                    &[("application_id", app.as_str()), ("status", "active")],
                )?;
                for p in procs.as_array().into_iter().flatten() {
                    add(p["id"].as_i64().unwrap_or(0), &mut ids);
                }
            }
        } else if let Some(stage) = part.strip_prefix("stage:") {
            let stage = stage_id(api, stage)?.to_string();
            let procs = api.get(
                "processes",
                &[("stage_id", stage.as_str()), ("status", "active")],
            )?;
            for p in procs.as_array().into_iter().flatten() {
                add(p["id"].as_i64().unwrap_or(0), &mut ids);
            }
        } else {
            add(find(api, "processes", part)?, &mut ids);
        }
    }
    if ids.is_empty() {
        bail!("no processes match {text:?}");
    }
    Ok(ids)
}

/// One of a stage's lanes, by id or name (or the start of one).
fn lane_id(api: &Client, stage: i64, text: &str) -> Result<i64> {
    if let Ok(id) = text.parse() {
        return Ok(id);
    }
    let lanes = api.get("lanes", &[("stage_id", &stage.to_string())])?;
    let lanes = lanes.as_array().cloned().unwrap_or_default();
    let want = text.to_lowercase();
    let name = |l: &Value| s(&l["name"]).to_lowercase();
    let exact: Vec<&Value> = lanes.iter().filter(|l| name(l) == want).collect();
    let prefix: Vec<&Value> = lanes
        .iter()
        .filter(|l| name(l).starts_with(&want))
        .collect();
    match (exact.as_slice(), prefix.as_slice()) {
        ([one], _) | ([], [one]) => Ok(one["id"].as_i64().unwrap_or(0)),
        _ if lanes.is_empty() => bail!("that stage has no lanes (add some in Settings)"),
        _ => bail!(
            "no single lane called {text:?}; there are {}",
            lanes
                .iter()
                .map(|l| s(&l["name"]).to_string())
                .collect::<Vec<_>>()
                .join(", ")
        ),
    }
}

fn stage_id(api: &Client, text: &str) -> Result<i64> {
    if let Ok(id) = text.parse() {
        return Ok(id);
    }
    let stages = api.get("stages", &[])?;
    let stages = stages.as_array().cloned().unwrap_or_default();
    let name = |st: &Value| s(&st["name"]).to_lowercase();
    let want = text.to_lowercase();
    let exact: Vec<&Value> = stages.iter().filter(|st| name(st) == want).collect();
    let prefix: Vec<&Value> = stages
        .iter()
        .filter(|st| name(st).starts_with(&want))
        .collect();
    match (exact.as_slice(), prefix.as_slice()) {
        ([one], _) | ([], [one]) => Ok(one["id"].as_i64().unwrap_or(0)),
        _ => bail!(
            "no single stage called {text:?}; there are {}",
            stages
                .iter()
                .map(|st| s(&st["name"]).to_string())
                .collect::<Vec<_>>()
                .join(", ")
        ),
    }
}

/// `field=value` pairs as a JSON body. Dates may be friendly (`fri`,
/// `+3d`), and a reference may be a search instead of an id.
fn pairs(api: &Client, resource: &str, fields: &[String]) -> Result<Map<String, Value>> {
    let meta = api.get("meta", &[])?;
    let spec = meta["resources"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|r| r["name"] == resource || r["entity"] == resource)
        .cloned()
        .ok_or_else(|| anyhow!("no such resource: {resource}"))?;
    let mut out = Map::new();
    for pair in fields {
        let (k, v) = pair
            .split_once('=')
            .ok_or_else(|| anyhow!("{pair:?}: write field=value"))?;
        let f = spec["fields"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|f| f["name"] == k)
            .ok_or_else(|| {
                anyhow!("{resource} have no field {k:?}; see `hunt fields {resource}`")
            })?;
        let v = v.trim();
        let value: Value = if v.is_empty() {
            Value::Null
        } else {
            match f["type"].as_str() {
                Some("date") if time::check_date(v).is_err() => when(v)?.as_date().into(),
                Some("date-time") if time::check_datetime(v).is_err() => {
                    when(v)?.as_datetime().into()
                }
                Some("ref") if v.trim_start_matches('#').parse::<i64>().is_err() => {
                    let target = s(&f["resource"]).to_string();
                    if target == "stages" {
                        stage_id(api, v)?.into()
                    } else {
                        find(api, &target, v)?.into()
                    }
                }
                _ => v.into(),
            }
        };
        out.insert(k.to_string(), value);
    }
    Ok(out)
}

// --- output ------------------------------------------------------------------------

fn s(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}

fn id(v: &Value) -> i64 {
    v.as_i64().unwrap_or(0)
}

fn opt(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::String(t) => t.clone(),
        v => v.to_string(),
    }
}

fn short_stamp(v: &Value) -> String {
    s(v).replacen('T', " ", 1).chars().take(16).collect()
}

fn card_name(c: &Value) -> String {
    match s(&c["title"]) {
        "" => s(&c["company"]).to_string(),
        t => format!("{} — {t}", s(&c["company"])),
    }
}

fn card_line(c: &Value) -> String {
    let mut line = format!("  #{:<4} {}", id(&c["id"]), card_name(c));
    if let Some(n) = c["reminder"].as_str() {
        line += &format!("  → {n}");
        if let Some(d) = c["reminder_at"].as_str() {
            line += &format!(" ({})", d.replace('T', " ").trim_end_matches(" 00:00"));
        }
    }
    if let Some(st) = c["next_step"].as_str() {
        line += &format!("  [{st} {}]", short_stamp(&c["next_step_at"]));
    }
    line
}

fn print_board(b: &Value) {
    for col in b["stages"].as_array().into_iter().flatten() {
        let cards = col["cards"].as_array().cloned().unwrap_or_default();
        println!("{} ({})", s(&col["name"]), cards.len());
        for c in &cards {
            println!("{}", card_line(c));
        }
        println!();
    }
    let archived = b["archived"].as_array().cloned().unwrap_or_default();
    let total = id(&b["archived_total"]);
    if total > 0 {
        let more = total - archived.len() as i64;
        let note = if more > 0 {
            format!(", {more} older: --all")
        } else {
            String::new()
        };
        println!("Closed ({}{note})", archived.len());
        for c in &archived {
            let why = c["archive_label"]
                .as_str()
                .unwrap_or_else(|| s(&c["stage"]));
            let mut line = format!(
                "  #{:<4} {}  ({why}, got to {}",
                id(&c["id"]),
                card_name(c),
                s(&c["reached_stage"])
            );
            if let Some(n) = c["archive_note"].as_str() {
                line += &format!(": {n}");
            }
            println!("{line})");
        }
    }
}

fn print_detail(d: &Value) {
    let c = &d["card"];
    let p = &d["process"];
    let l = &d["application"];
    println!("#{} {}", c["id"], card_name(c));
    let status = match s(&p["status"]) {
        "active" => format!("in {}", s(&c["stage"])),
        _ => format!(
            "closed (in {}){}, got to {}",
            s(&c["stage"]),
            c["archive_label"]
                .as_str()
                .map(|r| format!(": {r}"))
                .unwrap_or_default(),
            s(&c["reached_stage"])
        ),
    };
    println!("  {status}");
    for (label, v) in [
        ("next", opt(&c["reminder"])),
        ("due", short_stamp(&c["reminder_at"])),
        ("applied", opt(&p["applied_on"])),
        ("source", opt(&l["source"])),
        ("posting", opt(&l["url"])),
        ("location", opt(&l["location"])),
        ("mode", opt(&l["work_mode"])),
        ("comp", opt(&l["comp"])),
        ("note", opt(&p["note"])),
    ] {
        if !v.is_empty() {
            println!("  {label:<9} {v}");
        }
    }
    let files = d["files"].as_array().cloned().unwrap_or_default();
    if !files.is_empty() {
        println!("\nfiles sent");
        for f in &files {
            println!(
                "  #{:<4} {}  {}",
                id(&f["id"]),
                s(&f["label"]),
                s(&f["filename"])
            );
        }
    }
    let people = d["people"].as_array().cloned().unwrap_or_default();
    if !people.is_empty() {
        println!("\npeople");
        for pe in &people {
            println!(
                "  #{:<4} {} {}",
                id(&pe["id"]),
                s(&pe["name"]),
                opt(&pe["role"])
            );
        }
    }
    let steps = d["steps"].as_array().cloned().unwrap_or_default();
    if !steps.is_empty() {
        println!("\nsteps");
        for st in &steps {
            println!(
                "  #{:<4} {:<16} {} ({})",
                id(&st["id"]),
                short_stamp(&st["at"]),
                s(&st["title"]),
                s(&st["status"])
            );
        }
    }
    let notes = d["notes"].as_array().cloned().unwrap_or_default();
    if !notes.is_empty() {
        println!("\nnotes");
        for n in &notes {
            println!(
                "  #{:<4} {}  {}",
                id(&n["id"]),
                short_stamp(&n["created_at"]),
                s(&n["body"])
            );
        }
    }
    println!("\nlog");
    for a in d["activity"].as_array().into_iter().flatten().take(15) {
        println!("  {}  {}", short_stamp(&a["at"]), s(&a["summary"]));
    }
}

fn print_record(api: &Client, resource: &str, rec: &Value) -> Result<()> {
    let meta = api.get("meta", &[])?;
    let spec = meta["resources"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|r| r["name"] == resource || r["entity"] == resource)
        .cloned()
        .unwrap_or(Value::Null);
    println!("#{} {}", rec["id"], s(&rec["label"]));
    for f in spec["fields"].as_array().into_iter().flatten() {
        let name = s(&f["name"]);
        let v = opt(&rec[name]);
        if !v.is_empty() {
            println!("  {:<14} {}", name, v.replace('\n', "\n                 "));
        }
    }
    Ok(())
}
