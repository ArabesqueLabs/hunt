// Email: the Inbox (mail waiting for a process) and Settings → Gmail.
//
// Gmail sign-in and sync (the Inbox, Settings → Gmail, a process's label and
// search) are switched off for now: emails come in as .eml files or pasted.
// Set GMAIL to bring them back; the service still has it all.

import { useEffect, useState, type ReactNode } from "react";
import { api, attempt, del, get, post } from "../lib/api";
import { fmtStamp } from "../lib/format";
import { S, changed } from "../lib/state";
import { toast } from "../lib/toast";
import type { Row } from "../lib/types";
import { Combo } from "../components/Combo";
import { confirmDelete } from "../components/dialogs";
import { refSource } from "../components/fields";
import { useFilePicker } from "../components/files";
import { EmptyState, Facts, Field, Input, Label, LoadingPage, Logo, Select } from "../components/ui";

export const GMAIL = false;

/** The Gmail connection and how much waits in triage; shown by Inbox in the sidebar. */
export async function updateInboxCount() {
  try { S.MAIL = await get("mail"); changed(); } catch { /* not connected */ }
}

const whoSent = (e: Row) => (e.outgoing ? "You" : e.from_name || e.from_addr || "Unknown sender");
const MATCHED: Record<string, string> = {
  label: "by its Gmail label", thread: "by its thread", person: "by a person on the process",
  company: "by the company's domain", "hiring tool": "a hiring tool's mail naming the company",
  search: "by the process's search", mention: "it mentions the company", you: "by you", file: "added by you",
};

/** An email: who, when, subject and the start of it; opens to the whole text. */
function EmailItem({ e, actions, children }: { e: Row; actions?: ReactNode; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState<Row | null>(null);
  return (
    <li className={`email${e.outgoing ? " outgoing" : ""}`}>
      <button className="email-toggle" type="button" aria-expanded={String(open) as "true" | "false"} onClick={async () => {
        setOpen(!open);
        if (!open && !full) { const f = await attempt(() => get(`emails/${e.id}`)); if (f) setFull(f); }
      }}>
        <span className="email-line"><b className="email-who">{whoSent(e)}</b>
          <time className="muted" dateTime={e.sent_at} title={e.sent_at.replace("T", " ")}>{fmtStamp(e.sent_at)}</time></span>
        <span className="email-subject">{e.subject || "(no subject)"}</span>
        {e.snippet ? <span className="email-snippet muted">{e.snippet}</span> : null}
      </button>
      <div className="email-actions">
        {GMAIL && e.matched_by ? <span className="muted small" title="How it was matched">{MATCHED[e.matched_by] || e.matched_by}</span> : null}
        <span className="spacer" />
        {e.gmail_url ? <a className="small-button button" href={e.gmail_url} target="_blank" rel="noreferrer">Open in Gmail ↗</a> : null}
        {actions}
      </div>
      <div className="email-body" hidden={!open}>
        {full ? <>
          <p className="muted small">{`From ${full.from_name ? `${full.from_name} <${full.from_addr}>` : full.from_addr}`}{full.to_addrs ? ` · to ${full.to_addrs}` : ""}{full.cc_addrs ? ` · cc ${full.cc_addrs}` : ""}</p>
          <div className="email-text">{full.body || "(no text)"}</div>
        </> : "Loading…"}
      </div>
      {children}
    </li>
  );
}

/** Mail waiting for a process: link it, or ignore it (and its sender). */
export function InboxPage() {
  const [waiting, setWaiting] = useState<Row[] | null>(null);
  const [syncing, setSyncing] = useState(false);
  const load = async () => {
    await updateInboxCount();
    setWaiting(S.MAIL?.connected ? await get("emails?status=triage") : []);
  };
  useEffect(() => { load().catch((e) => toast(e.message, "error")); }, []);
  const MAIL = S.MAIL;
  const done = (id: number, msg: string) => { toast(msg); updateInboxCount(); setWaiting((w) => (w || []).filter((x) => x.id !== id)); };
  if (waiting == null) return <LoadingPage kind="table" />;
  return (
    <div className="page inbox">
      <div className="al-page-head page-head"><h1>Inbox</h1>
        <p className="muted inbox-status">{MAIL?.connected ? (MAIL.last_sync
          ? <>{`Last synced ${fmtStamp(MAIL.last_sync)}`}{MAIL.last_error ? <span className="bad">{` — failed: ${MAIL.last_error}`}</span> : ""}</>
          : "Not synced yet.") : null}</p>
        {MAIL?.connected ? <button className="al-button al-button--primary" type="button" aria-busy={syncing ? "true" : undefined} onClick={async () => {
          if (syncing) return;
          setSyncing(true);
          const r = await attempt(() => post("mail/sync", {}));
          setSyncing(false);
          if (r) toast(`${r.fetched} fetched: ${r.linked} linked, ${r.triage} to sort`);
          load();
        }}>{syncing ? "Syncing…" : "Sync now"}</button> : null}
      </div>
      {!MAIL?.connected ? (
        <section className="al-panel panel"><h2>Bring in email about your applications</h2>
          <p>Connect Gmail in <a href="/settings">Settings</a>. hunt then finds mail about each process: from its people, the company's domains, hiring tools naming the company, and threads already linked. Mail that could be about more than one process waits here for you.</p>
          <p className="muted">Without Gmail, drop .eml files on a process.</p></section>
      ) : !waiting.length ? <EmptyState title="Nothing to sort" text="Mail hunt is sure about goes straight to its process." /> : <>
        <p className="muted">These could be about more than one process, or only mention a company. Linking one brings the rest of its thread with it.</p>
        <ol className="email-list triage">
          {waiting.map((e) => {
            const link = async (pid: number, name: string) => { if (await attempt(() => post(`emails/${e.id}/link`, { process_id: pid }))) done(e.id, `Linked to ${name}`); };
            const domain = (e.from_addr || "").split("@")[1];
            const ignore = (rule: string | null) => async () => {
              const r = await attempt(() => post(`emails/${e.id}/ignore`, rule ? { rule } : {}));
              if (r) done(e.id, rule ? `Ignored ${r.ignored} from ${rule === "sender" ? e.from_addr : domain}, from now on` : "Ignored");
            };
            return (
              <EmailItem key={e.id} e={e} actions={<>
                <button className="al-button al-button--sm" type="button" onClick={ignore(null)}>Ignore</button>
                {e.from_addr ? <button className="al-button al-button--sm" type="button" title={`Ignore everything from ${e.from_addr}`} onClick={ignore("sender")}>Ignore sender</button> : null}
                {domain ? <button className="al-button al-button--sm" type="button" title={`Ignore everything from @${domain}`} onClick={ignore("domain")}>{`Ignore @${domain}`}</button> : null}
              </>}>
                <div className="suggest">
                  {(e.suggested || []).map((p: Row) => (
                    <button key={p.id} className="al-button" type="button" onClick={() => link(p.id, `${p.company} — ${p.title || ""}`)}>
                      <Logo id={p.company_id} logo={p.company_logo} name={p.company} size={16} />{`${p.company}${p.title ? ` — ${p.title}` : ""}`}
                      {p.status === "archived" ? <span className="muted"> (archived)</span> : null}
                    </button>
                  ))}
                  <Combo label="Another process" placeholder="Another process…" source={refSource("processes")} onPick={(it) => link(it.value, it.label)} />
                </div>
              </EmailItem>
            );
          })}
        </ol>
      </>}
    </div>
  );
}

/**
 * Signing in with Google: give hunt your OAuth client's JSON, register the
 * address Google returns to, then sign in.
 */
function GoogleSignin({ rerender }: { rerender: () => void }) {
  const MAIL = S.MAIL!;
  const redirect = `${location.origin}/api/mail/google/callback`;
  const [busy, setBusy] = useState(false);
  const picker = useFilePicker("application/json,.json", async (f) => {
    const res = await fetch("/api/mail/google/client", { method: "PUT", headers: { "Content-Type": "application/json" }, body: f });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast(data.error || "hunt couldn't read that file", "error"); return; }
    toast("Google client saved");
    rerender();
  });
  const copy = (text: string) => <button className="al-button al-button--sm al-button--quiet" type="button" onClick={() => navigator.clipboard?.writeText(text).then(() => toast("Copied"))}>Copy</button>;
  if (!MAIL.google_client) {
    return (
      <div className="google-signin">
        <h3>Sign in with Google (recommended)</h3>
        <p>hunt then reads mail and manages its labels through the Gmail API, and can't send, change or delete anything. It needs an OAuth client of your own, from Google Cloud:</p>
        <ol className="steps-help">
          <li>In <a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noreferrer">Google Cloud ↗</a>, turn on the Gmail API for your project.</li>
          <li>Under <a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noreferrer">Clients ↗</a>, make a Web application client, with this authorised redirect URI: <code>{redirect}</code> {copy(redirect)}</li>
          <li>Under <a href="https://console.cloud.google.com/auth/scopes" target="_blank" rel="noreferrer">Data access ↗</a>, add the scopes gmail.readonly and gmail.labels; under <a href="https://console.cloud.google.com/auth/audience" target="_blank" rel="noreferrer">Audience ↗</a>, add yourself as a test user, or publish the app so sign-ins don't expire after a week.</li>
          <li>Download the client's JSON file, and give it to hunt: {picker.input}
            <button className="al-button al-button--sm" type="button" onClick={picker.open}>Choose the JSON file…</button></li>
        </ol>
      </div>
    );
  }
  return (
    <div className="google-signin">
      <h3>Sign in with Google</h3>
      <p>hunt will read mail and manage its labels, nothing more.</p>
      <div className="actions">
        <button className="al-button al-button--primary" type="button" aria-busy={busy ? "true" : undefined} onClick={async () => {
          if (busy) return;
          setBusy(true);
          const start = await attempt(() => get("mail/google/start"));
          if (start) location.href = start.url;
          else setBusy(false);
        }}>Sign in with Google</button>
      </div>
      <p className="muted small">Client <code>{MAIL.google_client}</code>. Its authorised redirect URIs need <code>{redirect}</code> {copy(redirect)}.{" "}
        <button className="al-button al-button--sm al-button--quiet" type="button" onClick={async () => { if (await attempt(() => del("mail/google/client"))) rerender(); }}>Use another client</button></p>
    </div>
  );
}

/** Settings: the Gmail account, how often it syncs, and ignored senders. */
export function GmailSettings() {
  const [version, setVersion] = useState(0);
  const [ignores, setIgnores] = useState<Row[] | null>(null);
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const rerender = () => setVersion((n) => n + 1);
  useEffect(() => {
    updateInboxCount().then(async () => {
      setAddress(S.MAIL?.address || "");
      setIgnores(S.MAIL?.connected ? await get("mail/ignores") : []);
    });
  }, [version]);
  const MAIL = S.MAIL;
  if (!MAIL || ignores == null) return <section className="al-panel panel settings-panel gmail"><div className="panel-head"><h2>Gmail</h2></div></section>;
  if (!MAIL.connected) {
    return (
      <section className="al-panel panel settings-panel gmail">
        <div className="panel-head"><h2>Gmail</h2></div>
        <GoogleSignin rerender={rerender} />
        <details className="al-disclosure more" open={!MAIL.google_client}><summary>Or use an app password</summary>
          <p>hunt reads mail over IMAP with an app password. It works without a Google Cloud project, but an app password can also send and delete mail.</p>
          <ol className="steps-help">
            <li>Turn on <a href="https://myaccount.google.com/signinoptions/twosv" target="_blank" rel="noreferrer">2-Step Verification ↗</a> for your Google account, if it isn't.</li>
            <li>Make an <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">app password ↗</a> named “hunt”.</li>
            <li>Enter it here. It's kept in hunt's database on this computer{MAIL.password_from_env ? "; here it comes from HUNT_GMAIL_APP_PASSWORD." : " (or set HUNT_GMAIL_APP_PASSWORD when starting hunt instead)."}</li>
          </ol>
          <form className="fields gmail-connect" onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy("connect");
            const ok = await attempt(() => api("PUT", "mail", { address, password: password || null }));
            setBusy(null);
            if (ok) { toast("Gmail connected"); rerender(); }
          }}>
            <Field><Label htmlFor="gmail-address">Gmail address</Label><Input type="email" id="gmail-address" autoComplete="username" placeholder="you@gmail.com" required value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
            {MAIL.password_from_env ? null : <Field><Label htmlFor="gmail-password">App password</Label><Input type="password" id="gmail-password" autoComplete="off" placeholder="abcd efgh ijkl mnop" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>}
            <div className="actions"><button className="al-button al-button--primary" type="submit" aria-busy={busy ? "true" : undefined}>{busy ? "Signing in…" : "Connect"}</button></div>
          </form>
        </details>
      </section>
    );
  }
  const r = MAIL.last_report;
  return (
    <section className="al-panel panel settings-panel gmail">
      <div className="panel-head"><h2>Gmail</h2></div>
      <Facts rows={[
        ["Account", <>{MAIL.address}<span className="muted">{MAIL.auth === "google" ? " · signed in with Google (read and labels only)" : " · app password"}</span></>],
        ["Last sync", MAIL.last_sync
          ? <>{fmtStamp(MAIL.last_sync)}{MAIL.last_error ? <span className="bad">{` — failed: ${MAIL.last_error}`}</span> : r ? <span className="muted">{` — ${r.fetched} fetched, ${r.linked} linked, ${r.triage} to sort`}</span> : ""}</>
          : "Not yet"],
      ]} />
      <div className="fields"><Field><Label htmlFor="gmail-every">Sync</Label>
        <Select id="gmail-every" defaultValue={MAIL.interval} onChange={async (e) => { if (await attempt(() => api("PUT", "mail", { interval: Number(e.target.value) }))) toast("Saved"); }}>
          {([[0, "Only when I ask"], [5, "Every 5 minutes"], [15, "Every 15 minutes"], [30, "Every 30 minutes"], [60, "Every hour"]] as [number, string][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select></Field></div>
      <div className="actions">
        <button className="al-button al-button--primary" type="button" aria-busy={busy === "sync" ? "true" : undefined} onClick={async () => {
          if (busy) return;
          setBusy("sync");
          const rep = await attempt(() => post("mail/sync", {}));
          setBusy(null);
          if (rep) toast(`${rep.fetched} fetched: ${rep.linked} linked, ${rep.triage} to sort`);
          rerender();
        }}>{busy === "sync" ? "Syncing…" : "Sync now"}</button>
        <a className="al-button al-button--sm" href="/inbox">Open the Inbox</a>
        <button className="al-button al-button--quiet al-button--danger" type="button" onClick={async () => {
          if (!(await confirmDelete("the Gmail connection", "Mail already brought in stays."))) return;
          if (await attempt(() => del("mail"))) { toast("Disconnected"); rerender(); }
        }}>Disconnect</button>
      </div>
      <h3>Ignored</h3>
      {ignores.length ? (
        <ul className="plain ignores">
          {ignores.map((i) => (
            <li key={i.id}>{i.kind === "domain" ? `Anything from @${i.value}` : i.value}
              <button className="al-button al-button--icon al-button--sm al-button--danger" type="button" aria-label={`Stop ignoring ${i.value}`} title="Stop ignoring"
                onClick={async () => { if (await attempt(() => del(`mail/ignores/${i.id}`))) rerender(); }}>×</button></li>
          ))}
        </ul>
      ) : <p className="muted">Nobody. “Ignore sender” in the Inbox adds them here.</p>}
    </section>
  );
}
