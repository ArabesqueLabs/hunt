// Prep (/prep): what to read, practise and rehearse, for a particular
// interview or in general. The interviews coming up come first, each with
// how much of its prep is done; then the tasks, in progress, next and done;
// and the stories to tell, under their own tab.

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { attempt, del, get, patch, post } from "../lib/api";
import { runningCycles } from "../lib/cycles";
import { daysFromToday, fmtDay, isoToday, parseLocal } from "../lib/format";
import { fieldOf, optionLabel } from "../lib/meta";
import { store, stored } from "../lib/storage";
import { toPlain } from "../lib/rich";
import { toast } from "../lib/toast";
import type { Row } from "../lib/types";
import { mayDiscard } from "../lib/unsaved";
import { DatePicker } from "../components/DatePicker";
import { ask, closeModal, confirmDelete, openModal } from "../components/dialogs";
import { RichText, RichView } from "../components/RichText";
import { Field, Icon, Input, Label, Optional, Select } from "../components/ui";

const PREP_MINUTES: [number, string][] = [[15, "15 min"], [30, "30 min"], [60, "1 hr"], [120, "2 hr"], [240, "Half a day"]];
const minutesLabel = (n: number) => (PREP_MINUTES.find(([m]) => m === n) || [n, n ? `${n} min` : ""])[1];
const prepKinds = () => fieldOf("prep", "kind").options;
export const PRIORITY_ORDER: Record<string, number> = { high: 0, normal: 1, low: 2 };

/** Whether a daily item was done today. */
const doneToday = (x: Row) => x.repeats === "daily" && x.last_done_on === isoToday();
export const isDone = (x: Row) => (x.repeats === "daily" ? doneToday(x) : x.status === "done");

interface PrepState { tab: string; for: string; step: string; kind: string; columns: boolean }

/** What's remembered of the page in this browser: the tab, the filters and the layout. */
export const prepState = (): PrepState => {
  try { return { tab: "tasks", for: "all", step: "", kind: "all", columns: false, ...JSON.parse(stored("prep") || "{}") }; } catch { return { tab: "tasks", for: "all", step: "", kind: "all", columns: false }; }
};

/** Add prep for a process, in a dialog over its application's page; `added` once it's made. */
export async function openPrepAdding(forProcess: number, added: () => void) {
  const running = new Set(runningCycles().map((c) => c.id));
  const loaded = await attempt(() => Promise.all([get("processes?status=active"), get("steps")]));
  if (!loaded) return;
  const [procs, sts] = loaded;
  openModal(<AddPrep dialog st={{ ...prepState(), for: String(forProcess), step: "" }}
    processes={procs.filter((p: Row) => running.has(p.cycle_id) || p.id === forProcess)} steps={new Map(sts.map((s: Row) => [s.id, s]))}
    close={closeModal} added={() => { closeModal(); toast("Added to prep"); added(); }} />);
}

export function PrepPage() {
  const [st, setSt] = useState<PrepState>(prepState);
  const [adding, setAdding] = useState(false);
  const [data, setData] = useState<{ items: Row[]; stories: Row[]; processes: Row[]; steps: Map<number, Row> } | null>(null);
  const [storyEditing, setStoryEditing] = useState<number | "new" | null>(null);
  const page = useRef<HTMLDivElement>(null);
  const keep = (next: PrepState) => { store("prep", JSON.stringify({ tab: next.tab, for: next.for, step: next.step, kind: next.kind, columns: next.columns })); setSt(next); };
  const change = (o: Partial<PrepState>) => keep({ ...st, ...o });

  async function load() {
    const running = new Set(runningCycles().map((c) => c.id));
    const [all, stories, procs, sts] = await Promise.all([get("prep"), get("stories"), get("processes?status=active"), get("steps")]);
    setData({
      items: all.filter((x: Row) => x.status !== "closed"),
      stories,
      processes: procs.filter((p: Row) => running.has(p.cycle_id)),
      steps: new Map(sts.map((s: Row) => [s.id, s])),
    });
  }
  useEffect(() => { load().catch((e) => toast(e.message, "error")); }, []);
  useEffect(() => { if (adding && data) page.current?.querySelector<HTMLElement>("#pa-title")?.focus(); }, [adding, !!data]);
  if (!data) return <div className="page prep-page" ref={page} />;
  const { items, stories, processes, steps } = data;

  const procById = (id: number) => processes.find((p) => p.id === id);
  const forLabel = (x: Row) => {
    const p = procById(x.process_id);
    if (!p) return null;
    const s = x.step_id && steps.get(x.step_id);
    return `${p.label.split(" — ")[0]}${s ? ` · ${s.title}` : ""}`;
  };
  /** When it's to be done by: its own date, or else before its step. */
  const dueOf = (x: Row) => {
    if (x.due_on) return { at: x.due_on, text: fmtDay(x.due_on) };
    const s = x.step_id && steps.get(x.step_id);
    return s?.at && s.status === "scheduled" ? { at: s.at, text: `Before ${fmtDay(s.at)}` } : null;
  };
  const order = (a: Row, b: Row) => ((dueOf(a)?.at || "9") > (dueOf(b)?.at || "9") ? 1 : (dueOf(a)?.at || "9") < (dueOf(b)?.at || "9") ? -1 : 0)
    || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.id - b.id;

  const inScope = (x: Row) => (st.for === "all" || (st.for === "general" ? !x.process_id : String(x.process_id) === st.for))
    && (!st.step || String(x.step_id) === st.step) && (st.kind === "all" || x.kind === st.kind);

  const redraw = () => setData({ ...data });
  async function setItem(x: Row, fields: Row, message?: string) {
    const saved = await attempt(() => patch(`prep/${x.id}`, fields));
    if (saved) { Object.assign(x, saved); if (message) toast(message); redraw(); }
  }

  function itemView(x: Row) {
    const done = isDone(x);
    const due = !done && dueOf(x);
    const soon = due && daysFromToday(parseLocal(due.at)) <= 1;
    const title = x.url
      ? <a className="prep-title" href={x.url} target="_blank" rel="noreferrer" title={x.url} translate="no">{x.title}</a>
      : <span className="prep-title" translate="no">{x.title}</span>;
    const fl = forLabel(x);
    return (
      <li key={x.id} className={`prep-item${done ? " done" : ""}`}>
        <input type="checkbox" checked={done} aria-label={`Done: ${x.title}`} onChange={async (e) => {
          const on = e.target.checked;
          const ticked = await attempt(() => post(`prep/${x.id}/tick`, { done: on }));
          if (!ticked) return;
          Object.assign(x, ticked);
          toast(x.repeats === "daily"
            ? (on ? `Done for today · ${x.streak}-day streak` : "Back on today's list")
            : (on ? `Done: ${x.title}` : "Back on the list"));
          redraw();
        }} />
        <div className="prep-body">
          <div className="prep-line">{title}
            {x.priority === "high" && !done ? <span className="al-badge al-badge--accent">High priority</span> : null}
            {x.status === "doing" && !done ? <span className="al-badge al-badge--info">In progress</span> : null}</div>
          {x.description ? <RichView className="prose small prep-description" value={x.description} /> : null}
          <div className="prep-meta">
            <span>{optionLabel(prepKinds(), x.kind)}</span>
            {x.minutes ? <span>{minutesLabel(x.minutes)}</span> : null}
            {fl ? <a href={`/p/${x.process_id}`} translate="no">{fl}</a> : <span>General</span>}
            {due ? <span className={soon ? "prep-soon" : undefined}>{due.text}</span> : null}
            {x.repeats === "daily" ? <span>{x.streak ? `Daily · ${x.streak}-day streak` : "Daily · starts today"}</span> : null}
          </div>
          {done && x.repeats !== "daily" ? (
            <div className="prep-confidence">
              <span className="al-hint">How solid does it feel?</span>
              <div className="al-segmented" role="group" aria-label={`How solid, ${x.title}`}>
                {([["shaky", "Shaky"], ["ok", "OK"], ["solid", "Solid"]] as [string, string][]).map(([v, l]) => (
                  <button key={v} type="button" aria-pressed={String(x.confidence === v) as "true" | "false"} onClick={() => setItem(x, { confidence: v })}>{l}</button>
                ))}
              </div>
              {x.confidence === "shaky" ? <button className="al-button al-button--quiet al-button--sm" type="button"
                onClick={() => setItem(x, { status: "todo", priority: "high", confidence: null }, "Back on the list, high priority")}>Go over it again</button> : null}
            </div>
          ) : null}
        </div>
        <div className="prep-tools">
          {x.status === "todo" && !done ? <button className="al-button al-button--sm" type="button" onClick={() => setItem(x, { status: "doing" })}>Start</button> : null}
          <button className="al-button al-button--quiet al-button--sm al-button--icon" type="button" aria-label={`Describe ${x.title}`} title={x.description ? "Edit its description" : "Describe it"}
            onClick={async () => {
              let html: string | null = x.description;
              const answer = await ask({ title: x.title, ok: "Save", body: (
                <Field><Label htmlFor="pd-desc">Description</Label>
                  <RichText id="pd-desc" rows={4} label="Description" placeholder="What to cover, how, and why" value={x.description} autoFocus
                    onChange={(v) => { html = toPlain(v).trim() ? v : null; }} /></Field>
              ) });
              if (answer && html !== x.description) setItem(x, { description: html });
            }}><Icon name="edit" /></button>
          <button className="al-button al-button--quiet al-button--sm al-button--icon" type="button" aria-label={`Delete ${x.title}`} title="Delete" onClick={async () => {
            if (!(await attempt(() => del(`prep/${x.id}`)))) return;
            // What puts it back: it, without what the service gives it.
            const again = Object.fromEntries(Object.entries(x).filter(([k]) => !["id", "label", "created_at", "updated_at", "streak", "last_done_on"].includes(k)));
            await load();
            toast(`Deleted ${x.title}`, "info", { label: "Undo", onclick: async () => { if (await attempt(() => post("prep", again))) await load(); } });
          }}><Icon name="trash" /></button>
        </div>
      </li>
    );
  }

  function group(label: string, list: Row[], hint: string, empty: string) {
    return (
      <section className="prep-group" aria-label={label}>
        <div className="prep-group-head"><h2>{label}</h2><span className="al-badge al-badge--count">{list.length}</span>{hint ? <span className="al-hint">{hint}</span> : null}</div>
        {list.length ? <ul className="prep-list">{list.map(itemView)}</ul> : <p className="prep-empty">{empty}</p>}
      </section>
    );
  }

  function tasksTab() {
    const scoped = items.filter(inScope);
    const doing = scoped.filter((x) => x.status === "doing" && !isDone(x)).sort(order);
    const todo = scoped.filter((x) => x.status === "todo" && !isDone(x)).sort(order);
    const done = scoped.filter(isDone);
    const filtered = st.for !== "all" || st.kind !== "all" || st.step;
    const stepName = st.step && steps.get(Number(st.step))?.title;
    return <>
      <div className="prep-filters">
        <Field><Label htmlFor="pf-for">For</Label>
          <Select id="pf-for" value={st.for} onChange={(e) => change({ for: e.target.value, step: "" })}>
            <option value="all">Everything</option><option value="general">General prep</option>
            {processes.map((p) => <option key={p.id} value={String(p.id)}>{p.label}</option>)}
          </Select></Field>
        <Field><Label htmlFor="pf-kind">Kind</Label>
          <Select id="pf-kind" value={st.kind} onChange={(e) => change({ kind: e.target.value })}>
            <option value="all">All kinds</option>{prepKinds().map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select></Field>
        {filtered ? <button className="al-button al-button--quiet al-button--sm" type="button" onClick={() => change({ for: "all", step: "", kind: "all" })}>Show everything</button> : null}
        <span className="al-hint prep-summary">{`${done.length} of ${scoped.length} done${stepName ? ` for ${stepName}` : ""}`}</span>
        <label className="prep-columns al-choice">
          <input type="checkbox" checked={st.columns} onChange={(e) => change({ columns: e.target.checked })} />
          <span className="al-choice__text"><span>Show as columns</span></span>
        </label>
      </div>
      {adding ? <AddPrep st={st} processes={processes} steps={steps} close={() => setAdding(false)} added={async (made) => {
        setAdding(false);
        await load();
        const shown = inScope(made);
        if (!shown) change({ for: "all", step: "", kind: "all" });
        toast(shown ? "Added to prep" : "Added to prep · filters widened to show it");
      }} /> : null}
      <div className={`prep-groups${st.columns ? " as-columns" : ""}`}>
        {group("In progress", doing, "", "Nothing started. Pick something from Next.")}
        {group("Next", todo, "Soonest interview first, then priority", "All done here.")}
        {group("Done", done, "Mark how solid it feels; shaky ones can go back on the list", "Nothing done yet.")}
      </div>
    </>;
  }

  function storiesTab() {
    const again = async (changed = true) => { setStoryEditing(null); if (changed) await load(); };
    return <>
      <p className="prep-intro">Stories from your work to tell in behavioural questions, written once as situation, task, action and result, and reused across interviews.</p>
      <div className="story-list">
        {stories.map((s) => (storyEditing === s.id ? <StoryForm key={s.id} s={s} onDone={again} /> : (
          <details key={s.id} className="al-disclosure story">
            <summary>
              <span className="story-head"><span className="story-title" translate="no">{s.title}</span>
                {s.themes ? <span className="story-themes">{s.themes.split(",").map((t: string) => t.trim()).filter(Boolean).map((t: string) => <span key={t} className="al-badge al-badge--outline" translate="no">{t}</span>)}</span> : null}</span>
              <span className="al-disclosure__value">{s.told ? <span>Told at <span translate="no">{s.told}</span></span> : "Not told yet"}</span>
            </summary>
            <div className="al-disclosure__body">
              <dl className="story-parts">
                {([["Situation", s.situation], ["Task", s.task], ["Action", s.action], ["Result", s.result]] as [string, string][])
                  .filter(([, v]) => v).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><RichView as="dd" value={v} /></Fragment>)}
              </dl>
              <div className="cycle-actions">
                <button className="al-button al-button--quiet al-button--sm" type="button" onClick={() => setStoryEditing(s.id)}>Edit</button>
                <button className="al-button al-button--quiet al-button--sm" type="button" onClick={async () => {
                  if (await attempt(() => post("prep", { title: `Run through: ${s.title}`, kind: "practise", minutes: 15 }))) { await load(); toast("Added a run-through to prep"); }
                }}>Add a run-through to prep</button>
              </div>
            </div>
          </details>
        )))}
      </div>
      {storyEditing === "new" ? <StoryForm s={null} onDone={again} />
        : <button className="al-button prep-add-story" type="button" onClick={() => setStoryEditing("new")}><Icon name="plus" /><span>Add a story</span></button>}
    </>;
  }

  const tabs: [string, string, number][] = [["tasks", "To do", items.filter((x) => !isDone(x)).length], ["stories", "Stories", stories.length]];
  return (
    <div className="page prep-page" ref={page}>
      {/* Prep for one application: a way back to it. */}
      {processes.some((p) => String(p.id) === st.for) ? <a className="al-back-link" href={`/p/${st.for}`}>Back to application</a> : null}
      <header className="al-page-head">
        <h1>Prep</h1>
        <p className="al-page-head__lede">What to read, practise and rehearse, for a particular interview or in general.</p>
        <div className="al-page-head__end">
          <button className="al-button al-button--primary" type="button" onClick={() => { setAdding(true); change({ tab: "tasks" }); requestAnimationFrame(() => page.current?.querySelector<HTMLElement>("#pa-title")?.focus()); }}>
            <Icon name="plus" /><span>Add prep</span></button>
        </div>
      </header>
      <div className="al-tabs" role="tablist" aria-label="Prep">
        {tabs.map(([k, l, n]) => (
          <button key={k} className="al-tab" type="button" role="tab" id={`prep-tab-${k}`} aria-controls="prep-panel" aria-selected={String(st.tab === k) as "true" | "false"}
            onClick={() => change({ tab: k })}>{l}<span className="al-tab__count">{n}</span></button>
        ))}
      </div>
      <div className="prep-panel" id="prep-panel" role="tabpanel" aria-labelledby={`prep-tab-${st.tab}`}>{st.tab === "stories" ? storiesTab() : tasksTab()}</div>
    </div>
  );
}

/** Adding prep: in the page, or (`dialog`) in the modal. */
function AddPrep({ st, processes, steps, close, added, dialog = false }: { st: PrepState; processes: Row[]; steps: Map<number, Row>; close: () => void; added: (made: Row) => void; dialog?: boolean }) {
  const [vals, setVals] = useState({ title: "", url: "", description: "", kind: "read", process_id: st.for !== "all" && st.for !== "general" ? st.for : "", step_id: st.step || "",
    minutes: 30, due_on: null as string | null, priority: "normal", repeats: false });
  const [busy, setBusy] = useState(false);
  const set = (o: Partial<typeof vals>) => setVals({ ...vals, ...o });
  const mine = [...steps.values()].filter((s) => String(s.process_id) === String(vals.process_id) && s.status === "scheduled");
  const step = vals.step_id && steps.get(Number(vals.step_id));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vals.title.trim() || busy) return;
    setBusy(true);
    const made = await attempt(() => post("prep", {
      title: vals.title.trim(), url: vals.url.trim() || null, description: toPlain(vals.description).trim() ? vals.description : null, kind: vals.kind, priority: vals.priority, minutes: vals.minutes,
      process_id: vals.process_id ? Number(vals.process_id) : null, step_id: vals.step_id ? Number(vals.step_id) : null,
      due_on: vals.due_on, repeats: vals.repeats ? "daily" : null,
    }));
    setBusy(false);
    if (made) added(made);
  };
  const fields = <>
    <Field className="prep-wide"><Label htmlFor="pa-title">What to do</Label>
      <Input id="pa-title" placeholder="e.g. Practise designing a rate limiter" value={vals.title} onChange={(e) => set({ title: e.target.value })} /></Field>
    <Field className="prep-wide"><Label htmlFor="pa-desc">Description <Optional /></Label>
      <RichText id="pa-desc" rows={2} label="Description" placeholder="What to cover, how, and why" value="" onChange={(html) => setVals((x) => ({ ...x, description: html }))} /></Field>
    <Field className="prep-wide"><Label htmlFor="pa-url">Link <Optional /></Label>
      <Input id="pa-url" type="url" placeholder="Article, video, exercise or doc" value={vals.url} onChange={(e) => set({ url: e.target.value })} /></Field>
    <Field><Label htmlFor="pa-kind">Kind</Label>
      <Select id="pa-kind" value={vals.kind} onChange={(e) => set({ kind: e.target.value })}>{prepKinds().map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
    <Field><Label htmlFor="pa-for">For</Label>
      <Select id="pa-for" value={vals.process_id} onChange={(e) => set({ process_id: e.target.value, step_id: "" })}>
        <option value="">General prep</option>{processes.map((p) => <option key={p.id} value={String(p.id)}>{p.label}</option>)}
      </Select></Field>
    <Field hidden={!mine.length}><Label htmlFor="pa-step">Step <Optional /></Label>
      <Select id="pa-step" value={vals.step_id} onChange={(e) => set({ step_id: e.target.value })}>
        <option value="">The whole process</option>{mine.map((s) => <option key={s.id} value={String(s.id)}>{s.title}</option>)}
      </Select></Field>
    <Field><Label htmlFor="pa-est">Takes about</Label>
      <Select id="pa-est" value={vals.minutes} onChange={(e) => set({ minutes: Number(e.target.value) })}>{PREP_MINUTES.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</Select></Field>
    <Field><Label htmlFor="pa-due">Do by <Optional /></Label>
      <DatePicker id="pa-due" value={null} onChange={(v) => setVals((x) => ({ ...x, due_on: v }))} />
      <span className="al-hint">{step && step.at ? `Leave empty to finish before ${fmtDay(step.at)}` : ""}</span></Field>
    <Field><span className="al-label">Priority</span>
      <div className="al-segmented" role="group" aria-label="Priority">
        {([["high", "High"], ["normal", "Normal"], ["low", "Low"]] as [string, string][]).map(([v, l]) => (
          <button key={v} type="button" aria-pressed={String(vals.priority === v) as "true" | "false"} onClick={() => set({ priority: v })}>{l}</button>
        ))}
      </div></Field>
    <label className="prep-daily al-choice"><input type="checkbox" checked={vals.repeats} onChange={(e) => set({ repeats: e.target.checked })} />
      <span className="al-choice__text"><span>Repeat daily</span><span className="al-choice__hint">For drills, with a streak</span></span></label>
  </>;
  const actions = <>
    <button className="al-button" type="button" onClick={(e) => { if (mayDiscard(e.currentTarget)) close(); }}>Cancel</button>
    <button className="al-button al-button--primary" type="submit" disabled={!vals.title.trim()} aria-busy={busy ? "true" : undefined}>Add prep</button>
  </>;
  return dialog ? (
    <form onSubmit={submit}>
      <h2 className="al-dialog__title" id="modal-title">Add prep</h2>
      <div className="al-dialog__body prep-fields">{fields}</div>
      <div className="al-dialog__actions">{actions}</div>
    </form>
  ) : (
    <form className="al-panel prep-add" aria-label="Add prep" data-unsaved="" onSubmit={submit}>
      {fields}
      <div className="prep-add-actions">{actions}</div>
    </form>
  );
}

const STORY_KEYS = ["title", "situation", "task", "action", "result", "themes", "told"] as const;

function StoryForm({ s, onDone }: { s: Row | null; onDone: (changed?: boolean) => void }) {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(STORY_KEYS.map((k) => [k, s?.[k] || ""])));
  const field = (k: string, label: string, long: boolean, ph: string): ReactNode => {
    const id = `story-${s?.id || "new"}-${k}`;
    return (
      <Field key={k} className={long || k === "title" ? "prep-wide" : undefined}>
        <Label htmlFor={id}>{label}</Label>
        {long
          ? <RichText id={id} rows={3} label={label} placeholder={ph} value={vals[k]} onChange={(html) => setVals((x) => ({ ...x, [k]: html }))} />
          : <Input id={id} placeholder={ph} value={vals[k]} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} />}
      </Field>
    );
  };
  return (
    <form className="al-panel story-form" data-unsaved="" onSubmit={async (e) => {
      e.preventDefault();
      if (!vals.title.trim()) return;
      const body = Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, v.trim() || null]));
      const saved = await attempt(() => (s ? patch(`stories/${s.id}`, body) : post("stories", body)));
      if (saved) { toast(s ? "Saved" : "Story added"); onDone(); }
    }}>
      {field("title", "Title", false, "e.g. Cut p99 latency of the billing API by 60%")}
      {field("situation", "Situation", true, "What was going on")}
      {field("task", "Task", true, "What you had to do")}
      {field("action", "Action", true, "What you did")}
      {field("result", "Result", true, "How it turned out")}
      {field("themes", "Themes", false, "e.g. Leadership, Conflict")}
      {field("told", "Told at", false, "e.g. Quillnote, Fernwise")}
      <div className="prep-add-actions">
        {s ? <button className="al-button al-button--quiet al-button--danger al-button--sm" type="button" onClick={async () => {
          if (!(await confirmDelete(`story “${s.title}”`))) return;
          if (await attempt(() => del(`stories/${s.id}`))) { toast("Deleted"); onDone(); }
        }}>Delete</button> : null}
        <span className="spacer" />
        <button className="al-button" type="button" onClick={(e) => { if (mayDiscard(e.currentTarget)) onDone(false); }}>Cancel</button>
        <button className="al-button al-button--primary" type="submit">{s ? "Save" : "Add story"}</button>
      </div>
    </form>
  );
}
