// The application page: one application on a page of its own
// (/applications/ID). The board's cards and the Applications list both open
// it. It reads first; each section has an Edit of its own (the role and
// company, the posting links, about the job, pay, notes, the timeline's
// interviews and notes), which turns it into a form whose changes are
// saved together, or discarded. What acts as you go (people, files sent,
// links, emails) is changed in place.
//
// A section's Edit works on a draft: the fields' inputs write into it as
// they're typed, and Save sends what differs from how it was.

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { attempt, del, get, patch, post, put } from "../lib/api";
import { cycleById, loadCycles, runningCycles } from "../lib/cycles";
import { LOC, fmtDay, fmtSize, fmtStamp, HOME, isOverdue, isoToday, parseLocal, zonedNow } from "../lib/format";
import { R, closedWhy, listOf, optionLabel } from "../lib/meta";
import { go, route, setLeaveGuard } from "../lib/router";
import { baseTitle } from "../lib/shell";
import { store } from "../lib/storage";
import { t } from "../lib/i18n";
import { toast } from "../lib/toast";
import type { Row } from "../lib/types";
import { mayDiscard } from "../lib/unsaved";
import { MenuButton, MenuItem } from "../components/Menu";
import { askArchive, closingLabel } from "../components/closing";
import { Combo, type ComboItem } from "../components/Combo";
import { DatePicker } from "../components/DatePicker";
import { closeModal, confirmDelete, dismissModal, openModal, pushDialog } from "../components/dialogs";
import { refSource } from "../components/fields";
import { FileDrop, acceptFile, uploadVersion, useFileDrop } from "../components/files";
import { looksLikeProfile, openImport, personFromProfile, POSTING_FIELDS, postingImport } from "../components/importer";
import { warnIfSamePosting } from "../components/NewApplication";
import { RichText, RichView } from "../components/RichText";
import { isRich, toPlain } from "../lib/rich";
import { TagEditor } from "../components/tags";
import { Field, Icon, Input, Label, LoadingPage, Logo, Notice, Optional, Photo, Select, Table, TextArea, dotted } from "../components/ui";
import { acceptOffer, atOffer, isAcceptedLane } from "./Celebrate";
import { PRIORITY_ORDER, isDone, openPrepAdding, prepState } from "./Prep";
import { PayPanel } from "./TakeHome";

// ---- formatting text that was pasted in ---------------------------------------

const URL_RE = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

/** Text with its links made clickable. */
function linkify(text: string): ReactNode[] {
  return String(text).split(URL_RE).map((part, i) => (i % 2
    ? <a key={i} href={part} target="_blank" rel="noreferrer">{part}</a>
    : part));
}

const BULLET = /^\s*(?:[-*•·▪‣–]|\d{1,2}[.)])\s+/;

/**
 * A posting's first few sentences, for reading at a glance, and whether
 * there's more: the headings it opens with are left out, it stops at its
 * first list, and its lines run together.
 */
function postingLead(text: string, sentences = 3): { lead: string; more: boolean } {
  const lines = String(text).split(/\n+/).map((l) => l.trim()).filter(Boolean);
  while (lines.length > 1 && lines[0].length <= 60 && !/[.!?]$/.test(lines[0])) lines.shift();
  // Up to its first list: a list's items aren't sentences.
  const list = lines.findIndex((l, i) => i && (BULLET.test(l) || (l.endsWith(":") && l.length <= 60)));
  const flat = (list > 0 ? lines.slice(0, list) : lines).map((l) => l.replace(BULLET, "")).join(" ").replace(/\s+/g, " ");
  let lead = (flat.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) || [flat]).slice(0, sentences).join("").trim();
  if (lead.length > 480) lead = `${lead.slice(0, 440).replace(/\s+\S*$/, "")}…`;
  const all = String(text).replace(/\s+/g, " ").trim();
  return { lead, more: lead.replace(/…$/, "").length < all.length - 1 };
}

/**
 * A job posting's text, as paragraphs, lists and headings: blank lines end
 * paragraphs; lines starting with a bullet or number are list items; a
 * short line ending in a colon, or in capitals, before more text is a
 * heading.
 */
function formatPosting(text: string): ReactNode[] {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushPara = () => {
    if (para.length) { const p = para; out.push(<p key={out.length}>{p.map((l, i) => <Fragment key={i}>{i ? <br /> : null}{linkify(l)}</Fragment>)}</p>); para = []; }
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((x, i) => <li key={i}>{linkify(x)}</li>);
    out.push(list.ordered ? <ol key={out.length}>{items}</ol> : <ul key={out.length}>{items}</ul>);
    list = null;
  };
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) { flushPara(); flushList(); return; }
    const bullet = line.match(BULLET);
    if (bullet) {
      flushPara();
      const ordered = /\d/.test(bullet[0]);
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] }; }
      list!.items.push(line.slice(bullet[0].length));
      return;
    }
    const next = (lines[i + 1] || "").trim();
    const heading = line.length <= 60 && !/[.!?]$/.test(line)
      && (line.endsWith(":") || (line === line.toUpperCase() && /[A-Z]/.test(line)) || (!para.length && BULLET.test(next))
        || (!para.length && line.split(/\s+/).length <= 6 && next.length > 2 * line.length));
    if (heading && (next || lines[i + 2])) {
      flushPara(); flushList();
      out.push(<h3 key={out.length}>{line.replace(/:$/, "")}</h3>);
      return;
    }
    flushList();
    para.push(line);
  });
  flushPara(); flushList();
  return out;
}

/** An email's text: quoted lines (">") folded into a muted quote, links clickable. */
function formatEmail(text: string): ReactNode[] {
  const parts: ({ plain: string } | { quote: string[] })[] = [];
  let quote: string[] | null = null;
  let plain: string[] = [];
  const flush = () => { if (plain.length) { parts.push({ plain: plain.join("\n") }); plain = []; } };
  for (const line of String(text).replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*>/.test(line)) {
      flush();
      if (!quote) { quote = []; parts.push({ quote }); }
      quote.push(line.replace(/^\s*>\s?/, ""));
    } else {
      if (quote && !line.trim()) continue;
      quote = null;
      plain.push(line);
    }
  }
  flush();
  return parts.map((x, i) => ("plain" in x
    ? <div key={i} className="email-plain">{linkify(x.plain)}</div>
    : <blockquote key={i} className="email-quote">{linkify(x.quote.join("\n"))}</blockquote>));
}

/** Now, as a local date and time: when a posting was last read. */
function localNow() {
  return `${isoToday()}T${zonedNow().toTimeString().slice(0, 5)}`;
}

/** A link's site: `jobs.ashbyhq.com`. */
const hostOf = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").split(/[/?#]/)[0];

/** A kept link's name, if it has one: the API's label is its address when it hasn't. */
const linkName = (l: Row): string | null => (l.label && l.label !== l.url ? l.label : null);

interface PostingLink { key: string | number; url: string; text: string | null; label?: string | null }
interface Read extends PostingLink { found?: Row; error?: string }

/**
 * Read an application's posting links, all at once, and choose what to keep.
 * `links`: [{key, url, text}], `key` being "main" (the application's own) or
 * a posting's id. Each field a link has something new for is a row: what's
 * there now, then what each link says, one to choose; a row where they
 * disagree is marked. Each link's text is kept for that link, if ticked.
 * `apply({fields, texts, read})`: the fields chosen, the texts kept (by
 * key), and every link that was read.
 */
function openPostingReview({ links, current, apply }: { links: PostingLink[]; current: Row; apply: (r: { fields: Row; texts: Row; read: Read[] }) => unknown }) {
  pushDialog({ className: "al-dialog al-dialog--md ask import posting-review", render: (close) => <PostingReview links={links} current={current} apply={apply} close={close} /> });
}

function PostingReview({ links, current, apply, close }: { links: PostingLink[]; current: Row; apply: (r: { fields: Row; texts: Row; read: Read[] }) => unknown; close: () => void }) {
  const [read, setRead] = useState<Read[] | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [kept, setKept] = useState<Set<string>>(new Set());
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    Promise.all(links.map((l) => post("applications/lookup", { url: l.url })
      .then((found) => ({ ...l, found }), (err) => ({ ...l, error: err.message }))))
      .then((r) => { if (box.current?.closest("dialog")?.open) setRead(r); });
  }, []);
  const ok = (read || []).filter((r) => r.found);
  const filled = (v: unknown) => v != null && v !== "";
  const same = (a: unknown, b: unknown) => String(a ?? "") === String(b ?? "");
  const keys = POSTING_FIELDS.filter((k) => !["url", "description"].includes(k) && ok.some((r) => filled(r.found![k]) && !same(r.found![k], current[k])));
  const texts = ok.filter((r) => filled(r.found!.description) && !same(r.found!.description, r.text));
  // Each field starts on what's there, unless it's empty: then the first link's.
  useEffect(() => {
    if (!read) return;
    setPicks(Object.fromEntries(keys.map((k) => [k, filled(current[k]) ? "now" : String(ok.findIndex((r) => filled(r.found![k])))])));
    setKept(new Set(texts.map((r) => String(r.key))));
    // Nothing new: still, they were read now.
    if (!keys.length && !texts.length && ok.length) apply({ fields: {}, texts: {}, read: ok });
  }, [read]);
  const title = links.length > 1 ? "Refresh from the postings" : "Refresh from the posting";
  if (!read) {
    return <div className="al-dialog__inner" ref={box}><h2 className="al-dialog__title">{title}</h2>
      <div className="import-result"><p className="muted">{links.length > 1 ? `Reading ${links.length} postings…` : "Reading the posting…"}</p></div></div>;
  }
  const fields = R("applications").fields;
  // A link by where it is; by its address too when two are on one site.
  const base = (r: Read) => r.label || (r.found?.platform && r.found.platform !== "the page" ? r.found.platform : hostOf(r.url));
  const name = (r: Read) => (ok.filter((x) => base(x) === base(r)).length > 1
    ? r.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").slice(0, 48) : base(r));
  const show = (k: string, v: any): ReactNode => {
    if (!filled(v)) return <span className="muted">—</span>;
    const f = fields.find((x) => x.name === k);
    if (f?.type === "enum") return optionLabel(f.options, v);
    if (f?.type === "number") return Number(v).toLocaleString(LOC());
    if (f?.type === "date") return fmtDay(v);
    return String(v);
  };
  const failed = read.filter((r) => r.error).map((r) => <Notice key={r.url} kind="danger" role="alert">{`${hostOf(r.url)}: ${r.error}`}</Notice>);
  const label = (k: string) => fields.find((f) => f.name === k)?.label || k;
  return (
    <div className="al-dialog__inner" ref={box}>
      <h2 className="al-dialog__title">{title}</h2>
      <div className="import-result">
        {failed}
        {!keys.length && !texts.length ? <>
          {ok.length ? <p>{ok.length > 1 ? "Nothing new: the postings say what's already here." : "Nothing new: the posting says what's already here."}</p> : null}
          <div className="actions"><button className="al-button" type="button" onClick={close}>Close</button></div>
        </> : <>
          <p className="muted small">{keys.length
            ? `Choose one for each field: what's there now, or what ${ok.length > 1 ? "a link" : "the link"} says.${ok.length > 1 ? " ≠ marks where they disagree." : ""}`
            : ""}</p>
          {keys.length ? (
            <div className="al-table-wrap">
              <Table className="import-table posting-choices">
                <thead><tr><th>Field</th><th>Now</th>{ok.map((r) => <th key={String(r.key)}><a href={r.url} target="_blank" rel="noreferrer">{name(r)}</a></th>)}</tr></thead>
                <tbody>
                  {keys.map((k) => {
                    // Marked when the links themselves disagree.
                    const differ = new Set(ok.map((r) => r.found![k]).filter(filled).map(String)).size > 1;
                    const choice = (value: string, lbl: string, shown: ReactNode) => (
                      <label className="choice al-choice">
                        <input type="radio" name={`pick-${k}`} value={value} checked={picks[k] === value} onChange={() => setPicks({ ...picks, [k]: value })} aria-label={`${label(k)}: ${lbl}`} />{shown}
                      </label>
                    );
                    return (
                      <tr key={k} className={differ ? "differ" : undefined}>
                        <th scope="row">{label(k)}{differ ? <span className="differ-mark" title="The links disagree"> ≠</span> : null}</th>
                        <td>{choice("now", "keep", show(k, current[k]))}</td>
                        {ok.map((r, i) => <td key={String(r.key)}>{filled(r.found![k]) ? choice(String(i), name(r), show(k, r.found![k])) : <span className="muted">—</span>}</td>)}
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          ) : null}
          {/* Each link's own text: kept for it, when it's new. */}
          {texts.length ? (
            <div className="posting-texts">
              {texts.map((r) => (
                <label key={String(r.key)} className="check al-choice">
                  <input type="checkbox" checked={kept.has(String(r.key))} onChange={(e) => {
                    const next = new Set(kept);
                    if (e.target.checked) next.add(String(r.key)); else next.delete(String(r.key));
                    setKept(next);
                  }} />
                  {` The posting text from ${name(r)}${r.text ? " (it has changed)" : ""}`}
                </label>
              ))}
            </div>
          ) : null}
          <div className="actions">
            <button className="al-button" type="button" onClick={close}>Cancel</button>
            <button className="al-button al-button--primary" type="button" onClick={async () => {
              const chosen: Row = {};
              for (const k of keys) {
                const v = picks[k];
                if (v && v !== "now") chosen[k] = ok[Number(v)].found![k];
              }
              const keptTexts: Row = {};
              for (const r of texts) if (kept.has(String(r.key))) keptTexts[r.key] = r.found!.description;
              await apply({ fields: chosen, texts: keptTexts, read: ok });
              close();
            }}>Use these</button>
          </div>
        </>}
      </div>
    </div>
  );
}

/** A thread's key: Gmail's thread, or else the subject without Re:/Fwd:. */
const threadKey = (m: Row) => m.gm_thrid || `s:${(m.subject || "").toLowerCase().replace(/^\s*((re|fwd?|aw|sv|tr)\s*(\[\d+\])?\s*:\s*)+/i, "").replace(/\s+/g, " ").trim()}`;

/** The fields of a record the page edits, as `{field: value}`. */
const pickKeys = (rec: Row | null | undefined, keys: string[]) => Object.fromEntries(keys.map((k) => [k, rec?.[k] ?? null]));

/** What the rich text editor wrote, or null for nothing written. */
const richOrNull = (html: string) => (toPlain(html).trim() ? html : null);

const APP_KEYS = ["company_id", "title", "reference", "url", "location", "work_mode", "employment", "source",
  "salary_min", "salary_max", "currency", "pay_period", "bonus", "equity", "comp", "note", "description", "posted_on", "closes_on"];
const COMPANY_KEYS = ["website", "industry", "size", "headquarters", "description"];
const PROCESS_KEYS = ["stage_id", "applied_on"];
const POSTING_KEYS = ["url", "description"];
const STEP_KEYS = ["title", "at", "status", "format", "minutes", "place", "prep_note", "attendees", "note"];
const EVENT_KEYS = ["body", "happened_on"];

interface Loaded {
  app: Row; company: Row; procs: Row[]; stages: Row[]; allStages: Row[]; postings: Row[]; lanes: Row[]; swimlanes: Row[];
  process: Row | null; detail: Row | null; links: Row[]; reminders: Row[]; prep: Row[];
}

/** Everything the page shows: the application, its company, its processes,
 * its other postings, and the process shown (`processId`, or the newest
 * active one). */
async function loadApplication(id: number, processId: number | null): Promise<Loaded> {
  const app = await get(`applications/${id}`);
  const [company, procs, allStages, postings, lanes, links, swimlanes] = await Promise.all([
    get(`companies/${app.company_id}`),
    get(`processes?application_id=${id}`),
    get("stages"),
    get(`postings?application_id=${id}`),
    get("lanes"),
    get(`links?application_id=${id}`),
    get("swimlanes"),
  ]);
  procs.sort((a: Row, b: Row) => b.created_at.localeCompare(a.created_at));
  const process = procs.find((p: Row) => p.id === processId) || procs.find((p: Row) => p.status === "active") || procs[0] || null;
  const [detail, reminders, prep] = process
    ? await Promise.all([get(`processes/${process.id}/detail`), get(`reminders?process_id=${process.id}`), get(`prep?process_id=${process.id}`)])
    : [null, [], []];
  // The board's stages; a closed process is in an inactive one, having reached one of these.
  const stages = allStages.filter((st: Row) => st.active !== 0);
  return { app, company, procs, stages, allStages, postings, lanes, swimlanes, process, detail, links, reminders, prep };
}

interface Draft {
  app: Row; company: Row; companyName: string; companyLogo: string | null;
  postings: Row[]; process: Row | null; steps: Row[]; events: Row[];
}

/** What a section's editing starts from: the editable parts, copied. */
function draftOf(s: Loaded): Draft {
  return {
    app: pickKeys(s.app, APP_KEYS),
    company: pickKeys(s.company, COMPANY_KEYS),
    companyName: s.company.name,
    companyLogo: s.company.logo,
    postings: s.postings.map((p) => ({ id: p.id, ...pickKeys(p, POSTING_KEYS) })),
    process: s.process ? pickKeys(s.process, PROCESS_KEYS) : null,
    steps: (s.detail?.steps || []).map((x: Row) => ({ id: x.id, ...pickKeys(x, STEP_KEYS), people: (x.people || []).map((p: Row) => ({ id: p.id, name: p.name })) })),
    events: (s.detail?.notes || []).map((x: Row) => ({ id: x.id, ...pickKeys(x, EVENT_KEYS), happened_on: x.happened_on || x.created_at.slice(0, 10) })),
  };
}

// What the page is drawn again with (a process to show, a posting link to
// read straight away), set before it is.
let pending: { processId?: number | null; readLink?: string | null } = {};

/** Draw the page again: as it is, or with `opts`. */
function reloadWith(opts: { processId?: number | null; readLink?: string | null } = {}) {
  pending = opts;
  setLeaveGuard(null);
  route();
}

export function ApplicationPage({ id, processId, editing = false }: { id: number; processId: number | null; editing?: boolean }) {
  const [opts] = useState(() => { const o = pending; pending = {}; return o; });
  const [s, setS] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadApplication(id, opts.processId !== undefined ? opts.processId ?? null : processId).then((x) => {
      setS(x);
      document.title = `${x.app.label} · ${baseTitle()}`;
    }).catch((e) => setError(e.message));
  }, [id, processId, opts]);
  if (error) return <div className="page"><Notice kind="danger" role="alert">{error}</Notice><a href="/applications">← Applications</a></div>;
  if (!s) return <LoadingPage kind="detail" />;
  return <Application id={id} s={s} editing={editing} readLink={opts.readLink ?? null} />;
}

/** What can move to another application, and what each is called. */
type Movable = "notes" | "steps" | "emails" | "links";

/**
 * Which application to move something to: one from the list, other than
 * `not`. Resolves to it, or null.
 */
function pickApplication(title: string, not: number): Promise<{ id: number; label: string } | null> {
  return new Promise((resolve) => {
    let chosen: ComboItem | null = null;
    let answered = false;
    const apps = refSource("applications");
    pushDialog({
      className: "al-dialog ask",
      onClosed: () => { if (!answered) resolve(null); },
      render: (close) => (
        <form method="dialog" onSubmit={(e) => {
          e.preventDefault();
          if (!chosen) { toast("Pick an application from the list", "error"); return; }
          answered = true;
          resolve({ id: chosen.value, label: chosen.label });
          close();
        }}>
          <h2 className="al-dialog__title">{title}</h2>
          <Field><Label htmlFor="move-to">To</Label>
            <Combo id="move-to" label="Application" placeholder="Search applications…" source={async (q) => (await apps(q)).filter((it) => it.value !== not)}
              onPick={(it) => { chosen = it; }} onInput={() => { chosen = null; }} /></Field>
          <p className="muted small">It goes to that application's process on the board.</p>
          <div className="al-dialog__actions">
            <button className="al-button" type="button" onClick={close}>Cancel</button>
            <button type="submit" className="al-button al-button--primary">Move</button>
          </div>
        </form>
      ),
    });
  });
}

function Application({ id, s, editing, readLink }: { id: number; s: Loaded; editing: boolean; readLink: string | null }) {
  const [, force] = useState(0);
  const render = () => force((n) => n + 1);
  const st = useRef({
    // The section being edited, if one: each is edited on its own.
    section: (editing ? "role" : null) as string | null,
    // On the timeline, the one interview or note being edited.
    item: null as { kind: "step" | "event"; id: number } | null,
    orig: draftOf(s),
    draft: null as unknown as Draft,
    // What's open: add forms, sections edited as they're changed (people,
    // files, links), and posting texts read in full.
    opened: new Set<string>(),
    // The form, drawn afresh each time editing starts.
    formKey: 0,
    saving: false,
  }).current;
  if (!st.draft) st.draft = structuredClone(st.orig);
  const [saveState, setSaveState] = useState<{ state?: string; text: string }>({ text: "" });
  const page = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<string | null>(null);
  const { draft, orig, opened } = st;
  const dirty = () => st.section != null && JSON.stringify(st.draft) !== JSON.stringify(st.orig);
  useEffect(() => {
    setLeaveGuard(() => dirty());
    window.onbeforeunload = (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ""; } };
    return () => { window.onbeforeunload = null; };
  }, []);
  // After drawing, the cursor goes where it was sent.
  useEffect(() => {
    if (!focusAfter.current) return;
    const el = page.current?.querySelector<HTMLElement>(focusAfter.current);
    el?.focus();
    el?.scrollIntoView({ block: "nearest" });
    focusAfter.current = null;
  });
  // Opened to edit: the details, from the start.
  useEffect(() => { if (editing) { focus('[data-section="role"] input'); force((n) => n + 1); } }, []);
  // A posting link just added: read it, as Refresh does.
  useEffect(() => { if (readLink) readPostings(postingLinks().filter((l) => l.url === readLink)); }, []);
  const reload = (o: { readLink?: string | null } = {}) => reloadWith({ processId: s.process?.id ?? null, ...o });
  const focus = (sel: string) => { focusAfter.current = sel; };
  /** Edit section `key` (null: none), from how it's saved; one at a time. */
  const editSection = (key: string | null, at: string | null = null, item: typeof st.item = null) => {
    if (dirty() && !confirm("Discard your changes?")) return;
    st.section = key;
    st.item = item;
    st.draft = structuredClone(st.orig);
    opened.delete("tl-full");
    st.formKey++;
    render();
    if (key) focus(at || `[data-section="${key}"] :is(input, select, .rich, textarea):not([hidden])`);
  };
  const toggle = (key: string) => { if (opened.has(key)) opened.delete(key); else opened.add(key); render(); };

  // ---- small parts ----

  const input = (obj: Row, key: string, attrs: { type?: string; multiline?: boolean; rows?: number; placeholder?: string; "aria-label"?: string; step?: number; list?: string } = {}) => {
    const label = attrs["aria-label"] || attrs.placeholder || key;
    // A date: the design system's date picker, in hunt's language and digits.
    if (attrs.type === "date") {
      return <DatePicker value={obj[key]} label={label} onChange={(v) => { obj[key] = v; }}
        onBad={() => toast(t("Enter a date, day first, like 30/11/2026"), "error")} />;
    }
    const onInput = (e: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>) => { const v = e.currentTarget.value; obj[key] = v.trim() === "" ? null : v; };
    if (attrs.multiline) return <TextArea rows={attrs.rows} placeholder={attrs.placeholder} aria-label={label} defaultValue={obj[key] ?? ""} onInput={onInput} />;
    return <Input type={attrs.type || "text"} step={attrs.step} list={attrs.list} placeholder={attrs.placeholder} aria-label={label} defaultValue={obj[key] ?? ""} onInput={onInput} />;
  };
  /** Rich text, written into `obj[key]`. */
  const rich = (obj: Row, key: string, label: string, placeholder: string, rows = 4) => (
    <RichText value={obj[key]} rows={rows} placeholder={placeholder} label={label} onChange={(html) => { obj[key] = richOrNull(html); }} />
  );
  const select = (obj: Row, key: string, options: [string, string][], { empty = "Not set" as string | null, label = key } = {}) => {
    // One it has that the list no longer offers stays, as it is.
    const have = obj[key] == null || obj[key] === "" || options.some(([v]) => v === String(obj[key])) ? options : [...options, [String(obj[key]), String(obj[key])] as [string, string]];
    return (
      <Select aria-label={label} defaultValue={obj[key] ?? ""} onChange={(e) => { obj[key] = e.target.value || null; }}>
        {empty ? <option value="">{empty}</option> : null}
        {have.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select>
    );
  };
  const optionsOf = (resource: string, name: string) => R(resource).fields.find((f) => f.name === name)!.options;
  // A field is named by its label, not its placeholder.
  const labeled = (label: string, control: ReactNode, wide = false) => <label className={`app-field${wide ? " wide" : ""}`}><span>{label}</span>{control}</label>;
  /** An add form that acts at once, behind its button. */
  const showForm = (key: string) => opened.has(key);
  const formButton = (key: string, label: string) => (
    <button key={key} className="al-button al-button--quiet al-button--sm app-add" type="button" aria-expanded={String(opened.has(key)) as "true" | "false"} onClick={() => toggle(key)}>{opened.has(key) ? "Close" : `+ ${label}`}</button>
  );
  /** An add form in a dialog of its own, behind its button. */
  const dialogButton = (label: string, open: () => void) => (
    <button key="add" className="al-button al-button--quiet al-button--sm app-add" type="button" aria-haspopup="dialog" onClick={open}>{label}</button>
  );
  /** A small icon button: a link's or a file's own. */
  const tool = (icon: string, label: string, onClick: () => void, extra: { danger?: boolean } = {}) => (
    <button className={`al-button al-button--quiet al-button--icon al-button--sm${extra.danger ? " al-button--danger" : ""}`} type="button" aria-label={label} title={label} onClick={onClick}><Icon name={icon} /></button>
  );
  const link = (url: string) => <a href={/^https?:/.test(url) ? url : `https://${url}`} target="_blank" rel="noreferrer">{url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}{" ↗"}</a>;
  /** A section's Edit, unless it's being edited (or its cycle has ended). */
  const editButton = (key: string, what: string) => (ended() || st.section === key ? null
    : <button key="edit" className="al-button al-button--quiet al-button--sm" type="button" aria-label={`Edit ${what}`} title={`Edit ${what}`} onClick={() => editSection(key)}><Icon name="edit" /><span>Edit</span></button>);
  /** A section's form: its fields, then Cancel and Save. */
  const form = (key: string, ...body: ReactNode[]) => (
    <div key={`form-${key}-${st.formKey}`} className="app-edit">
      {body}
      <div className="app-edit-actions">
        <button className="al-button" type="button" onClick={() => editSection(null)}>Cancel</button>
        <button className="al-button al-button--primary" type="button" aria-busy={st.saving ? "true" : undefined} onClick={save}>Save</button>
      </div>
    </div>
  );
  const panelHead = (key: string, title: string, { count, action }: { count?: number | null; action?: ReactNode } = {}) => (
    <div className="app-panel-head"><h2 id={`panel-${key}`}>{title}</h2>{count != null ? <span className="al-badge al-badge--count">{count}</span> : null}
      {action ? <div className="app-panel-tools">{action}</div> : null}</div>
  );
  /** A panel; with `headless`, its body carries the heading (from panelHead) itself. */
  const panel = (key: string, title: string, opts: { count?: number | null; action?: ReactNode; headless?: boolean } = {}, ...body: ReactNode[]) => (
    <section key={key} className={`al-panel app-panel${st.section === key ? " is-editing" : ""}`} data-section={key} aria-labelledby={`panel-${key}`}>
      {opts.headless ? null : panelHead(key, title, opts)}
      {body}
    </section>
  );
  /** A part of a panel, with a heading and buttons of its own. */
  const part = (key: string, title: string, action: ReactNode, ...body: ReactNode[]) => (
    <section key={key} className={`app-part${st.section === key ? " is-editing" : ""}`} data-section={key} aria-labelledby={`part-${key}`}>
      <div className="app-part-head"><h3 id={`part-${key}`}>{title}</h3>{action ? <div className="app-panel-tools">{action}</div> : null}</div>
      {body}
    </section>
  );

  // ---- moving and deleting what's on the timeline, the emails and the links ----

  /** Move something to another application, with Undo. */
  async function transfer(what: Movable, rid: number, name: string, after: () => void = reload) {
    const to = await pickApplication(`Move ${name} to another application`, id);
    if (!to) return false;
    if (!(await saving(() => post(`${what}/${rid}/transfer`, { application_id: to.id })))) return false;
    toast(`Moved to ${to.label}`, "info", { label: "Undo", onclick: async () => {
      if (await attempt(() => post(`${what}/${rid}/transfer`, { application_id: id }))) { toast("Undone"); reload(); }
    } });
    after();
    return true;
  }

  /** Delete a note (with Undo, which writes it again) or an interview (asking first). */
  async function removeItem(what: "notes" | "steps", x: Row) {
    if (what === "steps" && !(await confirmDelete(`interview “${x.title}”`))) return;
    if (!(await saving(() => del(`${what}/${x.id}`)))) return;
    if (what === "notes") {
      toast("Note deleted", "info", { label: "Undo", onclick: async () => {
        if (await attempt(() => post("notes", { process_id: x.process_id, body: x.body, happened_on: x.happened_on }))) { toast("Undone"); refreshDetail(); }
      } });
    } else toast("Interview deleted");
    refreshDetail();
  }

  /** A timeline entry's other buttons: Edit, Move, Delete. */
  const itemMenu = (what: "notes" | "steps", x: Row, name: string) => (ended() ? null : (
    <MenuButton className="al-button al-button--sm al-button--quiet" label={`More for ${name}`} items={(close) => <>
      <MenuItem close={close} onClick={() => editSection("timeline", `.app-timeline [data-${what === "steps" ? "step" : "event"}-id="${x.id}"] :is(input, .rich)`,
        { kind: what === "steps" ? "step" : "event", id: x.id })}>Edit</MenuItem>
      <MenuItem close={close} onClick={() => transfer(what, x.id, what === "steps" ? `“${x.title}”` : "this note")}>Move to another application…</MenuItem>
      <hr className="al-menu__separator" />
      <MenuItem close={close} danger onClick={() => removeItem(what, x)}>Delete</MenuItem>
    </>}><Icon name="more" /></MenuButton>
  ));

  function importPosting() {
    openImport({
      kind: postingImport, url: s.app.url || "", current: s.app,
      apply: async (fields) => {
        if (await attempt(() => patch(`applications/${id}`, fields))) { toast("Imported"); reload(); }
      },
    });
  }

  /** Every posting link: the application's own first. */
  const postingLinks = (): PostingLink[] => [
    ...(s.app.url ? [{ key: "main", url: s.app.url, text: s.app.description, label: s.app.url_label }] : []),
    ...s.postings.map((p) => ({ key: p.id, url: p.url, text: p.description, label: p.label })),
  ];

  /** Read these links (all of them, by default) and choose what to keep;
   * with none, ask for one. */
  function readPostings(links = postingLinks()) {
    if (!links.length) { importPosting(); return; }
    openPostingReview({
      links, current: s.app,
      apply: async ({ fields, texts, read }) => {
        const done = await attempt(async () => {
          const mine = { ...fields, ...("main" in texts ? { description: texts.main } : {}) };
          if (Object.keys(mine).length) await patch(`applications/${id}`, mine);
          for (const r of read) {
            if (r.key === "main") continue;
            await patch(`postings/${r.key}`, { platform: r.found!.platform || null, read_at: localNow(), ...(r.found!.reference ? { reference: r.found!.reference } : {}), ...(r.key in texts ? { description: texts[r.key] } : {}) });
          }
          return Object.keys(mine).length + Object.keys(texts).length;
        });
        if (done != null) { if (done) toast("Refreshed"); reload(); }
      },
    });
  }

  /** Add a posting link, named `label`, and `read` it straight away; `then`, once it's added. */
  async function addPostingLink(url: string, label: string | null, read: boolean, then?: () => Promise<unknown>) {
    const added = await attempt(async () => {
      const made = await (s.app.url ? post("postings", { application_id: id, url, label }) : patch(`applications/${id}`, { url, url_label: label }));
      if (then) await then();
      return made;
    });
    if (!added) return;
    warnIfSamePosting({ ...s.app, url });
    closeModal();
    reload({ readLink: read ? url : null });
  }

  /** What a link can be: a job posting (read once it's added, if asked), or one kept with it. */
  const linkKinds = (): [string, string][] => [["posting", "Job posting"], ...optionsOf("links", "kind")];

  /**
   * The link form, in a dialog, for both kinds: a new link (a job posting,
   * unless another kind's chosen), a posting link changed, or a kept one. A
   * link changing kind moves: a posting becomes a kept link (its text goes),
   * a kept link a posting (read straight away, if asked).
   */
  const openLinkForm = (at: { posting: PostingLink } | { link: Row } | null) => {
    const posting = at && "posting" in at ? at.posting : null, kept = at && "link" in at ? at.link : null;
    const current = posting ? { url: posting.url, label: linkName(posting), kind: "posting" } : kept ? { url: kept.url, label: linkName(kept), kind: kept.kind } : null;
    openModal(<LinkForm l={current} kinds={linkKinds()} onSave={async (v) => {
      if (v.kind === "posting") {
        if (posting) { if ((v.url === posting.url && v.label === linkName(posting)) || await changePostingLink(posting, v.url, v.label)) closeModal(); }
        else await addPostingLink(v.url, v.label, !!v.read, kept ? () => del(`links/${kept.id}`) : undefined);
        return;
      }
      const body = { url: v.url, label: v.label, kind: v.kind };
      const ok = await saving(async () => {
        if (kept) return patch(`links/${kept.id}`, body);
        const made = await post("links", { application_id: id, ...body });
        if (posting) await postingGone(posting)();
        return made;
      });
      if (ok) { closeModal(); toast(kept ? "Link saved" : "Link added"); reload(); }
    }} />);
  };

  // ---- not on the board: a way on (on the board, the status card says where it stands) ----

  function standing() {
    if (s.process) return null;
    return (
      <div className="app-standing"><p className="muted">Not on the board.{" "}
        <button className="al-button al-button--sm al-button--quiet" type="button" onClick={async () => {
          const card = await attempt(() => post("processes", { application_id: id }));
          if (card) { toast("On the board"); reloadWith({ processId: card.id }); }
        }}>Add it to the board</button></p></div>
    );
  }

  // ---- the role: what, where and how, the posting links, about the job ----

  function rolePanel() {
    const a = s.app, p = s.process;
    const f = (n: string) => optionsOf("applications", n);
    if (st.section === "role") {
      return panel("role", "Role", {}, form("role",
        <div key="cols" className="app-role-cols"><div className="app-grid">
          {labeled("Role", input(draft.app, "title", { placeholder: "e.g. Senior Platform Engineer", "aria-label": "Role" }))}
          {labeled("Role ID", input(draft.app, "reference", { placeholder: "Req-1234, JR0042…", "aria-label": "Role ID" }))}
          {labeled("Location", input(draft.app, "location", { placeholder: "e.g. London", "aria-label": "Location" }))}
          {labeled("Work mode", select(draft.app, "work_mode", f("work_mode"), { label: "Work mode" }))}
          {labeled("Employment", select(draft.app, "employment", f("employment"), { label: "Employment" }))}
          {labeled("Source", input(draft.app, "source", { placeholder: "e.g. LinkedIn, referral", "aria-label": "Source" }))}
          {draft.process ? labeled("Applied on", input(draft.process, "applied_on", { type: "date", "aria-label": "Applied on" })) : null}
          {labeled("Posted on", input(draft.app, "posted_on", { type: "date", "aria-label": "Posted on" }))}
          {labeled("Applications close", input(draft.app, "closes_on", { type: "date", "aria-label": "Applications close" }))}
        </div>
        <div className="app-role-about">
          <div className="app-field wide"><span>{draft.postings.length ? "The posting's text" : "The job"}</span>
            {rich(draft.app, "description", "About the job", "Paste or write the job description", 10)}</div>
          {draft.postings.map((x) => (
            <div key={`t-${x.id}`} className="app-field wide"><span translate="no">{`From ${hostOf(x.url || "")}`}</span>
              {rich(x, "description", `The posting's text from ${hostOf(x.url || "")}`, "Its text", 6)}</div>
          ))}
        </div></div>));
    }
    const o = (n: string, v: string | null) => (v ? optionLabel(f(n), v) : null);
    const facts = ([
      ["Role", a.title], ["Role ID", a.reference], ["Location", a.location], ["Work mode", o("work_mode", a.work_mode)],
      ["Employment", o("employment", a.employment)], ["Source", a.source],
      ["Applied", p ? (p.applied_on ? fmtDay(p.applied_on) : "Not yet") : null],
      ["Posted", a.posted_on ? fmtDay(a.posted_on) : null], ["Closes", a.closes_on ? fmtDay(a.closes_on) : null],
    ] as [string, ReactNode][]).filter(([, v]) => v);
    // Its details and posting links in a narrow column; about the job beside, in a wide one.
    return panel("role", "About the Role", { action: editButton("role", "the role") },
      <div key="cols" className="app-role-cols">
        <div className="app-role-details">
          {facts.length ? <dl className="app-facts">{facts.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl> : null}
          {postingLinksPart()}
        </div>
        {aboutPart()}
      </div>);
  }

  /** A posting link's name: where it's posted, as read; else its site. */
  const postingName = (l: PostingLink) => {
    const p = l.key === "main" ? null : s.postings.find((x) => x.id === l.key);
    return linkName(l) || (p?.platform && p.platform !== "the page" ? p.platform : hostOf(l.url));
  };

  /** Change a posting link's address and name, in place. A posting's platform
   * and when it was read were the old link's, so they go if the address changes. */
  async function changePostingLink(l: PostingLink, url: string, label: string | null) {
    if (l.key === "main") {
      if (!(await saving(() => patch(`applications/${id}`, { url, url_label: label })))) return false;
      s.app.url = st.orig.app.url = st.draft.app.url = url;
      s.app.url_label = st.orig.app.url_label = st.draft.app.url_label = label;
      if (url !== l.url) warnIfSamePosting({ ...s.app, url });
    } else {
      const body = url === l.url ? { label } : { url, label, platform: null, read_at: null };
      if (!(await saving(() => patch(`postings/${l.key}`, body)))) return false;
      Object.assign(s.postings.find((x) => x.id === l.key)!, body);
      for (const d of [st.orig, st.draft]) { const x = d.postings.find((x) => x.id === l.key); if (x) x.url = url; }
    }
    render();
    return true;
  }

  /** A posting link taken off, and its text with it. */
  const postingGone = (l: PostingLink) => (l.key === "main" ? () => patch(`applications/${id}`, { url: null, url_label: null, description: null }) : () => del(`postings/${l.key}`));

  /** Delete a posting link, and its text with it. */
  async function removePostingLink(l: PostingLink) {
    if (!(await confirmDelete(`posting ${hostOf(l.url)}`, "Its text goes with it."))) return;
    if (await attempt(postingGone(l))) { toast("Removed"); reload(); }
  }

  /** The posting links: the application's own first, then the others, each read again, changed (in the link form) or deleted. */
  function postingLinksPart() {
    const links = postingLinks().filter((l) => l.url);
    return part("postings", "Posting links", ended() ? null : dialogButton("+ Add", () => openLinkForm(null)),
      links.length ? (
        <ul key="list" className="app-links">
          {links.map((l) => {
            const main = l.key === "main";
            const p = main ? null : s.postings.find((x) => x.id === l.key)!;
            const name = postingName(l);
            return (
              <li key={String(l.key)}>
                <div className="app-link"><a href={l.url} target="_blank" rel="noreferrer" title={l.url} translate="no">{name}</a>
                  <span className="muted small">{dotted([main && links.length > 1 ? "Its own" : null, p?.read_at ? `Read ${fmtStamp(p.read_at)}` : null, p?.reference ? <span translate="no">{p.reference}</span> : null, <span translate="no">{hostOf(l.url)}</span>])}</span></div>
                <span className="app-link-tools">
                  {tool("refresh", `Refresh ${name}`, () => readPostings([l]))}
                  {ended() ? null : <>
                    {tool("edit", `Edit ${name}`, () => openLinkForm({ posting: l }))}
                    {tool("trash", `Delete ${name}`, () => removePostingLink(l), { danger: true })}
                  </>}
                </span>
              </li>
            );
          })}
        </ul>
      ) : <p key="none" className="muted small">No posting yet: add its link, and hunt reads it.</p>);
  }

  // Postings read like emails: where each is from, its text in its own
  // box. The application's own comes first.
  function aboutPart() {
    const a = s.app;
    const card = (l: PostingLink) => {
      const main = l.key === "main";
      const p = main ? null : s.postings.find((x) => x.id === l.key)!;
      const where = linkName(l) || (main ? a.title || "The posting" : p!.platform && p!.platform !== "the page" ? p!.platform : hostOf(l.url));
      return (
        <article key={String(l.key)} className="email-msg app-posting" data-posting={String(l.key)}>
          {texts.length > 1 ? <header><b>{where}</b>{l.url ? <span className="muted small">{` from ${hostOf(l.url)}`}</span> : null}</header> : null}
          {postingText(String(l.key), l.text!)}
        </article>
      );
    };
    // Its first few sentences, and Read more for the rest, in place.
    const postingText = (key: string, text: string) => {
      const plain = isRich(text) ? toPlain(text) : text;
      const { lead, more } = postingLead(plain);
      const open = !more || opened.has(`posting-more-${key}`);
      return (
        <div className="email-text posting-text">
          {open ? (isRich(text) ? <RichView className="prose" value={text} /> : formatPosting(text)) : <p>{linkify(lead)}</p>}
          {more ? <button className="al-link app-more" type="button" aria-expanded={String(open) as "true" | "false"} onClick={() => toggle(`posting-more-${key}`)}>{open ? "Show less" : "Read more"}</button> : null}
        </div>
      );
    };
    const texts = [{ key: "main", url: a.url, text: a.description, label: a.url_label } as PostingLink, ...s.postings.map((p) => ({ key: p.id, url: p.url, text: p.description, label: p.label }))].filter((l) => l.text);
    return part("about", "Description", null,
      texts.length ? texts.map(card)
        : <p key="none" className="muted small">{postingLinks().length ? "No text yet: Refresh reads it from the posting." : "Nothing yet: add the posting's link, or write it in."}</p>);
  }

  // Like a posting: its first few sentences, and Read more for the rest.
  function readMore(key: string, text: string, className: string) {
    const { lead, more } = postingLead(isRich(text) ? toPlain(text) : text);
    const open = !more || opened.has(`more-${key}`);
    return (
      <div key={key} className="app-read-more">
        {open ? <RichView className={className} value={text} /> : <p className={className}>{linkify(lead)}</p>}
        {more ? <button className="al-link app-more" type="button" aria-expanded={String(open) as "true" | "false"} onClick={() => toggle(`more-${key}`)}>{open ? "Show less" : "Read more"}</button> : null}
      </div>
    );
  }

  // ---- its company: who they are, edited apart from the role ----

  function companyPanel() {
    const c = s.company;
    if (st.section === "company") {
      return panel("company", "Company", {}, form("company",
        <div key="company" className="app-grid">
          <div className="app-field"><span>Company</span><Combo label="Company" placeholder="Company" value={draft.companyName} source={refSource("companies")} allowCreate
            onPick={async (it) => {
              const co = it.create ? await attempt(() => post("companies", { name: it.value })) : await get(`companies/${it.value}`);
              if (!co) return;
              draft.app.company_id = co.id;
              draft.companyName = co.name;
              draft.companyLogo = co.logo;
              // The company's facts follow the company chosen.
              Object.assign(draft.company, pickKeys(co, COMPANY_KEYS));
              orig.company = pickKeys(co, COMPANY_KEYS);
              st.formKey++;
              render();
            }} /></div>
          {labeled("Website", input(draft.company, "website", { type: "url", placeholder: "https://acme.com", "aria-label": "Website" }))}
          {labeled("Industry", input(draft.company, "industry", { placeholder: "e.g. Software", "aria-label": "Industry" }))}
          {labeled("Size", input(draft.company, "size", { placeholder: "e.g. 1,000+ employees", "aria-label": "Size" }))}
          {labeled("Based in", input(draft.company, "headquarters", { placeholder: "e.g. London, UK", "aria-label": "Based in" }))}
          <div className="app-field wide"><span>About the company</span>{rich(draft.company, "description", "About the company", "Culture, team, research…")}</div>
        </div>));
    }
    const facts = ([
      ["Website", c.website ? link(c.website) : null], ["Industry", c.industry], ["Size", c.size], ["Based in", c.headquarters],
    ] as [string, ReactNode][]).filter(([, v]) => v);
    return panel("company", "Company", { action: editButton("company", "the company") },
      <span key="name" className="with-logo app-company-name"><Logo id={c.id} logo={c.logo} name={c.name} size={28} /><a href={`/companies/${c.id}`} translate="no">{c.name}</a></span>,
      facts.length ? <dl key="facts" className="app-facts">{facts.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl> : null,
      c.description ? readMore("about", c.description, "prose small app-company-about") : null);
  }
  // ---- pay ----

  function payPanel() {
    const a = s.app;
    const f = (n: string) => optionsOf("applications", n);
    if (st.section === "pay") {
      return panel("pay", "Pay", {}, form("pay",
        <div key="fields" className="app-grid app-pay-fields">
          <label className="app-field wide"><span>Base salary</span><div className="app-salary">
            {input(draft.app, "currency", { placeholder: HOME(), "aria-label": "Currency" })}
            {input(draft.app, "salary_min", { placeholder: "From, e.g. 150k", "aria-label": "From" })}
            {input(draft.app, "salary_max", { placeholder: "To", "aria-label": "To" })}
            {select(draft.app, "pay_period", f("pay_period"), { empty: "Per…", label: "Per" })}
          </div></label>
          {labeled("Bonus", input(draft.app, "bonus", { placeholder: "e.g. 15% target", "aria-label": "Bonus" }))}
          {labeled("Equity", input(draft.app, "equity", { placeholder: "e.g. £200k RSUs over 4 years", "aria-label": "Equity" }))}
          <div className="app-field wide"><span>Pay notes</span>{rich(draft.app, "comp", "Pay notes", "Benefits, negotiation…", 3)}</div>
        </div>));
    }
    const more = a.bonus || a.equity || a.comp ? <div key="more" className="app-pay-more">
      {a.bonus || a.equity ? <dl className="app-facts">{a.bonus ? <><dt>Bonus</dt><dd>{a.bonus}</dd></> : null}{a.equity ? <><dt>Equity</dt><dd>{a.equity}</dd></> : null}</dl> : null}
      {a.comp ? <RichView className="prose small app-pay-notes" value={a.comp} /> : null}
    </div> : null;
    return <PayPanel key="pay" a={a} p={s.process} stages={s.stages} onAdd={() => editSection("pay", '[data-section="pay"] input[aria-label="From"]')}
      tools={editButton("pay", "pay")}>{more}</PayPanel>;
  }

  // ---- notes on the application ----

  function notesPanel() {
    if (st.section === "notes") {
      return panel("notes", "Notes", {}, form("notes", rich(draft.app, "note", "Your notes", "Your private notes on this application", 6)));
    }
    return panel("notes", "Notes", { action: editButton("notes", "your notes") },
      s.app.note ? readMore("read", s.app.note, "app-notes") : <p key="none" className="muted small">No notes.</p>);
  }

  async function refreshDetail() {
    if (!s.process) return;
    s.detail = await get(`processes/${s.process.id}/detail`);
    Object.assign(st.orig, { steps: draftOf(s).steps, events: draftOf(s).events });
    if (!st.section) st.draft = structuredClone(st.orig);
    render();
  }

  function emails() {
    if (!s.process) return null;
    const list: Row[] = s.detail!.emails || [];
    // Threads, newest first; each folded until opened.
    const threads = new Map<string, Row[]>();
    for (const m of [...list].sort((x, y) => x.sent_at.localeCompare(y.sent_at))) {
      const k = threadKey(m);
      if (!threads.has(k)) threads.set(k, []);
      threads.get(k)!.push(m);
    }
    const ordered = [...threads.values()].sort((x, y) => y[y.length - 1].sent_at.localeCompare(x[x.length - 1].sent_at));
    const onMove = ended() ? null : (m: Row) => transfer("emails", m.id, `“${m.subject || "(no subject)"}”`, refreshDetail);
    return panel("emails", "Emails", { count: list.length, action: ended() ? null : formButton("emails", "Add an email") },
      showForm("emails") ? <EmailAdd key="add" processId={s.process.id} onAdded={() => { opened.delete("emails"); refreshDetail(); }} onCancel={() => toggle("emails")} /> : null,
      ordered.length ? <ul key="list" className="app-emails">{ordered.map((msgs) => <EmailThread key={threadKey(msgs[0])} msgs={msgs} onMove={onMove} onRemoved={refreshDetail} />)}</ul>
        : <p key="none" className="muted small">No emails saved.</p>);
  }

  // People on the process, and files attached to it: these act at once.
  function people() {
    const p = s.process!;
    const list: Row[] = s.detail!.people || [];
    const roles = listOf("person_role");
    const after = (fresh: Row[] | undefined) => { if (fresh) { s.detail!.people = fresh; render(); } };
    const add = () => openModal(<PersonAdd roles={roles} onAdd={async (body) => {
      const fresh = await attempt(() => post(`processes/${p.id}/people`, body));
      if (fresh) { closeModal(); after(fresh); }
    }} />);
    // Their role, in a dialog.
    const edit = (pe: Row) => openModal(<PersonRole pe={pe} roles={roles} onSave={async (role) => {
      const fresh = await saving(() => patch(`processes/${p.id}/people/${pe.id}`, { role }));
      if (fresh) { closeModal(); toast("Saved"); after(fresh); }
    }} />);
    const remove = async (pe: Row) => {
      const fresh = await saving(() => del(`processes/${p.id}/people/${pe.id}`));
      if (!fresh) return;
      toast(`Removed ${pe.name}`, "info", { label: "Undo", onclick: async () => after(await attempt(() => post(`processes/${p.id}/people`, { person_id: pe.id, role: pe.role ?? null }))) });
      after(fresh);
    };
    return panel("people", "People", { count: list.length, action: ended() ? null : dialogButton("+ Add", add) },
      list.length ? (
        <ul key="list" className="app-people">
          {list.map((pe) => (
            <li key={pe.id} className="app-person">
              <div className="app-person-about">
                <span className="with-logo"><Photo id={pe.id} photo={pe.photo} name={pe.name} size={28} /><a href={`/people/${pe.id}`}>{pe.name}</a></span>
                <span className="muted small">{[pe.role ? optionLabel(roles, pe.role) : null, pe.title].filter(Boolean).join(" · ")}</span>
                {/* Their email and phone, a click away. */}
                {pe.email || pe.phone ? (
                  <span className="app-contact">
                    {pe.email ? <a href={`mailto:${pe.email}`} title={`Email ${pe.name}`}><Icon name="mail" />{pe.email}</a> : null}
                    {pe.phone ? <a href={`tel:${pe.phone.replace(/[^\d+]/g, "")}`} title={`Call ${pe.name}`}><Icon name="phone" />{pe.phone}</a> : null}
                  </span>
                ) : null}
              </div>
              {ended() ? null : (
                <MenuButton className="al-button al-button--quiet al-button--sm" label={`More for ${pe.name}`} items={(close) => <>
                  <MenuItem close={close} onClick={() => edit(pe)}>Edit</MenuItem>
                  <hr className="al-menu__separator" />
                  <MenuItem close={close} danger onClick={() => remove(pe)}>Remove</MenuItem>
                </>}><Icon name="more" /></MenuButton>
              )}
            </li>
          ))}
        </ul>
      ) : <p key="none" className="muted small">Nobody yet.</p>);
  }

  /**
   * The files sent with it, the latest three, each a thumbnail: edited (in
   * a dialog, another version sent, or a new one uploaded) or detached; the
   * rest in Files, with this application chosen.
   */
  function files() {
    const p = s.process!;
    const list: Row[] = s.detail!.files || [];
    const after = (fresh: Row[] | undefined) => { if (fresh) { s.detail!.files = fresh; render(); } };
    const attach = (versionId: number) => post(`processes/${p.id}/files`, { version_id: versionId });
    const add = () => openModal(<FileAdd onAdd={async (versionId) => {
      const fresh = await attempt(() => attach(versionId));
      if (fresh) { closeModal(); after(fresh); }
    }} />);
    // Another version in its place: the new one sent (unless it was already), the old taken off.
    const edit = (f: Row) => openModal(<FileEdit f={f} onSave={async (versionId) => {
      if (versionId === f.id) { closeModal(); return; }
      const fresh = await attempt(async () => {
        if (!list.some((x) => x.id === versionId)) await attach(versionId);
        return del(`processes/${p.id}/files/${f.id}`);
      });
      if (fresh) { closeModal(); toast("Saved"); after(fresh); }
    }} />);
    const detach = async (f: Row) => {
      const fresh = await saving(() => del(`processes/${p.id}/files/${f.id}`));
      if (!fresh) return;
      toast(`Detached ${f.label}`, "info", { label: "Undo", onclick: async () => after(await attempt(() => attach(f.id))) });
      after(fresh);
    };
    const shown = [...list].reverse().slice(0, 3);
    return panel("files", "Attached files", { count: list.length, action: ended() ? null : dialogButton("+ Link file", add) },
      list.length ? (
        <ul key="list" className="app-files">
          {shown.map((f) => (
            <li key={f.id}>
              <a className="app-file" href={`/files/${f.document_id}?version=${f.id}`} title={`${f.label}\n${f.filename}`}>
                <FileThumb f={f} />
                <span className="app-file-name"><span translate="no">{f.label}</span><span className="muted small" translate="no">{f.filename}</span></span>
              </a>
              {ended() ? null : <span className="app-link-tools">
                {tool("edit", `Edit ${f.label}`, () => edit(f))}
                {tool("x", `Detach ${f.label}`, () => detach(f), { danger: true })}
              </span>}
            </li>
          ))}
        </ul>
      ) : <p key="none" className="muted small">None recorded.</p>,
      list.length ? <a key="all" className="al-link al-link--arrow small app-files-all" href={`/files?application=${id}`}>View all files</a> : null);
  }

  // ---- saving ----

  const changed = (a: Row, b: Row, keys: string[]) => Object.fromEntries(keys.filter((k) => (a[k] ?? null) !== (b[k] ?? null)).map((k) => [k, a[k] ?? null]));

  /** Save the section being edited: what differs from how it was. */
  async function save() {
    if (st.saving) return;
    st.saving = true;
    render();
    const d = st.draft, o = st.orig;
    const done = await attempt(async () => {
      const fields = changed(d.app, o.app, APP_KEYS);
      if (Object.keys(fields).length) {
        Object.assign(o.app, pickKeys(await patch(`applications/${id}`, fields), APP_KEYS));
        if ("url" in fields) warnIfSamePosting({ ...s.app, url: fields.url });
      }
      const cfields = changed(d.company, o.company, COMPANY_KEYS);
      if (Object.keys(cfields).length) {
        Object.assign(o.company, pickKeys(await patch(`companies/${d.app.company_id}`, cfields), COMPANY_KEYS));
      }
      await saveList("postings", d.postings, o.postings, POSTING_KEYS, (x) => !x.url, { application_id: id });
      if (s.process) {
        const pid = s.process.id;
        const pfields = changed(d.process!, o.process!, ["applied_on"]);
        if (Object.keys(pfields).length) {
          Object.assign(o.process!, pickKeys(await patch(`processes/${pid}`, pfields), PROCESS_KEYS));
        }
        const before = new Map(o.steps.map((x) => [x.id, (x.people || []).map((p: Row) => p.id).sort().join(",")]));
        await saveList("steps", d.steps, o.steps, STEP_KEYS, (x) => !x.title, { process_id: pid });
        // Who each step is with: new names become people, at this company.
        for (const x of d.steps) {
          if (x.id == null) continue;
          for (const p of x.people) {
            if (p.id == null) p.id = (await post("people", { name: p.name, company_id: d.app.company_id })).id;
          }
          const ids = x.people.map((p: Row) => p.id);
          if (ids.slice().sort().join(",") !== (before.get(x.id) || "")) {
            await put(`steps/${x.id}/people`, { person_ids: ids });
            before.set(x.id, ids.slice().sort().join(","));
          }
        }
        await saveList("notes", d.events, o.events, EVENT_KEYS, (x) => !x.body, { process_id: pid });
      }
      return true;
    });
    st.saving = false;
    render();
    if (done) {
      toast("Saved");
      // A new posting link is read, as Refresh does.
      const added = d.postings.find((x) => !s.postings.some((p) => p.id === x.id))?.url;
      const l = d.app.url && d.app.url !== s.app.url ? d.app.url : added || null;
      reload({ readLink: l });
    }
  }

  /** Save a list's rows: new ones made, changed ones updated, gone ones
   * deleted. `blank(row)`: a new row left empty is skipped. */
  async function saveList(resource: string, rows: Row[], before: Row[], keys: string[], blank: (r: Row) => boolean, extra: Row) {
    for (const old of [...before]) {
      if (!rows.some((r) => r.id === old.id)) {
        await del(`${resource}/${old.id}`);
        before.splice(before.indexOf(old), 1);
      }
    }
    for (const row of rows) {
      if (row.id == null) {
        if (blank(row)) continue;
        const made = await post(resource, { ...extra, ...pickKeys(row, keys) });
        row.id = made.id;
        before.push({ ...row });
        continue;
      }
      const old = before.find((b) => b.id === row.id)!;
      const fields = changed(row, old, keys);
      if (Object.keys(fields).length) {
        await patch(`${resource}/${row.id}`, fields);
        Object.assign(old, fields);
      }
    }
  }

  // ---- the page as it reads: what's next, the timeline, and the facts beside ----

  const ended = () => !!cycleById(s.process?.cycle_id)?.ended_on;
  /** A quick change, with the save state saying so. */
  async function saving<T>(fn: () => Promise<T>) {
    setSaveState({ state: "saving", text: "Saving…" });
    const r = await attempt(fn);
    setSaveState(r ? { state: "saved", text: "Saved" } : { text: "" });
    return r;
  }
  const stageName = (sid: number) => s.allStages.find((x) => x.id === sid)?.name || "—";
  const dayAfter = (at: string | null) => {
    const base = at && at.slice(0, 10) > isoToday() ? parseLocal(at) : parseLocal(isoToday());
    base.setDate(base.getDate() + 1);
    const d = base.toLocaleDateString("en-CA");
    return at && at.length > 10 ? `${d}${at.slice(10)}` : d;
  };

  async function archiveIt() {
    const p = s.process!;
    const body = await askArchive(s.company.name, stageName(p.stage_id));
    if (!body) return;
    if (await attempt(() => patch(`processes/${p.id}`, body))) {
      toast(`Closed ${s.company.name}: ${closingLabel(body).toLowerCase()}`, "info", { label: "Undo", onclick: async () => {
        if (await attempt(() => post(`processes/${p.id}/move`, { stage_id: p.stage_id, lane_id: p.lane_id ?? null }))) { toast("Back on the board"); reload(); }
      } });
      go("/");
    }
  }

  async function deleteIt() {
    if (!(await confirmDelete(`application ${s.app.label}`, "Its processes on the board go with it."))) return;
    if (await attempt(() => del(`applications/${id}`))) { setLeaveGuard(null); toast("Deleted"); go("/"); }
  }

  /** Refresh from a posting, in the menu: with more than one, which. */
  function refreshItems(close: () => void) {
    const links = postingLinks();
    if (links.length <= 1) return <MenuItem close={close} onClick={() => readPostings()}>{links.length ? "Refresh from a posting" : "Import from a link…"}</MenuItem>;
    return <>
      <div className="al-menu__label">Refresh from a posting</div>
      {links.map((l) => <MenuItem key={String(l.key)} close={close} onClick={() => readPostings([l])}><span translate="no">{postingName(l)}</span></MenuItem>)}
      <MenuItem close={close} onClick={() => readPostings()}>All of them</MenuItem>
    </>;
  }

  /** The role and company; the rarer things in a menu. */
  function pageHead() {
    const a = s.app, c = s.company;
    const mode = a.work_mode ? optionLabel(optionsOf("applications", "work_mode"), a.work_mode) : null;
    const where = [mode, a.location].filter(Boolean).join(", ");
    return (
      <header className="al-page-head app-page-head">
        <Logo id={c.id} logo={c.logo} name={c.name} size={48} />
        <div className="app-titles">
          <h1 id="app-title" translate="no">{a.title || c.name}</h1>
          <div className="app-sub"><a href={`/companies/${c.id}`} translate="no">{c.name}</a>
            {where ? <><span aria-hidden="true">·</span><span>{where}</span></> : null}
            {a.reference ? <><span aria-hidden="true">·</span><span translate="no" title="Role ID">{a.reference}</span></> : null}</div>
        </div>
        <div className="al-page-head__end">
          <span className="al-save-state" role="status" data-state={saveState.state}>{saveState.text}</span>
          {ended() ? null : moves()}
          <MenuButton className="al-button app-head-more" label="More" items={(close) => <>
            {ended() ? null : <>
              {refreshItems(close)}
              {s.process && runningCycles().length > 1 ? <>
                <hr className="al-menu__separator" />
                <div className="al-menu__label">Cycle</div>
                {runningCycles().map((cy) => (
                  <MenuItem key={cy.id} close={close} checked={cy.id === s.process!.cycle_id} onClick={() => moveCycle(cy.id)}><span translate="no">{cy.name}</span></MenuItem>
                ))}
              </> : null}
              <hr className="al-menu__separator" />
            </>}
            <MenuItem close={close} danger onClick={deleteIt}>Delete application</MenuItem>
          </>}><Icon name="more" /></MenuButton>
        </div>
      </header>
    );
  }

  /** Move it to another running cycle, with Undo. */
  async function moveCycle(to: number) {
    const p = s.process!, before = p.cycle_id;
    if (to === before || !(await saving(() => patch(`processes/${p.id}`, { cycle_id: to })))) return;
    p.cycle_id = to;
    await loadCycles();
    toast(`Moved to ${cycleById(to)!.name}`, "info", { label: "Undo", onclick: async () => {
      if (await attempt(() => patch(`processes/${p.id}`, { cycle_id: before }))) { await loadCycles(); reload(); }
    } });
    render();
  }

  /** Move it to `to` (and `lane`), with Undo. */
  async function moveTo(to: Row, lane: number | null = null) {
    const p = s.process!;
    const archived = p.status === "archived";
    if (to.id === p.stage_id && !archived && (lane ?? null) === (p.lane_id ?? null)) return;
    const before = { stage_id: p.stage_id, lane_id: p.lane_id ?? null };
    if (!(await saving(() => post(`processes/${p.id}/move`, { stage_id: to.id, lane_id: lane })))) return;
    const name = lane ? `${to.name} · ${s.lanes.find((l) => l.id === lane)?.name}` : to.name;
    toast(archived ? `Back on the board, in ${name}` : `Moved to ${name}`, "info", { label: "Undo", onclick: async () => {
      if (await attempt(() => post(`processes/${p.id}/move`, before))) reload();
    } });
    reload();
  }

  /** Add: a note, an interview or a reminder to the timeline, each in a dialog; none once its cycle has ended. */
  function adds() {
    if (ended()) return null;
    const item = (close: () => void, kind: "note" | "step" | "reminder", label: string) => (
      <MenuItem close={close} onClick={() => openAdding(kind, s, saving, (fresh) => { if (fresh) refreshDetail(); else reload(); })}>{label}</MenuItem>
    );
    return (
      <MenuButton title="Add to the timeline" items={(close) => <>{item(close, "note", "Note")}{item(close, "step", "Interview")}{item(close, "reminder", "Reminder")}</>}>
        <Icon name="plus" /><span>Add</span><Icon name="chevron" />
      </MenuButton>
    );
  }

  /**
   * The moves: Add (to the timeline), Stage (the board's stages to change
   * to, by swimlane, with their sub stages), and Close.
   * At its offer, Accept leads; closed, Reopen takes Stage's place.
   */
  function moves() {
    const p = s.process;
    if (!p) return null;
    if (p.status === "archived") {
      const at = s.stages.findIndex((x) => x.id === p.reached_stage_id);
      return <>
        {adds()}
        <button className="al-button al-button--primary" type="button" onClick={() => moveTo(s.stages[Math.max(at, 0)])}>Reopen</button>
      </>;
    }
    const offer = atOffer(p, s.stages) && !s.lanes.some((l) => l.id === p.lane_id && isAcceptedLane(l));
    // The swimlanes the stages are in, in the board's order; a stage in none goes under no heading.
    const groups = [...s.swimlanes, { id: null, name: null }].map((w) => ({ w, stages: s.stages.filter((x) => (x.swimlane_id ?? null) === w.id) })).filter((g) => g.stages.length);
    const stageMenu = (close: () => void) => groups.map(({ w, stages }, i) => (
      <Fragment key={String(w.id)}>
        {i ? <hr className="al-menu__separator" /> : null}
        {w.name ? <div className="al-menu__label" translate="no">{w.name}</div> : null}
        {stages.map((x) => (
          <Fragment key={x.id}>
            <MenuItem close={close} checked={x.id === p.stage_id && !p.lane_id} onClick={() => moveTo(x)}>{x.name}</MenuItem>
            {s.lanes.filter((l) => l.stage_id === x.id).map((l) => (
              <MenuItem key={l.id} close={close} className="app-menu-lane" checked={p.lane_id === l.id} onClick={() => moveTo(x, l.id)}>{l.name}</MenuItem>
            ))}
          </Fragment>
        ))}
      </Fragment>
    ));
    return <>
      {offer ? <button className="al-button al-button--primary" type="button" onClick={() => acceptOffer(p, s.company.name, s.app.title)}>Accept the offer…</button> : null}
      {adds()}
      <MenuButton title="Change stage" items={stageMenu}><span>Stage</span><Icon name="chevron" /></MenuButton>
      <button className="al-button" type="button" onClick={archiveIt}><Icon name="archive" /><span>Close</span></button>
    </>;
  }

  /**
   * Closed, or its cycle ended: a notice saying so. Its stage is on the
   * timeline, among the board's others.
   */
  function statusCard() {
    const p = s.process;
    if (!p) return standing();
    const archived = p.status === "archived";
    if (!archived && !ended()) return null;
    return (
      <section className="app-status" aria-label="Where it stands">
        {archived ? (
          <Notice kind="info">
            <div className="al-notice__title">Closed: {closedWhy(p, stageName(p.stage_id))}</div>
            {p.archive_note ? <div className="small" translate="no">{p.archive_note}</div> : null}
          </Notice>
        ) : null}
        {ended() ? <Notice kind="info"><div className="al-notice__title">{`${cycleById(p.cycle_id)!.name} has ended`}</div><div className="small">This application is kept as it was then.</div></Notice> : null}
      </section>
    );
  }

  /** When it came into each stage: from its moves, the latest; the one it started in, when it was added. */
  function enteredAt() {
    const p = s.process!;
    const moves = (s.detail?.activity || [])
      .filter((a: Row) => a.action === "moved" && Array.isArray(a.changes?.stage_id) && a.changes.stage_id[0] !== a.changes.stage_id[1])
      .sort((a: Row, b: Row) => a.at.localeCompare(b.at));
    const at = new Map<number, string>();
    const first = moves.length ? moves[0].changes.stage_id[0] : p.stage_id;
    if (first != null && p.created_at) at.set(first, p.created_at);
    for (const m of moves) at.set(m.changes.stage_id[1], m.at);
    return at;
  }

  const steps = (): Row[] => s.detail?.steps || [];
  const isUrl = (v: string | null | undefined) => /^(https?:\/\/|[\w-]+\.[\w.-]+\/)/i.test(v || "");
  const hrefOf = (v: string) => (/^https?:/i.test(v) ? v : `https://${v}`);
  /** A step's length: as Admin's list names it, or in minutes and hours. */
  const minutesText = (n: number | null | undefined) => {
    if (!n) return null;
    const named = listOf("step_length").find(([v]) => Number(v) === Number(n));
    return named ? named[1] : n % 60 === 0 && n >= 60 ? `${n / 60} hr` : `${n} min`;
  };
  const withWhom = (x: Row) => (x.people?.length || x.attendees
    ? <span><span>with</span>{" "}<span translate="no">{x.people?.length ? x.people.map((pe: Row) => pe.name).join(", ") : x.attendees}</span></span> : null);

  /**
   * The timeline, the system's: one line, in the order things happen, top
   * to bottom. What happened: the stages it came through (the one it's in
   * marked), your notes, and the interviews that took place. Then what's
   * coming up, the soonest first: interviews still to happen and reminders
   * not yet done. Last, its swimlane's stages still to come, greyed. A stage
   * with an icon (the board's settings) is marked with it. On the page it's
   * compact, each entry a line, beside the interviews as cards (each gets
   * its outcome there); Full timeline, beneath it, opens it whole, every
   * entry's details and buttons with it. Each is added from Add, beside
   * Stage, in a dialog; each note and interview has Edit, Move and Delete,
   * Edit opening a form for it alone.
   */
  function timelinePanel() {
    if (!s.process) return null;
    return panel("timeline", "Timeline", { headless: true },
      <div key="cols" className="app-tl-cols">
        <div className="app-tl-col">
          {panelHead("timeline", "Timeline")}
          <ol className="al-timeline app-tl is-compact" aria-label="Timeline">{timelineLine(true)}</ol>
          <button className="al-button al-button--quiet al-button--sm app-tl-full" type="button" aria-haspopup="dialog" onClick={() => { opened.add("tl-full"); render(); }}>Full timeline</button>
        </div>
        {stepCards()}
      </div>,
      opened.has("tl-full") ? <PageDialog key="full" title="Timeline" onClose={() => { opened.delete("tl-full"); render(); }}>
        <ol className="al-timeline app-tl">{timelineLine(false)}</ol>
      </PageDialog> : null,
      st.section === "timeline" ? itemForm() : null);
  }

  /** How an interview went, to say once it's happened (or as it's due). */
  const logOutcome = (x: Row, gone: boolean) => {
    const statuses = optionsOf("steps", "status");
    return (
      <MenuButton className={`al-button al-button--sm${gone ? "" : " al-button--quiet"}`} items={(close) => <>
        <div className="al-menu__label">How did it go?</div>
        {statuses.filter(([v]) => v !== "scheduled").map(([v, l]) => (
          <MenuItem key={v} close={close} onClick={async () => {
            if (await saving(() => patch(`steps/${x.id}`, { status: v }))) {
              toast(`${x.title}: ${l}`, "info", { label: "Undo", onclick: async () => { if (await attempt(() => patch(`steps/${x.id}`, { status: "scheduled" }))) refreshDetail(); } });
              refreshDetail();
            }
          }}>{l}</MenuItem>
        ))}
      </>}><span>Log outcome</span></MenuButton>
    );
  };
  /** An interview's link to join by, while it's still to come. */
  const joinButton = (x: Row) => (isUrl(x.place) && !isOverdue(x.at)
    ? <a className="al-button al-button--sm" href={hrefOf(x.place)} target="_blank" rel="noreferrer" title={x.place}>Join</a> : null);
  /** Where an interview is, and what to prepare. */
  const stepPlace = (x: Row) => (x.place ? (isUrl(x.place) ? <a className="al-link tl-sub" href={hrefOf(x.place)} target="_blank" rel="noreferrer">{x.place}</a> : <span className="tl-sub">{x.place}</span>) : null);
  const stepPrep = (x: Row) => (x.prep_note ? <div className="tl-prep"><span className="tl-prep-label">Prepare:</span> <RichView className="tl-rich" value={x.prep_note} /></div> : null);
  const stepTone = (x: Row) => (x.status === "failed" ? "danger" : ["passed", "completed", "done"].includes(x.status) ? "success" : undefined);

  /** The timeline's entries, in order; compact, each a line, its details and an interview's buttons left to the cards. */
  function timelineLine(compact: boolean) {
    const p = s.process!;
    const archived = p.status === "archived";
    const statuses = optionsOf("steps", "status");
    // Closed, it's in an inactive stage: the line shows the one it reached, and none to come.
    const at = s.stages.findIndex((x) => x.id === (archived ? p.reached_stage_id : p.stage_id));
    const entered = enteredAt();

    /** One entry: its marker, its time, what it is with its buttons beside, and a line or two more. */
    const entry = (key: string, o: { cls?: string; tone?: string; marker?: ReactNode; time?: string | null; datetime?: string | null; late?: boolean; title: ReactNode; tools?: ReactNode; body?: ReactNode; current?: boolean }) => (
      <li key={key} className={o.cls} aria-current={o.current ? "step" : undefined}>
        <span className="al-timeline__marker" data-tone={o.tone} aria-hidden="true">{o.marker}</span>
        <div className="al-timeline__event">
          <div className="app-tl-head">
            <div className="al-timeline__title">{o.title}</div>
            {o.tools ? <span className="app-tl-tools">{o.tools}</span> : null}
            {o.time ? <span className={`al-timeline__time${o.late ? " is-late" : ""}`}>{o.datetime ? <time dateTime={o.datetime}>{o.time}</time> : o.time}</span> : null}
          </div>
          {o.body && !compact ? <div className="al-timeline__body">{o.body}</div> : null}
        </div>
      </li>
    );

    const stage = (x: Row, i: number, next = false) => {
      const when = entered.get(x.id)?.slice(0, 10) || null;
      const icon = (plain: string | null) => (x.icon ? <Icon name={x.icon} /> : plain ? <Icon name={plain} /> : null);
      if (i > at) return entry(`g${x.id}`, { cls: "app-tl-stage is-future", marker: icon(null), title: x.name, time: next ? "Next stage" : null });
      if (i < at) return entry(`g${x.id}`, { cls: "app-tl-stage", marker: icon("check"), title: x.name, time: when ? fmtDay(when) : null, datetime: when });
      const lane = archived ? null : s.lanes.find((l) => l.id === p.lane_id);
      const swimlane = s.swimlanes.find((w) => w.id === x.swimlane_id);
      return entry(`g${x.id}`, {
        cls: "app-tl-stage is-current", current: true, tone: "accent", marker: icon("flag"),
        // Where it is now, in so many words; closed, where it stopped.
        title: <>{x.name}{lane ? <span className="app-tl-lane">{lane.name}</span> : null}
          {archived ? <span className="al-badge app-tl-here">Closed here</span> : <span className="al-badge al-badge--accent app-tl-here">You are here</span>}</>,
        time: when ? (archived ? fmtDay(when) : `Since ${fmtDay(when)}`) : null, datetime: when,
        body: swimlane ? <span translate="no">{swimlane.name}</span> : null,
      });
    };

    const scheduled = (x: Row) => {
      const gone = isOverdue(x.at);
      const sub = dotted([x.format, minutesText(x.minutes), withWhom(x)]);
      return entry(`s${x.id}`, {
        cls: "app-tl-step", tone: "accent", marker: <Icon name="cal" />, title: <span translate="no">{x.title}</span>,
        time: x.at ? fmtStamp(x.at) : "Date not set", datetime: x.at, late: gone,
        tools: ended() || compact ? null : <>{joinButton(x)}{logOutcome(x, gone)}{itemMenu("steps", x, x.title)}</>,
        body: sub.length || x.place || x.prep_note ? <>
          {sub.length ? <span className="tl-sub">{sub}</span> : null}
          {stepPlace(x)}
          {stepPrep(x)}
        </> : null,
      });
    };
    const reminder = (r: Row) => {
      const late = isOverdue(r.due_at);
      return entry(`r${r.id}`, {
        cls: "app-tl-reminder", tone: late ? "warning" : undefined, marker: <Icon name="bell" />, title: <span translate="no">{r.title}</span>,
        time: r.due_at ? (late ? `Was due ${fmtDay(r.due_at)}` : fmtDay(r.due_at)) : "No date", datetime: r.due_at, late,
        tools: ended() ? null : <>
          <button className="al-button al-button--sm" type="button" onClick={async () => {
            if (await saving(() => patch(`reminders/${r.id}`, { done_at: localNow() }))) {
              toast(`Marked done: ${r.title}`, "info", { label: "Undo", onclick: async () => { if (await attempt(() => patch(`reminders/${r.id}`, { done_at: null }))) reload(); } });
              reload();
            }
          }}><Icon name="check" /><span>Done</span></button>
          {compact ? null : <button className="al-button al-button--quiet al-button--sm" type="button" onClick={async () => {
            const before = r.due_at;
            if (await saving(() => patch(`reminders/${r.id}`, { due_at: dayAfter(r.due_at) }))) {
              toast("Snoozed until tomorrow", "info", { label: "Undo", onclick: async () => { if (await attempt(() => patch(`reminders/${r.id}`, { due_at: before }))) reload(); } });
              reload();
            }
          }}>Snooze a day</button>}
        </>,
      });
    };
    const happened = (x: Row) => {
      const sub = dotted([<span className="tl-status">{optionLabel(statuses, x.status)}</span>, x.format, minutesText(x.minutes), withWhom(x)]);
      return entry(`s${x.id}`, {
        cls: `app-tl-step is-${x.status}`, tone: stepTone(x), title: <span translate="no">{x.title}</span>,
        time: x.at ? fmtStamp(x.at) : "No date", datetime: x.at,
        tools: compact ? null : itemMenu("steps", x, x.title),
        body: <><span className="tl-sub">{sub}</span>{x.note ? <span className="tl-note" translate="no">{x.note}</span> : null}</>,
      });
    };
    const note = (n: Row) => {
      const day = n.happened_on || n.created_at.slice(0, 10);
      return entry(`n${n.id}`, { cls: "app-tl-note", title: <RichView className="tl-serif" value={n.body} />, time: fmtDay(day), datetime: day, tools: itemMenu("notes", n, "this note") });
    };

    // What happened, oldest first, the stage it's in among it (at the end, if when it came in isn't known).
    // A stage it skipped goes just before the one after it.
    let carry = (at >= 0 && entered.get(s.stages[at].id)) || "~";
    const passed = s.stages.slice(0, Math.max(at + 1, 0)).map((x, i) => ({ x, i })).reverse().map(({ x, i }) => {
      carry = entered.get(x.id) || carry;
      return { at: carry, ord: i, node: stage(x, i) };
    });
    const past = [
      ...passed,
      ...steps().filter((x) => x.status !== "scheduled").map((x) => ({ at: x.at || x.created_at, ord: 1e9, node: happened(x) })),
      ...(s.detail?.notes || []).map((n: Row) => ({ at: n.happened_on ? `${n.happened_on}T${n.created_at.slice(11)}` : n.created_at, ord: 1e9, node: note(n) })),
    ].sort((a, b) => (a.at || "").localeCompare(b.at || "") || a.ord - b.ord);
    // Coming up, the soonest first; one without a date, last.
    const coming = [
      ...steps().filter((x) => x.status === "scheduled").map((x) => ({ at: x.at || "9", node: scheduled(x) })),
      ...s.reminders.filter((r) => !r.done_at).map((r) => ({ at: r.due_at || "9", node: reminder(r) })),
    ].sort((a, b) => a.at.localeCompare(b.at));
    // The stages still to come in its swimlane (a stage in none being in the first).
    const swimlaneOf = (x: Row) => (s.swimlanes.some((w) => w.id === x.swimlane_id) ? x.swimlane_id : s.swimlanes[0]?.id ?? null);
    const future = archived || at < 0 ? [] : s.stages.map((x, i) => ({ x, i }))
      .filter(({ x, i }) => i > at && swimlaneOf(x) === swimlaneOf(s.stages[at]))
      .map(({ x, i }, n) => stage(x, i, n === 0));
    return [...past.map((c) => c.node), ...coming.map((c) => c.node), ...future];
  }

  /** The interviews, each a card: those to come first, the soonest first; then those that happened, the latest first. */
  function stepCards() {
    const statuses = optionsOf("steps", "status");
    const upcoming = steps().filter((x) => x.status === "scheduled").sort((a, b) => (a.at || "9").localeCompare(b.at || "9"));
    const done = steps().filter((x) => x.status !== "scheduled").sort((a, b) => (b.at || b.created_at).localeCompare(a.at || a.created_at));
    const card = (x: Row) => {
      const coming = x.status === "scheduled";
      const gone = coming && isOverdue(x.at);
      const sub = dotted([x.format, minutesText(x.minutes), withWhom(x)]);
      const tone = stepTone(x);
      return (
        <article key={x.id} className={`al-card app-step-card is-${x.status}`} data-step-id={x.id}>
          <div className="app-step-card-head">
            <h4 translate="no">{x.title}</h4>
            {ended() ? null : <span className="app-tl-tools">{coming ? <>{joinButton(x)}{logOutcome(x, gone)}</> : null}{itemMenu("steps", x, x.title)}</span>}
          </div>
          <div className="app-step-card-when">
            {coming ? <Icon name="cal" /> : <span className={`al-badge${tone ? ` al-badge--${tone}` : ""}`}>{optionLabel(statuses, x.status)}</span>}
            <span className={gone ? "is-late" : undefined}>{x.at ? <time dateTime={x.at}>{fmtStamp(x.at)}</time> : coming ? "Date not set" : "No date"}</span>
          </div>
          {sub.length ? <span className="tl-sub">{sub}</span> : null}
          {coming ? stepPlace(x) : null}
          {coming ? stepPrep(x) : null}
          {x.note ? <span className="tl-note" translate="no">{x.note}</span> : null}
        </article>
      );
    };
    const add = ended() ? null : (
      <button className="al-button al-button--quiet al-button--sm" type="button" onClick={() => openAdding("step", s, saving, (fresh) => { if (fresh) refreshDetail(); else reload(); })}>
        <Icon name="plus" /><span>Interview</span></button>
    );
    return (
      <section className="app-step-cards" aria-label="Interviews">
        {upcoming.length ? <><h4 className="app-step-cards-sub">Upcoming Interviews</h4>{upcoming.map(card)}</> : null}
        {done.length ? <><h4 className="app-step-cards-sub">Past Interviews</h4>{done.map(card)}</> : null}
        {upcoming.length || done.length ? null : <p className="muted small">No interviews yet.</p>}
        {add ? <div className="app-panel-tools">{add}</div> : null}
      </section>
    );
  }

  /** An interview or note on the timeline, edited on its own, in a dialog. */
  function itemForm() {
    const statuses = optionsOf("steps", "status");
    const lengths = listOf("step_length");
    const it = st.item!;
    const i = (it.kind === "step" ? draft.steps : draft.events).findIndex((x) => x.id === it.id);
    if (i < 0) return null;
    const stepRow = (x: Row) => (
      <li key={`s${x.id}`} className={`is-${x.status}`} data-step={i} data-step-id={x.id}>
        <span className="dot" aria-hidden="true" />
        <div className="app-step-edit">
          {input(x, "title", { placeholder: "A step, e.g. Recruiter screen", "aria-label": "Step" })}
          <div className="app-grid app-step-fields">
            {labeled("When", input(x, "at", { type: "datetime-local", step: 900, "aria-label": "When" }))}
            {labeled("Status", select(x, "status", statuses, { empty: null, label: "Status" }))}
            {labeled("Format", input(x, "format", { placeholder: "e.g. Video call", "aria-label": "Format", list: "app-step-formats" }))}
            {labeled("Length", select(x, "minutes", lengths, { label: "Length" }))}
            {labeled("Joining link or address", input(x, "place", { placeholder: "meet.example/… or an office address", "aria-label": "Joining link or address" }), true)}
          </div>
          {stepPeople(x, i)}
          <div className="app-field"><span>What to prepare</span>{rich(x, "prep_note", "What to prepare", "Topics they mentioned, things to bring", 2)}</div>
          {labeled("Notes", input(x, "note", { multiline: true, rows: 2, placeholder: "Questions asked, feedback…", "aria-label": "Notes" }))}
        </div>
      </li>
    );
    const eventRow = (x: Row) => (
      <li key={`e${x.id}`} className="is-event" data-event-id={x.id}>
        <span className="dot" aria-hidden="true" />
        <div className="app-event-edit">
          {input(x, "happened_on", { type: "date", "aria-label": "When" })}
          {rich(x, "body", "Note", "What happened", 4)}
        </div>
      </li>
    );
    const step = it.kind === "step";
    return (
      <PageDialog key={`item-${st.formKey}`} title={step ? "Edit the interview" : "Edit the note"} dismiss={() => editSection(null)} actions={<>
        <button className="al-button" type="button" onClick={() => editSection(null)}>Cancel</button>
        <button className="al-button al-button--primary" type="button" aria-busy={st.saving ? "true" : undefined} onClick={save}>Save</button>
      </>}>
        <ol className="app-steps app-timeline">{step ? stepRow(draft.steps[i]) : eventRow(draft.events[i])}</ol>
        {step ? <datalist id="app-step-formats">{listOf("step_format").map(([v]) => <option key={v} value={v} />)}</datalist> : null}
      </PageDialog>
    );
  }

  /** Who a step is with: people from People, or new names, made on Save. */
  function stepPeople(x: Row, i: number) {
    const refocus = () => focus(`.app-timeline [data-step="${i}"] .app-with input`);
    const people = refSource("people");
    return (
      <div className="app-with">
        <span className="app-with-label">With</span>
        {x.people.map((p: Row, j: number) => (
          <span key={`${p.id}-${p.name}`} className="al-tag" title={p.id == null ? "Added to People when you save" : undefined}>{p.name}{p.id == null ? " (new)" : ""}
            <button className="al-tag__remove" type="button" aria-label={`Remove ${p.name}`} onClick={() => { x.people.splice(j, 1); render(); refocus(); }}>×</button></span>
        ))}
        <Combo key={x.people.length} label="With whom" placeholder={x.people.length ? "Add someone else…" : "With whom: someone from People, or a new name"} allowCreate
          source={async (q) => (await people(q)).filter((it) => !x.people.some((p: Row) => p.id === it.value))}
          onPick={(it) => {
            if (it.create) {
              if (!x.people.some((p: Row) => p.id == null && p.name.toLowerCase() === it.value.toLowerCase())) x.people.push({ id: null, name: it.value });
            } else {
              x.people.push({ id: it.value, name: it.label.replace(/ \([^)]*\)$/, "") });
            }
            render();
            refocus();
          }} />
        {x.attendees ? <p className="muted small app-with-before">{`Written before: “${x.attendees}” `}
          <button className="al-button al-button--sm al-button--quiet" type="button" onClick={() => { x.attendees = null; render(); }}>Clear</button></p> : null}
      </div>
    );
  }

  /** Its prep: how far along, and what's next. */
  function prepPanel() {
    const p = s.process;
    if (!p) return null;
    const mine = s.prep.filter((x) => x.status !== "closed");
    const done = mine.filter(isDone).length;
    const open = mine.filter((x) => !isDone(x)).sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]).slice(0, 3);
    const toPrep = () => store("prep", JSON.stringify({ ...prepState(), tab: "tasks", for: String(p.id), step: "" }));
    return panel("prep", "Prep", { action: <a className="al-link small" href="/prep" onClick={(e) => { e.preventDefault(); toPrep(); go("/prep"); }}>Open in Prep</a> },
      ...(mine.length ? [
        <span key="bar" className="prep-bar" aria-hidden="true"><span style={{ inlineSize: `${(done / mine.length) * 100}%` }} /></span>,
        <span key="count" className="muted small">{`${done} of ${mine.length} done`}</span>,
        open.length ? (
          <ul key="open" className="app-prep">
            {open.map((x) => (
              <li key={x.id}>
                <input type="checkbox" aria-label={`Done: ${x.title}`} disabled={ended() || undefined} onChange={async (e) => {
                  if (await saving(() => post(`prep/${x.id}/tick`, { done: e.target.checked }))) { toast(`Done: ${x.title}`); reload(); }
                }} />
                <span translate="no">{x.title}</span>
              </li>
            ))}
          </ul>
        ) : null,
      ] : [<p key="none" className="muted small">Nothing to prepare yet.</p>]),
      ended() ? null : (
        <button key="add" className="al-button al-button--quiet al-button--sm app-panel-add" type="button" aria-haspopup="dialog" onClick={() => openPrepAdding(p.id, () => reload())}>
          <Icon name="plus" /><span>{`Add prep for ${s.company.name}`}</span></button>
      ));
  }

  /** Links kept with it: the candidate portal, prep material, invites; each added, changed, moved or removed from its menu, in a dialog. */
  function linksPanel() {
    const kinds = optionsOf("links", "kind");
    const named = (l: Row) => linkName(l) || hostOf(l.url);
    const remove = async (l: Row) => {
      if (!(await saving(() => del(`links/${l.id}`)))) return;
      toast("Link removed", "info", { label: "Undo", onclick: async () => {
        if (await attempt(() => post("links", { application_id: id, url: l.url, label: linkName(l), kind: l.kind }))) reload();
      } });
      reload();
    };
    return panel("links", "Links", {
      action: ended() ? null : dialogButton("Add a link", () => openLinkForm(null)),
    },
    s.links.length ? (
      <ul key="list" className="app-links">
        {s.links.map((l) => (
          <li key={l.id}>
            {/* By its name, if it has one; else where it goes. */}
            <div className="app-link"><a href={l.url} target="_blank" rel="noreferrer" title={l.url} translate="no">{named(l)}</a>
              <span className="muted small">{dotted([optionLabel(kinds, l.kind), linkName(l) ? <span translate="no">{hostOf(l.url)}</span> : null])}</span></div>
            {ended() ? null : (
              <MenuButton className="al-button al-button--quiet al-button--sm" label={`More for ${named(l)}`} items={(close) => <>
                <MenuItem close={close} onClick={() => openLinkForm({ link: l })}>Edit</MenuItem>
                <MenuItem close={close} onClick={() => transfer("links", l.id, named(l))}>Move to another application…</MenuItem>
                <hr className="al-menu__separator" />
                <MenuItem close={close} danger onClick={() => remove(l)}>Remove</MenuItem>
              </>}><Icon name="more" /></MenuButton>
            )}
          </li>
        ))}
      </ul>
    ) : <p key="none" className="muted small">Keep the candidate portal, prep material and anything else you'll open again.</p>);
  }

  // Where it stands first; then the timeline, the details, the notes, the
  // mail and the pay. Its prep, people, links and files beside.
  const p = s.process;
  const rest = s.procs.filter((x) => x.id !== p?.id);
  return (
    <div className="page application reading" ref={page}
      onKeyDown={(e) => { if (st.section && (e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); } }}>
      <a className="al-back-link" href="/">Applications</a>
      {pageHead()}
      {statusCard()}
      <div className="app-layout">
        <div className="app-main">
          {timelinePanel()}
          {rolePanel()}
          {companyPanel()}
          {payPanel()}
          {notesPanel()}
          {p ? emails() : null}
        </div>
        <aside className="app-aside" aria-label="About this application">
          {prepPanel()}
          {p ? people() : null}
          {linksPanel()}
          {p ? files() : null}
          {panel("tags", "Tags", {}, <TagEditor key="tags" resource="applications" rec={s.app} />)}
          {rest.length ? panel("others", "Other processes", {}, (
            <ul key="list" className="app-links">
              {rest.map((x) => (
                <li key={x.id}><a href={`/applications/${id}?process=${x.id}`}>{x.status === "archived" ? `Closed at ${stageName(x.reached_stage_id)}` : `In ${stageName(x.stage_id)}`}</a>
                  <span className="muted small">{`${cycleById(x.cycle_id)?.name || ""} · added ${fmtDay(x.created_at.slice(0, 10))}`}</span></li>
              ))}
            </ul>
          )) : null}
        </aside>
      </div>
    </div>
  );
}

/**
 * A dialog drawn with the page, so what's in it stays as current as the page;
 * closed, `onClose`. With `dismiss`, Escape and a click outside ask it
 * instead, and the page takes the dialog away; `actions` replace Close.
 */
function PageDialog({ title, onClose, dismiss, actions, children }: { title: string; onClose?: () => void; dismiss?: () => void; actions?: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className="al-dialog wide app-page-dialog" aria-labelledby="page-dialog-title" onClose={onClose}
      onCancel={(e) => { if (dismiss) { e.preventDefault(); dismiss(); } }}
      onClick={(e) => { if (e.target === e.currentTarget) { if (dismiss) dismiss(); else e.currentTarget.close(); } }}>
      <div className="al-dialog__inner">
        <h2 className="al-dialog__title" id="page-dialog-title">{title}</h2>
        <div className="al-dialog__body">{children}</div>
        <div className="al-dialog__actions">{actions ?? <button className="al-button" type="button" onClick={() => ref.current?.close()}>Close</button>}</div>
      </div>
    </dialog>
  );
}

// ---- adding, in place ------------------------------------------------------------------

/** Someone on the process: from People, a new name, or a LinkedIn profile link. */
function PersonAdd({ roles, onAdd }: { roles: [string, string][]; onAdd: (body: Row) => Promise<void> }) {
  const chosen = useRef<Row | null>(null);
  const who = useRef<HTMLInputElement>(null);
  const [role, setRole] = useState("");
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      const name = (who.current?.value || "").trim();
      if (!name) return;
      let body: Row = chosen.current && !chosen.current.create ? { person_id: chosen.current.value } : { name };
      // A profile link: read it, and add who it's about.
      if (looksLikeProfile(name)) {
        toast("Reading the profile…");
        const found = await attempt(() => post("people/lookup", { url: name }));
        const person = found && await attempt(() => personFromProfile(found));
        if (!person) return;
        body = { person_id: person.id };
      }
      body.role = role || null;
      await onAdd(body);
    }}>
      <h2 className="al-dialog__title" id="modal-title">Add someone</h2>
      <div className="al-dialog__body">
        <Field><Label htmlFor="pa-person">Person</Label>
          <Combo id="pa-person" label="Person" placeholder="Name, or a LinkedIn profile link" source={refSource("people")} allowCreate typeFirst inputRef={who}
            onPick={(it) => { chosen.current = it; }} onInput={() => { chosen.current = null; }} /></Field>
        <Field><Label htmlFor="pa-role">Role <Optional /></Label>
          <Select id="pa-role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Not set</option>{roles.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select></Field>
      </div>
      {dialogActions("Add")}
    </form>
  );
}

/** A file's thumbnail: an image, small; anything else, its kind by its extension. */
function FileThumb({ f }: { f: Row }) {
  if ((f.content_type || "").startsWith("image/")) return <img className="file-thumb" src={`/api/versions/${f.id}/file`} alt="" loading="lazy" />;
  const ext = f.filename.match(/\.([a-z0-9]{1,5})$/i)?.[1];
  return <span className="file-thumb" aria-hidden="true"><Icon name="file" />{ext ? <span translate="no">{ext.toUpperCase()}</span> : null}</span>;
}

/** A file being uploaded, named, with a way to choose again. */
const uploading = (file: File, label: string, clear: () => void) => (
  <p className="small app-upload-chosen">{`${label}: ${file.name} (${fmtSize(file.size)})`}{" "}
    <button className="al-button al-button--quiet al-button--sm" type="button" onClick={clear}>Remove</button></p>
);

/** A file sent with the process: a version from Files, or a file uploaded here (the next version of the document named like it, or a new one). */
function FileAdd({ onAdd }: { onAdd: (versionId: number) => Promise<void> }) {
  const chosen = useRef<Row | null>(null);
  const [file, setFile] = useState<File | null>(null);
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      if (file) {
        const v = await attempt(() => acceptFile(file));
        if (v) await onAdd(v.id);
        return;
      }
      if (!chosen.current) { toast("Pick a file from the list, or upload one", "error"); return; }
      await onAdd(chosen.current.value);
    }}>
      <h2 className="al-dialog__title" id="modal-title">Link a file</h2>
      <div className="al-dialog__body">
        {file ? uploading(file, "To upload", () => setFile(null)) : <>
          <Field><Label htmlFor="fa-file">From Files</Label>
            <Combo id="fa-file" label="File" placeholder="Search files, e.g. resume" source={refSource("versions")} typeFirst
              onPick={(it) => { chosen.current = it; }} onInput={() => { chosen.current = null; }} /></Field>
          <FileDrop label="Or upload one" hint="A file named like a document (cv.pdf → “cv”) becomes its next version; anything else, a new document." onFiles={([f]) => setFile(f)} />
        </>}
      </div>
      {dialogActions(file ? "Upload and link" : "Link file")}
    </form>
  );
}

/** A file sent with the process, changed: another of its versions sent instead, or a new version uploaded and sent. */
function FileEdit({ f, onSave }: { f: Row; onSave: (versionId: number) => Promise<void> }) {
  const [versions, setVersions] = useState<Row[] | null>(null);
  const [pick, setPick] = useState<number>(f.id);
  const [file, setFile] = useState<File | null>(null);
  const [tag, setTag] = useState("");
  useEffect(() => {
    attempt(() => get(`versions?document_id=${f.document_id}`)).then((vs) => setVersions(vs ? [...vs].sort((a: Row, b: Row) => b.number - a.number) : null));
  }, []);
  const name = (v: Row) => `v${v.number}${v.tag ? ` (${v.tag})` : ""} · ${v.filename}`;
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      if (file) {
        const v = await attempt(() => uploadVersion(f.document_id, file, { tag: tag.trim() || undefined }));
        if (v) await onSave(v.id);
        return;
      }
      await onSave(pick);
    }}>
      <h2 className="al-dialog__title" id="modal-title"><span translate="no">{f.document}</span></h2>
      <div className="al-dialog__body">
        {file ? <>
          {uploading(file, "New version", () => setFile(null))}
          <Field><Label htmlFor="fe-tag">Tag <Optional /></Label>
            <Input id="fe-tag" placeholder="e.g. rust-focused" value={tag} onChange={(e) => setTag(e.target.value)} /></Field>
        </> : <>
          <Field><Label htmlFor="fe-version">Version sent</Label>
            <Select id="fe-version" value={String(pick)} disabled={!versions} onChange={(e) => setPick(Number(e.target.value))}>
              {(versions || [f]).map((v) => <option key={v.id} value={String(v.id)} translate="no">{name(v)}</option>)}
            </Select></Field>
          <FileDrop label="Or upload a new version" onFiles={([x]) => setFile(x)} />
        </>}
        <a className="al-link small" href={`/files/${f.document_id}?version=${f.id}`}>Open in Files</a>
      </div>
      {dialogActions(file ? "Upload and send" : "Save")}
    </form>
  );
}

type LinkValue = { url: string; label: string | null; kind: string; read?: boolean };

/**
 * A link, in a dialog: a job posting (`kind` "posting", the first, and
 * chosen for a new one) or one kept with the application; a new one, or `l`
 * changed. A posting is named as it's read, so it has no Name.
 */
function LinkForm({ l, kinds, onSave }: { l: LinkValue | null; kinds: [string, string][]; onSave: (v: LinkValue) => Promise<void> }) {
  const [v, setV] = useState({ url: l?.url ?? "", label: l?.label ?? "", kind: l?.kind ?? "posting", read: false });
  const posting = v.kind === "posting";
  // A posting link that's new (or was kept as another kind) can be read once it's added.
  const added = posting && l?.kind !== "posting";
  const hint = posting ? (added ? null : "Its text stays; Refresh reads the new link.")
    : l?.kind === "posting" ? "Kept as a link: the text read from it goes." : null;
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      if (!v.url.trim()) return;
      await onSave({ url: v.url.trim(), label: v.label.trim() || null, kind: v.kind, read: added && v.read });
    }}>
      <h2 className="al-dialog__title" id="modal-title">{l ? "Edit the link" : "Add a link"}</h2>
      <div className="al-dialog__body">
        <Field><Label htmlFor="lf-kind">Kind</Label>
          <Select id="lf-kind" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>{kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field><Label htmlFor="lf-url">Link</Label><Input id="lf-url" type="url" required placeholder="https://…" value={v.url} onChange={(e) => setV({ ...v, url: e.target.value })} />
          {hint ? <span className="al-hint">{hint}</span> : null}</Field>
        <Field><Label htmlFor="lf-label">Name <Optional /></Label><Input id="lf-label" placeholder={posting ? "e.g. On LinkedIn" : "e.g. Candidate portal"} value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} /></Field>
        {added ? <label className="check al-choice"><input type="checkbox" id="lf-read" checked={v.read} onChange={(e) => setV({ ...v, read: e.target.checked })} /><span>Refresh role details from the link</span></label> : null}
      </div>
      {dialogActions(l ? "Save" : posting && v.read ? "Add and read" : "Add link")}
    </form>
  );
}

/** Someone's role on the process, changed. */
function PersonRole({ pe, roles, onSave }: { pe: Row; roles: [string, string][]; onSave: (role: string | null) => Promise<void> }) {
  const [role, setRole] = useState<string>(pe.role ?? "");
  // A role no longer on the list still shows.
  const options = pe.role && !roles.some(([v]) => v === pe.role) ? [...roles, [pe.role, pe.role] as [string, string]] : roles;
  return (
    <form onSubmit={async (e) => { e.preventDefault(); await onSave(role || null); }}>
      <h2 className="al-dialog__title" id="modal-title"><span translate="no">{pe.name}</span></h2>
      <div className="al-dialog__body">
        <Field><Label htmlFor="pr-role">Role</Label>
          <Select id="pr-role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Not set</option>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select></Field>
      </div>
      {dialogActions("Save")}
    </form>
  );
}

/** Adding an email: a file (dropped or chosen), or the message's text pasted. */
function EmailAdd({ processId, onAdded, onCancel }: { processId: number; onAdded: () => void; onCancel: () => void }) {
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const add = async (items: [string, BodyInit][]) => {
    const added = await attempt(async () => {
      const out: string[] = [];
      for (const [name, body] of items) {
        const res = await fetch(`/api/processes/${processId}/emails`, { method: "POST", headers: { "Content-Type": "message/rfc822" }, body });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`${name}: ${data.error || res.statusText}`);
        out.push(data.subject);
      }
      return out;
    });
    if (added) { toast(`Added ${added.map((x) => `“${x}”`).join(", ")}`); onAdded(); }
    return !!added;
  };
  const drop = useFileDrop((files) => add(files.map((f) => [f.name, f])));
  return (
    <form className={`email-add${drop.over ? " file-over" : ""}`} data-unsaved="" {...drop.props} onSubmit={async (e) => {
      e.preventDefault();
      const el = box.current!;
      if (!el.value.trim()) { toast("Paste the message first, or choose a file", "error"); el.focus(); return; }
      await add([["the pasted email", el.value]]);
    }}>
      <div className="email-add-ways">
        <input type="file" accept=".eml,message/rfc822" multiple hidden ref={picker} onChange={(e) => { const f = e.currentTarget.files; if (f?.length) add([...f].map((x) => [x.name, x])); }} />
        <button className="al-button" type="button" onClick={() => picker.current?.click()}>Drop or choose an .eml file</button>
        <span className="muted small">or</span>
        <button className="al-button" type="button" onClick={async () => {
          const el = box.current!;
          try { el.value = await navigator.clipboard.readText(); } catch { /* the browser asks; fall back to typing */ }
          el.focus();
          if (!el.value) toast("Paste it into the box (⌘V)");
        }}>Paste it</button>
      </div>
      <TextArea ref={box} rows={5} placeholder="…or paste the message's original text here" aria-label="The email's original text" />
      <div className="actions">
        <button className="al-button" type="button" onClick={(e) => {
          if (!mayDiscard(e.currentTarget)) return;
          if (box.current) box.current.value = "";
          onCancel();
        }}>Cancel</button>
        <button className="al-button al-button--primary" type="submit">Add email</button>
      </div>
    </form>
  );
}

/** A thread of emails, folded until opened (its messages loaded then). */
function EmailThread({ msgs, onMove, onRemoved }: { msgs: Row[]; onMove: ((m: Row) => unknown) | null; onRemoved: () => void }) {
  const [open, setOpen] = useState(false);
  const last = msgs[msgs.length - 1];
  const who = (m: Row) => (m.outgoing ? "You" : m.from_name || m.from_addr || "Unknown");
  const people = [...new Set(msgs.map(who))];
  return (
    <li>
      <details className="email-thread" onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>
          <span className="app-email-icon" aria-hidden="true">✉</span>
          <span className="app-email-what"><b>{msgs[0].subject || "(no subject)"}</b>
            <span className="muted small">{people.join(", ")}{msgs.length > 1 ? ` · ${msgs.length} messages` : ""}</span></span>
          <time className="muted small" dateTime={last.sent_at}>{fmtStamp(last.sent_at)}</time>
        </summary>
        <div className="email-thread-body">{msgs.map((m) => <EmailMessage key={m.id} m={m} who={who(m)} load={open} onMove={onMove} onRemoved={onRemoved} />)}</div>
      </details>
    </li>
  );
}

function EmailMessage({ m, who, load, onMove, onRemoved }: { m: Row; who: string; load: boolean; onMove: ((m: Row) => unknown) | null; onRemoved: () => void }) {
  const [full, setFull] = useState<Row | null>(null);
  useEffect(() => {
    if (!load || full) return;
    attempt(() => get(`emails/${m.id}`)).then((x) => { if (x) setFull(x); });
  }, [load]);
  return (
    <article className="email-msg" data-loaded={full ? "1" : undefined}>
      <header><b>{who}</b><span className="muted small">{m.to_addrs ? ` to ${m.to_addrs}` : ""}</span>
        <time className="muted small" dateTime={m.sent_at} title={m.sent_at.replace("T", " ")}>{fmtStamp(m.sent_at)}</time></header>
      <div className="email-text">{full ? (full.body ? formatEmail(full.body) : <span className="muted">(no text)</span>) : <span className="muted small">Loading…</span>}</div>
      <div className="app-email-tools">
        {m.gmail_url ? <a className="small-button button" href={m.gmail_url} target="_blank" rel="noreferrer">Open in Gmail ↗</a> : null}
        {onMove ? <button className="al-button al-button--sm al-button--quiet" type="button" onClick={() => onMove(m)}>Move to another application…</button> : null}
        <button className="al-button al-button--sm al-button--quiet al-button--danger" type="button" onClick={async () => {
          if (!(await confirmDelete(`email “${m.subject || "(no subject)"}”`))) return;
          if (await attempt(() => del(`emails/${m.id}`))) { toast("Removed"); onRemoved(); }
        }}>Delete</button>
      </div>
    </article>
  );
}

// ---- adding to the timeline, in a dialog of its own ----------------------------------------

type Saving = <T>(fn: () => Promise<T>) => Promise<T | undefined>;
type Done = (refreshOnly: boolean) => void;

/** Open the dialog that adds `kind` to the timeline: a note, an interview, or a reminder. */
function openAdding(kind: "note" | "step" | "reminder", s: Loaded, saving: Saving, done: Done) {
  const p = s.process!;
  const finish: Done = (fresh) => { closeModal(); done(fresh); };
  openModal(kind === "note" ? <NoteForm p={p} saving={saving} done={finish} />
    : kind === "step" ? <StepForm p={p} people={s.detail?.people || []} saving={saving} done={finish} />
      : <ReminderForm p={p} saving={saving} done={finish} />);
}

/** A dialog's foot: Cancel, and what it adds. */
const dialogActions = (label: string) => (
  <div className="al-dialog__actions">
    <button className="al-button" type="button" onClick={dismissModal}>Cancel</button>
    <button className="al-button al-button--primary" type="submit">{label}</button>
  </div>
);

function NoteForm({ p, saving, done }: { p: Row; saving: Saving; done: Done }) {
  const v = useRef({ body: "", on: isoToday() as string | null }).current;
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} onSubmit={async (e) => {
      e.preventDefault();
      if (!v.body) return;
      if (await saving(() => post("notes", { process_id: p.id, body: v.body, happened_on: v.on || isoToday() }))) { toast("Note added"); done(true); }
    }}>
      <h2 className="al-dialog__title" id="modal-title">Add a note</h2>
      <div className="al-dialog__body composer-form">
        <Field className="composer-wide"><Label htmlFor="nf-body">Note</Label>
          <div onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.current?.requestSubmit(); } }}>
            <RichText id="nf-body" value="" rows={5} label="Note" placeholder="What happened, what you heard, what you think" onChange={(html) => { v.body = richOrNull(html) || ""; }} />
          </div></Field>
        <Field><Label htmlFor="nf-on">When</Label><DatePicker id="nf-on" value={v.on} onChange={(d) => { v.on = d; }} /></Field>
      </div>
      {dialogActions("Add note")}
    </form>
  );
}

function StepForm({ p, people, saving, done }: { p: Row; people: Row[]; saving: Saving; done: Done }) {
  const lengths = listOf("step_length"), formats = listOf("step_format");
  // An hour, and the first format, unless the lists say otherwise.
  const v = useRef({ title: "", date: null as string | null, time: "", minutes: lengths.some(([m]) => m === "60") ? "60" : lengths[0]?.[0] || "", format: formats[0]?.[0] || "",
    status: "scheduled", with: "", place: "", prep: "", remind: "hour" }).current;
  const set = (k: keyof typeof v) => (e: React.FormEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => { (v as Row)[k] = e.currentTarget.value; };
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      if (!v.title.trim()) return;
      const person = people.find((pe) => pe.name.toLowerCase() === v.with.trim().toLowerCase());
      const made = await saving(async () => {
        const made = await post("steps", { process_id: p.id, title: v.title.trim(), at: v.date ? `${v.date}T${v.time || "00:00"}` : null,
          minutes: v.minutes ? Number(v.minutes) : null, format: v.format || null, status: v.status, attendees: person ? null : v.with.trim() || null,
          place: v.place.trim() || null, prep_note: v.prep || null, remind: v.status === "scheduled" ? v.remind || null : null });
        if (person) await put(`steps/${made.id}/people`, { person_ids: [person.id] });
        return made;
      });
      if (made) { toast(`Interview added${v.status === "scheduled" && v.remind && v.date ? ` · reminder set ${v.remind === "hour" ? "an hour" : "the day"} before` : ""}`); done(true); }
    }}>
      <h2 className="al-dialog__title" id="modal-title">Add an interview</h2>
      <div className="al-dialog__body composer-form">
        <Field className="composer-wide"><Label htmlFor="sf-title">Interview</Label><Input id="sf-title" placeholder="e.g. Final round with the CTO" onInput={set("title")} /></Field>
        <Field><Label htmlFor="sf-date">Date</Label><DatePicker id="sf-date" value={null} onChange={(d) => { v.date = d; }} /></Field>
        <Field><Label htmlFor="sf-time">Time</Label><Input id="sf-time" type="time" onInput={set("time")} /></Field>
        <Field><Label htmlFor="sf-dur">Length</Label>
          <Select id="sf-dur" defaultValue={v.minutes} onChange={set("minutes")}>
            {[...lengths, ["", "Not set"]].map(([m, l]) => <option key={m} value={m}>{l}</option>)}
          </Select></Field>
        <Field><Label htmlFor="sf-format">Format</Label>
          <Select id="sf-format" defaultValue={v.format} onChange={set("format")}>
            {[...formats, ["", "Not set"]].map(([f, l]) => <option key={f} value={f}>{l}</option>)}
          </Select></Field>
        <Field><Label htmlFor="sf-status">Status</Label>
          <Select id="sf-status" defaultValue={v.status} onChange={set("status")}>
            {R("steps").fields.find((f) => f.name === "status")!.options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select></Field>
        <Field><Label htmlFor="sf-remind">Remind me</Label>
          <Select id="sf-remind" defaultValue={v.remind} onChange={set("remind")}>
            {[["hour", "An hour before"], ["day", "The day before"], ["", "Don't remind me"]].map(([r, l]) => <option key={r} value={r}>{l}</option>)}
          </Select></Field>
        <Field className="composer-half"><Label htmlFor="sf-with">With <Optional /></Label>
          <Input id="sf-with" list="sf-people" placeholder="Pick from People or type a name" onInput={set("with")} />
          <datalist id="sf-people">{people.map((pe) => <option key={pe.id} value={pe.name} />)}</datalist></Field>
        <Field className="composer-half"><Label htmlFor="sf-where">Joining link or address <Optional /></Label>
          <Input id="sf-where" placeholder="meet.example/… or office address" onInput={set("place")} /></Field>
        <Field className="composer-wide"><Label htmlFor="sf-prep">What to prepare <Optional /></Label>
          <RichText id="sf-prep" value="" rows={2} label="What to prepare" placeholder="Topics they mentioned, things to bring" onChange={(html) => { v.prep = richOrNull(html) || ""; }} /></Field>
      </div>
      {dialogActions("Add interview")}
    </form>
  );
}

function ReminderForm({ p, saving, done }: { p: Row; saving: Saving; done: Done }) {
  const v = useRef({ title: "", date: null as string | null, time: "" }).current;
  const date = useRef<HTMLDivElement>(null);
  const quick = (label: string, days: number) => (
    <button className="al-button al-button--quiet al-button--sm" type="button" onClick={() => {
      const d = zonedNow(); d.setDate(d.getDate() + days);
      v.date = d.toLocaleDateString("en-CA");
      const input = date.current?.querySelector("input");
      if (!input) return;
      input.value = parseLocal(v.date).toLocaleDateString(LOC(), { day: "2-digit", month: "2-digit", year: "numeric" });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }}>{label}</button>
  );
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      if (!v.title.trim()) return;
      const due = v.date ? (v.time ? `${v.date}T${v.time}` : v.date) : null;
      if (await saving(() => post("reminders", { process_id: p.id, title: v.title.trim(), due_at: due }))) { toast("Reminder added"); done(false); }
    }}>
      <h2 className="al-dialog__title" id="modal-title">Add a reminder</h2>
      <div className="al-dialog__body composer-form">
        <Field className="composer-wide"><Label htmlFor="rf-title">Remind me to</Label>
          <Input id="rf-title" placeholder="e.g. Ask Dana for feedback" onInput={(e) => { v.title = e.currentTarget.value; }} /></Field>
        <Field><Label htmlFor="rf-date">On</Label><div ref={date} style={{ display: "contents" }}><DatePicker id="rf-date" value={null} onChange={(d) => { v.date = d; }} /></div></Field>
        <Field><Label htmlFor="rf-time">At <Optional /></Label><Input id="rf-time" type="time" onInput={(e) => { v.time = e.currentTarget.value; }} /></Field>
        <div className="composer-foot"><span className="al-hint">Quick:</span>{quick("Tomorrow", 1)}{quick("In 3 days", 3)}{quick("In a week", 7)}</div>
      </div>
      {dialogActions("Add reminder")}
    </form>
  );
}
