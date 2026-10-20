"use strict";

// Filters for the Tracking Board, shared by its two views (board and
// table). They live in the address (/?mode=remote&pay=120000), so a filtered
// view can be bookmarked and Back undoes a change; the last ones used are
// remembered. Built on app.js.

/** Every filter, by its name in the address. */
const FILTER_KEYS = ["q", "attn", "watch", "mode", "pay", "payknown", "source", "company", "person", "added", "applied",
  "closing", "loc", "emp", "reason", "has", "status", "tag"];

const readFilters = () => {
  const q = new URLSearchParams(location.search);
  const f = Object.fromEntries(FILTER_KEYS.map((k) => [k, q.get(k) || ""]));
  // An interview soon, or gone quiet, were "attention" once.
  if (["soon", "quiet"].includes(f.attn)) { f.watch = f.watch || f.attn; f.attn = ""; }
  return f;
};
const activeFilters = (f) => FILTER_KEYS.filter((k) => f[k]).length;

/** Put filters in the address (Back undoes them if `push`), and remember them. */
function setFilters(f, { push = true } = {}) {
  const qs = new URLSearchParams(FILTER_KEYS.filter((k) => f[k]).map((k) => [k, f[k]])).toString();
  // An ended cycle being looked at stays looked at.
  const cycle = new URLSearchParams(location.search).get("cycle");
  const all = [cycle ? `cycle=${enc(cycle)}` : "", qs].filter(Boolean).join("&");
  const url = location.pathname + (all ? `?${all}` : "");
  if (url !== here()) {
    if (push) history.pushState(null, "", url);
    else history.replaceState(null, "", url);
  }
  lastUrl = here();
  store("filters", qs);
}

/** Opening the board with no filters in the address: the ones last used. */
function restoreFilters() {
  const kept = stored("filters");
  if (!location.search && kept) {
    history.replaceState(null, "", `${location.pathname}?${kept}`);
    lastUrl = here();
  }
}

// ---- what's filtered: a row per process (or application not on the board) ----

/** Pay a year in the home currency, at its top. */
function payTop(x) {
  const p = homePay(x);
  const top = p && (p[1] ?? p[0]);
  if (top == null) return null;
  return top * ({ month: 12, day: 220, hour: 1760 }[x.pay_period] || 1);
}

function rowFromCard(c) {
  return {
    process_id: c.id, application_id: c.application_id, company_id: c.company_id, company: c.company, title: c.title,
    location: c.location, source: c.source, work_mode: c.work_mode, employment: c.employment, closes_on: c.closes_on,
    pay: payTop(c), created: c.created_at, applied: c.applied_on, updated: c.updated_at, next_step_at: c.next_step_at,
    next: nextOf(c),
    status: c.status, archive_reason: c.archive_reason, tags: tagNames(c.tags), people: c.people_list || [],
    emails: c.emails || 0, files: c.files || 0, people_count: c.people || 0,
  };
}

function rowFromApplication(a, company) {
  return {
    process_id: null, application_id: a.id, company_id: a.company_id, company: company?.name, title: a.title,
    location: a.location, source: a.source, work_mode: a.work_mode, employment: a.employment, closes_on: a.closes_on,
    pay: payTop(a), created: a.created_at, applied: null, updated: a.updated_at, next_step_at: null, next: null,
    status: "none", archive_reason: null, tags: tagNames(a.tags), people: [], emails: 0, files: 0, people_count: 0,
  };
}

const today = () => isoToday();
const daysFrom = (n) => { const d = zonedNow(); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };

/** Does a row pass every filter? */
function matchesFilters(r, f) {
  const lc = (s) => (s || "").toLowerCase();
  if (f.q) {
    const text = lc([r.company, r.title, r.location, r.source, ...r.tags, ...r.people.map((p) => p.name)].join(" "));
    if (!lc(f.q).split(/\s+/).filter(Boolean).every((w) => text.includes(w))) return false;
  }
  if (f.attn === "next" && !r.next) return false;
  if (f.attn === "overdue" && !r.next?.overdue) return false;
  if (f.watch === "soon" && !(r.next_step_at && r.next_step_at.slice(0, 10) >= today() && r.next_step_at.slice(0, 10) <= daysFrom(7))) return false;
  if (f.watch === "quiet" && !(r.status === "active" && r.updated && r.updated.slice(0, 10) <= daysFrom(-14))) return false;
  if (f.mode && r.work_mode !== f.mode) return false;
  if (f.pay && (r.pay == null ? f.payknown : r.pay < Number(f.pay))) return false;
  if (f.source && lc(r.source) !== lc(f.source)) return false;
  if (f.company && String(r.company_id) !== f.company) return false;
  if (f.person && !r.people.some((p) => String(p.id) === f.person)) return false;
  if (f.added && !(r.created && r.created.slice(0, 10) >= daysFrom(-Number(f.added)))) return false;
  if (f.applied && !(r.applied && r.applied >= daysFrom(-Number(f.applied)))) return false;
  if (f.closing && !(r.closes_on && r.closes_on >= today() && r.closes_on <= daysFrom(Number(f.closing)))) return false;
  if (f.loc && !lc(r.location).includes(lc(f.loc))) return false;
  if (f.emp && r.employment !== f.emp) return false;
  if (f.reason && !(r.status === "archived" && r.archive_reason === f.reason)) return false;
  if (f.has === "emails" && !r.emails) return false;
  if (f.has === "files" && !r.files) return false;
  if (f.has === "people" && !r.people_count) return false;
  if (f.has === "nothing" && (r.emails || r.files || r.people_count)) return false;
  if (f.status && r.status !== f.status) return false;
  if (f.tag && !r.tags.some((t) => lc(t) === lc(f.tag))) return false;
  return true;
}

// ---- the filter bar ----

/**
 * The filters, as controls: the common ones in a row, the rest under "More
 * filters". `rows` supply the choices (sources, companies, people in use).
 * `onChange(filters)` runs after each change; `bar.update(shown, total)`
 * says how many pass.
 */
function filterBar(rows, f, onChange, { what = "processes", extra = null } = {}) {
  const opts = (resource, name) => R(resource).fields.find((x) => x.name === name).options;
  const uniq = (xs, key) => [...new Map(xs.filter((x) => key(x)).map((x) => [key(x), x])).values()];
  const sources = [...new Set(rows.map((r) => (r.source || "").trim()).filter(Boolean).map((s) => s.toLowerCase()))].sort();
  const companies = uniq(rows, (r) => r.company_id).map((r) => [String(r.company_id), r.company]).sort((a, b) => a[1].localeCompare(b[1]));
  const people = uniq(rows.flatMap((r) => r.people), (p) => p.id).map((p) => [String(p.id), p.name]).sort((a, b) => a[1].localeCompare(b[1]));
  const change = (k, v, push = true) => { f[k] = v; setFilters(f, { push }); onChange(f); sync(); };
  const select = (k, label, options, any = "Any") => {
    const el = h("select", { "aria-label": label, class: f[k] ? "set" : "", onchange: () => change(k, el.value) },
      h("option", { value: "" }, `${label}: ${any}`), options.map(([v, l]) => h("option", { value: v, selected: f[k] === v }, `${label}: ${l}`)));
    return el;
  };
  const text = (k, label, placeholder) => {
    const el = h("input", { type: "search", "aria-label": label, placeholder, value: f[k], class: f[k] ? "set" : "" });
    let t;
    el.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => change(k, el.value.trim(), false), 200); });
    return el;
  };
  const days = [["7", "last 7 days"], ["30", "last 30 days"], ["90", "last 90 days"]];
  const payKnown = h("label.check", {}, h("input", { type: "checkbox", checked: !!f.payknown, onchange: (e) => change("payknown", e.target.checked ? "1" : "") }), "Known pay only");
  // What needs doing: everything, what has a next step, what's overdue.
  const show = h("div.al-segmented", { role: "group", "aria-label": "Show" });
  const drawShow = () => fill(show, [["", "All"], ["next", "Has a next step"], ["overdue", "Overdue"]].map(([v, l]) =>
    h("button", { type: "button", "aria-pressed": String(f.attn === v), onclick: () => { change("attn", v); drawShow(); } }, l)));
  drawShow();
  const mode = h("select.filter-mode", { "aria-label": "Work mode", onchange: () => change("mode", mode.value) },
    h("option", { value: "" }, "Any work mode"), opts("applications", "work_mode").map(([v, l]) => h("option", { value: v, selected: f.mode === v }, l)));
  const clear = h("button.al-button.al-button--sm.al-button--quiet.filter-clear", { type: "button", onclick: () => {
    for (const k of FILTER_KEYS) f[k] = "";
    setFilters(f);
    onChange(f);
    bar.replaceWith(filterBar(rows, f, onChange, { what, extra }));
  } }, "Clear filters");
  const search = h("div.filter-search", {}, searchBox(text("q", "Search", "Search company, role or person")));
  // More filters: a toggle in this row; what it shows opens under it.
  const MORE = ["watch", "pay", "source", "company", "person", "added", "applied", "closing", "loc", "emp", "reason", "has", "status", "tag"];
  let moreOpen = MORE.some((k) => f[k]) || stored("moreFilters") === "open";
  const moreToggle = h("button.al-button.al-button--quiet.al-button--sm.filter-more-toggle", { type: "button", "aria-controls": "filter-more" });
  const main = h("div.filter-row", {},
    search, show, mode, moreToggle, clear,
    // Something of the page's own, at the row's end (the board's Detailed switch).
    extra ? h("span.filter-extra", {}, extra) : null);
  const more = h("div.filter-row.filter-more", { id: "filter-more" },
      select("watch", "Attention", [["soon", "Interview within 7 days"], ["quiet", "Gone quiet (14+ days)"]], "all"),
      select("pay", "Pay", [50, 75, 100, 125, 150, 175, 200, 250].map((k) => [String(k * 1000), `${homeK(k * 1000)}+ a year`])),
      payKnown,
      select("source", "Source", sources.map((s) => [s, s])),
      select("company", "Company", companies),
      select("person", "Person", people),
      select("added", "Added", days),
      select("applied", "Applied", days),
      select("closing", "Closing", [["7", "within 7 days"], ["14", "within 14 days"], ["30", "within 30 days"]]),
      text("loc", "Location", "Location, e.g. London"),
      select("emp", "Employment", opts("applications", "employment")),
      select("reason", "Closed", META.archive_reasons.map((r) => [r.value, r.label])),
      select("has", "Has", [["emails", "emails"], ["files", "files sent"], ["people", "people"], ["nothing", "nothing recorded"]]),
      select("status", "Status", [["active", "active"], ["archived", "closed"], ["none", "not on the board"]]),
      TAGS.length ? select("tag", "Tag", TAGS.map((t) => [t.name, t.name])) : null);
  const drawMore = () => {
    more.hidden = !moreOpen;
    moreToggle.setAttribute("aria-expanded", String(moreOpen));
    const n = MORE.filter((k) => f[k]).length;
    moreToggle.textContent = n ? `More filters (${n})` : "More filters";
  };
  moreToggle.addEventListener("click", () => { moreOpen = !moreOpen; store("moreFilters", moreOpen ? "open" : "closed"); drawMore(); });
  drawMore();
  const bar = h("div.filter-bar", {}, main, more);
  let shownNow = 0;
  function sync() {
    clear.hidden = !activeFilters(f);
    drawMore();
    clear.textContent = `Clear filters · ${shownNow} shown`;
    payKnown.hidden = !f.pay;
    for (const el of bar.querySelectorAll("select, input[type=search]")) el.classList.toggle("set", !!el.value);
  }
  bar.update = (shown) => {
    shownNow = shown;
    sync();
  };
  sync();
  return bar;
}
