// The Applications table view (/applications): every application, with
// where it stands, in sortable columns. The board itself is the other view
// (/); ViewSwitch moves between them.

import { useEffect, useState } from "react";
import { loadBoard } from "../lib/board";
import { runningCycles } from "../lib/cycles";
import { matchesFilters, readFilters, restoreFilters, rowFromCard, type FilterRow, type Filters } from "../lib/filters";
import { fmtDay, fmtMoney, HOME, homePay } from "../lib/format";
import { fieldOf, optionLabel } from "../lib/meta";
import { store, stored } from "../lib/storage";
import { toast } from "../lib/toast";
import type { Board, Card } from "../lib/types";
import { BulkBar, ProcessActions, SelectAllCell, SelectCell } from "../components/bulk";
import { useColumns } from "../components/columns";
import { FilterBar } from "../components/FilterBar";
import { TagChip } from "../components/tags";
import { LoadingPage, Logo, Table } from "../components/ui";
import { BoardContext, BoardHead, NextLabel, NoCycle } from "./Board";

const TABLE_DEFAULTS = { sort: "stage", desc: false };

type TableRow = FilterRow & { card: Card; stage: { name: string; n: number }; payText: string };

const COLUMNS: { key: string; label: string; sort: (r: TableRow) => string | number; num?: boolean }[] = [
  { key: "company", label: "Company", sort: (r) => (r.company || "").toLowerCase() },
  { key: "role", label: "Role", sort: (r) => (r.title || "~").toLowerCase() },
  { key: "stage", label: "Stage", sort: (r) => r.stage.n * 1000 + (r.card.position ?? 0) },
  { key: "next", label: "Next", sort: (r) => r.next?.at || (r.next ? "8" : "9") },
  { key: "mode", label: "Mode", sort: (r) => r.work_mode || "~" },
  { key: "pay", label: "Pay", sort: (r) => r.pay ?? -1, num: true },
  { key: "applied", label: "Applied", sort: (r) => r.applied || "", num: true },
  { key: "source", label: "Source", sort: (r) => (r.source || "~").toLowerCase() },
  { key: "location", label: "Location", sort: (r) => (r.location || "~").toLowerCase() },
  { key: "updated", label: "Updated", sort: (r) => r.updated || "" },
  { key: "tags", label: "Tags", sort: (r) => r.tags.join(",").toLowerCase() || "~" },
];

/**
 * The table: the board's applications (the cycle shown), a row each, in
 * sortable columns. Source, location, when it last changed and tags are
 * there too, hidden until shown.
 */
export function TablePage() {
  const [board, setBoard] = useState<Board | null>(null);
  useEffect(() => {
    store("boardMode", "table");
    restoreFilters();
    // Hidden until asked for, the first time.
    if (stored("hiddenColumns:board-table") == null) store("hiddenColumns:board-table", JSON.stringify(["source", "location", "updated", "tags"]));
    loadBoard().then(setBoard).catch((e) => toast(e.message, "error"));
  }, []);
  if (!board) return <LoadingPage kind="table" />;
  if (!runningCycles().length && !board.read_only) return <div className="board"><NoCycle /></div>;
  return <ApplicationsTable board={board} reload={() => { setBoard(null); loadBoard().then(setBoard); }} />;
}

function ApplicationsTable({ board, reload }: { board: Board; reload: () => void }) {
  const [prefs, setPrefs] = useState(() => {
    try { return { ...TABLE_DEFAULTS, ...JSON.parse(stored("table") || "{}") }; } catch { return { ...TABLE_DEFAULTS }; }
  });
  const [f, setF] = useState<Filters>(readFilters());
  // Selected processes, by id.
  const [sel] = useState(() => new Set<number>());
  const [, bump] = useState(0);
  const redraw = () => bump((n) => n + 1);
  const cols = useColumns("board-table", [{ name: "select", label: "", fixed: true }, { name: "company", label: "Company", fixed: true },
    ...COLUMNS.slice(1).map((c) => ({ name: c.key, label: c.label }))]);
  const ro = !!board.read_only;
  const stages = board.stages;
  const stageAt = new Map(stages.map((st, i) => [st.id, { name: st.name, n: i }]));
  const modes = fieldOf("applications", "work_mode").options;
  const rows: TableRow[] = stages.flatMap((st) => st.cards).map((card) => ({
    ...rowFromCard(card), card,
    stage: stageAt.get(card.stage_id)!,
    payText: (() => {
      const p = homePay(card);
      return p ? fmtMoney(p[0] == null ? null : Math.round(p[0]), p[1] == null ? null : Math.round(p[1]), HOME(), card.pay_period) : "";
    })() || fmtMoney(card.salary_min, card.salary_max, card.currency, card.pay_period),
  }));
  const col = COLUMNS.find((c) => c.key === prefs.sort) || COLUMNS[2];
  const shown = rows.filter((r) => matchesFilters(r, f)).sort((x, y) => {
    const a = col.sort(x), b = col.sort(y);
    const c = a < b ? -1 : a > b ? 1 : 0;
    return prefs.desc ? -c : c;
  });
  // What's selected stays to what's shown.
  const shownKeys = shown.map((r) => r.card.id);
  for (const k of [...sel]) if (!shownKeys.includes(k)) sel.delete(k);
  const after = () => { sel.clear(); reload(); };
  const sortBy = (key: string) => {
    const next = prefs.sort === key ? { ...prefs, desc: !prefs.desc } : { sort: key, desc: ["updated", "applied", "pay"].includes(key) };
    store("table", JSON.stringify({ sort: next.sort, desc: next.desc }));
    setPrefs(next);
  };
  return (
    <div className={`board table-mode${ro ? " read-only" : ""}`}>
      <BoardHead b={board} current="table" />
      <BoardContext />
      <FilterBar rows={rows} initial={f} onChange={setF} shown={shown.length} total={rows.length} />
      {cols.style}
      {cols.bar}
      <div className="al-table-wrap" tabIndex={0} aria-label="Applications">
        <Table className="al-table--interactive app-table" data-columns="board-table">
          <thead>
            <tr>
              {ro ? <th className="row-select" /> : <SelectAllCell sel={sel} keys={shownKeys} changed={redraw} />}
              {COLUMNS.map((c) => (
                <th key={c.key} aria-sort={c.key === prefs.sort ? (prefs.desc ? "descending" : "ascending") : undefined}
                  className={[c.num ? "al-table__num" : "", cols.thClass(c.key) || ""].filter(Boolean).join(" ") || undefined} data-col={c.key}>
                  <button className="th-sort" type="button" onClick={() => sortBy(c.key)}>{c.label}</button>
                  {cols.hide(c.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.length ? shown.map((r) => {
              const open = `/applications/${r.card.application_id}?process=${r.card.id}`;
              const name = `${r.company}${r.title ? ` — ${r.title}` : ""}`;
              return (
                <tr key={r.card.id} aria-selected={sel.has(r.card.id) ? "true" : undefined}
                  onClick={(e) => { if (!(e.target as Element).closest("a, button, .row-select")) (e.currentTarget.querySelector("a.table-app") as HTMLElement | null)?.click(); }}>
                  {ro ? <td className="row-select" /> : <SelectCell sel={sel} id={r.card.id} keys={() => shownKeys} changed={redraw} label={name} />}
                  <td><a className="with-logo table-app" href={open} onClick={(e) => { if (ro) { e.preventDefault(); toast(`${r.company}: read-only in a past cycle`); } }}>
                    <Logo id={r.company_id} logo={r.card.company_logo} name={r.company} size={20} /><span translate="no">{r.company}</span></a></td>
                  <td className="muted" translate="no">{r.title || ""}</td>
                  <td>{r.stage.name}{r.card.lane ? <span className="muted">{` · ${r.card.lane}`}</span> : null}</td>
                  <td className={r.next?.overdue ? "table-overdue" : r.next ? undefined : "muted"}>{r.next ? <NextLabel n={r.next} /> : "—"}</td>
                  <td>{r.work_mode ? optionLabel(modes, r.work_mode) : ""}</td>
                  <td className="al-table__num">{r.payText || <span className="muted">—</span>}</td>
                  <td className="al-table__num nowrap">{r.applied ? fmtDay(r.applied) : <span className="muted">—</span>}</td>
                  <td>{r.source || ""}</td>
                  <td>{r.location || ""}</td>
                  <td className="nowrap muted">{r.updated ? fmtDay(r.updated.slice(0, 10)) : ""}</td>
                  <td className="tags-cell">{r.tags.map((t) => <TagChip key={t} name={t} />)}</td>
                </tr>
              );
            }) : <tr><td className="muted" colSpan={COLUMNS.length + 1}>{rows.length ? "No applications match these filters." : "Nothing on the board yet."}</td></tr>}
          </tbody>
        </Table>
      </div>
      {ro ? null : <BulkBar count={sel.size} clear={() => { sel.clear(); redraw(); }} actions={<ProcessActions ids={() => [...sel]} stages={stages} after={after} />} />}
    </div>
  );
}
