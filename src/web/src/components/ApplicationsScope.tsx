// Applications' filters, as the search's scope (lib/search.ts): the board's
// and the table's, in the top bar's field. What needs doing (due next,
// overdue) and which cycle the board shows are filters there too. Nothing
// on the page (the view is in its head). lib/filters.ts says what each
// filter means.

import { useState } from "react";
import { cycleById, runningCycles, viewedCycle, boardCycle } from "../lib/cycles";
import { FILTER_KEYS, matchesFilters, setFilters, type FilterRow, type Filters } from "../lib/filters";
import { homeK } from "../lib/format";
import { R } from "../lib/meta";
import { go } from "../lib/router";
import { usePageScope, type FilterDef, type Values } from "../lib/search";
import { S } from "../lib/state";
import { store } from "../lib/storage";
import { toast } from "../lib/toast";
import type { Row } from "../lib/types";

/** The filters in the field, in the order it lists them (the words searched are what's typed). */
const ORDER: string[] = ["cycle", "attn", "stage", "lane", "mode", "tag", "company", "person", "loc", "pay", "payknown", "source", "watch",
  "added", "applied", "closing", "emp", "status", "has", "reason"];

const lc = (s: string) => s.toLowerCase();

/** The filters, as the address has them (FILTER_KEYS), without the cycle. */
const query = (f: Values) => new URLSearchParams(FILTER_KEYS.filter((k) => f[k]).map((k) => [k, f[k]])).toString();

/**
 * `rows` supply the choices (sources, companies, people in use) and their
 * counts. `onChange(filters)` runs after each change, and as the search is
 * typed; `shown` of `total` pass.
 */
export function ApplicationsScope({ rows, initial, onChange, shown, total }: {
  rows: FilterRow[]; initial: Filters; onChange: (f: Filters) => void; shown: number; total: number;
}) {
  // The filters kept (what's being typed is the page's, as it's applied: `onChange`).
  const [f, setF] = useState<Filters>(initial);
  const opts = (resource: string, name: string) => R(resource).fields.find((x) => x.name === name)!.options as [string, string][];
  const uniq = <T,>(xs: T[], key: (x: T) => unknown) => [...new Map(xs.filter((x) => key(x)).map((x) => [key(x), x])).values()];
  const sources = [...new Set(rows.map((r) => (r.source || "").trim()).filter(Boolean).map(lc))].sort();
  const places = [...new Set(rows.map((r) => (r.location || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const companies = uniq(rows, (r) => r.company_id).map((r) => [String(r.company_id), r.company] as [string, string]).sort((a, b) => a[1].localeCompare(b[1]));
  // Stages and sub stages in use, as on the board; a stage's own sub stages once one's chosen.
  const stages = uniq(rows, (r) => r.stage_name && r.stage_id).sort((a, b) => a.stage_n - b.stage_n)
    .map((r) => [String(r.stage_id), r.stage_name] as [string, string]);
  const inStage = uniq(rows, (r) => r.lane_name && r.lane_id).sort((a, b) => a.stage_n - b.stage_n || a.lane_n - b.lane_n);
  const laneStage = new Map(inStage.map((r) => [String(r.lane_id), String(r.stage_id)]));
  const lanes = inStage.filter((r) => !f.stage || String(r.stage_id) === f.stage)
    .map((r) => [String(r.lane_id), f.stage ? r.lane_name : `${r.stage_name} › ${r.lane_name}`] as [string, string]);
  const people = uniq(rows.flatMap((r) => r.people), (p: Row) => p.id).map((p) => [String(p.id), p.name] as [string, string]).sort((a, b) => a[1].localeCompare(b[1]));
  const days = (...ns: number[]): [string, string][] => ns.map((n) => [String(n), `last ${n} days`]);
  const within = (...ns: number[]): [string, string][] => ns.map((n) => [String(n), `within ${n} days`]);
  const inDays = (v: string) => `${v}d`;
  // Which cycle the board shows: one of those running (none: all of them), or an ended one being looked at.
  const run = runningCycles();
  const viewed = viewedCycle();
  const cycles: [string, string][] = [
    ...(run.length > 1 ? run.map((c) => [String(c.id), c.name] as [string, string]) : []),
    ...(viewed ? [[String(viewed.id), `${viewed.name} (ended)`] as [string, string]] : []),
  ];
  const cycle = viewed ? String(viewed.id) : run.length > 1 ? boardCycle() : "";
  // Every filter the field offers, its keyword, and its choices: for the list, and its chip.
  const DEFS: Record<string, FilterDef> = {
    cycle: { key: "cycle", label: "Cycle", keyword: "cycle", choices: cycles, uncounted: true, chip: (v) => `Cycle: ${cycleById(v)?.name ?? v}` },
    attn: { key: "attn", label: "What's due", keyword: "is", choices: [["next", "Due next"], ["overdue", "Overdue"]],
      word: (v) => (v === "next" ? "due" : v), chip: (v) => (v === "next" ? "Due next" : "Overdue") },
    stage: { key: "stage", label: "Stage", keyword: "stage", choices: stages },
    lane: { key: "lane", label: "Sub stage", keyword: "substage", choices: lanes },
    tag: { key: "tag", label: "Tag", keyword: "tag", choices: S.TAGS.map((t) => [t.name, t.name]) },
    company: { key: "company", label: "Company", keyword: "company", choices: companies },
    person: { key: "person", label: "Person", keyword: "person", choices: people },
    mode: { key: "mode", label: "Work mode", keyword: "mode", choices: opts("applications", "work_mode") },
    loc: { key: "loc", label: "Location", keyword: "location", choices: places.map((p) => [p, p]), contains: (v) => `Location contains “${v}”` },
    pay: { key: "pay", label: "Pay", keyword: "pay", choices: [50, 75, 100, 125, 150, 175, 200, 250].map((k) => [String(k * 1000), `${homeK(k * 1000)}+ a year`]),
      word: (v) => `${Number(v) / 1000}k` },
    payknown: { key: "payknown", label: "Pay", keyword: "pay", choices: [["1", "Known pay only"]], under: "pay", word: () => "known", chip: () => "Known pay only" },
    source: { key: "source", label: "Source", keyword: "source", choices: sources.map((x) => [x, x]) },
    watch: { key: "watch", label: "Attention", keyword: "is", choices: [["soon", "Interview within 7 days"], ["quiet", "Gone quiet (14+ days)"]], word: (v) => v },
    added: { key: "added", label: "Added", keyword: "added", choices: days(7, 30, 90), word: inDays },
    applied: { key: "applied", label: "Applied", keyword: "applied", choices: days(7, 30, 90), word: inDays },
    closing: { key: "closing", label: "Closing", keyword: "closing", choices: within(7, 14, 30), word: inDays },
    emp: { key: "emp", label: "Employment", keyword: "employment", choices: opts("applications", "employment") },
    status: { key: "status", label: "Status", keyword: "status", choices: [["active", "active"], ["archived", "closed"], ["none", "not on the board"]],
      word: (v) => ({ archived: "closed", none: "none" } as Record<string, string>)[v] ?? v },
    has: { key: "has", label: "Has", keyword: "has", choices: [["emails", "emails"], ["files", "files sent"], ["people", "people"], ["nothing", "nothing recorded"]], word: (v) => v },
    reason: { key: "reason", label: "Closed", keyword: "reason", choices: S.META.archive_reasons.map((r: Row) => [r.value, r.label] as [string, string]) },
  };

  const commit = (next: Values, push = true) => {
    // Another cycle: the board drawn again for it, with the filters as they are.
    if ((next.cycle || "") !== cycle) {
      const qs = query(next);
      if (next.cycle && !(viewed && next.cycle === String(viewed.id))) store("boardCycle", next.cycle);
      else if (!next.cycle && !viewed) store("boardCycle", "");
      go(`${location.pathname}${qs ? `?${qs}` : ""}`);
      return;
    }
    const { cycle: _, ...rest } = next;
    setF(rest as Filters);
    setFilters(rest as Filters, { push });
    onChange(rest as Filters);
  };
  const clearAll = () => {
    const before = f;
    commit({ ...Object.fromEntries(FILTER_KEYS.map((k) => [k, ""])), cycle });
    toast("Filters cleared", "info", { label: "Undo", onclick: () => commit({ ...before, cycle }) });
  };
  usePageScope<FilterRow>({
    key: "applications", name: "Applications", placeholder: "Filter by stage, company, tag or any words",
    defs: ORDER.map((k) => DEFS[k]), values: { ...f, cycle }, commit, preview: (v) => onChange(v as Filters),
    rows, matches: (r, v) => matchesFilters(r, v as Filters), shown, total, clear: clearAll,
    // Another stage: a sub stage of the one before goes.
    adjust: (next, k) => (k === "stage" && next.stage && next.lane && laneStage.get(next.lane) !== next.stage ? { ...next, lane: "" } : next),
  });
  return null;
}
