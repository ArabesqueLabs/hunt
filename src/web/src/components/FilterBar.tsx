// Applications' filters, as controls: what needs doing in a row, beside the
// page's own (the board's cycles); searching, and every other filter, in a
// dialog behind the magnifier (lib/filters.ts says what they mean).

import { useRef, useState, type ReactNode } from "react";
import { FILTER_KEYS, activeFilters, setFilters, type FilterRow, type Filters } from "../lib/filters";
import { homeK } from "../lib/format";
import { R } from "../lib/meta";
import { S } from "../lib/state";
import { toast } from "../lib/toast";
import type { Row } from "../lib/types";
import { Field, Input, Label, SearchBox, Select, SysIcon } from "./ui";

/** The filters in the search dialog, after the search itself. */
const MORE = ["watch", "pay", "source", "company", "person", "added", "applied", "closing", "loc", "emp", "reason", "has", "status", "stage", "lane", "tag"] as const;

/** Everything the search dialog sets: what its button counts. */
const SEARCHED = ["q", "mode", ...MORE] as const;

/**
 * `rows` supply the choices (sources, companies, people in use). `lead`
 * starts the row (the board's cycles); `extra` ends it (Compact or Detailed, Board or Table).
 * `onChange(filters)` runs after each change; `shown` of `total` pass.
 * Each filter that's on is a chip under the controls, to take off on its
 * own; or all of them at once, with Undo.
 */
export function FilterBar({ rows, initial, onChange, shown, total, lead = null, extra = null }: {
  rows: FilterRow[]; initial: Filters; onChange: (f: Filters) => void; shown: number; total: number; lead?: ReactNode; extra?: ReactNode;
}) {
  const [f, setF] = useState<Filters>(initial);
  const [q, setQ] = useState(initial.q);
  const [loc, setLoc] = useState(initial.loc);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const dialog = useRef<HTMLDialogElement>(null);
  const opts = (resource: string, name: string) => R(resource).fields.find((x) => x.name === name)!.options;
  const uniq = <T,>(xs: T[], key: (x: T) => unknown) => [...new Map(xs.filter((x) => key(x)).map((x) => [key(x), x])).values()];
  const sources = [...new Set(rows.map((r) => (r.source || "").trim()).filter(Boolean).map((s) => s.toLowerCase()))].sort();
  const companies = uniq(rows, (r) => r.company_id).map((r) => [String(r.company_id), r.company] as [string, string]).sort((a, b) => a[1].localeCompare(b[1]));
  // Stages and sub stages in use, as on the board; a stage's own sub stages once one's chosen.
  const stages = uniq(rows, (r) => r.stage_name && r.stage_id).sort((a, b) => a.stage_n - b.stage_n)
    .map((r) => [String(r.stage_id), r.stage_name] as [string, string]);
  const inStage = uniq(rows, (r) => r.lane_name && r.lane_id).sort((a, b) => a.stage_n - b.stage_n || a.lane_n - b.lane_n);
  const laneStage = new Map(inStage.map((r) => [String(r.lane_id), String(r.stage_id)]));
  const lanes = inStage.filter((r) => !f.stage || String(r.stage_id) === f.stage)
    .map((r) => [String(r.lane_id), f.stage ? r.lane_name : `${r.stage_name} › ${r.lane_name}`] as [string, string]);
  const people = uniq(rows.flatMap((r) => r.people), (p: Row) => p.id).map((p) => [String(p.id), p.name] as [string, string]).sort((a, b) => a[1].localeCompare(b[1]));
  const change = (k: keyof Filters, v: string, push = true) => {
    const next = { ...f, [k]: v };
    // Another stage: a sub stage of the one before goes.
    if (k === "stage" && v && next.lane && laneStage.get(next.lane) !== v) next.lane = "";
    setF(next);
    setFilters(next, { push });
    onChange(next);
  };
  // Typed: a moment after the typing stops, and not a step Back undoes.
  const typed = (k: "q" | "loc", v: string) => {
    (k === "q" ? setQ : setLoc)(v);
    clearTimeout(timers.current[k]);
    timers.current[k] = setTimeout(() => setF((cur) => {
      const next = { ...cur, [k]: v.trim() };
      setFilters(next, { push: false });
      onChange(next);
      return next;
    }), 200);
  };
  // Every choice each filter offers, and what it's called: for its control, and its chip.
  const days: [string, string][] = [["7", "last 7 days"], ["30", "last 30 days"], ["90", "last 90 days"]];
  const CHOICES: Partial<Record<keyof Filters, [string, [string, string][]]>> = {
    watch: ["Attention", [["soon", "Interview within 7 days"], ["quiet", "Gone quiet (14+ days)"]]],
    pay: ["Pay", [50, 75, 100, 125, 150, 175, 200, 250].map((k) => [String(k * 1000), `${homeK(k * 1000)}+ a year`])],
    source: ["Source", sources.map((x) => [x, x])],
    company: ["Company", companies],
    person: ["Person", people],
    added: ["Added", days],
    applied: ["Applied", days],
    closing: ["Closing", [["7", "within 7 days"], ["14", "within 14 days"], ["30", "within 30 days"]]],
    emp: ["Employment", opts("applications", "employment")],
    reason: ["Closed", S.META.archive_reasons.map((r) => [r.value, r.label])],
    has: ["Has", [["emails", "emails"], ["files", "files sent"], ["people", "people"], ["nothing", "nothing recorded"]]],
    status: ["Status", [["active", "active"], ["archived", "closed"], ["none", "not on the board"]]],
    stage: ["Stage", stages],
    lane: ["Sub stage", lanes],
    tag: ["Tag", S.TAGS.map((t) => [t.name, t.name])],
  };
  /** A filter in the dialog: its name, and its choices, Any first. */
  const select = (k: keyof Filters, any = "Any") => {
    const [label, options] = CHOICES[k]!;
    return (
      <Field key={k}><Label htmlFor={`filter-${k}`}>{label}</Label>
        <Select id={`filter-${k}`} className={f[k] ? "set" : undefined} value={f[k]} onChange={(e) => change(k, e.target.value)}>
          <option value="">{any}</option>
          {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select></Field>
    );
  };
  /** What a filter that's on says, as its chip: as its control says it. */
  const chipText = (k: keyof Filters): string => {
    const v = f[k];
    if (k === "q") return `Search: ${v}`;
    if (k === "loc") return `Location: ${v}`;
    if (k === "attn") return v === "next" ? "Due next" : "Overdue";
    if (k === "mode") return opts("applications", "work_mode").find(([x]) => x === v)?.[1] || v;
    if (k === "payknown") return "Known pay only";
    const [label, options] = CHOICES[k]!;
    return `${label}: ${options.find(([x]) => x === v)?.[1] ?? v}`;
  };
  const apply = (next: Filters, push = true) => {
    setF(next); setQ(next.q); setLoc(next.loc);
    setFilters(next, { push });
    onChange(next);
  };
  const on = FILTER_KEYS.filter((k) => f[k]);
  const n = SEARCHED.filter((k) => f[k]).length;
  return (
    <div className="filter-bar">
      <div className="filter-row">
        {lead}
        {/* What needs doing: everything, what's due next, what's overdue. */}
        <div className="al-segmented" role="group" aria-label="Show">
          {([["", "All"], ["next", "Due next"], ["overdue", "Overdue"]] as [string, string][]).map(([v, l]) => (
            <button key={v} type="button" aria-pressed={String(f.attn === v) as "true" | "false"} onClick={() => change("attn", v)}>{l}</button>
          ))}
        </div>
        {/* Search and the other filters: a magnifier, opening them in a dialog; how many are on, beside it. */}
        <button className={`al-button filter-search-toggle${n ? " set" : ""}`} type="button" aria-haspopup="dialog" aria-controls="filter-search"
          aria-label={n ? `Search and filter: ${n} on` : "Search and filter"} title="Search and filter" onClick={() => dialog.current?.showModal()}>
          <SysIcon name="search" />{n ? <span className="al-badge al-badge--count">{n}</span> : null}
        </button>
        {/* Something of the page's own, at the row's end (Compact or Detailed, Board or Table). */}
        {extra ? <span className="filter-extra">{extra}</span> : null}
      </div>
      <dialog ref={dialog} id="filter-search" className="al-dialog al-dialog--md filter-dialog" aria-labelledby="filter-search-title"
        onClick={(e) => { if (e.target === e.currentTarget) dialog.current?.close(); }}>
        <div className="al-dialog__inner">
          <h2 className="al-dialog__title" id="filter-search-title">Search and filter</h2>
          <div className="al-dialog__body">
            <SearchBox aria-label="Search" placeholder="Search company, role, stage or person" autoFocus className={q ? "set" : undefined} value={q} onValue={(v) => typed("q", v)} />
            <div className="filter-fields">
              <Field><Label htmlFor="filter-mode">Work mode</Label>
                <Select id="filter-mode" className={f.mode ? "set" : undefined} value={f.mode} onChange={(e) => change("mode", e.target.value)}>
                  <option value="">Any</option>
                  {opts("applications", "work_mode").map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select></Field>
              <Field><Label htmlFor="filter-loc">Location</Label>
                <Input id="filter-loc" type="search" placeholder="e.g. London" className={loc ? "set" : undefined} value={loc} onChange={(e) => typed("loc", e.target.value)} /></Field>
              {select("watch", "All")}
              <Field><Label htmlFor="filter-pay">Pay</Label>
                <Select id="filter-pay" className={f.pay ? "set" : undefined} value={f.pay} onChange={(e) => change("pay", e.target.value)}>
                  <option value="">Any</option>
                  {CHOICES.pay![1].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
                <label className="check al-choice" hidden={!f.pay}>
                  <input type="checkbox" checked={!!f.payknown} onChange={(e) => change("payknown", e.target.checked ? "1" : "")} />Known pay only
                </label></Field>
              {select("source")}
              {select("company")}
              {select("person")}
              {select("added")}
              {select("applied")}
              {select("closing")}
              {select("emp")}
              {select("reason")}
              {select("has")}
              {select("status")}
              {select("stage")}
              {lanes.length || f.lane ? select("lane") : null}
              {S.TAGS.length ? select("tag") : null}
            </div>
          </div>
          <div className="al-dialog__actions">
            <span className="filter-count muted small" aria-live="polite">{`${shown} of ${total} shown`}</span>
            <button className="al-button al-button--quiet" type="button" disabled={!n} onClick={() => {
              const before = f;
              apply({ ...f, ...Object.fromEntries(SEARCHED.map((k) => [k, ""])), payknown: "" } as Filters);
              toast("Search and filters cleared", "info", { label: "Undo", onclick: () => apply(before) });
            }}>Clear all</button>
            <button className="al-button al-button--primary" type="button" onClick={() => dialog.current?.close()}>Done</button>
          </div>
        </div>
      </dialog>
      {/* What's on, each a chip to take off; how many pass; and taking them all off, with Undo. */}
      {activeFilters(f) ? (
        <div className="filter-chips">
          <span className="filter-count" aria-live="polite">{`${shown} of ${total} shown`}</span>
          <ul aria-label="Filters on">
            {on.map((k) => {
              const text = chipText(k);
              return (
                <li key={k}><span className="al-tag">{text}
                  <button className="al-tag__remove" type="button" aria-label={`Remove filter: ${text}`} title="Remove"
                    onClick={() => apply({ ...f, [k]: "", ...(k === "pay" ? { payknown: "" } : {}) })}>×</button></span></li>
              );
            })}
          </ul>
          <button className="al-button al-button--sm al-button--quiet filter-clear" type="button" onClick={() => {
            const before = f;
            apply(Object.fromEntries(FILTER_KEYS.map((k) => [k, ""])) as Filters);
            toast("Filters cleared", "info", { label: "Undo", onclick: () => apply(before) });
          }}>Clear all</button>
        </div>
      ) : null}
    </div>
  );
}
