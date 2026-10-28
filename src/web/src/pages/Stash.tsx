// The stash (/stash): links, text and files kept to sort later. Keeping
// something asks nothing; sorting it is one click on what it looks like it
// should become, or a choice from the rest.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { attempt, del, enc, get, post } from "../lib/api";
import { daysFromToday, fmtStamp } from "../lib/format";
import { go } from "../lib/router";
import { S, changed, useShared } from "../lib/state";
import { toast } from "../lib/toast";
import type { Row } from "../lib/types";
import { Combo } from "../components/Combo";
import { closeModal, confirmDelete, dismissModal, openModal } from "../components/dialogs";
import { CreateForm, refSource } from "../components/fields";
import { useFileDrop } from "../components/files";
import { MenuButton, MenuItem } from "../components/Menu";
import { newApplication } from "../components/NewApplication";
import { DatePicker } from "../components/DatePicker";
import { EmptyState, Field, Label, LoadingBlock, Select, TextArea } from "../components/ui";

/** How many items wait to be sorted: the sidebar's count. */
export async function loadStashCount() {
  try { S.STASH = (await get("stash/count")).new; changed(); } catch { /* signed out, or offline */ }
}

/** Keep a link or some text. */
async function keep(text: string, source = "app") {
  const item = await post("stash", { text, source });
  loadStashCount();
  return item;
}

/** Keep files, one item each. */
async function keepFiles(files: File[], source = "app") {
  const kept: Row[] = [];
  for (const f of files) {
    const res = await fetch(`/api/stash/file?filename=${enc(f.name)}&source=${source}`, {
      method: "POST", headers: { "Content-Type": f.type || "application/octet-stream" }, body: f,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast(data.error || `hunt couldn't keep ${f.name}`, "error"); continue; }
    kept.push(data);
  }
  loadStashCount();
  return kept;
}

/** Add to the stash from anywhere (I, or the sidebar): a box to paste into. */
export function quickCapture() {
  openModal(<QuickCapture />);
}

function QuickCapture() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      if (!text.trim() || busy) return;
      setBusy(true);
      const item = await attempt(() => keep(text));
      setBusy(false);
      if (!item) return;
      closeModal();
      toast("Kept in your stash", "info", location.pathname === "/stash" ? null : { label: "Open", onclick: () => go("/stash") });
      if (location.pathname === "/stash") go("/stash", { replace: true });
    }}>
      <h2 className="al-dialog__title" id="modal-title">Add to your stash</h2>
      <div className="al-dialog__body">
        <Field>
          <Label htmlFor="qc-text">A link, or anything to sort later</Label>
          <TextArea id="qc-text" rows={4} autoFocus value={text} placeholder="Paste a job posting, a profile, a note from a call…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit(); }} />
          <span className="al-hint">It waits in the stash; nothing needs deciding now.</span>
        </Field>
      </div>
      <div className="al-dialog__actions">
        <button className="al-button" type="button" onClick={dismissModal}>Cancel</button>
        <button className="al-button al-button--primary" type="submit" disabled={!text.trim()} aria-busy={busy ? "true" : undefined}>Keep it</button>
      </div>
    </form>
  );
}

const TABS: [string, string][] = [["new", "To sort"], ["done", "Sorted"], ["dismissed", "Dismissed"]];

/** Where a record made from an item is. */
const HREF: Record<string, (id: number) => string> = {
  application: (id) => `/applications/${id}`,
  process: (id) => `/p/${id}`,
  company: (id) => `/companies/${id}`,
  person: (id) => `/people/${id}`,
  memo: () => "/notes",
  prep: () => "/tasks",
  document: (id) => `/documents/${id}`,
};

/** What sorting an item into each made it. */
const MADE: Record<string, string> = {
  application: "Added as an application", company: "Added as a company", person: "Added as a person",
  memo: "Kept as a note", note: "Added as a note", prep: "Added as a task", reminder: "Added as a reminder",
  link: "Added as a link", document: "Added to your files",
};

const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

/** Pick a record (a process or an application) for an item, and perhaps more about it. */
function pick({ title, resource, label, extra }: {
  title: string; resource: "processes" | "applications"; label: string;
  extra?: (vals: Row, set: (v: Row) => void) => ReactNode;
}): Promise<Row | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: Row | null) => { if (!settled) { settled = true; resolve(v); } };
    openModal(<Pick title={title} resource={resource} label={label} extra={extra} done={done} />, { onClose: () => done(null) });
  });
}

function Pick({ title, resource, label, extra, done }: {
  title: string; resource: string; label: string; extra?: (vals: Row, set: (v: Row) => void) => ReactNode; done: (v: Row | null) => void;
}) {
  const [vals, setVals] = useState<Row>({});
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!vals.id) return; done(vals); closeModal(); }}>
      <h2 className="al-dialog__title" id="modal-title">{title}</h2>
      <div className="al-dialog__body">
        <Field><Label htmlFor="stash-pick">{label}</Label>
          <Combo id="stash-pick" label={label} placeholder="Start typing a company…"
            source={refSource(resource, resource === "processes" ? "&status=active" : "")}
            onPick={(it) => setVals((v) => ({ ...v, id: it.value, label: it.label }))} /></Field>
        {extra?.(vals, (v) => setVals((x) => ({ ...x, ...v })))}
      </div>
      <div className="al-dialog__actions">
        <button className="al-button" type="button" onClick={dismissModal}>Cancel</button>
        <button className="al-button al-button--primary" type="submit" disabled={!vals.id}>Add</button>
      </div>
    </form>
  );
}

/** Make a record with its own form (a company, a person), then give it to `made`. */
function createWith(resource: string, title: string, initial: Row, made: (rec: Row) => unknown) {
  openModal(<>
    <h2 className="al-dialog__title" id="modal-title">{title}</h2>
    <div className="al-dialog__body">
      <CreateForm resource={resource} initial={initial} onCreated={async (rec) => { closeModal(); await made(rec); }} />
    </div>
  </>);
}

/**
 * One way to sort an item: what it becomes, and how to make it. `run`
 * resolves to the item, sorted, or to nothing when it was let be; one made
 * with its own dialog resolves at once, and gives the item to `later` once
 * the dialog's done.
 */
interface Way { to: string; label: string; run: (later: (item: Row) => void) => Promise<Row | null | undefined> }

function ways(item: Row): Way[] {
  const target = item.suggestion?.target as Row | null;
  const url: string | null = item.url;
  const convert = (to: string, fields: Row = {}) => () => post(`stash/${item.id}/convert`, { to, fields });
  const made = async (entity: string, id: number, later: (item: Row) => void) => {
    const done = await attempt(() => post(`stash/${item.id}/made`, { entity, id }));
    if (done) later(done);
  };
  const all: Way[] = [];
  if (item.kind === "link") {
    all.push({
      to: "application", label: "An application",
      run: async (later) => {
        await newApplication({ url: url || undefined, onAdded: (card) => made("application", card.application_id, later) });
        return null;
      },
    });
  }
  all.push(
    {
      to: "company", label: "A company",
      run: async (later) => {
        const initial = url ? (/linkedin\.com\//i.test(url) ? { linkedin: url } : { website: url }) : {};
        createWith("companies", "Add a company", initial, (rec) => made("company", rec.id, later));
        return null;
      },
    },
    {
      to: "person", label: "A person",
      run: async (later) => {
        createWith("people", "Add a person", url && /linkedin\.com\/in\//i.test(url) ? { linkedin: url } : {}, (rec) => made("person", rec.id, later));
        return null;
      },
    },
    { to: "memo", label: "A note", run: convert("memo") },
    {
      to: "note", label: "A note on an application…",
      run: async () => {
        const p = target?.entity === "process" ? target : await pick({ title: "A note on an application", resource: "processes", label: "Which one" });
        return p ? convert("note", { process_id: p.id })() : null;
      },
    },
    {
      to: "prep", label: "A task",
      run: convert("prep"),
    },
    {
      to: "reminder", label: "A reminder…",
      run: async () => {
        const p = await pick({
          title: "A reminder", resource: "processes", label: "For",
          extra: (vals, set) => <Field><Label htmlFor="stash-due">When</Label>
            <DatePicker id="stash-due" value={vals.due_at || null} onChange={(v) => set({ due_at: v })} /></Field>,
        });
        return p ? convert("reminder", { process_id: p.id, due_at: p.due_at ? `${p.due_at}T09:00` : null })() : null;
      },
    },
  );
  if (item.kind === "link") {
    all.push({
      to: "link", label: "A link on an application…",
      run: async () => {
        const a = target?.entity === "application" ? { ...target, kind: "other" } : await pick({
          title: "A link on an application", resource: "applications", label: "Which one",
          extra: (vals, set) => <Field><Label htmlFor="stash-kind">Kind</Label>
            <Select id="stash-kind" value={vals.kind || "other"} onChange={(e) => set({ kind: e.target.value })}>
              {[["portal", "Candidate portal"], ["prep", "Prep"], ["invite", "Invitation"], ["company", "About the company"], ["other", "Other"]]
                .map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select></Field>,
        });
        return a ? convert("link", { application_id: a.id, kind: a.kind || "other" })() : null;
      },
    });
  }
  if (item.kind === "file") {
    all.push({
      to: "document", label: "A document",
      run: convert("document", { kind: item.suggestion?.kind, ...(target?.entity === "process" ? { process_id: target.id } : {}) }),
    });
  }
  return all;
}

/** The one-click way, from the item's suggestion. */
function primary(item: Row): { label: string; run: Way["run"] } | null {
  const s = item.suggestion as Row | null;
  if (!s) return null;
  const t = s.target as Row | null;
  if (s.to === "open" && t) return { label: `Open ${t.label}`, run: async () => { go(HREF[t.entity]?.(t.id) || "/"); return null; } };
  const way = ways(item).find((w) => w.to === s.to);
  if (!way) return null;
  const label = ({
    application: "Add as an application",
    company: "Add as a company",
    person: "Add as a person",
    memo: "Keep as a note",
    prep: "Add as a task",
    note: t ? `Add as a note on ${t.label}` : "Add as a note",
    link: t ? `Add to ${t.label}` : "Add as a link",
    document: t ? `Add to ${t.label}'s files` : "Add to your files",
  } as Record<string, string>)[s.to] || way.label;
  return { label, run: way.run };
}

function ItemPreview({ item }: { item: Row }) {
  if (item.kind === "file") {
    return <a className="stash-title" href={`/api/stash/${item.id}/file`} target="_blank" rel="noreferrer">{item.filename}</a>;
  }
  if (item.kind === "link") {
    return <>
      <a className="stash-title" href={item.url} target="_blank" rel="noreferrer">{item.title || item.url}</a>
      <span className="stash-host muted small" translate="no">{host(item.url)}</span>
      {item.body ? <p className="stash-body">{item.body}</p> : null}
    </>;
  }
  return <>
    {item.title ? <span className="stash-title">{item.title}</span> : null}
    <p className="stash-body">{item.body}</p>
  </>;
}

function StashItem({ item, tab, onSorted, focused, onFocus }: {
  item: Row; tab: string; onSorted: (item: Row, message: string) => void; focused: boolean; onFocus: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: Way["run"], what: string) => {
    if (busy) return;
    setBusy(true);
    const later = (done: Row) => onSorted(done, what);
    const done = await attempt(() => fn(later));
    setBusy(false);
    if (done && done.id) later(done);
  };
  const first = tab === "new" ? primary(item) : null;
  const old = tab === "new" && daysFromToday(item.created_at) <= -7;
  const from = item.source && item.source !== "app"
    ? ({ bookmarklet: "the bookmarklet", share: "a phone", shortcut: "a Shortcut", email: "email", extension: "the extension", cli: "the command line", api: "the API" } as Record<string, string>)[item.source]
    : null;
  return (
    <li className={`stash-item${old ? " is-old" : ""}`} data-stash-id={item.id} tabIndex={-1} aria-current={focused ? "true" : undefined} onFocus={onFocus}>
      <div className="stash-what">
        <div className="stash-preview" translate="no"><ItemPreview item={item} /></div>
        <p className="stash-meta muted small">
          <time dateTime={item.created_at}>{fmtStamp(item.created_at)}</time>
          {from ? ` · from ${from}` : ""}
          {old ? " · waiting a while" : ""}
          {item.result ? <> · became <a href={HREF[item.result.entity]?.(item.result.id) || "#"} translate="no">{item.result.label}</a></> : null}
        </p>
        {tab === "new" && item.suggestion?.why ? <p className="stash-why small">{item.suggestion.why}</p> : null}
      </div>
      <div className="stash-actions">
        {first ? <button className="al-button al-button--primary al-button--sm" type="button" data-stash-primary="" aria-busy={busy ? "true" : undefined}
          onClick={() => run(first.run, first.label)}>{first.label}</button> : null}
        {tab === "new" ? <>
          <MenuButton className="al-button al-button--sm" label={`Make ${item.label} into…`} items={(close) => <>
            <p className="al-menu__label">Make it into</p>
            {ways(item).map((w) => <MenuItem key={w.to} close={close} onClick={() => run(w.run, w.label)}>{w.label}</MenuItem>)}
          </>}>Make into…</MenuButton>
          <button className="al-button al-button--sm al-button--quiet" type="button" data-stash-dismiss=""
            onClick={() => run(() => post(`stash/${item.id}/dismiss`), "Dismissed")}>Dismiss</button>
        </> : <button className="al-button al-button--sm" type="button"
          onClick={() => run(() => post(`stash/${item.id}/reopen`), "Back to sort")}>Back to sort</button>}
        <button className="al-button al-button--sm al-button--quiet al-button--danger" type="button" onClick={async () => {
          if (!(await confirmDelete(item.label))) return;
          if (await attempt(() => del(`stash/${item.id}`))) onSorted({ ...item, deleted: true }, "Deleted");
        }}>Delete</button>
      </div>
    </li>
  );
}

export function StashPage() {
  useShared();
  const [tab, setTab] = useState(() => new URLSearchParams(location.search).get("status") || "new");
  const [items, setItems] = useState<Row[] | null>(null);
  const [version, setVersion] = useState(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState(0);
  const list = useRef<HTMLOListElement>(null);
  const reload = () => setVersion((n) => n + 1);
  useEffect(() => {
    get(`stash?status=${tab}`).then(setItems).catch((e) => toast(e.message, "error"));
    loadStashCount();
  }, [tab, version]);
  const drop = useFileDrop(async (files) => { if ((await keepFiles(files)).length) { setTab("new"); reload(); } });
  const sorted = (item: Row, what: string) => {
    setItems((all) => (all || []).filter((x) => x.id !== item.id));
    loadStashCount();
    if (what === "Deleted") { toast("Deleted"); return; }
    const undo = item.status === "done" && item.result_entity !== "application"
      ? { label: "Undo", onclick: async () => { if (await attempt(() => post(`stash/${item.id}/reopen`, { undo: true }))) reload(); } }
      : item.status === "dismissed" ? { label: "Undo", onclick: async () => { if (await attempt(() => post(`stash/${item.id}/reopen`))) reload(); } }
        : null;
    toast(item.status === "done" ? MADE[item.result_entity] || "Sorted" : what, "info", undo);
  };
  // J and K move between items, Enter takes the suggestion, E dismisses it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if ((e.target as Element).closest?.("input, textarea, select, [contenteditable], button, a") || document.querySelector("dialog[open]")) return;
      const rows = [...(list.current?.querySelectorAll<HTMLElement>(".stash-item") || [])];
      if (!rows.length) return;
      const at = Math.min(focus, rows.length - 1);
      const move = (i: number) => { e.preventDefault(); const n = Math.max(0, Math.min(rows.length - 1, i)); setFocus(n); rows[n].focus(); };
      if (e.key === "j" || e.key === "ArrowDown") move(at + 1);
      else if (e.key === "k" || e.key === "ArrowUp") move(at - 1);
      else if (e.key === "Enter") { e.preventDefault(); rows[at].querySelector<HTMLButtonElement>("[data-stash-primary]")?.click(); }
      else if (e.key === "e") { e.preventDefault(); rows[at].querySelector<HTMLButtonElement>("[data-stash-dismiss]")?.click(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [focus, items]);
  const all = items || [];
  return (
    <div className={`page stash-page${drop.over ? " file-over" : ""}`} {...drop.props}>
      <header className="al-page-head">
        <h1>Stash</h1>
        <p className="al-page-head__lede">Keep anything here to sort later: a posting, a profile, a note from a call, a file. hunt says what each looks like it should become.</p>
      </header>
      <form className="al-panel stash-capture" aria-label="Keep something" onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim() || busy) return;
        setBusy(true);
        const item = await attempt(() => keep(text));
        setBusy(false);
        if (!item) return;
        setText("");
        if (tab === "new") setItems((xs) => [item, ...(xs || [])]); else setTab("new");
      }}>
        <TextArea aria-label="A link, or anything to sort later" rows={2} value={text}
          placeholder="Paste a link or write anything; drop files anywhere on the page"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
        <div className="stash-capture-actions">
          <label className="al-button al-button--sm al-button--quiet">Add files…<input type="file" multiple hidden onChange={async (e) => {
            const input = e.currentTarget;
            const files = [...(input.files || [])];
            input.value = "";
            if (files.length && (await keepFiles(files)).length) { setTab("new"); reload(); }
          }} /></label>
          <button className="al-button al-button--primary al-button--sm" type="submit" disabled={!text.trim()} aria-busy={busy ? "true" : undefined}>Keep it</button>
        </div>
      </form>
      <div className="al-tabs stash-tabs" role="tablist" aria-label="Stash">
        {TABS.map(([v, l]) => (
          <button key={v} className="al-tab" type="button" role="tab" aria-selected={String(tab === v) as "true" | "false"}
            onClick={() => { setItems(null); setTab(v); setFocus(0); }}>
            {l}{v === "new" && S.STASH ? <span className="nav-count">{S.STASH}</span> : null}
          </button>
        ))}
      </div>
      {items == null ? <LoadingBlock lines={6} /> : !all.length ? (
        tab === "new"
          ? <EmptyState title="Nothing to sort" text="Paste a link above, press I anywhere in hunt, or send pages here with the browser extension (Settings → Connected apps)." />
          : <EmptyState title={tab === "done" ? "Nothing sorted yet" : "Nothing dismissed"} />
      ) : (
        <>
          {tab === "new" ? <p className="muted small stash-keys">J and K move, Enter takes the suggestion, E dismisses.</p> : null}
          <ol className="stash-list" ref={list}>
            {all.map((item, i) => <StashItem key={item.id} item={item} tab={tab} onSorted={sorted} focused={i === focus} onFocus={() => setFocus(i)} />)}
          </ol>
        </>
      )}
    </div>
  );
}
