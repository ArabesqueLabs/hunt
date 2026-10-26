// The Settings page (/settings): one person's settings, kept with their
// account, its sections in the sidebar. Most are changed where they are,
// each saved as it's changed, with Undo; a few panels read first, and their
// Edit opens them for changes.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { api, attempt, del, get, patch, post, put } from "../lib/api";
import { LOC, fmtDay, fmtStamp, fmtTime, HOME, homeK, zonedNow } from "../lib/format";
import { LANG, setLanguage } from "../lib/i18n";
import { CURRENCIES, choiceLabel, myAccount, reloadMeta, reloadTags, sitePage, takeHomeOn, tenancy } from "../lib/meta";
import { settle } from "../lib/router";
import { sectionNav } from "../lib/shell";
import { S, changed, useShared } from "../lib/state";
import { store, stored } from "../lib/storage";
import { tagPaint } from "../lib/tags";
import { chooseTheme, currentTheme } from "../lib/theme";
import { toast } from "../lib/toast";
import type { Row, Tag } from "../lib/types";
import { ask, confirmDelete } from "../components/dialogs";
import { useFilePicker } from "../components/files";
import { profileBookmarklet } from "../components/importer";
import { openTagColours } from "../components/tags";
import { Facts, Field, Icon, Input, Label, LoadingBlock, STAGE_ICONS, Select } from "../components/ui";
import { MenuButton, MenuItem } from "../components/Menu";
import { GMAIL, GmailSettings } from "./Mail";
import { takeHomeNumber } from "./TakeHome";

/** A section: its title, and Edit (or Done) beside it when it's edited as a whole. */
export function SettingsPanel({ title, editing = false, onToggle, intro, done = "Done", className, list, children }: {
  title?: string; editing?: boolean; onToggle?: (on: boolean) => void; intro?: ReactNode; done?: string; className?: string; list?: string; children?: ReactNode;
}) {
  return (
    <section className={`al-panel panel settings-panel${editing ? " editing" : ""}${className ? ` ${className}` : ""}`} data-list={list}>
      <div className="panel-head">{title ? <h2>{title}</h2> : <span />}
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
    account: () => (myAccount() ? <><AccountSettings />{myAccount().has_password ? <SignInDetails /> : null}</> : <SignInSettings />),
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
  <SettingsPanel title="Audit log" intro="Every change you've made, newest first: what, when and to what.">
    <a className="al-link al-link--arrow" href="/activity">Open the audit log</a>
  </SettingsPanel>
);

/** Where to write to this hunt's admins, when they've said. */
export function ContactLine() {
  const to = S.META.about?.contact;
  return to ? <p className="muted small contact-line"><span>Questions, or something not right? Write to</span>{" "}<a href={`mailto:${to}`} translate="no">{to}</a></p> : null;
}

/** Signed in through Cloudflare Access, with no account here: who, and signing out. */
const SignInSettings = () => (
  <SettingsPanel title="Your account">
    <Facts rows={[["Signed in as", <span translate="no">{S.META.access?.email || "—"}</span>], ["Sign-in", "Cloudflare Access"]]} />
    <div className="actions"><a className="al-button" href="/cdn-cgi/access/logout">Sign out</a></div>
    <ContactLine />
  </SettingsPanel>
);

// ---- your sign-in (hunt's own) -----------------------------------------------------------

/**
 * Signing in with hunt's own sign-in: your email address and password,
 * each changed here, with your password now. A new password ends your
 * other sessions.
 */
function SignInDetails() {
  const me = myAccount();
  const change = async (what: "email" | "password") => {
    const d = await ask({
      title: what === "email" ? "Change your email address" : "Change your password",
      ok: "Change it",
      body: <div className="fields">
        {what === "email"
          ? <Field><Label htmlFor="own-email">New email address</Label>
            <Input id="own-email" name="email" type="email" autoComplete="username" required defaultValue={me?.email} /></Field>
          : <>
            <Field><Label htmlFor="own-new">New password</Label>
              <Input id="own-new" name="password" type="password" autoComplete="new-password" minLength={8} required />
              <span className="al-hint">8 characters or more. A few words make a good one.</span></Field>
            <Field><Label htmlFor="own-again">The same again</Label>
              <Input id="own-again" name="again" type="password" autoComplete="new-password" minLength={8} required /></Field>
          </>}
        <Field><Label htmlFor="own-current">Your password now</Label>
          <Input id="own-current" name="current" type="password" autoComplete="current-password" required /></Field>
      </div>,
    });
    if (!d) return;
    if (what === "password" && d.get("password") !== d.get("again")) { toast("The two new passwords don't match", "error"); return; }
    const change = what === "email" ? { email: d.get("email") } : { password: d.get("password") };
    if (await attempt(() => put("account/credentials", { ...change, current: d.get("current") }))) {
      await reloadMeta();
      toast(what === "email" ? "Email address changed" : "Password changed: you're signed out everywhere else");
    }
  };
  return (
    <SettingsPanel title="Signing in" intro="With your email address and password, at /login.">
      <div className="actions">
        <button className="al-button" type="button" onClick={() => change("email")}>Change email address…</button>
        <button className="al-button" type="button" onClick={() => change("password")}>Change password…</button>
        <a className="al-button al-button--quiet" href="/logout">Log out</a>
      </div>
      {me?.role === "admin" ? <p className="muted small">Forgotten an admin's password? Start hunt with HUNT_ADMIN_EMAIL and HUNT_ADMIN_PASSWORD set: it replaces it.</p> : null}
    </SettingsPanel>
  );
}

// ---- your account (a shared hunt) ---------------------------------------------------------

function AccountSettings() {
  const me = myAccount();
  return (
    <SettingsPanel title="Your account">
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
          location.href = tenancy()?.trying_out ? "/" : me.has_password ? "/logout" : "/cdn-cgi/access/logout";
        }
      }}>Delete my account…</button></div>
      <ContactLine />
    </SettingsPanel>
  );
}

// ---- settings changed where they are ---------------------------------------------------

/**
 * Change some of your settings, saved at once: said, with Undo putting
 * back what they were. False when it didn't save.
 */
export async function saveSettings(change: Row, message = "Saved") {
  const was = Object.fromEntries(Object.keys(change).map((k) => [k, S.PREFS[k] ?? null]));
  const saved = await attempt(() => patch("settings", change));
  if (!saved) return false;
  S.PREFS = saved;
  changed();
  toast(message, "info", { label: "Undo", onclick: async () => {
    const back = await attempt(() => patch("settings", was));
    if (back) { S.PREFS = back; changed(); toast("Undone"); }
  } });
  return true;
}

/** Another language, or other digits: saved, and everything drawn again in them. */
export async function relanguage(change: Row) {
  const saved = await attempt(() => patch("settings", change));
  if (!saved) return false;
  S.PREFS = saved;
  setLanguage(saved.language, saved.numerals);
  location.reload();
  return true;
}

/** A setting: its name and what it's for, and beside them what changes it, saved as it's changed. */
export const SettingRow = ({ id, label, hint, children }: { id?: string; label: string; hint?: ReactNode; children: ReactNode }) => (
  <div className="settings-row">
    <div className="settings-row-label">
      {id ? <Label htmlFor={id}>{label}</Label> : <span className="al-label">{label}</span>}
      {hint ? <span className="al-hint">{hint}</span> : null}
    </div>
    <div className="settings-row-control">{children}</div>
  </div>
);

/** A select saved as it's changed: the choice shown at once, and put back if it can't be saved. */
export function ChoiceSetting({ value, options, save, ...rest }: { value: string; options: [string, string][]; save: (v: string) => Promise<boolean> }
  & Omit<React.ComponentProps<"select">, "value" | "onChange">) {
  const [now, setNow] = useState(value);
  useEffect(() => setNow(value), [value]);
  return (
    <Select value={now} {...rest} onChange={async (e) => {
      const v = e.target.value;
      setNow(v);
      if (!(await save(v))) setNow(value);
    }}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
  );
}

/**
 * A field saved when it's left, or on Enter; Escape puts it back. What
 * can't be saved stays, marked, to put right.
 */
export function TextSetting({ value, save, ...rest }: { value: string; save: (v: string) => Promise<boolean> }
  & Omit<React.ComponentProps<"input">, "value" | "onChange">) {
  const [now, setNow] = useState(value);
  const [wrong, setWrong] = useState(false);
  useEffect(() => { setNow(value); setWrong(false); }, [value]);
  const commit = async () => {
    if (now.trim() === value.trim()) { setNow(value); setWrong(false); return; }
    setWrong(!(await save(now.trim())));
  };
  return (
    <Input value={now} aria-invalid={wrong ? "true" : undefined} {...rest} onChange={(e) => setNow(e.target.value)} onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === "Escape") { setNow(value); setWrong(false); const el = e.currentTarget; requestAnimationFrame(() => el.blur()); }
      }} />
  );
}

/** A switch saved as it's changed. */
const SwitchSetting = ({ id, checked, label, save }: { id: string; checked: boolean; label: string; save: (on: boolean) => Promise<boolean> }) => (
  <label className="switch al-label al-choice" htmlFor={id}>
    <Input type="checkbox" role="switch" id={id} checked={checked} onChange={(e) => save(e.target.checked)} />{label}
  </label>
);

// ---- appearance -----------------------------------------------------------------------

const THEMES: [string, string][] = [["light", "Light"], ["dark", "Dark"], ["auto", "Match the system"]];

function ThemeSettings() {
  const now = currentTheme();
  return (
    <SettingsPanel title="Appearance">
      <SettingRow label="Theme" hint="The same on every device you sign in on.">
        <div className="al-segmented" role="group" aria-label="Theme">
          {THEMES.map(([v, l]) => (
            <button key={v} type="button" aria-pressed={String(now === v) as "true" | "false"}
              onClick={async () => { if (v !== now && (await chooseTheme(v))) toast("Theme changed"); }}>{l}</button>
          ))}
        </div>
      </SettingRow>
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

/** A choice list's {value, label}s, as a select's options. */
export const optionsOf = (choices: Row[]): [string, string][] => choices.map((o) => [o.value, o.label]);

function LocaleSettings() {
  const P = S.PREFS;
  const region = (code: string | null) => (code ? REGIONS.find(([v]) => v === code)?.[1] || code
    : LANG !== "en" ? `The language's (${LANG})` : `The browser's (${navigator.language})`);
  const sample = `${zonedNow().toLocaleDateString(LOC(), { weekday: "short", day: "numeric", month: "short", year: "numeric" })}, ${fmtTime("14:30")} · ${homeK(150000)} a year`;
  return (
    <SettingsPanel title="Language and region"
      intro="How hunt speaks, how dates, times and numbers are written, and the currency pay is compared in. Your time zone is in Calendar.">
      <SettingRow id="set-language" label="Language" hint="The words, and which way the page reads.">
        <ChoiceSetting id="set-language" options={optionsOf(S.META.languages)} value={P.language || "en"} save={(v) => relanguage({ language: v })} />
      </SettingRow>
      <SettingRow id="set-region" label="Region" hint="Dates, numbers, and the names of days and months.">
        <ChoiceSetting id="set-region" options={[["", region(null)], ...REGIONS]} value={P.locale || ""} save={(v) => saveSettings({ locale: v })} />
      </SettingRow>
      <SettingRow id="set-numerals" label="Numbers" hint="Which digits numbers are written in.">
        <ChoiceSetting id="set-numerals" options={optionsOf(S.META.numerals)} value={P.numerals || "auto"} save={(v) => relanguage({ numerals: v })} />
      </SettingRow>
      <SettingRow id="set-clock" label="Times">
        <ChoiceSetting id="set-clock" options={optionsOf(S.META.clocks)} value={P.clock} save={(v) => saveSettings({ clock: v })} />
      </SettingRow>
      <SettingRow id="set-currency" label="Currency" hint={<>
        <span>Pay is shown in it, converted at today's rate where a posting gives another.</span>
        {P.currency !== "GBP" && P.currency_rate
          ? <>{" "}<span>{`Pay is converted through GBP: 1 ${P.currency} = ${P.currency_rate.toFixed(4)} GBP, the rate on ${fmtDay(P.currency_rate_on)}.`}</span></> : null}
      </>}>
        <ChoiceSetting id="set-currency" options={CURRENCIES.map((c) => [c, currencyName(c)])} value={P.currency} save={(v) => saveSettings({ currency: v })} />
      </SettingRow>
      <SettingRow label="Looks like"><span aria-live="polite">{sample}</span></SettingRow>
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

/** Every time zone, as a select's options. */
export const zoneOptions = (): [string, string][] => TIME_ZONES.map((z) => [z, z.replaceAll("_", " ")]);

/**
 * The calendar: your time zone (hunt's, and the one interview times are
 * in), the week's first day, working hours (shaded outside in the day and
 * week), and other time zones shown beside its hours.
 */
function CalendarSettings() {
  const P = S.PREFS;
  return (
    <SettingsPanel title="Time and hours"
      intro="Your time zone and working hours, and other time zones to see beside yours in the calendar's day and week.">
      <SettingRow id="set-timezone" label="Time zone" hint="What “today” and “now” are, for hunt and its calendar feed; interview times are in it.">
        <ChoiceSetting id="set-timezone" options={[["", `The machine's (${P.server_timezone})`], ...zoneOptions()]} value={P.timezone || ""}
          save={(v) => saveSettings({ timezone: v })} />
      </SettingRow>
      <SettingRow id="set-week" label="Weeks start on">
        <ChoiceSetting id="set-week" options={optionsOf(S.META.week_starts)} value={P.week_start} save={(v) => saveSettings({ week_start: v })} />
      </SettingRow>
      <SettingRow label="Working hours" hint="The hours outside them are shaded in the calendar's day and week."><WorkHours /></SettingRow>
      <SettingRow label="Other time zones" hint={`Their hours beside yours in the day and week, to see when an interview elsewhere falls; up to ${S.META.max_calendar_zones}.`}>
        <OtherZones />
      </SettingRow>
    </SettingsPanel>
  );
}

const WORK_HOURS = { start: "09:00", end: "17:30", days: ["monday", "tuesday", "wednesday", "thursday", "friday"] };

/** Working hours: on or off; from, to, and on which days; each saved as it's changed. */
function WorkHours() {
  const work = S.PREFS.work_hours;
  // Off and on again: the hours they were.
  const last = useRef(work || WORK_HOURS);
  if (work) last.current = work;
  const [start, setStart] = useState(last.current.start);
  const [end, setEnd] = useState(last.current.end);
  useEffect(() => { setStart(last.current.start); setEnd(last.current.end); }, [work?.start, work?.end]);
  const hours = (o: Row) => saveSettings({ work_hours: { ...last.current, ...o } });
  // A time, saved once it's left: put back if it can't be.
  const time = (key: "start" | "end", value: string, set: (v: string) => void) => async () => {
    if (value === work?.[key]) return;
    if (!value || !(await hours({ [key]: value }))) set(work?.[key] || "");
  };
  return <>
    <SwitchSetting id="set-work-on" checked={!!work} label={work ? "On" : "Off"} save={(on) => saveSettings({ work_hours: on ? last.current : null }, on ? "Working hours on" : "Working hours off")} />
    {work ? (
      <div className="work-hours">
        <div className="work-times">
          <Field><Label htmlFor="set-work-start">From</Label>
            <Input type="time" id="set-work-start" value={start} step={900} onChange={(e) => setStart(e.target.value)} onBlur={time("start", start, setStart)} /></Field>
          <Field><Label htmlFor="set-work-end">To</Label>
            <Input type="time" id="set-work-end" value={end} step={900} onChange={(e) => setEnd(e.target.value)} onBlur={time("end", end, setEnd)} /></Field>
        </div>
        <fieldset className="work-days"><legend>On</legend>
          {S.META.weekdays.map((d: Row) => {
            const on = work.days.includes(d.value);
            // At least one day: the last can't be taken off.
            const only = on && work.days.length === 1;
            return (
              <label key={d.value} className="check al-choice" title={only ? "Working hours need at least one day" : undefined}>
                <input type="checkbox" value={d.value} checked={on} disabled={only}
                  onChange={(e) => hours({ days: S.META.weekdays.map((x: Row) => x.value).filter((x: string) => (x === d.value ? e.target.checked : work.days.includes(x))) })} />{d.label}
              </label>
            );
          })}
        </fieldset>
      </div>
    ) : null}
  </>;
}

/** Zones a new one starts as, the first not already shown. */
const LIKELY_ZONES = ["Europe/London", "America/New_York", "Asia/Tokyo", "America/Los_Angeles", "Asia/Dubai", "Australia/Sydney"];

/** Other time zones: a select each, saved as it's changed, added and removed. */
function OtherZones() {
  const others: string[] = S.PREFS.calendar_zones;
  const box = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);
  useEffect(() => {
    if (focusLast.current) { box.current?.querySelector<HTMLElement>(".other-zone:last-of-type select")?.focus(); focusLast.current = false; }
  }, [others.length]);
  const set = (next: string[], message?: string) => saveSettings({ calendar_zones: next }, message);
  const options = zoneOptions();
  return (
    <div className="other-zones" ref={box}>
      {others.map((z, i) => (
        <div key={`${i}-${z}`} className="other-zone">
          <ChoiceSetting id={`set-zone-${i}`} aria-label={`Other time zone ${i + 1}`} value={z} options={options} save={(v) => set(others.map((x, j) => (j === i ? v : x)))} />
          <button className="al-button al-button--sm al-button--quiet al-button--danger" type="button" aria-label={`Remove ${zoneName(z)}`}
            onClick={() => set(others.filter((_, j) => j !== i), `Removed ${zoneName(z)}`)}>remove</button>
        </div>
      ))}
      {others.length < S.META.max_calendar_zones ? <AddLink label="Add a time zone" onClick={() => {
        const pick = [...LIKELY_ZONES, ...TIME_ZONES].find((z) => !others.includes(z) && z !== S.PREFS.timezone) || "UTC";
        focusLast.current = true;
        set([...others, pick], `Added ${zoneName(pick)}`);
      }} /> : null}
    </div>
  );
}

// ---- location ---------------------------------------------------------------------------

/** Where you live: a UK resident has take-home pay (where it's on), for their part of the UK. */
function LocationSettings() {
  const P = S.PREFS;
  return (
    <SettingsPanel title="Where you live" intro="For working out tax on your pay.">
      <SettingRow label="UK resident" hint={P.uk_resident
        ? "Take-home pay is on, and on applications that give their pay."
        : "Take-home pay works out UK tax, so it's for those who live in the UK: what you'd keep of a salary or a contractor's rate, and of applications' pay."}>
        <SwitchSetting id="set-uk" checked={!!P.uk_resident} label="I live in the UK (a UK resident, for tax)"
          save={(on) => saveSettings({ uk_resident: on }, on ? "Take-home pay is on" : "Take-home pay is off")} />
      </SettingRow>
      {P.uk_resident ? (
        <SettingRow id="set-uk-region" label="Part of the UK" hint="Scotland has its own income tax bands.">
          <ChoiceSetting id="set-uk-region" options={optionsOf(S.META.uk_regions)} value={P.uk_region} save={(v) => saveSettings({ uk_region: v })} />
        </SettingRow>
      ) : null}
    </SettingsPanel>
  );
}

// ---- desired take-home pay ---------------------------------------------------------------

/** The take-home pay you want, in your currency: Take-home pay sets its figures against it. */
function DesiredSettings() {
  const P = S.PREFS;
  const want = P.desired_take_home;
  return (
    <SettingsPanel title="What you want to take home"
      intro="Take-home pay, and every application's pay, compare with this. Take-home pay starts from it when you work back from what you want.">
      <SettingRow id="set-desired" label="Desired net take-home pay" hint={<><span>After tax, in</span>{" "}{currencyName(HOME())}{". "}<span>Leave it empty for none.</span></>}>
        <TextSetting id="set-desired" inputMode="decimal" autoComplete="off" placeholder="e.g. 4,000" value={want == null ? "" : String(want)} save={(v) => {
          const n = takeHomeNumber(v);
          if (Number.isNaN(n)) { toast("That isn't a number hunt can read: try 4000 or 4k.", "error"); return Promise.resolve(false); }
          return saveSettings({ desired_take_home: n });
        }} />
      </SettingRow>
      <SettingRow id="set-desired-per" label="Pay period">
        <ChoiceSetting id="set-desired-per" options={[["week", "Weekly"], ["month", "Monthly"], ["year", "Annually"]]} value={P.desired_take_home_per || "month"}
          save={(v) => saveSettings({ desired_take_home_per: v })} />
      </SettingRow>
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
  if (!prefs) return <LoadingBlock />;
  const origin = prefs.bookmarklet_url || location.origin;
  const href = profileBookmarklet(origin);
  return (
    <SettingsPanel title="LinkedIn bookmark" editing={editing} onToggle={setEditing} done="Cancel" className="linkedin"
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

/**
 * Import a backup file, replacing everything here: checked first, and what
 * it holds said, before asking. True once it's in.
 */
export async function importBackup(f: File, say: (status: string) => void = () => {}) {
  // Check it's a backup, and say what's in it, before anything is replaced.
  let backup: Row;
  try { backup = JSON.parse(await f.text()); } catch { toast(`${f.name} isn't a hunt backup`, "error"); return false; }
  if (!backup || backup.hunt_backup == null || !backup.tables) { toast(`${f.name} isn't a hunt backup`, "error"); return false; }
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
  if (!ok) return false;
  say("Importing…");
  const res = await fetch("/api/backup?confirm=replace", { method: "POST", headers: { "Content-Type": "application/json" }, body: f });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { say(""); toast(data.error || "The import didn't work", "error"); return false; }
  say(`Imported ${f.name}.`);
  toast("Backup imported");
  await reloadMeta();
  return true;
}

/** Settings: save everything to a file, or bring a saved one back. */
function BackupSettings() {
  const [status, setStatus] = useState("");
  const picker = useFilePicker("application/json,.json", (f) => importBackup(f, setStatus));
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

type Done = (message: string, undo: (() => Promise<unknown>) | null, then?: { focus?: string | number | null }) => void;
type Redraw = (o?: { focus?: string | number | null }) => void;

interface SubSpec {
  noun: string;
  of: (it: Row) => Row[];
  extra?: (x: Row, it: Row, done: Done) => ReactNode;
  rename: (x: Row, name: string) => Promise<unknown>;
  remove: (x: Row, it: Row) => Promise<(() => Promise<unknown>) | null>;
  reorder: (it: Row, ids: number[]) => Promise<unknown>;
  add: (it: Row, name: string) => Promise<Row>;
}

interface OrderedProps {
  list: string; title?: string; intro?: string; items: Row[]; noun: string; focus: string | null; redraw: Redraw;
  rename: (it: Row, name: string) => Promise<unknown>;
  remove: (it: Row) => Promise<(() => Promise<unknown>) | null>;
  reorder: (ids: number[]) => Promise<unknown>;
  add: (name: string) => Promise<Row>;
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
 * and gives back what puts it back, or null if nothing was removed.
 * Adding one is said, without Undo.
 */
function OrderedSettings({ list, title, intro, items, noun, focus, redraw, rename, remove, reorder, add, placeholder, sub = null, extra = null, rowClass = null, nest = null, scope = "", bare = false, before = null }: OrderedProps) {
  const listEl = useRef<HTMLOListElement>(null);
  const nameBox = useRef<HTMLInputElement>(null);
  const [dragOrder, setDragOrder] = useState<number[] | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  // What's focused after drawing, as this list names it (`scope` keeps a
  // nested list's apart from its row's): a row's id, or new, new-ID, sub-ID.
  const at = (f: string | number | null | undefined) => (f == null ? null : `${scope}${f}`);
  // Done: drawn again, and said, with Undo (unless it was an addition),
  // which draws it again once undone.
  const done: Done = (message, undo, then = {}) => {
    const t = { ...then, focus: at(then.focus) };
    redraw(t);
    toast(message, "info", undo && { label: "Undo", onclick: async () => {
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
        if (added) { if (nameBox.current) nameBox.current.value = ""; done(`Added ${v}`, null, { focus: "new" }); }
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
  return <SettingsPanel title={title} intro={intro} list={list}>{children}</SettingsPanel>;
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
        if (added) done(`Added ${name} to ${it.name}`, null, { focus: `new-${it.id}` });
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

/** A stage icon's name in words. */
const iconLabel = (name: string) => STAGE_ICONS.find(([n]) => n === name)?.[1] || name;

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
  if (!data) return <LoadingBlock lines={8} />;
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
  // Its icon, on an application's timeline: one of the set, or none.
  const iconPick = (st: Row, done: Done) => {
    const set = (icon: string | null) => patch(`stages/${st.id}`, { icon });
    const choose = async (icon: string | null) => {
      const was = st.icon ?? null;
      if (icon === was || !(await attempt(() => set(icon)))) return;
      st.icon = icon;
      done(icon ? `${st.name}'s icon is ${iconLabel(icon)}` : `${st.name} has no icon`, () => set(was), { focus: st.id });
    };
    return (
      <MenuButton className="al-button al-button--sm stage-icon" label={`${st.name}'s icon`} title="Its icon, on an application's timeline"
        items={(close) => <>
          <MenuItem close={close} checked={!st.icon} onClick={() => choose(null)}>No icon</MenuItem>
          <hr className="al-menu__separator" />
          {STAGE_ICONS.map(([name, label]) => (
            <MenuItem key={name} close={close} checked={st.icon === name} onClick={() => choose(name)}><Icon name={name} /><span>{label}</span></MenuItem>
          ))}
        </>}>{st.icon ? <Icon name={st.icon} /> : <span className="muted">Icon</span>}<Icon name="chevron" /></MenuButton>
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
          {iconPick(st, done)}
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
      }}
      items={inGroup(w)}
      placeholder={w.name ? `New stage in ${w.name}, e.g. Take-home` : "New stage, e.g. Take-home"}
      rename={(st, name) => patch(`stages/${st.id}`, { name })}
      remove={(st) => deleteStage(st, stages, lanes)}
      reorder={(ids) => post("stages/order", { ids: order(w, ids) })}
      add={(name) => post("stages", w.id ? { name, swimlane_id: w.id } : { name })} />
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
    const back = await post("stages", { name: stage.name, active: stage.active, folded: stage.folded, swimlane_id: stage.swimlane_id, icon: stage.icon ?? null });
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
    <SettingsPanel title="Tags" intro="Add them from any application, company, person or file, or here. Renaming a tag renames it everywhere.">
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
