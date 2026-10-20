// hunt's web UI: a client of the JSON API under /api, like the CLI.
// No build step and no dependencies. Sections:
//   basics: elements, API calls, toasts, dates
//   controls: autocomplete, field editors, dialogs
//   pages: board, process, record lists, settings, activity
//   routing

"use strict";

// ---- basics --------------------------------------------------------------------

const view = document.getElementById("view");
const modal = document.getElementById("modal");
let META = null;
let BOARD = null;

/** Build an element: h("li.card.mine", {onclick, dataset}, ...children). */
// The dashboard lives under /app: the rest of the site (the home page, the
// legal pages) is public. hunt's own pages are written without it, here
// and in links, and get it as they're drawn or visited.
const APP = "/app";
const OUTSIDE = /^\/(api|cdn-cgi|dev|app)(\/|$)|^\/(about|privacy|terms|data-deletion)$|\.[a-z0-9]+$/i;
/** A page of hunt's, at its address under /app ("/stats" → "/app/stats"). */
const appPath = (p) => (typeof p === "string" && p.startsWith("/") && !p.startsWith("//") && !OUTSIDE.test(p.split(/[?#]/)[0])
  ? APP + (p === "/" ? "" : p) : p);
/** An address under /app, as hunt names the page ("/app/stats" → "/stats"). */
const appless = (p) => (p === APP ? "/" : p.startsWith(`${APP}/`) ? p.slice(APP.length) : p);

/** The input types that are text fields, styled as the design system's. */
const TEXT_FIELDS = new Set(["text", "email", "url", "search", "password", "number", "tel", "date", "datetime-local", "time", "month", "week"]);

function h(tag, attrs, ...kids) {
  const [name, ...classes] = tag.split(".");
  const el = document.createElement(name || "div");
  if (classes.length) el.classList.add(...classes);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.classList.add(...String(v).split(/\s+/).filter(Boolean));
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "value" || k === "checked" || k === "selected") el[k] = v;
    else if (k === "href") el.setAttribute(k, appPath(v));
    else el.setAttribute(k, v === true ? "" : v);
  }
  // Tables are the design system's too. Fields are its: a field's wrapper, text fields, selects,
  // textareas, and the labels that name them (file pickers are hunt's).
  if (el.classList.contains("field") && name === "div") el.classList.add("al-field");
  if (name === "table") el.classList.add("al-table");
  if (name === "select") el.classList.add("al-select");
  else if (name === "textarea") el.classList.add("al-textarea");
  else if (name === "input" && TEXT_FIELDS.has(el.type)) el.classList.add("al-input");
  else if (name === "label" && el.hasAttribute("for")) el.classList.add("al-label");
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  // A label around a checkbox or radio is the system's choice (the whole
  // row is the target), and a switch is its switch.
  if (name === "input" && el.getAttribute("role") === "switch") el.classList.add("al-switch");
  if (name === "label" && el.querySelector(":scope > input:is([type=checkbox], [type=radio])")) el.classList.add("al-choice");
  // Facts, as terms and values, are the system's summary list.
  if (name === "dl" && el.classList.contains("facts")) summaryList(el);
  return el;
}

/** A list of terms and values as the design system's summary list: each term, with its values, a row. */
function summaryList(dl) {
  dl.classList.add("al-summary-list");
  let row = null;
  for (const kid of [...dl.children]) {
    if (kid.tagName === "DT") {
      row = document.createElement("div");
      row.className = "al-summary-list__row al-summary-list__row--no-actions";
      kid.before(row);
      kid.classList.add("al-summary-list__key");
    } else if (kid.tagName === "DD") kid.classList.add("al-summary-list__value");
    if (row && kid.tagName !== "DIV") row.append(kid);
  }
  return dl;
}

/** Replace an element's children, with h()'s rules: arrays flatten, null and false are skipped. */
function fill(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  return el;
}

async function api(method, path, body) {
  const res = await fetch("/api/" + path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}
const get = (p) => api("GET", p);
const post = (p, b) => api("POST", p, b);
const patch = (p, b) => api("PATCH", p, b);
const del = (p) => api("DELETE", p);
const put = (p, b) => api("PUT", p, b);
const enc = encodeURIComponent;

/** Run an API action; on failure, say why and return undefined. */
async function attempt(fn) {
  try {
    return await fn();
  } catch (e) {
    toast(e.message, "error");
    return undefined;
  }
}

// The toast with an action that's showing, if any, and where focus was
// when F6 took it there.
let actionToast = null;
let focusBefore = null;
addEventListener("keydown", (e) => {
  if (e.key !== "F6" || !actionToast?.isConnected) return;
  e.preventDefault();
  focusBefore = document.activeElement;
  actionToast.querySelector(".al-toast__action").focus();
});

function toast(message, kind = "info", action = null) {
  // With an action (Undo), it has no time limit (WCAG 2.2.1): it stays until
  // it's used, dismissed, or replaced by the next one with an action. F6
  // moves focus to it, and focus goes back after.
  const done = () => {
    t.remove();
    if (actionToast === t) actionToast = null;
    if (t.contains(document.activeElement) || document.activeElement === document.body) focusBefore?.focus?.();
    focusBefore = null;
  };
  // The design system's toast; hunt's own red one for an error.
  const t = h("div.al-toast", { class: kind === "error" ? "error" : "" }, h("span", {}, message),
    action ? h("button.al-toast__action", { type: "button", onclick: () => { done(); action.onclick(); } }, action.label) : null,
    action ? h("button.al-toast__dismiss", { type: "button", "aria-label": "Dismiss", title: "Dismiss", onclick: done }, "×") : null);
  if (action) {
    actionToast?.remove();
    actionToast = t;
  }
  document.getElementById("toasts").append(t);
  if (action) return;
  const stay = kind === "error" ? 6000 : 2500;
  setTimeout(() => { t.dataset.leaving = ""; }, stay);
  setTimeout(() => t.remove(), stay + 500);
}

const R = (name) => META.resources.find((r) => r.name === name || r.entity === name);
const optionLabel = (options, v) => (options.find(([value]) => value === v) || [v, v])[1];
const archiveReason = (v) => (META.archive_reasons.find((r) => r.value === v) || { label: v }).label;
/** Why a closed process is closed: its reason (the lane it's in), or else the inactive stage it's in. */
const closedWhy = (p, stage = p.stage) => (p.archive_reason ? archiveReason(p.archive_reason) : stage || "Closed");
/** An editable list's {value, label}s, for a `choice` field. */
const choicesOf = (resource) => (resource === "reasons" ? META.archive_reasons : []);
/** Reload what the forms offer: archive reasons, tags. */
async function reloadMeta() {
  META = await get("meta");
  // Shared, without an account that may use it: nothing else to load.
  if (META.tenancy && META.tenancy.account?.status !== "active") return;
  [TAGS, PREFS] = await Promise.all([get("tags"), get("settings")]);
  if (typeof loadCycles === "function") await loadCycles();
  showSidebarFoot();
  drawQuickSettings();
  if (typeof showAdminNav === "function") showAdminNav();
  showExperimentNav();
}

/** Experiments' pages in the sidebar, for those they're on for. */
function showExperimentNav() {
  document.querySelectorAll(".sidebar a[data-experiment]").forEach((a) => {
    a.hidden = !trying(a.dataset.experiment);
  });
}

// ---- the sidebar: full, or narrowed to its icons (remembered in this browser) ----

const sidebarToggle = document.getElementById("sidebar-toggle");

/**
 * Draw the sidebar full or collapsed to its icons (the design system's
 * shell); collapsed, each link's name is still read, and shows on hover.
 */
function setSidebar(mini) {
  if (mini) document.body.dataset.sidebar = "collapsed";
  else delete document.body.dataset.sidebar;
  store("sidebar", mini ? "mini" : "full");
  sidebarToggle.setAttribute("aria-expanded", String(!mini));
  fill(sidebarToggle.querySelector(".al-sidebar__label"), mini ? "Expand sidebar" : "Collapse sidebar");
  sidebarToggle.title = mini ? t("Expand sidebar") : "";
  document.querySelectorAll(".al-sidebar__nav .al-sidebar__link").forEach((a) => {
    const name = a.querySelector(".al-sidebar__label")?.firstChild?.textContent.trim();
    if (mini && name) a.title = name;
    else a.removeAttribute("title");
  });
}
sidebarToggle?.addEventListener("click", () => setSidebar(document.body.dataset.sidebar !== "collapsed"));
if (document.body.dataset.sidebar === "collapsed") setSidebar(true);

/** Whether an experiment is on for whoever's signed in (`hunt serve --experiment`). */
const trying = (name) => (META?.experiments || []).includes(name);

/** Take-home pay works out UK tax: for those who live in the UK (Settings → Location). */
const takeHomeOn = () => !!PREFS.uk_resident;

/** The sidebar's foot: Log out (behind Cloudflare Access), and the version. */
function showSidebarFoot() {
  const out = document.getElementById("logout");
  if (out) {
    out.hidden = !META.access;
    out.title = META.access?.email ? `Signed in as ${META.access.email}` : "";
  }
  // The version, linked to its release on GitHub (tagged v0.2.0 …).
  const version = document.getElementById("version");
  if (version) {
    fill(version, h("a", { href: `https://github.com/ArabesqueLabs/hunt/releases/tag/v${META.version}`, target: "_blank", rel: "noreferrer",
      title: `Release notes for hunt ${META.version}` }, `hunt ${META.version}`, icon("external")));
  }
}

/**
 * In the sidebar's foot, on every page: the theme (light, dark, or as the
 * system is; kept in this browser) and the language (the next one hunt
 * speaks, named in itself), each a click away.
 */
function drawQuickSettings() {
  const box = document.getElementById("quick-settings");
  if (!box || !META?.languages) return;
  const THEME_NEXT = { light: "dark", dark: "auto", auto: "light" };
  const themeName = { light: "Light", dark: "Dark", auto: "Match the system" };
  const now = currentTheme();
  const langs = META.languages;
  const here = PREFS.language || "en";
  const other = langs[(langs.findIndex((l) => l.value === here) + 1) % langs.length];
  fill(box,
    h("button.al-sidebar__link.quick-theme", { type: "button", title: `Theme: ${themeName[now]}`, "aria-label": `Theme: ${themeName[now]}. Change to ${themeName[THEME_NEXT[now]]}`,
      onclick: () => { setTheme(THEME_NEXT[now]); drawQuickSettings(); } },
    systemIcon("theme"), h("span.al-sidebar__label", {}, themeName[now])),
    other && other.value !== here ? h("button.al-sidebar__link.quick-language", { type: "button", lang: other.value, title: other.label,
      onclick: async (e) => {
        const button = e.currentTarget;
        if (isBusy(button)) return;
        busy(button);
        const saved = await attempt(() => patch("settings", { language: other.value }));
        if (!saved) { busy(button, false); return; }
        PREFS = saved;
        setLanguage(saved.language, saved.numerals);
        location.reload();
      } },
    systemIcon("language"), h("span.al-sidebar__label", { translate: "no" }, other.label.replace(/\s*\(.*\)$/, ""))) : null);
}

// ---- tags ------------------------------------------------------------------------------

let TAGS = [];
// The service's settings: localisation (region, clock, week, currency) and more.
let PREFS = {};

/**
 * The locale dates and numbers are written for: the region chosen, or else
 * the language's (the browser's, for English); with the digits chosen in
 * Settings, or the language's own.
 */
function LOC() {
  const base = PREFS.locale || (LANG !== "en" ? LANG : undefined);
  const digits = PREFS.numerals && PREFS.numerals !== "auto" ? PREFS.numerals : CATALOGS[LANG]?.digits;
  if (!digits || base?.includes("-u-")) return base;
  return `${base || navigator.language}-u-nu-${digits}`;
}

/**
 * Now, as the clock reads in the time zone chosen in Settings (the
 * browser's, if none): a Date whose local fields are that zone's.
 */
function zonedNow() {
  const now = new Date();
  if (!PREFS.timezone) return now;
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: PREFS.timezone, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(now).map((x) => [x.type, x.value]));
    return new Date(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  } catch { return now; }
}

/** Today's date, YYYY-MM-DD, in hunt's time zone. */
const isoToday = () => { const d = zonedNow(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** A time of day ("14:30") as the clock setting has it. */
function fmtTime(hhmm) {
  if (!hhmm) return "";
  if (PREFS.clock === "24") return hhmm;
  const [hr, min] = hhmm.split(":").map(Number);
  const d = new Date(2000, 0, 1, hr, min);
  return d.toLocaleTimeString(LOC(), { hour: "numeric", minute: "2-digit", ...(PREFS.clock === "12" ? { hour12: true } : {}) });
}

// ---- money in the home currency -------------------------------------------------------
// Pay is converted to GBP when it's saved, and kept that way; it's shown in
// the home currency (Settings → Appearance), at one rate from GBP.

/** The home currency, while hunt has a rate for it; GBP until then. */
const HOME = () => (PREFS.currency && PREFS.currency_rate ? PREFS.currency : "GBP");

/** A GBP amount in the home currency. */
const fromGbp = (n) => (n == null ? null : HOME() === "GBP" ? n : n / PREFS.currency_rate);

/** An application's (or card's) pay in the home currency: [min, max], or null. */
function homePay(a) {
  const cur = (a.currency || "").toUpperCase();
  if (a.salary_min == null && a.salary_max == null) return null;
  if (!cur || cur === HOME()) return [a.salary_min, a.salary_max];
  if (cur === "GBP") return [fromGbp(a.salary_min), fromGbp(a.salary_max)];
  if (a.salary_min_gbp == null && a.salary_max_gbp == null) return null;
  return [fromGbp(a.salary_min_gbp), fromGbp(a.salary_max_gbp)];
}

/** A currency's symbol where it has a well-known one, else its code. */
const curSym = (code) => ({ GBP: "£", USD: "$", EUR: "€", JPY: "¥", INR: "₹" })[(code || "").toUpperCase()];

/** An amount in the home currency, short: £150k, €95k, CHF 120k. */
function homeK(n) {
  if (n == null) return "—";
  const v = n >= 10000 ? `${Math.round(n / 1000)}k` : Math.round(n).toLocaleString(LOC());
  const sym = curSym(HOME());
  return ltr(sym ? `${sym}${v}` : `${HOME()} ${v}`);
}
const tagColor = (name) => TAGS.find((t) => t.name.toLowerCase() === String(name).toLowerCase())?.color || "";
/** Tags as a list of names, from a record (an array) or a card (joined by |). */
const tagNames = (v) => (Array.isArray(v) ? v : v ? String(v).split("|") : []);
/** The shades a tag's hue comes in, lightest first; "light" is the hue's own name (`green`), the others a suffix (`green-deep`). */
const TAG_SHADES = ["pale", "light", "bold", "deep"];
/** A tag colour's hue and shade: `green-deep` → ["green", "deep"], `green` → ["green", "light"]. */
const tagHueShade = (color) => {
  const [hue, shade = "light"] = String(color || "").split("-");
  return [hue, shade];
};
/** A tag chip (or a swatch) in a colour (style.css draws each hue and shade); plain is the design system's neutral. */
function paintTag(el, color) {
  const [hue, shade] = tagHueShade(color);
  if (color && META.tag_colors.some((c) => c.value === color)) Object.assign(el.dataset, { hue, shade });
  else { delete el.dataset.hue; delete el.dataset.shade; }
  return el;
}
/** A tag: the design system's, in its colour. It knows its name, to be repainted when that changes. */
const tagChip = (name, extra = null) =>
  paintTag(h("span.al-tag", { dataset: { tag: String(name).toLowerCase() } }, name, extra), tagColor(name));

/** A tag whose name opens its colours (tagColours); `onChange(color)` once one is chosen. */
function colourTagChip(name, extra = null, onChange = null) {
  const chip = tagChip(name, extra);
  const tag = TAGS.find((t) => t.name.toLowerCase() === String(name).toLowerCase());
  if (!tag) return chip;
  chip.replaceChild(h("button.tag-colour", {
    type: "button", "aria-haspopup": "true", "aria-expanded": "false", "aria-label": `Colour of ${name}`, title: "Change colour",
    onclick: (e) => tagColours(tag, e.currentTarget, onChange),
  }, name), chip.firstChild);
  return chip;
}

/**
 * A tag's colours, laid out as Gmail lays out a label's: a popover beside
 * `anchor` of swatches, each a small copy of the tag in that colour. A
 * column is a hue, palest at the top, deepest at the foot; the wheel runs
 * in two bands, then Plain. Above them, the tag as it would look and the
 * colour's name, for the swatch pointed at or focused. Choosing saves it
 * and repaints the tag wherever it shows. Arrow keys move, Enter chooses.
 */
let tagColoursPop = null;
let tagColoursAt = null;
function tagColours(tag, anchor, onChange) {
  const key = tag.name.toLowerCase();
  // A click on what opened it closes it (the click lands after the popover's own light dismiss).
  if (tagColoursAt?.anchor === anchor && performance.now() - tagColoursAt.closed < 300) return;
  if (!tagColoursPop) {
    tagColoursPop = h("div.al-menu.tag-colours", { popover: "auto" });
    document.body.append(tagColoursPop);
    const close = () => tagColoursPop.hidePopover();
    tagColoursPop.addEventListener("toggle", (e) => {
      const opening = e.newState === "open";
      tagColoursAt.anchor.setAttribute("aria-expanded", String(opening));
      if (opening) {
        addEventListener("resize", close);
        addEventListener("scroll", close, { capture: true, passive: true });
        return;
      }
      removeEventListener("resize", close);
      removeEventListener("scroll", close, { capture: true });
      tagColoursAt.closed = performance.now();
      if ((tagColoursPop.contains(document.activeElement) || document.activeElement === document.body) && tagColoursAt.anchor.isConnected) {
        tagColoursAt.anchor.focus();
      }
    });
  }
  tagColoursAt = { anchor, closed: 0 };
  const current = tag.color || "";
  const choose = async (value) => {
    tagColoursPop.hidePopover();
    if (value === current || !(await attempt(() => patch(`tags/${tag.id}`, { color: value || null })))) return;
    tag.color = value || null;
    for (const t of TAGS) if (t.id === tag.id) t.color = tag.color;
    for (const el of document.querySelectorAll(".al-tag[data-tag]")) if (el.dataset.tag === key) paintTag(el, value);
    if (onChange) onChange(value);
  };
  // What a colour looks like on this tag, and its name.
  const preview = h("span.al-tag", { translate: "no" }, tag.name);
  const named = h("span.tag-colours-name");
  const show = (value) => {
    paintTag(preview, value);
    named.textContent = t(META.tag_colors.find((c) => c.value === value)?.label || "Plain");
  };
  const letter = [...tag.name][0] || "a";
  const choice = (value, label, el) => {
    el.setAttribute("role", "radio");
    el.setAttribute("aria-checked", String(value === current));
    el.setAttribute("aria-label", t(label));
    el.dataset.value = value;
    el.tabIndex = value === current ? 0 : -1;
    el.addEventListener("click", () => choose(value));
    return el;
  };
  const hues = [...new Set(META.tag_colors.map((c) => tagHueShade(c.value)[0]))];
  const half = Math.ceil(hues.length / 2);
  // A band of hues, a row per shade: left and right walk the wheel, up and down the shades.
  const band = (some) => h("div.tag-swatch-grid", { style: `--hues: ${some.length}` }, TAG_SHADES.flatMap((shade) => some.map((hue) => {
    const c = META.tag_colors.find((x) => x.value === (shade === "light" ? hue : `${hue}-${shade}`));
    return c ? choice(c.value, c.label, paintTag(h("button.al-tag.tag-swatch", { type: "button" },
      h("span", { translate: "no" }, c.value === current ? "✓" : letter)), c.value)) : h("span");
  })));
  const group = h("div.tag-swatches", { role: "radiogroup", "aria-label": `Colour of ${tag.name}` },
    band(hues.slice(0, half)), band(hues.slice(half)),
    h("hr.al-menu__separator"),
    choice("", "Plain", h("button.al-menu__item", { type: "button" }, "Plain")));
  // The name follows the pointer, else the focus, else what it is now.
  const pointed = (e) => e.target.closest?.('[role="radio"]');
  group.addEventListener("pointerover", (e) => { const r = pointed(e); if (r) show(r.dataset.value); });
  group.addEventListener("focusin", (e) => { const r = pointed(e); if (r) show(r.dataset.value); });
  group.addEventListener("pointerleave", () => {
    const r = group.contains(document.activeElement) ? document.activeElement : null;
    show(r ? r.dataset.value : current);
  });
  group.addEventListener("keydown", (e) => {
    const radios = [...group.querySelectorAll('[role="radio"]')];
    const here = radios.indexOf(document.activeElement);
    if (here < 0) return;
    const rtl = getComputedStyle(group).direction === "rtl";
    const at = radios[here].getBoundingClientRect();
    const mid = (b) => b.left + b.width / 2;
    const boxes = radios.map((el) => [el, el.getBoundingClientRect()]);
    let next = null;
    if (e.key === "Home") next = radios[0];
    else if (e.key === "End") next = radios.at(-1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      // Along its row; off its end, round to the other.
      const row = boxes.filter(([, b]) => b.top === at.top).map(([el]) => el);
      const i = row.indexOf(radios[here]) + ((e.key === "ArrowRight") !== rtl ? 1 : -1);
      next = row[(i + row.length) % row.length];
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      // The nearest row that way, and in it the swatch nearest the same column.
      const down = e.key === "ArrowDown";
      const that = boxes.filter(([, b]) => (down ? b.top >= at.bottom : b.bottom <= at.top));
      if (that.length) {
        const row = (down ? Math.min : Math.max)(...that.map(([, b]) => b.top));
        next = that.filter(([, b]) => b.top === row)
          .sort(([, a], [, b]) => Math.abs(mid(a) - mid(at)) - Math.abs(mid(b) - mid(at)))[0][0];
      }
    }
    if (!next) return;
    e.preventDefault();
    for (const el of radios) el.tabIndex = el === next ? 0 : -1;
    next.focus();
  });
  show(current);
  tagColoursPop.replaceChildren(h("div.tag-colours-head", {}, preview, named), group);
  tagColoursPop.showPopover();
  window.ArabesquePosition.place(tagColoursPop, anchor.closest(".al-tag") || anchor);
  group.querySelector('[tabindex="0"]').focus();
}

/**
 * A record's tags, as chips to remove and a box to add (from the existing
 * tags, or a new one). Saves as it goes.
 */
function tagEditor(resource, rec, onChange) {
  let tags = tagNames(rec.tags);
  const chips = h("span.tag-chips");
  const save = async (next) => {
    const saved = await attempt(() => put(`${resource}/${rec.id}/tags`, { tags: next }));
    if (!saved) return;
    tags = saved;
    rec.tags = saved;
    // A new tag: learn of it, for suggestions and filters.
    if (saved.some((n) => !TAGS.some((t) => t.name.toLowerCase() === n.toLowerCase()))) TAGS = await get("tags");
    render();
    if (onChange) onChange(saved);
  };
  const box = combo({
    placeholder: "Add a tag…", label: "Add a tag", allowCreate: true,
    source: async (q) => TAGS
      .filter((t) => !tags.some((n) => n.toLowerCase() === t.name.toLowerCase()))
      .filter((t) => t.name.toLowerCase().includes(q.toLowerCase()))
      .map((t) => ({ value: t.name, label: t.name })),
    onPick: (it) => { box.input.value = ""; save([...tags, it.value]); },
  });
  box.input.addEventListener("keydown", (e) => {
    // Enter with nothing highlighted: add what's typed.
    if (e.key === "Enter" && !e.defaultPrevented && box.input.value.trim()) {
      e.preventDefault();
      const v = box.input.value.trim();
      box.input.value = "";
      save([...tags, v]);
    }
  });
  function render() {
    fill(chips, tags.map((t) => colourTagChip(t, h("button.al-tag__remove", {
      type: "button", "aria-label": `Remove tag ${t}`, title: "Remove",
      onclick: () => save(tags.filter((x) => x !== t)),
    }, "×"))));
  }
  render();
  box.classList.add("tag-add");
  return h("div.tag-editor", {}, h("span.tag-editor-label", {}, "Tags"), chips, box);
}

/** A select of tags to filter by; `onPick(name)` ("" for all). */
function tagFilter(current, onPick) {
  return h("select.tag-filter", { "aria-label": "Filter by tag", onchange: (e) => onPick(e.target.value) },
    h("option", { value: "" }, "All tags"),
    TAGS.map((t) => h("option", { value: t.name, selected: t.name === current }, t.name)));
}

/** "2026-10-09" or "2026-10-09T15:00", as a local Date. */
function parseLocal(s) {
  if (!s) return null;
  const [d, t = "00:00"] = s.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [hh, mm] = t.split(":").map(Number);
  return new Date(y, m - 1, day, hh, mm);
}

function daysFromToday(date) {
  const a = zonedNow();
  a.setHours(0, 0, 0, 0);
  const b = new Date(date);
  b.setHours(0, 0, 0, 0);
  return Math.round((b - a) / 864e5);
}

/** A date for people: Today, Tomorrow, Fri, 9 Oct; with the time if set. */
function fmtDay(s) {
  const d = parseLocal(s);
  if (!d) return "";
  const n = daysFromToday(d);
  const thisYear = d.getFullYear() === zonedNow().getFullYear();
  let day;
  if (n === 0) day = "Today";
  else if (n === 1) day = "Tomorrow";
  else if (n === -1) day = "Yesterday";
  else if (n > 1 && n < 7) day = d.toLocaleDateString(LOC(), { weekday: "short" });
  else day = d.toLocaleDateString(LOC(), { day: "numeric", month: "short", year: thisYear ? undefined : "numeric" });
  const hasTime = s.includes("T") && !s.endsWith("T00:00");
  return hasTime ? `${day} ${fmtTime(s.slice(11, 16))}` : day;
}

/** A due date as a chip, red when overdue. */
function dueChip(s) {
  const n = daysFromToday(parseLocal(s));
  const cls = n < 0 ? "late" : n === 0 ? "today" : n <= 2 ? "soon" : "";
  const text = n < 0 ? `${-n}d overdue` : fmtDay(s);
  return h("span.due", { class: cls, title: s.replace("T", " ") }, text);
}

function fmtStamp(s) {
  if (!s) return "";
  return `${fmtDay(s.slice(0, 10))} ${fmtTime(s.slice(11, 16))}`;
}

/** A company's logo, or its initial in a square when it has none. */
function logoOf(companyId, logo, name, size = 28) {
  const box = h("span.logo", { style: `--size: ${size}px`, "aria-hidden": "true" });
  if (logo) box.append(h("img", { src: `/api/companies/${companyId}/logo?v=${logo.slice(0, 12)}`, alt: "", loading: "lazy" }));
  // The initial is drawn by CSS, so it isn't part of the name's text.
  else box.dataset.initial = (name || "?").trim().charAt(0).toUpperCase();
  return box;
}

/** A person's photo, round; their initial when there's none. */
function photoOf(personId, photo, name, size = 28) {
  const box = h("span.logo.round", { style: `--size: ${size}px`, "aria-hidden": "true" });
  if (photo) box.append(h("img", { src: `/api/people/${personId}/photo?v=${photo.slice(0, 12)}`, alt: "", loading: "lazy" }));
  else box.dataset.initial = (name || "?").trim().charAt(0).toUpperCase();
  return box;
}

/** Pay in the home currency, when the posting gave another: "≈ £93k–157k". */
function gbpLine(a) {
  if ((a.currency || "").toUpperCase() === HOME()) return null;
  const home = homePay(a);
  if (!home) return null;
  const pay = fmtMoney(home[0] == null ? null : Math.round(home[0]), home[1] == null ? null : Math.round(home[1]), HOME(), a.pay_period);
  return h("span.gbp", { title: a.gbp_rate != null ? `At ${a.gbp_rate.toFixed(4)} GBP per ${a.currency}, the rate on ${a.gbp_rate_on}` : "" }, `≈ ${pay}`);
}

/** Apply what an import chose to a company: the fields, then the logo, which is fetched. */
async function applyToCompany(companyId, fields) {
  const { logo, ...rest } = fields;
  if (Object.keys(rest).length && !(await attempt(() => patch(`companies/${companyId}`, rest)))) return false;
  if (logo && !(await attempt(() => post(`companies/${companyId}/logo/fetch`, { url: logo })))) return false;
  return true;
}

/** The company with this name, found or made, with its LinkedIn page if new. */
async function companyNamed(name, linkedin) {
  const found = (await get(`companies?q=${enc(name)}`)).find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (found) return found;
  return post("companies", linkedin ? { name, linkedin } : { name });
}

/** Apply what a profile import chose to a person: the fields, their company (by name), then the photo. */
async function applyToPerson(personId, fields, found) {
  const { photo, company, ...rest } = fields;
  return attempt(async () => {
    if (company) rest.company_id = (await companyNamed(company, found.company_linkedin)).id;
    if (Object.keys(rest).length) await patch(`people/${personId}`, rest);
    if (photo) await post(`people/${personId}/photo/fetch`, { url: photo });
    return true;
  });
}

/**
 * The person a LinkedIn profile is about: the one already kept with that
 * profile (filling in what they're missing), or a new one.
 */
async function personFromProfile(found) {
  const existing = found.linkedin ? (await get(`people?linkedin=${enc(found.linkedin)}`))[0] : null;
  const fields = {};
  for (const k of ["name", "title", "location", "linkedin", "about"]) if (found[k] && !(existing && existing[k])) fields[k] = found[k];
  if (found.company && !(existing && existing.company_id)) fields.company_id = (await companyNamed(found.company, found.company_linkedin)).id;
  const person = existing
    ? (Object.keys(fields).length ? await patch(`people/${existing.id}`, fields) : existing)
    : await post("people", fields);
  if (found.photo && !person.photo) {
    try { await post(`people/${person.id}/photo/fetch`, { url: found.photo }); } catch { /* no photo, no fuss */ }
  }
  return person;
}

const looksLikeProfile = (s) => /linkedin\.com\/in\//i.test(s);

/** After an import names a logo, fetch it for the company if it has none. */
async function logoFromImport(companyId, url) {
  if (!url || !companyId) return;
  try {
    const c = await get(`companies/${companyId}`);
    if (!c.logo) await post(`companies/${companyId}/logo/fetch`, { url });
  } catch { /* a logo that can't be had isn't worth a fuss */ }
}

function fmtMoney(min, max, currency, period) {
  if (min == null && max == null) return "";
  const sym = curSym(currency);
  // 150000 → 150k; 101856 → 101.9k; small amounts (hourly pay) as they are.
  const k = (n) => {
    if (n < 10000) return Math.round(n).toLocaleString(LOC());
    const t = n / 1000;
    return `${Number.isInteger(t) ? t : t.toFixed(1).replace(/\.0$/, "")}k`;
  };
  const m = (n) => (sym ? sym + k(n) : k(n));
  // A range, or one figure when it's fixed (or only one end is given).
  const range = min != null && max != null && min !== max ? `${m(min)}–${k(max)}` : m(min ?? max);
  const per = period ? { year: "/yr", month: "/mo", day: "/day", hour: "/hr" }[period] : "";
  return ltr(`${range}${sym || !currency ? "" : " " + currency}${per}`);
}

/** Text that reads left to right (an amount: £85k–100k/yr), kept whole on a right-to-left page. */
const ltr = (s) => (document.documentElement.dir === "rtl" && s ? `\u2066${s}\u2069` : s);

// ---- controls ------------------------------------------------------------------

let uid = 0;
const newId = () => `f${++uid}`;

/**
 * A text input with suggestions. `source(q)` resolves to items
 * {value, label, hint?}. With `allowCreate`, typing a new name offers to
 * add it ({create: true, value: text}).
 */
function combo({ value = "", placeholder, source, allowCreate = false, onPick, onInput, id, label, required }) {
  const listId = newId();
  const input = h("input", {
    type: "text", value, placeholder, id, required, autocomplete: "off", role: "combobox",
    "aria-autocomplete": "list", "aria-expanded": "false", "aria-controls": listId, "aria-label": label,
  });
  const list = h("ul.combo-list", { id: listId, role: "listbox", hidden: true });
  const wrap = h("div.combo", {}, input, list);
  let items = [];
  let active = -1;
  let timer = null;
  let seq = 0;

  async function refresh() {
    const q = input.value.trim();
    const mine = ++seq;
    let found = [];
    try {
      found = await source(q);
    } catch {
      found = [];
    }
    if (mine !== seq) return;
    items = found.slice(0, 12);
    if (allowCreate && q && !items.some((i) => String(i.label).toLowerCase() === q.toLowerCase())) {
      items.push({ create: true, value: q, label: `Add “${q}”` });
    }
    active = -1;
    render();
  }
  function render() {
    list.replaceChildren(
      ...items.map((it, i) =>
        h("li", {
          role: "option", id: `${listId}-${i}`, class: [i === active ? "active" : "", it.create ? "create" : ""].join(" "),
          "aria-selected": i === active ? "true" : "false",
          onmousedown: (e) => { e.preventDefault(); pick(it); },
        }, h("span.combo-item", {}, it.icon ? it.icon.cloneNode(true) : null, it.label), it.hint ? h("small", {}, it.hint) : null),
      ),
    );
    const open = items.length > 0 && document.activeElement === input;
    list.hidden = !open;
    input.setAttribute("aria-expanded", String(open));
    if (active >= 0) input.setAttribute("aria-activedescendant", `${listId}-${active}`);
    else input.removeAttribute("aria-activedescendant");
  }
  function pick(it) {
    input.value = it.create ? it.value : it.label;
    items = [];
    render();
    if (onPick) onPick(it);
  }
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, 120);
    if (onInput) onInput(input.value);
  });
  input.addEventListener("focus", refresh);
  input.addEventListener("blur", () => setTimeout(() => { items = []; render(); }, 120));
  input.addEventListener("keydown", (e) => {
    if (list.hidden || !items.length) return;
    if (e.key === "ArrowDown") { active = (active + 1) % items.length; render(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = (active - 1 + items.length) % items.length; render(); e.preventDefault(); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(items[active]); }
    else if (e.key === "Escape") { items = []; render(); e.preventDefault(); e.stopPropagation(); }
  });
  wrap.input = input;
  return wrap;
}

/** One of the design system's icons (its sprite, vendored), for its components. */
function systemIcon(name, cls = "al-icon") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `/vendor/arabesque/dist/icons.svg#al-icon-${name}`);
  svg.append(use);
  return svg;
}

/**
 * A notice in the page, the design system's: "danger" for an error (only
 * for errors), "warning", "success" or "info"; its icon says the kind too,
 * so it isn't told by colour alone. Its words go in `.body`.
 */
function notice(kind, attrs, ...content) {
  const body = h("div.al-notice__body", {}, ...content);
  const el = h(`div.al-notice.al-notice--${kind}`, attrs, systemIcon(kind), body);
  el.body = body;
  return el;
}

/**
 * A button that's working (saving, reading, syncing): the design system's
 * busy button, with its spinner, rather than a disabled one, so it keeps
 * its look and its place in the tab order. It takes no clicks while busy;
 * a handler it calls by Enter or Space should check `isBusy` first.
 */
function busy(button, on = true) {
  if (!button) return;
  if (on) button.setAttribute("aria-busy", "true");
  else button.removeAttribute("aria-busy");
}
const isBusy = (button) => button?.getAttribute("aria-busy") === "true";

/**
 * A search field, the design system's: its icon, and Clear once there's
 * text (Escape clears it too), which empties it as typing would.
 */
function searchBox(input) {
  const clear = () => { input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true })); input.focus(); };
  input.addEventListener("keydown", (e) => { if (e.key === "Escape" && input.value) { e.preventDefault(); e.stopPropagation(); clear(); } });
  return h("div.al-search", {}, systemIcon("search"), input,
    h("button.al-search__clear", { type: "button", "aria-label": "Clear search", title: "Clear search", onclick: clear }, systemIcon("close", "al-icon al-icon--sm")));
}

/**
 * A page or region with nothing in it, the design system's empty state: why
 * it's empty, and the one thing to do next, if there's one.
 */
function emptyState(title, text, action = null) {
  return h("div.al-empty", {}, h("p.al-empty__title", {}, title), text ? h("p.al-empty__text", {}, text) : null, action);
}

/**
 * A date field: the design system's date picker, so its calendar is in
 * hunt's language and digits (the browser's own date field follows the
 * browser's). Typed day first, in either digit set, or chosen from the
 * calendar. `onChange` gets an ISO date, or null when it's cleared; a date
 * that can't be read calls `onBad` instead, so it isn't saved as nothing.
 * Without the picker (its module didn't load), the browser's date field.
 */
function datePicker({ id, value, label, onChange, onBad }) {
  if (!window.ArabesqueDates) {
    const input = h("input", { id, type: "date", value: value ?? "", "aria-label": label || null });
    input.addEventListener("change", () => onChange(input.value || null));
    input.input = input;
    return input;
  }
  const input = h("input", { id, value: value ?? "", "aria-label": label || null, autocomplete: "off", dataset: { alDatePicker: "" } });
  const wrap = h("div.al-date-picker", {}, input,
    h("button.al-button.al-button--icon.al-date-picker__toggle", { type: "button", "aria-label": "Choose date", title: "Choose date" }, systemIcon("calendar")));
  const [picker] = window.ArabesqueDates.initDatePickers(wrap, {
    lang: () => LANG,
    numerals: () => (DIGITS === "arab" ? "arab" : "latn"),
    labels: () => ({ previous: t("Previous month"), next: t("Next month") }),
  });
  input.addEventListener("change", () => {
    if (input.value.trim() && !picker.value) onBad?.();
    else onChange(picker.value);
  });
  wrap.input = input;
  return wrap;
}

const refSource = (resource, extra = "") => async (q) =>
  (await get(`${resource}?limit=12&q=${enc(q)}${extra}`)).map((r) => ({
    value: r.id, label: r.label,
    icon: resource === "companies" ? logoOf(r.id, r.logo, r.name, 18) : null,
  }));
const suggestSource = (resource, field) => async (q) =>
  (await get(`suggest/${resource}/${field}?q=${enc(q)}`)).map((v) => ({ value: v, label: v }));

/**
 * An editor for one field, built from its description in /api/meta.
 * `save(value)` is called with the new value (null when cleared) and may
 * return a promise; failures show next to the field. With `quiet`, saving
 * isn't announced (for forms that create on submit). `label` overrides the
 * field's own (as inside a group).
 */
function fieldControl(resource, field, value, save, { quiet = false, label } = {}) {
  const id = newId();
  // Under the field: the design system's save state (Saving…, Saved), or
  // its error when a value can't be saved, tied to the control.
  const status = h("p.al-save-state", { id: `${id}-status`, role: "status" });
  const wrap = h("div.field", { class: `type-${field.type}`, dataset: { field: field.name } });
  const placeholder = field.placeholder || null;
  const input = () => control?.input || control;
  const say = (state, text) => {
    status.className = "al-save-state";
    if (state) status.dataset.state = state;
    else delete status.dataset.state;
    status.textContent = text;
  };
  const fail = (message) => {
    wrap.classList.add("bad");
    status.className = "al-error";
    delete status.dataset.state;
    fill(status, systemIcon("danger", "al-icon al-icon--sm"), message);
    input()?.setAttribute?.("aria-invalid", "true");
    input()?.setAttribute?.("aria-describedby", status.id);
  };
  const commit = async (v) => {
    if (v === "") v = null;
    if (!quiet) say("saving", "Saving…");
    try {
      await save(v);
      wrap.classList.remove("bad");
      input()?.removeAttribute?.("aria-invalid");
      input()?.removeAttribute?.("aria-describedby");
      if (quiet) say(null, "");
      else {
        say("saved", "Saved");
        setTimeout(() => { if (status.dataset.state === "saved") say(null, ""); }, 1500);
      }
      refreshOpen();
    } catch (e) {
      fail(e.message);
    }
  };
  let control;
  // A link beside a URL field, to open what it points at.
  let open = null;
  const refreshOpen = () => {
    if (!open) return;
    const v = (control.value || "").trim();
    open.hidden = !/^https?:\/\//.test(v);
    open.href = v;
  };
  switch (field.type) {
    case "long-text":
      control = h("textarea", { id, placeholder, rows: field.name === "description" ? 8 : 3 });
      control.value = value ?? "";
      control.addEventListener("change", () => commit(control.value));
      break;
    case "number":
      // Text, so "150k" can be typed; the service reads it.
      control = h("input", { id, type: "text", inputmode: "decimal", placeholder, value: value ?? "" });
      control.addEventListener("change", () => commit(control.value));
      break;
    case "date":
      control = datePicker({ id, value, onChange: commit, onBad: () => fail(t("Enter a date, day first, like 30/11/2026")) });
      break;
    case "date-time":
    case "url":
    case "email": {
      const type = { "date-time": "datetime-local", url: "url", email: "email" }[field.type];
      control = h("input", { id, type, placeholder, value: value ?? "", step: type === "datetime-local" ? 900 : null });
      control.addEventListener("change", () => commit(control.value));
      if (field.type === "url") {
        open = h("a.open-link", { target: "_blank", rel: "noreferrer", title: "Open in a new tab" }, "Open ↗");
      }
      break;
    }
    case "enum":
      control = h("select", { id },
        field.required ? null : h("option", { value: "" }, "Not set"),
        field.options.map(([v, l]) => h("option", { value: v, selected: v === value }, l)));
      control.addEventListener("change", () => commit(control.value));
      break;
    case "choice":
      control = h("select", { id },
        field.required ? null : h("option", { value: "" }, "Not set"),
        choicesOf(field.resource).map((c) => h("option", { value: c.value, selected: c.value === value }, c.label)));
      control.addEventListener("change", () => commit(control.value));
      break;
    case "ref": {
      if (field.resource === "stages") {
        // Short lists: a plain select.
        control = h("select", { id }, field.required ? null : h("option", { value: "" }, "Not set"));
        get(field.resource).then((rows) => {
          for (const r of rows) control.append(h("option", { value: r.id, selected: r.id === value }, r.label));
        });
        control.addEventListener("change", () => commit(control.value ? Number(control.value) : null));
        break;
      }
      let current = value;
      let shown = "";
      const what = (R(field.resource)?.title || "").toLowerCase();
      const box = combo({
        id, placeholder: `Search ${what}…`, source: refSource(field.resource),
        allowCreate: field.resource === "companies",
        onPick: async (it) => {
          if (it.create) {
            const made = await attempt(() => post("companies", { name: it.value }));
            if (!made) return;
            it = { value: made.id, label: made.label };
            toast(`Added company ${made.label}`);
          }
          current = it.value;
          shown = it.label;
          commit(it.value);
        },
      });
      if (value != null) {
        get(`${field.resource}/${value}`).then((r) => { shown = r.label; box.input.value = r.label; }).catch(() => {});
      }
      box.input.addEventListener("blur", () => setTimeout(() => {
        if (box.input.value.trim() === "" && current != null && !field.required) {
          current = null;
          shown = "";
          commit(null);
        } else {
          box.input.value = shown;
        }
      }, 150));
      control = box;
      break;
    }
    default:
      if (field.suggest) {
        const box = combo({ id, value: value ?? "", placeholder, source: suggestSource(resource, field.name), onPick: (it) => commit(it.value) });
        box.input.addEventListener("change", () => commit(box.input.value));
        control = box;
      } else {
        control = h("input", { id, type: "text", placeholder, value: value ?? "" });
        control.addEventListener("change", () => commit(control.value));
      }
  }
  const required = field.required && !field.defaulted;
  wrap.append(
    h("label", { for: id }, label || field.label, required ? h("span.req", { title: "required" }, " *") : null, open),
    control,
    status,
  );
  refreshOpen();
  return wrap;
}

/**
 * Field editors in the resource's order, with grouped fields (a salary's
 * from, to, currency and period) set together under their group's name.
 * `make(field, label)` builds each editor.
 */
function fieldLayout(fields, make) {
  const out = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (!f.group) { out.push(make(f)); continue; }
    const members = [];
    while (i < fields.length && fields[i].group === f.group) members.push(fields[i++]);
    i--;
    out.push(h("fieldset.group", {}, h("legend", {}, f.group),
      h("div.group-fields", { style: `--n: ${members.length}` }, members.map((m) => make(m, m.short)))));
  }
  return out;
}

/** Edit a record in place: every field saves as it changes. */
function recordEditor(resource, record, { only, skip = [], onSaved } = {}) {
  const r = R(resource);
  const fields = r.fields.filter((f) => (!only || only.includes(f.name)) && !skip.includes(f.name) && !f.readonly);
  if (only) fields.sort((a, b) => only.indexOf(a.name) - only.indexOf(b.name));
  return h("div.fields", {},
    fieldLayout(fields, (f, label) =>
      fieldControl(r.name, f, record[f.name], async (v) => {
        const saved = await patch(`${r.name}/${record.id}`, { [f.name]: v });
        Object.assign(record, saved);
        if (onSaved) onSaved(saved, f.name);
      }, { label })));
}

/** The fields each kind of record asks for first; the rest wait under "More details". */
const ESSENTIAL = {
  companies: ["name", "kind", "website", "linkedin"],
  people: ["name", "company_id", "title", "email"],
  steps: ["title", "at"],
  stages: ["name"],
  documents: ["name", "kind"],
};

/**
 * A form that creates a record on submit. Required fields and the
 * essentials come first; anything else is folded away. Problems show in the
 * form, not just a toast, and the button waits while saving.
 */
function createForm(resource, initial = {}, { only, onCreated, submitLabel } = {}) {
  const r = R(resource);
  const values = { ...initial };
  const fields = r.fields.filter((f) => (only ? only.includes(f.name) : !(f.name in initial)));
  const essential = only || ESSENTIAL[r.name] || fields.map((f) => f.name);
  const first = fields.filter((f) => (f.required && !f.defaulted) || essential.includes(f.name));
  const rest = fields.filter((f) => !first.includes(f));
  const make = (f, label) => fieldControl(r.name, f, values[f.name], (v) => { values[f.name] = v; }, { quiet: true, label });
  const problem = notice("danger", { role: "alert", hidden: true, class: "form-error" });
  const submit = h("button.al-button.al-button--primary", { type: "submit" }, submitLabel || `Add ${r.entity}`);
  const form = h("form.create", {
    onsubmit: async (e) => {
      e.preventDefault();
      // Text typed into a field but not yet "changed" still counts.
      form.querySelectorAll("input, textarea, select").forEach((c) => { if (document.activeElement === c) c.dispatchEvent(new Event("change", { bubbles: true })); });
      if (isBusy(submit)) return;
      problem.hidden = true;
      busy(submit);
      try {
        const made = await post(r.name, values);
        if (onCreated) onCreated(made);
      } catch (err) {
        problem.body.textContent = err.message;
        problem.hidden = false;
      } finally {
        busy(submit, false);
      }
    },
  },
  h("div.fields", {}, fieldLayout(first, make)),
  rest.length ? h("details.al-disclosure.more", {}, h("summary", {}, "More details"), h("div.fields", {}, fieldLayout(rest, make))) : null,
  problem,
  h("div.actions", {}, submit));
  return form;
}

/**
 * A record to read: its filled fields as a list of label and value, with
 * enums, references, dates, links and money shown for people. Long text
 * comes after, as prose.
 */
function recordView(resource, record, { only, skip = [] } = {}) {
  const r = R(resource);
  const fields = r.fields.filter((f) => (!only || only.includes(f.name)) && !skip.includes(f.name) && !f.readonly);
  if (only) fields.sort((a, b) => only.indexOf(a.name) - only.indexOf(b.name));
  const facts = [];
  const prose = [];
  const shown = new Set();
  for (const f of fields) {
    if (shown.has(f.name)) continue;
    const v = record[f.name];
    if (f.group === "Salary") {
      for (const g of fields.filter((x) => x.group === "Salary")) shown.add(g.name);
      const pay = fmtMoney(record.salary_min, record.salary_max, record.currency, record.pay_period);
      if (pay) {
        const dd = h("dd", {}, pay);
        const gbp = gbpLine(record);
        if (gbp) dd.append(" ", gbp);
        if (resource === "applications" && record.currency && record.currency !== "GBP") {
          dd.append(" ", h("button.al-button.al-button--sm.al-button--quiet", { type: "button", title: "Convert again at today's rate", onclick: async (e) => {
            const button = e.currentTarget;
            if (isBusy(button)) return;
            busy(button);
            const fresh = await attempt(() => post(`applications/${record.id}/gbp`, {}));
            if (fresh) {
              Object.assign(record, fresh);
              fill(dd, pay, " ", gbpLine(record) || h("span.muted", {}, "no rate"));
              toast(`Rate refreshed: ${fresh.gbp_rate?.toFixed(4)} on ${fresh.gbp_rate_on}`);
            }
            busy(button, false);
          } }, record.gbp_rate == null ? "Convert to GBP" : "Refresh rate"));
        }
        facts.push(h("dt", {}, "Salary"), dd);
      }
      continue;
    }
    if (v == null || v === "") continue;
    if (f.type === "long-text") {
      prose.push(h("section.prose-block", {}, h("h2", {}, f.label), h("div.prose", {}, v)));
      continue;
    }
    let shownValue;
    if (f.type === "enum") shownValue = optionLabel(f.options, v);
    else if (f.type === "choice") shownValue = choicesOf(f.resource).find((c) => c.value === v)?.label ?? v;
    else if (f.type === "date") shownValue = h("time", { datetime: v, title: v }, fmtDay(v));
    else if (f.type === "date-time") shownValue = h("time", { datetime: v, title: v.replace("T", " ") }, fmtDay(v));
    else if (f.type === "url") shownValue = h("a", { href: v, target: "_blank", rel: "noreferrer" }, v.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""), " ↗");
    else if (f.type === "email") shownValue = h("a", { href: `mailto:${v}` }, v);
    else if (f.type === "ref") {
      shownValue = h("span", {}, `#${v}`);
      get(`${f.resource}/${v}`).then((x) => {
        const page = routeOf(f.resource);
        fill(shownValue, page ? h("a", { href: `/${page}/${v}` }, x.label) : x.label);
      }).catch(() => {});
    } else shownValue = String(v);
    facts.push(h("dt", {}, f.label), h("dd", {}, shownValue));
  }
  return h("div.record-view", {}, facts.length ? h("dl.facts", {}, facts) : h("p.muted", {}, "Nothing filled in yet."), prose);
}

/**
 * A section that reads as a view, with an Edit button that turns it into
 * the form, and Done to go back. `view()` and `edit()` build each.
 */
function viewEdit({ title, view, edit, tools = [], startEditing = false }) {
  const body = h("div.view-edit-body");
  let editing = startEditing;
  const button = h("button.al-button.al-button--sm", { type: "button", onclick: () => { editing = !editing; render(); } });
  const head = h("div.panel-head", {}, h("h2", {}, title), h("div.panel-tools", {}, tools, button));
  function render() {
    button.textContent = editing ? "Done" : "Edit";
    button.setAttribute("aria-pressed", String(editing));
    fill(body, editing ? edit() : view());
    if (editing) body.querySelector("input, select, textarea")?.focus();
  }
  render();
  const section = h("section.al-panel.panel", {}, head, body);
  section.rerender = render;
  return section;
}

function openModal(content, { wide = false, onClose } = {}) {
  modal.replaceChildren(content);
  modal.className = wide ? "al-dialog wide" : "al-dialog al-dialog--md";
  modal.onClose = onClose;
  if (!modal.open) modal.showModal();
  // The cursor goes to the first field, unless something already has it.
  if (!modal.contains(document.activeElement) || document.activeElement === modal) {
    modal.querySelector("form input:not([type=hidden]), form select, form textarea")?.focus({ preventScroll: true });
  }
}
modal.addEventListener("close", () => {
  const f = modal.onClose;
  modal.onClose = null;
  modal.replaceChildren();
  if (f) f();
});
modal.addEventListener("click", (e) => { if (e.target === modal) modal.close(); });

/** A small question in its own dialog, over whatever is open. Resolves to the form's data, or null. */
function ask({ title, body, ok = "OK", danger = false }) {
  const dlg = h("dialog.al-dialog.ask");
  const form = h("form", { method: "dialog" },
    h("h2.al-dialog__title", {}, title),
    body,
    h("div.al-dialog__actions", {},
      h("button.al-button", { type: "button", onclick: () => dlg.close() }, "Cancel"),
      h("button.al-button", { type: "submit", class: danger ? "al-button--danger al-button--primary" : "al-button--primary" }, ok)));
  dlg.append(form);
  document.body.append(dlg);
  dlg.showModal();
  return new Promise((resolve) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      resolve(new FormData(form));
      dlg.close();
    });
    dlg.addEventListener("close", () => { dlg.remove(); resolve(null); });
  });
}

async function confirmDelete(what, detail) {
  return (await ask({ title: `Delete ${what}?`, body: h("p", {}, detail || "This can't be undone, though the activity log keeps a record of it."), ok: "Delete", danger: true })) !== null;
}

/**
 * Where an application can close: each inactive stage, with its lanes (the
 * reasons), or the stage itself where it has none. A choice's value is a
 * reason's code, or `stage:` and the stage's id.
 */
function closingChoices() {
  return (META.closed_stages || []).map((st) => {
    const lanes = META.archive_reasons.filter((r) => r.stage_id === st.id);
    return { stage: st, choices: lanes.length ? lanes.map((r) => [r.value, r.label]) : [[`stage:${st.id}`, st.name]] };
  });
}

/** What closing for a choice sends: to a reason's lane, or into an inactive stage. */
const closingBody = (choice, note) => (choice.startsWith("stage:")
  ? { stage_id: Number(choice.slice(6)), archive_note: note }
  : { status: "archived", archive_reason: choice, archive_note: note });

/** Said of a closing: its reason, or the inactive stage it went to. */
const closingLabel = (body) => (body.archive_reason ? archiveReason(body.archive_reason)
  : (META.closed_stages || []).find((st) => st.id === body.stage_id)?.name || "Closed");

/** Ask why an application is being closed (and, given the stage it reached, say what it keeps). */
async function askArchive(name, stage = null) {
  const groups = closingChoices();
  let first = true;
  const radio = ([value, label]) => {
    const on = first;
    first = false;
    return h("label", {}, h("input", { type: "radio", name: "reason", value, required: true, checked: on }), h("span.al-choice__text", {}, label));
  };
  const data = await ask({
    title: `Close ${name}`,
    body: h("div.al-dialog__body", {},
      // One inactive stage: its reasons; several: each with its own.
      groups.length > 1
        ? groups.map((g) => h("fieldset.al-fieldset", {}, h("legend", {}, g.stage.name), h("div.al-choices", {}, g.choices.map(radio))))
        : h("fieldset.al-fieldset", {}, h("legend", {}, "Why?"), h("div.al-choices", {}, (groups[0]?.choices || []).map(radio))),
      h("div.field", {}, h("label", { for: "archive-note" }, "Note ", h("span.al-label__optional", {}, "(optional)")),
        h("input", { id: "archive-note", name: "note", placeholder: "e.g. went with an internal candidate" })),
      h("p.muted.small", {}, stage
        ? `It keeps the stage it reached (${stage}) and its timeline. You can bring it back from Closed.`
        : "Each keeps the stage it reached and its timeline. You can bring them back from Closed.")),
    ok: `Close ${name}`,
  });
  return data && closingBody(data.get("reason"), data.get("note") || null);
}

// ---- the board ---------------------------------------------------------------

/** The board's address in the API: the cycle shown. */
function boardQuery() {
  const q = new URLSearchParams();
  const c = currentCycle();
  if (c) q.set("cycle", c.id);
  return q.toString();
}

async function loadBoard() {
  BOARD = await get(`board?${boardQuery()}`);
  return BOARD;
}

async function showBoard() {
  const y = window.scrollY;
  await loadBoard();
  redrawBoard();
  window.scrollTo(0, y);
}

/** The board's stages hidden from it (by id), remembered in this browser. */
function hiddenStages() {
  try { return new Set(JSON.parse(stored("hiddenStages") || "[]")); } catch { return new Set(); }
}
function setStageHidden(id, hide) {
  const set = hiddenStages();
  if (hide) set.add(id); else set.delete(id);
  store("hiddenStages", JSON.stringify([...set]));
  showBoard();
}

/** Whether cards show everything ("detailed", the default) or just company, role and what's next. */
const cardDetail = () => (stored("cardView") === "compact" ? "compact" : "detailed");

/** Whether the board shown is an ended cycle's, kept as it was. */
const boardReadOnly = () => !!BOARD?.read_only;

/** A reminder or step's time has passed: a day before today, or a time before now. */
function isOverdue(at) {
  if (!at) return false;
  const d = parseLocal(at);
  return at.length > 10 && !at.endsWith("T00:00") ? d < zonedNow() : daysFromToday(d) < 0;
}

/**
 * What's next on a card: its soonest open reminder or scheduled step, as
 * {title, at, overdue, text}; null with neither.
 */
function nextOf(c) {
  const all = [
    c.reminder ? { title: c.reminder, at: c.reminder_at, kind: "reminder" } : null,
    c.next_step ? { title: c.next_step, at: c.next_step_at, kind: "step" } : null,
  ].filter(Boolean).sort((a, b) => (a.at || "9").localeCompare(b.at || "9"));
  const n = all[0];
  if (!n) return null;
  n.overdue = n.kind === "reminder" && isOverdue(n.at);
  const late = n.overdue ? -daysFromToday(parseLocal(n.at)) : 0;
  n.when = n.overdue ? (late > 1 ? `${late} days overdue` : late === 1 ? "a day overdue" : "overdue") : n.at ? fmtDay(n.at) : null;
  n.text = n.when ? `${n.title}, ${n.when}` : n.title;
  return n;
}

/** What's next, to show: its title as written, then when, in the page's language. */
const nextLabel = (n) => [h("span", { translate: "no" }, n.title), n.when ? [", ", h("span", {}, n.when)] : null];

/** Parts joined by middle dots, each its own phrase (for translating); data marked as written. */
const dotted = (parts) => parts.filter(Boolean).flatMap((p, i) => [i ? " · " : null, typeof p === "string" ? h("span", {}, p) : p]);

/** The board's head: its name, what it shows, and what to do. */
function boardHead(b, current) {
  const cur = currentCycle();
  const run = runningCycles();
  const total = b.stages.reduce((n, s) => n + s.cards.length, 0);
  const sub = b.read_only
    ? `${total} on the board · ${b.archived_total} closed`
    : cur ? `${cur.name} · week ${cycleWeek(cur)} · ${total} active · ${b.archived_total} closed`
      : run.length > 1 ? `${run.length} cycles · ${total} active · ${b.archived_total} closed` : "";
  return h("header.al-page-head.board-head", {},
    h("h1", {}, "Tracking board"),
    sub ? h("p.board-count", {}, sub) : null,
    h("div.al-page-head__end", {},
      cur && !b.read_only ? h("button.al-button.al-button--quiet", { type: "button", onclick: () => endCycle(cur) }, icon("flag"), h("span", {}, "End this cycle…")) : null,
      run.length || b.read_only ? viewSwitch(current) : null,
      run.length && !b.read_only ? h("button.al-button.al-button--primary", { type: "button", onclick: () => newApplication(), "aria-keyshortcuts": "n" },
        icon("plus"), h("span", {}, "Add application"), h("kbd.al-kbd.board-kbd", { "aria-hidden": "true" }, "N")) : null));
}

/** Above the board: an ended cycle's notice, or none running; and which running cycle to show. */
function boardContext(b) {
  const viewing = viewedCycle();
  const run = runningCycles();
  if (viewing) {
    const back = cycleById(boardCycle());
    return notice("info", { class: "board-viewing" },
      h("div.al-notice__title", {}, `${viewing.name}, ended ${longDate(viewing.ended_on)}`),
      h("div.small", {}, "Read-only, exactly as it was when it ended.", viewing.outcome_note ? [" ", h("span", { translate: "no" }, viewing.outcome_note), "."] : null),
      h("div.al-notice__actions", {},
        h("a.al-button.al-button--sm", { href: "/" }, back ? `Back to ${back.name}` : run.length ? "Back to the board" : "Back to Cycles"),
        h("button.al-button.al-button--quiet.al-button--sm", { type: "button", onclick: () => resumeCycle(viewing) }, "Resume this cycle"),
        h("a.al-button.al-button--quiet.al-button--sm", { href: "/cycles" }, "All cycles")));
  }
  if (run.length > 1) {
    const chosen = boardCycle();
    return h("div.board-cycles", {}, h("span.al-label", {}, "Cycle"),
      h("div.al-segmented", { role: "group", "aria-label": "Cycle" },
        [{ id: "", name: "All active" }, ...run].map((c) => h("button", { type: "button", "aria-pressed": String(String(c.id) === chosen), onclick: () => pickCycle(c.id) },
          h("span", { translate: c.id ? "no" : null }, c.name), c.id ? h("span.al-badge.al-badge--accent", {}, "Active") : null))));
  }
  return null;
}

/**
 * No cycle running: a welcome, and starting the next one; past cycles in a
 * fold, a table of how each went.
 */
function noCycle() {
  const past = endedCycles();
  const outcomes = R("cycles").fields.find((f) => f.name === "outcome").options;
  const n = past.length;
  return h("div.board-welcome", {},
    h("div.al-empty.board-empty", {},
      h("h1.al-empty__title", {}, "Welcome!"),
      h("p.al-empty__text", {}, "Let's explore greener pastures, and start a new cycle!"),
      h("button.al-button.al-button--primary", { type: "button", onclick: () => startCycle() }, icon("plus"), h("span", {}, "Start a new cycle")),
      h("p.muted.small", {}, n === 0 ? "You've had no cycles before." : n === 1 ? "You've had 1 cycle before." : `You've had ${n} cycles before.`)),
    n ? h("details.al-disclosure.past-cycles", {},
      h("summary", {}, h("span", {}, "Past cycles"), h("span.al-badge.al-badge--count.al-badge--outline", {}, n)),
      h("div.al-disclosure__body", {},
        h("div.al-table-wrap", {}, h("table.al-table--interactive", {},
          h("thead", {}, h("tr", {},
            h("th", {}, "Cycle"), h("th", {}, "Ran"), h("th.al-table__num", {}, "Weeks"), h("th", {}, "How it ended"),
            h("th.al-table__num", {}, "Applied"), h("th.al-table__num", {}, "Interviewed"), h("th.al-table__num", {}, "Offers"),
            h("th", {}, h("span.al-visually-hidden", {}, "Actions")))),
          h("tbody", {}, past.map((c) => {
            const href = `/?cycle=${c.id}`;
            return h("tr", { tabindex: "0", onclick: (e) => { if (!e.target.closest("a")) go(href); }, onkeydown: (e) => { if (e.key === "Enter") go(href); } },
              h("td", {}, h("a", { href, translate: "no" }, c.name), c.outcome_note ? h("div.muted.small", { translate: "no" }, c.outcome_note) : null),
              h("td.nowrap", {}, `${longDate(c.started_on)} – ${longDate(c.ended_on)}`),
              h("td.al-table__num", {}, nf(cycleWeeks(c))),
              h("td", {}, h("span.al-badge", { class: c.outcome === "offer" ? "al-badge--success" : "al-badge--outline" }, optionLabel(outcomes, c.outcome || "other"))),
              h("td.al-table__num", {}, nf(c.counts.applied)),
              h("td.al-table__num", {}, nf(c.counts.interviewed)),
              h("td.al-table__num", {}, nf(c.counts.offers)),
              h("td", {}, h("button.al-button.al-button--quiet.al-button--sm", { type: "button", onclick: (e) => { e.stopPropagation(); resumeCycle(c); }, onkeydown: (e) => e.stopPropagation() }, "Resume")));
          })))),
        h("a.al-link.al-link--arrow", { href: "/cycles" }, "All about your cycles"))) : null);
}

function boardView(b) {
  const detail = cardDetail();
  if (!runningCycles().length && !b.read_only) {
    return h("div.board", {}, noCycle());
  }
  const detailed = h("label.switch", { title: "Show everything on each card" },
    h("input", { type: "checkbox", role: "switch", checked: detail === "detailed",
      onchange: (e) => { store("cardView", e.target.checked ? "detailed" : "compact"); showBoard(); } }),
    "Detailed");
  // Filters hide cards (in place, so dragging still lands where it should).
  const all = [...b.stages.flatMap((st) => st.cards), ...b.archived];
  boardRows = new Map(all.map((c) => [String(c.id), rowFromCard(c)]));
  const bar = filterBar([...boardRows.values()], readFilters(), () => applyBoardFilters(), { what: "processes", extra: detailed });
  return h("div.board", { class: [detail, b.read_only ? "read-only" : ""].join(" ") },
    boardHead(b, "board"),
    boardContext(b),
    bar,
    hiddenStagesBar(b),
    boardSwimlanes(b).map(swimlaneView),
    b.read_only ? null : (() => {
      // Selected cards (Ctrl/⌘-click): what to do with them, after them.
      const known = new Set([...b.stages.flatMap((s) => s.cards), ...b.archived].map((c) => c.id));
      for (const id of [...BOARD_SEL]) if (!known.has(id)) BOARD_SEL.delete(id);
      const sel = bulkBar({ what: "selected", clear: () => { BOARD_SEL.clear(); showBoard(); },
        actions: () => processActions(() => [...BOARD_SEL], b.stages, () => { BOARD_SEL.clear(); showBoard(); }) });
      sel.update(BOARD_SEL.size);
      return sel;
    })());
}

/**
 * On a phone, where a column is the screen's width: the stages as tabs above
 * them, the one in view marked, each going to its column.
 */
function stagePager(stages, columns) {
  const hidden = hiddenStages();
  const shown = stages.filter((st) => !hidden.has(st.id));
  const tabs = shown.map((st) => h("button", { type: "button", dataset: { stage: st.id },
    onclick: () => columns.querySelector(`.column[data-stage="${st.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" }) },
  h("span", {}, st.name), h("span.stage-pager-count", { "aria-label": `${st.cards.length} active` }, st.cards.length)));
  const pager = h("nav.stage-pager", { "aria-label": "Stages" }, tabs);
  // The column nearest the middle is the one in view.
  const mark = () => {
    const box = columns.getBoundingClientRect();
    const mid = box.left + box.width / 2;
    let at = null, best = Infinity;
    for (const col of columns.querySelectorAll(".column:not([hidden])")) {
      const r = col.getBoundingClientRect();
      const d = Math.abs(r.left + r.width / 2 - mid);
      if (d < best) { best = d; at = col.dataset.stage; }
    }
    // As tall as that column, not the tallest (only where the tabs show).
    const col = columns.querySelector(`.column[data-stage="${at}"]`);
    columns.style.blockSize = pager.offsetParent && col ? `${col.offsetHeight + 8}px` : "";
    for (const t of tabs) {
      const on = t.dataset.stage === at;
      if (on === (t.getAttribute("aria-current") === "true")) continue;
      t.setAttribute("aria-current", String(on));
      if (on) t.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  };
  let frame = 0;
  columns.addEventListener("scroll", () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(mark); }, { passive: true });
  requestAnimationFrame(mark);
  return pager;
}

/** The stages hidden from the board, to show again: above its columns. */
function hiddenStagesBar(b) {
  const hidden = hiddenStages();
  const gone = boardStages(b).filter((st) => hidden.has(st.id));
  return h("div.hidden-columns", { hidden: !gone.length },
    h("span.muted.small", {}, "Hidden:"),
    gone.map((st) => h("button.chip-button", { type: "button", title: `Show ${st.name}`, onclick: () => setStageHidden(st.id, false) },
      icon("eye"), st.name, h("span.muted", {}, ` ${st.cards.length}`))),
    gone.length > 1 ? h("button.al-button.al-button--sm.al-button--quiet", { type: "button", onclick: () => { store("hiddenStages", "[]"); showBoard(); } }, "Show all") : null);
}

// The board's cards, as rows the filters read, by card id.
let boardRows = new Map();

/** Hide the cards the filters leave out, and say how many are shown. */
function applyBoardFilters() {
  const f = readFilters();
  const board = document.querySelector(".board");
  if (!board) return;
  let shown = 0;
  for (const card of board.querySelectorAll(".card")) {
    const row = boardRows.get(card.dataset.id);
    const ok = !row || matchesFilters(row, f);
    card.hidden = !ok;
    shown += ok;
  }
  for (const col of board.querySelectorAll(".column")) {
    const count = col.querySelector(".count");
    if (count) count.textContent = col.querySelectorAll(".card:not([hidden])").length;
    for (const lane of col.querySelectorAll(".lane")) {
      lane.querySelector(".lane-count").textContent = lane.querySelectorAll(".card:not([hidden])").length;
    }
  }
  // A pile says how many of its cards the filters leave.
  for (const face of board.querySelectorAll(".pile-face:not(.empty) .pile-count")) {
    const pile = face.closest(".cards");
    const n = pile.querySelectorAll(".card:not([hidden])").length;
    face.textContent = activeFilters(f) && !n ? "None shown" : cardsCount(n);
  }
  for (const lane of board.querySelectorAll(".swimlane")) {
    const count = lane.querySelector(".swimlane-count");
    count.textContent = activeFilters(f) ? lane.querySelectorAll(".card:not([hidden])").length : count.dataset.total;
  }
  board.querySelector(".filter-bar")?.update(shown);
}

function columnView(stage, number) {
  const lanes = stage.lanes || [];
  const ro = boardReadOnly();
  // Cards in no lane: the column's top (all of it, when it isn't divided).
  const loose = stage.cards.filter((c) => c.lane_id == null || !lanes.some((l) => l.id === c.lane_id));
  const top = `${stage.id}:`;
  const keys = [top, ...lanes.map((l) => `${stage.id}:${l.id}`)];
  const folded = stageFolded(stage);
  const moveAll = (lane) => (ids) => bulkProcesses({ ids, action: "move", stage_id: stage.id, lane_id: lane }, () => BOARD_SEL.clear());
  // All of it folded: one pile, its sub stages in it; opened, its top
  // (and its sub stages, folded as they are).
  const whole = !keys.some((k) => packOpen(k, folded));
  let list, laneViews = [];
  if (whole) {
    list = h("ol.cards", { "aria-label": `${stage.name} cards` }, stage.cards.map(cardView));
    asPack(list, top, folded, stage.name);
    if (!ro) dropTarget(list, (id) => post(`processes/${id}/move`, { stage_id: stage.id }), moveAll(null));
  } else {
    list = h("ol.cards", { "aria-label": `${stage.name} cards`, class: lanes.length && !loose.length ? "unlaned empty" : lanes.length ? "unlaned" : "" }, loose.map(cardView));
    asPack(list, top, folded, stage.name, lanes.length > 0);
    if (!ro) dropTarget(list, (id) => post(`processes/${id}/move`, { stage_id: stage.id, index: indexOf(list), top: true }), moveAll(null));
    // Its lanes, top to bottom, each a place to drop cards.
    laneViews = lanes.map((l) => {
      const cards = stage.cards.filter((c) => c.lane_id === l.id);
      const ol = h("ol.cards", { "aria-label": `${stage.name}: ${l.name} cards` }, cards.map(cardView));
      const key = `${stage.id}:${l.id}`;
      asPack(ol, key, folded, l.name);
      if (!ro) dropTarget(ol, (id) => post(`processes/${id}/move`, { stage_id: stage.id, lane_id: l.id, index: indexOf(ol) }), moveAll(l.id));
      return h("section.lane", { dataset: { lane: l.id } },
        h("header", {}, h("h3", {}, l.name),
          l.is_default ? h("span.lane-default", { title: `Where a card going into ${stage.name} goes` }, "default") : null,
          h("span.lane-count", {}, cards.length), ro ? null : foldButton([key], folded, l.name)), ol);
    });
  }
  const terminal = isTerminal(stage);
  const col = h("section.column", { dataset: { stage: stage.id }, class: [lanes.length && !whole ? "has-lanes" : "", terminal ? "terminal" : ""].join(" "), "aria-labelledby": `col-${stage.id}`,
    hidden: hiddenStages().has(stage.id) },
    h("header", {}, h("span.stage-no", { "aria-hidden": "true" }, number), h("h2", { id: `col-${stage.id}` }, stage.name),
      h("span.al-badge.al-badge--count.count", { title: `${stage.cards.length} ${terminal ? "closed" : "active"}` }, stage.cards.length),
      h("button.col-hide", { type: "button", title: `Hide ${stage.name}`, "aria-label": `Hide the ${stage.name} column`, onclick: () => setStageHidden(stage.id, true) }, icon("eye-off")),
      foldButton(keys, folded, `everything in ${stage.name}`)),
    list,
    laneViews,
    ro ? null : h("footer", {}, h("button.al-button.al-button--quiet.al-button--sm.add-card", { type: "button", onclick: () => newApplication({ stageId: stage.id }) },
      icon("plus"), h("span", {}, `Add to ${stage.name}`))));
  return col;
}

/**
 * Packs: a list of cards (a sub stage's, or a column's top) folded into
 * one card on the rest, until unfolded. A stage says how its own start
 * (`folded`), and a sub stage how its do (or as its stage); `folded(key)`
 * says it for a pack. Folding or unfolding one here is remembered in this
 * browser, by `stage:lane` key, while it still says what it said then.
 */
function packChoices() {
  try { return JSON.parse(stored("packs") || "{}") || {}; } catch { return {}; }
}
function packOpen(key, folded) {
  const c = packChoices()[key];
  return c && c.was === folded(key) ? c.open : !folded(key);
}
function setPacksOpen(keys, folded, open) {
  const c = packChoices();
  for (const k of keys) c[k] = { open, was: folded(k) };
  store("packs", JSON.stringify(c));
}
/** How a stage's packs start: its top as it says, each sub stage as it says or as the stage. */
function stageFolded(stage) {
  const lanes = new Map((stage.lanes || []).map((l) => [`${stage.id}:${l.id}`, l]));
  return (key) => {
    const l = lanes.get(key);
    return l && l.folded != null ? !!l.folded : !!stage.folded;
  };
}

/** The board drawn again from what it has (as it was scrolled), with `focus` (a selector) focused. */
function redrawBoard(focus) {
  // Each swimlane's columns, scrolled as they were.
  const scrolls = [...view.querySelectorAll(".columns")].map((c) => c.scrollLeft);
  view.replaceChildren(boardView(BOARD));
  applyBoardFilters();
  view.querySelectorAll(".columns").forEach((c, i) => { c.scrollLeft = scrolls[i] ?? 0; });
  if (focus) view.querySelector(focus)?.focus({ preventScroll: true });
}

/** A button folding the packs `keys` (`folded` saying how they start), or unfolding them. */
function foldButton(keys, folded, what) {
  const open = keys.some((k) => packOpen(k, folded));
  const label = `${open ? "Fold" : "Unfold"} ${what}`;
  const fold = keys.join(" ");
  return h("button.al-button.al-button--icon.al-button--sm.al-button--quiet.pack-fold", {
    type: "button", title: label, "aria-label": label, "aria-expanded": String(open), dataset: { fold },
    onclick: () => { setPacksOpen(keys, folded, !open); redrawBoard(`.pack-fold[data-fold="${fold}"]`); },
  }, icon("chevron"));
}

/**
 * A list of cards as a pack (`key`, `folded` saying how it starts): folded,
 * its cards a blank pile saying how many, or that it's empty (`quiet`: an
 * empty one says nothing, a column's top above its sub stages).
 */
function asPack(list, key, folded, what, quiet = false) {
  const n = list.querySelectorAll(".card").length;
  const packed = !packOpen(key, folded);
  list.classList.toggle("packed", packed);
  if (packed && (n || !quiet)) list.prepend(pileFace(n, what, () => { setPacksOpen([key], folded, true); redrawBoard(); }));
}

const cardsCount = (n) => `${n} ${n === 1 ? "card" : "cards"}`;
/** A folded pack's face: its cards as a pile, no more than its count; opened, unfolded. An empty one, an outline. */
function pileFace(n, what, open) {
  if (!n) return h("li.pile-face.empty", { dataset: { total: 0 } }, h("span", {}, "Empty"));
  return h("li.pile-face", { class: [n > 1 ? "several" : "", n > 2 ? "deep" : ""].join(" "), dataset: { total: n } },
    h("button", { type: "button", "aria-label": `Unfold ${what}: ${cardsCount(n)}`, onclick: open }, h("span.pile-count", {}, cardsCount(n))));
}

/** Every stage, in order, with its cards: an active one's from the board, a terminal one's from what's closed. */
function boardStages(b) {
  const closed = (b.closed_stages || []).map((st) => ({ ...st, cards: b.archived.filter((c) => c.stage_id === st.id) }));
  return [...b.stages, ...closed].sort((x, y) => x.position - y.position || x.id - y.id);
}
/** A terminal stage: a process in it is closed (its sub stage says why). */
const isTerminal = (st) => st.active === 0;

/**
 * The board's swimlanes, top to bottom, each with its stages (a stage in
 * none, in the first); those with none left out. One for every stage, if
 * there are no swimlanes.
 */
function boardSwimlanes(b) {
  const lanes = b.swimlanes?.length ? b.swimlanes : [{ id: null, name: "Processes" }];
  const known = new Set(lanes.map((l) => l.id));
  const of = (st) => (known.has(st.swimlane_id) ? st.swimlane_id : lanes[0].id);
  const stages = boardStages(b);
  return lanes.map((l) => ({ lane: l, stages: stages.filter((st) => of(st) === l.id) })).filter((g) => g.stages.length);
}

/**
 * Whether a swimlane is open on the board: as it says (`folded`), or as it
 * was opened or folded here, remembered in this browser while it still
 * says what it said then.
 */
function swimlaneChoices() {
  try { return JSON.parse(stored("swimlanes") || "{}") || {}; } catch { return {}; }
}
function swimlaneOpen(key, lane) {
  const c = swimlaneChoices()[key];
  return c && c.was === !!lane.folded ? c.open : !lane.folded;
}

/** A swimlane: a row of the board, its stages' columns, folded until opened or not. */
function swimlaneView(g) {
  const count = g.stages.reduce((n, st) => n + st.cards.length, 0);
  const key = String(g.lane.id ?? 0);
  const title = `swimlane-${key}`;
  const columns = h("div.columns", { style: `--columns: ${g.stages.length}` }, g.stages.map((st, i) => columnView(st, i + 1)));
  const zone = h("details.al-disclosure.zone.swimlane", { open: swimlaneOpen(key, g.lane), "aria-labelledby": title, dataset: { swimlane: key } },
    h("summary", {},
      h("h2", { id: title }, g.lane.name),
      h("span.al-badge.al-badge--outline.al-badge--count.swimlane-count", { dataset: { total: count } }, count)),
    h("div.al-disclosure__body", {}, stagePager(g.stages, columns), columns));
  zone.addEventListener("toggle", () => {
    const c = swimlaneChoices();
    c[key] = { open: zone.open, was: !!g.lane.folded };
    store("swimlanes", JSON.stringify(c));
  });
  return zone;
}

/** Per-viewer conveniences, kept in this browser. */
function stored(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function store(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

function cardView(c) {
  const ro = boardReadOnly();
  const detailed = cardDetail() === "detailed";
  const tags = tagNames(c.tags);
  const next = c.status === "active" ? nextOf(c) : null;
  const mode = c.work_mode && optionLabel(R("applications").fields.find((f) => f.name === "work_mode").options, c.work_mode);
  const meta = [mode, c.source && h("span", { translate: "no" }, c.source),
    c.people ? `${c.people} ${c.people === 1 ? "person" : "people"}` : null,
    c.files ? `${c.files} ${c.files === 1 ? "file" : "files"}` : null,
    c.emails ? `${c.emails} ${c.emails === 1 ? "email" : "emails"}` : null].filter(Boolean);
  const open = (e) => {
    if (ro) { toast(`${c.company}: read-only in a past cycle`); return; }
    if (e?.metaKey || e?.ctrlKey) { e.preventDefault(); toggleCard(c.id); } else openApplication(c);
  };
  const el = h("li.card.al-card.al-card--interactive", {
    class: c.status,
    dataset: { id: c.id, tags: tags.join("|").toLowerCase() },
    draggable: ro ? null : "true", tabindex: "0",
    "aria-label": `${c.company}${c.title ? `, ${c.title}` : ""}`,
    "aria-selected": BOARD_SEL.has(c.id) ? "true" : null,
    // Ctrl/⌘-click, or x, selects it (with others, to act on together).
    onclick: open,
    onkeydown: (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      else if (e.key === "x" && !ro) { e.preventDefault(); toggleCard(c.id); }
    },
  },
  h("div.card-company", {}, logoOf(c.company_id, c.company_logo, c.company, 22), h("span.card-company-name", { translate: "no" }, c.company)),
  c.title ? h("div.card-role", { translate: "no" }, c.title) : null,
  next ? h("div.card-next", { class: next.overdue ? "overdue" : "" }, icon("clock"), h("span", {}, nextLabel(next))) : null,
  // A closed one: how far it got, why it closed, and when.
  c.status === "archived" ? h("div.card-closed", {},
    h("span.al-badge", { title: c.archive_note || null }, closedWhy(c)),
    h("span.card-meta", {}, dotted([c.reached_stage ? `Got to ${c.reached_stage}` : null, fmtDay(c.updated_at.slice(0, 10))]))) : null,
  detailed && tags.length ? h("div.card-tags", {}, tags.map((t) => tagChip(t))) : null,
  detailed && meta.length ? h("div.card-meta", {}, dotted(meta)) : null);
  if (!ro) {
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", String(c.id));
      e.dataTransfer.effectAllowed = "move";
      dragging = { el, card: c };
      requestAnimationFrame(() => el.classList.add("dragging"));
    });
    el.addEventListener("dragend", () => {
      el.classList.remove("dragging");
      placeholder.remove();
      document.querySelectorAll(".over").forEach((x) => x.classList.remove("over"));
      dragging = null;
    });
  }
  if (BOARD_SEL.has(c.id)) el.classList.add("selected");
  return el;
}

/** Select a card on the board, or let it go. */
function toggleCard(id) {
  if (BOARD_SEL.has(id)) BOARD_SEL.delete(id); else BOARD_SEL.add(id);
  for (const card of document.querySelectorAll(`.board .card[data-id="${id}"]`)) {
    card.classList.toggle("selected", BOARD_SEL.has(id));
    card.setAttribute("aria-selected", String(BOARD_SEL.has(id)));
  }
  document.querySelector(".board .bulk-bar")?.update(BOARD_SEL.size);
}

let dragging = null;
const placeholder = h("li.placeholder", { "aria-hidden": "true" });

/** Where the placeholder sits among the cards, not counting the one being dragged. */
function indexOf(list) {
  return [...list.children].filter((x) => !x.classList.contains("dragging")).indexOf(placeholder);
}

/**
 * Let cards be dropped on a list. `drop(id, card)` does the API call; null
 * means cancelled. A card dropped while selected with others brings them
 * all: `many(ids)` does that.
 */
function dropTarget(list, drop, many = null) {
  list.addEventListener("dragover", (e) => {
    if (!dragging) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const before = [...list.querySelectorAll(".card:not(.dragging)")].find((card) => {
      const r = card.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    if (before) list.insertBefore(placeholder, before);
    else list.append(placeholder);
    list.classList.add("over");
  });
  list.addEventListener("dragleave", (e) => {
    if (list.contains(e.relatedTarget)) return;
    list.classList.remove("over");
    if (placeholder.parentNode === list) placeholder.remove();
  });
  list.addEventListener("drop", async (e) => {
    e.preventDefault();
    if (!dragging) return;
    const { el, card } = dragging;
    const together = many && BOARD_SEL.has(card.id) && BOARD_SEL.size > 1;
    const result = together ? many([...BOARD_SEL]) : drop(card.id, card);
    // Show the card where it landed while the server catches up.
    if (placeholder.parentNode === list) placeholder.replaceWith(el);
    list.classList.remove("over");
    await attempt(() => result);
    await showBoard();
  });
}

// N, anywhere but in a field or a dialog: add an application.
document.addEventListener("keydown", (e) => {
  if (e.key !== "n" || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
  if (e.target.closest?.("input, textarea, select, [contenteditable], dialog[open]") || document.querySelector("dialog[open]")) return;
  if (!runningCycles().length || viewedCycle()) return;
  e.preventDefault();
  newApplication();
});

/** Pay as typed ("£85k–100k", "95,000 a year", "$600/day"): {salary_min, salary_max, currency, pay_period}, or null. */
function parsePay(text) {
  const t = (text || "").trim();
  if (!t) return null;
  const sym = { "£": "GBP", "$": "USD", "€": "EUR", "¥": "JPY", "₹": "INR" };
  const code = t.match(/\b([A-Z]{3})\b/)?.[1] || sym[t.match(/[£$€¥₹]/)?.[0]] || null;
  const nums = [...t.replace(/,(?=\d{3})/g, "").matchAll(/(\d+(?:\.\d+)?)\s*(k|m)?/gi)]
    .map(([, n, unit]) => Number(n) * (/k/i.test(unit || "") ? 1e3 : /m/i.test(unit || "") ? 1e6 : 1));
  if (!nums.length) return null;
  // "85–100k": the first takes the second's thousands.
  if (nums.length > 1 && nums[0] < 1000 && nums[1] >= 1000 && !/\d\s*k/i.test(t.split(/[-–]/)[0])) nums[0] *= 1000;
  const period = /day|\/d\b|daily/i.test(t) ? "day" : /hour|\/h|hourly/i.test(t) ? "hour" : /month|\/mo/i.test(t) ? "month" : "year";
  return { salary_min: Math.round(nums[0]), salary_max: Math.round(nums[1] ?? nums[0]), currency: code || HOME(), pay_period: period };
}

/**
 * Add an application, onto the board: from a posting's link, read into the
 * fields below (each marked as it was filled), or by hand. Its cycle (when
 * more than one runs) and its stage are chosen here.
 */
function newApplication({ stageId = null } = {}) {
  const stages = BOARD ? boardStages(BOARD) : [];
  const run = runningCycles();
  let found = null;
  const vals = { company: "", title: "", location: "", work_mode: "", pay: "", employment: "", stage_id: stageId ?? stages[0]?.id,
    cycle_id: currentCycle() && !currentCycle().ended_on ? currentCycle().id : run[0]?.id };
  const filled = new Set();
  const link = h("input", { id: "new-link", type: "url", placeholder: "Paste a Greenhouse, Lever, Workable, LinkedIn or careers page link" });
  const read = h("button.al-button", { type: "button" }, "Read posting");
  const readNote = h("div.new-read", { "aria-live": "polite" });
  const already = h("div.same-posting", { "aria-live": "polite" });
  const sideEffect = h("p.muted.small.new-side", { "aria-live": "polite" });
  const add = h("button.al-button.al-button--primary", { type: "submit" });
  const modes = R("applications").fields.find((f) => f.name === "work_mode").options;
  const emps = R("applications").fields.find((f) => f.name === "employment").options;
  const marks = {};
  const field = (key, label, control) => {
    marks[key] = h("span.new-filled", { hidden: true }, "from the posting");
    control.id = `nf-${key}`;
    control.addEventListener("input", () => { vals[key] = control.value; filled.delete(key); marks[key].hidden = true; sync(); });
    control.addEventListener("change", () => { vals[key] = control.value; sync(); });
    return h("div.field", {}, h("label.new-label", { for: `nf-${key}` }, label, marks[key]), control);
  };
  const controls = {
    company: h("input", { placeholder: "e.g. Harbour Health", autocomplete: "off" }),
    title: h("input", { placeholder: "e.g. Senior Platform Engineer" }),
    location: h("input", { placeholder: "City or region" }),
    work_mode: h("select", {}, h("option", { value: "" }, "Remote, hybrid or on-site"), modes.map(([v, l]) => h("option", { value: v }, l))),
    pay: h("input", { placeholder: "e.g. £85k–100k" }),
    employment: h("select", {}, h("option", { value: "" }, "Full-time, contract…"), emps.map(([v, l]) => h("option", { value: v }, l))),
  };
  let companies = [];
  get("companies").then((c) => { companies = c; sync(); }).catch(() => {});
  function sync() {
    const stage = stages.find((s) => String(s.id) === String(vals.stage_id));
    add.textContent = `Add to ${stage?.name || "the board"}`;
    add.disabled = !vals.company.trim();
    const name = vals.company.trim();
    const known = companies.find((c) => c.name.toLowerCase() === name.toLowerCase());
    sideEffect.hidden = !name;
    sideEffect.textContent = !name ? "" : known ? `Adds it under ${known.name}, already in your companies.`
      : `Also adds ${name} to your companies${found?.company_website ? ", with its website from the posting" : ""}.`;
  }
  async function readIt() {
    const url = link.value.trim();
    if (!url || isBusy(read)) return;
    busy(read);
    read.textContent = "Reading…";
    samePosting(url).then((w) => fill(already, w));
    try {
      found = await post("applications/lookup", { url });
      filled.clear();
      const set = (k, v) => { if (v == null || v === "") return; controls[k].value = v; vals[k] = String(v); filled.add(k); marks[k].hidden = false; };
      set("company", found.company);
      set("title", found.title);
      set("location", found.location);
      set("work_mode", found.work_mode);
      set("employment", found.employment);
      set("pay", fmtMoney(found.salary_min, found.salary_max, found.currency, found.pay_period).replace(/[⁦⁩]/g, ""));
      fill(readNote, notice("success", {}, h("div.al-notice__title", {}, `Read from ${found.platform}`),
        h("div.small", {}, filled.size ? `${filled.size} ${filled.size === 1 ? "field" : "fields"} filled in, marked below. Check them, then add it.` : "It didn't say much: fill in the rest below.")));
    } catch (e) {
      found = null;
      fill(readNote, notice("danger", { role: "alert" }, `Couldn't read it: ${e.message}. Fill in the fields below; the link is kept.`));
    }
    busy(read, false);
    read.textContent = "Read again";
    sync();
  }
  read.addEventListener("click", readIt);
  link.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); readIt(); } });
  link.addEventListener("paste", () => setTimeout(readIt, 0));
  const form = h("form", {
    onsubmit: async (e) => {
      e.preventDefault();
      if (!vals.company.trim() || isBusy(add)) return;
      busy(add);
      const body = {};
      if (found) {
        for (const [k, v] of Object.entries(found)) if (v != null && k !== "platform") body[k] = v;
      }
      if (link.value.trim()) body.url = body.url || link.value.trim();
      body.company = vals.company.trim();
      for (const k of ["title", "location", "work_mode", "employment"]) body[k] = vals[k] || null;
      // Pay typed or changed by hand is read again.
      if (!filled.has("pay")) {
        for (const k of ["salary_min", "salary_max", "currency", "pay_period"]) delete body[k];
        Object.assign(body, parsePay(vals.pay) || {});
      }
      body.stage_id = Number(vals.stage_id);
      if (vals.cycle_id) body.cycle_id = Number(vals.cycle_id);
      const card = await attempt(() => post("processes", body));
      busy(add, false);
      if (!card) return;
      await logoFromImport(card.company_id, body.company_logo);
      modal.close();
      const stage = stages.find((s) => s.id === card.stage_id);
      toast(`Added ${card.company} to ${stage?.name || card.stage}`, "info", { label: "Undo", onclick: async () => {
        if (await attempt(() => del(`applications/${card.application_id}`))) { toast("Undone"); route(); }
      } });
      await loadCycles();
      const page = appless(location.pathname).split("/")[1] || "";
      if (page === "" || page === "applications") route(); else go("/");
    },
  },
  h("h2.al-dialog__title", { id: "modal-title" }, "Add an application"),
  h("div.al-dialog__body", {},
    h("div.field", {}, h("label", { for: "new-link" }, "Posting link"), h("div.new-link-row", {}, link, read),
      h("span.al-hint", {}, "Or skip it and fill in the fields yourself.")),
    readNote, already,
    h("div.new-fields", {},
      field("company", "Company", controls.company), field("title", "Role", controls.title),
      field("location", "Location", controls.location), field("work_mode", "Work mode", controls.work_mode),
      field("pay", "Pay", controls.pay), field("employment", "Employment", controls.employment)),
    run.length > 1 ? h("div.field", {}, h("label", { for: "new-cycle" }, "Cycle"),
      h("select", { id: "new-cycle", onchange: (e) => { vals.cycle_id = e.target.value; } },
        run.map((c) => h("option", { value: c.id, selected: String(c.id) === String(vals.cycle_id) }, c.name)))) : null,
    h("div.field", {}, h("label", { for: "new-stage" }, "Add to"),
      h("select", { id: "new-stage", onchange: (e) => { vals.stage_id = e.target.value; sync(); } },
        stages.map((s) => h("option", { value: s.id, selected: String(s.id) === String(vals.stage_id) }, s.name)))),
    sideEffect),
  h("div.al-dialog__actions", {},
    h("button.al-button", { type: "button", onclick: () => modal.close() }, "Cancel"), add));
  sync();
  openModal(form);
  // Its stages, if the board hasn't been drawn yet.
  if (!stages.length) get(`board?${boardQuery()}`).then((b) => { BOARD = BOARD || b; modal.close(); newApplication({ stageId }); });
  link.focus();
}

/**
 * A warning if a posting link is already tracked, however it was copied;
 * null if not. `except` leaves out one application (the one being edited).
 */
async function samePosting(url, except = null) {
  if (!url) return null;
  let found = [];
  try { found = (await get(`applications/same-posting?url=${enc(url)}`)).filter((a) => a.id !== except); } catch { return null; }
  if (!found.length) return null;
  return notice("warning", { role: "status" },
    h("b", {}, "Already tracked: "),
    found.map((a, i) => [i ? "; " : "",
      h("a", { href: `/applications/${a.id}` }, a.label),
      a.processes.length
        ? [" (", a.processes.map((p, j) => [j ? ", " : "", h("a", { href: `/p/${p.id}` },
          p.status === "archived" ? `closed at ${p.stage}` : `in ${p.stage}`)]), ")"]
        : " (not on the board)"]),
    ". You can still add it, e.g. if you're applying again.");
}

/** Say so if an application's posting link is one another application already has. */
async function warnIfSamePosting(app) {
  const warning = await samePosting(app.url, app.id);
  if (warning) toast(`Another application has this posting link: ${warning.querySelector("a").textContent}`, "error");
}

// ---- a process -------------------------------------------------------------------

/** A card's application, on its page, showing the card's process. */
function openApplication(card) {
  go(`/applications/${card.application_id}?process=${card.id}`);
}

function timeline(rows) {
  if (!rows.length) return [h("li.muted", {}, "Nothing yet.")];
  // The log's sentences are written by the service, in English: kept as written.
  return rows.map((a) => h("li", { class: a.action }, h("time", { datetime: a.at }, fmtStamp(a.at)), h("span", { translate: "no" }, a.summary)));
}

/** A change log, collapsed until asked for. `update(rows)` refreshes it. */
function activityPanel(rows) {
  const list = h("ol.timeline");
  const count = h("span.count");
  const panel = h("details.al-disclosure.activity", {}, h("summary", {}, h("h2", {}, "Audit Log"), count), list);
  panel.update = (fresh) => {
    list.replaceChildren(...timeline(fresh));
    count.textContent = fresh.length;
  };
  panel.update(rows);
  return panel;
}

// ---- record lists: applications, companies, people, files ----------------------------

/** Pages that list a resource: the route, the resource, and its columns. */
const LISTS = {
  applications: {
    resource: "applications",
    columns: [["source", "Source"], ["location", "Location"], ["work_mode", "Mode"], ["salary", "Salary"], ["created_at", "Added"]],
  },
  companies: { resource: "companies", columns: [["kind", "Kind"], ["website", "Website"]] },
  people: { resource: "people", columns: [["title", "Job title"], ["location", "Location"], ["email", "Email"], ["linkedin", "LinkedIn"]] },
  files: { resource: "documents", columns: [["kind", "Kind"], ["latest", "Latest version"], ["versions", "Versions"]] },
};
/** A line about a list, beside its title. */
const LIST_LEDES = {
  contacts: "Who's hiring, and who you've met.",
  files: "Your resumes, cover letters and other documents, each with its versions and where it was sent.",
};
const routeOf = (resource) => Object.keys(LISTS).find((k) => LISTS[k].resource === resource);

async function showList(page) {
  const { resource, columns: cols } = LISTS[page];
  const r = R(resource);
  const search = h("input", { type: "search", placeholder: `Search ${r.title.toLowerCase()}`, "aria-label": "Search" });
  const body = h("tbody");
  const cell = (rec, key) => {
    if (key === "salary") {
      const pay = fmtMoney(rec.salary_min, rec.salary_max, rec.currency, rec.pay_period);
      return pay ? [pay, " ", gbpLine(rec)] : rec.comp || "";
    }
    if (key === "created_at") return fmtDay(rec.created_at.slice(0, 10));
    if (key === "latest") return rec.latest ? [h("a", { href: `/files/${rec.id}?version=${rec.latest.id}` }, `v${rec.latest.number}`), ` ${rec.latest.filename} · ${fmtDay(rec.latest.created_at.slice(0, 10))}`] : h("span.muted", {}, "none yet");
    if (key === "versions") return rec.versions ?? 0;
    const f = r.fields.find((x) => x.name === key);
    const v = rec[key];
    if (v == null) return "";
    if (f && f.type === "enum") return optionLabel(f.options, v);
    if (f && f.type === "url") return h("a", { href: v, target: "_blank", rel: "noreferrer", onclick: (e) => e.stopPropagation() }, v.replace(/^https?:\/\//, ""));
    return v;
  };
  let tag = "";
  // Files: of one kind, or all.
  const kindField = resource === "documents" ? r.fields.find((f) => f.name === "kind") : null;
  const kind = kindField
    ? h("select", { "aria-label": "Kind", onchange: () => load() },
      h("option", { value: "" }, "All kinds"), kindField.options.map(([v, l]) => h("option", { value: v }, l)))
    : null;
  // Rows selected (by id), to tag, untag or delete together.
  const sel = new Set();
  let shownIds = [];
  let headSelect = h("th.row-select");
  const bulk = bulkBar({ what: "selected", clear: () => { sel.clear(); redraw(); },
    actions: () => recordActions(resource, () => [...sel], () => { sel.clear(); load(); }) });
  const redraw = () => load();
  const load = async () => {
    const rows = await get(`${resource}?q=${enc(search.value)}${tag ? `&tag=${enc(tag)}` : ""}${kind?.value ? `&kind=${enc(kind.value)}` : ""}`);
    // Applications and people belong to companies: show whose logo.
    const companies = ["applications", "people"].includes(resource)
      ? new Map((await get("companies")).map((c) => [c.id, c]))
      : null;
    if (resource === "documents") {
      // Each document's newest version, and how many there are.
      const versions = await get("versions");
      for (const d of rows) {
        const mine = versions.filter((v) => v.document_id === d.id);
        d.versions = mine.length;
        d.latest = mine.reduce((a, v) => (!a || v.number > a.number ? v : a), null);
      }
    }
    // Selected rows stay to those shown.
    shownIds = rows.map((rec) => rec.id);
    for (const k of [...sel]) if (!shownIds.includes(k)) sel.delete(k);
    bulk.update(sel.size);
    headSelect.replaceWith(headSelect = selectAllCell(sel, () => shownIds, redraw));
    body.replaceChildren(...(rows.length
      ? rows.map((rec) => {
        const tr = h("tr", { tabindex: "0", "aria-selected": sel.has(rec.id) ? "true" : null,
          onclick: (e) => { if (!e.target.closest("a, button, .row-select")) go(`/${page}/${rec.id}`); },
          onkeydown: (e) => { if (e.key === "Enter" && e.target === tr) go(`/${page}/${rec.id}`); } },
        selectCell(sel, rec.id, () => shownIds, redraw, rec.label),
        h("td", {}, (() => {
        if (resource === "people") return h("span.with-logo", {}, photoOf(rec.id, rec.photo, rec.name, 24), h("b", {}, rec.label));
        const co = resource === "companies" ? rec : companies?.get(rec.company_id);
        return co
          ? h("span.with-logo", {}, logoOf(co.id, co.logo, co.name, 22), h("b", {}, rec.label))
          : h("b", {}, rec.label);
      })()),
      cols.map(([k]) => h("td", {}, cell(rec, k))),
      h("td.tags-cell", {}, tagNames(rec.tags).map((t) => tagChip(t))),
      rowIcons(rec.label, `/${page}/${rec.id}?edit=1`, async () => {
        const detail = { company: "Its applications must go first.", document: "All its versions go with it.", application: "Its processes on the board go with it." }[r.entity];
        if (!(await confirmDelete(`${r.entity} ${rec.label}`, detail))) return;
        if (await attempt(() => del(`${resource}/${rec.id}`))) { toast("Deleted"); load(); }
      }, rec.linkedin && ["company", "person"].includes(r.entity) ? () => refreshFromLinkedIn(r.entity, rec, load) : null));
        if (resource === "documents") {
          // A file dropped on a document becomes its next version.
          acceptDrop(tr, async (files) => {
            const made = await attempt(async () => {
              const out = [];
              for (const f of files) out.push(await uploadVersion(rec.id, f));
              return out;
            });
            if (made) { toast(`Uploaded ${made.map((v) => v.label).join(", ")}`); load(); }
          });
        }
        return tr;
      })
      : [h("tr", {}, h("td.muted", { colspan: cols.length + 4 }, search.value || tag || kind?.value ? "No matches." : `No ${r.title.toLowerCase()} yet.`))]));
  };
  const intake = resource === "documents"
    ? fileDrop({
      multiple: true,
      label: "Drop files here, or choose them",
      hint: "A file named like a document (cv.pdf → “cv”) becomes its next version; anything else becomes a new document. Drop on a row to add a version to that document.",
      onFiles: async (files) => {
        const done = await attempt(() => acceptFiles(files));
        if (done) { toast(`Uploaded ${done.join(", ")}`); load(); }
      },
    })
    : null;
  let timer;
  search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(load, 150); });
  // Companies and people are Contacts: one switch between them.
  const contacts = ["companies", "people"].includes(page);
  if (contacts) store("contacts", page);
  view.replaceChildren(h("div.page.list-page", { dataset: { list: page } },
    h("header.al-page-head", {}, h("h1", {}, contacts ? "Contacts" : r.title),
      LIST_LEDES[contacts ? "contacts" : page] ? h("p.al-page-head__lede", {}, LIST_LEDES[contacts ? "contacts" : page]) : null,
      h("div.al-page-head__end", {},
        h("button.al-button.al-button--primary", { type: "button", onclick: () => newRecord(page) }, icon("plus"),
          h("span", {}, resource === "documents" ? "New document" : `New ${r.entity}`)))),
    h("div.list-tools", {}, contacts ? contactsSwitch(page) : null, searchBox(search),
      kind,
      TAGS.length ? tagFilter(tag, (t) => { tag = t; load(); }) : null),
    h("div.al-table-wrap", {}, h("table.al-table--interactive", {},
      h("thead", {}, h("tr", {}, headSelect, h("th", {}, "Name"), cols.map(([k, l]) => h("th", { dataset: { col: k } }, l)), h("th", { dataset: { col: "tags" } }, "Tags"), h("th.row-icons", {}, "Actions"))),
      body)),
    bulk));
  hideableColumns(page, view.querySelector(".al-table-wrap table"));
  // Taking files in comes after the files.
  if (intake) view.querySelector(".al-table-wrap").after(intake);
  await load();
}

/** Contacts: everyone and every company, or one of them. */
function contactsSwitch(current) {
  return h("div.al-segmented", { role: "group", "aria-label": "Show" },
    [["all", "All", "/contacts"], ["companies", "Companies", "/companies"], ["people", "People", "/people"]].map(([k, l, path]) =>
      h("button", { type: "button", "aria-pressed": String(k === current), onclick: () => { store("contacts", k); go(path); } }, l)));
}

/** Contacts, all together: companies and people in one list, by name. */
async function showContacts() {
  store("contacts", "all");
  const search = h("input", { type: "search", placeholder: "Search companies and people", "aria-label": "Search" });
  let tag = "";
  const body = h("tbody");
  const load = async () => {
    const q = `q=${enc(search.value)}${tag ? `&tag=${enc(tag)}` : ""}`;
    const [companies, people] = await Promise.all([get(`companies?${q}`), get(`people?${q}`)]);
    const byId = new Map((await get("companies")).map((c) => [c.id, c]));
    const rows = [
      ...companies.map((c) => ({ kind: "Company", href: `/companies/${c.id}`, name: c.name, pic: logoOf(c.id, c.logo, c.name, 22),
        about: [c.industry, c.size].filter(Boolean).join(" · "), where: c.headquarters, tags: tagNames(c.tags) })),
      ...people.map((p) => ({ kind: "Person", href: `/people/${p.id}`, name: p.name, pic: photoOf(p.id, p.photo, p.name, 22),
        about: [p.title, byId.get(p.company_id)?.name].filter(Boolean).join(" · "), where: p.location, tags: tagNames(p.tags) })),
    ].sort((a, b) => a.name.localeCompare(b.name, LOC(), { sensitivity: "base" }));
    fill(body, rows.length ? rows.map((x) => {
      const tr = h("tr", { tabindex: "0", onclick: (e) => { if (!e.target.closest("a")) go(x.href); }, onkeydown: (e) => { if (e.key === "Enter") go(x.href); } },
        h("td", {}, h("span.with-logo", {}, x.pic, h("a.table-app", { href: x.href, translate: "no" }, h("b", {}, x.name)))),
        h("td", {}, x.kind),
        h("td", { translate: "no" }, x.about),
        h("td", { translate: "no" }, x.where || ""),
        h("td.tags-cell", {}, x.tags.map((t) => tagChip(t))));
      return tr;
    }) : h("tr", {}, h("td.muted", { colspan: 5 }, search.value || tag ? "No matches." : "No contacts yet.")));
  };
  let timer;
  search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(load, 150); });
  view.replaceChildren(h("div.page.list-page", { dataset: { list: "contacts" } },
    h("header.al-page-head", {}, h("h1", {}, "Contacts"), h("p.al-page-head__lede", {}, LIST_LEDES.contacts),
      h("div.al-page-head__end", {},
        h("button.al-button", { type: "button", onclick: () => go("/people/new") }, icon("plus"), h("span", {}, "New person")),
        h("button.al-button.al-button--primary", { type: "button", onclick: () => go("/companies/new") }, icon("plus"), h("span", {}, "New company")))),
    h("div.list-tools", {}, contactsSwitch("all"), searchBox(search),
      TAGS.length ? tagFilter(tag, (t) => { tag = t; load(); }) : null),
    h("div.al-table-wrap", {}, h("table.al-table--interactive", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Name"), h("th", {}, "Kind"), h("th", {}, "About"), h("th", {}, "Where"), h("th", {}, "Tags"))),
      body))));
  await load();
}

/** Something new for a list: a page, except a new application (a dialog). */
function newRecord(page) {
  if (LISTS[page].resource === "applications") return newApplication();
  go(`/${page}/new`);
}

/** The page for a new one of a list's records. */
function showNewRecord(page) {
  const r = R(LISTS[page].resource);
  if (r.entity === "document") return newDocument();
  if (r.entity === "company") return newCompany();
  if (r.entity === "person") return newPerson();
  newRecordPage(page, createForm(r.name, {}, {
    onCreated: (made) => { toast(`Added ${made.label}`); go(`/${page}/${made.id}`); },
  }));
}

// ---- companies: importing what their pages say ---------------------------------------

const IMPORTED = ["logo", "name", "website", "linkedin", "industry", "size", "headquarters", "founded", "description"];
const POSTING_FIELDS = [
  "title", "url", "location", "work_mode", "employment", "salary_min", "salary_max", "currency",
  "pay_period", "posted_on", "closes_on", "description",
];

/** What a company's page says: for openImport. */
const companyImport = {
  title: "Import company details",
  prompt: "The company's website, or its LinkedIn page",
  placeholder: "acme.com or linkedin.com/company/acme",
  endpoint: "companies/lookup",
  resource: "companies",
  keys: IMPORTED,
};

/** What a LinkedIn profile says about someone: for openImport. */
const personImport = {
  title: "Import from LinkedIn",
  prompt: "Their LinkedIn profile",
  placeholder: "https://www.linkedin.com/in/…",
  endpoint: "people/lookup",
  resource: "people",
  keys: ["photo", "name", "title", "company", "location", "linkedin", "about"],
  // LinkedIn often keeps profiles from anyone not signed in: then the
  // bookmark, on the profile in your browser, reads it instead.
  whenUnread: (url) => (/linkedin\.com\/in\//.test(url)
    ? h("a.al-button.al-button--primary", { href: url, target: "_blank", rel: "noreferrer" }, "Open the profile ↗")
    : null),
};

/**
 * Read a company's or person's LinkedIn page again (the link they already
 * have) and choose what to take from it. `done()` once something changed.
 */
function refreshFromLinkedIn(entity, rec, done) {
  const kind = entity === "company" ? companyImport : personImport;
  openImport({
    kind: { ...kind, title: "Refresh from LinkedIn", hideLink: true },
    url: rec.linkedin,
    current: rec,
    apply: async (fields, found) => {
      const ok = entity === "company" ? await applyToCompany(rec.id, fields) : await applyToPerson(rec.id, fields, found);
      if (ok) { toast("Refreshed"); done(); }
    },
  });
}

/** What a job posting says: for openImport. */
const postingImport = {
  title: "Import a job posting",
  prompt: "The job posting's link: Ashby, Greenhouse, Lever, Workable, LinkedIn, or a careers page",
  placeholder: "https://jobs.ashbyhq.com/acme/…",
  endpoint: "applications/lookup",
  resource: "applications",
  keys: POSTING_FIELDS,
};

/**
 * Read a page and choose what to keep from it. `current` is the record as
 * it is (or the form so far); `apply(fields)` gets the chosen fields.
 */
function openImport({ url = "", current = {}, apply, kind = companyImport, found = null }) {
  const dlg = h("dialog.al-dialog.al-dialog--md.ask.import");
  const input = h("input", { type: "url", id: "import-url", value: url, placeholder: kind.placeholder, required: true });
  const result = h("div.import-result");
  const read = h("button.al-button.al-button--primary", { type: "submit" }, "Read it");
  const readPage = async () => {
    if (isBusy(read)) return;
    busy(read);
    fill(result, h("p.muted", {}, "Reading the page…"));
    try {
      review(await post(kind.endpoint, { url: input.value }));
    } catch (err) {
      // With no link to change (a refresh), what's left is to go, or close.
      fill(result, notice("danger", { role: "alert" }, err.message),
        kind.hideLink ? h("div.actions", {}, kind.whenUnread?.(input.value), h("button.al-button", { type: "button", onclick: () => dlg.close() }, "Close")) : null);
    } finally {
      busy(read, false);
    }
  };
  const lookup = h("form", { onsubmit: (e) => { e.preventDefault(); readPage(); } },
  h("div.field", {}, h("label", { for: "import-url" }, kind.prompt),
    h("div.inline-add", {}, input, read)));

  function review(found) {
    const fields = R(kind.resource).fields;
    const show = (k, v) => {
      if (v == null || v === "") return h("span.muted", {}, "—");
      if (k === "photo") {
        return v.startsWith("http")
          ? h("img.logo-preview.round", { src: v, alt: "Their photo", referrerpolicy: "no-referrer" })
          : photoOf(current.id, v, current.name, 32);
      }
      if (k === "logo") {
        return v.startsWith("http")
          ? h("img.logo-preview", { src: v, alt: "The logo found", referrerpolicy: "no-referrer" })
          : logoOf(current.id, v, current.name, 32);
      }
      const f = fields.find((x) => x.name === k);
      if (f && f.type === "enum") return optionLabel(f.options, v);
      if (k === "description") return h("div.clamp", {}, v);
      return String(v);
    };
    const same = (a, b) => String(a ?? "") === String(b ?? "");
    const rows = kind.keys
      .filter((k) => found[k] != null && found[k] !== "" && !same(found[k], current[k]))
      .map((k) => {
        const box = h("input", { type: "checkbox", checked: current[k] == null || current[k] === "", dataset: { key: k } });
        const label = { logo: "Logo", photo: "Photo", company: "Company" }[k] || fields.find((f) => f.name === k)?.label || k;
        return h("tr", {}, h("td", {}, box), h("th", { scope: "row" }, label), h("td", {}, show(k, current[k])), h("td", {}, show(k, found[k])));
      });
    if (!rows.length) {
      fill(result, h("p", {}, "Nothing new: the page says what's already here."));
      return;
    }
    const table = h("table.import-table", {},
      h("thead", {}, h("tr", {}, h("th", {}, h("span.al-visually-hidden", {}, "Use")), h("th", {}, "Field"), h("th", {}, "Now"), h("th", {}, "From the page"))),
      h("tbody", {}, rows));
    const from = found.source || found.url;
    fill(result,
      h("p.muted.small", {}, found.platform ? `From ${found.platform}: ` : "From ", h("a", { href: from, target: "_blank", rel: "noreferrer" }, from),
        ". Ticked fields are used; what's already filled in stays unless you tick it."),
      h("div.al-table-wrap", {}, table),
      h("div.actions", {},
        h("button.al-button", { type: "button", onclick: () => dlg.close() }, "Cancel"),
        h("button.al-button.al-button--primary", { type: "button", onclick: async () => {
          const chosen = {};
          table.querySelectorAll("input:checked").forEach((b) => { chosen[b.dataset.key] = found[b.dataset.key]; });
          if (!Object.keys(chosen).length) { toast("Tick what to use", "error"); return; }
          await apply(chosen, found);
          dlg.close();
        } }, "Use these")));
  }

  // Already read (sent by the bookmark): straight to choosing.
  dlg.append(h("div.al-dialog__inner", {}, h("h2.al-dialog__title", {}, kind.title), found || kind.hideLink ? null : lookup, result));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  if (found) { review(found); return; }
  input.select();
  if (url) readPage();
}

/**
 * A profile sent by the “Send to hunt” bookmark (/linkedin?d=…): read it,
 * then choose what to keep, for the person already kept with that profile
 * or a new one.
 */
async function importSentProfile() {
  const data = new URLSearchParams(location.search).get("d");
  // Off the address bar, so going back or reloading doesn't import it again.
  history.replaceState(null, "", appPath("/people"));
  await showList("people");
  let page;
  try { page = JSON.parse(data || ""); } catch { toast("The bookmark sent nothing hunt can read", "error"); return; }
  const found = await attempt(() => post("people/from-page", page));
  if (!found) return;
  found.platform = "LinkedIn, in your browser";
  // The same profile: them. Otherwise someone of the same name may be them.
  let existing = (await get(`people?linkedin=${enc(found.linkedin)}`))[0];
  if (!existing) {
    const rule = (await get("settings")).same_name;
    const named = rule === "new" ? [] : (await get(`people?q=${enc(found.name)}`)).filter((p) => sameName(p.name, found.name));
    if (rule === "merge" && named.length === 1) {
      existing = named[0];
      toast(`Merging into ${existing.label}`);
    } else if (named.length) {
      const picked = await choosePerson(found, named);
      if (picked === undefined) return;
      existing = picked;
    }
  }
  if (existing && existing.company_id) {
    existing.company = (await get(`companies/${existing.company_id}`).catch(() => ({}))).name;
  }
  openImport({
    kind: personImport, found, current: existing || {},
    apply: async (chosen) => {
      if (existing) {
        if (await applyToPerson(existing.id, chosen, found)) { toast(`Updated ${existing.name}`); go(`/people/${existing.id}`); }
        return;
      }
      const made = await attempt(async () => {
        const { photo, company, ...rest } = chosen;
        rest.name = rest.name || found.name;
        rest.linkedin = rest.linkedin || found.linkedin;
        if (company) rest.company_id = (await companyNamed(company, found.company_linkedin)).id;
        const person = await post("people", rest);
        if (photo) { try { await post(`people/${person.id}/photo/fetch`, { url: photo }); } catch { /* no photo, no fuss */ } }
        return person;
      });
      if (made) { toast(`Added ${made.name}`); go(`/people/${made.id}`); }
    },
  });
}

/** Two names for the same person: the same words, whatever the case or order. */
function sameName(a, b) {
  const words = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter(Boolean).sort().join(" ");
  return !!words(a) && words(a) === words(b);
}

/**
 * Someone sent from LinkedIn has the name of someone already here: merge
 * into them, someone else, or add a new person? Resolves to the person, null
 * for a new one, or undefined when cancelled.
 */
async function choosePerson(found, named) {
  let other = null;
  const otherBox = combo({
    label: "Someone else", placeholder: "Someone else…", source: refSource("people"),
    onPick: (it) => { other = it.value; otherRadio.checked = true; },
  });
  const otherRadio = h("input", { type: "radio", name: "who", value: "other" });
  const option = (value, label, extra = null, checked = false) =>
    h("label.choice", {}, h("input", { type: "radio", name: "who", value, checked }), label, extra);
  const data = await ask({
    title: `Is ${found.name} already here?`,
    body: h("div.fields.choose-person", {},
      h("p.muted", {}, `Someone here has that name, under ${named.length === 1 ? "no or another LinkedIn profile" : "no or other LinkedIn profiles"}. Merging fills them in from this profile (you choose what) and keeps their history.`),
      named.map((p, i) => option(String(p.id), h("span.with-logo", {}, photoOf(p.id, p.photo, p.name, 22), h("b", {}, p.label)),
        p.title ? h("span.muted", {}, ` · ${p.title}`) : null, i === 0)),
      h("label.choice", {}, otherRadio, otherBox),
      option("new", h("span", {}, "Add a new person"))),
    ok: "Continue",
  });
  if (!data) return undefined;
  const who = data.get("who");
  if (who === "new") return null;
  const id = who === "other" ? other : Number(who);
  if (!id) { toast("Pick who it is from the list", "error"); return undefined; }
  return get(`people/${id}`);
}

/**
 * The “Send to hunt” bookmarklet. On a LinkedIn profile it collects the
 * page's text (hunt reads it) and opens hunt with it, in a new tab: opening
 * a page isn't something LinkedIn's security rules stop, as sending data
 * from its page would be.
 */
function profileBookmarklet(origin = location.origin) {
  const code = `(()=>{const H=${JSON.stringify(origin)};
if(!/(^|\\.)linkedin\\.com$/.test(location.hostname)||!/^\\/in\\//.test(location.pathname)){alert("Open someone's LinkedIn profile first, then click “Send to hunt”.");return}
const t=e=>(e&&e.innerText||"").trim();
const n=document.querySelector("main h1")||document.querySelector("h1");
const top=n&&(n.closest("section")||n.parentElement);
const sec=id=>{const a=document.getElementById(id);return a&&a.closest("section")};
let ph={s:"",w:0};
if(top)for(const i of top.querySelectorAll("img")){const s=i.currentSrc||i.src||"";const w=i.naturalWidth||1;
if(/licdn\\.com/.test(s)&&w>=ph.w&&(/profile-displayphoto|profile-framedphoto/.test(s)||(n&&i.alt&&i.alt.includes(t(n)))))ph={s,w}}
const c=document.querySelector('[aria-label^="Current company"]');
const d={url:location.href.split("?")[0],title:document.title,name:t(n),top:t(top).slice(0,3000),
about:t(sec("about")).slice(0,4000),experience:t(sec("experience")).slice(0,2500),
company:c?c.getAttribute("aria-label")||"":"",photo:ph.s};
window.open(H+"/app/linkedin?d="+encodeURIComponent(JSON.stringify(d)),"_blank")})()`;
  return `javascript:${encodeURIComponent(code.replace(/\n/g, ""))}`;
}

/** Set a field in a form built by fieldControl, as if typed. */
function setField(container, name, value) {
  const control = container.querySelector(`[data-field="${name}"] input, [data-field="${name}"] textarea, [data-field="${name}"] select`);
  if (!control) return;
  control.value = value ?? "";
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

/** A new company, optionally filled in from its website or LinkedIn page. */
function newCompany() {
  const form = createForm("companies", {}, {
    submitLabel: "Add company",
    onCreated: async (made) => {
      if (foundLogo) await logoFromImport(made.id, foundLogo);
      toast(`Added ${made.label}`);
      go(`/companies/${made.id}`);
    },
  });
  let foundLogo = null;
  const current = () => Object.fromEntries(IMPORTED.map((k) => {
    const c = form.querySelector(`[data-field="${k}"] input, [data-field="${k}"] textarea`);
    return [k, c && c.value ? c.value : null];
  }));
  newRecordPage("companies",
    h("div.import-bar", {},
      h("button.al-button", { type: "button", onclick: () => openImport({
        current: current(),
        apply: (fields) => {
          const { logo, ...rest } = fields;
          foundLogo = logo || foundLogo;
          for (const [k, v] of Object.entries(rest)) setField(form, k, v);
          if (logo) toast("The logo is added with the company");
        },
      }) }, "Import from website or LinkedIn…"),
      h("span.muted.small", {}, "Fills in the form; nothing is saved until you add the company.")),
    form);
  form.querySelector("input")?.focus();
}

/** A new person, by hand or from their LinkedIn profile. */
function newPerson() {
  const link = h("input", { type: "url", "aria-label": "LinkedIn profile", placeholder: "https://www.linkedin.com/in/…" });
  const status = h("div.posting-preview", { "aria-live": "polite" });
  const fromProfile = h("form.profile-add", { onsubmit: async (e) => {
    e.preventDefault();
    if (!link.value.trim()) return;
    fill(status, h("p.muted.small", {}, "Reading the profile…"));
    try {
      const found = await post("people/lookup", { url: link.value.trim() });
      const person = await personFromProfile(found);
      toast(`Added ${person.name}`);
      go(`/people/${person.id}`);
    } catch (err) {
      fill(status, notice("danger", { class: "small",  role: "alert" }, `${err.message}`));
    }
  } }, h("div.inline-add", {}, link, h("button.al-button.al-button--primary", { type: "submit" }, "Import")), status);
  const form = createForm("people", {}, {
    submitLabel: "Add person",
    onCreated: (made) => { toast(`Added ${made.label}`); go(`/people/${made.id}`); },
  });
  newRecordPage("people",
    h("p.muted", {}, "From their LinkedIn profile: name, headline, company, location, photo."),
    fromProfile,
    h("div.application-form", {}, h("div.or", {}, h("span", {}, "or fill in"))),
    form);
  link.focus();
}

// ---- files: taking them in, and previewing them -------------------------------------

/** Upload a file as the next version of a document. */
async function uploadVersion(docId, file, { tag, note } = {}) {
  const q = new URLSearchParams({ filename: file.name });
  if (tag) q.set("tag", tag);
  if (note) q.set("note", note);
  const res = await fetch(`/api/documents/${docId}/versions?${q}`, {
    method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${file.name}: ${data.error || res.statusText}`);
  return data;
}

const stem = (filename) => filename.replace(/\.[^.]+$/, "").trim() || filename;

function guessKind(filename) {
  const n = filename.toLowerCase();
  if (n.includes("cover")) return "cover-letter";
  if (/\b(cv|resume|résumé)\b|^cv|cv[-_ .]|resume/.test(n)) return "resume";
  if (n.includes("portfolio")) return "portfolio";
  if (/(^|[^a-z])nda([^a-z]|$)|non[-_ ]?disclosure|confidentiality/.test(n)) return "nda";
  if (/background[-_ ]?check|\bdbs\b|screening[-_ ]consent/.test(n)) return "background-check";
  if (/right[-_ ]to[-_ ]work|passport|\bvisa\b|\bbrp\b|share[-_ ]code|\bid[-_ ]card/.test(n)) return "right-to-work";
  if (n.includes("reference")) return "reference";
  if (/certificate|transcript|diploma|degree/.test(n)) return "certificate";
  if (/screen ?shot|screenshot|^screen[-_ ]|^img[-_]\d|^cleanshot/.test(n)) return "screenshot";
  if (/job[-_ ]?description|\bjd\b|^jd[-_ .]/.test(n)) return "job-description";
  if (/take[-_ ]?home|assignment|exercise|\bchallenge\b|case[-_ ]study/.test(n)) return "assignment";
  if (/\boffer\b|offer[-_ .]letter/.test(n)) return "offer";
  if (/contract|agreement|terms/.test(n)) return "contract";
  if (/feedback|review|debrief/.test(n)) return "feedback";
  if (/candidate|guide|prep|handbook|interview[-_ ]?(info|process)/.test(n)) return "candidate-resource";
  return "other";
}

/** Take in files: each becomes the next version of the document named like it, or a new document. */
async function acceptFiles(files) {
  const done = [];
  for (const f of files) {
    const name = stem(f.name);
    const found = (await get(`documents?q=${enc(name)}`)).find((d) => d.name.toLowerCase() === name.toLowerCase());
    const doc = found || (await post("documents", { name, kind: guessKind(f.name) }));
    const v = await uploadVersion(doc.id, f);
    done.push(v.label);
  }
  return done;
}

/** Let files be dropped on an element. */
function acceptDrop(el, onFiles) {
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  el.addEventListener("dragover", (e) => { if (!hasFiles(e)) return; e.preventDefault(); el.classList.add("file-over"); });
  el.addEventListener("dragleave", (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove("file-over"); });
  el.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove("file-over");
    if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]);
  });
}

/** A drop zone with a file picker in it. */
function fileDrop({ multiple = false, label, hint, onFiles }) {
  const id = newId();
  const input = h("input", { type: "file", id, multiple });
  input.addEventListener("change", () => { if (input.files.length) onFiles([...input.files]); input.value = ""; });
  const zone = h("div.dropzone", {}, h("label", { for: id }, label), input, hint ? h("p.muted.small", {}, hint) : null);
  acceptDrop(zone, onFiles);
  zone.input = input;
  return zone;
}

/** What a version looks like: the browser's own viewer where it has one. */
function previewOf(v) {
  const url = `/api/versions/${v.id}/file`;
  const type = (v.content_type || "").split(";")[0].trim();
  if (type === "application/pdf") return h("iframe.preview-frame", { src: url, title: `Preview of ${v.filename}` });
  if (type.startsWith("image/")) return h("div.preview-image", {}, h("img", { src: url, alt: `Preview of ${v.filename}` }));
  if (type.startsWith("text/") || type === "application/json") {
    const pre = h("pre.preview-text", {}, "Loading…");
    fetch(url).then((r) => r.text()).then((t) => { pre.textContent = t.length > 500000 ? `${t.slice(0, 500000)}\n…` : t; })
      .catch(() => { pre.textContent = "Couldn't load it."; });
    return pre;
  }
  return h("div.preview-none", {},
    h("p", {}, `The browser can't show ${v.filename} here.`),
    h("a.al-button.al-button--sm", { href: `${url}?download=1` }, "Download it"));
}

function newDocument() {
  const r = R("documents");
  const values = {};
  let file = null;
  const fields = h("div.fields", {}, r.fields.map((f) =>
    fieldControl("documents", f, values[f.name], (v) => { values[f.name] = v; }, { quiet: true })));
  const nameInput = () => fields.querySelector('[data-field="name"] input');
  const chosen = h("p.small", {}, "No file yet: you can add one later.");
  const drop = fileDrop({
    label: "Drop the first version here, or choose it",
    onFiles: ([f]) => {
      file = f;
      chosen.textContent = `First version: ${f.name} (${fmtSize(f.size)})`;
      if (!nameInput().value) { nameInput().value = stem(f.name); values.name = stem(f.name); }
      const kind = fields.querySelector('[data-field="kind"] select');
      if (!values.kind) { kind.value = guessKind(f.name); values.kind = kind.value; }
    },
  });
  const form = h("form.create", { onsubmit: async (e) => {
    e.preventDefault();
    const made = await attempt(() => post("documents", values));
    if (!made) return;
    if (file && !(await attempt(() => uploadVersion(made.id, file)))) return;
    toast(`Added ${made.label}`);
    go(`/files/${made.id}`);
  } }, drop, chosen, fields, h("div.actions", {}, h("button.al-button.al-button--primary", { type: "submit" }, "Add document")));
  newRecordPage("files", form);
}

/** A document's versions, newest first, next to a preview of the chosen one. */
async function versionsPanel(doc, after, versionId = null, editing = false) {
  const panel = h("section.al-panel.panel.doc-versions", {});
  let uploading = editing;
  const rerender = async () => { panel.replaceWith(await versionsPanel(doc, after, versionId, editing)); after(); };
  const versions = await get(`versions?document_id=${doc.id}`);
  const vr = R("versions");
  const f = (n) => vr.fields.find((x) => x.name === n);
  const preview = h("div.preview-pane");
  const rows = [];
  const select = (v, row) => {
    rows.forEach((r) => r.classList.toggle("selected", r === row));
    fill(preview, h("div.preview-bar", {},
      h("b", {}, `v${v.number}`), ` ${v.filename}`,
      h("span.spacer"),
      h("a.al-button.al-button--sm", { href: `/api/versions/${v.id}/file`, target: "_blank", rel: "noopener" }, "Open in a tab"),
      h("a.al-button.al-button--sm", { href: `/api/versions/${v.id}/file?download=1` }, "Download")),
    previewOf(v));
  };
  const list = h("ol.versions", {}, await Promise.all(versions.map(async (v) => {
    const uses = await get(`versions/${v.id}/uses`);
    const row = h("li.version", {},
      h("button.version-head", { type: "button", onclick: () => select(v, row), "aria-label": `Preview version ${v.number}` },
        h("b", {}, `v${v.number}`),
        h("span.version-name", {}, v.filename),
        h("span.muted", {}, `${fmtSize(v.size)} · ${fmtStamp(v.created_at)}`)),
      // Reading: its tag and note; editing: them as fields, and delete.
      editing
        ? h("div.fields", {}, ["tag", "note"].map((n) => fieldControl("versions", f(n), v[n], async (val) => { await patch(`versions/${v.id}`, { [n]: val }); after(); })))
        : v.tag || v.note ? h("p.small", {}, v.tag ? tagChip(v.tag) : null, v.note ? ` ${v.note}` : null) : null,
      h("div.version-foot", {},
        uses.length
          ? h("span.small.muted", {}, "Sent with ", uses.map((u, i) => [i ? ", " : "", h("a", { href: `/p/${u.id}` }, u.label)]))
          : h("span.small.muted", {}, "Not sent with anything yet"),
        editing ? h("button.al-button.al-button--icon.al-button--sm.al-button--danger", { type: "button", "aria-label": `Delete version ${v.number}`, title: "Delete version", onclick: async () => {
          if (!(await confirmDelete(`version ${v.number}`))) return;
          if (await attempt(() => del(`versions/${v.id}`))) { toast("Version deleted"); rerender(); }
        } }, "×") : null));
    rows.push(row);
    return row;
  })));

  const tag = h("input", { "aria-label": "Tag for the new version", placeholder: "Tag, e.g. rust-focused" });
  const note = h("input", { "aria-label": "Note for the new version", placeholder: "What changed" });
  const next = versions.length ? Math.max(...versions.map((v) => v.number)) + 1 : 1;
  const upload = fileDrop({
    multiple: true,
    label: `Drop version ${next} here, or choose it`,
    onFiles: async (files) => {
      const made = await attempt(async () => {
        const out = [];
        for (const file of files) out.push(await uploadVersion(doc.id, file, { tag: tag.value.trim(), note: note.value.trim() }));
        return out;
      });
      if (made) { toast(`Uploaded ${made.map((v) => `v${v.number}`).join(", ")}`); rerender(); }
    },
  });
  // Uploading: open in Edit mode, behind its button when reading.
  const uploadBox = h("div.upload", { hidden: !uploading }, upload, h("div.upload-meta", {}, tag, note),
    h("p.muted.small", {}, "Set a tag or note first if you like; they go with the next file you drop."));
  const toggle = editing ? null : h("button.al-button.al-button--quiet.app-add", { type: "button", onclick: () => {
    uploading = !uploading;
    uploadBox.hidden = !uploading;
    toggle.textContent = uploading ? "Close" : `+ Upload version ${next}`;
  } }, `+ Upload version ${next}`);
  panel.append(
    h("div.doc-list", {},
      toggle,
      uploadBox,
      versions.length ? list : h("p.muted", {}, "No versions yet.")),
    preview);
  // The version asked for (from a link), or the newest.
  const first = Math.max(0, versions.findIndex((v) => v.id === versionId));
  if (versions.length) select(versions[first], rows[first]);
  else fill(preview, h("div.preview-none", {}, h("p", {}, "Upload a file to see it here.")));
  return panel;
}

function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ---- settings: the page is settings.js; its backup and Gmail sections are here ----------

// ---- backups ---------------------------------------------------------------------------

/** Settings: save everything to a file, or bring a saved one back. */
function backupSettings() {
  const picker = h("input", { type: "file", accept: "application/json,.json", hidden: true });
  const status = h("p.muted.small", { "aria-live": "polite" });
  picker.addEventListener("change", async () => {
    const f = picker.files[0];
    picker.value = "";
    if (!f) return;
    // Check it's a backup, and say what's in it, before anything is replaced.
    let backup;
    try { backup = JSON.parse(await f.text()); } catch { toast(`${f.name} isn't a hunt backup`, "error"); return; }
    if (!backup || backup.hunt_backup == null || !backup.tables) { toast(`${f.name} isn't a hunt backup`, "error"); return; }
    const c = backup.counts || {};
    const n = (k) => c[k] ?? (backup.tables[k] || []).length;
    const ok = await ask({
      title: "Replace everything with this backup?",
      body: h("div.fields", {},
        h("p", {}, `${f.name}, made ${backup.made_at ? fmtStamp(backup.made_at) : "at an unknown time"}: `,
          `${n("process")} processes, ${n("application")} applications, ${n("company")} companies, ${n("person")} people, `,
          `${n("version")} file versions, and ${n("activity")} changes in the log.`),
        h("p", {}, h("b", {}, "Everything here now is replaced"), ", including Settings (but not the Gmail connection). It can't be undone, so ",
          h("a", { href: "/api/backup" }, "download a backup of what's here"), " first if you might want it.")),
      ok: "Replace everything", danger: true,
    });
    if (!ok) return;
    status.textContent = "Importing…";
    const res = await fetch("/api/backup?confirm=replace", { method: "POST", headers: { "Content-Type": "application/json" }, body: f });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { status.textContent = ""; toast(data.error || "The import didn't work", "error"); return; }
    status.textContent = `Imported ${f.name}.`;
    toast("Backup imported");
    await reloadMeta();
    showSettings();
  });
  return h("section.al-panel.panel.settings-panel.backup", {},
    h("div.panel-head", {}, h("h2", {}, "Backup")),
    h("p", {}, "A backup is one file with everything hunt tracks: processes, applications, companies, people, files, tags, settings and the change log. It works with any database hunt can use, so it also moves your data from one to another."),
    h("div.actions", {},
      h("a.al-button.al-button--primary", { href: "/api/backup", download: "" }, icon("download"), h("span", {}, "Download a backup")),
      picker,
      h("button.al-button", { type: "button", onclick: () => picker.click() }, "Import a backup…")),
    status,
    h("p.muted.small", {}, "Importing replaces everything here with the backup's contents, all or nothing. The Gmail connection is neither saved nor replaced."));
}

// ---- email ----------------------------------------------------------------------------

/**
 * Gmail sign-in and sync (the Inbox, Settings → Gmail, a process's label and
 * search) are switched off for now: emails come in as .eml files or pasted.
 * Set this to bring them back; the service still has it all.
 */
const GMAIL = false;

let MAIL = null;
/** The Gmail connection and how much waits in triage; shown by Inbox in the sidebar. */
async function updateInboxCount() {
  try { MAIL = await get("mail"); } catch { return; }
  const badge = document.querySelector('[data-nav="inbox"] .nav-count');
  if (badge) {
    badge.textContent = MAIL.triage || "";
    badge.hidden = !MAIL.triage;
  }
}

const whoSent = (e) => (e.outgoing ? "You" : e.from_name || e.from_addr || "Unknown sender");
const MATCHED = {
  label: "by its Gmail label", thread: "by its thread", person: "by a person on the process",
  company: "by the company's domain", "hiring tool": "a hiring tool's mail naming the company",
  search: "by the process's search", mention: "it mentions the company", you: "by you", file: "added by you",
};

/** An email: who, when, subject and the start of it; opens to the whole text. */
function emailItem(e, actions = []) {
  const body = h("div.email-body", { hidden: true });
  const toggle = h("button.email-toggle", { type: "button", "aria-expanded": "false", onclick: async () => {
    const open = body.hidden;
    body.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open && !body.dataset.loaded) {
      body.textContent = "Loading…";
      const full = await attempt(() => get(`emails/${e.id}`));
      if (full) {
        body.dataset.loaded = "1";
        fill(body,
          h("p.muted.small", {}, `From ${full.from_name ? `${full.from_name} <${full.from_addr}>` : full.from_addr}`,
            full.to_addrs ? ` · to ${full.to_addrs}` : "", full.cc_addrs ? ` · cc ${full.cc_addrs}` : ""),
          h("div.email-text", {}, full.body || "(no text)"));
      }
    }
  } },
  h("span.email-line", {},
    h("b.email-who", {}, whoSent(e)),
    h("time.muted", { datetime: e.sent_at, title: e.sent_at.replace("T", " ") }, fmtStamp(e.sent_at))),
  h("span.email-subject", {}, e.subject || "(no subject)"),
  e.snippet ? h("span.email-snippet.muted", {}, e.snippet) : null);
  return h("li.email", { class: e.outgoing ? "outgoing" : "" }, toggle,
    h("div.email-actions", {},
      GMAIL && e.matched_by ? h("span.muted.small", { title: "How it was matched" }, MATCHED[e.matched_by] || e.matched_by) : null,
      h("span.spacer"),
      e.gmail_url ? h("a.small-button.button", { href: e.gmail_url, target: "_blank", rel: "noreferrer" }, "Open in Gmail ↗") : null,
      actions),
    body);
}

/** Mail waiting for a process: link it, or ignore it (and its sender). */
async function showInbox() {
  await updateInboxCount();
  const page = h("div.page.inbox", {});
  view.replaceChildren(page);
  const status = h("p.muted.inbox-status");
  const sync = h("button.al-button.al-button--primary", { type: "button", onclick: async () => {
    if (isBusy(sync)) return;
    busy(sync);
    sync.textContent = "Syncing…";
    const r = await attempt(() => post("mail/sync", {}));
    busy(sync, false);
    sync.textContent = "Sync now";
    if (r) toast(`${r.fetched} fetched: ${r.linked} linked, ${r.triage} to sort`);
    showInbox();
  } }, "Sync now");
  page.append(h("div.al-page-head.page-head", {}, h("h1", {}, "Inbox"), status, MAIL?.connected ? sync : null));
  if (!MAIL?.connected) {
    page.append(h("section.al-panel.panel", {}, h("h2", {}, "Bring in email about your applications"),
      h("p", {}, "Connect Gmail in ", h("a", { href: "/settings" }, "Settings"),
        ". hunt then finds mail about each process: from its people, the company's domains, hiring tools naming the company, and threads already linked. Mail that could be about more than one process waits here for you."),
      h("p.muted", {}, "Without Gmail, drop .eml files on a process.")));
    return;
  }
  fill(status, MAIL.last_sync
    ? [`Last synced ${fmtStamp(MAIL.last_sync)}`, MAIL.last_error ? h("span.bad", {}, ` — failed: ${MAIL.last_error}`) : ""]
    : "Not synced yet.");
  const waiting = await get("emails?status=triage");
  if (!waiting.length) {
    page.append(emptyState("Nothing to sort", "Mail hunt is sure about goes straight to its process."));
    return;
  }
  page.append(h("p.muted", {}, "These could be about more than one process, or only mention a company. Linking one brings the rest of its thread with it."));
  const list = h("ol.email-list.triage", {});
  const done = (li, msg) => { li.remove(); toast(msg); updateInboxCount(); if (!list.children.length) showInbox(); };
  for (const e of waiting) {
    let li;
    const link = async (pid, name) => {
      if (await attempt(() => post(`emails/${e.id}/link`, { process_id: pid }))) done(li, `Linked to ${name}`);
    };
    const other = combo({
      label: "Another process", placeholder: "Another process…", source: refSource("processes"),
      onPick: (it) => link(it.value, it.label),
    });
    const domain = (e.from_addr || "").split("@")[1];
    const ignore = (rule) => async () => {
      const r = await attempt(() => post(`emails/${e.id}/ignore`, rule ? { rule } : {}));
      if (r) done(li, rule ? `Ignored ${r.ignored} from ${rule === "sender" ? e.from_addr : domain}, from now on` : "Ignored");
    };
    li = emailItem(e, [
      h("button.al-button.al-button--sm", { type: "button", onclick: ignore(null) }, "Ignore"),
      e.from_addr ? h("button.al-button.al-button--sm", { type: "button", title: `Ignore everything from ${e.from_addr}`, onclick: ignore("sender") }, "Ignore sender") : null,
      domain ? h("button.al-button.al-button--sm", { type: "button", title: `Ignore everything from @${domain}`, onclick: ignore("domain") }, `Ignore @${domain}`) : null,
    ]);
    li.append(h("div.suggest", {},
      (e.suggested || []).map((p) => h("button.al-button", { type: "button", onclick: () => link(p.id, `${p.company} — ${p.title || ""}`) },
        logoOf(p.company_id, p.company_logo, p.company, 16), `${p.company}${p.title ? ` — ${p.title}` : ""}`,
        p.status === "archived" ? h("span.muted", {}, " (archived)") : null)),
      other));
    list.append(li);
  }
  page.append(list);
}

/**
 * Signing in with Google: give hunt your OAuth client's JSON, register the
 * address Google returns to, then sign in.
 */
async function googleSignin(rerender) {
  const box = h("div.google-signin");
  const redirect = `${location.origin}/api/mail/google/callback`;
  const picker = h("input", { type: "file", accept: "application/json,.json", hidden: true, onchange: async () => {
    const f = picker.files[0];
    if (!f) return;
    const res = await fetch("/api/mail/google/client", { method: "PUT", headers: { "Content-Type": "application/json" }, body: f });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast(data.error || "hunt couldn't read that file", "error"); return; }
    toast("Google client saved");
    rerender();
  } });
  const copy = (text) => h("button.al-button.al-button--sm.al-button--quiet", { type: "button", onclick: () => navigator.clipboard?.writeText(text).then(() => toast("Copied")) }, "Copy");
  if (!MAIL.google_client) {
    box.append(
      h("h3", {}, "Sign in with Google (recommended)"),
      h("p", {}, "hunt then reads mail and manages its labels through the Gmail API, and can't send, change or delete anything. It needs an OAuth client of your own, from Google Cloud:"),
      h("ol.steps-help", {},
        h("li", {}, "In ", h("a", { href: "https://console.cloud.google.com/apis/library/gmail.googleapis.com", target: "_blank", rel: "noreferrer" }, "Google Cloud ↗"), ", turn on the Gmail API for your project."),
        h("li", {}, "Under ", h("a", { href: "https://console.cloud.google.com/auth/clients", target: "_blank", rel: "noreferrer" }, "Clients ↗"), ", make a Web application client, with this authorised redirect URI: ", h("code", {}, redirect), " ", copy(redirect)),
        h("li", {}, "Under ", h("a", { href: "https://console.cloud.google.com/auth/scopes", target: "_blank", rel: "noreferrer" }, "Data access ↗"), ", add the scopes gmail.readonly and gmail.labels; under ", h("a", { href: "https://console.cloud.google.com/auth/audience", target: "_blank", rel: "noreferrer" }, "Audience ↗"), ", add yourself as a test user, or publish the app so sign-ins don't expire after a week."),
        h("li", {}, "Download the client's JSON file, and give it to hunt: ", picker,
          h("button.al-button.al-button--sm", { type: "button", onclick: () => picker.click() }, "Choose the JSON file…"))));
    return box;
  }
  const go = h("button.al-button.al-button--primary", { type: "button", onclick: async () => {
    if (isBusy(go)) return;
    busy(go);
    const start = await attempt(() => get("mail/google/start"));
    if (start) location.href = start.url;
    else busy(go, false);
  } }, "Sign in with Google");
  box.append(
    h("h3", {}, "Sign in with Google"),
    h("p", {}, "hunt will read mail and manage its labels, nothing more."),
    h("div.actions", {}, go),
    h("p.muted.small", {}, "Client ", h("code", {}, MAIL.google_client), ". Its authorised redirect URIs need ", h("code", {}, redirect), " ", copy(redirect), ". ",
      h("button.al-button.al-button--sm.al-button--quiet", { type: "button", onclick: async () => {
        if (await attempt(() => del("mail/google/client"))) rerender();
      } }, "Use another client")));
  return box;
}

/** Settings: the Gmail account, how often it syncs, and ignored senders. */
async function gmailSettings() {
  await updateInboxCount();
  const section = h("section.al-panel.panel.settings-panel.gmail", {}, h("div.panel-head", {}, h("h2", {}, "Gmail")));
  const rerender = async () => section.replaceWith(await gmailSettings());
  if (!MAIL.connected) {
    section.append(await googleSignin(rerender));
    const address = h("input", { type: "email", id: "gmail-address", autocomplete: "username", placeholder: "you@gmail.com", required: true, value: MAIL.address || "" });
    const password = h("input", { type: MAIL.password_from_env ? "hidden" : "password", id: "gmail-password", autocomplete: "off", placeholder: "abcd efgh ijkl mnop", required: !MAIL.password_from_env });
    const go = h("button.al-button.al-button--primary", { type: "submit" }, "Connect");
    section.append(
      h("details.al-disclosure.more", { open: !MAIL.google_client }, h("summary", {}, "Or use an app password"),
      h("p", {}, "hunt reads mail over IMAP with an app password. It works without a Google Cloud project, but an app password can also send and delete mail."),
      h("ol.steps-help", {},
        h("li", {}, "Turn on ", h("a", { href: "https://myaccount.google.com/signinoptions/twosv", target: "_blank", rel: "noreferrer" }, "2-Step Verification ↗"), " for your Google account, if it isn't."),
        h("li", {}, "Make an ", h("a", { href: "https://myaccount.google.com/apppasswords", target: "_blank", rel: "noreferrer" }, "app password ↗"), " named “hunt”."),
        h("li", {}, "Enter it here. It's kept in hunt's database on this computer", MAIL.password_from_env ? "; here it comes from HUNT_GMAIL_APP_PASSWORD." : " (or set HUNT_GMAIL_APP_PASSWORD when starting hunt instead).")),
      h("form.fields.gmail-connect", { onsubmit: async (e) => {
        e.preventDefault();
        if (isBusy(go)) return;
        busy(go);
        go.textContent = "Signing in…";
        const ok = await attempt(() => api("PUT", "mail", { address: address.value, password: password.value || null }));
        busy(go, false);
        go.textContent = "Connect";
        if (ok) { toast("Gmail connected"); rerender(); }
      } },
      h("div.field", {}, h("label", { for: "gmail-address" }, "Gmail address"), address),
      MAIL.password_from_env ? null : h("div.field", {}, h("label", { for: "gmail-password" }, "App password"), password),
      h("div.actions", {}, go))));
    return section;
  }
  const every = h("select", { id: "gmail-every", onchange: async () => {
    if (await attempt(() => api("PUT", "mail", { interval: Number(every.value) }))) toast("Saved");
  } }, [[0, "Only when I ask"], [5, "Every 5 minutes"], [15, "Every 15 minutes"], [30, "Every 30 minutes"], [60, "Every hour"]]
    .map(([v, l]) => h("option", { value: v, selected: v === MAIL.interval }, l)));
  const r = MAIL.last_report;
  section.append(
    h("dl.facts", {},
      h("dt", {}, "Account"), h("dd", {}, MAIL.address,
        h("span.muted", {}, MAIL.auth === "google" ? " · signed in with Google (read and labels only)" : " · app password")),
      h("dt", {}, "Last sync"), h("dd", {}, MAIL.last_sync
        ? [fmtStamp(MAIL.last_sync), MAIL.last_error ? h("span.bad", {}, ` — failed: ${MAIL.last_error}`) : r ? h("span.muted", {}, ` — ${r.fetched} fetched, ${r.linked} linked, ${r.triage} to sort`) : ""]
        : "Not yet")),
    h("div.fields", {}, h("div.field", {}, h("label", { for: "gmail-every" }, "Sync"), every)),
    h("div.actions", {},
      h("button.al-button.al-button--primary", { type: "button", onclick: async (e) => {
        if (isBusy(e.currentTarget)) return;
        busy(e.currentTarget);
        e.currentTarget.textContent = "Syncing…";
        const rep = await attempt(() => post("mail/sync", {}));
        if (rep) toast(`${rep.fetched} fetched: ${rep.linked} linked, ${rep.triage} to sort`);
        rerender();
      } }, "Sync now"),
      h("a.al-button.al-button--sm", { href: "/inbox" }, "Open the Inbox"),
      h("button.al-button.al-button--quiet.al-button--danger", { type: "button", onclick: async () => {
        if (!(await confirmDelete("the Gmail connection", "Mail already brought in stays."))) return;
        if (await attempt(() => del("mail"))) { toast("Disconnected"); rerender(); }
      } }, "Disconnect")));
  const ignores = await get("mail/ignores");
  section.append(h("h3", {}, "Ignored"), ignores.length
    ? h("ul.plain.ignores", {}, ignores.map((i) => h("li", {}, i.kind === "domain" ? `Anything from @${i.value}` : i.value,
      h("button.al-button.al-button--icon.al-button--sm.al-button--danger", { type: "button", "aria-label": `Stop ignoring ${i.value}`, title: "Stop ignoring", onclick: async () => {
        if (await attempt(() => del(`mail/ignores/${i.id}`))) rerender();
      } }, "×"))))
    : h("p.muted", {}, "Nobody. “Ignore sender” in the Inbox adds them here."));
  return section;
}

// ---- the calendar ----------------------------------------------------------------------

/** What the calendar shows: interviews and deadlines, of active processes. */
const CAL_KINDS = ["step", "closes"];
const CAL_DEFAULTS = { view: "month", weekends: "", q: "" };
/** The calendar's choices, by their names in the address. */
const CAL_KEYS = Object.keys(CAL_DEFAULTS);
const CAL_VIEWS = ["month", "week", "day", "agenda"];

/**
 * The calendar's choices, from the address (/calendar?view=week&weekends=hide),
 * so a view can be bookmarked and Back undoes a change. Opened with none, it
 * has the ones last used.
 */
function calendarFilters() {
  let q = new URLSearchParams(location.search);
  if (!CAL_KEYS.some((k) => q.has(k))) {
    const kept = stored("calendar") || "";
    // Remembered before the choices were in the address, as JSON: its view.
    try { q = new URLSearchParams(kept.startsWith("{") ? { view: JSON.parse(kept).view || "" } : kept); } catch { q = new URLSearchParams(); }
  }
  const f = Object.fromEntries(CAL_KEYS.map((k) => [k, q.get(k) || CAL_DEFAULTS[k]]));
  if (!CAL_VIEWS.includes(f.view)) f.view = CAL_DEFAULTS.view;
  return f;
}

/** The address for these choices (and the day the view is around, if not today). */
function calendarUrl(f, day) {
  const q = new URLSearchParams(CAL_KEYS.filter((k) => f[k] !== CAL_DEFAULTS[k]).map((k) => [k, f[k]]));
  if (day) q.set("date", day);
  return location.pathname + (q.toString() ? `?${q}` : "");
}

const isoDay = (d) => d.toLocaleDateString("en-CA");
/** The day weeks start on: 1 for Monday, 0 for Sunday. */
const weekStart = () => (PREFS.week_start === "sunday" ? 0 : 1);
/** Saturday or Sunday. */
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;

/** An interview step's outcome, as Settings name it ("Passed"), if it has one. */
const stepOutcome = (e) => (e.kind === "step" && e.detail && e.detail !== "scheduled"
  ? (R("step").fields.find((x) => x.name === "status").options.find(([v]) => v === e.detail) || [, e.detail])[1]
  : null);
/** An event's classes: its kind, overdue, and an interview step's outcome. */
const eventClass = (e, late) => `kind-${e.kind}${late ? " late" : ""}${e.kind === "step" && e.detail ? ` step-${e.detail}` : ""}`;

/** What the calendar's colours and marks mean, under it. */
function calendarLegend() {
  const item = (cls, text) => h("li", {}, h(`span.cal-key.${cls}`, { "aria-hidden": "true" }), text);
  return h("ul.cal-legend", { "aria-label": "Key" },
    item("kind-step", "Interview"),
    item("kind-step.step-done", "Interview held"),
    item("kind-closes", "Application deadline"),
    PREFS.work_hours ? item("cal-key-off", "Outside working hours") : null,
    item("cal-key-now", "Now"));
}

/** The calendar: a month grid, a week, a day or an agenda, searched. */
async function showCalendar() {
  const f = calendarFilters();
  // The day the view is around: its month, its week, or itself.
  const today = () => { const d = zonedNow(); d.setHours(0, 0, 0, 0); return d; };
  const given = new URLSearchParams(location.search).get("date");
  let at = given && /^\d{4}-\d{2}-\d{2}$/.test(given) ? parseLocal(given) : today();
  const atParam = () => (isoDay(at) === isoDay(today()) ? "" : isoDay(at));
  // A change of view is a step Back undoes; moving through the months isn't.
  const keep = ({ push = true } = {}) => {
    const url = calendarUrl(f, atParam());
    if (url !== here()) history[push ? "pushState" : "replaceState"](null, "", url);
    lastUrl = here();
    store("calendar", new URLSearchParams(CAL_KEYS.filter((k) => f[k] !== CAL_DEFAULTS[k]).map((k) => [k, f[k]])).toString());
  };
  // Weekends can be hidden from the month and the week only: a day and the
  // agenda show what there is.
  const hasWeekends = () => f.view === "month" || f.view === "week";
  const weekends = () => !hasWeekends() || f.weekends !== "hide";

  const search = h("input", { type: "search", placeholder: "Search companies, roles, steps", "aria-label": "Search the calendar", value: f.q });
  const label = h("h2.cal-month");
  const views = h("div.al-segmented", { role: "group", "aria-label": "View" });
  const body = h("div.cal-body", { "aria-live": "polite" });
  const weekendBox = h("label.cal-kind", {}, h("input", { type: "checkbox", checked: weekends(), onchange: (e) => {
    f.weekends = e.target.checked ? "" : "hide"; keep(); load();
  } }), "Weekends");

  const setView = (v) => { f.view = v; keep(); renderViews(); drawWeekends(); load(); };
  const drawWeekends = () => { weekendBox.hidden = !hasWeekends(); };
  const renderViews = () => fill(views, [["month", "Month"], ["week", "Week"], ["day", "Day"], ["agenda", "Agenda"]].map(([v, l]) =>
    h("button", { type: "button", "aria-pressed": String(f.view === v), onclick: () => setView(v) }, l)));
  renderViews();
  drawWeekends();
  let timer;
  search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { f.q = search.value.trim(); keep({ push: false }); load(); }, 200); });
  // Back or on: a month, a week or a day, as the view shows.
  const step = (n) => {
    if (f.view === "week") at.setDate(at.getDate() + 7 * n);
    else if (f.view === "day") at.setDate(at.getDate() + n);
    else at = new Date(at.getFullYear(), at.getMonth() + n, 1);
    keep({ push: false }); load();
  };
  const unit = () => ({ week: "week", day: "day" })[f.view] || "month";

  async function load() {
    const ws = weekStart();
    let from, to;
    const month = new Date(at.getFullYear(), at.getMonth(), 1);
    if (f.view === "week") {
      from = new Date(at); from.setDate(at.getDate() - ((at.getDay() - ws + 7) % 7));
      to = new Date(from); to.setDate(from.getDate() + 6);
      const same = from.getMonth() === to.getMonth();
      label.textContent = `${from.toLocaleDateString(LOC(), { day: "numeric", month: same ? undefined : "short" })} – ${to.toLocaleDateString(LOC(), { day: "numeric", month: "short", year: "numeric" })}`;
    } else if (f.view === "day") {
      from = new Date(at); to = new Date(at);
      label.textContent = at.toLocaleDateString(LOC(), { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    } else {
      from = new Date(month);
      to = new Date(at.getFullYear(), at.getMonth() + 1, 0);
      // The month grid runs a week at a time (from Monday, or Sunday as
      // Settings say), so it shows a few days either side.
      if (f.view === "month") {
        from.setDate(from.getDate() - ((from.getDay() - ws + 7) % 7));
        to.setDate(to.getDate() + ((ws + 6 - to.getDay() + 7) % 7));
      }
      label.textContent = month.toLocaleDateString(LOC(), { month: "long", year: "numeric" });
    }
    for (const [b, dir] of [[prev, "Previous"], [next, "Next"]]) b.setAttribute("aria-label", `${dir} ${unit()}`);
    const q = new URLSearchParams({ from: isoDay(from), to: isoDay(to), kinds: CAL_KINDS.join(","), status: "active" });
    if (f.q) q.set("q", f.q);
    let events = await attempt(() => get(`calendar?${q}`));
    if (!events) return;
    // Weekends hidden (in the month or the week): their days leave the grid.
    if (!weekends()) events = events.filter((e) => !isWeekend(parseLocal(e.at.slice(0, 10))));
    fill(body, f.view === "month" ? monthGrid(from, to, month, events, weekends())
      : f.view === "week" ? weekGrid(from, events, weekends())
        : f.view === "day" ? dayGrid(at, events)
          : agenda(events));
  }

  const prev = h("button.al-button", { type: "button", onclick: () => step(-1) }, "‹");
  const next = h("button.al-button", { type: "button", onclick: () => step(1) }, "›");
  view.replaceChildren(h("div.page.calendar", {},
    h("div.al-page-head.page-head", {}, h("h1", {}, "Calendar"), searchBox(search),
      // Working hours, time zones and sharing with calendar apps: in Settings.
      h("a.al-button.al-button--icon.al-button--quiet", { href: "/settings?tab=calendar", "aria-label": "Calendar settings", title: "Calendar settings" }, systemIcon("settings"))),
    // Where it is; then, at the end, weekends and the view, centred on the same line.
    h("div.cal-bar", {},
      h("div.cal-nav", {},
        prev,
        h("button.al-button", { type: "button", onclick: () => { at = today(); keep({ push: false }); load(); } }, "Today"),
        next,
        label),
      h("div.cal-filters", {}, weekendBox, views)),
    body,
    calendarLegend()));
  keep({ push: false });
  await load();
}

/** Where an event leads: its process, or else its application. */
const eventHref = (e) => (e.process_id ? `/p/${e.process_id}` : `/applications/${e.application_id}`);

function eventLabel(e) {
  const time = e.at && e.at.length > 10 && !e.at.endsWith("T00:00") ? fmtTime(e.at.slice(11, 16)) : null;
  const late = e.kind === "next" && daysFromToday(parseLocal(e.at)) < 0;
  return { time, late };
}

function monthGrid(from, to, month, events, weekends = true) {
  const byDay = new Map();
  for (const e of events) {
    const d = e.at.slice(0, 10);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(e);
  }
  const today = isoDay(zonedNow());
  const days = [];
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) if (weekends || !isWeekend(d)) days.push(new Date(d));
  // Day names in the region's language, from the week's first day; without
  // the weekend's, while it's hidden.
  const names = [...Array(7)].map((_, i) => new Date(2024, 0, 7 + weekStart() + i))
    .filter((d) => weekends || !isWeekend(d)).map((d) => d.toLocaleDateString(LOC(), { weekday: "short" }));
  // A grid to see, not one to move around in with the arrow keys: each day
  // says its whole date to a screen reader, and its events are links.
  return h("div.cal-grid", { role: "group", "aria-label": "Month", style: `--cols: ${names.length}` },
    names.map((n) => h("div.cal-dow", { "aria-hidden": "true" }, n)),
    days.map((d) => {
      const key = isoDay(d);
      const items = byDay.get(key) || [];
      return h("div.cal-day", {
        class: [d.getMonth() !== month.getMonth() ? "outside" : "", key === today ? "today" : ""].join(" "),
      },
      h("span.cal-date", {}, h("span", { "aria-hidden": "true" }, d.getDate()),
        h("span.al-visually-hidden", {}, d.toLocaleDateString(LOC(), { weekday: "long", day: "numeric", month: "long" }))),
      items.map((e) => {
        const { time, late } = eventLabel(e);
        const outcome = stepOutcome(e);
        return h("a.ev", { href: eventHref(e), class: eventClass(e, late), title: `${e.title} — ${e.company}${e.role ? `, ${e.role}` : ""}${outcome ? ` (${outcome})` : ""}` },
          logoOf(e.company_id, e.company_logo, e.company, 14),
          time ? h("span.ev-time", {}, time) : null, h("span.ev-text", {}, `${e.company} · ${e.title}`));
      }));
    }));
}

/** A week: a column a day, its whole day's hours down the side. */
const weekGrid = (from, events, weekends = true) =>
  timeGrid([...Array(7)].map((_, i) => { const d = new Date(from); d.setDate(from.getDate() + i); return d; })
    .filter((d) => weekends || !isWeekend(d)), events, "Week");

/** A day: its whole day's hours down the side. */
const dayGrid = (day, events) => timeGrid([day], events, "Day");

/** The zone the calendar's times are in: hunt's, or else the browser's. */
const calendarZone = () => PREFS.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

/** A zone's offset from UTC, in ms, at an instant. */
function zoneOffset(zone, ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(ms).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
}

/** A day's hour in the calendar's zone, as the time it is then in another ("14:30"). */
function hourIn(day, hour, zone) {
  const wall = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), hour);
  const home = calendarZone();
  let at = wall - zoneOffset(home, wall);
  at = wall - zoneOffset(home, at);
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

/** A zone's short name on a day: its abbreviation or offset ("GMT+9"). */
function zoneShort(zone, day) {
  try {
    return new Intl.DateTimeFormat(LOC(), { timeZone: zone, timeZoneName: "short" }).formatToParts(day).find((p) => p.type === "timeZoneName")?.value || zone;
  } catch { return zone; }
}

/**
 * Days side by side, midnight to midnight: each event at its time and an
 * hour long (as calendar apps are given them), what has no time above them,
 * all day. Events at the same time share the column. The hours scroll, and
 * open on the morning (the working day's, if Settings give one), or earlier
 * if something is. Outside working hours is shaded; other time zones'
 * hours run beside the calendar's own.
 */
function timeGrid(days, events, name) {
  const HOUR = 2.1; // rem
  const minutes = (e) => Number(e.at.slice(11, 13)) * 60 + Number(e.at.slice(14, 16));
  const today = isoDay(zonedNow());
  const now = zonedNow();
  const fmtDay = (d) => d.toLocaleDateString(LOC(), { weekday: "long", day: "numeric", month: "long" });
  const block = (e, style) => {
    const { time, late } = eventLabel(e);
    const outcome = stepOutcome(e);
    return h("a.ev.ev-block", { href: eventHref(e), class: eventClass(e, late), style, title: `${e.title} — ${e.company}${e.role ? `, ${e.role}` : ""}${outcome ? ` (${outcome})` : ""}` },
      // The time and title on one line, so an hour holds the company too.
      h("span.ev-line", {}, time ? h("span.ev-time", {}, time) : null,
        h("span.ev-title", { translate: "no" }, e.title, outcome ? h("span.ev-outcome", {}, ` · ${outcome}`) : null)),
      h("span.ev-who", {}, logoOf(e.company_id, e.company_logo, e.company, 14), h("span", { translate: "no" }, e.company)));
  };
  const columns = days.map((d) => {
    const key = isoDay(d);
    const mine = events.filter((e) => e.at.slice(0, 10) === key);
    // Side by side where they overlap: each takes the first free column.
    const placed = [];
    for (const e of mine.filter((x) => eventLabel(x).time)) {
      const start = minutes(e);
      const busy = placed.filter((p) => p.start < start + 60 && start < p.start + 60).map((p) => p.col);
      let col = 0;
      while (busy.includes(col)) col++;
      placed.push({ e, start, col });
    }
    for (const p of placed) p.cols = 1 + Math.max(...placed.filter((q) => q.start < p.start + 60 && p.start < q.start + 60).map((q) => q.col));
    return { d, key, allDay: mine.filter((x) => !eventLabel(x).time), placed };
  });
  const earliest = Math.min(...columns.flatMap((c) => c.placed.map((p) => p.start)));
  const work = PREFS.work_hours;
  const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const weekday = (d) => ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][d.getDay()];
  // Outside working hours: the whole of a day off, or before and after.
  const shade = (d) => {
    if (!work) return null;
    if (!work.days.includes(weekday(d))) return h("div.cal-off", { style: "top: 0; bottom: 0" });
    return [h("div.cal-off", { style: `top: 0; height: calc(${mins(work.start) / 60} * var(--hour))` }),
      h("div.cal-off", { style: `top: calc(${mins(work.end) / 60} * var(--hour)); bottom: 0` })];
  };
  // Each zone's hours, the calendar's own last (beside the days), as the first day has them.
  const others = PREFS.calendar_zones || [];
  const gutter = (zone) => h("div.cal-gutter", { "aria-hidden": "true", class: zone ? "other" : "" }, [...Array(24)].map((_, n) =>
    h("span.cal-hour", {}, n ? fmtTime(zone ? hourIn(days[0], n, zone) : `${String(n).padStart(2, "0")}:00`) : "")));
  const zoneHeads = others.length ? [...others, calendarZone()].map((z) => h("span.cal-zone", { title: z }, zoneShort(z, days[0]))) : [h("span")];
  const scroller = h("div.cal-time-scroll", {},
    h("div.cal-time-body", {},
      others.map((z) => gutter(z)), gutter(null),
      columns.map((c) => h("section.cal-col", { class: c.key === today ? "today" : "", "aria-label": fmtDay(c.d) },
        shade(c.d),
        c.allDay.length ? h("ul.al-visually-hidden", {}, c.allDay.map((e) => h("li", {}, block(e)))) : null,
        c.placed.map((p) => block(p.e, `top: calc(${p.start / 60} * var(--hour)); height: var(--hour); inset-inline-start: ${(p.col / p.cols) * 100}%; width: ${100 / p.cols}%`)),
        c.key === today ? h("div.cal-now", { style: `top: calc(${(now.getHours() * 60 + now.getMinutes()) / 60} * var(--hour))`, "aria-hidden": "true" }) : null))));
  // Open an hour before the working day (or 7 in the morning without one),
  // or before the first thing, if earlier.
  const morning = work ? Math.max(0, Math.floor(mins(work.start) / 60) - 1) : 7;
  const open = Math.max(0, Math.min(morning, Number.isFinite(earliest) ? Math.floor(earliest / 60) - 1 : morning));
  requestAnimationFrame(() => {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    scroller.scrollTop = open * HOUR * rem;
  });
  const anyAllDay = columns.some((c) => c.allDay.length);
  // The days' and zones' names, and what has no time, held at the top as
  // the hours scroll: inside the scrolling, so they line up with its columns.
  scroller.prepend(h("div.cal-time-top", {},
    days.length > 1 || others.length ? h("div.cal-time-head", { "aria-hidden": "true" }, zoneHeads, columns.map((c) => h("div.cal-time-day", { class: c.key === today ? "today" : "" },
      days.length > 1 ? [h("span.cal-week-dow", {}, c.d.toLocaleDateString(LOC(), { weekday: "short" })), h("span.cal-date", {}, c.d.getDate())] : null))) : null,
    // What has no time, on its day; a screen reader hears it in its day's column.
    anyAllDay ? h("div.cal-time-allday", { "aria-hidden": "true" }, h("span.cal-hour.cal-allday-label", {}, "All day"),
      columns.map((c) => h("div.cal-allday-items", {}, c.allDay.map((e) => block(e))))) : null));
  return h("div.cal-time", { role: "group", "aria-label": name, style: `--hour: ${HOUR}rem; --days: ${days.length}; --zones: ${others.length + 1}` },
    scroller,
    events.length ? null : h("p.muted.small.cal-day-none", {}, `Nothing matches these filters this ${name.toLowerCase()}.`));
}

function agenda(events) {
  if (!events.length) return emptyState("Nothing this month", "Nothing matches these filters: try another month, or other filters.");
  const kindLabel = (k) => ({ step: "Interview", next: "Next action", closes: "Deadline", applied: "Applied", posted: "Posted" })[k] || k;
  const badge = (e) => {
    const outcome = stepOutcome(e);
    if (!outcome) return null;
    const tone = { passed: "success", completed: "success", failed: "danger" }[e.detail];
    return h(`span.al-badge${tone ? `.al-badge--${tone}` : ""}`, {}, outcome);
  };
  const groups = [];
  for (const e of events) {
    const d = e.at.slice(0, 10);
    if (!groups.length || groups[groups.length - 1][0] !== d) groups.push([d, []]);
    groups[groups.length - 1][1].push(e);
  }
  return h("ol.agenda", {}, groups.map(([d, items]) => h("li.agenda-day", {},
    h("h3", {}, h("time", { datetime: d }, parseLocal(d).toLocaleDateString(LOC(), { weekday: "long", day: "numeric", month: "long" })),
      daysFromToday(parseLocal(d)) === 0 ? h("span.al-badge.al-badge--accent", {}, "Today") : null),
    h("ul.agenda-items", {}, items.map((e) => {
      const { time, late } = eventLabel(e);
      return h("li", { class: eventClass(e, late) },
        h("span.agenda-time", {}, time || "All day"),
        h("span.agenda-kind", {}, kindLabel(e.kind)),
        h("a.agenda-what", { href: eventHref(e) }, h("b", {}, e.title), badge(e)),
        h("span.agenda-who", {}, logoOf(e.company_id, e.company_logo, e.company, 20), e.company, e.role ? h("span.muted", {}, ` — ${e.role}`) : null,
          e.stage ? h("span.muted.small", {}, ` · ${e.status === "archived" ? "closed at " : ""}${e.stage}`) : null),
        late ? h("span.due.late", {}, "overdue") : null);
    })))));
}

// ---- activity ------------------------------------------------------------------------

async function showActivity() {
  const filter = h("select", { "aria-label": "Show changes to" },
    h("option", { value: "" }, "Everything"),
    META.resources.map((r) => h("option", { value: r.entity }, r.title)));
  const list = h("ol.timeline.full");
  const load = async () => {
    const rows = await get(`activity?limit=300${filter.value ? `&entity=${filter.value}` : ""}`);
    list.replaceChildren(...rows.map((a) => {
      const page = routeOf(R(a.entity)?.name);
      const link = a.process_id ? `/p/${a.process_id}` : page && a.action !== "deleted" ? `/${page}/${a.entity_id}` : null;
      return h("li", { class: a.action }, h("time", { datetime: a.at }, fmtStamp(a.at)),
        link ? h("a", { href: link, translate: "no" }, a.summary) : h("span", { translate: "no" }, a.summary));
    }));
    if (!rows.length) list.append(h("li.muted", {}, "No changes yet."));
  };
  filter.addEventListener("change", load);
  view.replaceChildren(h("div.page", {}, h("div.al-page-head.page-head", {}, h("h1", {}, "Audit Log"), filter), h("section.al-panel.panel", {}, list)));
  await load();
}

// ---- routing ----------------------------------------------------------------------------

// Pages have real addresses (/applications/2, /stats): links within hunt
// change the address and draw the page without reloading; Back and Forward
// work. Old addresses (/#/applications/2) still lead to the same pages.

const here = () => location.pathname + location.search;

/** Go to a page of hunt. */
function go(path, { replace = false } = {}) {
  path = appPath(path);
  if (replace) history.replaceState(null, "", path);
  else if (path !== here()) history.pushState(null, "", path);
  route();
}

/**
 * Whether a record's page opens in Edit mode (?edit=1, from a list's edit
 * action). The address then drops it, so going back reads.
 */
function opensEditing(query) {
  if (query.get("edit") !== "1") return false;
  query.delete("edit");
  history.replaceState(null, "", location.pathname + (query.toString() ? `?${query}` : ""));
  lastUrl = here();
  return true;
}

// ---- icons ------------------------------------------------------------------------------

const ICONS = {
  refresh: "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8 M21 3v5h-5",
  chevron: "M6 9l6 6 6-6",
  edit: "M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z M15 5l4 4",
  mail: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z M22 6l-10 7L2 6",
  phone: "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z",
  eye: "M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  "eye-off": "M9.88 9.88a3 3 0 1 0 4.24 4.24 M10.73 5.08A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68 M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.39-1.61 M2 2l20 20",
  external: "M15 3h6v6 M10 14 21 3 M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
  remove: "M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M10 11v6 M14 11v6",
  plus: "M12 5v14M5 12h14",
  flag: "M4 22V4M4 4h12l-2 4 2 4H4",
  check: "M20 6 9 17l-5-5",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  bell: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0",
  cal: "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM16 2v4M8 2v4M3 10h18",
  archive: "M3 3h18v5H3zM5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M10 12h4",
  trash: "M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5",
  grip: "M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  download: "M12 3v12M7 10l5 5 5-5M5 21h14",
};

/** A line icon, drawn in the text's colour. */
function icon(name) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: 16, height: 16, fill: "none", stroke: "currentColor",
    "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(k, v);
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", ICONS[name]);
  // Arrows pointing out of the page point the other way, right to left.
  if (name === "external") svg.classList.add("flip-rtl");
  svg.append(path);
  return svg;
}

/**
 * Tooltips (the design system's) on the controls that are only an icon,
 * from their name (aria-label, or title, which then gives way so the
 * browser's own doesn't show too); and on the sidebar's links while it's
 * collapsed to icons. Set as the pointer or the focus comes to one, before
 * the tooltip looks, so they're in the page's language as it is then.
 */
function tipIcons(e) {
  const el = e.target.closest?.("button, a, summary, [role=button], [title]");
  if (!el || el.closest(".al-tooltip")) return;
  let name = null;
  if (el.matches(".al-sidebar__link")) {
    const rail = document.querySelector('[data-sidebar="collapsed"]') && !matchMedia("(max-width: 52rem)").matches;
    // Its label's lines (a cycle's: name, state, week) on one.
    if (rail) name = el.querySelector(".al-sidebar__label")?.innerText.trim().split(/\s*\n\s*/).join(" · ") || null;
    if (name) el.setAttribute("aria-label", name);
    else if (el.dataset.iconTip) el.removeAttribute("aria-label");
  } else if (el.querySelector("svg") && !el.textContent.trim()) {
    if (el.title && !el.getAttribute("aria-label")) el.setAttribute("aria-label", el.title);
    el.removeAttribute("title");
    name = el.getAttribute("aria-label");
  }
  if (name) {
    // "|name": the name in the tip's plain weight (its bold part, a value, is empty).
    el.dataset.alTip = `|${name}`;
    el.dataset.iconTip = "1";
  } else if (el.dataset.iconTip) {
    delete el.dataset.alTip;
    delete el.dataset.iconTip;
  }
}
document.addEventListener("pointerover", tipIcons, true);
document.addEventListener("focusin", tipIcons, true);
// The collapsed sidebar's tooltips: beside the link (after it, as the page
// reads), level with it, once the tooltip has put itself above.
function tipBeside(e) {
  const link = e.target.closest?.(".al-sidebar__link[data-icon-tip]");
  const tip = document.getElementById("al-tooltip");
  if (!link || !tip || tip.hidden) return;
  const r = link.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  const rtl = getComputedStyle(link).direction === "rtl";
  tip.style.left = `${rtl ? r.left - 8 - t.width : r.right + 8}px`;
  tip.style.top = `${Math.max(8, r.top + r.height / 2 - t.height / 2)}px`;
}
window.addEventListener("pointerover", tipBeside);
window.addEventListener("focusin", tipBeside);

/**
 * A listing row's actions: edit (its page, in Edit mode) and remove; and,
 * given `onRefresh`, refresh (from its LinkedIn link).
 */
function rowIcons(what, editHref, onRemove, onRefresh) {
  return h("td.row-icons", {},
    onRefresh ? h("button.al-button.al-button--icon.al-button--sm", { type: "button", "aria-label": `Refresh ${what} from LinkedIn`, title: "Refresh from LinkedIn", onclick: onRefresh }, icon("refresh")) : null,
    h("a.al-button.al-button--icon.al-button--sm", { href: editHref, "aria-label": `Edit ${what}`, title: "Edit" }, icon("edit")),
    h("button.al-button.al-button--icon.al-button--sm.al-button--danger", { type: "button", "aria-label": `Remove ${what}`, title: "Remove", onclick: onRemove }, icon("remove")));
}

/**
 * A table's columns, each hideable: an eye on its header (not the first,
 * nor Actions) hides it, and the hidden ones are listed above the table to
 * show again. Remembered per table, by `key`. A column is known by its
 * header's `data-col`, or its text. Call again whenever the header is
 * redrawn; hiding is a stylesheet, so redrawn rows stay hidden too.
 */
function hideableColumns(key, table) {
  const storeKey = `hiddenColumns:${key}`;
  let hidden;
  try { hidden = new Set(JSON.parse(stored(storeKey) || "[]")); } catch { hidden = new Set(); }
  const save = () => store(storeKey, JSON.stringify([...hidden]));
  const ths = [...table.querySelectorAll("thead tr > th")];
  const name = (th) => th.dataset.col || th.textContent.replace(/[↑↓]/g, "").trim();
  const label = (th) => (th.querySelector(".th-sort")?.firstChild?.textContent || th.textContent).replace(/[↑↓]/g, "").trim();
  table.dataset.columns = key;
  // Not the checkboxes, nor the first column after them (the name), nor Actions.
  const first = ths.findIndex((th) => !th.classList.contains("row-select"));
  const fixed = (th, i) => i <= first || th.classList.contains("row-icons");
  ths.forEach((th, i) => {
    if (fixed(th, i) || th.querySelector(".col-hide")) return;
    th.classList.add("hideable");
    th.append(h("button.col-hide", { type: "button", title: `Hide ${label(th)}`, "aria-label": `Hide the ${label(th)} column`,
      onclick: (e) => { e.stopPropagation(); hidden.add(name(th)); save(); apply(); } }, icon("eye-off")));
  });
  // What's hidden, to show again: just above the table.
  const wrap = table.closest(".al-table-wrap") || table;
  let bar = wrap.previousElementSibling?.classList.contains("hidden-columns") ? wrap.previousElementSibling : null;
  if (!bar) { bar = h("div.hidden-columns"); wrap.before(bar); }
  let sheet = document.getElementById(`columns-${key}`);
  if (!sheet) { sheet = h("style", { id: `columns-${key}` }); document.head.append(sheet); }
  function apply() {
    const at = ths.map((th, i) => (hidden.has(name(th)) && !fixed(th, i) ? i + 1 : null)).filter(Boolean);
    sheet.textContent = at.map((n) => `table[data-columns="${key}"] tr > :nth-child(${n}) { display: none; }`).join("\n");
    const gone = ths.filter((th) => hidden.has(name(th)));
    fill(bar, gone.length ? [h("span.muted.small", {}, "Hidden:"),
      gone.map((th) => h("button.chip-button", { type: "button", title: `Show ${label(th)}`, onclick: () => { hidden.delete(name(th)); save(); apply(); } },
        icon("eye"), label(th))),
      gone.length > 1 ? h("button.al-button.al-button--sm.al-button--quiet", { type: "button", onclick: () => { hidden.clear(); save(); apply(); } }, "Show all") : null] : []);
    bar.hidden = !gone.length;
  }
  apply();
}

// Where we were, to go back to when leaving would lose changes.
let lastUrl = here();
// The page's own title, for pages that put theirs first.
const BASE_TITLE = document.title;

async function route() {
  if (typeof leaveGuard === "function" && leaveGuard() && here() !== lastUrl) {
    if (!confirm("Leave without saving your changes?")) {
      history.pushState(null, "", lastUrl || APP);
      return;
    }
  }
  leaveGuard = null;
  window.onbeforeunload = null;
  lastUrl = here();
  const path = appless(location.pathname);
  if (path === "/linkedin") { await importSentProfile(); return; }
  const [, page = "", arg] = path.split("/");
  const query = new URLSearchParams(location.search);
  const section = page === "" && query.get("cycle") ? "cycles"
    : ["", "p", "applications"].includes(page) ? "board"
    : ["companies", "people", "contacts"].includes(page) ? "contacts" : page;
  document.querySelectorAll(".sidebar a[data-nav]").forEach((a) => {
    const on = a.dataset.nav === section;
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  // On a phone, the bar says where you are: the current section's name.
  const current = document.querySelector('.sidebar a[data-nav][aria-current="page"] .al-sidebar__label');
  fill(document.getElementById("sidebar-here"), current?.firstChild?.textContent.trim() || "");
  if (typeof statsTip === "function") statsTip.hide();
  if (typeof drawCycleBox === "function") drawCycleBox();
  // The one dialog left (a new application) closes as the page changes.
  if (modal.open) { modal.onClose = null; modal.close(); }
  try {
    if (page === "") {
      // An offer accepted: the home page celebrates it, until "Back to the board".
      const offer = await celebrating();
      if (offer) { await showCelebration(offer); return; }
      // The Tracking Board opens as it was last seen: board or table, and
      // with the filters last used.
      if (stored("boardMode") === "table") { go(`/applications${location.search}`, { replace: true }); return; }
      restoreFilters();
      await showBoard();
    } else if (page === "applications" && !arg) {
      store("boardMode", "table");
      restoreFilters();
      await showApplicationsTable();
    } else if (page === "p" && arg) {
      // A process: its application's page (older links, the calendar, the log).
      const p = await get(`processes/${arg}`);
      go(`/applications/${p.application_id}?process=${p.id}`, { replace: true });
      return;
    } else if (page === "applications" && arg) {
      await showApplication(Number(arg), { processId: Number(query.get("process")) || null, editing: opensEditing(query) });
    } else if (LISTS[page]) {
      if (arg === "new") showNewRecord(page);
      else if (arg) await showRecordPage(page, Number(arg), { versionId: Number(query.get("version")) || null, editing: opensEditing(query) });
      else await showList(page);
    } else if (page === "contacts") {
      const kept = stored("contacts");
      if (["companies", "people"].includes(kept) && !query.has("all")) { go(`/${kept}`, { replace: true }); return; }
      await showContacts();
    } else if (page === "cycles") await showCycles();
    else if (page === "prep") await showPrep();
    else if (page === "calendar") await showCalendar();
    else if (page === "inbox" && GMAIL) await showInbox();
    else if (page === "settings") await showSettings();
    else if (page === "notes") await showNotes();
    else if (page === "stats") await showStats();
    else if (page === "activity") await showActivity();
    else if (page === "celebrate") await showCelebration();
    else if (page === "admin") await showAdmin();
    else if (page === "take-home") await showTakeHome();
    else go("/", { replace: true });
  } catch (e) {
    toast(e.message, "error");
  }
  if (!(LISTS[page] && arg && arg !== "new")) document.title = BASE_TITLE;
}

window.addEventListener("popstate", route);

// Links within hunt: drawn here, not loaded again.
document.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest("a[href]");
  // data-reload: one of hunt's own pages outside the app (the privacy notice …).
  if (!a || a.target || a.hasAttribute("download") || a.hasAttribute("data-reload")) return;
  const url = new URL(a.href, location.href);
  // Cloudflare's own pages (/cdn-cgi/: Access's log out and identity) aren't hunt's.
  // Only the dashboard's own pages: the rest of the site loads as pages do.
  if (url.origin !== location.origin || !(url.pathname === APP || url.pathname.startsWith(`${APP}/`))) return;
  e.preventDefault();
  go(url.pathname + url.search);
});

// An old address, with the page after #: the same page, at its new address.
if (location.hash.startsWith("#/")) history.replaceState(null, "", appPath(location.hash.slice(1)));

// The theme (Settings → Appearance): auto follows the system; light or
// dark is remembered, in this browser.
const THEMES = [["auto", "Auto (follow the system)"], ["light", "Light"], ["dark", "Dark"]];
const currentTheme = () => stored("theme") || "auto";
function setTheme(t) {
  store("theme", t);
  if (t === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

// Deferred scripts all run before DOMContentLoaded (readyState is already
// "interactive" while they do, so it can't tell): listened for while this
// one runs, so it's never missed.
const scriptsLoaded = new Promise((r) => document.addEventListener("DOMContentLoaded", r, { once: true }));

(async function start() {
  try {
    await reloadMeta();
    setLanguage(PREFS.language || "en", PREFS.numerals || "auto");
    // Shared, and not (yet) theirs: the account screen, and nothing else.
    if (META.tenancy && META.tenancy.account?.status !== "active") {
      await scriptsLoaded;
      await showAccountScreen();
      return;
    }
    if (GMAIL) {
      updateInboxCount();
      setInterval(updateInboxCount, 120000);
    } else {
      document.querySelector('[data-nav="inbox"]')?.remove();
    }
  } catch (e) {
    view.replaceChildren(h("div.page", {}, h("h1", {}, "Can't load hunt"), h("p", {}, e.message)));
    return;
  }
  // The other scripts (application.js, settings.js …) run after this one:
  // draw the page once they all have.
  await scriptsLoaded;
  route();
})();
