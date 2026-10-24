// An offer accepted: marking it, wrapping up the other processes, and the
// celebration that takes the board's place on the home page.
//
// Accepting moves the process to its stage's Accepted lane: an accepted
// offer isn't an ending (references, checks and a start date may still be
// ahead), and it's closed as "I started the job" once work begins. A stage
// without that lane closes it as accepted, as before. Then the other open
// processes are wrapped up, each as chosen: closed (withdrawn), kept open
// with a reminder to tell the recruiter (the default for those that got
// far), or left as they are. From then on the home page (/) is the
// celebration, until "Back to the board" (remembered in this browser);
// /celebrate shows it again.

import { Fragment, useEffect, useState } from "react";
import { attempt, get, patch, post } from "../lib/api";
import { fmtDay, fmtMoney, HOME, homePay, isoToday, nf, parseLocal, zonedNow } from "../lib/format";
import { fieldOf, optionLabel } from "../lib/meta";
import { go } from "../lib/router";
import { baseTitle, offerNav } from "../lib/shell";
import { S } from "../lib/state";
import { store, stored } from "../lib/storage";
import { toast } from "../lib/toast";
import type { Card, Row } from "../lib/types";
import { ask, pushDialog } from "../components/dialogs";
import { Field, Icon, Input, Label, LoadingPage, Logo, Photo, Select, Table } from "../components/ui";

/** The closing reason a job started (or, without an Accepted lane, an accepted offer) is filed under. */
export const ACCEPTED = "accepted";

/** Whether a lane is where accepted offers wait. */
export const isAcceptedLane = (l: Row) => /^accepted$/i.test(l.name.trim());

/**
 * The most recently accepted offer's process, in a running cycle (in an
 * Accepted lane, or closed as accepted), or null. An ended cycle's offer
 * was celebrated when it was accepted, and is saved with its board.
 */
async function acceptedOffer(): Promise<Card | null> {
  const [closed, open, lanes, cycles] = await Promise.all([
    get(`processes?status=archived&archive_reason=${ACCEPTED}`), get("processes?status=active"), get("lanes"), get("cycles")]);
  const accepted = new Set(lanes.filter(isAcceptedLane).map((l: Row) => l.id));
  const running = new Set(cycles.filter((c: Row) => !c.ended_on).map((c: Row) => c.id));
  const list = [...closed, ...open.filter((p: Row) => accepted.has(p.lane_id))].filter((p) => running.has(p.cycle_id));
  return list.sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] || null;
}

/** Whether the home page is the celebration: an offer accepted, and not set aside for the board. */
export async function celebrating() {
  const offer = await acceptedOffer();
  offerNav.set(!!offer);
  return offer && stored("celebrated") !== String(offer.id) ? offer : null;
}

/** Whether an application's process is at its offer: the "Offer" stage, or the last. */
export function atOffer(process: Row | null | undefined, stages: Row[]) {
  if (!process || process.status !== "active") return false;
  const at = stages.findIndex((st) => st.id === process.stage_id);
  return /offer/i.test(stages[at]?.name || "") || at === stages.length - 1;
}

/**
 * Accept the offer of `process` (at `company`, for `title`): into its
 * stage's Accepted lane (or, without one, closed as accepted), then the rest
 * wrapped up, then the celebration.
 */
export async function acceptOffer(process: Row, company: string, title?: string | null) {
  const name = `${company}${title ? ` — ${title}` : ""}`;
  const lane = (await get(`lanes?stage_id=${process.stage_id}`)).find(isAcceptedLane);
  const data = await ask({
    title: "Accept the offer",
    body: (
      <div className="fields">
        <p>{lane
          ? `Accept the offer from ${name}? It moves to Accepted and stays on the board until you start; then close it as “I started the job”. Next, you choose what happens to your other processes.`
          : `Accept the offer from ${name}? It's closed as accepted; then you choose what happens to your other processes.`}</p>
        <Field><Label htmlFor="accept-note">Note</Label><Input id="accept-note" name="note" placeholder="e.g. Start date 1 December" /></Field>
      </div>
    ),
    ok: "🎉 Accept the offer",
  });
  if (!data) return false;
  const note = ((data.get("note") as string) || "").trim();
  const done = await attempt(async () => {
    if (!lane) return patch(`processes/${process.id}`, { status: "archived", archive_reason: ACCEPTED, archive_note: note || null });
    await post(`processes/${process.id}/move`, { stage_id: process.stage_id, lane_id: lane.id });
    if (note) await post("notes", { process_id: process.id, body: `Accepted the offer: ${note}`, happened_on: isoToday() });
    return true;
  });
  if (!done) return false;
  toast("Congratulations!");
  await wrapUp(process.id, company);
  go("/celebrate");
  return true;
}

const CHOICES: [string, string][] = [["archive", "Close it (I withdrew)"], ["reach", "Tell the recruiter first"], ["keep", "Leave it open"]];

/**
 * The other open processes, each to archive (withdrawn), keep open with a
 * step to tell the recruiter, or leave: those at Screening or beyond default
 * to telling the recruiter, the rest to archiving.
 */
async function wrapUp(acceptedId: number, company: string) {
  const board = await get("board");
  const open: Row[] = board.stages.flatMap((st: Row, i: number) => st.cards.map((c: Row) => ({ ...c, at: i, stageName: st.name }))).filter((c: Row) => c.id !== acceptedId);
  if (!open.length) return;
  return new Promise<void>((resolve) => {
    pushDialog({ className: "al-dialog al-dialog--md ask import wrap-up", onClosed: resolve, render: (close) => <WrapUp open={open} company={company} close={close} /> });
  });
}

function WrapUp({ open, company, close }: { open: Row[]; company: string; close: () => void }) {
  const [choices, setChoices] = useState<Record<number, string>>(() => Object.fromEntries(open.map((c) => [c.id, c.at >= 2 ? "reach" : "archive"])));
  const all = (v: string) => setChoices(Object.fromEntries(open.map((c) => [c.id, v])));
  const withdrew = S.META.archive_reasons.find((r) => r.value === "withdrew")?.value || S.META.archive_reasons[S.META.archive_reasons.length - 1]?.value;
  return (
    <div className="al-dialog__inner">
      <h2 className="al-dialog__title">Wrap up the rest</h2>
      <p className="muted">{`${open.length} other ${open.length === 1 ? "process is" : "processes are"} still open. Close those you're done with; for those that got far, a reminder to tell the recruiter you've accepted another offer.`}</p>
      <div className="wrap-up-all">
        <span className="muted small">All:</span>
        <button className="al-button al-button--sm" type="button" onClick={() => all("archive")}>Close</button>
        <button className="al-button al-button--sm" type="button" onClick={() => all("reach")}>Tell the recruiter</button>
        <button className="al-button al-button--sm" type="button" onClick={() => all("keep")}>Leave open</button>
      </div>
      <div className="al-table-wrap">
        <Table className="import-table">
          <thead><tr><th>Process</th><th>Stage</th><th>What happens</th></tr></thead>
          <tbody>
            {open.map((c) => (
              <tr key={c.id}>
                <td><span className="with-logo"><Logo id={c.company_id} logo={c.company_logo} name={c.company} size={20} /><b>{c.company}</b></span>
                  {c.title ? <span className="muted small" translate="no">{` — ${c.title}`}</span> : null}</td>
                <td>{c.stageName}</td>
                <td>
                  <Select aria-label={`What happens to ${c.company}${c.title ? ` — ${c.title}` : ""}`} value={choices[c.id]} onChange={(e) => setChoices({ ...choices, [c.id]: e.target.value })}>
                    {CHOICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      <div className="actions">
        <button className="al-button" type="button" onClick={close}>Not now</button>
        <button className="al-button al-button--primary" type="button" onClick={async () => {
          const tomorrow = (() => { const d = zonedNow(); d.setDate(d.getDate() + 1); return d.toLocaleDateString("en-CA"); })();
          const done = await attempt(async () => {
            let archived = 0, reminded = 0;
            for (const card of open) {
              if (choices[card.id] === "archive") {
                await patch(`processes/${card.id}`, { status: "archived", archive_reason: withdrew, archive_note: `Accepted an offer at ${company}` });
                archived++;
              } else if (choices[card.id] === "reach") {
                await post("reminders", { process_id: card.id, title: "Tell the recruiter I've accepted another offer", due_at: `${tomorrow}T10:00` });
                reminded++;
              }
            }
            return [archived, reminded];
          });
          if (!done) return;
          toast(`Closed ${done[0]}; ${done[1]} to tell the recruiter`);
          close();
        }}>Do it</button>
      </div>
    </div>
  );
}

/** /celebrate: the celebration, again. */
export function CelebratePage() {
  const [offer, setOffer] = useState<Card | null>(null);
  useEffect(() => {
    acceptedOffer().then((o) => {
      if (!o) { go("/", { replace: true }); return; }
      setOffer(o);
    }).catch((e) => toast(e.message, "error"));
  }, []);
  return offer ? <Celebration offer={offer} /> : null;
}

/** The celebration: the offer, large, and the search that led to it, below. */
export function Celebration({ offer }: { offer: Card }) {
  const [data, setData] = useState<Row | null>(null);
  useEffect(() => {
    offerNav.set(true);
    (async () => {
      const [app, st, detail] = await Promise.all([
        get(`applications/${offer.application_id}`), get("stats"), get(`processes/${offer.id}/detail`)]);
      const company = await get(`companies/${app.company_id}`);
      // From the first process added to the yes.
      const all = await get("board?archived_since=");
      const started = [...all.stages.flatMap((s: Row) => s.cards), ...all.archived].map((c: Row) => c.applied_on || c.created_at.slice(0, 10)).sort()[0];
      setData({ app, st, detail, company, started });
      document.title = `Congratulations · ${baseTitle()}`;
    })().catch((e) => toast(e.message, "error"));
  }, [offer]);
  if (!data) return <LoadingPage />;
  const { app, st, detail, company, started } = data;
  const pay = (() => {
    const p = homePay(app);
    return p ? fmtMoney(p[0] == null ? null : Math.round(p[0]), p[1] == null ? null : Math.round(p[1]), HOME(), app.pay_period)
      : fmtMoney(app.salary_min, app.salary_max, app.currency, app.pay_period);
  })();
  const accepted = offer.updated_at.slice(0, 10);
  const days = started ? Math.max(1, Math.round((parseLocal(accepted).getTime() - parseLocal(started).getTime()) / 864e5)) : null;
  const t = st.totals;
  const mode = optionLabel(fieldOf("applications", "work_mode").options, app.work_mode);
  const tile = (value: string, label: string) => <div className="al-stat viz-tile celebrate-tile"><span className="al-stat__value">{value}</span><span className="al-stat__label">{label}</span></div>;
  const people: Row[] = detail.people || [];
  const line = [app.location ? <span translate="no">{app.location}</span> : null, app.work_mode ? mode : null, `Accepted ${fmtDay(accepted)}`].filter(Boolean);
  return (
    <div className="page celebrate">
      <header className="al-page-head"><h1>Your offer</h1><p className="al-page-head__lede">The offer you accepted, and the search that led to it.</p></header>
      <section className="celebrate-hero">
        <div className="confetti" aria-hidden="true">
          {Array.from({ length: 36 }, (_, i) => <span key={i} style={{ "--i": i, "--x": `${(i * 37) % 100}%`, "--d": `${(i % 7) * 0.35}s`, "--hue": (i * 47) % 360 } as React.CSSProperties} />)}
        </div>
        <p className="eyebrow">Offer accepted</p>
        <h2 className="celebrate-title">Congratulations!</h2>
        <p className="celebrate-lead">You accepted the offer from <b translate="no">{company.name}</b>.</p>
        <article className="celebrate-offer">
          <Logo id={company.id} logo={company.logo} name={company.name} size={56} />
          <div>
            <h2 translate="no">{app.title || company.name}</h2>
            <p className="muted">{line.map((x, i) => <Fragment key={i}>{i ? " · " : null}{x}</Fragment>)}</p>
            {pay ? <p className="celebrate-pay">{pay}</p> : null}
            {offer.archive_note ? <p className="celebrate-note" translate="no">{offer.archive_note}</p> : null}
            <a href={`/applications/${app.id}?process=${offer.id}`}>Open the application →</a>
          </div>
        </article>
      </section>
      <section className="celebrate-stats">
        <h2>How you got here</h2>
        <div className="viz-tiles celebrate-tiles">
          {days ? tile(days === 1 ? "1 day" : `${days} days`, "from your first application to a yes") : null}
          {tile(nf(t.applications), "applications")}
          {tile(nf(t.companies), "companies you looked at")}
          {tile(nf(t.interviews_done), "interviews done")}
          {tile(nf(t.people), "people you met")}
          {tile(nf(t.offers), t.offers === 1 ? "offer reached" : "offers reached")}
          {t.files_sent ? tile(nf(t.files_sent), "files sent") : null}
          {t.emails ? tile(nf(t.emails), "emails saved") : null}
        </div>
      </section>
      {people.length ? (
        <section className="celebrate-thanks">
          <h2>Say thank you</h2>
          <p className="muted">The people who were part of this one.</p>
          <ul className="app-people">
            {people.map((pe) => (
              <li key={pe.id}>
                <span className="with-logo"><Photo id={pe.id} photo={pe.photo} name={pe.name} size={28} /><a href={`/people/${pe.id}`}>{pe.name}</a></span>
                {pe.email ? <a className="small-button button" href={`mailto:${pe.email}?subject=${encodeURIComponent("Thank you")}`}><Icon name="mail" />Email</a> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="actions celebrate-actions">
        <button className="al-button" type="button" onClick={() => { store("celebrated", String(offer.id)); go("/"); }}>Back to the board</button>
        <a className="al-button al-button--sm" href="/stats">See all the stats</a>
      </div>
    </div>
  );
}
