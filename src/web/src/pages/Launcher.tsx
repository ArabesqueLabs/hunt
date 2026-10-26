// A new hunt's launcher: on a database hunt has just made, before the
// board (GET /api/meta's `setup`), or on a hunt without an owner yet (just
// their account). First, whether to set it up afresh or restore a backup.
// Afresh: authentication (the owner's account: an email address and a
// password; they run the hunt), then your settings (how it writes dates and
// pay, how it looks). A backup brings its own settings, but never the
// owner: authentication, then the board. Nothing's skipped until there's an
// owner; everything can be changed later, in Settings. A new hunt has no job
// search (cycle) until one's started, on the board.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { attempt, patch, post, put } from "../lib/api";
import { CURRENCIES, myAccount, reloadMeta } from "../lib/meta";
import { go } from "../lib/router";
import { S, changed, useShared } from "../lib/state";
import { forget, forgetHere, store, storeHere, stored, storedHere } from "../lib/storage";
import { applyTheme, chooseTheme, currentTheme } from "../lib/theme";
import { toast } from "../lib/toast";
import { useFilePicker } from "../components/files";
import { Facts, Field, Icon, Input, Label, PasswordInput, Select } from "../components/ui";
import { importBackup, optionsOf, REGIONS, TIME_ZONES, currencyName } from "./Settings";

/** The steps, in order: each one's key, and its name for the progress dots. */
const ALL_STEPS: [string, string][] = [
  ["welcome", "Welcome"],
  ["password", "Authentication"],
  ["settings", "Your settings"],
];

/**
 * A backup restored, across the reload that draws the page in its language:
 * when (in this browser, and in this tab, which keeps it across its own
 * reload), let go of once it's read, so nothing of one hunt's launcher
 * carries over to another's. One from the last few minutes that isn't this
 * tab's is an earlier run's (another window, or a reload that never came):
 * carry on with it, or start afresh, as the person says.
 */
const RESTORED_KEY = "launcherRestored";
const RESTORE_WINDOW = 3 * 60_000;

/**
 * What earlier launchers kept in this browser (where they were, the way
 * chosen, what was saved): no run's now, so gone as the launcher opens.
 */
const STALE_KEYS = ["launcherStep", "launcherPath", "launcherRegion", "launcherCycle"];

/** A backup restored, a moment ago: by this tab, by another run, or none. */
function restoredBefore(): "here" | "earlier" | null {
  const when = stored(RESTORED_KEY);
  if (!when || Date.now() - (Number(when) || 0) >= RESTORE_WINDOW) return null;
  return storedHere(RESTORED_KEY) === when ? "here" : "earlier";
}

/** All the launcher kept in this browser and this tab: gone. */
function forgetLauncher() {
  for (const key of [RESTORED_KEY, ...STALE_KEYS]) forget(key);
  forgetHere(RESTORED_KEY);
}

/**
 * What this run of the launcher has chosen, so going back shows it. Nothing
 * else is taken as chosen: what an earlier run, or this browser, left (its
 * theme, the hunt's settings) gives way to this browser's guesses, and is
 * replaced by what's chosen now.
 */
const saved = { settings: false, theme: false };

/**
 * What's been chosen in this run, saved or not, so Back and on again keeps
 * it: the way (afresh, or a backup), the owner's address, the settings.
 * Never the password.
 */
const draft: { way?: "configure" | "restore"; email?: string; settings?: Settings } = {};

/** Nothing chosen in this run: a fresh start. */
function forgetRun() {
  saved.settings = false;
  saved.theme = false;
  for (const k of Object.keys(draft) as (keyof typeof draft)[]) delete draft[k];
}

type Settings = { locale: string; timezone: string; currency: string; week_start: string; clock: string; uk_resident: boolean };

/** The steps of the way chosen: a restored backup has its settings already. */
const stepsOf = (restored: boolean) => (restored ? ALL_STEPS.filter(([k]) => k !== "settings") : ALL_STEPS);

/** The owner, once made (in this run, or from HUNT_ADMIN_EMAIL): who's signed in, with a password. */
const owner = (): { email: string } | null => (myAccount()?.has_password ? myAccount() : null);

/** Done (or skipped): the board, from now on. */
async function finish(then?: () => void) {
  if (!(await attempt(() => post("setup/done")))) return;
  forgetRun();
  S.META.setup = false;
  S.META.setup_pending = false;
  document.body.classList.remove("launching");
  go("/", { replace: true });
  changed();
  then?.();
}

export function Launcher() {
  useShared();
  // A hunt from before owners, set up already: its owner's account, and nothing else.
  const ownerOnly = !S.META.setup_pending;
  // A backup restored a moment ago: this tab's (its reload), or an earlier
  // run's, to ask about (kept till they say). What older launchers kept: gone.
  const [before] = useState(() => {
    const found = ownerOnly ? null : restoredBefore();
    for (const key of STALE_KEYS) forget(key);
    if (found !== "earlier") forgetLauncher();
    return found;
  });
  const [restored, setRestored] = useState(before === "here");
  const [asking, setAsking] = useState(before === "earlier");
  const STEPS = ownerOnly ? ALL_STEPS.filter(([k]) => k === "password") : stepsOf(restored);
  // Restored: on to authentication. Else, the start.
  const [step, setStep] = useState(() => (restored && !ownerOnly ? 1 : 0));
  // A step with a form says how to go on; the rest just go.
  const onward = useRef<(() => Promise<boolean>) | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    document.body.classList.add("launching");
    document.title = "Set up hunt";
    // A new run: whatever theme was kept before (in this browser, or by an
    // earlier run) gives way to matching the system, until one's chosen here.
    if (!saved.theme) applyTheme("auto");
    return () => document.body.classList.remove("launching");
  }, []);
  const to = (n: number) => {
    onward.current = null;
    setStep(n);
    requestAnimationFrame(() => (document.querySelector(".launcher-step h1") as HTMLElement | null)?.focus());
  };
  /** The step's own going on, if it has one: true when it may. */
  const settle = async () => {
    if (!onward.current) return true;
    setBusy(true);
    const ok = await onward.current();
    setBusy(false);
    return ok;
  };
  const next = async () => { if (await settle()) to(step + 1); };
  const done = async () => { if (await settle()) finish(); };
  const ready = (fn: () => Promise<boolean>) => { onward.current = fn; };
  // Set up afresh: every step. Restored from a backup: on to authentication,
  // in the backup's language.
  const configure = () => setRestored(false);
  const restoredFrom = () => {
    const now = String(Date.now());
    store(RESTORED_KEY, now);
    storeHere(RESTORED_KEY, now);
    location.reload();
  };
  // An earlier run's backup: carried on (to authentication), or let go of,
  // with everything kept of it, for a fresh start.
  const carryOn = (yes: boolean) => {
    forgetLauncher();
    forgetRun();
    setAsking(false);
    setRestored(yes);
    to(yes ? 1 : 0);
  };
  if (asking) return <EarlierRun decide={carryOn} />;
  const last = step === STEPS.length - 1;
  const [key] = STEPS[step];
  return (
    <div className="launcher">
      <header className="launcher-head">
        <span className="launcher-brand"><img src="/logo.svg" alt="" width={32} height={32} /><span translate="no">hunt</span></span>
        {STEPS.length > 1 ? (
          <ol className="launcher-dots" aria-label="Setting up hunt">
            {STEPS.map(([k, name], i) => (
              <li key={k} className={i === step ? "now" : i < step ? "done" : ""} aria-current={i === step ? "step" : undefined}>
                <span className="al-visually-hidden">{name}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </header>
      <main className="launcher-step" key={key}>
        {key === "welcome" ? <Welcome ready={ready} configure={configure} restored={restoredFrom} chosen={restored ? "restore" : "configure"} /> : null}
        {key === "password" ? <AccountStep ready={ready} /> : null}
        {key === "settings" ? <SettingsStep ready={ready} /> : null}
      </main>
      <footer className="launcher-foot">
        {/* Without an owner, nothing's skipped: their account comes first. */}
        {step > 0
          ? <button className="al-button al-button--quiet" type="button" onClick={() => to(step - 1)}><Icon name="back" className="flip-rtl" /><span>Back</span></button>
          : owner() && !ownerOnly
            ? <button className="al-button al-button--quiet" type="button" onClick={() => finish()}>Set up later</button>
            : <span />}
        {STEPS.length > 1 ? <span className="muted small">{`Step ${step + 1} of ${STEPS.length}`}</span> : null}
        {last
          ? <button className="al-button al-button--primary" type="button" disabled={busy} onClick={done}><span>Finish setup</span><Icon name="forward" className="flip-rtl" /></button>
          : <button className="al-button al-button--primary" type="button" disabled={busy} onClick={next}><span>Continue</span><Icon name="forward" className="flip-rtl" /></button>}
      </footer>
    </div>
  );
}

/**
 * A backup restored a few minutes ago, by an earlier run of the launcher
 * (in another window, or one whose page didn't come back): carry on with
 * it, or start a fresh installation.
 */
function EarlierRun({ decide }: { decide: (carryOn: boolean) => void }) {
  const [carry, setCarry] = useState(true);
  return (
    <div className="launcher">
      <header className="launcher-head">
        <span className="launcher-brand"><img src="/logo.svg" alt="" width={32} height={32} /><span translate="no">hunt</span></span>
      </header>
      <main className="launcher-step">
        <Head title="Carry on setting up?" lead="A backup was restored here a few minutes ago, in another window or a page that didn't come back. Carry on from it, or start again." />
        <div className="launcher-choices" role="radiogroup" aria-label="Carry on setting up?">
          <ChoiceCard name="launch-earlier" checked={carry} onChoose={() => setCarry(true)} icon="forward"
            title="Continue setting up" text="On to your account, with the backup's applications, settings and files." />
          <ChoiceCard name="launch-earlier" checked={!carry} onChoose={() => setCarry(false)} icon="refresh"
            title="Start a fresh installation" text="From the first step, with nothing kept of that run. What the backup brought stays until another's restored." />
        </div>
      </main>
      <footer className="launcher-foot">
        <span />
        <button className="al-button al-button--primary" type="button" onClick={() => decide(carry)}><span>Continue</span><Icon name="forward" className="flip-rtl" /></button>
      </footer>
    </div>
  );
}

/** A step's heading, and what it's for. */
const Head = ({ title, lead }: { title: string; lead: ReactNode }) => (
  <><h1 tabIndex={-1}>{title}</h1><p className="launcher-lead">{lead}</p></>
);

/** One of a step's choices: a card with its radio, chosen or not. */
function ChoiceCard({ name, checked, onChoose, icon, title, text, disabled = false }: {
  name: string; checked: boolean; onChoose: () => void; icon?: string; title: string; text: string; disabled?: boolean;
}) {
  return (
    <label className={`al-card al-card--interactive launcher-choice${checked ? " al-card--selected" : ""}`}>
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onChoose} />
      {icon ? <Icon name={icon} /> : null}
      <span><b>{title}</b><span className="muted">{text}</span></span>
    </label>
  );
}

// ---- welcome: set up afresh, or restore a backup ------------------------------------------

function Welcome({ ready, configure, restored, chosen }: {
  ready: (fn: () => Promise<boolean>) => void; configure: () => void; restored: () => void; chosen: "configure" | "restore";
}) {
  const picker = useFilePicker("application/json,.json", async (f) => { if (await importBackup(f)) restored(); });
  const [way, setWayNow] = useState(draft.way || chosen);
  const setWay = (w: "configure" | "restore") => { draft.way = w; setWayNow(w); };
  // Continue: on to every step; or, to restore, the backup to choose (at
  // once, as a click must open the file picker).
  ready(() => {
    if (way === "restore") { picker.open(); return Promise.resolve(false); }
    configure();
    return Promise.resolve(true);
  });
  return (
    <>
      <Head title="Welcome to hunt" lead="Your job search, as a board of hiring processes. A few choices first, then you're on your board: each one can be changed later, in Settings." />
      <div className="launcher-choices launcher-ways" role="radiogroup" aria-label="How to set up hunt">
        <ChoiceCard name="launch-way" checked={way === "configure"} onChoose={() => setWay("configure")} icon="sliders"
          title="Configure your hunt" text="Your account, your region and currency, and how it looks." />
        <ChoiceCard name="launch-way" checked={way === "restore"} onChoose={() => setWay("restore")} icon="download"
          title="Restore from a backup" text="From another hunt: its applications, settings and files. Then your account, which backups never hold." />
      </div>
      {picker.input}
    </>
  );
}

// ---- the owner's account ----------------------------------------------------------------

/**
 * Authentication: the hunt's owner, who signs in and runs it (its admin).
 * There's no going on without them. Made already (from HUNT_ADMIN_EMAIL,
 * or back here after Continue), they're shown to change: the address, and
 * a new password, or none to keep theirs.
 */
function AccountStep({ ready }: { ready: (fn: () => Promise<boolean>) => void }) {
  const me = owner();
  const [email, setEmailNow] = useState(draft.email ?? me?.email ?? "");
  const setEmail = (e: string) => { draft.email = e; setEmailNow(e); };
  const [pass, setPass] = useState("");
  const [again, setAgain] = useState("");
  // What's wrong, and with which field.
  const [wrong, setWrong] = useState<{ text: string; field: "email" | "password" | "again" } | null>(null);
  const first = useRef<HTMLInputElement>(null);
  // Made already (in this run, or from HUNT_ADMIN_EMAIL): shown, to edit if wanted.
  const [editing, setEditing] = useState(!me || draft.email !== undefined);
  ready(async () => {
    setWrong(null);
    if (me && !editing) return true;
    const sameEmail = !!me && email.trim().toLowerCase() === me.email.toLowerCase();
    if (me && sameEmail && !pass && !again) return true;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setWrong({ text: "Give an email address, like you@example.com.", field: "email" }); first.current?.focus(); return false; }
    if ((!me || pass || again) && pass.length < 8) { setWrong({ text: "Give the password 8 characters or more.", field: "password" }); return false; }
    if (pass !== again) { setWrong({ text: "The two passwords don't match.", field: "again" }); return false; }
    const change = { ...(sameEmail ? {} : { email: email.trim() }), ...(pass ? { password: pass } : {}) };
    // The first account (the owner, an admin), or theirs changed.
    const made = await attempt(() => (me ? put("account/credentials", change) : put("owner", change)));
    if (!made) return false;
    // Signed in as them now: who that is, from the service.
    await reloadMeta();
    // Saved: shown as it is from now on, until edited again.
    delete draft.email;
    toast(me ? "Account changed" : "Account made");
    return true;
  });
  const invalid = (f: "email" | "password" | "again") => (wrong?.field === f ? "true" : undefined);
  return (
    <>
      <Head title="Authentication" lead="Your account, as this hunt's owner and admin. hunt asks for it at /login, and remembers each browser for 30 days." />
      {me && !editing ? (
        <div className="launcher-account">
          <Facts rows={[["Email", <span translate="no">{me.email}</span>]]} />
          <div className="actions">
            <button className="al-button" type="button" onClick={() => { setEditing(true); requestAnimationFrame(() => first.current?.focus()); }}>
              <Icon name="edit" /><span>Edit</span></button>
          </div>
        </div>
      ) : <div className="launcher-form">
        <Field><Label htmlFor="launch-email">Email</Label>
          <Input id="launch-email" ref={first} type="email" autoComplete="username" value={email} autoFocus aria-invalid={invalid("email")}
            onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field><Label htmlFor="launch-password">{me ? "New password" : "Password"}</Label>
          <PasswordInput id="launch-password" autoComplete="new-password" minLength={8} value={pass}
            aria-describedby="launch-password-hint" aria-invalid={invalid("password")} onChange={(e) => setPass(e.target.value)} />
          <span className="al-hint" id="launch-password-hint">{me ? "Leave it empty to keep yours." : "8 characters or more. A few words make a good one."}</span></Field>
        <Field><Label htmlFor="launch-again">The same again</Label>
          <PasswordInput id="launch-again" autoComplete="new-password" value={again} aria-invalid={invalid("again")}
            onChange={(e) => setAgain(e.target.value)} /></Field>
        {wrong ? <p className="al-error" role="alert">{wrong.text}</p> : null}
      </div>}
    </>
  );
}

// ---- region, time and currency --------------------------------------------------------------

/** The currency a region's country uses, for a first guess. */
const COUNTRY_CURRENCY: Record<string, string> = {
  GB: "GBP", US: "USD", IE: "EUR", DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", PT: "EUR", BE: "EUR", AT: "EUR", FI: "EUR",
  CA: "CAD", AU: "AUD", NZ: "NZD", CH: "CHF", SE: "SEK", NO: "NOK", DK: "DKK", PL: "PLN", CZ: "CZK", HU: "HUF",
  JP: "JPY", CN: "CNY", HK: "HKD", SG: "SGD", IN: "INR", KR: "KRW", ZA: "ZAR", BR: "BRL", MX: "MXN", IL: "ILS", TR: "TRY",
};

/** What this browser suggests: its region, time zone, currency and first day of the week. */
function guesses() {
  const lang = navigator.language || "en-GB";
  const country = lang.split("-")[1]?.toUpperCase() || "";
  let zone = "";
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { /* none */ }
  let week = "monday";
  try {
    const info = (new Intl.Locale(lang) as unknown as { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } });
    if ((info.getWeekInfo?.() || info.weekInfo)?.firstDay === 7) week = "sunday";
  } catch { /* the usual */ }
  // In the UK: the browser says so, or its clock's on UK time (a UK
  // browser is often en-US). The Channel Islands and the Isle of Man have
  // zones (and taxes) of their own.
  const uk = country === "GB" || ["Europe/London", "Europe/Belfast"].includes(zone);
  const currency = COUNTRY_CURRENCY[country] || (uk ? "GBP" : "");
  return {
    locale: REGIONS.some(([v]) => v === lang) ? lang : "",
    timezone: TIME_ZONES.includes(zone) ? zone : "",
    currency: CURRENCIES.includes(currency) ? currency : "",
    week_start: week,
    uk_resident: uk,
  };
}

/** Your settings: region and currency (saved on Continue), and how it looks (at once). */
function SettingsStep({ ready }: { ready: (fn: () => Promise<boolean>) => void }) {
  const P = S.PREFS;
  const [g] = useState(guesses);
  // Chosen in this run (back here): those. Else, this browser's guesses.
  const [v, setVNow] = useState<Settings>(draft.settings || (saved.settings ? {
    locale: P.locale || "",
    timezone: P.timezone || "",
    currency: P.currency,
    week_start: P.week_start,
    clock: P.clock || "12",
    uk_resident: !!P.uk_resident,
  } : {
    locale: g.locale,
    timezone: g.timezone,
    currency: g.currency || "GBP",
    week_start: g.week_start,
    // 12-hour times, unless changed later in Settings.
    clock: "12",
    uk_resident: g.uk_resident,
  }));
  const setV = (next: Settings) => { draft.settings = next; setVNow(next); };
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) =>
    setV({ ...v, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });
  ready(async () => {
    const saved = await attempt(() => patch("settings", v));
    if (!saved) return false;
    S.PREFS = saved;
    saved.settings = true;
    changed();
    return true;
  });
  const select = (id: string, label: string, hint: string, k: keyof typeof v, options: [string, string][]) => (
    <Field>
      <Label htmlFor={id}>{label}</Label>
      <Select id={id} value={String(v[k])} onChange={set(k)}>{options.map(([o, l]) => <option key={o} value={o}>{l}</option>)}</Select>
      <span className="al-hint">{hint}</span>
    </Field>
  );
  return (
    <>
      <Head title="Your settings" lead="How hunt writes dates and times, what “today” is, the currency it shows pay in, and how it looks. Filled in from this browser: check them." />
      <h2 className="launcher-sub">Region and currency</h2>
      <div className="launcher-grid">
        {select("launch-region", "Region", "Dates, numbers, and the names of days and months.", "locale",
          [["", `The browser's (${navigator.language})`], ...REGIONS])}
        {select("launch-zone", "Time zone", "Interview times are in it.", "timezone",
          [["", `The machine's (${P.server_timezone})`], ...TIME_ZONES.map((z): [string, string] => [z, z.replaceAll("_", " ")])])}
        {select("launch-currency", "Currency", "Pay in other currencies is converted to it, at the day's rate.", "currency",
          CURRENCIES.map((c): [string, string] => [c, currencyName(c)]))}
        {select("launch-week", "Weeks start on", "In the calendar.", "week_start", optionsOf(S.META.week_starts))}
      </div>
      <h2 className="launcher-sub">Appearance</h2>
      <Themes />
      <label className="switch al-label al-choice launcher-uk" htmlFor="launch-uk">
        <Input type="checkbox" role="switch" id="launch-uk" checked={v.uk_resident} onChange={set("uk_resident")} />
        I live in the UK (a UK resident, for tax)
      </label>
      <p className="muted small">With it on, hunt works out what you'd take home from a salary or a contractor's rate, after UK tax.</p>
    </>
  );
}

// ---- how it looks (in your settings) ------------------------------------------------------

const THEMES: [string, string, string][] = [
  ["light", "Light", "Dark words on a light page."],
  ["dark", "Dark", "Light words on a dark page."],
  ["auto", "Match the system", "Light or dark, as your device is."],
];

/** The theme, shown at once: the same on every device hunt's opened on. */
function Themes() {
  useShared();
  const now = saved.theme ? currentTheme() : "auto";
  return (
    <>
      <div className="launcher-choices launcher-themes" role="radiogroup" aria-label="Theme">
        {THEMES.map(([value, label, hint]) => (
          // Small: the name, and what it means on pointing at it.
          <label key={value} className={`al-card al-card--interactive launcher-choice launcher-theme${now === value ? " al-card--selected" : ""}`} data-preview={value} title={hint}>
            <input type="radio" name="launch-theme" checked={now === value} aria-description={hint} onChange={() => { saved.theme = true; chooseTheme(value); }} />
            <span className="launcher-swatch" aria-hidden="true"><i /><i /><i /></span>
            <b>{label}</b>
          </label>
        ))}
      </div>
    </>
  );
}
