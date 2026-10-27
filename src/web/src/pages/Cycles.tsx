// The Cycles page (/cycles): the running cycles and the past ones, each
// with its details to edit, and starting, ending and resuming them.

import { useEffect, useRef, useState } from "react";
import { attempt, patch } from "../lib/api";
import { cycleWeek, cycleWeeks, endedCycles, loadCycles, pickCycle, runningCycles } from "../lib/cycles";
import { longDate } from "../lib/format";
import { fieldOf, optionLabel } from "../lib/meta";
import { useShared } from "../lib/state";
import { toast } from "../lib/toast";
import type { Cycle } from "../lib/types";
import { toPlain } from "../lib/rich";
import { mayDiscard } from "../lib/unsaved";
import { endCycle, ownOutcomes, resumeCycle, startCycle } from "../components/cycleDialogs";
import { DatePicker } from "../components/DatePicker";
import { RichText, RichView } from "../components/RichText";
import { FLAG, Field, Icon, Input, Label, Optional, PathIcon, Select } from "../components/ui";

const OUTCOME_BADGE: Record<string, string> = { offer: "al-badge--success" };

export function CyclesPage() {
  useShared();
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const page = useRef<HTMLDivElement>(null);
  useEffect(() => { loadCycles().then(() => setLoaded(true)).catch((e) => toast(e.message, "error")); }, []);
  useEffect(() => { page.current?.querySelector<HTMLElement>(".cycle-edit input")?.focus(); }, [editing]);
  if (!loaded) return <div className="page cycles-page" />;
  const run = runningCycles();
  const past = endedCycles();
  const stat = (label: string, value: number) => <div className="al-stat"><span className="al-stat__label">{label}</span><span className="al-stat__value">{value}</span></div>;
  const done = async () => { setEditing(null); await loadCycles(); };
  // Under each cycle: edit it, end or resume it; then links to its board and its stats.
  const actions = (c: Cycle) => (
    <div className="cycle-actions">
      <button className="al-button al-button--sm" type="button" onClick={() => setEditing(c.id)}>Edit details</button>
      {c.ended_on
        ? <button className="al-button al-button--sm" type="button" onClick={() => resumeCycle(c)}>Resume cycle</button>
        : <button className="al-button al-button--danger al-button--sm" type="button" onClick={() => endCycle(c)}><PathIcon d={FLAG} /><span>End cycle</span></button>}
      <a className="al-link" href={c.ended_on ? `/?cycle=${c.id}` : "/"} onClick={c.ended_on ? undefined : (e) => { e.preventDefault(); pickCycle(c.id); }}>Open its board</a>
      <a className="al-link" href={`/stats?cycle=${c.id}`}>Stats</a>
    </div>
  );
  return (
    <div className="page cycles-page" ref={page}>
      <header className="al-page-head">
        <h1>Cycles</h1>
        <p className="al-page-head__lede">Group applications however suits you: by season, place or industry. Several cycles can run at once. An ended cycle keeps its board exactly as it was. Companies, people, stories and settings are shared by all of them.</p>
        <div className="al-page-head__end">
          <button className="al-button al-button--primary" type="button" onClick={() => startCycle()}><Icon name="plus" /><span>Start a new cycle</span></button>
        </div>
      </header>
      <section className="cycle-section" aria-labelledby="cycles-running">
        <h2 id="cycles-running">Active</h2>
        {run.length ? run.map((c) => (
          <article key={c.id} className="al-panel cycle-running">
            {editing === c.id ? <CycleEditor c={c} done={done} cancel={() => setEditing(null)} /> : <>
              <div className="cycle-head">
                <h3 translate="no">{c.name}</h3><span className="al-badge al-badge--accent">Active</span>
                <span className="al-hint">{`Since ${longDate(c.started_on)} · week ${cycleWeek(c)}`}</span>
              </div>
              {c.description ? <RichView className="cycle-desc" value={c.description} /> : null}
              <div className="cycle-stats">
                {stat("Active", c.counts.active)}{stat("Closed", c.counts.archived)}
                {stat("Interviewing", c.counts.interviewed)}{stat("Offers", c.counts.offers)}
              </div>
              {actions(c)}
            </>}
          </article>
        )) : <p className="muted">No cycle is active. Start one to begin tracking applications.</p>}
      </section>
      <section className="cycle-section" aria-labelledby="cycles-past">
        <h2 id="cycles-past">Past cycles</h2>
        {past.length ? past.map((c) => (
          <article key={c.id} className="al-card cycle-past-card">
            {editing === c.id ? <CycleEditor c={c} done={done} cancel={() => setEditing(null)} /> : <>
              <div className="cycle-head">
                <h3 translate="no">{c.name}</h3>
                <span className="al-hint">{`${longDate(c.started_on)} to ${longDate(c.ended_on)} · ${cycleWeeks(c)} weeks`}</span>
              </div>
              {c.description ? <RichView className="cycle-desc" value={c.description} /> : null}
              <div className="cycle-outcome">
                <span className={`al-badge ${OUTCOME_BADGE[c.outcome || ""] || "al-badge--outline"}`}>{optionLabel(fieldOf("cycles", "outcome").options, c.outcome || "other")}</span>
                {c.outcome_note ? <span translate="no">{c.outcome_note}</span> : null}
              </div>
              <dl className="cycle-figures">
                {([["Applied", c.counts.applied], ["Interviewed", c.counts.interviewed], ["Offers", c.counts.offers], ["On the board at the end", c.counts.active]] as [string, number][])
                  .map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
              </dl>
              {actions(c)}
            </>}
          </article>
        )) : <p className="muted">None yet. When a cycle ends, its board is kept here.</p>}
      </section>
    </div>
  );
}

function CycleEditor({ c, done, cancel }: { c: Cycle; done: () => void; cancel: () => void }) {
  const [vals, setVals] = useState({ name: c.name, description: c.description || "", started_on: c.started_on as string | null, ended_on: c.ended_on,
    outcome: c.outcome || "other", outcome_note: c.outcome_note || "" });
  // How it ended: one of the usual, one of yours from before, or new words.
  const [own, setOwn] = useState<string[]>([]);
  useEffect(() => { if (c.ended_on) ownOutcomes().then(setOwn); }, [c.ended_on]);
  const usual = fieldOf("cycles", "outcome").options as [string, string][];
  const yours = [...new Set([...own, ...(vals.outcome && !usual.some(([v]) => v === vals.outcome) ? [vals.outcome] : [])])];
  const [typing, setTyping] = useState(false);
  const bad = !!(c.ended_on && vals.started_on && vals.ended_on && vals.ended_on < vals.started_on);
  const disabled = !vals.name.trim() || !vals.started_on || (!!c.ended_on && (!vals.ended_on || (typing && !vals.outcome.trim()))) || bad;
  return (
    <form className="cycle-edit" data-unsaved="" onSubmit={async (e) => {
      e.preventDefault();
      const fields: Record<string, unknown> = { name: vals.name.trim(), description: vals.description.trim() || null, started_on: vals.started_on };
      if (c.ended_on) Object.assign(fields, { ended_on: vals.ended_on, outcome: vals.outcome.trim(), outcome_note: vals.outcome_note.trim() || null });
      const before = { name: c.name, description: c.description, started_on: c.started_on,
        ...(c.ended_on ? { ended_on: c.ended_on, outcome: c.outcome, outcome_note: c.outcome_note } : {}) };
      const saved = await attempt(() => patch(`cycles/${c.id}`, fields));
      if (!saved) return;
      await done();
      toast(`Saved ${saved.name}`, "info", { label: "Undo", onclick: async () => { if (await attempt(() => patch(`cycles/${c.id}`, before))) await loadCycles(); } });
    }}>
      <Field><Label htmlFor={`ce-name-${c.id}`}>Name</Label><Input id={`ce-name-${c.id}`} value={vals.name} onChange={(e) => setVals({ ...vals, name: e.target.value })} /></Field>
      <Field><Label htmlFor={`ce-desc-${c.id}`}>Description <Optional /></Label>
        <RichText id={`ce-desc-${c.id}`} rows={3} label="Description" placeholder="What this cycle is for: a place, an industry, a kind of role" value={c.description}
          onChange={(html) => setVals((x) => ({ ...x, description: toPlain(html).trim() ? html : "" }))} /></Field>
      <div className="cycle-dates">
        <Field><Label htmlFor={`ce-start-${c.id}`}>Started</Label>
          <DatePicker id={`ce-start-${c.id}`} value={vals.started_on} onChange={(v) => setVals((x) => ({ ...x, started_on: v }))} /></Field>
        {c.ended_on ? <Field><Label htmlFor={`ce-end-${c.id}`}>Ended</Label>
          <DatePicker id={`ce-end-${c.id}`} value={vals.ended_on} onChange={(v) => setVals((x) => ({ ...x, ended_on: v }))} /></Field> : null}
      </div>
      {c.ended_on ? <div className="cycle-dates">
        <Field><Label htmlFor={`ce-outcome-${c.id}`}>How it ended</Label>
          <Select id={`ce-outcome-${c.id}`} value={typing ? "" : vals.outcome} onChange={(e) => {
            const v = e.target.value;
            setTyping(!v);
            setVals({ ...vals, outcome: v });
          }}>
            {usual.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            {yours.length ? <optgroup label="Your own">{yours.map((v) => <option key={v} value={v} translate="no">{v}</option>)}</optgroup> : null}
            <option value="">In your own words…</option>
          </Select>
          {typing ? <Input aria-label="How it ended, in your own words" placeholder="e.g. Moved abroad" value={vals.outcome}
            onChange={(e) => setVals({ ...vals, outcome: e.target.value })} /> : null}</Field>
        <Field><Label htmlFor={`ce-note-${c.id}`}>What happened <Optional /></Label>
          <Input id={`ce-note-${c.id}`} value={vals.outcome_note} onChange={(e) => setVals({ ...vals, outcome_note: e.target.value })} /></Field>
      </div> : null}
      <p className="al-error" id={`cycle-${c.id}-err`} hidden={!bad}>{bad ? "It ends before it starts. Pick a later end date, or an earlier start." : ""}</p>
      <p className="al-hint">{c.ended_on ? "Only the details change. Its board stays exactly as it was." : "Week numbers and stats count from the start date."}</p>
      <div className="cycle-actions">
        <button className="al-button" type="button" onClick={(e) => { if (mayDiscard(e.currentTarget)) cancel(); }}>Cancel</button>
        <button className="al-button al-button--primary" type="submit" disabled={disabled}>Save</button>
      </div>
    </form>
  );
}
