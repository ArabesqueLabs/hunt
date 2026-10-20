"use strict";

// The Stats page (/stats): how the search is going, from /api/stats. Built
// on app.js. Charts are the design system's, in plain HTML: columns
// (.al-chart), bars against a scale (.al-bullet), parts of a whole
// (.al-split-bar), in its chart colours, with its tooltip on every mark and
// one tab stop a chart (arrow keys between marks); each chart's numbers are
// also a table. The pay ranges and the day-by-day activity are hunt's own,
// drawn the same way.

/**
 * A mark on a chart: named by its value and what it is ("12 reached|
 * Applied"), which its tooltip shows too.
 */
function mark(tag, attrs, tip) {
  return h(tag, { ...attrs, role: "img", "aria-label": tip.replace("|", " "), dataset: { ...attrs.dataset, alTip: tip } });
}

/** A chart, one tab stop, its marks reached with the arrow keys. */
function chart(el) {
  window.ArabesqueCharts?.initChartKeys(el);
  return el;
}

/** A chart's key: a swatch in each series' colour, and what it is. */
const chartKey = (items) => h("div.al-key", {}, items.map(([series, label]) =>
  h("span.al-key__item", {}, h("span.al-swatch", { dataset: { series: String(series) } }), label)));

const nf = (n) => (n == null ? "—" : Number(n).toLocaleString(LOC()));
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "—");
// Pay comes in GBP; it's shown in the home currency.
const gbpK = (n) => homeK(fromGbp(n));

/** A chart's numbers as a table, folded under it. */
function vizTable(head, rows) {
  return h("details.al-disclosure.viz-table", {}, h("summary", {}, "Show as a table"),
    h("table.al-table--compact", {}, h("thead", {}, h("tr", {}, head.map((x) => h("th", {}, x)))),
      h("tbody", {}, rows.map((r) => h("tr", {}, r.map((x) => h("td", {}, x)))))));
}

/** A card on the dashboard: the system's card, with a title and what it shows. */
const vizCard = (title, sub, ...body) => h("section.al-card.viz-card", {},
  h("header.al-card__header", {}, h("h2", {}, title), sub ? h("p.al-card__description", {}, sub) : null), body);

/** Bars, one series, against one scale: label, bar, value (the system's bullet rows, without targets). */
function hbars(rows, { value = (r) => r.count, label = (r) => r.label, tip, extra, max } = {}) {
  const top = max ?? Math.max(1, ...rows.map(value));
  return chart(h("div.al-bullet", {}, rows.map((r) => h("div.al-bullet__row", {},
    h("span.al-bullet__label", { title: label(r) }, label(r)),
    h("span.al-bullet__track", {},
      mark("span.al-bullet__bar", { dataset: { series: "1" }, style: `inline-size:${(100 * value(r)) / top}%` }, tip ? tip(r) : `${nf(value(r))}|${label(r)}`)),
    h("span.al-bullet__value", {}, nf(value(r)), extra ? h("span.muted", {}, ` ${extra(r)}`) : null)))));
}

/** Columns over time, one series, on a hairline grid with a clean top tick. */
function columns(rows, key, what) {
  const top = Math.max(1, ...rows.map((r) => r[key]));
  const step = top <= 4 ? 1 : top <= 10 ? 2 : Math.ceil(top / 4 / 5) * 5;
  const ceil = Math.ceil(top / step) * step;
  const ticks = [];
  for (let t = 0; t <= ceil; t += step) ticks.push(t);
  const label = (w) => new Date(`${w}T00:00`).toLocaleDateString(LOC(), { day: "numeric", month: "short" });
  return chart(h("div.al-chart", {},
    h("div.al-chart__plot", {},
      ticks.map((t) => h("span.al-chart__grid", { style: `inset-block-end:${(100 * t) / ceil}%`, "aria-hidden": "true" }, h("span", {}, nf(t)))),
      h("div.al-chart__slots", {}, rows.map((r) => h("div.al-chart__slot", {},
        mark("span.al-chart__bar", { dataset: { series: "1" }, style: `block-size:${(100 * r[key]) / ceil}%` }, `${r[key]} ${what}|week of ${label(r.week)}`))))),
    h("div.al-chart__axis", { "aria-hidden": "true" }, rows.map((r, i) => h("span", {}, i % 4 === 0 || i === rows.length - 1 ? label(r.week) : "")))));
}

/** A stat tile, the system's: label, value, and maybe how it compares. */
const tile = (label, value, note, cls = "") => h("div.al-stat.viz-tile", { class: cls }, h("span.al-stat__label", {}, label), h("span.al-stat__value", {}, value), note ? h("span.al-stat__note", {}, note) : null);

async function showStats() {
  // Which cycle's numbers: ?cycle= (an id, or all); else the board's.
  const run = runningCycles();
  const asked = new URLSearchParams(location.search).get("cycle");
  const period = asked || boardCycle() || "";
  const periods = [
    ...(run.length > 1 ? [{ id: "", name: "All active" }] : []),
    ...run.map((c) => ({ ...c, active: true })), ...endedCycles(), { id: "all", name: "All cycles" },
  ];
  const choose = (id) => go(id === "" ? "/stats" : `/stats?cycle=${id}`);
  const page = h("div.page.stats-page", {},
    h("header.al-page-head", {}, h("h1", {}, "Stats"),
      h("p.al-page-head__lede", {}, "How the search is going: what's coming up, how far applications get, and how long things take.")),
    // Which cycle's: under the title, as Prep's filters are.
    h("div.list-tools", {}, h("div.al-segmented.stats-periods", { role: "group", "aria-label": "Period" },
      periods.map((c) => h("button", { type: "button", "aria-pressed": String(String(c.id) === String(period)), onclick: () => choose(c.id) },
        h("span", { translate: c.id && c.id !== "all" ? "no" : null }, c.name), c.active ? h("span.al-badge.al-badge--accent", {}, "Active") : null)))));
  fill(view, page);
  let st;
  try { st = await get(`stats${period ? `?cycle=${enc(period)}` : ""}`); } catch (e) { page.append(notice("danger", {}, e.message)); return; }
  const t = st.totals;
  const appLink = (r, text) => h("a", { href: `/applications/${r.application_id}${r.process_id ? `?process=${r.process_id}` : ""}` }, text);

  if (!t.processes) {
    page.append(emptyState("Nothing to count yet", "Add a process to the board, and this fills in.",
      h("a.al-button.al-button--primary", { href: "/" }, "Open the board")));
    if (!tenancy()) page.append(await resourcesSection());
    return;
  }

  // ---- headline: one hero number, then tiles ----
  const delta = t.added_this_week - t.added_last_week;
  page.append(h("section.viz-kpis", {},
    h("div.al-stat.viz-hero", {}, h("span.al-stat__label", {}, "Active applications"), h("span.al-stat__value.viz-hero-value", {}, nf(t.active)),
      h("span.al-stat__note", {}, `${nf(t.archived)} closed · ${nf(t.applications)} applications in all`)),
    h("div.viz-tiles", {},
      tile("Added this week", nf(t.added_this_week), delta === 0 ? "same as last week" : `${delta > 0 ? "+" : "−"}${Math.abs(delta)} on last week`, delta > 0 ? "up" : ""),
      tile("Interviews done", nf(t.interviews_done), `${nf(t.interviews_upcoming)} coming up`),
      tile(`At ${st.funnel.at(-1)?.stage || "the last stage"}`, nf(t.offers), "processes, active or not"),
      tile("Median time open", st.days.open_median == null ? "—" : `${st.days.open_median} days`, "active processes, since applying"),
      tile("Median time to an interview", st.days.to_first_step_median == null ? "—" : `${st.days.to_first_step_median} days`, "from applying to the first step"),
      tile("Median time to an outcome", st.days.to_close_median == null ? "—" : `${st.days.to_close_median} days`, "from applying to closed"))));

  const grid = h("div.viz-grid");
  page.append(grid);

  // ---- first, what's coming up ----
  grid.append(vizCard("Coming up", "Scheduled interview steps",
    st.upcoming.length
      ? h("ul.viz-list", {}, st.upcoming.map((u) => h("li", {},
        logoOf(u.company_id, u.company_logo, u.company, 22),
        h("span", {}, appLink(u, `${u.company}${u.role ? ` — ${u.role}` : ""}`), h("span.muted.small", {}, ` · ${u.title}`)),
        h("time.muted.small", { datetime: u.at }, fmtStamp(u.at)))))
      : h("p.muted.small", {}, "Nothing scheduled.")));

  // ---- how far processes got ----
  const first = st.funnel[0]?.reached || 0;
  grid.append(vizCard("How far they got", "Processes that reached each stage (now there, or further, or closed after it)",
    hbars(st.funnel.map((f) => ({ ...f, label: f.stage })), {
      value: (r) => r.reached, max: first,
      extra: (r) => (r === st.funnel[0] ? "" : `· ${pct(r.reached, first)}`),
      tip: (r) => `${nf(r.reached)} reached|${r.stage}: ${nf(r.now)} there now, ${pct(r.reached, first)} of all`,
    }),
    vizTable(["Stage", "Reached", "There now", "Of all"], st.funnel.map((f) => [f.stage, nf(f.reached), nf(f.now), pct(f.reached, first)]))));

  // ---- the weeks ----
  grid.append(vizCard("Added each week", "New processes, the last 16 weeks",
    columns(st.weekly, "added", "added"),
    vizTable(["Week of", "Added", "Archived", "Interviews"], st.weekly.map((w) => [fmtDay(w.week), w.added, w.archived, w.interviews]))));
  grid.append(vizCard("Interviews each week", "Interview steps done, passed or failed",
    columns(st.weekly, "interviews", "interviews")));

  // ---- what ended them ----
  grid.append(vizCard("Why they ended", `${nf(t.archived)} closed processes`,
    st.outcomes.length
      ? [hbars(st.outcomes, { tip: (r) => `${nf(r.count)}|${r.label}, ${pct(r.count, t.archived)}` }),
        vizTable(["Reason", "Processes", "Share"], st.outcomes.map((o) => [o.label, nf(o.count), pct(o.count, t.archived)]))]
      : h("p.muted.small", {}, "Nothing closed yet.")));

  // ---- sources: how many, and how many got somewhere ----
  const third = st.funnel[2]?.stage || "the third stage";
  grid.append(vizCard("Where they came from", `How many from each source, and the share that got to ${third}`,
    // Each source's processes, and over the start of that bar, those that got on.
    chart(h("div.al-bullet", {}, st.sources.map((s) => h("div.al-bullet__row", {},
      h("span.al-bullet__label", { title: s.source }, s.source),
      h("span.al-bullet__track", {},
        mark("span.al-bullet__bar", { dataset: { series: "2" }, style: `inline-size:${(100 * s.count) / st.sources[0].count}%` },
          `${nf(s.count)} processes|${s.source}`),
        mark("span.al-bullet__bar", { dataset: { series: "1" }, style: `inline-size:${(100 * s.progressed) / st.sources[0].count}%` },
          `${pct(s.progressed, s.count)} got to ${third}|${s.source}: ${s.progressed} of ${s.count}`)),
      h("span.al-bullet__value", {}, nf(s.count), h("span.muted", {}, ` · ${pct(s.progressed, s.count)} on`)))))),
    chartKey([[1, `got to ${third}`], [2, "didn't (yet)"]]),
    vizTable(["Source", "Processes", `Got to ${third}`, "Share"], st.sources.map((s) => [s.source, nf(s.count), nf(s.progressed), pct(s.progressed, s.count)]))));

  // ---- work modes of active processes: part of a whole ----
  const modes = st.work_modes.filter((m) => m.count);
  const modeTotal = modes.reduce((a, m) => a + m.count, 0);
  const modeName = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site", unknown: "Not said" };
  // Each mode keeps its colour, whichever are there.
  const modeSeries = { remote: "1", hybrid: "2", onsite: "3", unknown: "4" };
  grid.append(vizCard("How they'd work", `${nf(modeTotal)} active processes`,
    modeTotal ? [
      chart(h("div.al-split-bar", {},
        h("div.al-split-bar__track", { role: "group", "aria-label": "How they'd work" }, modes.map((m) =>
          mark("span.al-split-bar__part", { dataset: { series: modeSeries[m.mode] }, style: `flex:${m.count}` }, `${m.count}|${modeName[m.mode]}, ${pct(m.count, modeTotal)}`))),
        chartKey(modes.map((m) => [modeSeries[m.mode], `${modeName[m.mode]} ${m.count} (${pct(m.count, modeTotal)})`])))),
    ] : h("p.muted.small", {}, "No active processes.")));

  // ---- pay ranges, in GBP a year ----
  if (st.pay.length) {
    const lo = Math.min(...st.pay.map((p) => p.min)) * 0.9;
    const hi = Math.max(...st.pay.map((p) => p.max)) * 1.05;
    const x = (v) => `${(100 * (v - lo)) / (hi - lo)}%`;
    const shown = st.pay.slice(0, 12);
    grid.append(vizCard("Pay on the table", `Active processes, ${HOME()} a year${st.pay_median ? ` · median midpoint ${gbpK(st.pay_median)}` : ""}`,
      chart(h("div.ranges", {},
        shown.map((p) => h("div.range-row", {},
          h("span.range-label", {}, appLink(p, p.company)),
          h("span.range-track", {},
            st.pay_median ? h("span.range-median", { style: `inset-inline-start:${x(st.pay_median)}`, "aria-hidden": "true" }) : null,
            mark("span.range-bar", { dataset: { series: "1" }, style: `inset-inline-start:${x(p.min)};width:calc(${x(p.max)} - ${x(p.min)} + 8px)` },
              `${gbpK(p.min)}–${gbpK(p.max)}|${p.company}${p.title ? ` — ${p.title}` : ""}`)),
          h("span.range-value", {}, gbpK(p.max)))))),
      vizTable(["Company", "Role", "From", "To"], st.pay.map((p) => [p.company, p.title, gbpK(p.min), gbpK(p.max)]))));
  }

  // ---- activity, day by day: one hue, more is darker ----
  const counts = Object.fromEntries(st.activity.map((a) => [a.day, a.count]));
  const top = Math.max(1, ...st.activity.map((a) => a.count));
  const level = (c) => (!c ? 0 : Math.min(4, Math.ceil((4 * c) / top)));
  const start = new Date(`${st.activity_since}T00:00`);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // back to Monday
  const end = new Date(`${st.today}T00:00`);
  const cells = [];
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = d.toLocaleDateString("en-CA");
    const c = counts[key] || 0;
    const day = d.toLocaleDateString(LOC(), { weekday: "short", day: "numeric", month: "short" });
    cells.push(c ? mark("span.heat-cell", { class: `l${level(c)}` }, `${c} change${c === 1 ? "" : "s"}|${day}`)
      : h("span.heat-cell.l0", { "aria-hidden": "true" }));
  }
  const busiest = st.activity.reduce((a, r) => (r.count > (a?.count ?? 0) ? r : a), null);
  grid.append(vizCard("Activity", `Changes you made, day by day, the last 26 weeks${busiest ? ` · busiest: ${fmtDay(busiest.day)} (${busiest.count})` : ""}`,
    chart(h("div.heat", {}, h("div.heat-days", { "aria-hidden": "true" }, ["Mon", "", "Wed", "", "Fri", "", ""].map((x) => h("span", {}, x))), h("div.heat-grid", {}, cells))),
    h("p.heat-legend", { "aria-hidden": "true" }, "Fewer", [0, 1, 2, 3, 4].map((l) => h("span.heat-cell", { class: `l${l}` })), "More")));

  // ---- lists: coming up, gone quiet, tags ----
  grid.append(vizCard("Gone quiet", `Active, and unchanged for ${st.quiet_after_days} days or more`,
    st.quiet.length
      ? h("ul.viz-list", {}, st.quiet.slice(0, 10).map((q) => h("li", {},
        logoOf(q.company_id, q.company_logo, q.company, 22),
        h("span", {}, appLink(q, `${q.company}${q.title ? ` — ${q.title}` : ""}`), q.stage ? h("span.muted.small", {}, ` · ${q.stage}`) : null),
        h("span.muted.small", {}, `${q.days} days`))))
      : h("p.muted.small", {}, "Nothing's gone quiet.")));
  if (st.tags.length) {
    grid.append(vizCard("Tags", "Applications with each tag",
      hbars(st.tags.map((x) => ({ label: x.name, count: x.count })), {})));
  }
  const records = await recordsCard();
  if (records) grid.append(records);
  if (!tenancy()) page.append(await resourcesSection());
}

/** What's kept, table by table. */
async function recordsCard() {
  let sys;
  try { sys = await get("system"); } catch { return null; }
  const rows = Object.entries(sys.database.rows).map(([k, n]) => ({ label: TABLE_NAMES[k] || k, count: n }))
    .filter((r) => r.count).sort((a, b) => b.count - a.count);
  if (!rows.length) return null;
  return vizCard("Records", `${nf(rows.reduce((a, r) => a + r.count, 0))} rows in all`,
    hbars(rows.slice(0, 10), {}),
    vizTable(["Table", "Rows"], rows.map((r) => [r.label, nf(r.count)])));
}

// ---- resources: what hunt uses of its machine, from /api/system ----

function fmtBytes(n) {
  if (n == null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

function fmtUptime(s) {
  const d = Math.floor(s / 86400), hr = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${hr}h` : hr ? `${hr}h ${m}m` : m ? `${m}m` : `${Math.round(s)}s`;
}

const cpuPct = (x) => (x == null ? "—" : `${x < 0.1 ? (100 * x).toFixed(1) : Math.round(100 * x)}%`);

/** Part of a whole, as one split bar: used, then what's left in the neutral. */
const meter = (used, total, label) => {
  const share = Math.min(100, (100 * used) / total);
  return chart(h("div.al-split-bar.meter", {},
    h("div.al-split-bar__track", { role: "group", "aria-label": label }, mark("span.al-split-bar__part", { dataset: { series: "1" }, style: `inline-size:${share}%` },
      `${fmtBytes(used)} of ${fmtBytes(total)}|${label}, ${pct(used, total)}`),
    h("span.al-split-bar__part", { dataset: { series: "0" }, style: `flex:1`, "aria-hidden": "true" })),
    h("span.meter-value", {}, `${pct(used, total)} of ${fmtBytes(total)}`)));
};

/** The tables' records, by what they hold. */
const TABLE_NAMES = {
  application: "Applications", process: "Processes", company: "Companies", person: "People", step: "Interview steps",
  note: "Notes on processes", memo: "General notes", document: "Documents", version: "File versions", email: "Emails",
  activity: "Audit log entries", tagging: "Tags given", tag: "Tags", process_person: "People on processes",
  step_person: "People at steps", process_file: "Files sent", stored_file: "Stored files", stage: "Stages",
  fx_rate: "Exchange rates", mail_ignore: "Ignored senders", setting: "Settings",
};

/** The Resources section: kept up to date while the page is open. */
async function resourcesSection() {
  const section = h("section.viz-system", {}, h("div.viz-system-head", {}, h("h2", {}, "System resources"),
    h("p.muted.small", {}, "What hunt uses of the machine it runs on, every 5 seconds while this page is open")));
  const body = h("div");
  section.append(body);
  let sys;
  const render = () => {
    const m = sys.memory, c = sys.cpu, d = sys.database;
    const mem = m.rss ?? m.container ?? m.peak;
    const memNote = m.limit ? `of a ${fmtBytes(m.limit)} limit` : m.rss != null ? `peak ${fmtBytes(m.peak)}` : "the most it has held";
    const cores = c.limit ?? c.cpus;
    const disk = d.disk;
    fill(body,
      h("div.viz-tiles.system-tiles", {},
        tile(m.rss != null || m.container != null ? "Memory" : "Memory (peak)", fmtBytes(mem), memNote),
        tile("CPU now", cpuPct(c.recent), `${cpuPct(c.average)} on average · ${c.limit != null ? `limit ${c.limit} CPU${c.limit === 1 ? "" : "s"}` : `${c.cpus} CPUs`}`),
        tile("Database", fmtBytes(d.size), `${d.kind} · ${nf(d.files)} stored file${d.files === 1 ? "" : "s"}, ${fmtBytes(d.file_bytes)}`),
        disk ? tile("Disk free", fmtBytes(disk.free), `of ${fmtBytes(disk.total)} · ${pct(disk.total - disk.free, disk.total)} used`) : null,
        c.load ? tile("Load", c.load[0].toFixed(2), `${c.load[1].toFixed(2)} over 5 min, ${c.load[2].toFixed(2)} over 15 · ${cores} CPU${cores === 1 ? "" : "s"}`) : null,
        tile("Up for", fmtUptime(sys.hunt.service_uptime_seconds ?? sys.hunt.uptime_seconds), sys.hunt.starts > 1
          ? `across ${sys.hunt.starts - 1} restart${sys.hunt.starts === 2 ? "" : "s"} or rollout${sys.hunt.starts === 2 ? "" : "s"} · hunt ${sys.hunt.version} for ${fmtUptime(sys.hunt.uptime_seconds)}`
          : `hunt ${sys.hunt.version} · ${sys.hunt.os}/${sys.hunt.arch}`)),
      h("div.viz-grid", {},
        m.limit && mem != null ? vizCard("Memory", "In use, against the container's limit", meter(mem, m.limit, "Memory")) : null,
        disk ? vizCard("Disk", "The volume holding the database", meter(disk.total - disk.free, disk.total, "Used")) : null));
  };
  const load = async () => {
    try { sys = await get("system"); } catch (e) { fill(body, notice("danger", {}, e.message)); return; }
    render();
  };
  await load();
  const timer = setInterval(() => {
    if (!section.isConnected) { clearInterval(timer); return; }
    if (!document.hidden) load();
  }, 5000);
  return section;
}
