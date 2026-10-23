// Closing an application: why (a reason, or the inactive stage it goes to).

import { archiveReason } from "../lib/meta";
import { S } from "../lib/state";
import { ask } from "./dialogs";
import { Choice, Field, Input, Label, Optional } from "./ui";

/**
 * Where an application can close: each inactive stage, with its lanes (the
 * reasons), or the stage itself where it has none. A choice's value is a
 * reason's code, or `stage:` and the stage's id.
 */
export function closingChoices() {
  return (S.META.closed_stages || []).map((st) => {
    const lanes = S.META.archive_reasons.filter((r) => r.stage_id === st.id);
    return { stage: st, choices: (lanes.length ? lanes.map((r) => [r.value, r.label]) : [[`stage:${st.id}`, st.name]]) as [string, string][] };
  });
}

export interface ClosingBody { stage_id?: number; status?: string; archive_reason?: string; archive_note: string | null }

/** What closing for a choice sends: to a reason's lane, or into an inactive stage. */
export const closingBody = (choice: string, note: string | null): ClosingBody => (choice.startsWith("stage:")
  ? { stage_id: Number(choice.slice(6)), archive_note: note }
  : { status: "archived", archive_reason: choice, archive_note: note });

/** Said of a closing: its reason, or the inactive stage it went to. */
export const closingLabel = (body: ClosingBody) => (body.archive_reason ? archiveReason(body.archive_reason)
  : (S.META.closed_stages || []).find((st) => st.id === body.stage_id)?.name || "Closed");

/** Ask why an application is being closed (and, given the stage it reached, say what it keeps). */
export async function askArchive(name: string, stage: string | null = null) {
  const groups = closingChoices();
  let first = true;
  const radio = ([value, label]: [string, string]) => {
    const on = first;
    first = false;
    return (
      <Choice key={value}>
        <input type="radio" name="reason" value={value} required defaultChecked={on} />
        <span className="al-choice__text">{label}</span>
      </Choice>
    );
  };
  const data = await ask({
    title: `Close ${name}`,
    body: (
      <div className="al-dialog__body">
        {/* One inactive stage: its reasons; several: each with its own. */}
        {groups.length > 1
          ? groups.map((g) => <fieldset key={g.stage.id} className="al-fieldset"><legend>{g.stage.name}</legend><div className="al-choices">{g.choices.map(radio)}</div></fieldset>)
          : <fieldset className="al-fieldset"><legend>Why?</legend><div className="al-choices">{(groups[0]?.choices || []).map(radio)}</div></fieldset>}
        <Field>
          <Label htmlFor="archive-note">Note <Optional /></Label>
          <Input id="archive-note" name="note" placeholder="e.g. went with an internal candidate" />
        </Field>
        <p className="muted small">{stage
          ? `It keeps the stage it reached (${stage}) and its timeline. You can bring it back from Closed.`
          : "Each keeps the stage it reached and its timeline. You can bring them back from Closed."}</p>
      </div>
    ),
    ok: `Close ${name}`,
  });
  return data && closingBody(data.get("reason") as string, (data.get("note") as string) || null);
}
