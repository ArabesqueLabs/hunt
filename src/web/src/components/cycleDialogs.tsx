// Starting, ending and resuming a cycle.

import { useState } from "react";
import { attempt, get, post } from "../lib/api";
import { endedCycles, loadCycles, pickCycle, runningCycles, seasonName } from "../lib/cycles";
import { isoToday, zonedNow } from "../lib/format";
import { go } from "../lib/router";
import { store } from "../lib/storage";
import { toPlain } from "../lib/rich";
import { toast } from "../lib/toast";
import type { Board, Card, Cycle } from "../lib/types";
import { DatePicker } from "./DatePicker";
import { closeModal, dismissModal, openModal } from "./dialogs";
import { RichText } from "./RichText";
import { Choice, Field, Input, Label, Optional, Select } from "./ui";

/**
 * Start a cycle: its name, when, what it's for; and, from the cycle that
 * ended last, what to bring back (what was still open, and what was on
 * hold), each as a new card in the first stage, with its history.
 */
export async function startCycle() {
  await loadCycles();
  const last = endedCycles().sort((a, b) => ((b.ended_on as string) > (a.ended_on as string) ? 1 : -1))[0];
  let carry: { c: Card; state: string }[] = [];
  if (last) {
    const b: Board = await get(`board?cycle=${last.id}`);
    carry = [
      ...b.stages.slice(0, -1).flatMap((s) => s.cards.map((c) => ({ c, state: `Was in ${s.name}` }))),
      ...b.archived.filter((c) => c.archive_reason === "paused").map((c) => ({ c, state: "Closed: on hold" })),
    ];
  }
  openModal(<StartCycle last={last} carry={carry} />);
}

function StartCycle({ last, carry }: { last?: Cycle; carry: { c: Card; state: string }[] }) {
  const [name, setName] = useState(seasonName(zonedNow()));
  const [startedOn, setStartedOn] = useState(isoToday());
  const [description, setDescription] = useState("");
  const [chosen, setChosen] = useState(new Set<number>());
  const [busy, setBusy] = useState(false);
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      if (busy) return;
      setBusy(true);
      const made = await attempt(() => post("cycles/start", { name: name.trim(), started_on: startedOn, description, bring_back: [...chosen] }));
      setBusy(false);
      if (!made) return;
      closeModal();
      store("boardCycle", String(made.id));
      await loadCycles();
      go("/");
      toast(`Started ${made.name}${chosen.size ? ` with ${chosen.size} brought back` : ""}`);
    }}>
      <h2 className="al-dialog__title" id="modal-title">Start a new cycle</h2>
      <div className="al-dialog__body">
        <div className="cycle-dates">
          <Field><Label htmlFor="start-name">Name</Label><Input id="start-name" value={name} required onChange={(e) => setName(e.target.value)} /></Field>
          <Field><Label htmlFor="start-date">Starts</Label>
            <DatePicker id="start-date" value={startedOn} onChange={(v) => setStartedOn(v || isoToday())} /></Field>
        </div>
        <Field>
          <Label htmlFor="start-desc">Description <Optional /></Label>
          <RichText id="start-desc" rows={2} label="Description" placeholder="What this cycle is for: a place, an industry, a kind of role" value=""
            onChange={(html) => setDescription(toPlain(html).trim() ? html : "")} />
        </Field>
        <p className="muted small">It starts with an empty board, and any running cycles carry on. Target pay, tags, stages, stories and contacts are shared.</p>
        {carry.length && last ? (
          <fieldset className="al-fieldset">
            <legend>{`Bring back from ${last.name} `}<Optional /></legend>
            <span className="al-hint">Applications that were still open, or on hold, when it ended. They come back as Considering, with their history.</span>
            <div className="al-choices">
              {carry.map(({ c, state }) => (
                <Choice key={c.id}>
                  <input type="checkbox" checked={chosen.has(c.id)} onChange={(e) => {
                    const next = new Set(chosen);
                    if (e.target.checked) next.add(c.id); else next.delete(c.id);
                    setChosen(next);
                  }} />
                  <span className="al-choice__text"><span translate="no">{`${c.company}${c.title ? ` · ${c.title}` : ""}`}</span><span className="al-choice__hint">{state}</span></span>
                </Choice>
              ))}
            </div>
          </fieldset>
        ) : null}
      </div>
      <div className="al-dialog__actions">
        <button className="al-button" type="button" onClick={dismissModal}>Cancel</button>
        <button className="al-button al-button--primary" type="submit" disabled={!name.trim()} aria-busy={busy ? "true" : undefined}>
          {chosen.size ? `Start, with ${chosen.size} brought back` : "Start with an empty board"}
        </button>
      </div>
    </form>
  );
}

/**
 * Run an ended cycle again, after asking: its board opens as it was, to
 * change once more. What its ending put away (reminders, prep) stays so.
 */
export function resumeCycle(c: Cycle) {
  openModal(<ResumeCycle c={c} />);
}

function ResumeCycle({ c }: { c: Cycle }) {
  const [busy, setBusy] = useState(false);
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      if (busy) return;
      setBusy(true);
      const resumed = await attempt(() => post(`cycles/${c.id}/resume`, {}));
      setBusy(false);
      if (!resumed) return;
      closeModal();
      await loadCycles();
      pickCycle(resumed.id);
      toast(`Resumed ${resumed.name}`);
    }}>
      <h2 className="al-dialog__title" id="modal-title">{`Resume ${c.name}?`}</h2>
      <div className="al-dialog__body">
        <p>It runs again, from where it ended: its board can change once more, and it counts as active.</p>
        <p className="muted small">Reminders and prep put away when it ended stay that way. It can be ended again any time.</p>
      </div>
      <div className="al-dialog__actions">
        <button className="al-button" type="button" onClick={dismissModal}>Cancel</button>
        <button className="al-button al-button--primary" type="submit" aria-busy={busy ? "true" : undefined}>Resume cycle</button>
      </div>
    </form>
  );
}

/** End a running cycle: how it ended (with an offer, which), its name, and what happens. */
export async function endCycle(c: Cycle) {
  const [b, own] = await Promise.all([get(`board?cycle=${c.id}`) as Promise<Board>, ownOutcomes()]);
  openModal(<EndCycle c={c} b={b} own={own} />);
}

/** How earlier cycles ended in your own words, most used first. */
export const ownOutcomes = (): Promise<string[]> => get("suggest/cycles/outcome?q=").catch(() => []);

const HOWS: [string, string, string][] = [["offer", "I accepted an offer", "Congratulations"], ["break", "I'm taking a break", "Pick it up again later with a new cycle"],
  ["stopped", "I stopped looking", "Staying where you are, or something else"], ["other", "Something else", ""]];

function EndCycle({ c, b, own }: { c: Cycle; b: Board; own: string[] }) {
  const cards = b.stages.flatMap((s) => s.cards);
  // Offers to choose from: what reached the last two stages, latest first.
  const late = b.stages.slice(-2).reverse().flatMap((s) => s.cards);
  const [outcome, setOutcome] = useState("offer");
  const [words, setWords] = useState("");
  const [processId, setProcessId] = useState<string>(late[0]?.id != null ? String(late[0].id) : "");
  const [name, setName] = useState(c.name);
  const [busy, setBusy] = useState(false);
  const others = runningCycles().length > 1;
  const open = cards.length;
  const off = outcome === "offer" && cards.find((p) => String(p.id) === String(processId));
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      if (busy || !name.trim()) return;
      setBusy(true);
      const ended = await attempt(() => post(`cycles/${c.id}/end`, {
        outcome: outcome === "other" ? words.trim() || "other" : outcome, name: name.trim(),
        process_id: outcome === "offer" && processId ? Number(processId) : null,
      }));
      setBusy(false);
      if (!ended) return;
      closeModal();
      await loadCycles();
      go("/cycles");
      toast(`Ended ${ended.name}. Its board is saved below.`);
    }}>
      <h2 className="al-dialog__title" id="modal-title">{`End the ${c.name} cycle`}</h2>
      <div className="al-dialog__body">
        <fieldset className="al-fieldset">
          <legend>How did it end?</legend>
          <div className="al-choices">
            {[...HOWS.slice(0, -1), ...own.map((v): [string, string, string] => [v, v, ""]), ...HOWS.slice(-1)].map(([v, l, hint]) => (
              <Choice key={v}>
                <input type="radio" name="end-how" value={v} checked={outcome === v} onChange={() => setOutcome(v)} />
                <span className="al-choice__text"><span translate={HOWS.some(([h]) => h === v) ? undefined : "no"}>{l}</span>{hint ? <span className="al-choice__hint">{hint}</span> : null}</span>
              </Choice>
            ))}
          </div>
        </fieldset>
        <Field hidden={outcome !== "other"}>
          <Label htmlFor="end-words">In your own words <Optional /></Label>
          <Input id="end-words" value={words} placeholder="e.g. Moved abroad" onChange={(e) => setWords(e.target.value)} />
          <span className="al-hint">Kept as a reason of its own, to pick again next time.</span>
        </Field>
        <Field hidden={outcome !== "offer"}>
          <Label htmlFor="end-offer">Which offer?</Label>
          <Select id="end-offer" value={processId} onChange={(e) => setProcessId(e.target.value)}>
            {late.map((p) => <option key={p.id} value={p.id}>{`${p.company}${p.title ? ` · ${p.title}` : ""}`}</option>)}
            <option value="">One that isn't on the board</option>
          </Select>
          <span className="al-hint">It moves to the last stage, Accepted if it has that sub stage. Its take-home and pay stay on record.</span>
        </Field>
        <Field><Label htmlFor="end-name">Name</Label><Input id="end-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="cycle-what-happens">
          <span className="al-label">What happens</span>
          <ul className="cycle-effects">
            <li>{open === 1 ? "1 open application is kept as it is: stage, sub stage, timeline, notes and files." : `${open} open applications are kept as they are: stage, sub stage, timeline, notes and files.`}</li>
            <li>{b.archived_total === 1 ? "1 closed application stays closed, inside the cycle." : `${b.archived_total} closed applications stay closed, inside the cycle.`}</li>
            {off ? <li translate="no">{`${off.company} moves to ${b.stages[b.stages.length - 1]?.name}.`}</li> : null}
            <li>Open reminders and prep for these applications are closed. General prep stays.</li>
            {others ? <li>Your other running cycles are not affected.</li> : null}
            <li>You can look at its board any time under Cycles.</li>
          </ul>
        </div>
      </div>
      <div className="al-dialog__actions">
        <button className="al-button" type="button" onClick={dismissModal}>Cancel</button>
        <button className="al-button al-button--primary" type="submit" disabled={!name.trim()} aria-busy={busy ? "true" : undefined}>End the cycle</button>
      </div>
    </form>
  );
}
