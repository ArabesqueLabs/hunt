// Email: Settings → Gmail.
//
// Gmail sign-in and sync (Settings → Gmail, a process's label and search)
// are switched off for now: emails come in as .eml files or pasted. Set
// GMAIL to bring them back; the service still has it all.

import { useEffect, useState } from "react";
import { api, attempt, del, get, post } from "../lib/api";
import { fmtStamp } from "../lib/format";
import { S, changed } from "../lib/state";
import { toast } from "../lib/toast";
import { confirmDelete } from "../components/dialogs";
import { useFilePicker } from "../components/files";
import { Facts, Field, Input, Label, Select } from "../components/ui";

export const GMAIL = false;

/** The Gmail connection and its last sync. */
export async function loadMail() {
  try { S.MAIL = await get("mail"); changed(); } catch { /* not connected */ }
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

/** Settings: the Gmail account, and how often it syncs. */
export function GmailSettings() {
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const rerender = () => setVersion((n) => n + 1);
  useEffect(() => {
    loadMail().then(() => {
      setAddress(S.MAIL?.address || "");
      setLoaded(true);
    });
  }, [version]);
  const MAIL = S.MAIL;
  if (!MAIL || !loaded) return <section className="al-panel panel settings-panel gmail"><div className="panel-head"><h2>Gmail</h2></div></section>;
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
          ? <>{fmtStamp(MAIL.last_sync)}{MAIL.last_error ? <span className="bad">{` — failed: ${MAIL.last_error}`}</span> : r ? <span className="muted">{` — ${r.fetched} fetched, ${r.linked} linked`}</span> : ""}</>
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
          if (rep) toast(`${rep.fetched} fetched: ${rep.linked} linked`);
          rerender();
        }}>{busy === "sync" ? "Syncing…" : "Sync now"}</button>
        <button className="al-button al-button--quiet al-button--danger" type="button" onClick={async () => {
          if (!(await confirmDelete("the Gmail connection", "Mail already brought in stays."))) return;
          if (await attempt(() => del("mail"))) { toast("Disconnected"); rerender(); }
        }}>Disconnect</button>
      </div>
    </section>
  );
}
