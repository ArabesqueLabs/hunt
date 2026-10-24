// The application page: one application on a page of its own
// (/applications/ID). The board's cards and the Applications list both open
// it. It reads first; Edit turns it into a form whose changes are saved
// together, or discarded. What acts as you go (people, files sent, emails)
// works in either mode.
//
// Edit works on a draft: the fields' inputs write into it as they're
// typed, and Save sends what differs from how it was.

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { attempt, del, get, patch, post, put } from "../lib/api";
import { cycleById, loadCycles, runningCycles } from "../lib/cycles";
import { LOC, fmtDay, fmtMoney, fmtStamp, HOME, homePay, isOverdue, isoToday, parseLocal, zonedNow } from "../lib/format";
import { R, closedWhy, optionLabel, reloadTags, takeHomeOn } from "../lib/meta";
import { go, route, setLeaveGuard } from "../lib/router";
import { baseTitle } from "../lib/shell";
import { S } from "../lib/state";
import { store } from "../lib/storage";
import { tagNames } from "../lib/tags";
import { t } from "../lib/i18n";
import { toast } from "../lib/toast";
import type { Row } from "../lib/types";
import { MenuButton, MenuItem } from "../components/Menu";
import { askArchive, closingLabel } from "../components/closing";
import { Combo } from "../components/Combo";
import { DatePicker } from "../components/DatePicker";
import { closeModal, confirmDelete, openModal, pushDialog } from "../components/dialogs";
import { refSource } from "../components/fields";
import { useFileDrop } from "../components/files";
import { looksLikeProfile, openImport, personFromProfile, POSTING_FIELDS, postingImport } from "../components/importer";
import { warnIfSamePosting } from "../components/NewApplication";
import { RichText, RichView } from "../components/RichText";
import { ColourTagChip, TagChip, TagEditor } from "../components/tags";
import { Field, Icon, Input, Label, LoadingPage, Logo, Notice, Optional, Photo, Select, Table, TextArea, dotted } from "../components/ui";
import { acceptOffer, atOffer, isAcceptedLane } from "./Celebrate";
import { PRIORITY_ORDER, isDone, openPrepAdding, prepState } from "./Prep";
import { PayPanel, TakeHomeLine } from "./TakeHome";

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

interface PostingLink { key: string | number; url: string; text: string | null }
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
  const base = (r: Read) => (r.found?.platform && r.found.platform !== "the page" ? r.found.platform : hostOf(r.url));
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

const APP_KEYS = ["company_id", "title", "url", "location", "work_mode", "employment", "source",
  "salary_min", "salary_max", "currency", "pay_period", "bonus", "equity", "comp", "note", "description"];
const COMPANY_KEYS = ["website", "industry", "size", "description"];
const PROCESS_KEYS = ["stage_id", "applied_on"];
const STEP_KEYS = ["title", "at", "status", "format", "attendees", "note"];
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
  app: Row; company: Row; companyName: string; companyLogo: string | null; tags: string[];
  process: Row | null; steps: Row[]; events: Row[];
}

/** What Edit starts from: the editable parts, copied. */
function draftOf(s: Loaded): Draft {
  return {
    app: pickKeys(s.app, APP_KEYS),
    company: pickKeys(s.company, COMPANY_KEYS),
    companyName: s.company.name,
    companyLogo: s.company.logo,
    tags: tagNames(s.app.tags),
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

function Application({ id, s, editing, readLink }: { id: number; s: Loaded; editing: boolean; readLink: string | null }) {
  const [, force] = useState(0);
  const render = () => force((n) => n + 1);
  const st = useRef({
    edit: editing,
    orig: draftOf(s),
    draft: null as unknown as Draft,
    // What's open: folded sections, and add forms shown in View mode.
    opened: new Set<string>(),
    // The form, drawn afresh each time Edit starts.
    formKey: 0,
    saving: false,
  }).current;
  if (!st.draft) st.draft = structuredClone(st.orig);
  const [saveState, setSaveState] = useState<{ state?: string; text: string }>({ text: "" });
  const page = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<string | null>(null);
  const { edit, draft, orig, opened } = st;
  const dirty = () => st.edit && JSON.stringify(st.draft) !== JSON.stringify(st.orig);
  useEffect(() => {
    setLeaveGuard(() => dirty());
    window.onbeforeunload = (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ""; } };
    return () => { window.onbeforeunload = null; };
  }, []);
  // After drawing, the cursor goes where it was sent.
  useEffect(() => {
    if (!focusAfter.current) return;
    page.current?.querySelector<HTMLElement>(focusAfter.current)?.focus();
    focusAfter.current = null;
  });
  // A posting link just added: read it, as Refresh does.
  useEffect(() => { if (readLink) readPostings(postingLinks().filter((l) => l.url === readLink)); }, []);
  const reload = (o: { readLink?: string | null } = {}) => reloadWith({ processId: s.process?.id ?? null, ...o });
  const focus = (sel: string) => { focusAfter.current = sel; };
  const setEdit = (on: boolean, at: string | null = null) => {
    if (!on && dirty() && !confirm("Discard your changes?")) return;
    st.edit = on;
    st.draft = structuredClone(st.orig);
    st.formKey++;
    render();
    if (on) focus(at || ".app-head input, .app-head .combo input");
  };
  const toggle = (key: string) => { if (opened.has(key)) opened.delete(key); else opened.add(key); render(); };

  // ---- small parts ----

  const input = (obj: Row, key: string, attrs: { type?: string; multiline?: boolean; rows?: number; placeholder?: string; "aria-label"?: string; step?: number } = {}) => {
    const label = attrs["aria-label"] || attrs.placeholder || key;
    // A date: the design system's date picker, in hunt's language and digits.
    if (attrs.type === "date") {
      return <DatePicker value={obj[key]} label={label} onChange={(v) => { obj[key] = v; }}
        onBad={() => toast(t("Enter a date, day first, like 30/11/2026"), "error")} />;
    }
    const onInput = (e: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>) => { const v = e.currentTarget.value; obj[key] = v.trim() === "" ? null : v; };
    if (attrs.multiline) return <TextArea rows={attrs.rows} placeholder={attrs.placeholder} aria-label={label} defaultValue={obj[key] ?? ""} onInput={onInput} />;
    return <Input type={attrs.type || "text"} step={attrs.step} placeholder={attrs.placeholder} aria-label={label} defaultValue={obj[key] ?? ""} onInput={onInput} />;
  };
  const select = (obj: Row, key: string, options: [string, string][], { empty = "Not set" as string | null, label = key } = {}) => (
    <Select aria-label={label} defaultValue={obj[key] ?? ""} onChange={(e) => { obj[key] = e.target.value || null; }}>
      {empty ? <option value="">{empty}</option> : null}
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </Select>
  );
  const optionsOf = (resource: string, name: string) => R(resource).fields.find((f) => f.name === name)!.options;
  // A field is named by its label, not its placeholder.
  const labeled = (label: string, control: ReactNode) => <label className="app-field"><span>{label}</span>{control}</label>;
  const inline = (label: string, value: ReactNode) => <div className="app-inline"><dt>{label}</dt><dd>{value ?? <span className="muted">—</span>}</dd></div>;
  // A section of the page: a panel, being read; a part of the form, being edited. None folds.
  const section = (key: string, title: string, { count, action }: { count?: number | null; action?: ReactNode } = {}, ...body: ReactNode[]) => (edit
    ? (
      <section key={key} className="app-section" data-section={key}>
        <header><h2>{title}{count != null ? <span className="count">{count}</span> : null}</h2>
          {action ? <div className="app-section-tools">{action}</div> : null}</header>
        <div className="app-section-body">{body}</div>
      </section>
    )
    : panel(key, title, { count: count ?? undefined, action }, ...body));
  const addButton = (label: string, onClick: () => void) => <button key={label} className="al-button al-button--quiet app-add" type="button" onClick={onClick}>+ {label}</button>;
  /** Add a row to something saved with the rest: in View mode, this starts editing. */
  const addRow = (fn: () => void, at: string) => () => {
    if (!st.edit) { st.edit = true; st.draft = structuredClone(st.orig); st.formKey++; }
    fn();
    render();
    focus(at);
  };
  /** An add form that acts at once: shown in Edit mode, behind its button in View mode. */
  const showForm = (key: string) => edit || opened.has(key);
  const formButton = (key: string, label: string) => (edit ? null
    : <button key={key} className="al-button al-button--quiet app-add" type="button" aria-expanded={String(opened.has(key)) as "true" | "false"} onClick={() => toggle(key)}>{opened.has(key) ? "Close" : `+ ${label}`}</button>);
  const removeButton = (label: string, onClick: () => void) => <button className="al-button al-button--icon al-button--sm al-button--danger" type="button" aria-label={label} title={label} onClick={onClick}>×</button>;
  const link = (url: string) => <a href={/^https?:/.test(url) ? url : `https://${url}`} target="_blank" rel="noreferrer">{url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}{" ↗"}</a>;

  // ---- the head: logo, company and role, tags, and the mode ----

  function head() {
    const a = s.app;
    const title = edit
      ? (
        <div className="app-names">
          <Combo label="Company" placeholder="Company" value={draft.companyName} source={refSource("companies")} allowCreate
            onPick={async (it) => {
              const c = it.create ? await attempt(() => post("companies", { name: it.value })) : await get(`companies/${it.value}`);
              if (!c) return;
              draft.app.company_id = c.id;
              draft.companyName = c.name;
              draft.companyLogo = c.logo;
              // The company section follows the company chosen.
              Object.assign(draft.company, pickKeys(c, COMPANY_KEYS));
              orig.company = pickKeys(c, COMPANY_KEYS);
              st.formKey++;
              render();
            }} />
          {input(draft.app, "title", { placeholder: "Role" })}
        </div>
      )
      : <h1 id="app-title">{s.company.name}{a.title ? <><span className="muted"> — </span>{a.title}</> : null}</h1>;
    return (
      <header className="app-head">
        <Logo id={edit ? draft.app.company_id : a.company_id} logo={edit ? draft.companyLogo : s.company.logo} name={edit ? draft.companyName : s.company.name} size={48} />
        <div className="app-title">{title}</div>
        <div className="app-mode">
          <div className="al-segmented" role="group" aria-label="Mode">
            <button type="button" aria-pressed={String(!edit) as "true" | "false"} onClick={() => edit && setEdit(false)}>View</button>
            <button type="button" aria-pressed={String(edit) as "true" | "false"} onClick={() => !edit && setEdit(true)}>Edit</button>
          </div>
          {edit ? <>
            <button className="al-button" type="button" onClick={() => setEdit(false)}>Discard</button>
            <button className="al-button al-button--primary" type="button" aria-busy={st.saving ? "true" : undefined} onClick={save}>✓ Save changes</button>
          </> : null}
        </div>
      </header>
    );
  }

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
    ...(s.app.url ? [{ key: "main", url: s.app.url, text: s.app.description }] : []),
    ...s.postings.map((p) => ({ key: p.id, url: p.url, text: p.description })),
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
            await patch(`postings/${r.key}`, { platform: r.found!.platform || null, read_at: localNow(), ...(r.key in texts ? { description: texts[r.key] } : {}) });
          }
          return Object.keys(mine).length + Object.keys(texts).length;
        });
        if (done != null) { if (done) toast("Refreshed"); reload(); }
      },
    });
  }

  /** Add a posting link, and read it straight away. */
  async function addPostingLink(url: string) {
    if (!s.app.url) {
      if (!(await attempt(() => patch(`applications/${id}`, { url })))) return;
    } else if (!(await attempt(() => post("postings", { application_id: id, url })))) {
      return;
    }
    warnIfSamePosting({ ...s.app, url });
    opened.delete("posting-add");
    reload({ readLink: url });
  }

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

  // ---- sections ----

  /** The role: where and how first, then pay, then the rest. */
  function role() {
    const a = s.app;
    const f = (n: string) => optionsOf("applications", n);
    if (edit) {
      return (
        <div className="app-section app-role">
          <div className="app-grid app-key-fields">
            {labeled("Location", input(draft.app, "location", { placeholder: "e.g. London", "aria-label": "Location" }))}
            {labeled("Work mode", select(draft.app, "work_mode", f("work_mode"), { label: "Work mode" }))}
            {labeled("Employment", select(draft.app, "employment", f("employment"), { label: "Employment" }))}
          </div>
          <div className="app-grid app-pay-fields">
            <label className="app-field wide"><span>Base salary</span><div className="app-salary">
              {input(draft.app, "currency", { placeholder: HOME(), "aria-label": "Currency" })}
              {input(draft.app, "salary_min", { placeholder: "From, e.g. 150k", "aria-label": "From" })}
              {input(draft.app, "salary_max", { placeholder: "To", "aria-label": "To" })}
              {select(draft.app, "pay_period", f("pay_period"), { empty: "Per…", label: "Per" })}
            </div></label>
            {labeled("Bonus", input(draft.app, "bonus", { placeholder: "e.g. 15% target", "aria-label": "Bonus" }))}
            {labeled("Equity", input(draft.app, "equity", { placeholder: "e.g. £200k RSUs over 4 years", "aria-label": "Equity" }))}
            <label className="app-field wide"><span>Pay notes</span>
              {input(draft.app, "comp", { multiline: true, rows: 2, placeholder: "Benefits, negotiation…", "aria-label": "Pay notes" })}</label>
          </div>
          <div className="app-grid app-more-fields">
            {labeled("Posting link", input(draft.app, "url", { type: "url", placeholder: "https://…", "aria-label": "Posting link" }))}
            {labeled("Source", input(draft.app, "source", { placeholder: "e.g. LinkedIn, referral", "aria-label": "Source" }))}
            {draft.process ? labeled("Applied on", input(draft.process, "applied_on", { type: "date", "aria-label": "Applied on" })) : null}
          </div>
        </div>
      );
    }
    const salary = fmtMoney(a.salary_min, a.salary_max, a.currency, a.pay_period);
    // Pay in the home currency leads; the posting's own figures follow, smaller.
    const foreign = salary && (a.currency || "").toUpperCase() !== HOME();
    const home = foreign ? homePay(a) : null;
    const inHome = home ? fmtMoney(home[0] == null ? null : Math.round(home[0]), home[1] == null ? null : Math.round(home[1]), HOME(), a.pay_period) : "";
    const rate = a.gbp_rate != null ? `${a.gbp_rate.toFixed(4)} GBP per ${a.currency}, the rate on ${a.gbp_rate_on}` : null;
    const payLine = !salary ? null : inHome
      ? <><p className="app-salary-line">{inHome}</p>
        <p className="muted small app-salary-orig" title={rate ? `At ${rate}${HOME() !== "GBP" ? `; GBP to ${HOME()} at the rate on ${S.PREFS.currency_rate_on}` : ""}` : ""}>{salary}</p></>
      : <><p className="app-salary-line">{salary}</p>{foreign ? <p className="muted small app-salary-orig">{`No ${HOME()} rate yet`}</p> : null}</>;
    return (
      <div className="app-section app-role">
        <dl className="app-inlines app-key">
          {inline("Location", a.location)}
          {inline("Work mode", a.work_mode ? optionLabel(f("work_mode"), a.work_mode) : null)}
          {inline("Employment", a.employment ? optionLabel(f("employment"), a.employment) : null)}
        </dl>
        {salary || a.bonus || a.equity ? (
          <div className="app-pay">
            {payLine}
            {/* What it would leave, where take-home pay is on. */}
            {salary && takeHomeOn() ? <TakeHomeLine a={a} /> : null}
            {a.bonus || a.equity ? <dl className="app-inlines">{a.bonus ? inline("Bonus", a.bonus) : null}{a.equity ? inline("Equity", a.equity) : null}</dl> : null}
          </div>
        ) : null}
        {a.comp ? <p className="muted small app-pay-notes">{a.comp}</p> : null}
        <dl className="app-inlines app-more">
          {inline("Posting", a.url ? link(a.url) : null)}
          {inline("Source", a.source)}
          {s.process ? inline("Applied", s.process.applied_on ? fmtDay(s.process.applied_on) : null) : null}
          {a.posted_on ? inline("Posted", fmtDay(a.posted_on)) : null}
          {a.closes_on ? inline("Closes", fmtDay(a.closes_on)) : null}
        </dl>
      </div>
    );
  }

  /** The timeline: interview steps and what happened, in date order. */
  function timeline() {
    if (!s.process) return section("timeline", "Timeline", {}, <p key="none" className="muted small">Put it on the board to track its steps.</p>);
    const statuses = optionsOf("steps", "status");
    const steps: Row[] = edit ? draft.steps : s.detail?.steps || [];
    const events: Row[] = edit ? draft.events : (s.detail?.notes || []).map((n: Row) => ({ ...n, happened_on: n.happened_on || n.created_at.slice(0, 10) }));
    // Undated rows (new steps) go last.
    const items = [
      ...steps.map((x, i) => ({ kind: "step", when: x.at || "~", x, i })),
      ...events.map((x, i) => ({ kind: "event", when: x.happened_on || "~", x, i })),
    ].sort((x, y) => x.when.localeCompare(y.when));
    const action = <>
      {addButton("Add an interview", addRow(() => {
        draft.steps.push({ id: null, title: null, at: null, status: "scheduled", format: null, attendees: null, note: null, people: [], fresh: true, key: Math.random() });
      }, ".app-timeline .fresh input"))}
      {addButton("Add a timeline note", addRow(() => {
        draft.events.push({ id: null, body: null, happened_on: isoToday(), fresh: true, key: Math.random() });
      }, ".app-timeline .fresh input[type=text]"))}
    </>;
    const stepRow = ({ x, i }: { x: Row; i: number }) => (
      <li key={`s${x.id ?? x.key}`} className={`is-${x.status}${x.fresh ? " fresh" : ""}`} data-step={i}>
        <span className="dot" aria-hidden="true" />
        {edit ? (
          <div className="app-step-edit">
            <div className="app-row">{input(x, "title", { placeholder: "A step, e.g. Recruiter screen", "aria-label": "Step" })}
              {removeButton("Remove step", () => { draft.steps.splice(i, 1); render(); })}</div>
            <div className="app-grid">
              {input(x, "at", { type: "datetime-local", step: 900, "aria-label": "When" })}
              {select(x, "status", statuses, { empty: null, label: "Status" })}
              {input(x, "format", { placeholder: "Format: video call, on-site…", "aria-label": "Format" })}
            </div>
            {stepPeople(x, i)}
            {input(x, "note", { multiline: true, rows: 2, placeholder: "Prep, questions asked, feedback…", "aria-label": "Notes" })}
          </div>
        ) : (
          <div>
            <div className="app-step-head"><h3>{x.title || "Untitled step"}</h3><span className="muted small">{x.at ? fmtStamp(x.at) : "No date"}</span></div>
            <p className="muted small">{[optionLabel(statuses, x.status), x.format].filter(Boolean).join(" · ")}
              {x.people?.length
                ? <>{" · with "}{x.people.map((pe: Row, j: number) => <Fragment key={pe.id}>{j ? ", " : ""}<a href={`/people/${pe.id}`}>{pe.name}</a></Fragment>)}</>
                : x.attendees ? ` · with ${x.attendees}` : null}</p>
            {x.note ? <p className="app-step-note">{x.note}</p> : null}
          </div>
        )}
      </li>
    );
    const eventRow = ({ x, i }: { x: Row; i: number }) => (
      <li key={`e${x.id ?? x.key}`} className={`is-event${x.fresh ? " fresh" : ""}`}>
        <span className="dot" aria-hidden="true" />
        {edit ? (
          <div className="app-event-edit">{input(x, "happened_on", { type: "date", "aria-label": "When" })}
            {input(x, "body", { placeholder: "What happened", "aria-label": "What happened" })}
            {removeButton("Remove event", () => { draft.events.splice(i, 1); render(); })}</div>
        ) : <div className="app-event"><span className="app-event-body" translate="no">{x.body}</span><time className="muted small" dateTime={x.happened_on}>{fmtDay(x.happened_on)}</time></div>}
      </li>
    );
    return section("timeline", "Timeline", { count: items.length, action },
      items.length ? <ol key="list" className="app-steps app-timeline">{items.map((it) => (it.kind === "step" ? stepRow(it) : eventRow(it)))}</ol>
        : <p key="none" className="muted small">No steps or events yet.</p>);
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

  function notes() {
    const action = addButton("Add a note", addRow(() => {}, 'textarea[aria-label="Your notes"]'));
    return section("notes", "Notes", { action }, edit
      ? <RichText key="edit" value={draft.app.note} rows={6} placeholder="Your private notes on this application" label="Your notes"
        onChange={(html) => { draft.app.note = html.trim() ? html : null; }} />
      : s.app.note ? <RichView key="read" className="app-notes" value={s.app.note} /> : <p key="none" className="muted small">No notes.</p>);
  }

  async function refreshDetail() {
    if (!s.process) return;
    s.detail = await get(`processes/${s.process.id}/detail`);
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
    return section("emails", "Emails", { count: list.length, action: formButton("emails", "Add an email") },
      showForm("emails") ? <EmailAdd key="add" processId={s.process.id} onAdded={() => { opened.delete("emails"); refreshDetail(); }} onCancel={() => { if (!st.edit) toggle("emails"); }} /> : null,
      ordered.length ? <ul key="list" className="app-emails">{ordered.map((msgs) => <EmailThread key={threadKey(msgs[0])} msgs={msgs} edit={edit} onRemoved={refreshDetail} />)}</ul>
        : <p key="none" className="muted small">No emails saved.</p>);
  }

  // Postings read like emails: where each is from, its text in its own
  // box (their links are in Links, beside). The application's own comes first.
  function posting() {
    const a = s.app;
    const links = postingLinks();
    const count = links.length || (a.description ? 1 : 0);
    const card = (l: PostingLink) => {
      const main = l.key === "main";
      const p = main ? null : s.postings.find((x) => x.id === l.key)!;
      const when = main
        ? [a.posted_on ? `Posted ${fmtDay(a.posted_on)}` : null, a.closes_on ? `closes ${fmtDay(a.closes_on)}` : null].filter(Boolean).join(", ")
        : p!.read_at ? `Read ${fmtStamp(p!.read_at)}` : "";
      const where = main ? a.title || "The posting" : p!.platform && p!.platform !== "the page" ? p!.platform : hostOf(l.url);
      return (
        <article key={String(l.key)} className="email-msg app-posting" data-posting={String(l.key)}>
          <header><b>{where}</b>
            {l.url && (main || where !== hostOf(l.url)) ? <span className="muted small">{` from ${hostOf(l.url)}`}</span> : null}
            {main && links.length > 1 ? <span className="al-badge al-badge--outline" title="The application's own link">main</span> : null}
            {when ? <span className="muted small posting-when">{when}</span> : null}</header>
          {l.text ? <div className="email-text posting-text">{formatPosting(l.text)}</div>
            : <p className="muted small">{l.url ? "No text yet: Refresh from the posting, in the menu at the top, reads it." : "No text."}</p>}
          {!main && !edit ? <div className="app-email-tools">
            <button className="al-button al-button--sm al-button--quiet al-button--danger" type="button" onClick={async () => {
              if (!(await confirmDelete(`posting ${hostOf(l.url)}`))) return;
              if (await attempt(() => del(`postings/${l.key}`))) { toast("Removed"); reload(); }
            }}>Remove</button>
          </div> : null}
        </article>
      );
    };
    const adding = !edit && opened.has("posting-add")
      ? <PostingAdd key="add" onAdd={addPostingLink} />
      : null;
    const action = edit ? null : <>
      {links.length > 1 ? <button className="al-button al-button--quiet app-add" type="button" onClick={() => readPostings()}>Refresh all</button> : null}
      {formButton("posting-add", "Add a posting link")}
    </>;
    const body = edit
      ? [<Fragment key="text">{input(draft.app, "description", { multiline: true, rows: 14, placeholder: "Paste the job description", "aria-label": "Posting text" })}</Fragment>,
        ...s.postings.map((p) => card({ key: p.id, url: p.url, text: p.description }))]
      : [adding, ...(count ? [a.url || a.description ? card({ key: "main", url: a.url, text: a.description }) : null,
        ...s.postings.map((p) => card({ key: p.id, url: p.url, text: p.description }))] : [<p key="none" className="muted small">No posting yet: add its link, and hunt reads it.</p>])];
    return section("posting", "About the job", { count: count > 1 ? count : null, action }, ...body);
  }

  function company() {
    const c = s.company;
    return section("company", "Company", {}, edit
      ? (
        <div key="edit" className="app-grid">
          {labeled("Website", input(draft.company, "website", { type: "url", placeholder: "https://acme.com", "aria-label": "Website" }))}
          {labeled("Industry", input(draft.company, "industry", { placeholder: "e.g. Software", "aria-label": "Industry" }))}
          {labeled("Size", input(draft.company, "size", { placeholder: "e.g. 1,000+ employees", "aria-label": "Size" }))}
          <div className="app-field wide"><span>About</span><RichText value={draft.company.description} rows={4} placeholder="Culture, team, research…" label="About"
            onChange={(html) => { draft.company.description = html.trim() ? html : null; }} /></div>
        </div>
      )
      : (
        <dl key="read" className="facts al-summary-list">
          {([["Website", c.website ? link(c.website) : <span className="muted">—</span>], ["Industry", c.industry || <span className="muted">—</span>],
            ["Size", c.size || <span className="muted">—</span>], ...(c.headquarters ? [["Based in", c.headquarters]] : []),
            ["About", c.description ? <RichView className="prose small" value={c.description} /> : <span className="muted">—</span>]] as [string, ReactNode][]).map(([k, v]) => (
            <div key={k} className="al-summary-list__row al-summary-list__row--no-actions"><dt className="al-summary-list__key">{k}</dt><dd className="al-summary-list__value">{v}</dd></div>
          ))}
        </dl>
      ),
    <p key="link" className="small"><a href={`/companies/${edit ? draft.app.company_id : c.id}`}>The company's page →</a></p>);
  }

  const panel = (key: string, title: string, { count, action }: { count?: number; action?: ReactNode } = {}, ...body: ReactNode[]) => (
    <section key={key} className="al-panel app-panel" data-section={key} aria-labelledby={`panel-${key}`}>
      <div className="app-panel-head"><h2 id={`panel-${key}`}>{title}</h2>{count != null ? <span className="al-badge al-badge--count">{count}</span> : null}
        {action ? <div className="app-panel-tools">{action}</div> : null}</div>
      {body}
    </section>
  );
  /** People and files: a section of the form, being edited; a panel beside, being read. */
  const holder = (key: string, title: string, o: { count?: number; action?: ReactNode }, ...body: ReactNode[]) => (edit ? section(key, title, o, ...body) : panel(key, title, o, ...body));

  // People on the process, and files sent with it: these act at once.
  function people() {
    const p = s.process!;
    const list: Row[] = s.detail!.people || [];
    const roles = S.META.person_roles.map((r: Row) => [r.value, r.label]) as [string, string][];
    const after = (fresh: Row[] | undefined) => { if (fresh) { s.detail!.people = fresh; render(); } };
    return holder("people", "People", { count: list.length, action: formButton("people", "Add a person") },
      list.length ? (
        <ul key="list" className="app-people">
          {list.map((pe) => (
            <li key={pe.id}>
              <span className="with-logo"><Photo id={pe.id} photo={pe.photo} name={pe.name} size={28} /><a href={`/people/${pe.id}`}>{pe.name}</a></span>
              {edit ? <>
                <Select aria-label={`${pe.name}'s role`} defaultValue={pe.role ?? ""} onChange={async (e) => after(await attempt(() => patch(`processes/${p.id}/people/${pe.id}`, { role: e.target.value || null })))}>
                  <option value="">Role…</option>{roles.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
                {removeButton(`Take ${pe.name} off`, async () => after(await attempt(() => del(`processes/${p.id}/people/${pe.id}`))))}
              </> : <>
                <span className="muted small">{[pe.role ? optionLabel(roles, pe.role) : null, pe.title].filter(Boolean).join(" · ")}</span>
                {/* Their email and phone, a click away. */}
                {pe.email || pe.phone ? (
                  <span className="app-contact">
                    {pe.email ? <a href={`mailto:${pe.email}`} title={`Email ${pe.name}`}><Icon name="mail" />{pe.email}</a> : null}
                    {pe.phone ? <a href={`tel:${pe.phone.replace(/[^\d+]/g, "")}`} title={`Call ${pe.name}`}><Icon name="phone" />{pe.phone}</a> : null}
                  </span>
                ) : null}
              </>}
            </li>
          ))}
        </ul>
      ) : <p key="none" className="muted small">Nobody yet.</p>,
      showForm("people") ? <PersonAdd key="add" roles={roles} onAdd={async (body) => { opened.delete("people"); after(await attempt(() => post(`processes/${p.id}/people`, body))); }} /> : null);
  }

  function files() {
    const p = s.process!;
    const list: Row[] = s.detail!.files || [];
    const after = (fresh: Row[] | undefined) => { if (fresh) { s.detail!.files = fresh; render(); } };
    return holder("files", "Files sent", { count: list.length, action: formButton("files", "Send a file") },
      list.length ? (
        <ul key="list" className="files">
          {list.map((f) => (
            <li key={f.id}><a href={`/files/${f.document_id}?version=${f.id}`}>{f.label}</a><span className="muted">{` ${f.filename}`}</span>
              {edit ? removeButton(`Take ${f.label} off`, async () => after(await attempt(() => del(`processes/${p.id}/files/${f.id}`)))) : null}</li>
          ))}
        </ul>
      ) : <p key="none" className="muted small">None recorded.</p>,
      showForm("files") ? <FileAdd key="add" onAdd={async (versionId) => { opened.delete("files"); after(await attempt(() => post(`processes/${p.id}/files`, { version_id: versionId }))); }} /> : null,
      showForm("files") ? <p key="hint" className="muted small">Upload new versions under <a href="/files">Files</a>.</p> : null);
  }

  /** The end of the page: tags, other processes, and what's done to the whole application. */
  function footer() {
    const p = s.process;
    const rest = s.procs.filter((x) => x.id !== p?.id);
    const tags = edit
      ? <>{draft.tags.map((x) => (
        <TagChip key={x} name={x}><button className="al-tag__remove" type="button" aria-label={`Remove tag ${x}`}
          onClick={() => { draft.tags = draft.tags.filter((y) => y !== x); render(); }}>×</button></TagChip>
      ))}<DraftTag onAdd={(x) => { if (x && !draft.tags.some((y) => y.toLowerCase() === x.toLowerCase())) draft.tags.push(x); render(); }} /></>
      : <>{tagNames(s.app.tags).map((x) => <ColourTagChip key={x} name={x} />)}
        {opened.has("tag") ? <Input className="tag-input" aria-label="New tag" placeholder="A tag, then Enter" autoFocus onKeyDown={async (e) => {
          const add = e.currentTarget;
          if (e.key === "Escape") { opened.delete("tag"); render(); return; }
          if (e.key !== "Enter" || !add.value.trim()) return;
          e.preventDefault();
          const saved = await attempt(() => put(`applications/${id}/tags`, { tags: [...tagNames(s.app.tags), add.value.trim()] }));
          if (saved) { s.app.tags = saved; orig.tags = saved; opened.delete("tag"); await reloadTags(); render(); }
        }} /> : <button className="al-button al-button--quiet app-add" type="button" onClick={() => toggle("tag")}>+ Add tag</button>}</>;
    return (
      <section key="footer" className="app-section app-footer">
        <div className="app-tags"><span className="eyebrow">Tags</span>{tags}</div>
        {rest.length ? <div className="app-others"><span className="eyebrow">Other processes</span>
          {rest.map((x, i) => <Fragment key={x.id}>{i ? ", " : ""}<a href={`/applications/${id}?process=${x.id}`}>{`#${x.id}`}</a>
            {` (${x.status === "archived" ? "closed" : "active"}, added ${fmtDay(x.created_at.slice(0, 10))})`}</Fragment>)}</div> : null}
        {edit ? null : (
          <div className="actions">
            <button className="al-button" type="button" onClick={() => readPostings()}>Import from link…</button>
            {/* At its offer: accept it, wrap up the rest, and celebrate. */}
            {atOffer(p, s.stages) && !s.lanes.some((l) => l.id === p!.lane_id && isAcceptedLane(l)) ? <button className="al-button al-button--primary" type="button" onClick={() => acceptOffer(p!, s.company.name, s.app.title)}>🎉 Accept the offer…</button> : null}
            {p && p.status === "active" ? <button className="al-button" type="button" onClick={async () => {
              const body = await askArchive(`${s.company.name}${s.app.title ? ` — ${s.app.title}` : ""}`);
              if (body && await attempt(() => patch(`processes/${p.id}`, body))) { toast("Closed"); reload(); }
            }}>Close…</button> : null}
            <span className="spacer" />
            <button className="al-button al-button--quiet al-button--danger" type="button" onClick={async () => {
              if (!(await confirmDelete(`application ${s.app.label}`, "Its processes on the board go with it."))) return;
              if (await attempt(() => del(`applications/${id}`))) { setLeaveGuard(null); toast("Deleted"); go("/applications"); }
            }}>Delete application</button>
          </div>
        )}
      </section>
    );
  }

  // ---- saving ----

  const changed = (a: Row, b: Row, keys: string[]) => Object.fromEntries(keys.filter((k) => (a[k] ?? null) !== (b[k] ?? null)).map((k) => [k, a[k] ?? null]));

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
      if (JSON.stringify(d.tags) !== JSON.stringify(o.tags)) {
        o.tags = await put(`applications/${id}/tags`, { tags: d.tags });
      }
      if (s.process) {
        const pid = s.process.id;
        if (d.process!.stage_id !== o.process!.stage_id) {
          await post(`processes/${pid}/move`, { stage_id: d.process!.stage_id });
          o.process!.stage_id = d.process!.stage_id;
        }
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
      const l = d.app.url && d.app.url !== s.app.url ? d.app.url : null;
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

  /** The role and company; editing, and the rarer things, in a menu. */
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
            {where ? <><span aria-hidden="true">·</span><span>{where}</span></> : null}</div>
        </div>
        <div className="al-page-head__end">
          <span className="al-save-state" role="status" data-state={saveState.state}>{saveState.text}</span>
          {ended() ? null : moves()}
          <MenuButton className="al-button app-head-more" label="More" items={(close) => <>
            {ended() ? null : <>
              <MenuItem close={close} onClick={() => readPostings()}>{postingLinks().length ? "Refresh from the posting" : "Import from a link…"}</MenuItem>
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

  /**
   * The moves, beside Edit details: Change stage (the board's stages, by
   * swimlane, with their sub stages), Edit details, and Close. At its
   * offer, Accept leads; closed, Reopen takes Change stage's place.
   */
  function moves() {
    const p = s.process;
    const edit = <button key="edit" className="al-button" type="button" onClick={() => setEdit(true)}><Icon name="edit" /><span>Edit details</span></button>;
    if (!p) return edit;
    if (p.status === "archived") {
      const at = s.stages.findIndex((x) => x.id === p.reached_stage_id);
      return <>
        <button className="al-button al-button--primary" type="button" onClick={() => moveTo(s.stages[Math.max(at, 0)])}>Reopen</button>
        {edit}
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
      <MenuButton items={stageMenu}><span>Change stage</span><Icon name="chevron" /></MenuButton>
      {edit}
      <button className="al-button" type="button" onClick={archiveIt}><Icon name="archive" /><span>Close</span></button>
    </>;
  }

  /**
   * Where it stands: its stage, swimlane and sub stage in words, and the
   * board's stages as a progress bar to read, not to click (moves are made
   * from the header). Closed, it says why.
   */
  function statusCard() {
    const p = s.process;
    if (!p) return standing();
    const archived = p.status === "archived";
    const locked = ended();
    // Closed, it's in an inactive stage: the bar shows the one it reached.
    const at = s.stages.findIndex((x) => x.id === (archived ? p.reached_stage_id : p.stage_id));
    const lane = archived ? null : s.lanes.find((l) => l.id === p.lane_id);
    const swimlane = at >= 0 ? s.swimlanes.find((w) => w.id === s.stages[at].swimlane_id) : null;
    return (
      <section className="al-panel app-status" aria-labelledby="app-stage">
        {archived ? (
          <Notice kind="info">
            <div className="al-notice__title">Closed: {closedWhy(p, stageName(p.stage_id))}</div>
            {p.archive_note ? <div className="small" translate="no">{p.archive_note}</div> : null}
          </Notice>
        ) : null}
        {locked ? <Notice kind="info"><div className="al-notice__title">{`${cycleById(p.cycle_id)!.name} has ended`}</div><div className="small">This application is kept as it was then.</div></Notice> : null}
        <div className="app-status-head">
          <div className="app-status-now">
            <span className="eyebrow">{archived ? "Got to" : "Stage"}{swimlane ? <span translate="no">{` · ${swimlane.name}`}</span> : null}</span>
            <span id="app-stage" className="app-status-stage">{at >= 0 ? s.stages[at].name : stageName(p.stage_id)}
              {lane ? <span className="app-status-lane">{lane.name}</span> : null}</span>
          </div>
        </div>
        <ol className={`app-progress${archived ? " archived" : ""}`} aria-label="Stages" style={{ "--stages": s.stages.length } as React.CSSProperties}>
          {s.stages.map((x, i) => (
            <li key={x.id} className={i < at ? "past" : i === at ? "current" : undefined} aria-current={i === at ? "step" : undefined}>
              <span className="app-progress-name">{x.name}</span>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  const steps = (): Row[] => s.detail?.steps || [];
  const isUrl = (v: string | null | undefined) => /^(https?:\/\/|[\w-]+\.[\w.-]+\/)/i.test(v || "");
  const hrefOf = (v: string) => (/^https?:/i.test(v) ? v : `https://${v}`);
  const minutesText = (n: number | null | undefined) => (n ? (n >= 240 ? "Half a day" : n % 60 === 0 && n >= 60 ? `${n / 60} hr` : `${n} min`) : null);
  const withWhom = (x: Row) => (x.people?.length || x.attendees
    ? <span><span>with</span>{" "}<span translate="no">{x.people?.length ? x.people.map((pe: Row) => pe.name).join(", ") : x.attendees}</span></span> : null);

  /**
   * The timeline: one list of what's to come and what happened. Coming up,
   * soonest first: interviews still to happen (each gets its outcome here,
   * and then joins the rest) and reminders not yet done. Then what
   * happened, newest first: your notes, and the interviews that took place.
   * Each is added from its button, in a dialog.
   */
  function timelinePanel() {
    if (!s.process) return null;
    const statuses = optionsOf("steps", "status");
    const sched = steps().filter((x) => x.status === "scheduled").sort((a, b) => (a.at || "9").localeCompare(b.at || "9"));
    const rems = s.reminders.filter((r) => !r.done_at).sort((a, b) => (a.due_at || "9").localeCompare(b.due_at || "9"));
    const past: Row[] = [
      ...steps().filter((x) => x.status !== "scheduled").map((x) => ({ kind: "step", at: x.at || x.created_at, x })),
      ...(s.detail?.notes || []).map((n: Row) => ({ kind: "note", at: n.happened_on ? `${n.happened_on}T${n.created_at.slice(11)}` : n.created_at, n })),
    ].sort((a, b) => (b.at || "").localeCompare(a.at || ""));

    const scheduled = (x: Row) => {
      const gone = isOverdue(x.at);
      return (
        <li key={`s${x.id}`} className="tl-item tl-step tl-coming">
          <span className="tl-dot" aria-hidden="true" />
          <div className="tl-what"><span className="tl-title" translate="no">{x.title}</span>
            <span className="tl-sub">{dotted([x.format, minutesText(x.minutes), withWhom(x)])}</span>
            {x.place ? (isUrl(x.place) ? <a className="al-link tl-where" href={hrefOf(x.place)} target="_blank" rel="noreferrer">{x.place}</a> : <span className="tl-sub">{x.place}</span>) : null}
            {x.prep_note ? <span className="tl-prep">Prepare: <span translate="no">{x.prep_note}</span></span> : null}
            {ended() ? null : (
              <div className="tl-tools">
                {isUrl(x.place) && !gone ? <a className="al-button al-button--sm" href={hrefOf(x.place)} target="_blank" rel="noreferrer" title={x.place}>Join</a> : null}
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
              </div>
            )}</div>
          <span className={`tl-when${gone ? " is-late" : ""}`}>{x.at ? fmtStamp(x.at) : "Date not set"}</span>
        </li>
      );
    };
    const reminder = (r: Row) => {
      const late = isOverdue(r.due_at);
      return (
        <li key={`r${r.id}`} className="tl-item tl-reminder tl-coming">
          <span className={`tl-icon${late ? " is-late" : ""}`} aria-hidden="true"><Icon name="bell" /></span>
          <div className="tl-what"><span className="tl-title" translate="no">{r.title}</span>
            {ended() ? null : (
              <div className="tl-tools">
                <button className="al-button al-button--sm" type="button" onClick={async () => {
                  if (await saving(() => patch(`reminders/${r.id}`, { done_at: localNow() }))) {
                    toast(`Marked done: ${r.title}`, "info", { label: "Undo", onclick: async () => { if (await attempt(() => patch(`reminders/${r.id}`, { done_at: null }))) reload(); } });
                    reload();
                  }
                }}><Icon name="check" /><span>Done</span></button>
                <button className="al-button al-button--quiet al-button--sm" type="button" onClick={async () => {
                  const before = r.due_at;
                  if (await saving(() => patch(`reminders/${r.id}`, { due_at: dayAfter(r.due_at) }))) {
                    toast("Snoozed until tomorrow", "info", { label: "Undo", onclick: async () => { if (await attempt(() => patch(`reminders/${r.id}`, { due_at: before }))) reload(); } });
                    reload();
                  }
                }}>Snooze a day</button>
              </div>
            )}</div>
          <span className={`tl-when${late ? " is-late" : ""}`}>{r.due_at ? (late ? `Was due ${fmtDay(r.due_at)}` : fmtDay(r.due_at)) : "No date"}</span>
        </li>
      );
    };
    const happened = (it: Row) => {
      if (it.kind === "step") {
        const x = it.x;
        return (
          <li key={`s${x.id}`} className={`tl-item tl-step is-${x.status}`}>
            <span className="tl-dot" aria-hidden="true" />
            <div className="tl-what"><span className="tl-title" translate="no">{x.title}</span>
              <span className="tl-sub">{dotted([<span className="tl-status">{optionLabel(statuses, x.status)}</span>, x.format, minutesText(x.minutes), withWhom(x)])}</span>
              {x.note ? <span className="tl-note" translate="no">{x.note}</span> : null}</div>
            <span className="tl-when">{x.at ? fmtStamp(x.at) : "No date"}</span>
          </li>
        );
      }
      return (
        <li key={`n${it.n.id}`} className="tl-item tl-note-item"><span className="tl-dot" aria-hidden="true" />
          <div className="tl-what"><span className="tl-title tl-serif" translate="no">{it.n.body}</span></div>
          <span className="tl-when">{fmtDay(it.n.happened_on || it.n.created_at.slice(0, 10))}</span></li>
      );
    };
    const coming = [...sched.map(scheduled), ...rems.map(reminder)];
    const add = (kind: "note" | "step" | "reminder", label: string) => (
      <button className="al-button al-button--quiet al-button--sm" type="button"
        onClick={() => openAdding(kind, s, saving, (fresh) => { if (fresh) refreshDetail(); else reload(); })}><Icon name="plus" /><span>{label}</span></button>
    );
    const group = (key: string, label: string) => <li key={key} className="tl-group" role="presentation">{label}</li>;
    return panel("timeline", "Timeline", { action: ended() ? null : <>{add("note", "Note")}{add("step", "Interview")}{add("reminder", "Reminder")}</> },
      coming.length || past.length ? (
        <ol key="list" className="tl">
          {coming.length ? [group("coming", "Coming up"), ...coming] : null}
          {coming.length && past.length ? group("past", "So far") : null}
          {past.map(happened)}
        </ol>
      ) : <p key="none" className="muted small">Nothing yet. Add a note, an interview, or a reminder to follow up.</p>);
  }

  /** The facts of the role, at a glance. */
  function detailsPanel() {
    const a = s.app, p = s.process;
    const o = (n: string, v: string | null) => (v ? optionLabel(optionsOf("applications", n), v) : null);
    const facts = ([
      ["Work mode", o("work_mode", a.work_mode)], ["Employment", o("employment", a.employment)], ["Location", a.location],
      ["Source", a.source], ["Applied", p ? (p.applied_on ? fmtDay(p.applied_on) : "Not yet") : null],
      ["Posted", a.posted_on ? fmtDay(a.posted_on) : null], ["Closes", a.closes_on ? fmtDay(a.closes_on) : null],
      ["Posting", a.url ? <a href={a.url} target="_blank" rel="noreferrer">{hostOf(a.url)}</a> : null],
      ["Bonus", a.bonus], ["Equity", a.equity],
    ] as [string, ReactNode][]).filter(([, v]) => v);
    return panel("details", "Details", {}, facts.length
      ? <dl key="facts" className="app-facts">{facts.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
      : <p key="none" className="muted small">Nothing filled in yet.</p>);
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
        <button key="add" className="al-button al-button--quiet al-button--sm app-panel-add" type="button" onClick={() => { toPrep(); openPrepAdding(String(p.id)); }}>
          <Icon name="plus" /><span>{`Add prep for ${s.company.name}`}</span></button>
      ));
  }

  /** Links kept with it: the candidate portal, prep material, invites; and its postings', first. */
  function linksPanel() {
    const kinds = optionsOf("links", "kind");
    const adding = opened.has("link");
    const postings = postingLinks().filter((l) => l.url);
    return panel("links", "Links", {
      action: <button className="al-button al-button--quiet al-button--sm" type="button" aria-expanded={String(adding) as "true" | "false"} onClick={() => toggle("link")}>{adding ? "Cancel" : "Add a link"}</button>,
    },
    s.links.length || postings.length ? (
      <ul key="list" className="app-links">
        {/* Its postings, from About the job (removed there). */}
        {postings.map((l) => {
          const p = l.key === "main" ? null : s.postings.find((x) => x.id === l.key);
          const name = p?.platform && p.platform !== "the page" ? p.platform : l.key === "main" && s.app.title ? s.app.title : hostOf(l.url);
          return (
            <li key={`posting-${l.key}`}>
              <div className="app-link"><a href={l.url} target="_blank" rel="noreferrer" title={l.url} translate="no">{name}</a>
                <span className="muted small">{dotted(["Job posting", <span translate="no">{hostOf(l.url)}</span>])}</span></div>
            </li>
          );
        })}
        {s.links.map((l) => (
          <li key={l.id}>
            <div className="app-link"><a href={l.url} target="_blank" rel="noreferrer" title={l.url} translate="no">{l.label || hostOf(l.url)}</a>
              <span className="muted small">{dotted([optionLabel(kinds, l.kind), <span translate="no">{hostOf(l.url)}</span>])}</span></div>
            <button className="al-button al-button--quiet al-button--sm" type="button" aria-label={`Remove ${l.label || l.url}`} onClick={async () => {
              if (!(await saving(() => del(`links/${l.id}`)))) return;
              toast("Link removed", "info", { label: "Undo", onclick: async () => {
                if (await attempt(() => post("links", { application_id: id, url: l.url, label: l.label, kind: l.kind }))) reload();
              } });
              reload();
            }}>Remove</button>
          </li>
        ))}
      </ul>
    ) : adding ? null : <p key="none" className="muted small">Keep the candidate portal, prep material and anything else you'll open again.</p>,
    adding ? <LinkAdd key="add" kinds={kinds} onAdd={async (v) => {
      if (await saving(() => post("links", { application_id: id, ...v }))) { opened.delete("link"); toast("Link added"); reload(); }
    }} /> : null);
  }

  // Where it stands first; then the timeline, the posting, the mail, the
  // company and the pay. The facts, its prep and what's kept with it beside.
  function readLayout() {
    const p = s.process;
    const rest = s.procs.filter((x) => x.id !== p?.id);
    return <>
      <a className="al-back-link" href="/">Applications</a>
      {pageHead()}
      {statusCard()}
      <div className="app-layout">
        <div className="app-main">
          {timelinePanel()}
          {posting()}
          {p ? emails() : null}
          {company()}
          {takeHomeOn() || s.app.salary_min != null || s.app.salary_max != null ? <PayPanel a={s.app} p={p} stages={s.stages} onAdd={() => setEdit(true, ".app-pay-fields input")} /> : null}
        </div>
        <aside className="app-aside" aria-label="About this application">
          {detailsPanel()}
          {prepPanel()}
          {p ? people() : null}
          {linksPanel()}
          {p ? files() : null}
          {panel("tags", "Tags", {}, <TagEditor key="tags" resource="applications" rec={s.app} onChange={(saved) => { s.app.tags = saved; orig.tags = saved; }} />)}
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
    </>;
  }

  // ---- the page ----

  return (
    <div className={`page application${edit ? "" : " reading"}`} ref={page}
      onKeyDown={(e) => { if (st.edit && (e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); } }}>
      {!edit ? readLayout() : <>
        <nav className="crumbs" aria-label="Back to"><a href="/">← Applications</a></nav>
        <article className="al-card app editing" key={st.formKey}>
          {head()}
          {standing()}
          <div className="app-sections">
            {role()}{timeline()}{notes()}{posting()}
            {s.process ? <>{people()}{emails()}{files()}</> : null}
            {company()}
            {footer()}
          </div>
        </article>
      </>}
    </div>
  );
}

// ---- adding, in place ------------------------------------------------------------------

/** A tag for the draft: Enter or a comma adds it, and so does leaving it. */
function DraftTag({ onAdd }: { onAdd: (t: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const add = () => {
    const el = ref.current!;
    const v = el.value.trim();
    el.value = "";
    onAdd(v);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(".tag-input")?.focus());
  };
  return <Input className="tag-input" ref={ref} aria-label="Add a tag" placeholder="Add a tag…"
    onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }}
    onBlur={() => { if (ref.current?.value.trim()) add(); }} />;
}

/** A posting link, added and read straight away. */
function PostingAdd({ onAdd }: { onAdd: (url: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <form className="inline-add posting-add" onSubmit={(e) => { e.preventDefault(); const v = ref.current?.value.trim(); if (v) onAdd(v); }}>
      <Input type="url" ref={ref} placeholder="https://…" aria-label="Posting link" required />
      <button className="al-button al-button--primary" type="submit">Add and read</button>
    </form>
  );
}

/** Someone on the process: from People, a new name, or a LinkedIn profile link. */
function PersonAdd({ roles, onAdd }: { roles: [string, string][]; onAdd: (body: Row) => void }) {
  const chosen = useRef<Row | null>(null);
  const who = useRef<HTMLInputElement>(null);
  const [role, setRole] = useState("");
  return (
    <form className="person-add" onSubmit={async (e) => {
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
      onAdd(body);
    }}>
      <Combo label="Person" placeholder="Name, or a LinkedIn profile link" source={refSource("people")} allowCreate inputRef={who}
        onPick={(it) => { chosen.current = it; }} onInput={() => { chosen.current = null; }} />
      <Select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="">Role…</option>{roles.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select>
      <button className="al-button" type="submit">Add</button>
    </form>
  );
}

/** A file version sent with the process. */
function FileAdd({ onAdd }: { onAdd: (versionId: number) => void }) {
  const chosen = useRef<Row | null>(null);
  return (
    <form className="file-add" onSubmit={(e) => {
      e.preventDefault();
      if (!chosen.current) { toast("Pick a version from the list", "error"); return; }
      onAdd(chosen.current.value);
    }}>
      <Combo label="File" placeholder="Search files, e.g. resume" source={refSource("versions")}
        onPick={(it) => { chosen.current = it; }} onInput={() => { chosen.current = null; }} />
      <button className="al-button" type="submit">Add</button>
    </form>
  );
}

/** A link kept with the application. */
function LinkAdd({ kinds, onAdd }: { kinds: [string, string][]; onAdd: (v: { url: string; label: string | null; kind: string }) => void }) {
  const [v, setV] = useState({ url: "", label: "", kind: "portal" });
  const url = useRef<HTMLInputElement>(null);
  useEffect(() => { url.current?.focus(); }, []);
  return (
    <form className="app-link-form" onSubmit={(e) => {
      e.preventDefault();
      if (!v.url.trim()) return;
      onAdd({ url: v.url.trim(), label: v.label.trim() || null, kind: v.kind });
    }}>
      <Field><Label htmlFor="lf-url">Link</Label><Input id="lf-url" ref={url} type="url" placeholder="https://" value={v.url} onChange={(e) => setV({ ...v, url: e.target.value })} /></Field>
      <Field><Label htmlFor="lf-label">Name <Optional /></Label><Input id="lf-label" placeholder="e.g. Candidate portal" value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} /></Field>
      <Field><Label htmlFor="lf-kind">Kind</Label>
        <Select id="lf-kind" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>{kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
      <button className="al-button al-button--primary al-button--sm" type="submit">Add link</button>
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
    <form className={`email-add${drop.over ? " file-over" : ""}`} {...drop.props} onSubmit={async (e) => {
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
        <button className="al-button" type="button" onClick={() => { if (box.current) box.current.value = ""; onCancel(); }}>Cancel</button>
        <button className="al-button al-button--primary" type="submit">Add email</button>
      </div>
    </form>
  );
}

/** A thread of emails, folded until opened (its messages loaded then). */
function EmailThread({ msgs, edit, onRemoved }: { msgs: Row[]; edit: boolean; onRemoved: () => void }) {
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
        <div className="email-thread-body">{msgs.map((m) => <EmailMessage key={m.id} m={m} who={who(m)} load={open} edit={edit} onRemoved={onRemoved} />)}</div>
      </details>
    </li>
  );
}

function EmailMessage({ m, who, load, edit, onRemoved }: { m: Row; who: string; load: boolean; edit: boolean; onRemoved: () => void }) {
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
        {edit ? <button className="al-button al-button--sm al-button--quiet al-button--danger" type="button" onClick={async () => {
          if (!(await confirmDelete(`email “${m.subject || "(no subject)"}”`))) return;
          if (await attempt(() => del(`emails/${m.id}`))) { toast("Removed"); onRemoved(); }
        }}>Remove</button> : null}
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
    <button className="al-button" type="button" onClick={closeModal}>Cancel</button>
    <button className="al-button al-button--primary" type="submit">{label}</button>
  </div>
);

function NoteForm({ p, saving, done }: { p: Row; saving: Saving; done: Done }) {
  const v = useRef({ body: "", on: isoToday() as string | null }).current;
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} onSubmit={async (e) => {
      e.preventDefault();
      if (!v.body.trim()) return;
      if (await saving(() => post("notes", { process_id: p.id, body: v.body.trim(), happened_on: v.on || isoToday() }))) { toast("Note added"); done(true); }
    }}>
      <h2 className="al-dialog__title" id="modal-title">Add a note</h2>
      <div className="al-dialog__body composer-form">
        <Field className="composer-wide"><Label htmlFor="nf-body">Note</Label>
          <TextArea id="nf-body" rows={5} placeholder="What happened, what you heard, what you think" onInput={(e) => { v.body = e.currentTarget.value; }}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.current?.requestSubmit(); } }} /></Field>
        <Field><Label htmlFor="nf-on">When</Label><DatePicker id="nf-on" value={v.on} onChange={(d) => { v.on = d; }} /></Field>
      </div>
      {dialogActions("Add note")}
    </form>
  );
}

function StepForm({ p, people, saving, done }: { p: Row; people: Row[]; saving: Saving; done: Done }) {
  const v = useRef({ title: "", date: null as string | null, time: "", minutes: "60", format: "Video call", status: "scheduled", with: "", place: "", prep: "", remind: "hour" }).current;
  const set = (k: keyof typeof v) => (e: React.FormEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => { (v as Row)[k] = e.currentTarget.value; };
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      if (!v.title.trim()) return;
      const person = people.find((pe) => pe.name.toLowerCase() === v.with.trim().toLowerCase());
      const made = await saving(async () => {
        const made = await post("steps", { process_id: p.id, title: v.title.trim(), at: v.date ? `${v.date}T${v.time || "00:00"}` : null,
          minutes: v.minutes ? Number(v.minutes) : null, format: v.format || null, status: v.status, attendees: person ? null : v.with.trim() || null,
          place: v.place.trim() || null, prep_note: v.prep.trim() || null, remind: v.status === "scheduled" ? v.remind || null : null });
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
            {[["30", "30 min"], ["45", "45 min"], ["60", "60 min"], ["90", "90 min"], ["240", "Half a day"], ["", "Not set"]].map(([m, l]) => <option key={m} value={m}>{l}</option>)}
          </Select></Field>
        <Field><Label htmlFor="sf-format">Format</Label>
          <Select id="sf-format" defaultValue={v.format} onChange={set("format")}>
            {["Video call", "Phone", "On-site", "Take-home"].map((f) => <option key={f} value={f}>{f}</option>)}
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
          <TextArea id="sf-prep" rows={2} placeholder="Topics they mentioned, things to bring" onInput={set("prep")} /></Field>
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
