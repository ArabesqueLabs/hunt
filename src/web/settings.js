"use strict";

// The Settings page (/settings): groups that fold from their headings, made
// of sections that read first. A section's Edit (or a row's edit, remove,
// or "+ Add …") opens it for changes; Done, Save or Cancel closes it again.
// Built on app.js.

let settingsFolds = {};
try { settingsFolds = JSON.parse(stored("settingsFolds") || "{}"); } catch { settingsFolds = {}; }

/**
 * A group of settings, folded from its heading; remembered. Some start
 * folded (`folded`), until opened.
 */
function settingsGroup(key, title, about, ...sections) {
  return foldedGroup(key, title, about, false, ...sections);
}

function foldedGroup(key, title, about, folded, ...sections) {
  return h("details.al-disclosure.settings-group", {
    open: !(settingsFolds[key] ?? folded), dataset: { group: key },
    ontoggle: (e) => { settingsFolds[key] = !e.currentTarget.open; store("settingsFolds", JSON.stringify(settingsFolds)); },
  },
  h("summary", {}, h("h2", {}, title), about ? h("span.muted.small", {}, about) : null),
  h("div.settings-body", {}, sections));
}

/** Settings are your account's; a section kept in this browser instead says so. */
const FOR = { browser: "This browser" };

/** A section: its title, who it's for, and Edit (or Done) beside it when it can be changed. */
function settingsPanel(title, { editing = false, onToggle = null, intro = null, done = "Done", who = null } = {}) {
  return h("section.al-panel.panel.settings-panel", { class: editing ? "editing" : "" },
    h("div.panel-head", {}, title ? h("h2", {}, title) : h("span"),
      FOR[who] ? h("span.al-badge.al-badge--outline", {}, FOR[who]) : null,
      onToggle ? h("button.al-button.al-button--sm.al-button--quiet.settings-edit", { type: "button", onclick: () => onToggle(!editing) }, editing ? done : "Edit") : null),
    intro ? h("p.muted", {}, intro) : null);
}

/** A row's edit and remove links. */
const rowActions = (what, { edit, remove }) => h("span.row-actions", {},
  edit ? h("button.al-button.al-button--sm.al-button--quiet", { type: "button", "aria-label": `Edit ${what}`, onclick: edit }, "edit") : null,
  remove ? h("button.al-button.al-button--sm.al-button--quiet.al-button--danger", { type: "button", "aria-label": `Remove ${what}`, onclick: remove }, "remove") : null);

/** The label of a {value, label} choice. */
const choiceLabel = (choices, v) => (choices.find((c) => c.value === v) || { label: v }).label;

const addLink = (label, onclick) => h("button.al-button.al-button--quiet.app-add", { type: "button", onclick }, `+ ${label}`);

/** Save and Cancel, for a section edited as a whole. */
const saveCancel = (save, cancel) => h("div.actions", {},
  h("button.al-button.al-button--primary", { type: "button", onclick: save }, "Save"),
  h("button.al-button", { type: "button", onclick: cancel }, "Cancel"));

/** Settings' tabs: each one's key, name, and what's in it. */
const SETTINGS_TABS = [
  ["general", "General", "Appearance, language"],
  ["board", "Board", "Swimlanes, stages, sub stages"],
  ["calendar", "Calendar", "Hours, time zones, sharing"],
  ["data", "Data", "Backup, audit log"],
  ["connections", "Connections", GMAIL ? "LinkedIn, Gmail" : "LinkedIn"],
  ["pay", "Pay and tax", "Where you live, take-home"],
  ["tags", "Tags", ""],
  ["account", "Account", "Signing in, deleting"],
];

async function showSettings() {
  // Back from signing in with Google: say how it went, then tidy the address.
  const q = new URLSearchParams(location.search);
  if (q.get("gmail") === "connected") toast(`Signed in with Google as ${q.get("address")}`);
  if (q.get("gmail_error")) toast(`Signing in with Google didn't work: ${q.get("gmail_error")}`, "error");
  const tabs = SETTINGS_TABS.filter(([k]) => k !== "account" || myAccount() || META.access);
  const tab = tabs.some(([k]) => k === q.get("tab")) ? q.get("tab") : (tabs.some(([k]) => k === stored("settingsTab")) ? stored("settingsTab") : "general");
  history.replaceState(null, "", appPath(`/settings${tab === "general" ? "" : `?tab=${tab}`}`));
  lastUrl = here();
  store("settingsTab", tab);
  const body = h("div.settings-content", { id: "settings-content", role: "region", "aria-labelledby": `settings-tab-${tab}` });
  const page = h("div.page.settings", {},
    h("header.al-page-head", {}, h("h1", {}, "Settings"),
      h("p.al-page-head__lede", {}, "Your preferences.")),
    h("div.settings-layout", {},
      h("nav.settings-nav", { "aria-label": "Settings sections" }, tabs.map(([k, label, hint]) => h("a", {
        href: `/settings?tab=${k}`, id: `settings-tab-${k}`, "aria-current": k === tab ? "page" : null,
        onclick: (e) => { e.preventDefault(); store("settingsTab", k); go(`/settings?tab=${k}`); },
      }, h("span", {}, label), h("span.settings-nav-hint", {}, k === "tags" ? `${TAGS.length} ${TAGS.length === 1 ? "tag" : "tags"}` : hint)))),
      body));
  view.replaceChildren(page);
  const parts = {
    general: () => [themeSettings(), localeSettings()],
    pay: () => [locationSettings(), takeHomeOn() ? desiredSettings() : null],
    board: async () => [await boardSettings()],
    tags: async () => [await tagsSettings()],
    calendar: () => [calendarSettings(), calendarFeedSettings()],
    connections: async () => [await linkedinSettings(), GMAIL ? await gmailSettings() : null],
    data: () => [backupSettings(), auditSettings()],
    account: () => [myAccount() ? accountSettings() : signInSettings()],
  };
  fill(body, (await parts[tab]()).filter(Boolean));
}

/** The calendar's private link (`/api/calendar/<secret>.ics`), while it's shared; null when not. */
const calendarFeedUrl = () => (PREFS.calendar_feed ? `${location.origin}/api/calendar/${PREFS.calendar_feed}.ics` : null);

/**
 * Sharing the calendar with a calendar app: off unless turned on. On, a
 * private link anyone who has it can subscribe to; a new one, and the old
 * one stops working; off, it stops working.
 */
function calendarFeedSettings() {
  const section = settingsPanel("Calendar sharing", { intro: "Interviews, deadlines and reminders, in any calendar app that can subscribe to a link." });
  const set = async (value, message) => {
    const saved = await attempt(() => patch("settings", { calendar_feed: value }));
    if (!saved) return false;
    PREFS = saved;
    toast(message);
    section.replaceWith(calendarFeedSettings());
    return true;
  };
  const url = calendarFeedUrl();
  const sw = h("input", { type: "checkbox", role: "switch", id: "set-calendar-share", checked: !!url, onchange: async (e) => {
    if (!(await set(e.target.checked, e.target.checked ? "Calendar shared: copy its link into a calendar app" : "Calendar no longer shared: its link has stopped working"))) e.target.checked = !e.target.checked;
  } });
  section.append(h("label.switch", { for: "set-calendar-share" }, sw, url ? "Shared with a private link" : "Not shared"));
  if (url) {
    section.append(
      h("div.settings-copy", {},
        h("input", { readonly: true, "aria-label": "Calendar link", value: url, class: "settings-mono" }),
        h("button.al-button", { type: "button", onclick: async () => {
          try { await navigator.clipboard.writeText(url); toast("Copied the calendar link"); } catch { toast("Couldn't copy; select the link instead", "error"); }
        } }, icon("copy"), h("span", {}, "Copy link"))),
      h("p.al-hint", {}, "Anyone with the link can see these events, without signing in. ",
        h("button.al-button.al-button--quiet.al-button--sm", { type: "button", onclick: () => set("new", "Made a new link. The old one stops working now.") }, "Make a new link")));
    if (META.access) section.append(h("p.muted.small", {}, "This hunt is behind Cloudflare Access: for a calendar app to reach the link, Access needs a Bypass policy for the path /api/calendar/."));
  }
  return section;
}

/** Every change made, newest first: on a page of its own. */
function auditSettings() {
  const section = settingsPanel("Audit log", { who: "everyone", intro: "Every change you've made, newest first: what, when and to what." });
  section.append(h("a.al-link.al-link--arrow", { href: "/activity" }, "Open the audit log"));
  return section;
}

/** Signed in through Cloudflare Access, with no account here: who, and signing out. */
function signInSettings() {
  const section = settingsPanel("Your account", { who: "you" });
  section.append(h("dl.facts", {},
    h("dt", {}, "Signed in as"), h("dd", { translate: "no" }, META.access?.email || "—"),
    h("dt", {}, "Sign-in"), h("dd", {}, "Cloudflare Access")),
  h("div.actions", {}, h("a.al-button", { href: "/cdn-cgi/access/logout" }, "Sign out")));
  return section;
}

// ---- your account (a shared hunt) ---------------------------------------------------------

function accountSettings() {
  const me = myAccount();
  const section = settingsPanel("Your account", { who: "you" });
  section.append(
    h("p", {}, h("b", { translate: "no" }, me.email)),
    h("p.muted", {}, "Deleting your account deletes everything in it, at once and for good: applications, companies, people, notes, files and settings. Download a backup first if you might want any of it.",
      META.terms ? [" ", h("a", { href: "/data-deletion", "data-reload": "" }, "More about deleting your data")] : null),
    h("div.actions", {}, h("button.al-button.al-button--quiet.al-button--danger", { type: "button", onclick: async () => {
      const d = await ask({ title: "Delete your account",
        body: h("div.fields", {},
          h("p", {}, "This deletes your account and everything in it, for good. It can't be undone."),
          h("div.field", {}, h("label", { for: "delete-confirm" }, "Type your email address to confirm"),
            h("input", { id: "delete-confirm", name: "confirm", type: "email", autocomplete: "off", placeholder: me.email }))),
        ok: "Delete for good", danger: true });
      if (!d) return;
      if (await attempt(() => api("DELETE", "account", { confirm: d.get("confirm") || "" }))) {
        // Gone: signed out of Access too, where there is one.
        location.href = tenancy()?.trying_out ? "/" : "/cdn-cgi/access/logout";
      }
    } }, "Delete my account…")));
  return section;
}

// ---- appearance -----------------------------------------------------------------------

function themeSettings() {
  const section = settingsPanel("Appearance", { who: "browser" });
  const seg = h("div.al-segmented", { role: "group", "aria-label": "Theme" });
  const draw = () => fill(seg, [["light", "Light"], ["dark", "Dark"], ["auto", "Match the system"]].map(([v, l]) =>
    h("button", { type: "button", "aria-pressed": String(currentTheme() === v), onclick: () => { setTheme(v); draw(); drawQuickSettings(); toast("Theme changed"); } }, l)));
  draw();
  section.append(h("div.settings-row", {},
    h("div.settings-row-label", {}, h("span.al-label", {}, "Theme"), h("span.al-hint", {}, "Each device keeps its own.")), seg));
  return section;
}

/** Regions dates and numbers can be written for. */
const REGIONS = [
  ["en-GB", "English (United Kingdom)"], ["en-US", "English (United States)"], ["en-IE", "English (Ireland)"],
  ["en-CA", "English (Canada)"], ["en-AU", "English (Australia)"], ["en-IN", "English (India)"],
  ["de-DE", "Deutsch (Deutschland)"], ["fr-FR", "Français (France)"], ["es-ES", "Español (España)"],
  ["it-IT", "Italiano (Italia)"], ["nl-NL", "Nederlands (Nederland)"], ["pt-PT", "Português (Portugal)"],
  ["sv-SE", "Svenska (Sverige)"], ["pl-PL", "Polski (Polska)"], ["ar-EG", "العربية (مصر)"],
  ["ar-SA", "العربية (السعودية)"], ["ar-AE", "العربية (الإمارات)"], ["ar-JO", "العربية (الأردن)"],
];

/** Every time zone the browser knows, by its IANA name. */
const TIME_ZONES = (() => { try { return Intl.supportedValuesOf("timeZone"); } catch { return []; } })();

/** Currencies with daily rates (the European Central Bank's). */
const CURRENCIES = ["GBP", "EUR", "USD", "CAD", "AUD", "NZD", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF",
  "JPY", "CNY", "HKD", "SGD", "INR", "KRW", "ZAR", "BRL", "MXN", "ILS", "TRY"];

function currencyName(code) {
  try { return `${new Intl.DisplayNames(LOC(), { type: "currency" }).of(code)} (${code})`; } catch { return code; }
}

function localeSettings(editing = false) {
  const rerender = (on) => section.replaceWith(localeSettings(on));
  const section = settingsPanel("Language and region", {
    editing, onToggle: rerender, done: "Cancel", who: "everyone",
    intro: "How hunt speaks, how dates, times and numbers are written, and the currency pay is compared in. Your time zone is in Calendar.",
  });
  const region = (code) => (code ? REGIONS.find(([v]) => v === code)?.[1] || code
    : LANG !== "en" ? `The language's (${LANG})` : `The browser's (${navigator.language})`);
  const languageName = (code) => choiceLabel(META.languages, code || "en");
  const sample = () => `${zonedNow().toLocaleDateString(LOC(), { weekday: "short", day: "numeric", month: "short", year: "numeric" })}, ${fmtTime("14:30")} · ${homeK(150000)} a year`;
  const rate = PREFS.currency !== "GBP" && PREFS.currency_rate
    ? h("span.muted.small", {}, ` · pay is converted through GBP: 1 ${PREFS.currency} = ${PREFS.currency_rate.toFixed(4)} GBP, the rate on ${fmtDay(PREFS.currency_rate_on)}`)
    : null;
  if (!editing) {
    section.append(h("dl.facts", {},
      h("dt", {}, "Language"), h("dd", { lang: PREFS.language || "en" }, languageName(PREFS.language)),
      h("dt", {}, "Region"), h("dd", {}, region(PREFS.locale)),
      h("dt", {}, "Numbers"), h("dd", {}, choiceLabel(META.numerals, PREFS.numerals || "auto")),
      h("dt", {}, "Times"), h("dd", {}, choiceLabel(META.clocks, PREFS.clock)),
      h("dt", {}, "Currency"), h("dd", {}, currencyName(PREFS.currency), rate),
      h("dt", {}, "Looks like"), h("dd", {}, sample())));
    return section;
  }
  const choose = (id, options, value) => h("select", { id }, options.map(([v, l]) => h("option", { value: v, selected: v === value }, l)));
  const langSel = choose("set-language", META.languages.map((o) => [o.value, o.label]), PREFS.language || "en");
  const regionSel = choose("set-region", [["", region(null)], ...REGIONS], PREFS.locale || "");
  const digitSel = choose("set-numerals", META.numerals.map((o) => [o.value, o.label]), PREFS.numerals || "auto");
  const clockSel = choose("set-clock", META.clocks.map((o) => [o.value, o.label]), PREFS.clock);
  const curSel = choose("set-currency", CURRENCIES.map((c) => [c, currencyName(c)]), PREFS.currency);
  const field = (id, label, control, help) => h("div.field", {}, h("label", { for: id }, label), control, help ? h("p.muted.small", {}, help) : null);
  section.append(
    h("div.fields.two", {},
      field("set-language", "Language", langSel, "The words, and which way the page reads."),
      field("set-region", "Region", regionSel, "Dates, numbers, and the names of days and months."),
      field("set-numerals", "Numbers", digitSel, "Which digits numbers are written in."),
      field("set-clock", "Times", clockSel),
      field("set-currency", "Currency", curSel, "Pay is shown in it, converted at today's rate where a posting gives another.")),
    saveCancel(async () => {
      const saved = await attempt(() => patch("settings", {
        language: langSel.value, locale: regionSel.value, numerals: digitSel.value,
        clock: clockSel.value, currency: curSel.value,
      }));
      if (!saved) return;
      // Another language or script redraws everything, in it.
      const relanguage = saved.language !== PREFS.language || saved.numerals !== PREFS.numerals;
      PREFS = saved;
      if (relanguage) { setLanguage(saved.language, saved.numerals); location.reload(); return; }
      toast("Saved");
      rerender(false);
    }, () => rerender(false)));
  langSel.focus();
  return section;
}

// ---- the calendar -----------------------------------------------------------------------

/** A time zone's name to read: "Asia/Tokyo" as "Tokyo", with its offset now ("GMT+9"). */
function zoneName(zone) {
  const city = zone.split("/").pop().replaceAll("_", " ");
  try {
    const off = new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value;
    return off ? `${city} (${off})` : city;
  } catch { return city; }
}

/**
 * The calendar: your time zone (hunt's, and the one interview times are
 * in), the week's first day, working hours (shaded outside in the day and
 * week), and other time zones shown beside its hours.
 */
function calendarSettings(editing = false) {
  const rerender = (on) => section.replaceWith(calendarSettings(on));
  const section = settingsPanel("Time and hours", {
    editing, onToggle: rerender, done: "Cancel",
    intro: "Your time zone and working hours, and other time zones to see beside yours in the calendar's day and week.",
  });
  const zone = (name) => name || `The machine's (${PREFS.server_timezone})`;
  const work = PREFS.work_hours;
  const dayNames = (days) => {
    // Monday to Friday reads as a range; anything else, day by day.
    const all = META.weekdays.map((d) => d.value);
    const i = all.indexOf(days[0]);
    const run = days.length > 2 && i >= 0 && days.every((d, n) => all[i + n] === d);
    const name = (d) => new Date(2024, 0, 1 + all.indexOf(d)).toLocaleDateString(LOC(), { weekday: "short" });
    return run ? `${name(days[0])}–${name(days[days.length - 1])}` : days.map(name).join(", ");
  };
  if (!editing) {
    section.append(h("dl.facts", {},
      h("dt", {}, "Time zone"), h("dd", {}, zone(PREFS.timezone)),
      h("dt", {}, "Weeks start on"), h("dd", {}, choiceLabel(META.week_starts, PREFS.week_start)),
      h("dt", {}, "Working hours"), h("dd", {}, work ? `${fmtTime(work.start)}–${fmtTime(work.end)}, ${dayNames(work.days)}` : h("span.muted", {}, "Not set")),
      h("dt", {}, "Other time zones"), h("dd", {}, PREFS.calendar_zones.length ? PREFS.calendar_zones.map(zoneName).join(" · ") : h("span.muted", {}, "None"))));
    return section;
  }
  const choose = (id, options, value) => h("select", { id }, options.map(([v, l]) => h("option", { value: v, selected: v === value }, l)));
  const zones = TIME_ZONES.map((z) => [z, z.replaceAll("_", " ")]);
  const zoneSel = choose("set-timezone", [["", zone(null)], ...zones], PREFS.timezone || "");
  const weekSel = choose("set-week", META.week_starts.map((o) => [o.value, o.label]), PREFS.week_start);
  const field = (id, label, control, help) => h("div.field", {}, h("label", { for: id }, label), control, help ? h("p.muted.small", {}, help) : null);

  // Working hours: on or off; from, to, and on which days.
  const hoursOn = h("input", { type: "checkbox", role: "switch", id: "set-work-on", checked: !!work, onchange: () => { hoursFields.hidden = !hoursOn.checked; } });
  const start = h("input", { type: "time", id: "set-work-start", value: work?.start || "09:00", step: 900 });
  const end = h("input", { type: "time", id: "set-work-end", value: work?.end || "17:30", step: 900 });
  const days = META.weekdays.map((d) => h("input", { type: "checkbox", value: d.value,
    checked: (work?.days || ["monday", "tuesday", "wednesday", "thursday", "friday"]).includes(d.value) }));
  const hoursFields = h("div.work-hours", { hidden: !work },
    h("div.work-times", {}, field("set-work-start", "From", start), field("set-work-end", "To", end)),
    h("fieldset.work-days", {}, h("legend", {}, "On"),
      META.weekdays.map((d, i) => h("label.check", {}, days[i], d.label))));

  // Other time zones: a select each, added and removed.
  let others = [...PREFS.calendar_zones];
  const othersBox = h("div.other-zones");
  const drawOthers = () => fill(othersBox,
    others.map((z, i) => h("div.other-zone", {},
      h("select", { "aria-label": `Other time zone ${i + 1}`, onchange: (e) => { others[i] = e.target.value; } },
        zones.map(([v, l]) => h("option", { value: v, selected: v === z }, l))),
      h("button.al-button.al-button--sm.al-button--quiet.al-button--danger", { type: "button", onclick: () => { others.splice(i, 1); drawOthers(); } }, "remove"))),
    others.length < META.max_calendar_zones
      ? addLink("Add a time zone", () => { others.push(others.length ? "America/New_York" : "Europe/London"); drawOthers(); othersBox.querySelector(".other-zone:last-of-type select")?.focus(); })
      : null);
  drawOthers();

  section.append(
    h("div.fields.two", {},
      field("set-timezone", "Time zone", zoneSel, "What “today” and “now” are, for hunt and its calendar feed; interview times are in it."),
      field("set-week", "Weeks start on", weekSel)),
    h("div.field", {}, h("label.switch", { for: "set-work-on" }, hoursOn, "Working hours"),
      h("p.muted.small", {}, "The hours outside them are shaded in the calendar's day and week."), hoursFields),
    h("div.field", {}, h("span.al-label", {}, "Other time zones"),
      h("p.muted.small", {}, `Their hours beside yours in the day and week, to see when an interview elsewhere falls; up to ${META.max_calendar_zones}.`),
      othersBox),
    saveCancel(async () => {
      const chosen = days.filter((d) => d.checked).map((d) => d.value);
      const saved = await attempt(() => patch("settings", {
        timezone: zoneSel.value, week_start: weekSel.value,
        work_hours: hoursOn.checked ? { start: start.value, end: end.value, days: chosen } : null,
        calendar_zones: others,
      }));
      if (!saved) return;
      PREFS = saved;
      toast("Saved");
      rerender(false);
    }, () => rerender(false)));
  zoneSel.focus();
  return section;
}

// ---- location ---------------------------------------------------------------------------

/** Where you live: a UK resident has take-home pay (where it's on), for their part of the UK. */
function locationSettings(editing = false) {
  const rerender = (on) => section.replaceWith(locationSettings(on));
  const section = settingsPanel("Where you live", {
    editing, onToggle: rerender, done: "Cancel", who: "you",
    intro: "For working out tax on your pay.",
  });
  const what = h("p.muted.small", {}, PREFS.uk_resident
    ? "Take-home pay is on, and on applications that give their pay."
    : "Take-home pay works out UK tax, so it's for those who live in the UK: what you'd keep of a salary or a contractor's rate, and of applications' pay.");
  if (!editing) {
    section.append(h("dl.facts", {},
      h("dt", {}, "UK resident"), h("dd", {}, PREFS.uk_resident ? "Yes" : "No"),
      PREFS.uk_resident ? [h("dt", {}, "Part of the UK"), h("dd", {}, choiceLabel(META.uk_regions, PREFS.uk_region))] : null),
    what);
    return section;
  }
  const uk = h("input", { id: "set-uk", type: "checkbox", checked: !!PREFS.uk_resident, onchange: () => { regionField.hidden = !uk.checked; } });
  const regionSel = h("select", { id: "set-uk-region" },
    META.uk_regions.map((o) => h("option", { value: o.value, selected: o.value === PREFS.uk_region }, o.label)));
  const regionField = h("div.field", { hidden: !PREFS.uk_resident }, h("label", { for: "set-uk-region" }, "Part of the UK"), regionSel,
    h("p.muted.small", {}, "Scotland has its own income tax bands."));
  section.append(
    h("div.location-fields", {},
      h("label.check", {}, uk, h("span", {}, "I live in the UK (a UK resident, for tax)")),
      regionField),
    what,
    saveCancel(async () => {
      const saved = await attempt(() => patch("settings", { uk_resident: uk.checked, uk_region: regionSel.value }));
      if (!saved) return;
      PREFS = saved;
      showExperimentNav();
      toast("Saved");
      rerender(false);
    }, () => rerender(false)));
  uk.focus();
  return section;
}

// ---- desired take-home pay ---------------------------------------------------------------

/** The take-home pay you want, in your currency: Take-home pay sets its figures against it. */
function desiredSettings(editing = false) {
  const rerender = (on) => section.replaceWith(desiredSettings(on));
  const section = settingsPanel("What you want to take home", {
    editing, onToggle: rerender, done: "Cancel", who: "you",
    intro: "Take-home pay, and every application's pay, compare with this. Take-home pay starts from it when you work back from what you want.",
  });
  const pers = [["week", "Weekly"], ["month", "Monthly"], ["year", "Annually"]];
  const words = { week: "a week", month: "a month", year: "a year" };
  const want = PREFS.desired_take_home;
  if (!editing) {
    section.append(h("dl.facts", {},
      h("dt", {}, "Desired net take-home pay"),
      h("dd", {}, want == null ? h("span.muted", {}, "Not set")
        : [money(want, HOME()), " ", h("span", {}, words[PREFS.desired_take_home_per] || "a month")])));
    return section;
  }
  const amount = h("input", { id: "set-desired", type: "text", inputmode: "decimal", autocomplete: "off",
    value: want ?? "", placeholder: "e.g. 4,000" });
  const per = h("select", { id: "set-desired-per" },
    pers.map(([v, l]) => h("option", { value: v, selected: v === (PREFS.desired_take_home_per || "month") }, l)));
  section.append(
    h("div.fields.two", {},
      h("div.field", {}, h("label", { for: "set-desired" }, "Desired net take-home pay"), amount,
        h("p.muted.small", {}, h("span", {}, "After tax, in"), " ", currencyName(HOME()), ". ", h("span", {}, "Leave it empty for none."))),
      h("div.field", {}, h("label", { for: "set-desired-per" }, "Pay period"), per)),
    saveCancel(async () => {
      const n = takeHomeNumber(amount.value);
      if (Number.isNaN(n)) { toast("That isn't a number hunt can read: try 4000 or 4k.", "error"); return; }
      const saved = await attempt(() => patch("settings", { desired_take_home: n, desired_take_home_per: per.value }));
      if (!saved) return;
      PREFS = saved;
      toast("Saved");
      rerender(false);
    }, () => rerender(false)));
  amount.focus();
  return section;
}

// ---- integrations -----------------------------------------------------------------------

/** Settings: the bookmark that brings LinkedIn profiles in, and its settings. */
async function linkedinSettings(editing = false) {
  const prefs = await get("settings");
  const rerender = async (on) => section.replaceWith(await linkedinSettings(on));
  const section = settingsPanel("LinkedIn bookmark", {
    editing, onToggle: rerender, done: "Cancel", who: "browser",
    intro: "LinkedIn only shows profiles to people signed in, so hunt can't read them itself. This bookmark reads the profile open in your browser instead, and brings it here to choose what to keep.",
  });
  section.classList.add("linkedin");
  const origin = prefs.bookmarklet_url || location.origin;
  const link = h("a.al-button.al-button--sm.bookmarklet", { href: profileBookmarklet(origin), title: "Drag me to your bookmarks bar",
    onclick: (e) => { e.preventDefault(); toast("Drag it to your bookmarks bar, then click it on a LinkedIn profile"); } },
  h("img", { src: "/logo.svg", alt: "", width: 18, height: 18 }), "Send to hunt");
  const copy = h("button.al-button.al-button--sm", { type: "button", onclick: async () => {
    try { await navigator.clipboard.writeText(link.href); toast("Copied the bookmark's code"); } catch { toast("Couldn't copy; drag the button instead", "error"); }
  } }, "Copy code");
  section.append(h("ol.steps-help", {},
    h("li", {}, "Drag ", link, " to your bookmarks bar (show it with ⇧⌘B)."),
    h("li", {}, "Open someone's profile on LinkedIn, and click the bookmark."),
    h("li", {}, "hunt opens with what it found: their name, role, company, location, about and photo. Tick what to keep.")));
  const sameName = choiceLabel(META.same_name, prefs.same_name);
  if (!editing) {
    section.append(h("dl.facts", {},
      h("dt", {}, "hunt's address"), h("dd", {}, prefs.bookmarklet_url || h("span", {}, location.origin, h("span.muted.small", {}, " · this page's"))),
      h("dt", {}, "Same name"), h("dd", {}, sameName)));
  } else {
    const address = h("input", { type: "url", id: "bm-url", placeholder: location.origin, value: prefs.bookmarklet_url || "" });
    const rule = h("select", { id: "bm-same" }, META.same_name.map((o) => h("option", { value: o.value, selected: o.value === prefs.same_name }, o.label)));
    section.append(
      h("div.fields", {},
        h("div.field", {}, h("label", { for: "bm-url" }, "hunt's address"), address,
          h("p.muted.small", {}, "Where the bookmark opens hunt. Leave empty for the address this page is at; set it when you open hunt at another one (e.g. http://hunt.local:4848). After changing it, drag the bookmark again.")),
        h("div.field", {}, h("label", { for: "bm-same" }, "When someone of the same name is already here"), rule,
          h("p.muted.small", {}, "Someone kept with the same LinkedIn profile is always merged into. This is for people added by hand, or under another link."))),
      saveCancel(async () => {
        const saved = await attempt(() => patch("settings", { bookmarklet_url: address.value, same_name: rule.value }));
        if (!saved) return;
        toast((saved.bookmarklet_url || "") !== (prefs.bookmarklet_url || "") ? "Saved. Drag the bookmark to your bar again, replacing the old one" : "Saved");
        rerender(false);
      }, () => rerender(false)));
    setTimeout(() => address.focus(), 0);
  }
  section.append(
    h("details.al-disclosure.more", {}, h("summary", {}, "Giving the bookmark hunt's icon"),
      h("p.small", {}, "Browsers don't let a bookmarklet choose its icon. A workaround that keeps hunt's icon in some browsers (Firefox does; Chrome and Safari usually don't): bookmark this page, so the bookmark takes hunt's icon, then edit it and paste the bookmark's code in as its address."),
      h("div.actions", {}, copy)),
    h("p.muted.small", {}, "It only reads the page you're on, when you click it, and sends it to ", h("span.muted", {}, origin), ". Nothing goes anywhere else."));
  return section;
}

// ---- the interview process: stages, and why processes end -------------------------------

/**
 * An ordered list of names (stages, archive reasons), read first. Edit
 * turns the names into fields, saved as they change, with reordering;
 * a row's edit opens that, at the row; remove deletes; + Add opens the new
 * name's field.
 */
/**
 * An ordered list (stages, reasons), edited where it is. A name saves when
 * it's left (or on Enter), and Escape puts it back; ↑ ↓ or dragging
 * reorders; × removes; the box under the list adds. Each change saves at
 * once and says so, with Undo. `sub`, when given, lists what belongs to
 * each item indented under it (a stage's lanes), edited the same way:
 * {noun, of(item), rename, remove, reorder(item, ids), add(item, name), drop(added)}.
 * `remove` removes (asking first only where something must go elsewhere)
 * and gives back what puts it back, or null if nothing was removed; `drop`
 * takes away one just added.
 */
function orderedSettings({ key, title, intro, items, noun, focus, redraw, rename, remove, reorder, add, drop, placeholder, sub = null, extra = null, rowClass = null, nest = null, scope = "", bare = false }) {
  // Bare: a list in another's row (nest), without a panel of its own.
  const section = bare ? h("div.nested-list") : settingsPanel(title, { intro, who: "everyone" });
  section.dataset.list = key;
  // What's focused after drawing, as this list names it (`scope` keeps a
  // nested list's apart from its row's): a row's id, or new, new-ID, sub-ID.
  const at = (f) => (f == null ? null : `${scope}${f}`);
  // Done: drawn again, and said, with Undo, which draws it again once undone.
  const done = (message, undo, then = {}) => {
    then = { ...then, focus: at(then.focus) };
    redraw(then);
    toast(message, "info", { label: "Undo", onclick: async () => {
      if (await attempt(async () => { await undo(); return true; })) { toast("Undone"); redraw(then); }
    } });
  };
  // A name, edited in place: saved when left, or on Enter; Escape puts it back.
  const nameField = (it, label, save) => {
    const input = h("input.inline-name", { value: it.name, "aria-label": label, spellcheck: "false" });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); input.blur(); }
      else if (e.key === "Escape") { input.value = it.name; input.blur(); }
    });
    input.addEventListener("change", async () => {
      const was = it.name;
      const now = input.value.trim();
      if (!now || now === was) { input.value = was; return; }
      if (!(await attempt(() => save(it, now)))) { input.value = was; return; }
      it.name = now;
      toast(`Renamed “${was}” to “${now}”`, "info", { label: "Undo", onclick: async () => {
        if (await attempt(() => save(it, was))) { toast("Undone"); redraw(); }
      } });
    });
    return input;
  };
  // Moved: saved, with Undo putting the old order back.
  const moved = async (what, before, after, save, then) => {
    if (before.join() === after.join()) return;
    if (await attempt(() => save(after))) done(`Moved ${what}`, () => save(before), then);
  };
  const removed = async (it, run) => {
    const undo = await attempt(run);
    if (undo) done(`Removed ${it.name}`, undo);
  };
  const subRows = (it) => {
    if (!sub) return [];
    const mine = sub.of(it);
    const ids = mine.map((y) => y.id);
    const rows = mine.map((x, k) => {
      const nudge = (by) => {
        const j = k + by;
        if (j < 0 || j >= ids.length) return;
        const next = [...ids];
        [next[k], next[j]] = [next[j], next[k]];
        moved(x.name, ids, next, (o) => sub.reorder(it, o), { focus: `sub-${x.id}` });
      };
      return h("li.sub-row", { dataset: { sub: x.id, focus: at(`sub-${x.id}`) } },
        h("span.sub-mark", { "aria-hidden": "true" }, "↳"),
        nameField(x, `${sub.noun[0].toUpperCase()}${sub.noun.slice(1)} name, in ${it.name}`, sub.rename),
        // Something of the sub row's own, before its buttons (a sub stage's Folded switch).
        sub.extra ? sub.extra(x, it, done) : null,
        h("button.al-button.al-button--icon.al-button--sm", { type: "button", "aria-label": `Move ${x.name} up`, title: "Move up", disabled: k === 0, onclick: () => nudge(-1) }, "↑"),
        h("button.al-button.al-button--icon.al-button--sm", { type: "button", "aria-label": `Move ${x.name} down`, title: "Move down", disabled: k === ids.length - 1, onclick: () => nudge(1) }, "↓"),
        h("button.al-button.al-button--icon.al-button--sm.al-button--danger", { type: "button", "aria-label": `Remove ${x.name}`, title: `Remove ${sub.noun}`, onclick: () => removed(x, () => sub.remove(x, it)) }, "×"));
    });
    // Adding one: a link, until it's this stage's turn.
    if (focus !== at(`new-${it.id}`)) {
      return [...rows, h("li.sub-row.sub-add", {}, h("span.sub-mark", { "aria-hidden": "true" }, "↳"),
        h("button.al-button.al-button--quiet.app-add", { type: "button", "aria-label": `Add a ${sub.noun} to ${it.name}`,
          onclick: () => redraw({ focus: at(`new-${it.id}`) }) }, `+ Add a ${sub.noun}`))];
    }
    const box = h("input", { "aria-label": `New ${sub.noun} in ${it.name}`, placeholder: `New ${sub.noun}, e.g. Accepted`, dataset: { focus: at(`new-${it.id}`) } });
    box.addEventListener("keydown", (e) => { if (e.key === "Escape") redraw(); });
    const form = h("li.sub-row.sub-add", {}, h("span.sub-mark", { "aria-hidden": "true" }, "↳"),
      h("form.inline-add", { onsubmit: async (e) => {
        e.preventDefault();
        const name = box.value.trim();
        if (!name) return;
        const added = await attempt(() => sub.add(it, name));
        if (added) done(`Added ${name} to ${it.name}`, () => sub.drop(added), { focus: `new-${it.id}` });
      } }, box, h("button.al-button", { type: "submit" }, `Add ${sub.noun}`)));
    return [...rows, form];
  };
  const order = items.map((x) => x.id);
  const list = h("ol.stage-list", {}, items.flatMap((it, i) => {
    const nudge = (by) => {
      const j = i + by;
      if (j < 0 || j >= order.length) return;
      const next = [...order];
      [next[i], next[j]] = [next[j], next[i]];
      moved(it.name, order, next, reorder, { focus: it.id });
    };
    const li = h("li.stage", { draggable: "true", dataset: { id: it.id, focus: at(it.id) }, class: rowClass ? rowClass(it) : "" },
      h("span.handle", { "aria-hidden": "true", title: "Drag to reorder" }, "⋮⋮"),
      h("span.stage-no", { "aria-hidden": "true" }, i + 1),
      nameField(it, `${noun[0].toUpperCase()}${noun.slice(1)} name`, rename),
      // Something of the row's own, before its buttons (a stage's Active switch).
      extra ? extra(it, done) : null,
      h("button.al-button.al-button--icon.al-button--sm", { type: "button", "aria-label": `Move ${it.name} up`, title: "Move up", disabled: i === 0, onclick: () => nudge(-1) }, "↑"),
      h("button.al-button.al-button--icon.al-button--sm", { type: "button", "aria-label": `Move ${it.name} down`, title: "Move down", disabled: i === order.length - 1, onclick: () => nudge(1) }, "↓"),
      h("button.al-button.al-button--icon.al-button--sm.al-button--danger", { type: "button", "aria-label": `Remove ${it.name}`, title: `Remove ${noun}`, onclick: () => removed(it, () => remove(it)) }, "×"));
    // Dragged by its row, not from inside its name.
    li.addEventListener("dragstart", (e) => {
      if (e.target.closest?.("input")) { e.preventDefault(); return; }
      e.dataTransfer.setData("text/plain", it.id);
      li.classList.add("dragging");
    });
    li.addEventListener("dragend", () => {
      li.classList.remove("dragging");
      moved(it.name, order, [...list.querySelectorAll(":scope > li.stage")].map((x) => Number(x.dataset.id)), reorder);
    });
    // A row's own list (a swimlane's stages), under it.
    return [li, ...subRows(it), nest ? h("li.nested", {}, nest(it)) : null];
  }));
  list.addEventListener("dragover", (e) => {
    // Its own rows: a nested list's are its own to move.
    const moving = list.querySelector(":scope > li.dragging");
    if (!moving) return;
    e.preventDefault();
    const before = [...list.querySelectorAll(":scope > li.stage")].find((x) => x !== moving && e.clientY < x.getBoundingClientRect().top + x.offsetHeight / 2);
    // A stage takes its lanes with it.
    const rows = [moving];
    for (let n = moving.nextElementSibling; n && !n.classList.contains("stage"); n = n.nextElementSibling) rows.push(n);
    if (rows.includes(before)) return;
    for (const r of rows) list.insertBefore(r, before || null);
  });
  const name = h("input", { "aria-label": `New ${noun}`, placeholder, required: true });
  section.append(items.length ? list : h("p.muted", {}, `No ${noun}s yet.`), h("form.inline-add", { onsubmit: async (e) => {
    e.preventDefault();
    const v = name.value.trim();
    if (!v) return;
    const added = await attempt(() => add(v));
    if (added) done(`Added ${v}`, () => drop(added), { focus: "new" });
  } }, name, h("button.al-button.al-button--primary", { type: "submit" }, `Add ${noun}`)));
  setTimeout(() => {
    if (focus == null) return;
    if (focus === at("new")) name.focus();
    else list.querySelector(`[data-focus="${focus}"]`)?.closest("li")?.querySelector("input")?.focus();
  }, 0);
  return section;
}

/** Draw a settings list again, wherever it is now (a toast's Undo may outlive the drawing it came from). */
const redrawList = (key, draw) => async (o = {}) => {
  const now = document.querySelector(`.settings-panel[data-list="${key}"]`);
  if (now) now.replaceWith(await draw(o));
};

/** Processes as `restore` takes them back: each where it was, with what it had. */
const restoreProcesses = (states) => (states.length ? post("processes/bulk", { action: "restore", states }) : null);

/**
 * The board, in Settings: its swimlanes, top to bottom, each a box with its
 * stages in it, and each stage with its sub stages. Removing a swimlane
 * moves its stages to the first.
 */
async function boardSettings({ focus = null } = {}) {
  // The reasons for closing are sub stages here: what offers them, drawn again with them.
  await reloadMeta();
  const [swimlanes, stages, lanes] = await Promise.all([get("swimlanes"), get("stages"), get("lanes")]);
  const redraw = redrawList("board", boardSettings);
  // By swimlane, as the board has them (a stage in none, in the first).
  const groups = swimlanes.length ? swimlanes : [{ id: null, name: null }];
  const known = new Set(groups.map((w) => w.id));
  const of = (st) => (known.has(st.swimlane_id) ? st.swimlane_id : groups[0].id);
  const inGroup = (w) => stages.filter((st) => of(st) === w.id);
  // A swimlane's stages reordered: every stage's order, the others' as they are.
  const order = (w, ids) => groups.flatMap((x) => (x.id === w.id ? ids : inGroup(x).map((st) => st.id)));
  // Terminal: a process in it is closed, its sub stage being why.
  const terminalSwitch = (st, done) => {
    const id = `stage-terminal-${st.id}`;
    const set = (on) => patch(`stages/${st.id}`, { active: on ? 0 : 1 });
    return h("label.switch.stage-active", { for: id, title: "A process in a terminal stage is closed; its sub stages are the reasons" },
      h("input", { type: "checkbox", role: "switch", id, checked: st.active === 0, onchange: async (e) => {
        const on = e.target.checked;
        if (!(await attempt(() => set(on)))) { e.target.checked = !on; return; }
        done(on ? `${st.name} is terminal: its processes are closed` : `${st.name} isn't terminal: its processes are open`,
          () => set(!on), { focus: st.id });
      } }), h("span", {}, "Terminal stage"));
  };
  // The swimlane it's in (none: the first).
  const swimlanePick = (st, done) => {
    if (swimlanes.length < 2) return null;
    const first = swimlanes[0]?.id;
    const now = swimlanes.some((w) => w.id === st.swimlane_id) ? st.swimlane_id : first;
    // At the end of the one it goes to.
    const set = async (to) => {
      await patch(`stages/${st.id}`, { swimlane_id: to });
      const ids = groups.flatMap((w) => [...inGroup(w).map((x) => x.id).filter((x) => x !== st.id), ...(w.id === to ? [st.id] : [])]);
      await post("stages/order", { ids });
    };
    return h("select.stage-swimlane", { "aria-label": `${st.name}'s swimlane`, title: "Its swimlane, the board's row it's in", onchange: async (e) => {
      const to = Number(e.target.value);
      if (!(await attempt(() => set(to)))) { e.target.value = now; return; }
      done(`Moved ${st.name} to ${swimlanes.find((w) => w.id === to)?.name}`, () => set(now), { focus: st.id });
    } }, swimlanes.map((w) => h("option", { value: w.id, selected: w.id === now }, w.name)));
  };
  // How its cards show on the board until unfolded or folded there: all of
  // them (the default), or each lane's as a pack.
  const foldedSwitch = (st, done) => {
    const id = `stage-folded-${st.id}`;
    const set = (on) => patch(`stages/${st.id}`, { folded: on ? 1 : 0 });
    return h("label.switch.stage-active", { for: id, title: "Its cards start folded into packs, a card on the rest" },
      h("input", { type: "checkbox", role: "switch", id, checked: !!st.folded, onchange: async (e) => {
        const on = e.target.checked;
        if (!(await attempt(() => set(on)))) { e.target.checked = !on; return; }
        done(on ? `${st.name}'s cards start folded` : `${st.name}'s cards start unfolded`, () => set(!on), { focus: st.id });
      } }), h("span", {}, "Folded"));
  };
  // A sub stage again, in its place among its stage's, with its cards back in it.
  const restoreLane = async (l, stageId, ids, cards) => {
    const back = await post("lanes", { stage_id: stageId, name: l.name, folded: l.folded ?? null, is_default: l.is_default || 0 });
    await post(`stages/${stageId}/lanes/order`, { ids: ids.map((id) => (id === l.id ? back.id : id)) });
    await restoreProcesses(cards.map((p) => ({ ...p, stage_id: stageId, lane_id: back.id })));
    return back;
  };
  // A stage's default sub stage (one, at most): Undo puts back the one before.
  const defaultSwitch = (l, st, done) => {
    const id = `lane-default-${l.id}`;
    const before = lanes.find((x) => x.stage_id === st.id && x.is_default);
    return h("label.switch.stage-active", { for: id, title: `A card going into ${st.name} goes here, unless it's said where` },
      h("input", { type: "checkbox", role: "switch", id, checked: !!l.is_default, onchange: async (e) => {
        const on = e.target.checked;
        if (!(await attempt(() => patch(`lanes/${l.id}`, { is_default: on ? 1 : 0 })))) { e.target.checked = !on; return; }
        const undo = () => (before && before.id !== l.id ? patch(`lanes/${before.id}`, { is_default: 1 }) : patch(`lanes/${l.id}`, { is_default: on ? 0 : 1 }));
        done(on ? `${l.name} is ${st.name}'s default` : `${st.name} has no default sub stage`, undo, { focus: `sub-${l.id}` });
      } }), h("span", {}, "Default"));
  };
  const laneFolded = (l, st, done) => {
    const id = `lane-folded-${l.id}`;
    const was = l.folded ?? null;
    const set = (v) => patch(`lanes/${l.id}`, { folded: v });
    return h("label.switch.stage-active", { for: id, title: was == null ? `Its cards start as ${st.name}'s do, until set here` : "Its cards start folded into a pack, a card on the rest" },
      h("input", { type: "checkbox", role: "switch", id, checked: was == null ? !!st.folded : !!was, onchange: async (e) => {
        const on = e.target.checked;
        if (!(await attempt(() => set(on ? 1 : 0)))) { e.target.checked = !on; return; }
        done(on ? `${l.name}'s cards start folded` : `${l.name}'s cards start unfolded`, () => set(was), { focus: `sub-${l.id}` });
      } }), h("span", {}, "Folded"));
  };
  // A swimlane's stages, in its box.
  const stageList = (w) => orderedSettings({
    key: `stages-${w.id ?? 0}`, noun: "stage", focus, redraw, bare: true, scope: `s${w.id ?? 0}-`,
    extra: (st, done) => h("span.stage-switches", {}, swimlanePick(st, done), terminalSwitch(st, done), foldedSwitch(st, done)),
    rowClass: (st) => (st.active === 0 ? "inactive" : ""),
    // A stage's sub stages (lanes), indented under it.
    sub: {
      noun: "sub stage",
      of: (st) => lanes.filter((l) => l.stage_id === st.id),
      // Default: where a process going into the stage goes; and Folded,
      // as its stage until said here.
      extra: (l, st, done) => h("span.stage-switches", {}, defaultSwitch(l, st, done), laneFolded(l, st, done)),
      rename: (l, name) => patch(`lanes/${l.id}`, { name }),
      // Its cards stay in the stage, at the top; Undo puts them back in it.
      remove: async (l, st) => {
        const ids = lanes.filter((x) => x.stage_id === st.id).map((x) => x.id);
        const cards = await get(`processes?lane_id=${l.id}`);
        await del(`lanes/${l.id}`);
        return () => restoreLane(l, st.id, ids, cards);
      },
      reorder: (st, ids) => post(`stages/${st.id}/lanes/order`, { ids }),
      add: (st, name) => post("lanes", { stage_id: st.id, name }),
      drop: (l) => del(`lanes/${l.id}`),
    },
    items: inGroup(w),
    placeholder: w.name ? `New stage in ${w.name}, e.g. Take-home` : "New stage, e.g. Take-home",
    rename: (st, name) => patch(`stages/${st.id}`, { name }),
    remove: (st) => deleteStage(st, stages, lanes),
    reorder: (ids) => post("stages/order", { ids: order(w, ids) }),
    add: (name) => post("stages", w.id ? { name, swimlane_id: w.id } : { name }),
    drop: (st) => del(`stages/${st.id}`),
  });
  const intro = "The board's swimlanes, top to bottom, each with its stages, its columns, in order (a stage in none is in the first). A folded swimlane starts as its heading on the board, until opened there. A process in a terminal stage is closed, and its sub stage is the reason (Their Decision: They rejected me, Role filled …). Under a stage, its sub stages, top to bottom; cards in none stay at the column's top. A folded stage's cards start as packs, a card on the rest, until unfolded on the board.";
  const panel = orderedSettings({
    key: "board", title: "Swimlanes and stages", intro, noun: "swimlane", focus, redraw, scope: "w",
    // Folded: it starts as its heading on the board.
    extra: (w, done) => {
      const id = `swimlane-folded-${w.id}`;
      const set = (on) => patch(`swimlanes/${w.id}`, { folded: on ? 1 : 0 });
      return h("label.switch.stage-active", { for: id, title: "It starts folded to its heading on the board" },
        h("input", { type: "checkbox", role: "switch", id, checked: !!w.folded, onchange: async (e) => {
          const on = e.target.checked;
          if (!(await attempt(() => set(on)))) { e.target.checked = !on; return; }
          done(on ? `${w.name} starts folded` : `${w.name} starts open`, () => set(!on), { focus: w.id });
        } }), h("span", {}, "Folded"));
    },
    rowClass: () => "swimlane-row",
    nest: stageList,
    items: swimlanes,
    placeholder: "New swimlane, e.g. On hold",
    rename: (w, name) => patch(`swimlanes/${w.id}`, { name }),
    // Undo: back in its place, with its stages.
    remove: async (w) => {
      const ids = swimlanes.map((x) => x.id);
      const its = stages.filter((st) => st.swimlane_id === w.id);
      await del(`swimlanes/${w.id}`);
      return async () => {
        const back = await post("swimlanes", { name: w.name, folded: w.folded });
        await post("swimlanes/order", { ids: ids.map((id) => (id === w.id ? back.id : id)) });
        for (const st of its) await patch(`stages/${st.id}`, { swimlane_id: back.id });
      };
    },
    reorder: (ids) => post("swimlanes/order", { ids }),
    add: (name) => post("swimlanes", { name }),
    drop: (w) => del(`swimlanes/${w.id}`),
  });
  // No swimlanes: the stages on their own, before adding one.
  if (!swimlanes.length) panel.querySelector(":scope > form.inline-add").before(stageList(groups[0]));
  return panel;
}

/**
 * Remove a stage: at once when empty, else asking where its processes go.
 * Gives back what puts it back (in its place, with its lanes, and its
 * processes where they were), or null when not removed.
 */
async function deleteStage(stage, stages, lanes) {
  const cards = await get(`processes?stage_id=${stage.id}`);
  const its = lanes.filter((l) => l.stage_id === stage.id);
  if (cards.length) {
    const others = stages.filter((s) => s.id !== stage.id);
    if (!others.length) throw new Error("The board needs at least one stage.");
    const data = await ask({
      title: `Delete ${stage.name}`,
      body: h("div.fields", {}, h("p", {}, `${cards.length} ${cards.length === 1 ? "process is" : "processes are"} in ${stage.name}.`),
        h("div.field", {}, h("label", { for: "move-to" }, "Move them to"),
          h("select", { id: "move-to", name: "to" }, others.map((s) => h("option", { value: s.id }, s.name))))),
      ok: "Move and delete", danger: true,
    });
    if (!data) return null;
    await del(`stages/${stage.id}?move_to=${data.get("to")}`);
  } else {
    await del(`stages/${stage.id}`);
  }
  return async () => {
    const back = await post("stages", { name: stage.name, active: stage.active, folded: stage.folded, swimlane_id: stage.swimlane_id });
    await post("stages/order", { ids: stages.map((s) => (s.id === stage.id ? back.id : s.id)) });
    const laneBack = new Map();
    for (const l of its) laneBack.set(l.id, (await post("lanes", { stage_id: back.id, name: l.name, folded: l.folded ?? null, is_default: l.is_default || 0 })).id);
    await restoreProcesses(cards.map((p) => ({ ...p, stage_id: back.id, lane_id: laneBack.get(p.lane_id) ?? null })));
  };
}

// ---- tags ------------------------------------------------------------------------------

async function tagsSettings({ focus = null } = {}) {
  TAGS = await get("tags");
  const rerender = async (o = {}) => section.replaceWith(await tagsSettings(o));
  const section = settingsPanel("Tags", {
    who: "everyone",
    intro: "Add them from any application, company, person or file, or here. Renaming a tag renames it everywhere.",
  });
  const colourName = (c) => (c ? choiceLabel(META.tag_colors, c) : "Plain");
  const remove = async (t) => {
    if (!(await confirmDelete(`tag “${t.name}”`, "It comes off everything that has it."))) return;
    if (await attempt(() => del(`tags/${t.id}`))) { toast(`Deleted ${t.name}`); rerender(); }
  };
  // A row: the tag, its name edited in place; its colour, which opens its colours; remove.
  const row = (t) => {
    const name = h("input.tag-name", { value: t.name, "aria-label": "Tag name", size: Math.max(t.name.length, 2), spellcheck: "false" });
    const chip = paintTag(h("span.al-tag", { dataset: { tag: t.name.toLowerCase() } }, name), t.color);
    name.addEventListener("input", () => { name.size = Math.max(name.value.length, 2); });
    name.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); name.blur(); }
      else if (e.key === "Escape") { name.value = t.name; name.size = Math.max(t.name.length, 2); name.blur(); }
    });
    name.addEventListener("change", async () => {
      const next = name.value.trim();
      if (next && next !== t.name && (await attempt(() => patch(`tags/${t.id}`, { name: next })))) {
        toast("Renamed");
        TAGS = await get("tags");
        t.name = next;
        chip.dataset.tag = next.toLowerCase();
        colour.setAttribute("aria-label", `${colourName(t.color)}, colour of ${t.name}`);
      }
      name.value = t.name;
      name.size = Math.max(t.name.length, 2);
    });
    const colour = h("button.tag-colour-name", {
      type: "button", "aria-haspopup": "true", "aria-expanded": "false", "aria-label": `${colourName(t.color)}, colour of ${t.name}`,
      onclick: (e) => tagColours(t, e.currentTarget, (c) => {
        colour.firstChild.textContent = colourName(c);
        colour.setAttribute("aria-label", `${colourName(c)}, colour of ${t.name}`);
      }),
    }, h("span", {}, colourName(t.color)), icon("chevron"));
    return h("li", { dataset: { id: t.id } }, chip, colour, rowActions(t.name, { remove: () => remove(t) }));
  };
  const list = TAGS.length ? h("ul.setting-list.tag-rows", {}, TAGS.map(row)) : h("p.muted", {}, "No tags yet.");
  const name = h("input", { "aria-label": "New tag", placeholder: "New tag, e.g. fintech", required: true });
  section.append(list, h("form.inline-add", { onsubmit: async (e) => {
    e.preventDefault();
    if (await attempt(() => post("tags", { name: name.value }))) { toast(`Added ${name.value}`); rerender({ focus: "new" }); }
  } }, name, h("button.al-button.al-button--primary", { type: "submit" }, "Add tag")));
  if (focus === "new") setTimeout(() => name.focus(), 0);
  return section;
}
