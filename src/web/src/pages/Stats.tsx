// The Stats page (/stats): how the search is going, from /api/stats. Charts
// are the design system's, in plain HTML: columns (.al-chart), bars against
// a scale (.al-bullet), parts of a whole (.al-split-bar), in its chart
// colours, with its tooltip on every mark and one tab stop a chart (arrow
// keys between marks); each chart's numbers are also a table. The pay
// ranges and the day-by-day activity are hunt's own, drawn the same way.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { enc, get } from "../lib/api";
import { boardCycle, endedCycles, runningCycles } from "../lib/cycles";
import { LOC, fmtDay, fmtStamp, fromGbp, HOME, homeK, nf } from "../lib/format";
import { tenancy } from "../lib/meta";
import { go } from "../lib/router";
import type { Row } from "../lib/types";
import { initChartKeys } from "../../vendor/arabesque/js/chart.js";
import { EmptyState, LoadingBlock, Logo, Notice } from "../components/ui";

/**
 * A mark on a chart: named by its value and what it is ("12 reached|
 * Applied"), which its tooltip shows too.
 */
export function Mark({ tag = "span", className, series, style, tip }: { tag?: "span"; className: string; series?: string; style?: CSSProperties; tip: string }) {
  const Tag = tag;
  return <Tag className={className} data-series={series} style={style} role="img" aria-label={tip.replace("|", " ")} data-al-tip={tip} />;
}

/** A chart, one tab stop, its marks reached with the arrow keys. */
export function Chart({ className, children, ...rest }: { className: string; children: ReactNode } & React.ComponentProps<"div">) {
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (el.current) (initChartKeys as (e: Element) => void)(el.current); });
  return <div className={className} ref={el} {...rest}>{children}</div>;
}

/** A chart's key: a swatch in each series' colour, and what it is. */
const ChartKey = ({ items }: { items: [string | number, string][] }) => (
  <div className="al-key">{items.map(([series, label]) => <span key={label} className="al-key__item"><span className="al-swatch" data-series={String(series)} />{label}</span>)}</div>
);

export const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "—");
// Pay comes in GBP; it's shown in the home currency.
const gbpK = (n: number) => homeK(fromGbp(n));

/** A chart's numbers as a table, folded under it. */
export function VizTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <details className="al-disclosure viz-table"><summary>Show as a table</summary>
      <table className="al-table al-table--compact">
        <thead><tr>{head.map((x) => <th key={x}>{x}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((x, j) => <td key={j}>{x}</td>)}</tr>)}</tbody>
      </table>
    </details>
  );
}

/** A card on the dashboard: the system's card, with a title and what it shows. */
export const VizCard = ({ title, sub, children }: { title: string; sub?: string | null; children?: ReactNode }) => (
  <section className="al-card viz-card">
    <header className="al-card__header"><h2>{title}</h2>{sub ? <p className="al-card__description">{sub}</p> : null}</header>
    {children}
  </section>
);

/** Bars, one series, against one scale: label, bar, value (the system's bullet rows, without targets). */
export function HBars<T extends Row>({ rows, value = (r) => r.count, label = (r) => r.label, tip, extra, max }: {
  rows: T[]; value?: (r: T) => number; label?: (r: T) => string; tip?: (r: T) => string; extra?: (r: T) => string; max?: number;
}) {
  const top = max ?? Math.max(1, ...rows.map(value));
  return (
    <Chart className="al-bullet">
      {rows.map((r, i) => (
        <div key={i} className="al-bullet__row">
          <span className="al-bullet__label" title={label(r)}>{label(r)}</span>
          <span className="al-bullet__track">
            <Mark className="al-bullet__bar" series="1" style={{ inlineSize: `${(100 * value(r)) / top}%` }} tip={tip ? tip(r) : `${nf(value(r))}|${label(r)}`} />
          </span>
          <span className="al-bullet__value">{nf(value(r))}{extra ? <span className="muted">{` ${extra(r)}`}</span> : null}</span>
        </div>
      ))}
    </Chart>
  );
}

/** Columns over time, one series, on a hairline grid with a clean top tick. */
function Columns({ rows, k, what }: { rows: Row[]; k: string; what: string }) {
  const top = Math.max(1, ...rows.map((r) => r[k]));
  const step = top <= 4 ? 1 : top <= 10 ? 2 : Math.ceil(top / 4 / 5) * 5;
  const ceil = Math.ceil(top / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= ceil; t += step) ticks.push(t);
  const label = (w: string) => new Date(`${w}T00:00`).toLocaleDateString(LOC(), { day: "numeric", month: "short" });
  return (
    <Chart className="al-chart">
      <div className="al-chart__plot">
        {ticks.map((t) => <span key={t} className="al-chart__grid" style={{ insetBlockEnd: `${(100 * t) / ceil}%` }} aria-hidden="true"><span>{nf(t)}</span></span>)}
        <div className="al-chart__slots">
          {rows.map((r) => <div key={r.week} className="al-chart__slot"><Mark className="al-chart__bar" series="1" style={{ blockSize: `${(100 * r[k]) / ceil}%` }} tip={`${r[k]} ${what}|week of ${label(r.week)}`} /></div>)}
        </div>
      </div>
      <div className="al-chart__axis" aria-hidden="true">{rows.map((r, i) => <span key={r.week}>{i % 4 === 0 || i === rows.length - 1 ? label(r.week) : ""}</span>)}</div>
    </Chart>
  );
}

/** A stat tile, the system's: label, value, and maybe how it compares. */
export const Tile = ({ label, value, note, cls = "" }: { label: string; value: ReactNode; note?: ReactNode; cls?: string }) => (
  <div className={`al-stat viz-tile${cls ? ` ${cls}` : ""}`}><span className="al-stat__label">{label}</span><span className="al-stat__value">{value}</span>{note ? <span className="al-stat__note">{note}</span> : null}</div>
);

export function StatsPage() {
  // Which cycle's numbers: ?cycle= (an id, or all); else the board's.
  const run = runningCycles();
  const asked = new URLSearchParams(location.search).get("cycle");
  const period = asked || boardCycle() || "";
  const periods: Row[] = [
    ...(run.length > 1 ? [{ id: "", name: "All active" }] : []),
    ...run.map((c) => ({ ...c, active: true })), ...endedCycles(), { id: "all", name: "All cycles" },
  ];
  const [st, setSt] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { get(`stats${period ? `?cycle=${enc(period)}` : ""}`).then(setSt).catch((e) => setError(e.message)); }, [period]);
  return (
    <div className="page stats-page">
      <header className="al-page-head"><h1>Stats</h1>
        <p className="al-page-head__lede">How the search is going: what's coming up, how far applications get, and how long things take.</p></header>
      {/* Which cycle's: under the title, as Prep's filters are. */}
      <div className="list-tools">
        <div className="al-segmented stats-periods" role="group" aria-label="Period">
          {periods.map((c) => (
            <button key={c.id} type="button" aria-pressed={String(String(c.id) === String(period)) as "true" | "false"} onClick={() => go(c.id === "" ? "/stats" : `/stats?cycle=${c.id}`)}>
              <span translate={c.id && c.id !== "all" ? "no" : undefined}>{c.name}</span>{c.active ? <span className="al-badge al-badge--accent">Active</span> : null}
            </button>
          ))}
        </div>
      </div>
      {error ? <Notice kind="danger">{error}</Notice> : st ? <StatsBody st={st} /> : <LoadingBlock tall={8} lines={6} />}
    </div>
  );
}

function StatsBody({ st }: { st: Row }) {
  const t = st.totals;
  const appLink = (r: Row, text: string) => <a href={`/applications/${r.application_id}${r.process_id ? `?process=${r.process_id}` : ""}`}>{text}</a>;
  if (!t.processes) {
    return <>
      <EmptyState title="Nothing to count yet" text="Add a process to the board, and this fills in." action={<a className="al-button al-button--primary" href="/">Open the board</a>} />
      {!tenancy() ? <ResourcesSection /> : null}
    </>;
  }
  // ---- headline: one hero number, then tiles ----
  const delta = t.added_this_week - t.added_last_week;
  const first = st.funnel[0]?.reached || 0;
  const third = st.funnel[2]?.stage || "the third stage";
  const modes = st.work_modes.filter((m: Row) => m.count);
  const modeTotal = modes.reduce((a: number, m: Row) => a + m.count, 0);
  const modeName: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site", unknown: "Not said" };
  // Each mode keeps its colour, whichever are there.
  const modeSeries: Record<string, string> = { remote: "1", hybrid: "2", onsite: "3", unknown: "4" };
  return <>
    <section className="viz-kpis">
      <div className="al-stat viz-hero"><span className="al-stat__label">Active applications</span><span className="al-stat__value viz-hero-value">{nf(t.active)}</span>
        <span className="al-stat__note">{`${nf(t.archived)} closed · ${nf(t.applications)} applications in all`}</span></div>
      <div className="viz-tiles">
        <Tile label="Added this week" value={nf(t.added_this_week)} note={delta === 0 ? "same as last week" : `${delta > 0 ? "+" : "−"}${Math.abs(delta)} on last week`} cls={delta > 0 ? "up" : ""} />
        <Tile label="Interviews done" value={nf(t.interviews_done)} note={`${nf(t.interviews_upcoming)} coming up`} />
        <Tile label={`At ${st.funnel[st.funnel.length - 1]?.stage || "the last stage"}`} value={nf(t.offers)} note="processes, active or not" />
        <Tile label="Median time open" value={st.days.open_median == null ? "—" : `${st.days.open_median} days`} note="active processes, since applying" />
        <Tile label="Median time to an interview" value={st.days.to_first_step_median == null ? "—" : `${st.days.to_first_step_median} days`} note="from applying to the first step" />
        <Tile label="Median time to an outcome" value={st.days.to_close_median == null ? "—" : `${st.days.to_close_median} days`} note="from applying to closed" />
      </div>
    </section>
    <div className="viz-grid">
      {/* ---- first, what's coming up ---- */}
      <VizCard title="Coming up" sub="Scheduled interview steps">
        {st.upcoming.length ? (
          <ul className="viz-list">{st.upcoming.map((u: Row, i: number) => (
            <li key={i}><Logo id={u.company_id} logo={u.company_logo} name={u.company} size={22} />
              <span>{appLink(u, `${u.company}${u.role ? ` — ${u.role}` : ""}`)}<span className="muted small">{` · ${u.title}`}</span></span>
              <time className="muted small" dateTime={u.at}>{fmtStamp(u.at)}</time></li>
          ))}</ul>
        ) : <p className="muted small">Nothing scheduled.</p>}
      </VizCard>
      {/* ---- how far processes got ---- */}
      <VizCard title="How far they got" sub="Processes that reached each stage (now there, or further, or closed after it)">
        <HBars rows={st.funnel.map((f: Row) => ({ ...f, label: f.stage }))} value={(r) => r.reached} max={first}
          extra={(r) => (r.stage === st.funnel[0].stage ? "" : `· ${pct(r.reached, first)}`)}
          tip={(r) => `${nf(r.reached)} reached|${r.stage}: ${nf(r.now)} there now, ${pct(r.reached, first)} of all`} />
        <VizTable head={["Stage", "Reached", "There now", "Of all"]} rows={st.funnel.map((f: Row) => [f.stage, nf(f.reached), nf(f.now), pct(f.reached, first)])} />
      </VizCard>
      {/* ---- the weeks ---- */}
      <VizCard title="Added each week" sub="New processes, the last 16 weeks">
        <Columns rows={st.weekly} k="added" what="added" />
        <VizTable head={["Week of", "Added", "Archived", "Interviews"]} rows={st.weekly.map((w: Row) => [fmtDay(w.week), w.added, w.archived, w.interviews])} />
      </VizCard>
      <VizCard title="Interviews each week" sub="Interview steps done, passed or failed"><Columns rows={st.weekly} k="interviews" what="interviews" /></VizCard>
      {/* ---- what ended them ---- */}
      <VizCard title="Why they ended" sub={`${nf(t.archived)} closed processes`}>
        {st.outcomes.length ? <>
          <HBars rows={st.outcomes} tip={(r) => `${nf(r.count)}|${r.label}, ${pct(r.count, t.archived)}`} />
          <VizTable head={["Reason", "Processes", "Share"]} rows={st.outcomes.map((o: Row) => [o.label, nf(o.count), pct(o.count, t.archived)])} />
        </> : <p className="muted small">Nothing closed yet.</p>}
      </VizCard>
      {/* ---- sources: how many, and how many got somewhere ---- */}
      <VizCard title="Where they came from" sub={`How many from each source, and the share that got to ${third}`}>
        {/* Each source's processes, and over the start of that bar, those that got on. */}
        <Chart className="al-bullet">{st.sources.map((s: Row) => (
          <div key={s.source} className="al-bullet__row">
            <span className="al-bullet__label" title={s.source}>{s.source}</span>
            <span className="al-bullet__track">
              <Mark className="al-bullet__bar" series="2" style={{ inlineSize: `${(100 * s.count) / st.sources[0].count}%` }} tip={`${nf(s.count)} processes|${s.source}`} />
              <Mark className="al-bullet__bar" series="1" style={{ inlineSize: `${(100 * s.progressed) / st.sources[0].count}%` }} tip={`${pct(s.progressed, s.count)} got to ${third}|${s.source}: ${s.progressed} of ${s.count}`} />
            </span>
            <span className="al-bullet__value">{nf(s.count)}<span className="muted">{` · ${pct(s.progressed, s.count)} on`}</span></span>
          </div>
        ))}</Chart>
        <ChartKey items={[[1, `got to ${third}`], [2, "didn't (yet)"]]} />
        <VizTable head={["Source", "Processes", `Got to ${third}`, "Share"]} rows={st.sources.map((s: Row) => [s.source, nf(s.count), nf(s.progressed), pct(s.progressed, s.count)])} />
      </VizCard>
      {/* ---- work modes of active processes: part of a whole ---- */}
      <VizCard title="How they'd work" sub={`${nf(modeTotal)} active processes`}>
        {modeTotal ? (
          <Chart className="al-split-bar">
            <div className="al-split-bar__track" role="group" aria-label="How they'd work">
              {modes.map((m: Row) => <Mark key={m.mode} className="al-split-bar__part" series={modeSeries[m.mode]} style={{ flex: m.count }} tip={`${m.count}|${modeName[m.mode]}, ${pct(m.count, modeTotal)}`} />)}
            </div>
            <ChartKey items={modes.map((m: Row) => [modeSeries[m.mode], `${modeName[m.mode]} ${m.count} (${pct(m.count, modeTotal)})`])} />
          </Chart>
        ) : <p className="muted small">No active processes.</p>}
      </VizCard>
      {/* ---- pay ranges, in GBP a year ---- */}
      {st.pay.length ? <PayRanges st={st} appLink={appLink} /> : null}
      <Heat st={st} />
      {/* ---- lists: coming up, gone quiet, tags ---- */}
      <VizCard title="Gone quiet" sub={`Active, and unchanged for ${st.quiet_after_days} days or more`}>
        {st.quiet.length ? (
          <ul className="viz-list">{st.quiet.slice(0, 10).map((q: Row, i: number) => (
            <li key={i}><Logo id={q.company_id} logo={q.company_logo} name={q.company} size={22} />
              <span>{appLink(q, `${q.company}${q.title ? ` — ${q.title}` : ""}`)}{q.stage ? <span className="muted small">{` · ${q.stage}`}</span> : null}</span>
              <span className="muted small">{`${q.days} days`}</span></li>
          ))}</ul>
        ) : <p className="muted small">Nothing's gone quiet.</p>}
      </VizCard>
      {st.tags.length ? <VizCard title="Tags" sub="Applications with each tag"><HBars rows={st.tags.map((x: Row) => ({ label: x.name, count: x.count }))} /></VizCard> : null}
      <RecordsCard />
    </div>
    {!tenancy() ? <ResourcesSection /> : null}
  </>;
}

function PayRanges({ st, appLink }: { st: Row; appLink: (r: Row, text: string) => ReactNode }) {
  const lo = Math.min(...st.pay.map((p: Row) => p.min)) * 0.9;
  const hi = Math.max(...st.pay.map((p: Row) => p.max)) * 1.05;
  const x = (v: number) => `${(100 * (v - lo)) / (hi - lo)}%`;
  const shown: Row[] = st.pay.slice(0, 12);
  return (
    <VizCard title="Pay on the table" sub={`Active processes, ${HOME()} a year${st.pay_median ? ` · median midpoint ${gbpK(st.pay_median)}` : ""}`}>
      <Chart className="ranges">{shown.map((p, i) => (
        <div key={i} className="range-row">
          <span className="range-label">{appLink(p, p.company)}</span>
          <span className="range-track">
            {st.pay_median ? <span className="range-median" style={{ insetInlineStart: x(st.pay_median) }} aria-hidden="true" /> : null}
            <Mark className="range-bar" series="1" style={{ insetInlineStart: x(p.min), width: `calc(${x(p.max)} - ${x(p.min)} + 8px)` }} tip={`${gbpK(p.min)}–${gbpK(p.max)}|${p.company}${p.title ? ` — ${p.title}` : ""}`} />
          </span>
          <span className="range-value">{gbpK(p.max)}</span>
        </div>
      ))}</Chart>
      <VizTable head={["Company", "Role", "From", "To"]} rows={st.pay.map((p: Row) => [p.company, p.title, gbpK(p.min), gbpK(p.max)])} />
    </VizCard>
  );
}

/** Activity, day by day: one hue, more is darker. */
function Heat({ st }: { st: Row }) {
  const counts: Record<string, number> = Object.fromEntries(st.activity.map((a: Row) => [a.day, a.count]));
  const top = Math.max(1, ...st.activity.map((a: Row) => a.count));
  const level = (c: number) => (!c ? 0 : Math.min(4, Math.ceil((4 * c) / top)));
  const start = new Date(`${st.activity_since}T00:00`);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // back to Monday
  const end = new Date(`${st.today}T00:00`);
  const cells: ReactNode[] = [];
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = d.toLocaleDateString("en-CA");
    const c = counts[key] || 0;
    const day = d.toLocaleDateString(LOC(), { weekday: "short", day: "numeric", month: "short" });
    cells.push(c ? <Mark key={key} className={`heat-cell l${level(c)}`} tip={`${c} change${c === 1 ? "" : "s"}|${day}`} />
      : <span key={key} className="heat-cell l0" aria-hidden="true" />);
  }
  const busiest = st.activity.reduce((a: Row | null, r: Row) => (r.count > (a?.count ?? 0) ? r : a), null);
  return (
    <VizCard title="Activity" sub={`Changes you made, day by day, the last 26 weeks${busiest ? ` · busiest: ${fmtDay(busiest.day)} (${busiest.count})` : ""}`}>
      <Chart className="heat"><div className="heat-days" aria-hidden="true">{["Mon", "", "Wed", "", "Fri", "", ""].map((x, i) => <span key={i}>{x}</span>)}</div><div className="heat-grid">{cells}</div></Chart>
      <p className="heat-legend" aria-hidden="true">Fewer{[0, 1, 2, 3, 4].map((l) => <span key={l} className={`heat-cell l${l}`} />)}More</p>
    </VizCard>
  );
}

/** What's kept, table by table. */
function RecordsCard() {
  const [rows, setRows] = useState<{ label: string; count: number }[] | null>(null);
  useEffect(() => {
    get("system").then((sys) => setRows(Object.entries(sys.database.rows as Record<string, number>).map(([k, n]) => ({ label: TABLE_NAMES[k] || k, count: n }))
      .filter((r) => r.count).sort((a, b) => b.count - a.count))).catch(() => setRows([]));
  }, []);
  if (!rows?.length) return null;
  return (
    <VizCard title="Records" sub={`${nf(rows.reduce((a, r) => a + r.count, 0))} rows in all`}>
      <HBars rows={rows.slice(0, 10)} />
      <VizTable head={["Table", "Rows"]} rows={rows.map((r) => [r.label, nf(r.count)])} />
    </VizCard>
  );
}

// ---- resources: what hunt uses of its machine, from /api/system ----

export function fmtBytes(n: number | null | undefined) {
  if (n == null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

export function fmtUptime(s: number) {
  const d = Math.floor(s / 86400), hr = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${hr}h` : hr ? `${hr}h ${m}m` : m ? `${m}m` : `${Math.round(s)}s`;
}

export const cpuPct = (x: number | null | undefined) => (x == null ? "—" : `${x < 0.1 ? (100 * x).toFixed(1) : Math.round(100 * x)}%`);

/** Part of a whole, as one split bar: used, then what's left in the neutral. */
export const Meter = ({ used, total, label }: { used: number; total: number; label: string }) => {
  const share = Math.min(100, (100 * used) / total);
  return (
    <Chart className="al-split-bar meter">
      <div className="al-split-bar__track" role="group" aria-label={label}>
        <Mark className="al-split-bar__part" series="1" style={{ inlineSize: `${share}%` }} tip={`${fmtBytes(used)} of ${fmtBytes(total)}|${label}, ${pct(used, total)}`} />
        <span className="al-split-bar__part" data-series="0" style={{ flex: 1 }} aria-hidden="true" />
      </div>
      <span className="meter-value">{`${pct(used, total)} of ${fmtBytes(total)}`}</span>
    </Chart>
  );
};

/** The tables' records, by what they hold. */
export const TABLE_NAMES: Record<string, string> = {
  application: "Applications", process: "Processes", company: "Companies", person: "People", step: "Interview steps",
  note: "Notes on processes", memo: "General notes", document: "Documents", version: "File versions", email: "Emails",
  activity: "Audit log entries", tagging: "Tags given", tag: "Tags", process_person: "People on processes",
  step_person: "People at steps", process_file: "Files sent", stored_file: "Stored files", stage: "Stages",
  fx_rate: "Exchange rates", mail_ignore: "Ignored senders", setting: "Settings",
};

/** The Resources section: kept up to date while the page is open. */
export function ResourcesSection() {
  const [sys, setSys] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const load = () => get("system").then((x) => { setSys(x); setError(null); }).catch((e) => setError(e.message));
    load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, 5000);
    return () => clearInterval(timer);
  }, []);
  let body: ReactNode = null;
  if (error) body = <Notice kind="danger">{error}</Notice>;
  else if (sys) {
    const m = sys.memory, c = sys.cpu, d = sys.database;
    const mem = m.rss ?? m.container ?? m.peak;
    const memNote = m.limit ? `of a ${fmtBytes(m.limit)} limit` : m.rss != null ? `peak ${fmtBytes(m.peak)}` : "the most it has held";
    const cores = c.limit ?? c.cpus;
    const disk = d.disk;
    body = <>
      <div className="viz-tiles system-tiles">
        <Tile label={m.rss != null || m.container != null ? "Memory" : "Memory (peak)"} value={fmtBytes(mem)} note={memNote} />
        <Tile label="CPU now" value={cpuPct(c.recent)} note={`${cpuPct(c.average)} on average · ${c.limit != null ? `limit ${c.limit} CPU${c.limit === 1 ? "" : "s"}` : `${c.cpus} CPUs`}`} />
        <Tile label="Database" value={fmtBytes(d.size)} note={`${d.kind} · ${nf(d.files)} stored file${d.files === 1 ? "" : "s"}, ${fmtBytes(d.file_bytes)}`} />
        {disk ? <Tile label="Disk free" value={fmtBytes(disk.free)} note={`of ${fmtBytes(disk.total)} · ${pct(disk.total - disk.free, disk.total)} used`} /> : null}
        {c.load ? <Tile label="Load" value={c.load[0].toFixed(2)} note={`${c.load[1].toFixed(2)} over 5 min, ${c.load[2].toFixed(2)} over 15 · ${cores} CPU${cores === 1 ? "" : "s"}`} /> : null}
        <Tile label="Up for" value={fmtUptime(sys.hunt.service_uptime_seconds ?? sys.hunt.uptime_seconds)} note={sys.hunt.starts > 1
          ? `across ${sys.hunt.starts - 1} restart${sys.hunt.starts === 2 ? "" : "s"} or rollout${sys.hunt.starts === 2 ? "" : "s"} · hunt ${sys.hunt.version} for ${fmtUptime(sys.hunt.uptime_seconds)}`
          : `hunt ${sys.hunt.version} · ${sys.hunt.os}/${sys.hunt.arch}`} />
      </div>
      <div className="viz-grid">
        {m.limit && mem != null ? <VizCard title="Memory" sub="In use, against the container's limit"><Meter used={mem} total={m.limit} label="Memory" /></VizCard> : null}
        {disk ? <VizCard title="Disk" sub="The volume holding the database"><Meter used={disk.total - disk.free} total={disk.total} label="Used" /></VizCard> : null}
      </div>
    </>;
  }
  return (
    <section className="viz-system">
      <div className="viz-system-head"><h2>System resources</h2>
        <p className="muted small">What hunt uses of the machine it runs on, every 5 seconds while this page is open</p></div>
      <div>{body}</div>
    </section>
  );
}
