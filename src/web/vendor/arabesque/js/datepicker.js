// Date picker: a text field for a date near today, with a calendar to
// choose it from (the WAI-ARIA APG date picker dialog). Unlike the
// browser's <input type="date">, it speaks the page's language: month and
// day names, the order of the week, the digits people chose (Western or
// Arabic-Indic) and, in right to left, a grid that runs from the right.
// The date can always be typed instead, in either digit set; it's kept as
// an ISO date (2026-11-30) in a hidden field that takes the input's name.
// Gregorian only.
//
//   <div class="al-field">
//     <label class="al-label" for="due">Due date</label>
//     <span class="al-hint" id="due-hint">For example, <span data-al-date-example="2026-11-30">30/11/2026</span></span>
//     <div class="al-date-picker">
//       <input class="al-input" id="due" name="due" value="2026-11-30" aria-describedby="due-hint" data-al-date-picker>
//       <button type="button" class="al-button al-button--icon al-date-picker__toggle" aria-label="Choose date">
//         <svg class="al-icon" aria-hidden="true"><use href="/dist/icons.svg#al-icon-calendar"></use></svg></button>
//     </div>
//   </div>
//   const [due] = initDatePickers(document, { numerals: () => chosenDigits });
//   due.value; // "2026-11-30"
//
// In the calendar: arrow keys move by day and week (along the reading
// direction), Home and End to the week's ends, Page Up and Page Down by
// month (with Shift, by year), Enter or Space chooses, Escape closes;
// focus goes back to the button. data-min and data-max (ISO) on the input
// limit what can be chosen.

import { numberLocale } from "./format.js";
import { place } from "./position.js";

const SPRITE = new URL("../dist/icons.svg", import.meta.url).href;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
let uid = 0;

// ---- dates, without time zones ------------------------------------------------------------
// A date-only value is a day, not a moment: kept as "YYYY-MM-DD", worked on
// as UTC midnight so no time zone moves it.

const toDate = (iso) => { const [, y, m, d] = ISO.exec(iso); return new Date(Date.UTC(+y, +m - 1, +d)); };
const toIso = (date) => date.toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return toIso(d); };
const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
/** The same day n months on, or the month's last if it has fewer days (31 Jan + 1 → 28 Feb). */
function addMonths(iso, n) {
  const d = toDate(iso);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const target = new Date(Date.UTC(y, m, 1));
  target.setUTCDate(Math.min(d.getUTCDate(), daysIn(target.getUTCFullYear(), target.getUTCMonth())));
  return toIso(target);
}
/** Today, where the person is. */
export function today() {
  const d = new Date();
  return toIso(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
}
const clamp = (iso, min, max) => (min && iso < min ? min : max && iso > max ? max : iso);

// ---- the language -------------------------------------------------------------------------

const locale = (lang, numerals) => numberLocale(lang, numerals);
const fmt = (lang, numerals, options) => new Intl.DateTimeFormat(locale(lang, numerals), { timeZone: "UTC", calendar: "gregory", ...options });

/** The first day of the week where the language is used, as JS counts days (0 Sunday … 6 Saturday). */
export function weekStart(lang = "en") {
  try {
    const l = new Intl.Locale(locale(lang, "latn"));
    const first = (l.getWeekInfo?.() ?? l.weekInfo)?.firstDay;
    if (first) return first % 7;
  } catch {}
  return String(lang).startsWith("ar") ? 6 : 1;
}

/** A date as it's written in the language and digits: "30/11/2026", "٣٠‏/١١‏/٢٠٢٦". */
export function formatDate(iso, { lang = "en", numerals = "latn" } = {}) {
  return ISO.test(iso ?? "") ? fmt(lang, numerals, { day: "numeric", month: "numeric", year: "numeric" }).format(toDate(iso)) : "";
}

/** A typed date, day first (as written in both English and Arabic), in
 *  either digit set, with any separators: "30/11/2026", "٣٠/١١/٢٠٢٦",
 *  "30-11-26", and formatDate's own output. An ISO date is read as one.
 *  null if it isn't a date that exists. */
export function parseDate(text) {
  const s = String(text ?? "")
    .replace(/[‎‏؜⁦-⁩]/g, "")
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0))
    .trim();
  if (ISO.test(s)) return toIso(toDate(s)) === s ? s : null;
  const parts = s.split(/[^\d]+/).filter(Boolean).map(Number);
  if (parts.length !== 3) return null;
  let [d, m, y] = parts;
  if (y < 100) y += 2000;
  if (y < 1000 || m < 1 || m > 12 || d < 1 || d > daysIn(y, m - 1)) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** A month as weeks of 7 ISO dates, starting on weekStart; null outside the month. */
export function monthGrid(year, month, start = 1) {
  const lead = (new Date(Date.UTC(year, month, 1)).getUTCDay() - start + 7) % 7;
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysIn(year, month) }, (_, i) => toIso(new Date(Date.UTC(year, month, i + 1))))];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/** Where a key moves the focused date; null if the key doesn't move it. */
export function step(iso, key, { rtl = false, shift = false, start = 1 } = {}) {
  const day = toDate(iso).getUTCDay();
  switch (key) {
    case "ArrowRight": return addDays(iso, rtl ? -1 : 1);
    case "ArrowLeft": return addDays(iso, rtl ? 1 : -1);
    case "ArrowDown": return addDays(iso, 7);
    case "ArrowUp": return addDays(iso, -7);
    case "Home": return addDays(iso, -((day - start + 7) % 7));
    case "End": return addDays(iso, 6 - ((day - start + 7) % 7));
    case "PageDown": return addMonths(iso, shift ? 12 : 1);
    case "PageUp": return addMonths(iso, shift ? -12 : -1);
    default: return null;
  }
}

// ---- the picker ---------------------------------------------------------------------------

const DEFAULT_LABELS = { previous: "Previous month", next: "Next month" };
const read = (v) => (typeof v === "function" ? v() : v);
const icon = (name, cls = "al-icon") => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `${SPRITE}#al-icon-${name}`);
  svg.append(use);
  return svg;
};
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) e.setAttribute(k, v === true ? "" : v);
  e.append(...kids.filter((k) => k != null));
  return e;
};

/** Every [data-al-date-picker] input under root becomes a date picker. Returns their controllers. */
export function initDatePickers(root = document, options = {}) {
  return [...root.querySelectorAll("input[data-al-date-picker]")].map((input) => input.alDatePicker ?? datePicker(input, options));
}

function datePicker(input, { labels = DEFAULT_LABELS, numerals = "latn", lang } = {}) {
  const wrap = input.closest(".al-date-picker") ?? input.parentElement;
  const toggle = wrap.querySelector(".al-date-picker__toggle");
  const id = input.id || (input.id = `al-date-${++uid}`);
  const langOf = () => read(lang) || input.closest("[lang]")?.lang || "en";
  const opts = () => ({ lang: langOf(), numerals: read(numerals) || "latn" });
  const words = () => ({ ...DEFAULT_LABELS, ...read(labels) });
  const min = () => (ISO.test(input.dataset.min ?? "") ? input.dataset.min : null);
  const max = () => (ISO.test(input.dataset.max ?? "") ? input.dataset.max : null);

  // The value travels in a hidden field with the input's name; the input
  // shows it as it's written.
  const hidden = el("input", { type: "hidden", name: input.name || null });
  input.removeAttribute("name");
  input.after(hidden);
  input.setAttribute("autocomplete", "off");
  let value = parseDate(input.value);
  const show = () => { if (value) input.value = formatDate(value, opts()); hidden.value = value ?? ""; };
  // The hint's example, written as the field will show it.
  const examples = () => {
    const field = input.closest(".al-field") ?? wrap;
    for (const e of field.querySelectorAll("[data-al-date-example]")) e.textContent = formatDate(e.dataset.alDateExample, opts());
  };

  const onChange = () => {
    value = input.value.trim() ? parseDate(input.value) : null;
    hidden.value = value ?? "";
    if (value) input.value = formatDate(value, opts());
  };
  input.addEventListener("change", onChange);

  // The calendar: a modal dialog, placed under the field.
  const dialog = el("dialog", { class: "al-date-picker__dialog", "aria-labelledby": `${id}-title` });
  const title = el("h2", { class: "al-date-picker__title", id: `${id}-title`, "aria-live": "polite" });
  const prev = el("button", { type: "button", class: "al-button al-button--icon al-button--sm al-date-picker__prev" }, icon("chevron"));
  const next = el("button", { type: "button", class: "al-button al-button--icon al-button--sm al-date-picker__next" }, icon("chevron"));
  const grid = el("table", { class: "al-date-picker__grid", role: "grid", "aria-labelledby": `${id}-title` });
  dialog.append(el("div", { class: "al-date-picker__head" }, prev, title, next), grid);
  // The dialog is in the page only while it's open, so a page that redraws
  // its forms (and the pickers in them) doesn't gather closed calendars.

  let focused = null; // the date with the grid's tab stop
  let restore = null;

  function render() {
    const { lang: l, numerals: n } = opts();
    const start = weekStart(l);
    const d = toDate(focused);
    const [y, m] = [d.getUTCFullYear(), d.getUTCMonth()];
    // The dialog is in the language it's drawn in (and a page's translation
    // passes it by).
    dialog.lang = l;
    dialog.dir = getComputedStyle(input).direction;
    title.textContent = fmt(l, n, { month: "long", year: "numeric" }).format(d);
    const w = words();
    prev.setAttribute("aria-label", w.previous);
    next.setAttribute("aria-label", w.next);
    // No month to go to that's all out of range.
    const first = toIso(new Date(Date.UTC(y, m, 1)));
    prev.disabled = !!min() && addDays(first, -1) < min();
    next.disabled = !!max() && addMonths(first, 1) > max();

    // Short day names, or the narrowest where the short ones are long
    // (Arabic's are the full names); the full name is what's read.
    const days = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2026, 10, 1 + ((start + i) % 7)))); // 1 Nov 2026 is a Sunday
    const short = days.map((x) => fmt(l, n, { weekday: "short" }).format(x));
    const shown = short.some((s) => s.length > 3) ? days.map((x) => fmt(l, n, { weekday: "narrow" }).format(x)) : short;
    const head = el("thead", {}, el("tr", {}, ...days.map((x, i) => el("th", { scope: "col", abbr: fmt(l, n, { weekday: "long" }).format(x) },
      el("span", { "aria-hidden": "true" }, shown[i]), el("span", { class: "al-visually-hidden" }, fmt(l, n, { weekday: "long" }).format(x))))));

    const now = today();
    const dayNum = fmt(l, n, { day: "numeric" });
    const full = fmt(l, n, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const body = el("tbody", {}, ...monthGrid(y, m, start).map((week) => el("tr", {}, ...week.map((iso) => {
      if (!iso) return el("td");
      const out = (min() && iso < min()) || (max() && iso > max());
      return el("td", {
        "data-date": iso,
        tabindex: iso === focused ? "0" : "-1",
        "aria-label": full.format(toDate(iso)),
        "aria-selected": String(iso === value),
        "aria-current": iso === now ? "date" : null,
        "aria-disabled": out ? "true" : null,
      }, dayNum.format(toDate(iso)));
    }))));
    grid.replaceChildren(head, body);
  }

  const cell = () => grid.querySelector(`[data-date="${focused}"]`);
  const moveTo = (iso) => {
    focused = clamp(iso, min(), max());
    render();
    cell()?.focus();
  };
  const reposition = () => { if (dialog.open) place(dialog, wrap); };
  let frame = 0;
  const follow = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(reposition); };

  function open() {
    if (dialog.open) return;
    onChange();
    restore = toggle ?? input;
    focused = clamp(value ?? today(), min(), max());
    render();
    document.body.append(dialog);
    dialog.showModal();
    reposition();
    addEventListener("resize", follow);
    addEventListener("scroll", follow, true);
    cell()?.focus();
  }
  // Focus goes back at once, not when the close event comes (a task later),
  // so nothing in between finds it on the page itself.
  function close() {
    if (!dialog.open) return;
    dialog.close();
    restore?.focus();
  }
  function choose(iso) {
    if (!iso || (min() && iso < min()) || (max() && iso > max())) return;
    value = iso;
    show();
    close();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  dialog.addEventListener("close", () => {
    removeEventListener("resize", follow);
    removeEventListener("scroll", follow, true);
    dialog.remove();
    restore?.focus();
  });
  // A click outside the calendar (on the backdrop) closes it.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
    }
    const td = e.target.closest?.("td[data-date]");
    if (td && td.getAttribute("aria-disabled") !== "true") choose(td.dataset.date);
  });
  prev.addEventListener("click", () => { focused = clamp(addMonths(focused, -1), min(), max()); render(); });
  next.addEventListener("click", () => { focused = clamp(addMonths(focused, 1), min(), max()); render(); });
  grid.addEventListener("keydown", (e) => {
    if (!e.target.closest?.("td[data-date]")) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (e.target.getAttribute("aria-disabled") !== "true") choose(focused);
      return;
    }
    const to = step(focused, e.key, { rtl: dialog.dir === "rtl", shift: e.shiftKey, start: weekStart(opts().lang) });
    if (!to) return;
    e.preventDefault();
    moveTo(to);
  });
  // Clicking a day focuses it too, so the tab stop follows.
  grid.addEventListener("focusin", (e) => {
    const td = e.target.closest?.("td[data-date]");
    if (td && td.dataset.date !== focused) { focused = td.dataset.date; for (const c of grid.querySelectorAll("td[tabindex]")) c.tabIndex = c === td ? 0 : -1; }
  });
  toggle?.addEventListener("click", open);
  // Alt+Down opens it from the field, as a select opens.
  const onKey = (e) => { if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); open(); } };
  input.addEventListener("keydown", onKey);

  show();
  examples();

  const controller = {
    input,
    get value() { return value; },
    set value(iso) { value = parseDate(iso); if (!value) input.value = ""; show(); },
    open,
    close,
    /** Draw again in the current language and digits (after a language or digits change). */
    refresh() { show(); examples(); if (dialog.open) render(); },
    /** Take the picker away: the input keeps its last value and name. */
    destroy() {
      close();
      dialog.remove();
      input.removeEventListener("change", onChange);
      input.removeEventListener("keydown", onKey);
      toggle?.removeEventListener("click", open);
      input.name = hidden.name;
      input.value = value ?? input.value;
      hidden.remove();
      delete input.alDatePicker;
    },
  };
  input.alDatePicker = controller;
  return controller;
}
