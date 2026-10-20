"use strict";

// The Tracking Board's table view (/applications): every application, with
// where it stands, in sortable columns. The board itself is the other view
// (/); viewSwitch() moves between them. Built on app.js.

/** Board or Table: the switch at the top of both views. */
function viewSwitch(current) {
  const choice = (value, label, path) => h("button", {
    type: "button", "aria-pressed": String(current === value),
    // Filters come along.
    onclick: () => { if (current !== value) { store("boardMode", value); go(path + location.search); } },
  }, label);
  return h("div.al-segmented.view-switch", { role: "group", "aria-label": "View" },
    choice("board", "Board", "/"), choice("table", "Table", "/applications"));
}

const TABLE_DEFAULTS = { sort: "stage", desc: false };

/**
 * The table: the board's applications (the cycle shown), a row each, in
 * sortable columns. Source, location, when it last changed and tags are
 * there too, hidden until shown.
 */
async function showApplicationsTable() {
  let prefs;
  try { prefs = { ...TABLE_DEFAULTS, ...JSON.parse(stored("table") || "{}") }; } catch { prefs = { ...TABLE_DEFAULTS }; }
  const keep = () => store("table", JSON.stringify({ sort: prefs.sort, desc: prefs.desc }));
  // Hidden until asked for, the first time.
  if (stored("hiddenColumns:board-table") == null) store("hiddenColumns:board-table", JSON.stringify(["source", "location", "updated", "tags"]));

  const board = await loadBoard();
  if (!runningCycles().length && !board.read_only) { fill(view, boardView(board)); return; }
  const ro = board.read_only;
  const stages = board.stages;
  const stageAt = new Map(stages.map((st, i) => [st.id, { name: st.name, n: i }]));
  const modes = R("applications").fields.find((f) => f.name === "work_mode").options;

  const rows = stages.flatMap((st) => st.cards).map((card) => ({
    ...rowFromCard(card), card,
    stage: stageAt.get(card.stage_id),
    payText: (() => {
      const p = homePay(card);
      return p ? fmtMoney(p[0] == null ? null : Math.round(p[0]), p[1] == null ? null : Math.round(p[1]), HOME(), card.pay_period) : "";
    })() || fmtMoney(card.salary_min, card.salary_max, card.currency, card.pay_period),
  }));

  const COLUMNS = [
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

  const body = h("tbody");
  const head = h("tr");
  // Selected processes, by id.
  const sel = new Set();
  let shownKeys = [];
  const selected = () => [...sel];
  const after = () => { sel.clear(); showApplicationsTable(); };
  const bulk = bulkBar({ what: "selected", clear: () => { sel.clear(); render(); },
    actions: () => processActions(selected, stages, after) });

  function cells(r) {
    const open = `/applications/${r.card.application_id}?process=${r.card.id}`;
    const name = `${r.company}${r.title ? ` — ${r.title}` : ""}`;
    return [
      ro ? h("td.row-select") : selectCell(sel, r.card.id, () => shownKeys, render, name),
      h("td", {}, h("a.with-logo.table-app", { href: open, onclick: (e) => { if (ro) { e.preventDefault(); toast(`${r.company}: read-only in a past cycle`); } } },
        logoOf(r.company_id, r.card.company_logo, r.company, 20), h("span", { translate: "no" }, r.company))),
      h("td.muted", { translate: "no" }, r.title || ""),
      h("td", {}, r.stage.name, r.card.lane ? h("span.muted", {}, ` · ${r.card.lane}`) : null),
      h("td", { class: r.next?.overdue ? "table-overdue" : r.next ? "" : "muted" }, r.next ? nextLabel(r.next) : "—"),
      h("td", {}, r.work_mode ? optionLabel(modes, r.work_mode) : ""),
      h("td.al-table__num", {}, r.payText || h("span.muted", {}, "—")),
      h("td.al-table__num.nowrap", {}, r.applied ? fmtDay(r.applied) : h("span.muted", {}, "—")),
      h("td", {}, r.source || ""),
      h("td", {}, r.location || ""),
      h("td.nowrap.muted", {}, r.updated ? fmtDay(r.updated.slice(0, 10)) : ""),
      h("td.tags-cell", {}, r.tags.map((t) => tagChip(t))),
    ];
  }

  function render() {
    const f = readFilters();
    const col = COLUMNS.find((c) => c.key === prefs.sort) || COLUMNS[2];
    const shown = rows.filter((r) => matchesFilters(r, f)).sort((x, y) => {
      const a = col.sort(x), b = col.sort(y);
      const c = a < b ? -1 : a > b ? 1 : 0;
      return prefs.desc ? -c : c;
    });
    // What's selected stays to what's shown.
    shownKeys = shown.map((r) => r.card.id);
    for (const k of [...sel]) if (!shownKeys.includes(k)) sel.delete(k);
    bulk.update(sel.size);
    fill(head, ro ? h("th.row-select") : selectAllCell(sel, () => shownKeys, render),
      COLUMNS.map((c) => h("th", { "aria-sort": c.key === prefs.sort ? (prefs.desc ? "descending" : "ascending") : null, class: c.num ? "al-table__num" : "", dataset: { col: c.key } },
        h("button.th-sort", { type: "button", onclick: () => {
          if (prefs.sort === c.key) prefs.desc = !prefs.desc;
          else { prefs.sort = c.key; prefs.desc = ["updated", "applied", "pay"].includes(c.key); }
          keep(); render();
        } }, c.label))));
    if (head.closest("table")) hideableColumns("board-table", head.closest("table"));
    bar.update(shown.length);
    fill(body, shown.length
      ? shown.map((r) => {
        const tr = h("tr", { "aria-selected": sel.has(r.card.id) ? "true" : null }, cells(r));
        tr.addEventListener("click", (e) => { if (!e.target.closest("a, button, .row-select")) tr.querySelector("a.table-app").click(); });
        return tr;
      })
      : h("tr", {}, h("td.muted", { colspan: COLUMNS.length + 1 }, rows.length ? "No applications match these filters." : "Nothing on the board yet.")));
  }

  const bar = filterBar(rows, readFilters(), () => render(), { what: "applications" });
  fill(view, h("div.board.table-mode", { class: ro ? "read-only" : "" },
    boardHead(board, "table"),
    boardContext(board),
    bar,
    h("div.al-table-wrap", { tabindex: "0", "aria-label": "Applications" }, h("table.al-table--interactive.app-table", {}, h("thead", {}, head), body)),
    ro ? null : bulk));
  render();
}
