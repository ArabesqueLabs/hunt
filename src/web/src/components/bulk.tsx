// Many at once: selecting processes (in the table, or on the board) or
// records (companies, people, files), and acting on them together.
//
// The service changes them all or none (POST /api/processes/bulk, and
// /api/{resource}/bulk-tags and bulk-delete), and returns how processes
// were, so a toast can undo it.

import type { ReactNode } from "react";
import { attempt, del, post } from "../lib/api";
import { R } from "../lib/meta";
import { S } from "../lib/state";
import { toast } from "../lib/toast";
import type { Row, Stage } from "../lib/types";
import { askArchive } from "./closing";
import { ask, confirmDelete } from "./dialogs";
import { Field, Input, Label, Select } from "./ui";

/**
 * The bar shown while something is selected: how many, what can be done to
 * them, and Clear; hidden at none. The design system's bulk bar: after the
 * list, stuck to the bottom of the view, named by its count.
 */
export function BulkBar({ what = "selected", count, actions, clear }: { what?: string; count: number; actions: ReactNode; clear: () => void }) {
  const label = `${count} ${what}`;
  return (
    <div className="al-bulk-bar bulk-bar" role="region" aria-label={label} hidden={count === 0}>
      <span className="al-bulk-bar__count">{label}</span>
      <span className="bulk-actions">{actions}</span>
      <button className="al-button al-button--sm al-button--quiet" type="button" onClick={clear}>Clear</button>
    </div>
  );
}

/**
 * Change processes, all or nothing, then say what happened, with Undo.
 * `body` is the bulk request; `after()` redraws the page.
 */
export async function bulkProcesses(body: Row, after: () => void) {
  const res = await attempt(() => post("processes/bulk", body));
  if (!res) return null;
  const n = res.done.length;
  const skipped = res.skipped.length ? ` · ${res.skipped.length} skipped (${[...new Set(res.skipped.map((s: Row) => s.why))].join(", ")})` : "";
  const DONE: Record<string, string> = { move: "Moved", archive: "Closed", resume: "Back on the board", tag: "Tagged", untag: "Untagged", set: "Updated", delete: "Deleted" };
  const undo = body.action === "delete" || !n ? null : {
    label: "Undo",
    onclick: async () => {
      if (await attempt(() => post("processes/bulk", { action: "restore", states: res.before }))) { toast("Undone"); after(); }
    },
  };
  toast(`${DONE[body.action] || "Done"}: ${n} ${n === 1 ? "process" : "processes"}${skipped}`, "info", undo);
  after();
  return res;
}

/** A tag, asked for: from those there are, or a new one. */
export async function askTag(title: string, ok: string, existing = S.TAGS.map((t) => t.name)) {
  const data = await ask({
    title,
    body: (
      <div className="fields">
        <Field>
          <Label htmlFor="bulk-tag">Tag</Label>
          <Input id="bulk-tag" name="tag" list="bulk-tags" required placeholder="e.g. agency" />
          <datalist id="bulk-tags">{existing.map((t) => <option key={t} value={t} />)}</datalist>
        </Field>
      </div>
    ),
    ok,
  });
  return (data?.get("tag") as string | null)?.trim() || null;
}

/**
 * What can be done to selected processes: move (to a stage, or a lane of
 * it), archive, put back on the board, tag, untag, add a reminder,
 * delete. `ids()` gives them; `stages` (with their lanes) are where they
 * can go; `after()` redraws.
 */
export function ProcessActions({ ids, stages, after }: { ids: () => number[]; stages: Stage[]; after: () => void }) {
  const many = () => `${ids().length} ${ids().length === 1 ? "process" : "processes"}`;
  return (
    <>
      <Select aria-label="Move to" value="" onChange={async (e) => {
        const [stage, lane] = e.target.value.split(":");
        if (!stage) return;
        await bulkProcesses({ ids: ids(), action: "move", stage_id: Number(stage), lane_id: lane ? Number(lane) : null }, after);
      }}>
        <option value="">Move to…</option>
        {stages.flatMap((st) => [
          <option key={`${st.id}:`} value={`${st.id}:`}>{st.name}</option>,
          ...(st.lanes || []).map((l) => <option key={`${st.id}:${l.id}`} value={`${st.id}:${l.id}`}>{`${st.name} · ${l.name}`}</option>),
        ])}
      </Select>
      <button className="al-button al-button--sm" type="button" onClick={async () => {
        const body = await askArchive(many());
        if (body) await bulkProcesses({ ids: ids(), action: "archive", reason: body.archive_reason, stage_id: body.stage_id, note: body.archive_note }, after);
      }}>Close…</button>
      <button className="al-button al-button--sm" type="button" onClick={() => bulkProcesses({ ids: ids(), action: "resume" }, after)}>Reopen</button>
      <button className="al-button al-button--sm" type="button" onClick={async () => {
        const tag = await askTag(`Tag ${many()}`, "Add tag");
        if (tag) await bulkProcesses({ ids: ids(), action: "tag", tags: [tag] }, after);
      }}>Add tag…</button>
      <button className="al-button al-button--sm" type="button" onClick={async () => {
        const tag = await askTag(`Untag ${many()}`, "Remove tag");
        if (tag) await bulkProcesses({ ids: ids(), action: "untag", tags: [tag] }, after);
      }}>Remove tag…</button>
      <button className="al-button al-button--sm" type="button" onClick={async () => {
        const data = await ask({
          title: `Remind me, for ${many()}`,
          body: (
            <div className="fields">
              <Field><Label htmlFor="bulk-next">Remind me to</Label><Input id="bulk-next" name="next" required placeholder="e.g. send availability" /></Field>
              <Field><Label htmlFor="bulk-due">When</Label><Input id="bulk-due" name="due" type="datetime-local" /></Field>
            </div>
          ),
          ok: "Add reminders",
        });
        if (!data) return;
        const made = await attempt(async () => {
          const out: Row[] = [];
          for (const id of ids()) out.push(await post("reminders", { process_id: id, title: data.get("next"), due_at: data.get("due") || null }));
          return out;
        });
        if (!made) return;
        toast(`Reminders added: ${made.length}`, "info", { label: "Undo", onclick: async () => {
          if (await attempt(async () => { for (const r of made) await del(`reminders/${r.id}`); return true; })) { toast("Undone"); after(); }
        } });
        after();
      }}>Remind…</button>
      <button className="al-button al-button--sm al-button--quiet al-button--danger" type="button" onClick={async () => {
        if (!(await confirmDelete(`${many()} and their applications`, "Their applications go, with every process of theirs."))) return;
        await bulkProcesses({ ids: ids(), action: "delete" }, after);
      }}>Delete…</button>
    </>
  );
}

/** What can be done to selected records of a list: tag, untag, delete. */
export function RecordActions({ resource, ids, after }: { resource: string; ids: () => number[]; after: () => void }) {
  const r = R(resource) as Row;
  const many = () => `${ids().length} ${ids().length === 1 ? r.entity : r.title.toLowerCase()}`;
  const tags = async (add: boolean) => {
    const tag = await askTag(`${add ? "Tag" : "Untag"} ${many()}`, add ? "Add tag" : "Remove tag");
    if (!tag) return;
    const list = ids();
    const res = await attempt(() => post(`${resource}/bulk-tags`, { ids: list, [add ? "add" : "remove"]: [tag] }));
    if (!res) return;
    const changed = res.changed;
    toast(`${add ? "Tagged" : "Untagged"}: ${changed.length}`, "info", changed.length ? {
      label: "Undo",
      onclick: async () => {
        if (await attempt(() => post(`${resource}/bulk-tags`, { ids: changed, [add ? "remove" : "add"]: [tag] }))) { toast("Undone"); after(); }
      },
    } : null);
    after();
  };
  return (
    <>
      {r.taggable ? <button className="al-button al-button--sm" type="button" onClick={() => tags(true)}>Add tag…</button> : null}
      {r.taggable ? <button className="al-button al-button--sm" type="button" onClick={() => tags(false)}>Remove tag…</button> : null}
      <button className="al-button al-button--sm al-button--quiet al-button--danger" type="button" onClick={async () => {
        if (!(await confirmDelete(many(), "All of them go, or none: one that can't (a company with applications) stops the rest."))) return;
        const res = await attempt(() => post(`${resource}/bulk-delete`, { ids: ids() }));
        if (res) { toast(`Deleted: ${res.deleted.length}`); after(); }
      }}>Delete…</button>
    </>
  );
}

// The row last ticked, for shift-click.
let lastTicked: unknown = null;

/**
 * A row's checkbox: one per row (keyed), and shift-click for a run of them.
 * `sel` is a Set; `changed()` is told after each change.
 */
export function SelectCell<K>({ sel, id, keys, changed, label }: { sel: Set<K>; id: K; keys: () => K[]; changed: () => void; label: string }) {
  return (
    <td className="row-select">
      <input type="checkbox" checked={sel.has(id)} aria-label={`Select ${label}`} onChange={() => {}} onClick={(e) => {
        e.stopPropagation();
        const on = e.currentTarget.checked;
        const list = keys();
        // Shift: everything between this and the last one ticked, set the same.
        if (e.shiftKey && lastTicked != null && list.includes(lastTicked as K)) {
          const [a, b] = [list.indexOf(lastTicked as K), list.indexOf(id)].sort((x, y) => x - y);
          for (const k of list.slice(a, b + 1)) { if (on) sel.add(k); else sel.delete(k); }
        } else if (on) sel.add(id);
        else sel.delete(id);
        lastTicked = id;
        changed();
      }} />
    </td>
  );
}

/** The header's checkbox: all the rows shown, or none. */
export function SelectAllCell<K>({ sel, keys, changed }: { sel: Set<K>; keys: K[]; changed: () => void }) {
  const all = keys.length > 0 && keys.every((k) => sel.has(k));
  const some = !all && keys.some((k) => sel.has(k));
  return (
    <th className="row-select">
      <input type="checkbox" checked={all} aria-label="Select every row shown" ref={(el) => { if (el) el.indeterminate = some; }}
        onChange={() => {}} onClick={(e) => {
          e.stopPropagation();
          for (const k of keys) { if (e.currentTarget.checked) sel.add(k); else sel.delete(k); }
          changed();
        }} />
    </th>
  );
}
