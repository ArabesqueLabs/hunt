// The Settings page (/settings): its sections in the sidebar, each a panel
// that reads first. A section's Edit (or a row's edit, remove, or "+ Add
// …") opens it for changes; Done, Save or Cancel closes it again.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { api, attempt, del, get, patch, post } from "../lib/api";
import { LOC, fmtDay, fmtStamp, fmtTime, HOME, homeK, zonedNow } from "../lib/format";
import { LANG, setLanguage } from "../lib/i18n";
import { CURRENCIES, choiceLabel, myAccount, reloadMeta, reloadTags, sitePage, takeHomeOn, tenancy } from "../lib/meta";
import { settle } from "../lib/router";
import { sectionNav } from "../lib/shell";
import { S, changed, useShared } from "../lib/state";
import { store, stored } from "../lib/storage";
import { tagPaint } from "../lib/tags";
import { currentTheme, setTheme } from "../lib/theme";
import { toast } from "../lib/toast";
import type { Row, Tag } from "../lib/types";
import { ask, confirmDelete } from "../components/dialogs";
import { useFilePicker } from "../components/files";
import { profileBookmarklet } from "../components/importer";
import { openTagColours } from "../components/tags";
import { Facts, Field, Icon, Input, Label, Select } from "../components/ui";
import { GMAIL, GmailSettings } from "./Mail";
import { money, takeHomeNumber } from "./TakeHome";

/** Settings are your account's; a section kept in this browser instead says so. */
const FOR: Record<string, string> = { browser: "This browser" };

/** A section: its title, who it's for, and Edit (or Done) beside it when it can be changed. */
export function SettingsPanel({ title, editing = false, onToggle, intro, done = "Done", who, className, list, children }: {
  title?: string; editing?: boolean; onToggle?: (on: boolean) => void; intro?: ReactNode; done?: string; who?: string; className?: string; list?: string; children?: ReactNode;
}) {
  return (
    <section className={`al-panel panel settings-panel${editing ? " editing" : ""}${className ? ` ${className}` : ""}`} data-list={list}>
      <div className="panel-head">{title ? <h2>{title}</h2> : <span />}
        {who && FOR[who] ? <span className="al-badge al-badge--outline">{FOR[who]}</span> : null}
        {onToggle ? <button className="al-button al-button--sm al-button--quiet settings-edit" type="button" onClick={() => onToggle(!editing)}>{editing ? done : "Edit"}</button> : null}
      </div>
      {intro ? <p className="muted">{intro}</p> : null}
      {children}
    </section>
  );
}

/** A row's edit and remove links. */
const RowActions = ({ what, edit, remove }: { what: string; edit?: () => void; remove?: () => void }) => (
  <span className="row-actions">
    {edit ? <button className="al-button al-button--sm al-button--quiet" type="button" aria-label={`Edit ${what}`} onClick={edit}>edit</button> : null}
    {remove ? <button className="al-button al-button--sm al-button--quiet al-button--danger" type="button" aria-label={`Remove ${what}`} onClick={remove}>remove</button> : null}
  </span>
);

const AddLink = ({ label, onClick }: { label: string; onClick: () => void }) => <button className="al-button al-button--quiet app-add" type="button" onClick={onClick}>{`+ ${label}`}</button>;

/** Save and Cancel, for a section edited as a whole. */
const SaveCancel = ({ save, cancel }: { save: () => void; cancel: () => void }) => (
  <div className="actions">
    <button className="al-button al-button--primary" type="button" onClick={save}>Save</button>
    <button className="al-button" type="button" onClick={cancel}>Cancel</button>
  </div>
);

/** A section that reads first and is edited as a whole: its editing state. */
function useEditing() {
  const [editing, setEditing] = useState(false);
  return [editing, setEditing] as const;
}

/** Settings' tabs: each one's key, name, what's in it, and its icon. */
const SETTINGS_TABS: [string, string, string, string][] = [
  ["general", "General", "Appearance, language", "sliders"],
  ["board", "Board", "Swimlanes, stages, sub stages", "board"],
  ["calendar", "Calendar", "Hours, time zones, sharing", "cal"],
  ["data", "Data", "Backup, audit log", "database"],
  ["connections", "Connections", GMAIL ? "LinkedIn, Gmail" : "LinkedIn", "link"],
  ["pay", "Pay and tax", "Where you live, take-home", "calc"],
  ["tags", "Tags", "", "tag"],
  ["account", "Account", "Signing in, deleting", "user"],
];

export function SettingsPage() {
  useShared();
  // Back from signing in with Google: say how it went, then tidy the address.
  const [tab] = useState(() => {
    const q = new URLSearchParams(location.search);
    if (q.get("gmail") === "connected") toast(`Signed in with Google as ${q.get("address")}`);
    if (q.get("gmail_error")) toast(`Signing in with Google didn't work: ${q.get("gmail_error")}`, "error");
    const tabs = SETTINGS_TABS.filter(([k]) => k !== "account" || myAccount() || S.META.access);
    const t = tabs.some(([k]) => k === q.get("tab")) ? q.get("tab")! : (tabs.some(([k]) => k === stored("settingsTab")) ? stored("settingsTab")! : "general");
    history.replaceState(null, "", `/settings${t === "general" ? "" : `?tab=${t}`}`);
    settle();
    store("settingsTab", t);
    return t;
  });
  // Its sections are in the sidebar, in the app's place.
  const tabs = SETTINGS_TABS.filter(([k]) => k !== "account" || myAccount() || S.META.access);
  useEffect(() => {
    sectionNav.set({ label: "Settings sections", base: "settings",
      tabs: tabs.map(([k, label, hint, ic]) => [k, label, k === "tags" ? `${S.TAGS.length} ${S.TAGS.length === 1 ? "tag" : "tags"}` : hint, ic]), tab });
  });
  useEffect(() => () => sectionNav.set(null), []);
  const parts: Record<string, () => ReactNode> = {
    general: () => <><ThemeSettings /><LocaleSettings /></>,
    pay: () => <><LocationSettings />{takeHomeOn() ? <DesiredSettings /> : null}</>,
    board: () => <BoardSettings />,
    tags: () => <TagsSettings />,
    calendar: () => <><CalendarSettings /><CalendarFeedSettings /></>,
    connections: () => <><LinkedinSettings />{GMAIL ? <GmailSettings /> : null}</>,
    data: () => <><BackupSettings /><AuditSettings /></>,
    account: () => (myAccount() ? <AccountSettings /> : <SignInSettings />),
  };
  return (
    <div className="page settings">
      <header className="al-page-head"><h1>Settings</h1><p className="al-page-head__lede">Your preferences.</p></header>
      <div className="settings-content" id="settings-content" role="region" aria-labelledby={`settings-tab-${tab}`}>{parts[tab]()}</div>
    </div>
  );
}

// ---- calendar sharing -----------------------------------------------------------------

/** The calendar's private link (`/api/calendar/<secret>.ics`), while it's shared; null when not. */
const calendarFeedUrl = () => (S.PREFS.calendar_feed ? `${location.origin}/api/calendar/${S.PREFS.calendar_feed}.ics` : null);

/**
 * Sharing the calendar with a calendar app: off unless turned on. On, a
 * private link anyone who has it can subscribe to; a new one, and the old
 * one stops working; off, it stops working.
 */
function CalendarFeedSettings() {
  const set = async (value: boolean | string, message: string) => {
    const saved = await attempt(() => patch("settings", { calendar_feed: value }));
    if (!saved) return false;
    S.PREFS = saved;
    changed();
    toast(message);
    return true;
  };
  const url = calendarFeedUrl();
  return (
    <SettingsPanel title="Calendar sharing" intro="Interviews, deadlines and reminders, in any calendar app that can subscribe to a link.">
      <label className="switch al-label al-choice" htmlFor="set-calendar-share">
        <Input type="checkbox" role="switch" id="set-calendar-share" checked={!!url} onChange={(e) => {
          const on = e.target.checked;
          set(on, on ? "Calendar shared: copy its link into a calendar app" : "Calendar no longer shared: its link has stopped working");
        }} />{url ? "Shared with a private link" : "Not shared"}
      </label>
      {url ? <>
        <div className="settings-copy">
          <Input readOnly aria-label="Calendar link" value={url} className="settings-mono" />
          <button className="al-button" type="button" onClick={async () => {
            try { await navigator.clipboard.writeText(url); toast("Copied the calendar link"); } catch { toast("Couldn't copy; select the link instead", "error"); }
          }}><Icon name="copy" /><span>Copy link</span></button>
        </div>
        <p className="al-hint">Anyone with the link can see these events, without signing in.{" "}
          <button className="al-button al-button--quiet al-button--sm" type="button" onClick={() => set("new", "Made a new link. The old one stops working now.")}>Make a new link</button></p>
        {S.META.access ? <p className="muted small">This hunt is behind Cloudflare Access: for a calendar app to reach the link, Access needs a Bypass policy for the path /api/calendar/.</p> : null}
      </> : null}
    </SettingsPanel>
  );
}

/** Every change made, newest first: on a page of its own. */
const AuditSettings = () => (
  <SettingsPanel title="Audit log" who="everyone" intro="Every change you've made, newest first: what, when and to what.">
    <a className="al-link al-link--arrow" href="/activity">Open the audit log</a>
  </SettingsPanel>
);

/** Signed in through Cloudflare Access, with no account here: who, and signing out. */
const SignInSettings = () => (
  <SettingsPanel title="Your account" who="you">
    <Facts rows={[["Signed in as", <span translate="no">{S.META.access?.email || "—"}</span>], ["Sign-in", "Cloudflare Access"]]} />
    <div className="actions"><a className="al-button" href="/cdn-cgi/access/logout">Sign out</a></div>
  </SettingsPanel>
);

// ---- your account (a shared hunt) ---------------------------------------------------------

function AccountSettings() {
  const me = myAccount();
  return (
    <SettingsPanel title="Your account" who="you">
      <p><b translate="no">{me.email}</b></p>
      <p className="muted">Deleting your account deletes everything in it, at once and for good: applications, companies, people, notes, files and settings. Download a backup first if you might want any of it.
        {S.META.terms ? <>{" "}<a href={sitePage("/data-deletion/")} target="_blank" rel="noopener">More about deleting your data</a></> : null}</p>
      <div className="actions"><button className="al-button al-button--quiet al-button--danger" type="button" onClick={async () => {
        const d = await ask({ title: "Delete your account",
          body: <div className="fields">
            <p>This deletes your account and everything in it, for good. It can't be undone.</p>
            <Field><Label htmlFor="delete-confirm">Type your email address to confirm</Label>
              <Input id="delete-confirm" name="confirm" type="email" autoComplete="off" placeholder={me.email} /></Field>
          </div>,
          ok: "Delete for good", danger: true });
        if (!d) return;
        if (await attempt(() => api("DELETE", "account", { confirm: d.get("confirm") || "" }))) {
          // Gone: signed out of Access too, where there is one.
          location.href = tenancy()?.trying_out ? "/" : "/cdn-cgi/access/logout";
        }
      }}>Delete my account…</button></div>
    </SettingsPanel>
  );
}

// ---- appearance -----------------------------------------------------------------------

function ThemeSettings() {
  const [now, setNow] = useState(currentTheme());
  return (
    <SettingsPanel title="Appearance" who="browser">
      <div className="settings-row">
        <div className="settings-row-label"><span className="al-label">Theme</span><span className="al-hint">Each device keeps its own.</span></div>
        <div className="al-segmented" role="group" aria-label="Theme">
          {([["light", "Light"], ["dark", "Dark"], ["auto", "Match the system"]] as [string, string][]).map(([v, l]) => (
            <button key={v} type="button" aria-pressed={String(now === v) as "true" | "false"} onClick={() => { setTheme(v); setNow(v); changed(); toast("Theme changed"); }}>{l}</button>
          ))}
        </div>
      </div>
    </SettingsPanel>
  );
}

/** Regions dates and numbers can be written for. */
export const REGIONS: [string, string][] = [
  ["en-GB", "English (United Kingdom)"], ["en-US", "English (United States)"], ["en-IE", "English (Ireland)"],
  ["en-CA", "English (Canada)"], ["en-AU", "English (Australia)"], ["en-IN", "English (India)"],
  ["de-DE", "Deutsch (Deutschland)"], ["fr-FR", "Français (France)"], ["es-ES", "Español (España)"],
  ["it-IT", "Italiano (Italia)"], ["nl-NL", "Nederlands (Nederland)"], ["pt-PT", "Português (Portugal)"],
  ["sv-SE", "Svenska (Sverige)"], ["pl-PL", "Polski (Polska)"], ["ar-EG", "العربية (مصر)"],
  ["ar-SA", "العربية (السعودية)"], ["ar-AE", "العربية (الإمارات)"], ["ar-JO", "العربية (الأردن)"],
];

/** Every time zone the browser knows, by its IANA name. */
export const TIME_ZONES: string[] = (() => { try { return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone"); } catch { return []; } })();

export function currencyName(code: string) {
  try { return `${new Intl.DisplayNames(LOC(), { type: "currency" }).of(code)} (${code})`; } catch { return code; }
}

/** A select, uncontrolled, of [value, label] options. */
const Choose = ({ id, options, value, ...rest }: { id: string; options: [string, string][]; value: string } & React.ComponentProps<"select">) => (
  <Select id={id} defaultValue={value} {...rest}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
);
const SetField = ({ id, label, children, help }: { id: string; label: string; children: ReactNode; help?: string }) => (
  <Field><Label htmlFor={id}>{label}</Label>{children}{help ? <p className="muted small">{help}</p> : null}</Field>
);
/** The values of a form's controls, by id. */
const valuesOf = (el: HTMLElement | null) => Object.fromEntries([...(el?.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[id]") || [])].map((c) => [c.id, c.value]));

function LocaleSettings() {
  const [editing, setEditing] = useEditing();
  const form = useRef<HTMLDivElement>(null);
  const P = S.PREFS;
  useEffect(() => { if (editing) document.getElementById("set-language")?.focus(); }, [editing]);
  const region = (code: string | null) => (code ? REGIONS.find(([v]) => v === code)?.[1] || code
    : LANG !== "en" ? `The language's (${LANG})` : `The browser's (${navigator.language})`);
  const sample = () => `${zonedNow().toLocaleDateString(LOC(), { weekday: "short", day: "numeric", month: "short", year: "numeric" })}, ${fmtTime("14:30")} · ${homeK(150000)} a year`;
  const rate = P.currency !== "GBP" && P.currency_rate
    ? <span className="muted small">{` · pay is converted through GBP: 1 ${P.currency} = ${P.currency_rate.toFixed(4)} GBP, the rate on ${fmtDay(P.currency_rate_on)}`}</span>
    : null;
  return (
    <SettingsPanel title="Language and region" editing={editing} onToggle={setEditing} done="Cancel" who="everyone"
      intro="How hunt speaks, how dates, times and numbers are written, and the currency pay is compared in. Your time zone is in Calendar.">
      {!editing ? (
        <Facts rows={[
          ["Language", <span lang={P.language || "en"}>{choiceLabel(S.META.languages, P.language || "en")}</span>],
          ["Region", region(P.locale)],
          ["Numbers", choiceLabel(S.META.numerals, P.numerals || "auto")],
          ["Times", choiceLabel(S.META.clocks, P.clock)],
          ["Currency", <>{currencyName(P.currency)}{rate}</>],
          ["Looks like", sample()],
        ]} />
      ) : <>
        <div className="fields two" ref={form}>
          <SetField id="set-language" label="Language" help="The words, and which way the page reads."><Choose id="set-language" options={S.META.languages.map((o) => [o.value, o.label])} value={P.language || "en"} /></SetField>
          <SetField id="set-region" label="Region" help="Dates, numbers, and the names of days and months."><Choose id="set-region" options={[["", region(null)], ...REGIONS]} value={P.locale || ""} /></SetField>
          <SetField id="set-numerals" label="Numbers" help="Which digits numbers are written in."><Choose id="set-numerals" options={S.META.numerals.map((o: Row) => [o.value, o.label])} value={P.numerals || "auto"} /></SetField>
          <SetField id="set-clock" label="Times"><Choose id="set-clock" options={S.META.clocks.map((o: Row) => [o.value, o.label])} value={P.clock} /></SetField>
          <SetField id="set-currency" label="Currency" help="Pay is shown in it, converted at today's rate where a posting gives another."><Choose id="set-currency" options={CURRENCIES.map((c) => [c, currencyName(c)])} value={P.currency} /></SetField>
        </div>
        <SaveCancel cancel={() => setEditing(false)} save={async () => {
          const v = valuesOf(form.current);
          const saved = await attempt(() => patch("settings", {
            language: v["set-language"], locale: v["set-region"], numerals: v["set-numerals"], clock: v["set-clock"], currency: v["set-currency"],
          }));
          if (!saved) return;
          // Another language or script redraws everything, in it.
          const relanguage = saved.language !== S.PREFS.language || saved.numerals !== S.PREFS.numerals;
          S.PREFS = saved;
          if (relanguage) { setLanguage(saved.language, saved.numerals); location.reload(); return; }
          changed();
          toast("Saved");
          setEditing(false);
        }} />
      </>}
    </SettingsPanel>
  );
}

// ---- the calendar -----------------------------------------------------------------------

/** A time zone's name to read: "Asia/Tokyo" as "Tokyo", with its offset now ("GMT+9"). */
function zoneName(zone: string) {
  const city = zone.split("/").pop()!.replaceAll("_", " ");
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
function CalendarSettings() {
  const [editing, setEditing] = useEditing();
  const P = S.PREFS;
  const zone = (name: string | null) => name || `The machine's (${P.server_timezone})`;
  const work = P.work_hours;
  const dayNames = (days: string[]) => {
    // Monday to Friday reads as a range; anything else, day by day.
    const all = S.META.weekdays.map((d: Row) => d.value);
    const i = all.indexOf(days[0]);
    const run = days.length > 2 && i >= 0 && days.every((d, n) => all[i + n] === d);
    const name = (d: string) => new Date(2024, 0, 1 + all.indexOf(d)).toLocaleDateString(LOC(), { weekday: "short" });
    return run ? `${name(days[0])}–${name(days[days.length - 1])}` : days.map(name).join(", ");
  };
  return (
    <SettingsPanel title="Time and hours" editing={editing} onToggle={setEditing} done="Cancel"
      intro="Your time zone and working hours, and other time zones to see beside yours in the calendar's day and week.">
      {!editing ? (
        <Facts rows={[
          ["Time zone", zone(P.timezone)],
          ["Weeks start on", choiceLabel(S.META.week_starts, P.week_start)],
          ["Working hours", work ? `${fmtTime(work.start)}–${fmtTime(work.end)}, ${dayNames(work.days)}` : <span className="muted">Not set</span>],
          ["Other time zones", P.calendar_zones.length ? P.calendar_zones.map(zoneName).join(" · ") : <span className="muted">None</span>],
        ]} />
      ) : <CalendarForm zone={zone} done={() => setEditing(false)} />}
    </SettingsPanel>
  );
}

function CalendarForm({ zone, done }: { zone: (n: string | null) => string; done: () => void }) {
  const P = S.PREFS;
  const work = P.work_hours;
  const zones: [string, string][] = TIME_ZONES.map((z) => [z, z.replaceAll("_", " ")]);
  const [timezone, setTimezone] = useState(P.timezone || "");
  const [week, setWeek] = useState(P.week_start);
  const [hoursOn, setHoursOn] = useState(!!work);
  const [start, setStart] = useState(work?.start || "09:00");
  const [end, setEnd] = useState(work?.end || "17:30");
  const [days, setDays] = useState<string[]>(work?.days || ["monday", "tuesday", "wednesday", "thursday", "friday"]);
  const [others, setOthers] = useState<string[]>([...P.calendar_zones]);
  const box = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);
  useEffect(() => { document.getElementById("set-timezone")?.focus(); }, []);
  useEffect(() => {
    if (focusLast.current) { box.current?.querySelector<HTMLElement>(".other-zone:last-of-type select")?.focus(); focusLast.current = false; }
  }, [others.length]);
  return <>
    <div className="fields two">
      <SetField id="set-timezone" label="Time zone" help="What “today” and “now” are, for hunt and its calendar feed; interview times are in it.">
        <Select id="set-timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
          {([["", zone(null)], ...zones] as [string, string][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
      </SetField>
      <SetField id="set-week" label="Weeks start on">
        <Select id="set-week" value={week} onChange={(e) => setWeek(e.target.value)}>{S.META.week_starts.map((o: Row) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
      </SetField>
    </div>
    <Field>
      <label className="switch al-label al-choice" htmlFor="set-work-on"><Input type="checkbox" role="switch" id="set-work-on" checked={hoursOn} onChange={(e) => setHoursOn(e.target.checked)} />Working hours</label>
      <p className="muted small">The hours outside them are shaded in the calendar's day and week.</p>
      {/* Working hours: on or off; from, to, and on which days. */}
      <div className="work-hours" hidden={!hoursOn}>
        <div className="work-times">
          <SetField id="set-work-start" label="From"><Input type="time" id="set-work-start" value={start} step={900} onChange={(e) => setStart(e.target.value)} /></SetField>
          <SetField id="set-work-end" label="To"><Input type="time" id="set-work-end" value={end} step={900} onChange={(e) => setEnd(e.target.value)} /></SetField>
        </div>
        <fieldset className="work-days"><legend>On</legend>
          {S.META.weekdays.map((d: Row) => (
            <label key={d.value} className="check al-choice"><input type="checkbox" value={d.value} checked={days.includes(d.value)}
              onChange={(e) => setDays(e.target.checked ? S.META.weekdays.map((x: Row) => x.value).filter((x: string) => x === d.value || days.includes(x)) : days.filter((x) => x !== d.value))} />{d.label}</label>
          ))}
        </fieldset>
      </div>
    </Field>
    <Field>
      <span className="al-label">Other time zones</span>
      <p className="muted small">{`Their hours beside yours in the day and week, to see when an interview elsewhere falls; up to ${S.META.max_calendar_zones}.`}</p>
      {/* Other time zones: a select each, added and removed. */}
      <div className="other-zones" ref={box}>
        {others.map((z, i) => (
          <div key={i} className="other-zone">
            <Select aria-label={`Other time zone ${i + 1}`} value={z} onChange={(e) => setOthers(others.map((x, j) => (j === i ? e.target.value : x)))}>
              {zones.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
            <button className="al-button al-button--sm al-button--quiet al-button--danger" type="button" onClick={() => setOthers(others.filter((_, j) => j !== i))}>remove</button>
          </div>
        ))}
        {others.length < S.META.max_calendar_zones
          ? <AddLink label="Add a time zone" onClick={() => { focusLast.current = true; setOthers([...others, others.length ? "America/New_York" : "Europe/London"]); }} /> : null}
      </div>
    </Field>
    <SaveCancel cancel={done} save={async () => {
      const saved = await attempt(() => patch("settings", {
        timezone, week_start: week,
        work_hours: hoursOn ? { start, end, days } : null,
        calendar_zones: others,
      }));
      if (!saved) return;
      S.PREFS = saved;
      changed();
      toast("Saved");
      done();
    }} />
  </>;
}

// ---- location ---------------------------------------------------------------------------

/** Where you live: a UK resident has take-home pay (where it's on), for their part of the UK. */
function LocationSettings() {
  const [editing, setEditing] = useEditing();
  const [uk, setUk] = useState(!!S.PREFS.uk_resident);
  const [region, setRegion] = useState(S.PREFS.uk_region || S.META.uk_regions?.[0]?.value);
  useEffect(() => { if (editing) { setUk(!!S.PREFS.uk_resident); document.getElementById("set-uk")?.focus(); } }, [editing]);
  const what = <p className="muted small">{S.PREFS.uk_resident
    ? "Take-home pay is on, and on applications that give their pay."
    : "Take-home pay works out UK tax, so it's for those who live in the UK: what you'd keep of a salary or a contractor's rate, and of applications' pay."}</p>;
  return (
    <SettingsPanel title="Where you live" editing={editing} onToggle={setEditing} done="Cancel" who="you" intro="For working out tax on your pay.">
      {!editing ? <>
        <Facts rows={[["UK resident", S.PREFS.uk_resident ? "Yes" : "No"], ...(S.PREFS.uk_resident ? [["Part of the UK", choiceLabel(S.META.uk_regions, S.PREFS.uk_region)] as [string, string]] : [])]} />
        {what}
      </> : <>
        <div className="location-fields">
          <label className="check al-choice"><input id="set-uk" type="checkbox" checked={uk} onChange={(e) => setUk(e.target.checked)} /><span>I live in the UK (a UK resident, for tax)</span></label>
          <Field hidden={!uk}><Label htmlFor="set-uk-region">Part of the UK</Label>
            <Select id="set-uk-region" value={region} onChange={(e) => setRegion(e.target.value)}>{S.META.uk_regions.map((o: Row) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
            <p className="muted small">Scotland has its own income tax bands.</p></Field>
        </div>
        {what}
        <SaveCancel cancel={() => setEditing(false)} save={async () => {
          const saved = await attempt(() => patch("settings", { uk_resident: uk, uk_region: region }));
          if (!saved) return;
          S.PREFS = saved;
          changed();
          toast("Saved");
          setEditing(false);
        }} />
      </>}
    </SettingsPanel>
  );
}

// ---- desired take-home pay ---------------------------------------------------------------

/** The take-home pay you want, in your currency: Take-home pay sets its figures against it. */
function DesiredSettings() {
  const [editing, setEditing] = useEditing();
  const want = S.PREFS.desired_take_home;
  const [amount, setAmount] = useState("");
  const [per, setPer] = useState("month");
  useEffect(() => {
    if (!editing) return;
    setAmount(want == null ? "" : String(want));
    setPer(S.PREFS.desired_take_home_per || "month");
    requestAnimationFrame(() => document.getElementById("set-desired")?.focus());
  }, [editing]);
  const words: Record<string, string> = { week: "a week", month: "a month", year: "a year" };
  return (
    <SettingsPanel title="What you want to take home" editing={editing} onToggle={setEditing} done="Cancel" who="you"
      intro="Take-home pay, and every application's pay, compare with this. Take-home pay starts from it when you work back from what you want.">
      {!editing ? (
        <Facts rows={[["Desired net take-home pay", want == null ? <span className="muted">Not set</span>
          : <>{money(want, HOME())}{" "}<span>{words[S.PREFS.desired_take_home_per] || "a month"}</span></>]]} />
      ) : <>
        <div className="fields two">
          <Field><Label htmlFor="set-desired">Desired net take-home pay</Label>
            <Input id="set-desired" type="text" inputMode="decimal" autoComplete="off" placeholder="e.g. 4,000" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <p className="muted small"><span>After tax, in</span>{" "}{currencyName(HOME())}{". "}<span>Leave it empty for none.</span></p></Field>
          <Field><Label htmlFor="set-desired-per">Pay period</Label>
            <Select id="set-desired-per" value={per} onChange={(e) => setPer(e.target.value)}>
              {([["week", "Weekly"], ["month", "Monthly"], ["year", "Annually"]] as [string, string][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        </div>
        <SaveCancel cancel={() => setEditing(false)} save={async () => {
          const n = takeHomeNumber(amount);
          if (Number.isNaN(n)) { toast("That isn't a number hunt can read: try 4000 or 4k.", "error"); return; }
          const saved = await attempt(() => patch("settings", { desired_take_home: n, desired_take_home_per: per }));
          if (!saved) return;
          S.PREFS = saved;
          changed();
          toast("Saved");
          setEditing(false);
        }} />
      </>}
    </SettingsPanel>
  );
}

// ---- integrations -----------------------------------------------------------------------

/** Settings: the bookmark that brings LinkedIn profiles in, and its settings. */
function LinkedinSettings() {
  const [editing, setEditing] = useEditing();
  const [prefs, setPrefs] = useState<Row | null>(null);
  const [address, setAddress] = useState("");
  const [rule, setRule] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => { get("settings").then((p) => { setPrefs(p); setAddress(p.bookmarklet_url || ""); setRule(p.same_name); }).catch(() => {}); }, [version]);
  useEffect(() => { if (editing) setTimeout(() => document.getElementById("bm-url")?.focus(), 0); }, [editing]);
  if (!prefs) return null;
  const origin = prefs.bookmarklet_url || location.origin;
  const href = profileBookmarklet(origin);
  return (
    <SettingsPanel title="LinkedIn bookmark" editing={editing} onToggle={setEditing} done="Cancel" who="browser" className="linkedin"
      intro="LinkedIn only shows profiles to people signed in, so hunt can't read them itself. This bookmark reads the profile open in your browser instead, and brings it here to choose what to keep.">
      <ol className="steps-help">
        <li>Drag{" "}<a className="al-button al-button--sm bookmarklet" title="Drag me to your bookmarks bar"
          // Its javascript: address set on the link itself: React won't put one in an href.
          ref={(el) => { if (el && el.getAttribute("href") !== href) el.setAttribute("href", href); }}
          onClick={(e) => { e.preventDefault(); toast("Drag it to your bookmarks bar, then click it on a LinkedIn profile"); }}>
          <img src="/logo.svg" alt="" width={18} height={18} />Send to hunt</a>{" to your bookmarks bar (show it with ⇧⌘B)."}</li>
        <li>Open someone's profile on LinkedIn, and click the bookmark.</li>
        <li>hunt opens with what it found: their name, role, company, location, about and photo. Tick what to keep.</li>
      </ol>
      {!editing ? (
        <Facts rows={[
          ["hunt's address", prefs.bookmarklet_url || <span>{location.origin}<span className="muted small"> · this page's</span></span>],
          ["Same name", choiceLabel(S.META.same_name, prefs.same_name)],
        ]} />
      ) : <>
        <div className="fields">
          <Field><Label htmlFor="bm-url">hunt's address</Label><Input type="url" id="bm-url" placeholder={location.origin} value={address} onChange={(e) => setAddress(e.target.value)} />
            <p className="muted small">Where the bookmark opens hunt. Leave empty for the address this page is at; set it when you open hunt at another one (e.g. http://hunt.local:4848). After changing it, drag the bookmark again.</p></Field>
          <Field><Label htmlFor="bm-same">When someone of the same name is already here</Label>
            <Select id="bm-same" value={rule} onChange={(e) => setRule(e.target.value)}>{S.META.same_name.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
            <p className="muted small">Someone kept with the same LinkedIn profile is always merged into. This is for people added by hand, or under another link.</p></Field>
        </div>
        <SaveCancel cancel={() => setEditing(false)} save={async () => {
          const saved = await attempt(() => patch("settings", { bookmarklet_url: address, same_name: rule }));
          if (!saved) return;
          toast((saved.bookmarklet_url || "") !== (prefs.bookmarklet_url || "") ? "Saved. Drag the bookmark to your bar again, replacing the old one" : "Saved");
          setEditing(false);
          setVersion((n) => n + 1);
        }} />
      </>}
      <details className="al-disclosure more"><summary>Giving the bookmark hunt's icon</summary>
        <p className="small">Browsers don't let a bookmarklet choose its icon. A workaround that keeps hunt's icon in some browsers (Firefox does; Chrome and Safari usually don't): bookmark this page, so the bookmark takes hunt's icon, then edit it and paste the bookmark's code in as its address.</p>
        <div className="actions"><button className="al-button al-button--sm" type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(href); toast("Copied the bookmark's code"); } catch { toast("Couldn't copy; drag the button instead", "error"); }
        }}>Copy code</button></div>
      </details>
      <p className="muted small">It only reads the page you're on, when you click it, and sends it to <span className="muted">{origin}</span>. Nothing goes anywhere else.</p>
    </SettingsPanel>
  );
}

// ---- backups ---------------------------------------------------------------------------

/** Settings: save everything to a file, or bring a saved one back. */
function BackupSettings() {
  const [status, setStatus] = useState("");
  const picker = useFilePicker("application/json,.json", async (f) => {
    // Check it's a backup, and say what's in it, before anything is replaced.
    let backup: Row;
    try { backup = JSON.parse(await f.text()); } catch { toast(`${f.name} isn't a hunt backup`, "error"); return; }
    if (!backup || backup.hunt_backup == null || !backup.tables) { toast(`${f.name} isn't a hunt backup`, "error"); return; }
    const c = backup.counts || {};
    const n = (k: string) => c[k] ?? (backup.tables[k] || []).length;
    const ok = await ask({
      title: "Replace everything with this backup?",
      body: <div className="fields">
        <p>{`${f.name}, made ${backup.made_at ? fmtStamp(backup.made_at) : "at an unknown time"}: `}
          {`${n("process")} processes, ${n("application")} applications, ${n("company")} companies, ${n("person")} people, `}
          {`${n("version")} file versions, and ${n("activity")} changes in the log.`}</p>
        <p><b>Everything here now is replaced</b>, including Settings (but not the Gmail connection). It can't be undone, so{" "}
          <a href="/api/backup">download a backup of what's here</a> first if you might want it.</p>
      </div>,
      ok: "Replace everything", danger: true,
    });
    if (!ok) return;
    setStatus("Importing…");
    const res = await fetch("/api/backup?confirm=replace", { method: "POST", headers: { "Content-Type": "application/json" }, body: f });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setStatus(""); toast(data.error || "The import didn't work", "error"); return; }
    setStatus(`Imported ${f.name}.`);
    toast("Backup imported");
    await reloadMeta();
  });
  return (
    <section className="al-panel panel settings-panel backup">
      <div className="panel-head"><h2>Backup</h2></div>
      <p>A backup is one file with everything hunt tracks: processes, applications, companies, people, files, tags, settings and the change log. It works with any database hunt can use, so it also moves your data from one to another.</p>
      <div className="actions">
        <a className="al-button al-button--primary" href="/api/backup" download=""><Icon name="download" /><span>Download a backup</span></a>
        {picker.input}
        <button className="al-button" type="button" onClick={picker.open}>Import a backup…</button>
      </div>
      <p className="muted small" aria-live="polite">{status}</p>
      <p className="muted small">Importing replaces everything here with the backup's contents, all or nothing. The Gmail connection is neither saved nor replaced.</p>
    </section>
  );
}

// ---- the board: swimlanes, stages, sub stages --------------------------------------------

type Done = (message: string, undo: () => Promise<unknown>, then?: { focus?: string | number | null }) => void;
type Redraw = (o?: { focus?: string | number | null }) => void;

interface SubSpec {
  noun: string;
  of: (it: Row) => Row[];
  extra?: (x: Row, it: Row, done: Done) => ReactNode;
  rename: (x: Row, name: string) => Promise<unknown>;
  remove: (x: Row, it: Row) => Promise<(() => Promise<unknown>) | null>;
  reorder: (it: Row, ids: number[]) => Promise<unknown>;
  add: (it: Row, name: string) => Promise<Row>;
  drop: (added: Row) => Promise<unknown>;
}

interface OrderedProps {
  list: string; title?: string; intro?: string; items: Row[]; noun: string; focus: string | null; redraw: Redraw;
  rename: (it: Row, name: string) => Promise<unknown>;
  remove: (it: Row) => Promise<(() => Promise<unknown>) | null>;
  reorder: (ids: number[]) => Promise<unknown>;
  add: (name: string) => Promise<Row>;
  drop: (added: Row) => Promise<unknown>;
  placeholder: string; sub?: SubSpec | null; extra?: ((it: Row, done: Done) => ReactNode) | null;
  rowClass?: ((it: Row) => string) | null; nest?: ((it: Row) => ReactNode) | null; scope?: string; bare?: boolean; before?: ReactNode;
}

/** A name, edited in place: saved when left, or on Enter; Escape puts it back. */
function NameField({ it, label, save, redraw }: { it: Row; label: string; save: (it: Row, name: string) => Promise<unknown>; redraw: Redraw }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = ref.current!;
    const onChange = async () => {
      const was = it.name;
      const now = input.value.trim();
      if (!now || now === was) { input.value = was; return; }
      if (!(await attempt(() => save(it, now)))) { input.value = was; return; }
      it.name = now;
      toast(`Renamed “${was}” to “${now}”`, "info", { label: "Undo", onclick: async () => {
        if (await attempt(() => save(it, was))) { toast("Undone"); redraw(); }
      } });
    };
    input.addEventListener("change", onChange);
    return () => input.removeEventListener("change", onChange);
  });
  return <Input className="inline-name" ref={ref} defaultValue={it.name} aria-label={label} spellCheck={false}
    onKeyDown={(e) => {
      if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
      else if (e.key === "Escape") { e.currentTarget.value = it.name; e.currentTarget.blur(); }
    }} />;
}

/**
 * An ordered list (stages, reasons), edited where it is. A name saves when
 * it's left (or on Enter), and Escape puts it back; ↑ ↓ or dragging
 * reorders; × removes; the box under the list adds. Each change saves at
 * once and says so, with Undo. `sub`, when given, lists what belongs to
 * each item indented under it (a stage's lanes), edited the same way.
 * `remove` removes (asking first only where something must go elsewhere)
 * and gives back what puts it back, or null if nothing was removed; `drop`
 * takes away one just added.
 */
function OrderedSettings({ list, title, intro, items, noun, focus, redraw, rename, remove, reorder, add, drop, placeholder, sub = null, extra = null, rowClass = null, nest = null, scope = "", bare = false, before = null }: OrderedProps) {
  const listEl = useRef<HTMLOListElement>(null);
  const nameBox = useRef<HTMLInputElement>(null);
  const [dragOrder, setDragOrder] = useState<number[] | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  // What's focused after drawing, as this list names it (`scope` keeps a
  // nested list's apart from its row's): a row's id, or new, new-ID, sub-ID.
  const at = (f: string | number | null | undefined) => (f == null ? null : `${scope}${f}`);
  // Done: drawn again, and said, with Undo, which draws it again once undone.
  const done: Done = (message, undo, then = {}) => {
    const t = { ...then, focus: at(then.focus) };
    redraw(t);
    toast(message, "info", { label: "Undo", onclick: async () => {
      if (await attempt(async () => { await undo(); return true; })) { toast("Undone"); redraw(t); }
    } });
  };
  // Moved: saved, with Undo putting the old order back.
  const moved = async (what: string, was: number[], now: number[], save: (ids: number[]) => Promise<unknown>, then?: { focus?: string | number | null }) => {
    if (was.join() === now.join()) return;
    if (await attempt(() => save(now))) done(`Moved ${what}`, () => save(was), then);
  };
  const removed = async (it: Row, run: () => Promise<(() => Promise<unknown>) | null>) => {
    const undo = await attempt(run);
    if (undo) done(`Removed ${it.name}`, undo);
  };
  useLayoutEffect(() => {
    if (focus == null) return;
    if (focus === at("new")) nameBox.current?.focus();
    else listEl.current?.querySelector(`[data-focus="${focus}"]`)?.closest("li")?.querySelector("input")?.focus();
  }, [focus]);
  const order = items.map((x) => x.id);
  const shown = dragOrder ? dragOrder.map((id) => items.find((x) => x.id === id)!) : items;
  const subRows = (it: Row): ReactNode[] => {
    if (!sub) return [];
    const mine = sub.of(it);
    const ids = mine.map((y) => y.id);
    const rows = mine.map((x, k) => {
      const nudge = (by: number) => {
        const j = k + by;
        if (j < 0 || j >= ids.length) return;
        const next = [...ids];
        [next[k], next[j]] = [next[j], next[k]];
        moved(x.name, ids, next, (o) => sub.reorder(it, o), { focus: `sub-${x.id}` });
      };
      return (
        <li key={`sub-${x.id}`} className="sub-row" data-sub={x.id} data-focus={at(`sub-${x.id}`) || undefined}>
          <span className="sub-mark" aria-hidden="true">↳</span>
          <NameField it={x} label={`${sub.noun[0].toUpperCase()}${sub.noun.slice(1)} name, in ${it.name}`} save={sub.rename} redraw={redraw} />
          {/* Something of the sub row's own, before its buttons (a sub stage's Folded switch). */}
          {sub.extra ? sub.extra(x, it, done) : null}
          <button className="al-button al-button--icon al-button--sm" type="button" aria-label={`Move ${x.name} up`} title="Move up" disabled={k === 0} onClick={() => nudge(-1)}>↑</button>
          <button className="al-button al-button--icon al-button--sm" type="button" aria-label={`Move ${x.name} down`} title="Move down" disabled={k === ids.length - 1} onClick={() => nudge(1)}>↓</button>
          <button className="al-button al-button--icon al-button--sm al-button--danger" type="button" aria-label={`Remove ${x.name}`} title={`Remove ${sub.noun}`} onClick={() => removed(x, () => sub.remove(x, it))}>×</button>
        </li>
      );
    });
    // Adding one: a link, until it's this stage's turn.
    if (focus !== at(`new-${it.id}`)) {
      return [...rows, (
        <li key={`sub-add-${it.id}`} className="sub-row sub-add"><span className="sub-mark" aria-hidden="true">↳</span>
          <button className="al-button al-button--quiet app-add" type="button" aria-label={`Add a ${sub.noun} to ${it.name}`} onClick={() => redraw({ focus: at(`new-${it.id}`) })}>{`+ Add a ${sub.noun}`}</button></li>
      )];
    }
    return [...rows, <SubAdd key={`sub-add-${it.id}`} it={it} sub={sub} redraw={redraw} done={done} focusKey={at(`new-${it.id}`)!} />];
  };
  return (
    <SettingsShell bare={bare} title={title} intro={intro} list={list}>
      {before}
      {items.length ? (
        <ol className="stage-list" ref={listEl} onDragOver={(e) => {
          // Its own rows: a nested list's are its own to move.
          if (dragging == null || !order.includes(dragging)) return;
          e.preventDefault();
          e.stopPropagation();
          const rows = [...listEl.current!.querySelectorAll<HTMLElement>(":scope > li.stage")];
          const beforeRow = rows.find((x) => Number(x.dataset.id) !== dragging && e.clientY < x.getBoundingClientRect().top + x.offsetHeight / 2);
          const now = (dragOrder || order).filter((id) => id !== dragging);
          const i = beforeRow ? now.indexOf(Number(beforeRow.dataset.id)) : now.length;
          now.splice(i, 0, dragging);
          if (now.join() !== (dragOrder || order).join()) setDragOrder(now);
        }}>
          {shown.flatMap((it, i) => {
            const nudge = (by: number) => {
              const j = i + by;
              if (j < 0 || j >= order.length) return;
              const next = [...order];
              [next[i], next[j]] = [next[j], next[i]];
              moved(it.name, order, next, reorder, { focus: it.id });
            };
            return [
              <li key={`row-${it.id}`} className={["stage", rowClass ? rowClass(it) : "", dragging === it.id ? "dragging" : ""].filter(Boolean).join(" ")} draggable="true"
                data-id={it.id} data-focus={at(it.id) || undefined}
                // Dragged by its row, not from inside its name.
                onDragStart={(e) => {
                  if ((e.target as Element).closest?.("input")) { e.preventDefault(); return; }
                  e.stopPropagation();
                  e.dataTransfer.setData("text/plain", String(it.id));
                  setDragging(it.id);
                }}
                onDragEnd={(e) => {
                  e.stopPropagation();
                  const now = dragOrder || order;
                  setDragging(null);
                  setDragOrder(null);
                  moved(it.name, order, now, reorder);
                }}>
                <span className="handle" aria-hidden="true" title="Drag to reorder">⋮⋮</span>
                <span className="stage-no" aria-hidden="true">{i + 1}</span>
                <NameField it={it} label={`${noun[0].toUpperCase()}${noun.slice(1)} name`} save={rename} redraw={redraw} />
                {/* Something of the row's own, before its buttons (a stage's Active switch). */}
                {extra ? extra(it, done) : null}
                <button className="al-button al-button--icon al-button--sm" type="button" aria-label={`Move ${it.name} up`} title="Move up" disabled={i === 0} onClick={() => nudge(-1)}>↑</button>
                <button className="al-button al-button--icon al-button--sm" type="button" aria-label={`Move ${it.name} down`} title="Move down" disabled={i === order.length - 1} onClick={() => nudge(1)}>↓</button>
                <button className="al-button al-button--icon al-button--sm al-button--danger" type="button" aria-label={`Remove ${it.name}`} title={`Remove ${noun}`} onClick={() => removed(it, () => remove(it))}>×</button>
              </li>,
              ...subRows(it),
              // A row's own list (a swimlane's stages), under it.
              nest ? <li key={`nest-${it.id}`} className="nested">{nest(it)}</li> : null,
            ];
          })}
        </ol>
      ) : <p className="muted">{`No ${noun}s yet.`}</p>}
      <form className="inline-add" onSubmit={async (e) => {
        e.preventDefault();
        const v = (nameBox.current?.value || "").trim();
        if (!v) return;
        const added = await attempt(() => add(v));
        if (added) { if (nameBox.current) nameBox.current.value = ""; done(`Added ${v}`, () => drop(added), { focus: "new" }); }
      }}>
        <Input ref={nameBox} aria-label={`New ${noun}`} placeholder={placeholder} required />
        <button className="al-button al-button--primary" type="submit">{`Add ${noun}`}</button>
      </form>
    </SettingsShell>
  );
}

/** A list in a panel of its own; or bare, in another's row (nest). */
function SettingsShell({ bare, title, intro, list, children }: { bare: boolean; title?: string; intro?: string; list: string; children: ReactNode }) {
  if (bare) return <div className="nested-list" data-list={list}>{children}</div>;
  return <SettingsPanel title={title} intro={intro} who="everyone" list={list}>{children}</SettingsPanel>;
}

/** A sub stage's name, being added under its stage. */
function SubAdd({ it, sub, redraw, done, focusKey }: { it: Row; sub: SubSpec; redraw: Redraw; done: Done; focusKey: string }) {
  const box = useRef<HTMLInputElement>(null);
  return (
    <li className="sub-row sub-add"><span className="sub-mark" aria-hidden="true">↳</span>
      <form className="inline-add" onSubmit={async (e) => {
        e.preventDefault();
        const name = (box.current?.value || "").trim();
        if (!name) return;
        const added = await attempt(() => sub.add(it, name));
        if (added) done(`Added ${name} to ${it.name}`, () => sub.drop(added), { focus: `new-${it.id}` });
      }}>
        <Input ref={box} aria-label={`New ${sub.noun} in ${it.name}`} placeholder={`New ${sub.noun}, e.g. Accepted`} data-focus={focusKey}
          onKeyDown={(e) => { if (e.key === "Escape") redraw(); }} />
        <button className="al-button" type="submit">{`Add ${sub.noun}`}</button>
      </form>
    </li>
  );
}

/** Processes as `restore` takes them back: each where it was, with what it had. */
const restoreProcesses = (states: Row[]) => (states.length ? post("processes/bulk", { action: "restore", states }) : null);

// The board's settings, drawn: drawn again (a toast's Undo may outlive the drawing it came from).
let boardRedraw: Redraw | null = null;

/** A switch in a list's row: on or off, saved at once, with Undo. */
function RowSwitch({ id, title, label, checked, set, done, said, focus }: {
  id: string; title: string; label: string; checked: boolean; set: (on: boolean) => Promise<unknown>;
  done: Done; said: (on: boolean) => string; focus: string | number;
}) {
  const [on, setOn] = useState(checked);
  return (
    <label className="switch stage-active al-label al-choice" htmlFor={id} title={title}>
      <Input type="checkbox" role="switch" id={id} checked={on} onChange={async (e) => {
        const now = e.target.checked;
        setOn(now);
        if (!(await attempt(() => set(now)))) { setOn(!now); return; }
        done(said(now), () => set(!now), { focus });
      }} />
      <span>{label}</span>
    </label>
  );
}

/**
 * The board, in Settings: its swimlanes, top to bottom, each a box with its
 * stages in it, and each stage with its sub stages. Removing a swimlane
 * moves its stages to the first.
 */
function BoardSettings() {
  const [data, setData] = useState<{ swimlanes: Row[]; stages: Row[]; lanes: Row[] } | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const redraw: Redraw = (o = {}) => { setFocus((o.focus as string) ?? null); setVersion((n) => n + 1); };
  useEffect(() => { boardRedraw = redraw; return () => { boardRedraw = null; }; });
  useEffect(() => {
    (async () => {
      // The reasons for closing are sub stages here: what offers them, drawn again with them.
      await reloadMeta();
      const [swimlanes, stages, lanes] = await Promise.all([get("swimlanes"), get("stages"), get("lanes")]);
      setData({ swimlanes, stages, lanes });
    })().catch((e) => toast(e.message, "error"));
  }, [version]);
  if (!data) return null;
  const again: Redraw = (o) => (boardRedraw || redraw)(o);
  const { swimlanes, stages, lanes } = data;
  // By swimlane, as the board has them (a stage in none, in the first).
  const groups = swimlanes.length ? swimlanes : [{ id: null, name: null }];
  const known = new Set(groups.map((w) => w.id));
  const of = (st: Row) => (known.has(st.swimlane_id) ? st.swimlane_id : groups[0].id);
  const inGroup = (w: Row) => stages.filter((st) => of(st) === w.id);
  // A swimlane's stages reordered: every stage's order, the others' as they are.
  const order = (w: Row, ids: number[]) => groups.flatMap((x) => (x.id === w.id ? ids : inGroup(x).map((st) => st.id)));
  // The swimlane it's in (none: the first).
  const swimlanePick = (st: Row, done: Done) => {
    if (swimlanes.length < 2) return null;
    const first = swimlanes[0]?.id;
    const now = swimlanes.some((w) => w.id === st.swimlane_id) ? st.swimlane_id : first;
    // At the end of the one it goes to.
    const set = async (to: number) => {
      await patch(`stages/${st.id}`, { swimlane_id: to });
      const ids = groups.flatMap((w) => [...inGroup(w).map((x) => x.id).filter((x) => x !== st.id), ...(w.id === to ? [st.id] : [])]);
      await post("stages/order", { ids });
    };
    return (
      <Select className="stage-swimlane" aria-label={`${st.name}'s swimlane`} title="Its swimlane, the board's row it's in" defaultValue={now} onChange={async (e) => {
        const to = Number(e.target.value);
        const el = e.target;
        if (!(await attempt(() => set(to)))) { el.value = String(now); return; }
        done(`Moved ${st.name} to ${swimlanes.find((w) => w.id === to)?.name}`, () => set(now), { focus: st.id });
      }}>{swimlanes.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
    );
  };
  // A sub stage again, in its place among its stage's, with its cards back in it.
  const restoreLane = async (l: Row, stageId: number, ids: number[], cards: Row[]) => {
    const back = await post("lanes", { stage_id: stageId, name: l.name, folded: l.folded ?? null, is_default: l.is_default || 0 });
    await post(`stages/${stageId}/lanes/order`, { ids: ids.map((id) => (id === l.id ? back.id : id)) });
    await restoreProcesses(cards.map((p) => ({ ...p, stage_id: stageId, lane_id: back.id })));
    return back;
  };
  // A stage's swimlane's stages, in its box.
  const stageList = (w: Row) => (
    <OrderedSettings list={`stages-${w.id ?? 0}`} noun="stage" focus={focus} redraw={again} bare scope={`s${w.id ?? 0}-`}
      extra={(st, done) => (
        <span className="stage-switches">
          {swimlanePick(st, done)}
          {/* Terminal: a process in it is closed, its sub stage being why. */}
          <RowSwitch id={`stage-terminal-${st.id}`} title="A process in a terminal stage is closed; its sub stages are the reasons" label="Terminal stage"
            checked={st.active === 0} set={(on) => patch(`stages/${st.id}`, { active: on ? 0 : 1 })} done={done} focus={st.id}
            said={(on) => (on ? `${st.name} is terminal: its processes are closed` : `${st.name} isn't terminal: its processes are open`)} />
          {/* How its cards show on the board until unfolded or folded there: all of them (the default), or each lane's as a pack. */}
          <RowSwitch id={`stage-folded-${st.id}`} title="Its cards start folded into packs, a card on the rest" label="Folded"
            checked={!!st.folded} set={(on) => patch(`stages/${st.id}`, { folded: on ? 1 : 0 })} done={done} focus={st.id}
            said={(on) => (on ? `${st.name}'s cards start folded` : `${st.name}'s cards start unfolded`)} />
        </span>
      )}
      rowClass={(st) => (st.active === 0 ? "inactive" : "")}
      // A stage's sub stages (lanes), indented under it.
      sub={{
        noun: "sub stage",
        of: (st) => lanes.filter((l) => l.stage_id === st.id),
        // Default: where a process going into the stage goes; and Folded,
        // as its stage until said here.
        extra: (l, st, done) => {
          const before = lanes.find((x) => x.stage_id === st.id && x.is_default);
          const was = l.folded ?? null;
          return (
            <span className="stage-switches">
              <RowSwitch id={`lane-default-${l.id}`} title={`A card going into ${st.name} goes here, unless it's said where`} label="Default"
                checked={!!l.is_default} focus={`sub-${l.id}`}
                set={(on) => patch(`lanes/${l.id}`, { is_default: on ? 1 : 0 })}
                done={(msg, _undo, then) => done(msg, () => (before && before.id !== l.id ? patch(`lanes/${before.id}`, { is_default: 1 }) : patch(`lanes/${l.id}`, { is_default: l.is_default ? 1 : 0 })), then)}
                said={(on) => (on ? `${l.name} is ${st.name}'s default` : `${st.name} has no default sub stage`)} />
              <RowSwitch id={`lane-folded-${l.id}`} title={was == null ? `Its cards start as ${st.name}'s do, until set here` : "Its cards start folded into a pack, a card on the rest"} label="Folded"
                checked={was == null ? !!st.folded : !!was} focus={`sub-${l.id}`}
                set={(on) => patch(`lanes/${l.id}`, { folded: on ? 1 : 0 })}
                done={(msg, _undo, then) => done(msg, () => patch(`lanes/${l.id}`, { folded: was }), then)}
                said={(on) => (on ? `${l.name}'s cards start folded` : `${l.name}'s cards start unfolded`)} />
            </span>
          );
        },
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
      }}
      items={inGroup(w)}
      placeholder={w.name ? `New stage in ${w.name}, e.g. Take-home` : "New stage, e.g. Take-home"}
      rename={(st, name) => patch(`stages/${st.id}`, { name })}
      remove={(st) => deleteStage(st, stages, lanes)}
      reorder={(ids) => post("stages/order", { ids: order(w, ids) })}
      add={(name) => post("stages", w.id ? { name, swimlane_id: w.id } : { name })}
      drop={(st) => del(`stages/${st.id}`)} />
  );
  const intro = "The board's swimlanes, top to bottom, each with its stages, its columns, in order (a stage in none is in the first). A folded swimlane starts as its heading on the board, until opened there. A process in a terminal stage is closed, and its sub stage is the reason (Their Decision: They rejected me, Role filled …). Under a stage, its sub stages, top to bottom; cards in none stay at the column's top. A folded stage's cards start as packs, a card on the rest, until unfolded on the board.";
  return (
    <OrderedSettings list="board" title="Swimlanes and stages" intro={intro} noun="swimlane" focus={focus} redraw={again} scope="w"
      // Folded: it starts as its heading on the board.
      extra={(w, done) => (
        <RowSwitch id={`swimlane-folded-${w.id}`} title="It starts folded to its heading on the board" label="Folded"
          checked={!!w.folded} set={(on) => patch(`swimlanes/${w.id}`, { folded: on ? 1 : 0 })} done={done} focus={w.id}
          said={(on) => (on ? `${w.name} starts folded` : `${w.name} starts open`)} />
      )}
      rowClass={() => "swimlane-row"}
      nest={stageList}
      items={swimlanes}
      placeholder="New swimlane, e.g. On hold"
      rename={(w, name) => patch(`swimlanes/${w.id}`, { name })}
      // Undo: back in its place, with its stages.
      remove={async (w) => {
        const ids = swimlanes.map((x) => x.id);
        const its = stages.filter((st) => st.swimlane_id === w.id);
        await del(`swimlanes/${w.id}`);
        return async () => {
          const back = await post("swimlanes", { name: w.name, folded: w.folded });
          await post("swimlanes/order", { ids: ids.map((id) => (id === w.id ? back.id : id)) });
          for (const st of its) await patch(`stages/${st.id}`, { swimlane_id: back.id });
        };
      }}
      reorder={(ids) => post("swimlanes/order", { ids })}
      add={(name) => post("swimlanes", { name })}
      drop={(w) => del(`swimlanes/${w.id}`)}
      // No swimlanes: the stages on their own, before adding one.
      before={!swimlanes.length ? stageList(groups[0]) : null} />
  );
}

/**
 * Remove a stage: at once when empty, else asking where its processes go.
 * Gives back what puts it back (in its place, with its lanes, and its
 * processes where they were), or null when not removed.
 */
async function deleteStage(stage: Row, stages: Row[], lanes: Row[]) {
  const cards: Row[] = await get(`processes?stage_id=${stage.id}`);
  const its = lanes.filter((l) => l.stage_id === stage.id);
  if (cards.length) {
    const others = stages.filter((s) => s.id !== stage.id);
    if (!others.length) throw new Error("The board needs at least one stage.");
    const data = await ask({
      title: `Delete ${stage.name}`,
      body: <div className="fields"><p>{`${cards.length} ${cards.length === 1 ? "process is" : "processes are"} in ${stage.name}.`}</p>
        <Field><Label htmlFor="move-to">Move them to</Label><Select id="move-to" name="to">{others.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field></div>,
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
    const laneBack = new Map<number, number>();
    for (const l of its) laneBack.set(l.id, (await post("lanes", { stage_id: back.id, name: l.name, folded: l.folded ?? null, is_default: l.is_default || 0 })).id);
    await restoreProcesses(cards.map((p) => ({ ...p, stage_id: back.id, lane_id: laneBack.get(p.lane_id) ?? null })));
  };
}

// ---- tags ------------------------------------------------------------------------------

function TagsSettings() {
  useShared();
  const [loaded, setLoaded] = useState(false);
  const [focusNew, setFocusNew] = useState(false);
  const name = useRef<HTMLInputElement>(null);
  useEffect(() => { reloadTags().then(() => setLoaded(true)).catch(() => {}); }, []);
  useEffect(() => { if (focusNew) { name.current?.focus(); setFocusNew(false); } }, [focusNew]);
  if (!loaded) return null;
  const colourName = (c: string | null) => (c ? choiceLabel(S.META.tag_colors, c) : "Plain");
  const remove = async (t: Tag) => {
    if (!(await confirmDelete(`tag “${t.name}”`, "It comes off everything that has it."))) return;
    if (await attempt(() => del(`tags/${t.id}`))) { toast(`Deleted ${t.name}`); await reloadTags(); }
  };
  return (
    <SettingsPanel title="Tags" who="everyone" intro="Add them from any application, company, person or file, or here. Renaming a tag renames it everywhere.">
      {S.TAGS.length ? (
        <ul className="setting-list tag-rows">
          {/* A row: the tag, its name edited in place; its colour, which opens its colours; remove. */}
          {S.TAGS.map((t) => (
            <li key={t.id} data-id={t.id}>
              <span className="al-tag" data-tag={t.name.toLowerCase()} {...tagPaint(t.color)}><TagName t={t} /></span>
              <button className="tag-colour-name" type="button" aria-haspopup="true" aria-expanded="false" aria-label={`${colourName(t.color)}, colour of ${t.name}`}
                onClick={(e) => openTagColours(t, e.currentTarget)}><span>{colourName(t.color)}</span><Icon name="chevron" /></button>
              <RowActions what={t.name} remove={() => remove(t)} />
            </li>
          ))}
        </ul>
      ) : <p className="muted">No tags yet.</p>}
      <form className="inline-add" onSubmit={async (e) => {
        e.preventDefault();
        const v = name.current?.value || "";
        if (await attempt(() => post("tags", { name: v }))) { toast(`Added ${v}`); if (name.current) name.current.value = ""; await reloadTags(); setFocusNew(true); }
      }}>
        <Input ref={name} aria-label="New tag" placeholder="New tag, e.g. fintech" required />
        <button className="al-button al-button--primary" type="submit">Add tag</button>
      </form>
    </SettingsPanel>
  );
}

/** A tag's name, edited in place: saved when left, or on Enter; Escape puts it back. */
function TagName({ t }: { t: Tag }) {
  const [v, setV] = useState(t.name);
  const save = async () => {
    const next = v.trim();
    if (next && next !== t.name && (await attempt(() => patch(`tags/${t.id}`, { name: next })))) {
      toast("Renamed");
      await reloadTags();
      return;
    }
    setV(t.name);
  };
  return <input className="tag-name al-input" value={v} aria-label="Tag name" size={Math.max(v.length, 2)} spellCheck={false}
    onChange={(e) => setV(e.target.value)} onBlur={save}
    onKeyDown={(e) => {
      if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
      else if (e.key === "Escape") { setV(t.name); requestAnimationFrame(() => (e.target as HTMLInputElement).blur()); }
    }} />;
}
