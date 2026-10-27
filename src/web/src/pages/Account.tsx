// Several people sharing hunt (`hunt serve --tenants`): asking for an
// account, and the admin centre that decides.
//
// Someone signed in (through Cloudflare Access, with GitHub, LinkedIn …)
// without an account that may use hunt sees only the account screen: ask
// for one, or where their request stands. Admins get the admin centre
// (/admin): requests to approve or reject, and every account to manage.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { attempt, del, get, patch, post } from "../lib/api";
import { fmtDay, fmtStamp, nf, parseLocal, zonedNow } from "../lib/format";
import { CURRENCIES, applyChoices, builtInSignIn, isAdmin, myAccount, sitePage, tenancy } from "../lib/meta";
import { settle } from "../lib/router";
import { baseTitle, sectionNav } from "../lib/shell";
import { S, changed, useShared } from "../lib/state";
import { toast } from "../lib/toast";
import type { Row } from "../lib/types";
import { ask } from "../components/dialogs";
import { Facts, Field, Input, Label, LoadingBlock, Notice, SearchBox, Select, Table, TextArea } from "../components/ui";
import { ChoiceSetting, ContactLine, OrderedSettings, REGIONS, SettingRow, SettingsPanel, TIME_ZONES, TextSetting, currencyName } from "./Settings";
import { RecordsCard, ResourcesSection, Tile, fmtBytes, pct } from "./Stats";

/** What Cloudflare Access says about who's signed in: their name, and how. */
async function accessIdentity(): Promise<{ name?: string | null; provider?: string | null }> {
  try {
    const res = await fetch("/cdn-cgi/access/get-identity", { credentials: "same-origin" });
    if (!res.ok) return {};
    const id = await res.json();
    return { name: id.name || null, provider: id.idp?.type || null };
  } catch {
    return {};
  }
}

/**
 * The account screen, for someone signed in without an account that may
 * use hunt: ask for one, or see where the request stands.
 */
export function AccountScreen() {
  const t = tenancy();
  const status = t?.account?.status || (t?.signed_in ? "none" : "signed-out");
  useEffect(() => {
    document.body.classList.add("no-account");
    document.title = S.META.about?.name || `hunt · ${baseTitle()}`;
  }, []);
  const head = (title: string, lead?: string) => <><h1>{title}</h1>{lead ? <p className="account-lead">{lead}</p> : null}</>;
  const who = t?.email ? <p className="muted small">Signed in as <b translate="no">{t.email}</b>.</p> : null;
  let body: ReactNode;
  if (status === "signed-out" && t?.trying_out) {
    // Trying hunt out, without Cloudflare Access: say who you are.
    body = <BeSomeone head={head("Trying hunt out", "There's no sign-in here: say who you are, to be them in this browser.")} />;
  } else if (status === "signed-out") {
    body = <>{head("Sign in", "hunt is shared: sign in to use it.")}<p><a className="al-button al-button--primary" href="/">Sign in</a></p></>;
  } else if ((status === "none" || status === "rejected") && t?.signups_open === false) {
    body = <>{head("The list is closed for now", "We aren't adding anyone to the early access list just now. Try again later.")}{who}</>;
  } else if (status === "none") {
    body = <AskForAccount head={head("Join the early access list", "hunt is in early access: we're letting people in a few at a time, as it grows.")} who={who} />;
  } else if (status === "pending") {
    body = <>{head("You're on the list", "We're letting people in a few at a time. There's nothing more to do: come back any time to see if you're in.")}{who}
      <div className="actions"><button className="al-button" type="button" onClick={() => location.reload()}>Check again</button></div></>;
  } else if (status === "rejected") {
    body = <AskForAccount head={head("Join the early access list", "You weren't let in this time. You can join the list again, saying a bit more about what you're looking for.")} who={who} />;
  } else if (status === "disabled") {
    body = <>{head("Your account is disabled", "Ask an admin if you think it shouldn't be.")}{who}</>;
  }
  return <div className="page account-page">{body}<ContactLine /></div>;
}

function BeSomeone({ head }: { head: ReactNode }) {
  const email = useRef<HTMLInputElement>(null);
  useEffect(() => { email.current?.focus(); }, []);
  return <>{head}
    <form className="account-form" onSubmit={(e) => { e.preventDefault(); location.href = `/dev/as?email=${encodeURIComponent(email.current?.value || "")}`; }}>
      <Field><Label htmlFor="be-email">Email</Label><Input id="be-email" ref={email} type="email" required placeholder="you@example.com" /></Field>
      <div className="actions"><button className="al-button al-button--primary" type="submit">Be them</button></div>
    </form>
  </>;
}

function AskForAccount({ head, who }: { head: ReactNode; who: ReactNode }) {
  const t = tenancy();
  const [id, setId] = useState<{ name?: string | null; provider?: string | null } | null>(null);
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [agrees, setAgrees] = useState(false);
  const nameBox = useRef<HTMLInputElement>(null);
  useEffect(() => { accessIdentity().then((x) => { setId(x); setName(t?.account?.name || x.name || ""); }); }, []);
  useEffect(() => { if (id) nameBox.current?.focus(); }, [id]);
  if (!id) return null;
  return <>{head}{who}
    <form className="account-form" onSubmit={async (e) => {
      e.preventDefault();
      const done = await attempt(() => post("account/request", { name, reason, provider: id.provider, agrees }));
      if (done) location.reload();
    }}>
      <Field><Label htmlFor="ask-name">Name</Label><Input id="ask-name" ref={nameBox} value={name} placeholder="Your name" required onChange={(e) => setName(e.target.value)} /></Field>
      <Field><Label htmlFor="ask-reason">What brings you to hunt?</Label>
        <TextArea id="ask-reason" rows={3} placeholder="e.g. Looking for platform roles, recommended by a friend" value={reason} onChange={(e) => setReason(e.target.value)} />
        <p className="muted small">Optional: it helps us decide who to let in first.</p></Field>
      {/* A hunt run for others has terms of use, to agree to. */}
      {S.META.terms ? (
        <label className="check agree al-label al-choice" htmlFor="ask-agrees">
          <input id="ask-agrees" type="checkbox" required checked={agrees} onChange={(e) => setAgrees(e.target.checked)} />
          {" I agree to the "}<a href={sitePage("/terms/")} target="_blank">terms of use</a>{", and have read the "}<a href={sitePage("/privacy/")} target="_blank">privacy notice</a>.
        </label>
      ) : null}
      <div className="actions"><button className="al-button al-button--primary" type="submit">Join the list</button></div>
    </form>
  </>;
}

// ---- the admin centre ------------------------------------------------------------------

/** The admin centre's tabs: each one's key, name, what's in it, and its icon. */
const ALL_ADMIN_TABS: [string, string, string, string][] = [
  ["general", "General", "Name, notice, new accounts", "sliders"],
  ["lists", "Lists", "Work modes, interview steps, roles, kinds of file", "tag"],
  ["access", "Access and accounts", "Sign-ups, invites, accounts", "key"],
  ["users", "User stats", "How accounts use hunt", "users"],
  ["system", "System resources", "The machine, by account", "server"],
  ["debug", "Debugging info", "Version, sign-in, health, the API", "bug"],
];

/** The tabs, every hunt's. */
const adminTabs = () => ALL_ADMIN_TABS;

/** How many accounts a page of the admin's tables shows. */
const ADMIN_PAGE = 25;

interface Col { key: string; label: string; num?: boolean; value: (r: Row) => string | number; show?: (r: Row) => ReactNode }

/**
 * Accounts as a table to sort by any column (aria-sort, as the system's
 * tables do), find one in by its number, and go through a page at a time:
 * it grows with the accounts. A row chosen (click, or Enter) is the one
 * broken down: `onPick(id)`.
 */
function AccountsTable({ columns, rows, sort: first, label, chosen = null, onPick }: { columns: Col[]; rows: Row[]; sort: string; label: string; chosen?: number | null; onPick: (id: number) => void }) {
  const [state, setState] = useState({ sort: first, desc: true, page: 0 });
  const [find, setFind] = useState("");
  const [q, setQ] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const col = columns.find((c) => c.key === state.sort) || columns[0];
  const shown = rows.filter((r) => !q || String(r.id).startsWith(q)).sort((x, y) => {
    const a = col.value(x), b = col.value(y);
    const c = a < b ? -1 : a > b ? 1 : 0;
    return (state.desc ? -c : c) || x.id - y.id;
  });
  const pages = Math.max(1, Math.ceil(shown.length / ADMIN_PAGE));
  const page = Math.min(Math.max(0, state.page), pages - 1);
  const from = page * ADMIN_PAGE;
  const slice = shown.slice(from, from + ADMIN_PAGE);
  return (
    <div className="admin-accounts">
      <div className="list-tools">
        <SearchBox aria-label="Find an account by its number" placeholder="Account number, e.g. 12" value={find} onValue={(v) => {
          setFind(v);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => { setQ(v.replace(/[#\s]/g, "")); setState((s) => ({ ...s, page: 0 })); }, 150);
        }} />
        <span className="spacer" />
        <span className="muted small" aria-live="polite">{shown.length ? `${nf(from + 1)}–${nf(from + slice.length)} of ${nf(shown.length)}` : ""}</span>
        <button className="al-button al-button--sm" type="button" disabled={page === 0} onClick={() => setState({ ...state, page: page - 1 })}>Previous</button>
        <button className="al-button al-button--sm" type="button" disabled={page >= pages - 1} onClick={() => setState({ ...state, page: page + 1 })}>Next</button>
      </div>
      <div className="al-table-wrap" tabIndex={0} aria-label={label}>
        <Table className="al-table--interactive">
          <thead><tr>{columns.map((c) => (
            <th key={c.key} className={c.num ? "al-table__num" : undefined} aria-sort={c.key === state.sort ? (state.desc ? "descending" : "ascending") : undefined}>
              <button className="th-sort" type="button" onClick={() => setState(state.sort === c.key ? { ...state, desc: !state.desc, page: 0 } : { sort: c.key, desc: !!c.num, page: 0 })}>{c.label}</button>
            </th>
          ))}</tr></thead>
          <tbody>
            {slice.length ? slice.map((r) => (
              <tr key={r.id} tabIndex={0} aria-selected={String(r.id) === String(chosen) ? "true" : undefined}
                onClick={() => onPick(r.id)} onKeyDown={(e) => { if (e.key === "Enter") onPick(r.id); }}>
                {columns.map((c) => <td key={c.key} className={c.num ? "al-table__num" : undefined}>{c.show ? c.show(r) : c.value(r)}</td>)}
              </tr>
            )) : <tr><td className="muted" colSpan={columns.length}>No account with that number.</td></tr>}
          </tbody>
        </Table>
      </div>
      <p className="muted small">Choose an account to break its figures down.</p>
    </div>
  );
}

/** The account broken down (?account=), kept in the address so it can be linked to. */
function setAdminAccount(id: string | number) {
  const q = new URLSearchParams(location.search);
  if (id) q.set("account", String(id)); else q.delete("account");
  history.replaceState(null, "", `/admin?${q}`);
  settle();
}

/** Above the breakdown of one account: which, and the way back to them all. */
const BreakdownHead = ({ one, back }: { one: Row; back: () => void }) => (
  <div className="admin-breakdown-head"><h2 className="admin-sub">{`Account #${one.id}`}</h2>
    <button className="al-button al-button--quiet al-button--sm" type="button" onClick={back}>Every account</button></div>
);

export function AdminPage() {
  const tabs = adminTabs();
  const [tab] = useState(() => {
    const q = new URLSearchParams(location.search);
    // Info was a tab of its own: it's atop Debugging info now.
    const asked = q.get("tab") === "info" ? "debug" : q.get("tab");
    return tabs.some(([k]) => k === asked) ? asked! : "general";
  });
  const [data, setData] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((n) => n + 1);
  // Its sections are in the sidebar, in the app's place.
  useEffect(() => {
    sectionNav.set({ label: "Admin sections", base: "admin", tabs, tab });
    document.title = `Admin · ${baseTitle()}`;
    return () => sectionNav.set(null);
  }, [tab]);
  useEffect(() => { if (isAdmin()) get("admin/overview").then(setData).catch((e) => setError(e.message)); }, [version]);
  if (!isAdmin()) return <div className="page"><Notice kind="danger">Only admins can see this.</Notice></div>;
  return (
    <div className="page settings admin-page">
      <header className="al-page-head"><h1>Admin</h1><p className="al-page-head__lede">How this hunt is run, for everyone who uses it.</p></header>
      <div className="settings-content" role="region" aria-labelledby={`admin-tab-${tab}`}>
        {error ? <Notice kind="danger">{error}</Notice> : data ? (
          tab === "general" ? <AdminGeneral data={data} />
            : tab === "lists" ? <AdminLists data={data} />
            : tab === "access" ? <AdminAccess data={data} reload={reload} />
              : tab === "users" ? <AdminUsers />
                : tab === "system" ? <AdminSystem />
                  : <AdminDebug data={data} />
        ) : <LoadingBlock />}
      </div>
    </div>
  );
}

/** A hunt-wide setting changed: saved, said, with Undo putting back what it was. */
async function saveAdmin(change: Row, was: Row, then: (saved: Row) => void) {
  const saved = await attempt(() => patch("admin/settings", change));
  if (!saved) return false;
  then(saved);
  toast("Saved", "info", { label: "Undo", onclick: async () => {
    const back = await attempt(() => patch("admin/settings", was));
    if (back) { then(back); toast("Undone"); }
  } });
  return true;
}

/** Where each list shows, for its intro. */
const LIST_INTROS: Record<string, string> = {
  work_mode: "Where a role is done: on an application, and read from a posting.",
  employment: "The kind of contract: on an application, and read from a posting.",
  step_status: "Where an interview step stands: on the timeline, and how it went.",
  step_format: "How an interview step happens, offered as one is added. A step can still say something else.",
  step_length: "How long an interview step takes, in minutes, offered as one is added.",
  person_role: "What someone is to an application: its recruiter, hiring manager…",
  document_kind: "What a file is: a resume, a cover letter…",
};

/** A length as written, in minutes: `90`, `1.5 hours`, `2 hr`, `45 min`. */
function minutesIn(text: string): number | null {
  const t = text.trim().toLowerCase();
  const h = t.match(/^(\d+(?:[.,]\d+)?)\s*h/);
  if (h) return Math.round(Number(h[1].replace(",", ".")) * 60);
  const m = t.match(/^(\d+)\s*(m|min|mins|minutes)?$/);
  return m ? Number(m[1]) : null;
}

/**
 * Lists: the choices offered across hunt, for everyone, each edited as the
 * board's stages are (renamed in place, reordered, removed, added; Undo
 * puts it back). What hunt itself relies on can be renamed, not removed;
 * a list goes back to hunt's own with Reset.
 */
function AdminLists({ data }: { data: Row }) {
  const [lists, setLists] = useState<Row>(data.choices || {});
  const [focus, setFocus] = useState<Record<string, string | null>>({});
  const items = (key: string): Row[] => lists[key].choices.map((c: Row, i: number) => ({ id: i + 1, name: c.label, value: c.value }));
  const plain = (rows: Row[]) => rows.map((r) => ({ value: r.value ?? null, label: r.name ?? r.label }));
  /** Save a list (null: hunt's own), giving back what puts it back. */
  const save = async (key: string, rows: Row[] | null) => {
    const was = lists[key].changed ? plain(lists[key].choices) : null;
    const saved = await patch("admin/settings", { choices: { [key]: rows } });
    data.choices = saved.choices;
    setLists(saved.choices);
    S.META.choices = saved.choices;
    S.META.person_roles = saved.choices.person_role.choices;
    applyChoices();
    changed();
    return () => save(key, was);
  };
  return <>
    {Object.entries<Row>(lists).map(([key, list]) => {
      const rows = items(key);
      const redraw = (o: { focus?: string | number | null } = {}) => setFocus({ ...focus, [key]: o.focus == null ? null : String(o.focus) });
      return (
        <OrderedSettings key={key} list={`choices-${key}`} title={list.label} intro={LIST_INTROS[key]} items={rows} noun="choice"
          focus={focus[key] ?? null} redraw={redraw}
          placeholder={list.numeric ? "Minutes, e.g. 120 or 2 hours" : "A new choice"}
          rename={(it, name) => save(key, plain(rows.map((r) => (r.id === it.id ? { ...r, name } : r))))}
          reorder={(ids) => save(key, plain(ids.map((id) => rows.find((r) => r.id === id)!)))}
          remove={async (it) => save(key, plain(rows.filter((r) => r.id !== it.id)))}
          add={async (name) => {
            if (!list.numeric) return save(key, [...plain(rows), { value: null, label: name }]);
            const n = minutesIn(name);
            if (!n) throw new Error("Say how long, in minutes (e.g. 120) or hours (e.g. 2 hours)");
            const label = n % 60 === 0 && n >= 60 ? `${n / 60} hr` : `${n} min`;
            return save(key, [...plain(rows), { value: String(n), label }]);
          }}
          extra={(it) => (list.kept.includes(it.value)
            ? <span className="al-badge al-badge--outline" title="hunt relies on it: it can be renamed, not removed">Built in</span>
            : list.numeric ? <span className="muted small">{`${it.value} min`}</span> : null)}
          before={list.changed ? (
            <p className="small"><button className="al-button al-button--sm al-button--quiet" type="button" onClick={async () => {
              const undo = await attempt(() => save(key, null));
              if (undo) toast(`${list.label}: back to hunt's own`, "info", { label: "Undo", onclick: async () => { if (await attempt(undo)) toast("Undone"); } });
            }}>Reset to hunt's own</button></p>
          ) : null} />
      );
    })}
  </>;
}

/** General: what this hunt says of itself, and what new accounts start with. */
function AdminGeneral({ data }: { data: Row }) {
  useShared();
  const [defaults, setDefaults] = useState<Row>(data.defaults || {});
  const [undo, setUndo] = useState<number>(data.undo_seconds ?? 5);
  const about = S.META.about;
  const said = (saved: Row) => { S.META.about = saved.site; changed(); };
  const site = (key: string) => (v: string) => saveAdmin({ site: { [key]: v } }, { site: { [key]: about[key as keyof typeof about] || "" } }, said);
  const starts = (key: string) => (v: string) => saveAdmin({ defaults: { [key]: v } }, { defaults: { [key]: defaults[key] || "" } }, (saved) => setDefaults(saved.defaults));
  const pick = (id: string, key: string, options: [string, string][], none: string) => (
    <ChoiceSetting id={id} value={defaults[key] || ""} options={[["", none], ...options]} save={starts(key)} />
  );
  return <>
    <SettingsPanel title="About this hunt" intro="What everyone who opens this hunt sees of it. Each is saved as it's changed.">
      <SettingRow id="site-name" label="Name" hint="In the sidebar and the browser's tab, in place of hunt. Leave it empty for hunt's own.">
        <TextSetting id="site-name" value={about.name || ""} placeholder="hunt" maxLength={40} autoComplete="off" save={site("name")} />
      </SettingRow>
      <SettingRow id="site-announcement" label="Notice" hint="Above every page, for everyone, until they close it: for upkeep, or news. Leave it empty for none.">
        <TextSetting id="site-announcement" value={about.announcement || ""} placeholder="e.g. hunt is down for upkeep on Sunday, 22:00–23:00" maxLength={280} autoComplete="off" save={site("announcement")} />
      </SettingRow>
      {<SettingRow id="site-contact" label="Address for help" hint="Where people can write to the admins: on the account screen, and in Settings.">
        <TextSetting id="site-contact" type="email" value={about.contact || ""} placeholder="help@example.com" maxLength={254} autoComplete="off" save={site("contact")} />
      </SettingRow>}
    </SettingsPanel>
    <SettingsPanel title="Undo" intro="After a change that can be undone, a message says what changed, with Undo.">
      <SettingRow id="undo-seconds" label="Seconds to undo" hint="How long the message stays, for everyone: 5 unless changed, at most 60. 0 keeps it until it's used or closed.">
        <TextSetting id="undo-seconds" type="number" inputMode="numeric" min={0} max={60} step={1} value={String(undo)} autoComplete="off"
          save={async (v) => /^\d+$/.test(v) && Number(v) <= 60 ? saveAdmin({ undo_seconds: Number(v) }, { undo_seconds: undo }, (saved) => { S.META.undo_seconds = saved.undo_seconds; setUndo(saved.undo_seconds); changed(); }) : false} />
      </SettingRow>
    </SettingsPanel>
    {<SettingsPanel title="New accounts start with" intro="Each account can change these in its own Settings. Leave one as it is for hunt's own default.">
      <SettingRow id="def-language" label="Language">{pick("def-language", "language", S.META.languages.map((o) => [o.value, o.label]), "English (hunt's default)")}</SettingRow>
      <SettingRow id="def-region" label="Region">{pick("def-region", "region", REGIONS, "The browser's")}</SettingRow>
      <SettingRow id="def-timezone" label="Time zone">{pick("def-timezone", "timezone", TIME_ZONES.map((z) => [z, z.replaceAll("_", " ")]), "The machine's")}</SettingRow>
      <SettingRow id="def-currency" label="Currency">{pick("def-currency", "currency", CURRENCIES.map((c) => [c, currencyName(c)]), "GBP (hunt's default)")}</SettingRow>
    </SettingsPanel>}
  </>;
}

/** How people sign in to this hunt. */
const signIn = () => (S.META.access ? "Cloudflare Access, and hunt's own (an email address and a password)"
  : tenancy()?.trying_out ? "Who's asking, as the server is told (for trying it out)"
    : builtInSignIn() ? "hunt's own: an email address and a password, at /login"
      : "A sign-in proxy, and hunt's own (an email address and a password)");

/** What this hunt is, atop Debugging info: its version, how people sign in, who runs it, and its accounts. */
const AdminInfo = ({ data }: { data: Row }) => (
  <SettingsPanel title="This hunt">
    <Facts rows={[
      ["Version", `hunt ${S.META.version}`],
      ["Sign-in", signIn()],
      ...(S.META.operator ? [["Run by", <span translate="no">{S.META.operator}</span>] as [string, ReactNode]] : []),
      ["Accounts", `${nf(data.totals.active)} active, ${nf(data.totals.admins)} of them admins`],
    ]} />
  </SettingsPanel>
);

/** Access and accounts: sign-ups, invites, the early access list, every account. */
function AdminAccess({ data, reload }: { data: Row; reload: () => void }) {
  const [open, setOpen] = useState(!!data.signups_open);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [sending, setSending] = useState(false);
  const decide = async (a: Row, status: string, note: string | null = null) => {
    if (await attempt(() => post(`admin/accounts/${a.id}/decide`, { status, note }))) {
      toast(({ active: `Approved ${a.email}`, rejected: `Rejected ${a.email}`, disabled: `Disabled ${a.email}` } as Record<string, string>)[status] || "Done");
      reload();
    }
  };
  const when = (s: string | null) => (s ? fmtStamp(s) : <span className="muted">—</span>);
  const invited = (a: Row) => a.provider === "invite" && !a.last_seen;
  const badge = (a: Row) => (invited(a) ? <span className="al-badge al-badge--info">Invited</span>
    : <span className={`al-badge${a.status === "active" ? " al-badge--accent" : ""}`}>{({ active: "Active", pending: "Pending", rejected: "Rejected", disabled: "Disabled" } as Record<string, string>)[a.status] || a.status}</span>);
  const pending: Row[] = data.accounts.filter((a: Row) => a.status === "pending");
  const others: Row[] = data.accounts.filter((a: Row) => a.status !== "pending");
  return <>
    {/* Sign-ups: open, or closed (invites still work). */}
    <SettingsPanel title="Sign-ups">
      <label className="switch al-choice">
        <Input type="checkbox" role="switch" checked={open} onChange={async (e) => {
          const on = e.target.checked;
          setOpen(on);
          const done = await attempt(() => patch("admin/settings", { signups_open: on }));
          if (done) toast(on ? "Sign-ups open" : "Sign-ups closed"); else setOpen(!on);
        }} />New people can join the early access list
      </label>
      <p className="muted small">Closed, someone new sees that the list is closed for now; those already on it, those invited, and accounts already here are as they are.</p>
    </SettingsPanel>
    {/* Inviting someone: an account for them, open or closed. */}
    <SettingsPanel title="Invite someone" intro={builtInSignIn()
      ? "They sign up at /signup with this address, whether sign-ups are open or not, and can use hunt straight away."
      : "They can use hunt as soon as they sign in with this address, whether sign-ups are open or not."}>
      <form className="admin-invite" onSubmit={async (e) => {
        e.preventDefault();
        if (sending) return;
        setSending(true);
        const made = await attempt(() => post("admin/invites", { email, name: name || null }));
        setSending(false);
        if (!made) return;
        try { await navigator.clipboard.writeText(`${location.origin}/app`); } catch { /* the toast says where */ }
        toast(`Invited ${made.email}. The link to send them: ${location.origin}${builtInSignIn() ? "/signup" : "/"}`);
        reload();
      }}>
        <Field><Label htmlFor="invite-email">Email address</Label><Input id="invite-email" type="email" required autoComplete="off" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field><Label htmlFor="invite-name">Name</Label><Input id="invite-name" autoComplete="off" placeholder="Optional" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <button className="al-button al-button--primary" type="submit" aria-busy={sending ? "true" : undefined}>Invite</button>
      </form>
    </SettingsPanel>
    {/* Requests: who's asking, and why. */}
    <SettingsPanel title={`Early access list (${pending.length})`}>
      {pending.length ? (
        <div className="al-table-wrap"><Table>
          <thead><tr><th>Who</th><th>Signed in with</th><th>Why</th><th>Asked</th><th className="row-icons">Decide</th></tr></thead>
          <tbody>{pending.map((a) => (
            <tr key={a.id}>
              <td><b translate="no">{a.name || a.email}</b>{a.name ? <div className="muted small" translate="no">{a.email}</div> : null}</td>
              <td>{a.provider || <span className="muted">—</span>}</td>
              <td translate="no">{a.reason || <span className="muted">—</span>}</td>
              <td className="nowrap">{when(a.requested_at)}</td>
              <td className="row-icons">
                <button className="al-button al-button--sm al-button--primary" type="button" onClick={() => decide(a, "active")}>Approve</button>{" "}
                <button className="al-button al-button--sm al-button--quiet al-button--danger" type="button" onClick={async () => {
                  const d = await ask({ title: `Reject ${a.email}`,
                    body: <div className="fields"><Field><Label htmlFor="reject-note">Note</Label><Input id="reject-note" name="note" placeholder="e.g. Not taking new people yet" /></Field></div>,
                    ok: "Reject", danger: true });
                  if (d) decide(a, "rejected", (d.get("note") as string) || null);
                }}>Reject</button>
              </td>
            </tr>
          ))}</tbody>
        </Table></div>
      ) : <p className="muted">No one is waiting.</p>}
    </SettingsPanel>
    {/* Every account. */}
    <SettingsPanel title={`Accounts (${others.length})`}>
      <div className="al-table-wrap"><Table>
        <thead><tr><th>Who</th><th>Status</th><th>Role</th><th className="al-table__num">Applications</th><th>Last seen</th><th>CLI token</th><th className="row-icons">Actions</th></tr></thead>
        <tbody>{others.map((a) => {
          const me = a.id === myAccount()?.id;
          return (
            <tr key={a.id}>
              <td><b translate="no">{a.name || a.email}</b>{me ? <span className="muted small"> (you)</span> : null}
                {a.name ? <div className="muted small" translate="no">{a.email}</div> : null}
                {a.note ? <div className="muted small" translate="no">{a.note}</div> : null}</td>
              <td>{badge(a)}</td>
              <td><Select aria-label={`${a.email}'s role`} disabled={me} defaultValue={a.role} onChange={async (e) => {
                if (await attempt(() => patch(`admin/accounts/${a.id}`, { role: e.target.value }))) { toast("Role changed"); reload(); }
              }}><option value="user">User</option><option value="admin">Admin</option></Select></td>
              <td className="al-table__num">{nf(a.applications)}</td>
              <td className="nowrap">{invited(a) ? <span className="muted">Not signed in yet</span> : when(a.last_seen)}</td>
              <td><button className="al-button al-button--sm al-button--quiet" type="button" onClick={async () => {
                const d = await ask({ title: `CLI token for ${a.email}`,
                  body: <div className="fields"><p className="muted small">The Client ID of a Cloudflare Access service token: the CLI, sending it, acts as this account.</p>
                    <Field><Label htmlFor="cli-token">Client ID</Label><Input id="cli-token" name="token" defaultValue={a.service_token || ""} placeholder="xxxx.access" /></Field></div>,
                  ok: "Save" });
                if (d && await attempt(() => patch(`admin/accounts/${a.id}`, { service_token: d.get("token") || null }))) { toast("Saved"); reload(); }
              }}>{a.service_token ? "change" : "set"}</button></td>
              <td className="row-icons">{me ? null : <>
                {a.status === "active"
                  ? <button className="al-button al-button--sm" type="button" onClick={() => decide(a, "disabled")}>Disable</button>
                  : <button className="al-button al-button--sm" type="button" onClick={() => decide(a, "active")}>{a.status === "rejected" ? "Approve" : "Enable"}</button>}
                {" "}
                <button className="al-button al-button--sm al-button--quiet al-button--danger" type="button" onClick={async () => {
                  const d = await ask({ title: `Remove ${a.email}`,
                    body: <div className="fields"><p>They lose their account; they can ask for another.</p>
                      <label className="check al-choice"><input type="checkbox" name="data" />{" And everything of theirs: applications, people, files, notes …"}</label></div>,
                    ok: "Remove", danger: true });
                  if (!d) return;
                  const all = d.get("data") ? "1" : "";
                  if (await attempt(() => del(`admin/accounts/${a.id}?data=${all}`))) { toast(`Removed ${a.email}`); reload(); }
                }}>Remove…</button>
              </>}</td>
            </tr>
          );
        })}</tbody>
      </Table></div>
    </SettingsPanel>
  </>;
}

const DAY_MS = 864e5;
const daysAgo = (d: string | null) => (d ? Math.round((zonedNow().getTime() - parseLocal(d).getTime()) / DAY_MS) : null);

/** The accounts' usage, and the one broken down (?account=). */
function useUsage() {
  const [accounts, setAccounts] = useState<Row[] | null>(null);
  const [chosen, setChosen] = useState(() => new URLSearchParams(location.search).get("account") || "");
  const out = useRef<HTMLDivElement>(null);
  useEffect(() => { get("admin/usage").then((x) => setAccounts(x.accounts)).catch((e) => toast(e.message, "error")); }, []);
  const choose = (id: string | number) => { setAdminAccount(id); setChosen(String(id)); };
  return { accounts, chosen, choose, out, pick: (v: number) => { choose(v); out.current?.scrollIntoView({ block: "start" }); } };
}

/** User stats: how accounts use hunt, by number, never by name. */
function AdminUsers() {
  const { accounts, chosen, choose, out, pick } = useUsage();
  if (!accounts) return <LoadingBlock tall={4} />;
  const one = accounts.find((a) => String(a.id) === String(chosen));
  const sum = (k: string) => accounts.reduce((n, a) => n + (a[k] || 0), 0);
  const recent = accounts.filter((a) => a.last_seen && (daysAgo(a.last_seen) as number) <= 7).length;
  return <>
    <p className="muted small">Counts and dates only: no names, addresses or anything an account keeps.</p>
    <div className="admin-users" ref={out}>
      {one ? <BreakdownHead one={one} back={() => choose("")} /> : null}
      {one ? (
        <section className="viz-tiles admin-tiles" aria-label={`Account #${one.id}`}>
          <Tile label="Applications" value={nf(one.applications)} note={`${nf(one.active)} on the board, ${nf(one.closed)} closed`} />
          <Tile label="Cycles" value={nf(one.cycles)} note={`${nf(one.steps)} interview steps · ${nf(one.prep)} prep`} />
          <Tile label="Contacts" value={nf(one.companies + one.people)} note={`${nf(one.companies)} companies, ${nf(one.people)} people`} />
          <Tile label="Changes" value={nf(one.changes)} note={one.last_active ? `most recent: ${fmtDay(one.last_active)}` : "none yet"} />
          <Tile label="Files" value={nf(one.documents)} note={fmtBytes(one.file_bytes)} />
          <Tile label="Joined" value={one.joined ? fmtDay(one.joined) : "—"} note={one.last_seen ? `last seen ${fmtDay(one.last_seen)}` : "not seen yet"} />
        </section>
      ) : (
        <section className="viz-tiles admin-tiles" aria-label="Every account">
          <Tile label="Accounts" value={nf(accounts.filter((a) => a.status === "active").length)} note={`${nf(accounts.filter((a) => a.status === "pending").length)} waiting`} />
          <Tile label="Seen this week" value={nf(recent)} note={`of ${nf(accounts.length)}`} />
          <Tile label="Applications" value={nf(sum("applications"))} note={`${nf(sum("active"))} on boards`} />
          <Tile label="Interview steps" value={nf(sum("steps"))} note={`${nf(sum("prep"))} prep`} />
          <Tile label="Changes" value={nf(sum("changes"))} note="in all" />
        </section>
      )}
      <AccountsTable columns={[
        { key: "id", label: "Account", value: (a) => a.id, show: (a) => `#${a.id}` },
        { key: "status", label: "Status", value: (a) => a.status, show: (a) => ({ active: "Active", pending: "Pending", rejected: "Rejected", disabled: "Disabled" } as Record<string, string>)[a.status] || a.status },
        { key: "role", label: "Role", value: (a) => a.role, show: (a) => (a.role === "admin" ? "Admin" : "User") },
        { key: "joined", label: "Joined", value: (a) => a.joined || "", show: (a) => (a.joined ? fmtDay(a.joined) : "—") },
        { key: "last_seen", label: "Last seen", value: (a) => a.last_seen || "", show: (a) => (a.last_seen ? fmtDay(a.last_seen) : "—") },
        { key: "applications", label: "Applications", num: true, value: (a) => a.applications },
        { key: "active", label: "On the board", num: true, value: (a) => a.active },
        { key: "closed", label: "Closed", num: true, value: (a) => a.closed },
        { key: "cycles", label: "Cycles", num: true, value: (a) => a.cycles },
        { key: "steps", label: "Steps", num: true, value: (a) => a.steps },
        { key: "changes", label: "Changes", num: true, value: (a) => a.changes },
      ]} rows={accounts} sort="applications" label="Accounts" chosen={one?.id} onPick={pick} />
    </div>
  </>;
}

/** Debugging info: what this hunt is, then links worth having to hand, about it and around it. */
function AdminDebug({ data }: { data: Row }) {
  const here = location.origin;
  const link = (href: string, label: string, about: string) => (
    <li key={href}><a href={href} {...(href.startsWith("http") && !href.startsWith(here) ? { target: "_blank", rel: "noreferrer" } : {})}>{label}</a>
      <span className="muted small">{` — ${about}`}</span></li>
  );
  const group = (title: string, ...items: ReactNode[]) => <><h4>{title}</h4><ul className="plain links">{items}</ul></>;
  return <>
    <AdminInfo data={data} />
    <section className="al-panel panel settings-panel">
      {S.META.access
        ? group("Sign-in (Cloudflare Access)",
          link(`${here}/cdn-cgi/access/get-identity`, "Who you're signed in as", `the identity Access holds for you${S.META.access.email ? ` (${S.META.access.email})` : ""}`),
          link(`${here}/cdn-cgi/access/logout`, "Log out", "ends your Access session"),
          link("https://one.dash.cloudflare.com/", "Zero Trust dashboard", "Access applications, policies, service tokens and logs; the tunnel"))
        : <p className="muted small">This hunt isn't behind Cloudflare Access, so there's no sign-in to link to.</p>}
      {group("This hunt",
        link(`${here}/healthz`, "Health check", "“ok” when hunt and its database answer"),
        link(`${here}/api/calendar.ics`, "Calendar feed", "interviews and deadlines, to subscribe to in a calendar app"),
        link(`${here}/api/backup`, "Download a backup", "everything, as JSON (also in Settings → Data)"),
        link(`${here}/api/meta`, "API: resources and fields", "what the JSON API knows about"))}
      {group("Source and deployment",
        link("https://github.com/ArabesqueLabs/hunt", "Source code", "github.com/ArabesqueLabs/hunt"),
        link("https://github.com/ArabesqueLabs/hunt/actions/workflows/image.yml", "Image builds", "the workflow that tests and publishes the container image"),
        link("https://github.com/orgs/ArabesqueLabs/packages/container/package/hunt", "Container image", "ghcr.io/arabesquelabs/hunt and its tags"))}
    </section>
  </>;
}

/** System resources: the machine, what the database keeps, and what each account takes of it. */
function AdminSystem() {
  const { accounts, chosen, choose, out, pick } = useUsage();
  const machine = <><ResourcesSection /><div className="viz-grid"><RecordsCard /></div></>;
  if (!accounts) return machine;
  const all = accounts.reduce((n, a) => n + a.rows, 0);
  const one = accounts.find((a) => String(a.id) === String(chosen));
  return <>
    {machine}
    <div className="admin-users" ref={out}>
      {one ? <BreakdownHead one={one} back={() => choose("")} /> : <h2 className="admin-sub">By account</h2>}
      {one ? (
        <section className="viz-tiles admin-tiles" aria-label={`Account #${one.id}`}>
          <Tile label="Rows" value={nf(one.rows)} note={`${pct(one.rows, all)} of the database's`} />
          <Tile label="Files" value={fmtBytes(one.file_bytes)} note={`${nf(one.documents)} documents`} />
          <Tile label="Changes logged" value={nf(one.changes)} note="rows in the audit log" />
        </section>
      ) : null}
      <AccountsTable columns={[
        { key: "id", label: "Account", value: (a) => a.id, show: (a) => `#${a.id}` },
        { key: "rows", label: "Rows", num: true, value: (a) => a.rows, show: (a) => nf(a.rows) },
        { key: "share", label: "Share", num: true, value: (a) => a.rows, show: (a) => pct(a.rows, all) },
        { key: "file_bytes", label: "Files", num: true, value: (a) => a.file_bytes, show: (a) => fmtBytes(a.file_bytes) },
        { key: "changes", label: "Changes logged", num: true, value: (a) => a.changes, show: (a) => nf(a.changes) },
      ]} rows={accounts} sort="rows" label="Database, by account" chosen={one?.id} onPick={pick} />
    </div>
  </>;
}
