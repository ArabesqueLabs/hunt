//! Email, matched to processes.
//!
//! hunt reads Gmail over IMAP, signed in with an app password, and fetches
//! only messages that some process's search finds. Each is matched to a
//! process by, most explicit first:
//!
//! 1. a `hunt/…` Gmail label: the process's own (hunt makes one per active
//!    process, `hunt/<Company>/<Role>`), one naming a process by `#id`, or
//!    one naming a company and perhaps a role;
//! 2. its thread: once one message of a thread is linked, the rest follow;
//! 3. the people on a process: mail from or to their addresses;
//! 4. the company: mail from or to its email domains, or from a hiring tool
//!    (Greenhouse, Ashby, Lever…) that names it;
//! 5. a process's own Gmail search, when it has one.
//!
//! When several processes fit and the role title doesn't pick one, or a
//! message only mentions a company, it isn't kept: nothing ambiguous is
//! linked by guessing, and the next sync looks at it again.
//!
//! The database is never held while the network is used: a sync plans
//! (database), fetches (network), then applies (database).

use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use crate::args;
use crate::db::Sql;
use serde::Serialize;
use serde_json::{Value, json};

use crate::db::{Db, Record, label};
use crate::error::{Error, Result, invalid};
use crate::service::res;
use crate::time;

/// Senders of hiring tools: their mail comes from them, not the company, so
/// it counts when it names the company.
pub const HIRING_TOOLS: &[&str] = &[
    "greenhouse.io",
    "greenhouse-mail.io",
    "ashbyhq.com",
    "lever.co",
    "myworkday.com",
    "workablemail.com",
    "workable.com",
    "smartrecruiters.com",
    "icims.com",
    "jobvite.com",
    "teamtailor.com",
    "teamtailor-mail.com",
    "bamboohr.com",
    "recruitee.com",
    "personio.com",
    "personio.de",
    "rippling.com",
    "gem.com",
    "linkedin.com",
];

/// Domains anyone can have an address at: never a company's.
const SHARED_DOMAINS: &[&str] = &[
    "gmail.com",
    "googlemail.com",
    "outlook.com",
    "hotmail.com",
    "live.com",
    "yahoo.com",
    "icloud.com",
    "me.com",
    "proton.me",
    "protonmail.com",
    "linkedin.com",
];

/// How far back a process's search looks, before it was added.
const LOOK_BACK_DAYS: i64 = 30;
/// Archived processes are searched for this long after their last change.
const ARCHIVED_DAYS: i64 = 90;
/// Threads keep being followed for this long after their last linked message.
const THREAD_DAYS: i64 = 180;

// --- the mailbox -----------------------------------------------------------------

/// Where mail is read from, and who as.
#[derive(Clone)]
pub struct Account {
    pub address: String,
    /// An app password, for IMAP; unused when signed in with Google.
    pub password: String,
    /// Signed in with Google: read through the Gmail API.
    pub google: Option<crate::google::Signin>,
}

/// A message as read: its Gmail ids and labels (when from Gmail), headers,
/// and text.
#[derive(Debug, Clone, Default, PartialEq, serde::Deserialize)]
#[serde(default)]
pub struct Message {
    pub gm_msgid: Option<String>,
    pub gm_thrid: Option<String>,
    pub labels: Vec<String>,
    pub message_id: Option<String>,
    pub from_addr: String,
    pub from_name: String,
    pub to: Vec<String>,
    pub cc: Vec<String>,
    pub subject: String,
    pub sent_at: String,
    pub body: String,
}

/// A search of the whole mailbox.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Search {
    /// Gmail's own search syntax.
    Query(String),
    /// The messages of a thread, by Gmail's thread id.
    Thread(String),
    /// The messages carrying a label.
    Label(String),
}

/// A mailbox: Gmail over IMAP, or one in memory for tests.
pub trait Mailbox: Send {
    /// Messages found, by UID.
    fn search(&mut self, search: &Search) -> Result<Vec<u32>>;
    /// Gmail's message id of each, to skip those already stored.
    fn ids(&mut self, uids: &[u32]) -> Result<Vec<(u32, String)>>;
    fn fetch(&mut self, uids: &[u32]) -> Result<Vec<(u32, Message)>>;
    /// Every label.
    fn labels(&mut self) -> Result<Vec<String>>;
    fn create_label(&mut self, name: &str) -> Result<()>;
    fn rename_label(&mut self, from: &str, to: &str) -> Result<()>;
}

/// Opens a mailbox, signed in. Replaceable, for tests.
pub type Connect = Arc<dyn Fn(&Account) -> Result<Box<dyn Mailbox>> + Send + Sync>;

/// Gmail: through its API when signed in with Google, over IMAP with an app
/// password otherwise.
pub fn gmail() -> Connect {
    Arc::new(|account| match &account.google {
        Some(signin) => Ok(Box::new(crate::google::GmailApi::connect(signin)?) as Box<dyn Mailbox>),
        None => Ok(Box::new(Gmail::connect(account)?) as Box<dyn Mailbox>),
    })
}

struct Gmail {
    session: imap::Session<imap::Connection>,
}

fn imap_err(e: imap::Error) -> Error {
    Error::Fetch(format!("Gmail: {e}"))
}

impl Gmail {
    fn connect(account: &Account) -> Result<Gmail> {
        let client = imap::ClientBuilder::new("imap.gmail.com", 993)
            .connect()
            .map_err(|e| Error::Fetch(format!("couldn't reach Gmail: {e}")))?;
        let mut session = client
            .login(&account.address, &account.password)
            .map_err(|(e, _)| {
                invalid(format!(
                    "Gmail didn't accept that address and app password ({e}). \
                     Is IMAP on, and is it an app password, not your Google password?"
                ))
            })?;
        // All Mail has a localised name; it's marked as \All.
        let names = session.list(Some(""), Some("*")).map_err(imap_err)?;
        let all = names
            .iter()
            .find(|n| {
                n.attributes()
                    .iter()
                    .any(|a| matches!(a, imap_proto::NameAttribute::All))
            })
            .map(|n| n.name().to_string())
            .unwrap_or_else(|| "[Gmail]/All Mail".into());
        session.examine(&all).map_err(imap_err)?;
        Ok(Gmail { session })
    }

    /// `UID FETCH`, read with imap-proto, which knows Gmail's attributes.
    fn raw_fetch(
        &mut self,
        uids: &[u32],
        items: &str,
    ) -> Result<Vec<Vec<imap_proto::AttributeValue<'static>>>> {
        let mut out = Vec::new();
        for chunk in uids.chunks(50) {
            let set: Vec<String> = chunk.iter().map(u32::to_string).collect();
            let data = self
                .session
                .run_command_and_read_response(format!("UID FETCH {} {items}", set.join(",")))
                .map_err(imap_err)?;
            let mut rest: &[u8] = &data;
            while !rest.is_empty() {
                match imap_proto::Response::from_bytes(rest) {
                    Ok((more, response)) => {
                        if let imap_proto::Response::Fetch(_, attrs) = response {
                            out.push(attrs.into_iter().map(|a| a.into_owned()).collect());
                        }
                        rest = more;
                    }
                    Err(_) => break,
                }
            }
        }
        Ok(out)
    }
}

impl Drop for Gmail {
    fn drop(&mut self) {
        let _ = self.session.logout();
    }
}

/// An IMAP quoted string.
fn quoted(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

impl Mailbox for Gmail {
    fn search(&mut self, search: &Search) -> Result<Vec<u32>> {
        let criteria = match search {
            Search::Query(q) if q.is_ascii() => format!("X-GM-RAW {}", quoted(q)),
            Search::Query(q) => format!("CHARSET UTF-8 X-GM-RAW {}", quoted(q)),
            Search::Thread(t) => format!("X-GM-THRID {t}"),
            Search::Label(l) => format!("X-GM-LABELS {}", quoted(&utf7_encode(l))),
        };
        let mut uids: Vec<u32> = self
            .session
            .uid_search(criteria)
            .map_err(imap_err)?
            .into_iter()
            .collect();
        uids.sort_unstable();
        Ok(uids)
    }

    fn ids(&mut self, uids: &[u32]) -> Result<Vec<(u32, String)>> {
        use imap_proto::AttributeValue as A;
        Ok(self
            .raw_fetch(uids, "(UID X-GM-MSGID)")?
            .into_iter()
            .filter_map(|attrs| {
                let uid = attrs.iter().find_map(|a| match a {
                    A::Uid(u) => Some(*u),
                    _ => None,
                })?;
                let id = attrs.iter().find_map(|a| match a {
                    A::GmailMsgId(m) => Some(m.to_string()),
                    _ => None,
                })?;
                Some((uid, id))
            })
            .collect())
    }

    fn fetch(&mut self, uids: &[u32]) -> Result<Vec<(u32, Message)>> {
        use imap_proto::AttributeValue as A;
        let mut out = Vec::new();
        for attrs in self.raw_fetch(
            uids,
            "(UID X-GM-MSGID X-GM-THRID X-GM-LABELS BODY.PEEK[]<0.300000>)",
        )? {
            let mut uid = None;
            let mut msg = None;
            let (mut msgid, mut thrid, mut labels) = (None, None, Vec::new());
            for a in attrs {
                match a {
                    A::Uid(u) => uid = Some(u),
                    A::GmailMsgId(m) => msgid = Some(m.to_string()),
                    A::GmailThrId(t) => thrid = Some(t.to_string()),
                    A::GmailLabels(l) => labels = l.iter().map(|x| utf7_decode(x)).collect(),
                    A::BodySection { data: Some(d), .. } => msg = parse_message(&d),
                    _ => {}
                }
            }
            if let (Some(uid), Some(mut m)) = (uid, msg) {
                m.gm_msgid = msgid;
                m.gm_thrid = thrid;
                m.labels = labels;
                out.push((uid, m));
            }
        }
        Ok(out)
    }

    fn labels(&mut self) -> Result<Vec<String>> {
        Ok(self
            .session
            .list(Some(""), Some("*"))
            .map_err(imap_err)?
            .iter()
            .map(|n| utf7_decode(n.name()))
            .collect())
    }

    fn create_label(&mut self, name: &str) -> Result<()> {
        self.session.create(utf7_encode(name)).map_err(imap_err)
    }

    fn rename_label(&mut self, from: &str, to: &str) -> Result<()> {
        self.session
            .rename(utf7_encode(from), utf7_encode(to))
            .map_err(imap_err)
    }
}

/// A mailbox in memory: for tests, and for trying hunt out without Gmail.
/// It understands enough of Gmail's search to find messages by address,
/// domain or quoted words.
#[derive(Clone, Default)]
pub struct Fake {
    pub state: Arc<Mutex<FakeState>>,
}

#[derive(Default)]
pub struct FakeState {
    /// The app password it accepts.
    pub password: String,
    /// Its messages; a message's UID is its place in this list, from 1.
    pub messages: Vec<Message>,
    pub labels: Vec<String>,
    /// What was searched for, in order.
    pub searches: Vec<Search>,
}

impl Fake {
    pub fn new(password: &str) -> Fake {
        let fake = Fake::default();
        fake.state.lock().unwrap().password = password.into();
        fake
    }

    /// A mailbox from JSON: `{"password", "messages": [Message…], "labels"}`.
    pub fn from_json(text: &str) -> Result<Fake> {
        #[derive(serde::Deserialize)]
        struct File {
            password: String,
            #[serde(default)]
            messages: Vec<Message>,
            #[serde(default)]
            labels: Vec<String>,
        }
        let f: File = serde_json::from_str(text).map_err(|e| invalid(format!("fake mail: {e}")))?;
        let fake = Fake::new(&f.password);
        {
            let mut st = fake.state.lock().unwrap();
            st.messages = f.messages;
            st.labels = f.labels;
        }
        Ok(fake)
    }

    pub fn connector(&self) -> Connect {
        let fake = self.clone();
        Arc::new(move |account| {
            if account.password != fake.state.lock().unwrap().password {
                return Err(invalid("Gmail didn't accept that address and app password"));
            }
            Ok(Box::new(fake.clone()) as Box<dyn Mailbox>)
        })
    }
}

impl Mailbox for Fake {
    fn search(&mut self, search: &Search) -> Result<Vec<u32>> {
        let mut st = self.state.lock().unwrap();
        st.searches.push(search.clone());
        let found = |m: &Message| match search {
            Search::Thread(t) => m.gm_thrid.as_deref() == Some(t),
            Search::Label(l) => m.labels.iter().any(|x| x == l),
            Search::Query(q) => {
                let addrs: Vec<&String> = std::iter::once(&m.from_addr)
                    .chain(&m.to)
                    .chain(&m.cc)
                    .collect();
                let words: Vec<&str> = q
                    .split(|c: char| c.is_whitespace() || "():{}".contains(c))
                    .filter(|w| w.contains('@') || (w.contains('.') && !w.contains('"')))
                    .collect();
                let quoted: Vec<String> = q
                    .split('"')
                    .skip(1)
                    .step_by(2)
                    .map(|s| s.to_lowercase())
                    .collect();
                let text = format!("{} {}", m.subject, m.from_name).to_lowercase();
                words.iter().any(|w| {
                    let w = w.to_lowercase();
                    addrs.iter().any(|a| {
                        **a == w || a.ends_with(&format!("@{w}")) || a.ends_with(&format!(".{w}"))
                    })
                }) || quoted.iter().any(|w| text.contains(w))
            }
        };
        Ok((1..=st.messages.len() as u32)
            .filter(|u| found(&st.messages[*u as usize - 1]))
            .collect())
    }

    fn ids(&mut self, uids: &[u32]) -> Result<Vec<(u32, String)>> {
        let st = self.state.lock().unwrap();
        Ok(uids
            .iter()
            .filter_map(|u| Some((*u, st.messages.get(*u as usize - 1)?.gm_msgid.clone()?)))
            .collect())
    }

    fn fetch(&mut self, uids: &[u32]) -> Result<Vec<(u32, Message)>> {
        let st = self.state.lock().unwrap();
        Ok(uids
            .iter()
            .filter_map(|u| Some((*u, st.messages.get(*u as usize - 1)?.clone())))
            .collect())
    }

    fn labels(&mut self) -> Result<Vec<String>> {
        Ok(self.state.lock().unwrap().labels.clone())
    }

    fn create_label(&mut self, name: &str) -> Result<()> {
        self.state.lock().unwrap().labels.push(name.into());
        Ok(())
    }

    fn rename_label(&mut self, from: &str, to: &str) -> Result<()> {
        let mut st = self.state.lock().unwrap();
        for l in st.labels.iter_mut() {
            if l == from {
                *l = to.into();
            }
        }
        for m in st.messages.iter_mut() {
            for l in m.labels.iter_mut() {
                if l == from {
                    *l = to.into();
                }
            }
        }
        Ok(())
    }
}

// --- reading messages ------------------------------------------------------------

/// Read a message (RFC 5322, as in an .eml file).
pub fn parse_message(raw: &[u8]) -> Option<Message> {
    let m = mail_parser::MessageParser::default().parse(raw)?;
    let addrs = |a: Option<&mail_parser::Address>| -> Vec<String> {
        a.map(|a| {
            a.iter()
                .filter_map(|x| x.address().map(str::to_lowercase))
                .collect()
        })
        .unwrap_or_default()
    };
    let from = m.from().and_then(|a| a.first());
    let body = m.body_text(0).map(|t| t.to_string()).unwrap_or_default();
    Some(Message {
        message_id: m
            .message_id()
            .map(|s| s.trim().trim_matches(['<', '>']).to_string()),
        from_addr: from.and_then(|f| f.address()).unwrap_or("").to_lowercase(),
        from_name: from.and_then(|f| f.name()).unwrap_or("").trim().to_string(),
        to: addrs(m.to()),
        cc: addrs(m.cc()),
        subject: m.subject().unwrap_or("").trim().to_string(),
        sent_at: m
            .date()
            .and_then(|d| local_stamp(d.to_timestamp()))
            .unwrap_or_default(),
        body: truncate(body.trim(), 20_000),
        ..Message::default()
    })
}

/// A message from a file, or pasted: Gmail's "Show original" copied whole
/// starts with its own summary, so reading starts at the first header.
pub fn parse_pasted(raw: &[u8]) -> Option<Message> {
    let usable =
        |m: &Message| !m.from_addr.is_empty() && (m.message_id.is_some() || !m.sent_at.is_empty());
    if let Some(m) = parse_message(raw).filter(usable) {
        return Some(m);
    }
    let text = String::from_utf8_lossy(raw);
    const STARTS: &[&str] = &[
        "Delivered-To:",
        "Received:",
        "Return-Path:",
        "ARC-Seal:",
        "X-Received:",
        "MIME-Version:",
        "DKIM-Signature:",
        "Message-ID:",
        "From:",
        "Date:",
    ];
    let mut at = 0;
    for line in text.split_inclusive('\n') {
        if STARTS
            .iter()
            .any(|s| line.len() >= s.len() && line[..s.len()].eq_ignore_ascii_case(s))
        {
            return parse_message(text[at..].as_bytes()).filter(usable);
        }
        at += line.len();
    }
    None
}

fn local_stamp(seconds: i64) -> Option<String> {
    let t = jiff::Timestamp::from_second(seconds).ok()?;
    Some(time::stamp(
        t.to_zoned(jiff::tz::TimeZone::system()).datetime(),
    ))
}

fn truncate(s: &str, max: usize) -> String {
    match s.char_indices().nth(max) {
        Some((i, _)) => format!("{}…", &s[..i]),
        None => s.to_string(),
    }
}

/// The new part of a message, short: quoted replies and signatures dropped.
pub fn snippet(body: &str) -> String {
    let mut lines = Vec::new();
    for line in body.lines() {
        let t = line.trim();
        let quoting = t.starts_with("On ") && t.ends_with("wrote:");
        if quoting
            || t.starts_with("-----Original Message")
            || t == "--"
            || t.starts_with("________________")
        {
            break;
        }
        if t.starts_with('>') {
            continue;
        }
        lines.push(t);
    }
    let text = lines.join(" ");
    truncate(&text.split_whitespace().collect::<Vec<_>>().join(" "), 280)
}

// --- mailbox names: IMAP's modified UTF-7 (RFC 3501 §5.1.3) --------------------------

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+,";

pub fn utf7_encode(s: &str) -> String {
    fn flush(units: &mut Vec<u16>, out: &mut String) {
        if units.is_empty() {
            return;
        }
        let bytes: Vec<u8> = units.iter().flat_map(|u| u.to_be_bytes()).collect();
        out.push('&');
        for chunk in bytes.chunks(3) {
            let n = chunk
                .iter()
                .enumerate()
                .fold(0u32, |n, (i, b)| n | (*b as u32) << (16 - 8 * i));
            for i in 0..=chunk.len() {
                out.push(B64[(n >> (18 - 6 * i) & 63) as usize] as char);
            }
        }
        out.push('-');
        units.clear();
    }
    let mut out = String::new();
    let mut units = Vec::new();
    for c in s.chars() {
        if (' '..='~').contains(&c) {
            flush(&mut units, &mut out);
            if c == '&' {
                out.push_str("&-");
            } else {
                out.push(c);
            }
        } else {
            units.extend_from_slice(c.encode_utf16(&mut [0; 2]));
        }
    }
    flush(&mut units, &mut out);
    out
}

pub fn utf7_decode(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i + 1..];
        let end = rest.find('-').unwrap_or(rest.len());
        let chunk = &rest[..end];
        rest = rest.get(end + 1..).unwrap_or("");
        if chunk.is_empty() {
            out.push('&');
            continue;
        }
        let (mut bits, mut n, mut bytes) = (0u32, 0, Vec::new());
        for c in chunk.bytes() {
            let Some(v) = B64.iter().position(|b| *b == c) else {
                continue;
            };
            bits = bits << 6 | v as u32;
            n += 6;
            if n >= 8 {
                n -= 8;
                bytes.push((bits >> n) as u8);
            }
        }
        let units: Vec<u16> = bytes
            .as_chunks::<2>()
            .0
            .iter()
            .map(|c| u16::from_be_bytes(*c))
            .collect();
        out.push_str(&String::from_utf16_lossy(&units));
    }
    out.push_str(rest);
    out
}

// --- matching --------------------------------------------------------------------

/// A process, as mail is matched to it.
#[derive(Debug, Clone, Default)]
pub struct Target {
    pub process_id: i64,
    pub company: String,
    pub role: String,
    pub active: bool,
    /// The addresses of the people on it.
    pub people: Vec<String>,
    /// Its company's email domains.
    pub domains: Vec<String>,
    /// Its Gmail label, once made.
    pub label: Option<String>,
    /// Its own Gmail search, replacing the one built.
    pub custom_query: Option<String>,
    /// Searches look from this date (YYYY-MM-DD).
    pub since: String,
}

/// What a sync knows before it starts.
#[derive(Debug, Clone, Default)]
pub struct Plan {
    /// The account's address: its mail is what you sent.
    pub account: String,
    pub targets: Vec<Target>,
    /// Every process's label, lower-cased, to its process.
    pub labels: HashMap<String, i64>,
    /// Threads with a linked message, to their process.
    pub threads: HashMap<String, i64>,
    /// Threads still followed.
    pub recent_threads: Vec<String>,
    /// Gmail message ids already stored.
    pub known: HashSet<String>,
}

/// Where a message goes.
#[derive(Debug, Clone, PartialEq)]
pub enum Verdict {
    Link(i64, &'static str),
    /// Could be about any of these: not kept, so a later sync, knowing more
    /// (a thread linked, a person added), can decide.
    Unsure(Vec<i64>, &'static str),
    Ignore(&'static str),
}

/// Lower case, words only: for comparing names.
fn norm(s: &str) -> String {
    let words: Vec<String> = s
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(String::from)
        .collect();
    format!(" {} ", words.join(" "))
}

pub(crate) fn mentions(text: &str, name: &str) -> bool {
    let name = norm(name);
    name.trim() != "" && norm(text).contains(&name)
}

fn domain_of(addr: &str) -> &str {
    addr.rsplit_once('@').map_or("", |(_, d)| d)
}

/// `addr` is at `domain` or one of its subdomains.
fn at_domain(addr: &str, domain: &str) -> bool {
    let d = domain_of(addr);
    !domain.is_empty() && (d == domain || d.ends_with(&format!(".{domain}")))
}

/// A label part: no slashes, single spaces.
fn label_part(s: &str) -> String {
    s.replace('/', "-")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

impl Plan {
    fn target(&self, id: i64) -> Option<&Target> {
        self.targets.iter().find(|t| t.process_id == id)
    }

    /// The label a process should have: `hunt/<Company>/<Role>`, with its
    /// number when another process already has that one.
    pub fn wanted_label(&self, t: &Target) -> String {
        let role = if t.role.trim().is_empty() {
            format!("#{}", t.process_id)
        } else {
            label_part(&t.role)
        };
        let base = format!("hunt/{}/{role}", label_part(&t.company));
        let taken = self
            .labels
            .get(&base.to_lowercase())
            .is_some_and(|id| *id != t.process_id)
            || self.targets.iter().any(|o| {
                o.process_id < t.process_id
                    && o.label.is_none()
                    && o.company == t.company
                    && label_part(&o.role) == label_part(&t.role)
            });
        if taken && !base.ends_with(&format!("#{}", t.process_id)) {
            format!("{base} #{}", t.process_id)
        } else {
            base
        }
    }

    /// Of several processes, the one a message is about: active ones first,
    /// then by the role named in the subject, then in the text.
    fn narrow(&self, mut ids: Vec<i64>, m: &Message) -> Vec<i64> {
        ids.sort_unstable();
        ids.dedup();
        let targets: Vec<&Target> = ids.iter().filter_map(|id| self.target(*id)).collect();
        let active: Vec<&Target> = targets.iter().copied().filter(|t| t.active).collect();
        let pool = if active.is_empty() { targets } else { active };
        if pool.len() > 1 {
            for text in [&m.subject, &m.body] {
                let named: Vec<&Target> = pool
                    .iter()
                    .copied()
                    .filter(|t| mentions(text, &t.role))
                    .collect();
                if named.len() == 1 {
                    return vec![named[0].process_id];
                }
            }
        }
        pool.iter().map(|t| t.process_id).collect()
    }

    fn decide(&self, ids: Vec<i64>, m: &Message, by: &'static str) -> Verdict {
        let ids = self.narrow(ids, m);
        match ids.as_slice() {
            [one] => Verdict::Link(*one, by),
            _ => Verdict::Unsure(ids, by),
        }
    }

    /// Match a message to a process. `hits` are the processes whose search
    /// found it.
    pub fn classify(&self, m: &Message, hits: &HashSet<i64>) -> Verdict {
        // 1. A hunt label.
        for l in &m.labels {
            let lower = l.to_lowercase();
            if !lower.starts_with("hunt/") {
                continue;
            }
            if let Some(id) = self.labels.get(&lower) {
                return Verdict::Link(*id, "label");
            }
            if let Some(id) = regex_number(l).filter(|id| self.target(*id).is_some()) {
                return Verdict::Link(id, "label");
            }
            let mut parts = l.splitn(3, '/').skip(1);
            let company = parts.next().unwrap_or("");
            let role = parts.next();
            let at_company: Vec<i64> = self
                .targets
                .iter()
                .filter(|t| norm(&t.company) == norm(company))
                .map(|t| t.process_id)
                .collect();
            let ids = match role {
                Some(r) => {
                    let named: Vec<i64> = at_company
                        .iter()
                        .copied()
                        .filter(|id| self.target(*id).is_some_and(|t| norm(&t.role) == norm(r)))
                        .collect();
                    if named.is_empty() { at_company } else { named }
                }
                None => at_company,
            };
            if !ids.is_empty() {
                return self.decide(ids, m, "label");
            }
        }
        // 2. Its thread.
        if let Some(id) = m.gm_thrid.as_ref().and_then(|t| self.threads.get(t)) {
            return Verdict::Link(*id, "thread");
        }
        let addrs: Vec<&String> = std::iter::once(&m.from_addr)
            .chain(&m.to)
            .chain(&m.cc)
            .filter(|a| !a.is_empty() && !a.eq_ignore_ascii_case(&self.account))
            .collect();
        // 3. People on a process.
        let by_person: Vec<i64> = self
            .targets
            .iter()
            .filter(|t| addrs.iter().any(|a| t.people.iter().any(|p| p == *a)))
            .map(|t| t.process_id)
            .collect();
        if !by_person.is_empty() {
            return self.decide(by_person, m, "person");
        }
        // 4. The company: its domains, or a hiring tool naming it.
        let by_domain: Vec<i64> = self
            .targets
            .iter()
            .filter(|t| {
                addrs
                    .iter()
                    .any(|a| t.domains.iter().any(|d| at_domain(a, d)))
            })
            .map(|t| t.process_id)
            .collect();
        if !by_domain.is_empty() {
            return self.decide(by_domain, m, "company");
        }
        if HIRING_TOOLS.iter().any(|d| at_domain(&m.from_addr, d)) {
            let who = format!("{} {}", m.from_name, m.subject);
            let named: Vec<i64> = self
                .targets
                .iter()
                .filter(|t| mentions(&who, &t.company))
                .map(|t| t.process_id)
                .collect();
            if !named.is_empty() {
                return self.decide(named, m, "hiring tool");
            }
        }
        // 5. A process's own search.
        let custom: Vec<i64> = hits
            .iter()
            .copied()
            .filter(|id| self.target(*id).is_some_and(|t| t.custom_query.is_some()))
            .collect();
        if !custom.is_empty() {
            return self.decide(custom, m, "search");
        }
        // Only mentions a company, or found without a reason we can see:
        // ask.
        let mut named: Vec<i64> = self
            .targets
            .iter()
            .filter(|t| mentions(&m.subject, &t.company))
            .map(|t| t.process_id)
            .collect();
        named.extend(hits.iter().copied());
        if named.is_empty() {
            return Verdict::Ignore("no match");
        }
        named.sort_unstable();
        named.dedup();
        Verdict::Unsure(self.narrow(named, m), "mention")
    }
}

/// A process number in a label: `#12`.
fn regex_number(s: &str) -> Option<i64> {
    let i = s.rfind('#')?;
    let digits: String = s[i + 1..]
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    digits.parse().ok()
}

/// The Gmail search hunt builds for a process: mail from or to its people
/// and its company's domains, a hiring tool's mail naming the company, and
/// mail whose subject names it.
pub fn auto_query(t: &Target) -> String {
    let mut parts = Vec::new();
    let who: Vec<&String> = t.people.iter().chain(&t.domains).collect();
    if !who.is_empty() {
        let w = who
            .iter()
            .map(|s| s.as_str())
            .collect::<Vec<_>>()
            .join(" OR ");
        parts.push(format!("from:({w})"));
        parts.push(format!("to:({w})"));
        parts.push(format!("cc:({w})"));
    }
    let name = t.company.replace('"', "");
    let name = name.trim();
    if !name.is_empty() {
        parts.push(format!("(from:({}) \"{name}\")", HIRING_TOOLS.join(" OR ")));
        parts.push(format!("subject:\"{name}\""));
    }
    parts.join(" OR ")
}

/// What a process is searched with: its own search or the one built, from
/// its date.
fn search_of(t: &Target) -> Option<String> {
    let q = t.custom_query.clone().unwrap_or_else(|| auto_query(t));
    (!q.trim().is_empty()).then(|| format!("({q}) after:{}", t.since.replace('-', "/")))
}

// --- syncing ---------------------------------------------------------------------

/// What a sync did.
#[derive(Debug, Clone, Default, Serialize)]
pub struct Report {
    pub fetched: usize,
    pub linked: usize,
    pub labels_made: usize,
}

struct Running(Arc<AtomicBool>);
impl Drop for Running {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// Fetch new mail and match it. One sync at a time.
pub fn sync(db: &Mutex<Db>) -> Result<Report> {
    let flag = db.lock().unwrap_or_else(|e| e.into_inner()).syncing.clone();
    if flag.swap(true, Ordering::SeqCst) {
        return Err(Error::Conflict("a sync is already running".into()));
    }
    let _running = Running(flag);
    let result = fetch_and_match(db);
    let d = db.lock().unwrap_or_else(|e| e.into_inner());
    d.set_setting("mail.last_sync", Some(&d.stamp()))?;
    match &result {
        Ok(r) => {
            d.set_setting(
                "mail.last_report",
                Some(&serde_json::to_string(r).unwrap_or_default()),
            )?;
            d.set_setting("mail.last_error", None)?;
        }
        Err(e) => d.set_setting("mail.last_error", Some(&e.to_string()))?,
    }
    result
}

fn fetch_and_match(db: &Mutex<Db>) -> Result<Report> {
    let (account, connect, mut plan) = {
        let d = db.lock().unwrap_or_else(|e| e.into_inner());
        let account = d
            .mail_account()?
            .ok_or_else(|| invalid("connect Gmail in Settings first"))?;
        (account, d.mailbox.clone(), d.mail_plan()?)
    };
    let mut mailbox = connect(&account)?;
    let mut report = Report::default();

    // Each active process gets its label; a renamed one, its label renamed.
    let mut existing: HashSet<String> = mailbox.labels()?.into_iter().collect();
    let mut new_labels = Vec::new();
    let wanted: Vec<(usize, String)> = plan
        .targets
        .iter()
        .enumerate()
        .filter(|(_, t)| t.active)
        .map(|(i, t)| (i, plan.wanted_label(t)))
        .collect();
    for (i, want) in wanted {
        let t = &mut plan.targets[i];
        match t.label.clone() {
            Some(l) if l == want => {
                if !existing.contains(&l) {
                    mailbox.create_label(&l)?;
                    report.labels_made += 1;
                    existing.insert(l);
                }
                continue;
            }
            Some(l) if existing.contains(&l) && !existing.contains(&want) => {
                mailbox.rename_label(&l, &want)?;
                existing.remove(&l);
                plan.labels.remove(&l.to_lowercase());
            }
            _ => {
                if !existing.contains(&want) {
                    mailbox.create_label(&want)?;
                    report.labels_made += 1;
                }
            }
        }
        existing.insert(want.clone());
        plan.labels.insert(want.to_lowercase(), t.process_id);
        t.label = Some(want.clone());
        new_labels.push((t.process_id, want));
    }

    // Search: each process's search, every hunt label, followed threads.
    let mut hits: HashMap<u32, HashSet<i64>> = HashMap::new();
    let mut uids = BTreeSet::new();
    for t in &plan.targets {
        if let Some(q) = search_of(t) {
            for u in mailbox.search(&Search::Query(q))? {
                hits.entry(u).or_default().insert(t.process_id);
                uids.insert(u);
            }
        }
    }
    let mut hunt_labels: Vec<&String> = existing
        .iter()
        .filter(|l| l.to_lowercase().starts_with("hunt/"))
        .collect();
    hunt_labels.sort();
    for l in hunt_labels {
        uids.extend(mailbox.search(&Search::Label(l.clone()))?);
    }
    for t in &plan.recent_threads {
        uids.extend(mailbox.search(&Search::Thread(t.clone()))?);
    }
    let uids: Vec<u32> = uids.into_iter().collect();
    let mut fresh = fetch_new(mailbox.as_mut(), &uids, &mut plan.known)?
        .into_iter()
        .map(|(u, m)| (m, hits.remove(&u).unwrap_or_default()))
        .collect::<Vec<_>>();

    // Match, while still connected: a thread linked now brings the rest of
    // it, which no search may find (a reply from someone new), and so on.
    let mut followed: HashSet<String> = plan.recent_threads.iter().cloned().collect();
    let mut matched: Vec<(Message, Verdict)> = Vec::new();
    while !fresh.is_empty() {
        fresh.sort_by(|a, b| a.0.sent_at.cmp(&b.0.sent_at));
        let mut threads = Vec::new();
        for (m, hits) in fresh.drain(..) {
            let verdict = plan.classify(&m, &hits);
            if let (Verdict::Link(id, _), Some(t)) = (&verdict, &m.gm_thrid) {
                plan.threads.insert(t.clone(), *id);
                if followed.insert(t.clone()) {
                    threads.push(t.clone());
                }
            }
            matched.push((m, verdict));
        }
        let mut more = BTreeSet::new();
        for t in threads {
            more.extend(mailbox.search(&Search::Thread(t))?);
        }
        let more: Vec<u32> = more.into_iter().collect();
        fresh = fetch_new(mailbox.as_mut(), &more, &mut plan.known)?
            .into_iter()
            .map(|(_, m)| (m, HashSet::new()))
            .collect();
    }
    drop(mailbox);

    let d = db.lock().unwrap_or_else(|e| e.into_inner());
    d.atomic(|d| {
        for (id, l) in &new_labels {
            d.exec(
                "UPDATE process SET mail_label = ?1 WHERE id = ?2",
                args![l, id],
            )?;
        }
        report.fetched = matched.len();
        let mut linked: HashMap<i64, usize> = HashMap::new();
        for (m, verdict) in &matched {
            match verdict {
                Verdict::Link(id, _) => *linked.entry(*id).or_default() += 1,
                Verdict::Unsure(..) => continue,
                Verdict::Ignore(_) => {}
            }
            d.store_email(m, verdict, &plan.account)?;
        }
        report.linked = linked.values().sum();
        let at = d.stamp();
        for (id, n) in linked {
            let p = d.get(res("processes"), id)?;
            let what = if n == 1 {
                "1 email".to_string()
            } else {
                format!("{n} emails")
            };
            d.log(
                &at,
                res("processes"),
                &p,
                "updated",
                &format!("Linked {what} from Gmail to process {}", label(&p)),
                None,
            )?;
        }
        Ok(report)
    })
}

/// Fetch what isn't stored yet, noting it as known.
fn fetch_new(
    mailbox: &mut dyn Mailbox,
    uids: &[u32],
    known: &mut HashSet<String>,
) -> Result<Vec<(u32, Message)>> {
    if uids.is_empty() {
        return Ok(Vec::new());
    }
    let new: Vec<u32> = mailbox
        .ids(uids)?
        .into_iter()
        .filter(|(_, id)| known.insert(id.clone()))
        .map(|(u, _)| u)
        .collect();
    if new.is_empty() {
        return Ok(Vec::new());
    }
    mailbox.fetch(&new)
}

// --- storing and managing --------------------------------------------------------

/// Columns of an email, without its body.
const EMAIL_COLUMNS: &str = "e.id, e.process_id, e.status, e.message_id, e.gm_thrid, e.from_addr, e.from_name, \
    e.to_addrs, e.cc_addrs, e.subject, e.snippet, e.sent_at, e.outgoing, e.labels, e.matched_by, \
    e.created_at, e.updated_at";

impl Db {
    pub(crate) fn setting(&self, key: &str) -> Result<Option<String>> {
        self.text("SELECT value FROM setting WHERE name = ?1", args![key])
    }

    pub(crate) fn set_setting(&self, key: &str, value: Option<&str>) -> Result<()> {
        match value {
            Some(v) => self.exec(
                "INSERT INTO setting (name, value) VALUES (?1, ?2) \
                 ON CONFLICT (name) DO UPDATE SET value = ?2",
                args![key, v],
            )?,
            None => self.exec("DELETE FROM setting WHERE name = ?1", args![key])?,
        };
        Ok(())
    }

    /// The Gmail account, if connected: signed in with Google, or with an
    /// app password. `HUNT_GMAIL_APP_PASSWORD`, when set, is the password,
    /// so it needn't be stored.
    pub fn mail_account(&self) -> Result<Option<Account>> {
        let address = self.setting("mail.address")?;
        if let (Some(address), Some(client), Some(refresh_token)) = (
            address.clone(),
            self.google_client()?,
            self.setting("mail.google.refresh_token")?,
        ) {
            return Ok(Some(Account {
                address,
                password: String::new(),
                google: Some(crate::google::Signin {
                    client,
                    refresh_token,
                }),
            }));
        }
        let password = std::env::var("HUNT_GMAIL_APP_PASSWORD")
            .ok()
            .filter(|p| !p.trim().is_empty())
            .or(self.setting("mail.password")?);
        Ok(match (address, password) {
            (Some(address), Some(password)) => Some(Account {
                address,
                password: password.split_whitespace().collect(),
                google: None,
            }),
            _ => None,
        })
    }

    /// The OAuth client to sign in to Google with, when one was given.
    pub fn google_client(&self) -> Result<Option<crate::google::Client>> {
        Ok(self
            .setting("mail.google.client")?
            .and_then(|c| serde_json::from_str(&c).ok()))
    }

    pub fn set_google_client(&self, client: Option<&crate::google::Client>) -> Result<()> {
        let json = client.map(|c| serde_json::to_string(c).expect("serialisable"));
        self.set_setting("mail.google.client", json.as_deref())
    }

    /// Signed in with Google: keep the account and its refresh token. An
    /// app password kept before is forgotten.
    pub fn set_google_signin(&self, address: &str, refresh_token: &str) -> Result<()> {
        self.set_setting("mail.address", Some(address))?;
        self.set_setting("mail.password", None)?;
        self.set_setting("mail.google.refresh_token", Some(refresh_token))
    }

    /// Connect with an app password, or forget the account (`None`): its
    /// password and any Google sign-in.
    pub fn set_mail_account(&self, account: Option<&Account>) -> Result<()> {
        self.set_setting("mail.google.refresh_token", None)?;
        self.set_setting("mail.address", account.map(|a| a.address.as_str()))?;
        let stored = account
            .filter(|_| std::env::var("HUNT_GMAIL_APP_PASSWORD").is_err())
            .map(|a| a.password.split_whitespace().collect::<String>());
        self.set_setting("mail.password", stored.as_deref())
    }

    /// The connection and the last sync.
    pub fn mail_status(&self) -> Result<Value> {
        let report = self
            .setting("mail.last_report")?
            .and_then(|r| serde_json::from_str::<Value>(&r).ok());
        Ok(json!({
            "address": self.setting("mail.address")?,
            "connected": self.mail_account()?.is_some(),
            "auth": match self.mail_account()? {
                Some(a) if a.google.is_some() => "google",
                Some(_) => "password",
                None => "none",
            },
            "google_client": self.google_client()?.map(|c| c.client_id),
            "password_from_env": std::env::var("HUNT_GMAIL_APP_PASSWORD").is_ok(),
            "interval": self.setting("mail.interval")?.and_then(|v| v.parse::<i64>().ok()).unwrap_or(0),
            "last_sync": self.setting("mail.last_sync")?,
            "last_report": report,
            "last_error": self.setting("mail.last_error")?,
        }))
    }

    /// Processes as mail is matched to them: active ones, and those archived
    /// lately.
    fn targets(&self, only: Option<i64>) -> Result<Vec<Target>> {
        let since = time::stamp(self.clock() - jiff::Span::new().days(ARCHIVED_DAYS));
        let rows = self.query(
            "SELECT p.id, p.status, p.created_at, p.applied_on, p.mail_query, p.mail_label, \
                    a.title, c.name AS company, c.website, c.email_domains \
             FROM process p JOIN application a ON a.id = p.application_id \
             JOIN company c ON c.id = a.company_id \
             WHERE (?1 IS NULL AND (p.status = 'active' OR p.updated_at >= ?2)) OR p.id = ?1 \
             ORDER BY p.id",
            &[only.map_or(Sql::Null, Sql::Integer), Sql::Text(since)],
        )?;
        let mut people: HashMap<i64, Vec<String>> = HashMap::new();
        for r in self.query(
            "SELECT pp.process_id, lower(trim(pe.email)) AS email FROM process_person pp \
             JOIN person pe ON pe.id = pp.person_id WHERE pe.email IS NOT NULL AND trim(pe.email) <> ''",
            &[],
        )? {
            if let (Some(id), Some(e)) = (r["process_id"].as_i64(), r["email"].as_str()) {
                people.entry(id).or_default().push(e.to_string());
            }
        }
        Ok(rows
            .into_iter()
            .map(|r| {
                let s = |k: &str| r[k].as_str().unwrap_or("").to_string();
                let mut domains: Vec<String> = s("email_domains")
                    .split(|c: char| c == ',' || c.is_whitespace())
                    .map(|d| d.trim().trim_start_matches('@').to_lowercase())
                    .filter(|d| d.contains('.'))
                    .collect();
                let site = s("website");
                if !site.is_empty() {
                    let host = crate::lookup::host_of(
                        &crate::lookup::normalize_url(&site).unwrap_or_else(|_| site.clone()),
                    );
                    domains.push(host.trim_start_matches("www.").to_lowercase());
                }
                domains.retain(|d| !d.is_empty() && !SHARED_DOMAINS.contains(&d.as_str()));
                domains.sort();
                domains.dedup();
                let first = [s("created_at"), s("applied_on")]
                    .into_iter()
                    .filter(|d| d.len() >= 10)
                    .map(|d| d[..10].to_string())
                    .min()
                    .unwrap_or_default();
                let since = jiff::civil::Date::strptime("%Y-%m-%d", &first)
                    .ok()
                    .and_then(|d| d.checked_sub(jiff::Span::new().days(LOOK_BACK_DAYS)).ok())
                    .map(time::date)
                    .unwrap_or(first);
                let id = r["id"].as_i64().unwrap_or(0);
                Target {
                    process_id: id,
                    company: s("company"),
                    role: s("title"),
                    active: s("status") == "active",
                    people: people.remove(&id).unwrap_or_default(),
                    domains,
                    label: r["mail_label"].as_str().map(String::from),
                    custom_query: r["mail_query"]
                        .as_str()
                        .filter(|q| !q.trim().is_empty())
                        .map(String::from),
                    since,
                }
            })
            .collect())
    }

    /// Everything a sync needs to know first.
    pub fn mail_plan(&self) -> Result<Plan> {
        let mut plan = Plan {
            account: self
                .setting("mail.address")?
                .unwrap_or_default()
                .to_lowercase(),
            targets: self.targets(None)?,
            ..Plan::default()
        };
        for r in self.query(
            "SELECT id, mail_label FROM process WHERE mail_label IS NOT NULL",
            &[],
        )? {
            if let (Some(id), Some(l)) = (r["id"].as_i64(), r["mail_label"].as_str()) {
                plan.labels.insert(l.to_lowercase(), id);
            }
        }
        let recent = time::stamp(self.clock() - jiff::Span::new().days(THREAD_DAYS));
        for r in self.query(
            "SELECT gm_thrid, max(process_id) AS process_id, max(sent_at) AS last FROM email \
             WHERE status = 'linked' AND gm_thrid IS NOT NULL GROUP BY gm_thrid",
            &[],
        )? {
            if let (Some(t), Some(id)) = (r["gm_thrid"].as_str(), r["process_id"].as_i64()) {
                plan.threads.insert(t.to_string(), id);
                if r["last"].as_str().is_some_and(|l| l >= recent.as_str()) {
                    plan.recent_threads.push(t.to_string());
                }
            }
        }
        for r in self.query("SELECT gm_msgid FROM email WHERE gm_msgid IS NOT NULL", &[])? {
            if let Some(id) = r["gm_msgid"].as_str() {
                plan.known.insert(id.to_string());
            }
        }
        Ok(plan)
    }

    /// A process's mail settings: the search hunt builds, its own, its label.
    pub fn process_mail(&self, id: i64) -> Result<Value> {
        let t = self
            .targets(Some(id))?
            .pop()
            .ok_or_else(|| Error::NotFound(format!("no process #{id}")))?;
        Ok(json!({
            "auto_query": auto_query(&t),
            "query": t.custom_query,
            "since": t.since,
            "label": t.label,
            "domains": t.domains,
            "people": t.people,
        }))
    }

    /// Keep a message, as the verdict says. One already kept (the same
    /// Message-ID, from a dropped file) gets the Gmail ids instead.
    fn store_email(&self, m: &Message, verdict: &Verdict, account: &str) -> Result<i64> {
        let (status, process_id, by) = match verdict {
            Verdict::Link(id, by) => ("linked", Some(*id), *by),
            Verdict::Unsure(_, by) | Verdict::Ignore(by) => ("ignored", None, *by),
        };
        if let Some(mid) = &m.message_id {
            let existing = self.int("SELECT id FROM email WHERE message_id = ?1", args![mid])?;
            if existing > 0 {
                let id = existing;
                self.exec(
                    "UPDATE email SET gm_msgid = ?1, gm_thrid = ?2, labels = ?3 WHERE id = ?4",
                    args![m.gm_msgid, m.gm_thrid, json!(m.labels).to_string(), id],
                )?;
                return Ok(id);
            }
        }
        let at = self.stamp();
        let sent = if m.sent_at.is_empty() {
            at.clone()
        } else {
            m.sent_at.clone()
        };
        let outgoing = !account.is_empty() && m.from_addr.eq_ignore_ascii_case(account);
        self.insert(
            "INSERT INTO email (process_id, status, message_id, gm_msgid, gm_thrid, from_addr, from_name, \
               to_addrs, cc_addrs, subject, snippet, body, sent_at, outgoing, labels, matched_by, \
               created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?17)",
            args![
                process_id,
                status,
                m.message_id,
                m.gm_msgid,
                m.gm_thrid,
                m.from_addr,
                m.from_name,
                m.to.join(", "),
                m.cc.join(", "),
                m.subject,
                snippet(&m.body),
                m.body,
                sent,
                outgoing,
                json!(m.labels).to_string(),
                by,
                at
            ],
        )
    }

    /// Emails: by status, or a process's. With each, a link to it in Gmail.
    pub fn emails(&self, status: Option<&str>, process_id: Option<i64>) -> Result<Vec<Record>> {
        let mut rows = self.query(
            &format!(
                "SELECT {EMAIL_COLUMNS} FROM email e \
                 WHERE (?1 IS NULL OR e.status = ?1) AND (?2 IS NULL OR e.process_id = ?2) \
                 ORDER BY e.sent_at DESC, e.id DESC"
            ),
            &[
                status.map_or(Sql::Null, |s| Sql::Text(s.into())),
                process_id.map_or(Sql::Null, Sql::Integer),
            ],
        )?;
        self.dress_emails(&mut rows)?;
        Ok(rows)
    }

    pub fn email(&self, id: i64) -> Result<Record> {
        let mut rows = self.query(
            "SELECT e.* FROM email e WHERE e.id = ?1",
            &[Sql::Integer(id)],
        )?;
        self.dress_emails(&mut rows)?;
        rows.pop()
            .ok_or_else(|| Error::NotFound(format!("no email #{id}")))
    }

    fn dress_emails(&self, rows: &mut [Record]) -> Result<()> {
        let address = self.setting("mail.address")?;
        for r in rows.iter_mut() {
            if let Some(mid) = r.get("message_id").and_then(Value::as_str) {
                let who = address
                    .as_deref()
                    .map(|a| format!("?authuser={}", enc(a)))
                    .unwrap_or_default();
                r.insert(
                    "gmail_url".into(),
                    json!(format!(
                        "https://mail.google.com/mail/{who}#search/rfc822msgid%3A{}",
                        enc(mid)
                    )),
                );
            }
            r.insert(
                "labels".into(),
                r.get("labels")
                    .and_then(Value::as_str)
                    .and_then(|s| serde_json::from_str::<Value>(s).ok())
                    .unwrap_or(json!([])),
            );
        }
        Ok(())
    }

    /// Link an email to a process.
    pub fn link_email(&self, id: i64, process_id: i64) -> Result<Record> {
        self.atomic(|db| {
            let e = db.email(id)?;
            let p = db.get(res("processes"), process_id)?;
            let at = db.stamp();
            db.exec(
                "UPDATE email SET status = 'linked', process_id = ?1, matched_by = 'you', \
                 updated_at = ?2 WHERE id = ?3",
                args![process_id, at, id],
            )?;
            let subject = e["subject"].as_str().unwrap_or("");
            db.log(
                &at,
                res("processes"),
                &p,
                "updated",
                &format!("Linked email “{subject}” to process {}", label(&p)),
                None,
            )?;
            db.email(id)
        })
    }

    /// Remove an email kept with a process.
    pub fn delete_email(&self, id: i64) -> Result<Record> {
        self.atomic(|db| {
            let e = db.email(id)?;
            if let Some(pid) = e["process_id"].as_i64() {
                let p = db.get(res("processes"), pid)?;
                db.log(
                    &db.stamp(),
                    res("processes"),
                    &p,
                    "updated",
                    &format!(
                        "Removed email “{}” from process {}",
                        e["subject"].as_str().unwrap_or(""),
                        label(&p)
                    ),
                    None,
                )?;
            }
            db.exec("DELETE FROM email WHERE id = ?1", args![id])?;
            Ok(e)
        })
    }

    /// Keep a message from a file (.eml) with a process. One already kept
    /// (the same Message-ID) is linked to it instead.
    pub fn import_email(&self, process_id: i64, raw: &[u8]) -> Result<Record> {
        let m = parse_pasted(raw).ok_or_else(|| {
            invalid(
                "that isn't an email: give an .eml file, or the text of Gmail's ⋮ → Show original",
            )
        })?;
        self.atomic(|db| {
            db.get(res("processes"), process_id)?;
            let account = db
                .setting("mail.address")?
                .unwrap_or_default()
                .to_lowercase();
            let id = db.store_email(&m, &Verdict::Link(process_id, "file"), &account)?;
            db.link_email(id, process_id)?;
            db.exec(
                "UPDATE email SET matched_by = 'file' WHERE id = ?1",
                args![id],
            )?;
            db.email(id)
        })
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn target(id: i64, company: &str, role: &str) -> Target {
        Target {
            process_id: id,
            company: company.into(),
            role: role.into(),
            active: true,
            domains: vec![format!("{}.com", company.to_lowercase())],
            since: "2026-09-01".into(),
            ..Target::default()
        }
    }

    fn msg(from: &str, subject: &str) -> Message {
        Message {
            from_addr: from.into(),
            subject: subject.into(),
            ..Message::default()
        }
    }

    #[test]
    fn pasted_from_show_original() {
        let page = "Original message\nMessage ID\t<x1@acme.com>\nCreated at:\tTue, Oct 6, 2026\n\
                    From:\tDana <dana@acme.com>\nDownload original\tCopy to clipboard\n\
                    Delivered-To: me@gmail.com\nMessage-ID: <x1@acme.com>\nFrom: \"Dana\" <dana@acme.com>\n\
                    To: me@gmail.com\nSubject: Offer\nDate: Tue, 06 Oct 2026 10:00:00 +0000\n\nWe'd love to have you.\n";
        let m = parse_pasted(page.as_bytes()).unwrap();
        assert_eq!(
            (m.subject.as_str(), m.from_addr.as_str()),
            ("Offer", "dana@acme.com")
        );
        assert_eq!(m.message_id.as_deref(), Some("x1@acme.com"));
        assert!(parse_pasted(b"just some words").is_none());
    }

    #[test]
    fn mailbox_names() {
        assert_eq!(utf7_encode("hunt/Société/R&D"), "hunt/Soci&AOk-t&AOk-/R&-D");
        assert_eq!(utf7_decode("hunt/Soci&AOk-t&AOk-/R&-D"), "hunt/Société/R&D");
        assert_eq!(utf7_decode(&utf7_encode("日本語 🎉")), "日本語 🎉");
    }

    #[test]
    fn the_new_part_of_a_message() {
        let body = "Hi Mosab,\n\nCould you do Friday?\n\nThanks\n\nOn Mon, 5 Oct 2026, Sam wrote:\n> earlier";
        assert_eq!(snippet(body), "Hi Mosab, Could you do Friday? Thanks");
    }

    #[test]
    fn matching() {
        let mut staff = target(1, "Acme", "Staff Engineer");
        staff.people = vec!["sam@gmail.com".into()];
        let plan = Plan {
            account: "me@gmail.com".into(),
            targets: vec![
                staff,
                target(2, "Acme", "Platform Engineer"),
                target(3, "Globex", "SRE"),
            ],
            labels: HashMap::from([("hunt/acme/staff engineer".into(), 1)]),
            threads: HashMap::from([("t9".into(), 3)]),
            ..Plan::default()
        };
        let none = HashSet::new();
        let v = |m: &Message| plan.classify(m, &none);
        assert_eq!(
            v(&msg("jo@globex.com", "Next steps")),
            Verdict::Link(3, "company")
        );
        assert_eq!(
            v(&msg("sam@gmail.com", "Chat?")),
            Verdict::Link(1, "person")
        );
        assert_eq!(
            v(&msg("jobs@acme.com", "Your application: Platform Engineer")),
            Verdict::Link(2, "company")
        );
        assert_eq!(
            v(&msg("jobs@acme.com", "Thanks")),
            Verdict::Unsure(vec![1, 2], "company")
        );
        let mut tool = msg("no-reply@us.greenhouse-mail.io", "Thank you for applying");
        tool.from_name = "Acme Hiring".into();
        assert_eq!(v(&tool), Verdict::Unsure(vec![1, 2], "hiring tool"));
        assert_eq!(
            v(&msg("news@techcrunch.com", "Acme raises")),
            Verdict::Unsure(vec![1, 2], "mention")
        );
        assert_eq!(
            v(&msg("news@techcrunch.com", "Other news")),
            Verdict::Ignore("no match")
        );
        let mut reply = msg("someone@else.com", "Re: Next steps");
        reply.gm_thrid = Some("t9".into());
        assert_eq!(v(&reply), Verdict::Link(3, "thread"));
        let mut labelled = msg("someone@else.com", "Fwd");
        labelled.labels = vec!["hunt/Acme/Staff Engineer".into()];
        assert_eq!(v(&labelled), Verdict::Link(1, "label"));
        labelled.labels = vec!["hunt/Acme/Platform engineer".into()];
        assert_eq!(v(&labelled), Verdict::Link(2, "label"));
        labelled.labels = vec!["hunt/Acme".into()];
        assert_eq!(v(&labelled), Verdict::Unsure(vec![1, 2], "label"));
        labelled.labels = vec!["hunt/whatever #3".into()];
        assert_eq!(v(&labelled), Verdict::Link(3, "label"));
        // Your own address doesn't count as a match.
        assert_eq!(
            v(&msg("me@gmail.com", "Hello")),
            Verdict::Ignore("no match")
        );
    }

    #[test]
    fn labels_and_searches() {
        let mut plan = Plan {
            targets: vec![
                target(1, "Acme", "SRE"),
                target(2, "Acme", "SRE"),
                target(3, "A/B", ""),
            ],
            ..Plan::default()
        };
        assert_eq!(plan.wanted_label(&plan.targets[0].clone()), "hunt/Acme/SRE");
        assert_eq!(
            plan.wanted_label(&plan.targets[1].clone()),
            "hunt/Acme/SRE #2"
        );
        assert_eq!(plan.wanted_label(&plan.targets[2].clone()), "hunt/A-B/#3");
        plan.targets[0].people = vec!["sam@x.io".into()];
        let q = auto_query(&plan.targets[0]);
        assert!(
            q.starts_with("from:(sam@x.io OR acme.com) OR to:(sam@x.io OR acme.com)"),
            "{q}"
        );
        assert!(q.ends_with("subject:\"Acme\""), "{q}");
        assert!(
            search_of(&plan.targets[0])
                .unwrap()
                .ends_with(") after:2026/09/01")
        );
    }
}
