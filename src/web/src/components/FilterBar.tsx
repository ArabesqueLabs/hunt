// The Tracking Board's filters, as controls: the common ones in a row, the
// rest under "More filters" (lib/filters.ts says what they mean).

import { useRef, useState, type ReactNode } from "react";
import { FILTER_KEYS, activeFilters, setFilters, type FilterRow, type Filters } from "../lib/filters";
import { homeK } from "../lib/format";
import { R } from "../lib/meta";
import { S } from "../lib/state";
import { store, stored } from "../lib/storage";
import { toast } from "../lib/toast";
import type { Row } from "../lib/types";
import { Input, SearchBox, Select } from "./ui";

const MORE = ["watch", "pay", "source", "company", "person", "added", "applied", "closing", "loc", "emp", "reason", "has", "status", "tag"] as const;

/**
 * `rows` supply the choices (sources, companies, people in use).
 * `onChange(filters)` runs after each change; `shown` of `total` pass.
 * Each filter that's on is a chip under the controls, to take off on its
 * own; or all of them at once, with Undo.
 */
export function FilterBar({ rows, initial, onChange, shown, total, extra = null }: {
  rows: FilterRow[]; initial: Filters; onChange: (f: Filters) => void; shown: number; total: number; extra?: ReactNode;
}) {
  const [f, setF] = useState<Filters>(initial);
  const [q, setQ] = useState(initial.q);
  const [loc, setLoc] = useState(initial.loc);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [moreOpen, setMoreOpen] = useState(MORE.some((k) => initial[k]) || stored("moreFilters") === "open");
  const opts = (resource: string, name: string) => R(resource).fields.find((x) => x.name === name)!.options;
  const uniq = <T,>(xs: T[], key: (x: T) => unknown) => [...new Map(xs.filter((x) => key(x)).map((x) => [key(x), x])).values()];
  const sources = [...new Set(rows.map((r) => (r.source || "").trim()).filter(Boolean).map((s) => s.toLowerCase()))].sort();
  const companies = uniq(rows, (r) => r.company_id).map((r) => [String(r.company_id), r.company] as [string, string]).sort((a, b) => a[1].localeCompare(b[1]));
  const people = uniq(rows.flatMap((r) => r.people), (p: Row) => p.id).map((p) => [String(p.id), p.name] as [string, string]).sort((a, b) => a[1].localeCompare(b[1]));
  const change = (k: keyof Filters, v: string, push = true) => {
    const next = { ...f, [k]: v };
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
    tag: ["Tag", S.TAGS.map((t) => [t.name, t.name])],
  };
  const select = (k: keyof Filters, any = "Any") => {
    const [label, options] = CHOICES[k]!;
    return (
      <Select aria-label={label} className={f[k] ? "set" : undefined} value={f[k]} onChange={(e) => change(k, e.target.value)}>
        <option value="">{`${label}: ${any}`}</option>
        {options.map(([v, l]) => <option key={v} value={v}>{`${label}: ${l}`}</option>)}
      </Select>
    );
  };
  /** What a filter that's on says, as its chip: as its control says it. */
  const chipText = (k: keyof Filters): string => {
    const v = f[k];
    if (k === "q") return `Search: ${v}`;
    if (k === "loc") return `Location: ${v}`;
    if (k === "attn") return v === "next" ? "Has a next step" : "Overdue";
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
  const n = MORE.filter((k) => f[k]).length;
  return (
    <div className="filter-bar">
      <div className="filter-row">
        <div className="filter-search">
          <SearchBox aria-label="Search" placeholder="Search company, role or person" className={q ? "set" : undefined} value={q} onValue={(v) => typed("q", v)} />
        </div>
        {/* What needs doing: everything, what has a next step, what's overdue. */}
        <div className="al-segmented" role="group" aria-label="Show">
          {([["", "All"], ["next", "Has a next step"], ["overdue", "Overdue"]] as [string, string][]).map(([v, l]) => (
            <button key={v} type="button" aria-pressed={String(f.attn === v) as "true" | "false"} onClick={() => change("attn", v)}>{l}</button>
          ))}
        </div>
        <Select className={`filter-mode${f.mode ? " set" : ""}`} aria-label="Work mode" value={f.mode} onChange={(e) => change("mode", e.target.value)}>
          <option value="">Any work mode</option>
          {opts("applications", "work_mode").map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        {/* More filters: a toggle in this row; what it shows opens under it. */}
        <button className="al-button al-button--quiet al-button--sm filter-more-toggle" type="button" aria-controls="filter-more" aria-expanded={String(moreOpen) as "true" | "false"}
          onClick={() => { store("moreFilters", !moreOpen ? "open" : "closed"); setMoreOpen(!moreOpen); }}>{n ? `More filters (${n})` : "More filters"}</button>
        {/* Something of the page's own, at the row's end (the board's Detailed switch). */}
        {extra ? <span className="filter-extra">{extra}</span> : null}
      </div>
      <div className="filter-row filter-more" id="filter-more" hidden={!moreOpen}>
        {select("watch", "all")}
        {select("pay")}
        <label className="check al-choice" hidden={!f.pay}>
          <input type="checkbox" checked={!!f.payknown} onChange={(e) => change("payknown", e.target.checked ? "1" : "")} />Known pay only
        </label>
        {select("source")}
        {select("company")}
        {select("person")}
        {select("added")}
        {select("applied")}
        {select("closing")}
        <Input type="search" aria-label="Location" placeholder="Location, e.g. London" className={loc ? "set" : undefined} value={loc} onChange={(e) => typed("loc", e.target.value)} />
        {select("emp")}
        {select("reason")}
        {select("has")}
        {select("status")}
        {S.TAGS.length ? select("tag") : null}
      </div>
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
