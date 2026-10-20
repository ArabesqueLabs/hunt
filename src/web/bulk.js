"use strict";

// Many at once: selecting processes (in the table, or on the board) or
// records (companies, people, files), and acting on them together.
//
// The service changes them all or none (POST /api/processes/bulk, and
// /api/{resource}/bulk-tags and bulk-delete), and returns how processes
// were, so a toast can undo it. Built on app.js.

/** The board's selected processes, by id: kept while the board is drawn again. */
const BOARD_SEL = new Set();

/**
 * The bar shown while something is selected: how many, what can be done to
 * them, and Clear. `actions(bar)` draws its controls; `update(n)` keeps
 * the count, hiding the bar at none.
 */
function bulkBar({ what = "selected", actions, clear }) {
  // The design system's bulk bar: after the list, stuck to the bottom of
  // the view, named by its count.
  const count = h("span.al-bulk-bar__count");
  const bar = h("div.al-bulk-bar.bulk-bar", { role: "region", "aria-label": "Selected", hidden: true },
    count, h("span.bulk-actions", {}, actions()),
    h("button.al-button.al-button--sm.al-button--quiet", { type: "button", onclick: clear }, "Clear"));
  bar.update = (n) => {
    count.textContent = `${n} ${what}`;
    bar.setAttribute("aria-label", count.textContent);
    bar.hidden = n === 0;
  };
  return bar;
}

/**
 * Change processes, all or nothing, then say what happened, with Undo.
 * `body` is the bulk request; `after()` redraws the page.
 */
async function bulkProcesses(body, after) {
  const res = await attempt(() => post("processes/bulk", body));
  if (!res) return null;
  const n = res.done.length;
  const skipped = res.skipped.length ? ` · ${res.skipped.length} skipped (${[...new Set(res.skipped.map((s) => s.why))].join(", ")})` : "";
  const DONE = { move: "Moved", archive: "Closed", resume: "Back on the board", tag: "Tagged", untag: "Untagged", set: "Updated", delete: "Deleted" };
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
async function askTag(title, ok, existing = TAGS.map((t) => t.name)) {
  const data = await ask({
    title,
    body: h("div.fields", {}, h("div.field", {}, h("label", { for: "bulk-tag" }, "Tag"),
      h("input", { id: "bulk-tag", name: "tag", list: "bulk-tags", required: true, placeholder: "e.g. agency" }),
      h("datalist", { id: "bulk-tags" }, existing.map((t) => h("option", { value: t }))))),
    ok,
  });
  return data?.get("tag")?.trim() || null;
}

/**
 * What can be done to selected processes: move (to a stage, or a lane of
 * it), archive, put back on the board, tag, untag, add a reminder,
 * delete. `ids()` gives them; `stages` (with their lanes) are where they
 * can go; `after()` redraws.
 */
function processActions(ids, stages, after) {
  const many = () => `${ids().length} ${ids().length === 1 ? "process" : "processes"}`;
  const move = h("select", { "aria-label": "Move to", onchange: async () => {
    const [stage, lane] = move.value.split(":");
    move.value = "";
    if (!stage) return;
    await bulkProcesses({ ids: ids(), action: "move", stage_id: Number(stage), lane_id: lane ? Number(lane) : null }, after);
  } },
  h("option", { value: "" }, "Move to…"),
  stages.map((st) => [h("option", { value: `${st.id}:` }, st.name),
    (st.lanes || []).map((l) => h("option", { value: `${st.id}:${l.id}` }, `${st.name} · ${l.name}`))]));
  return [
    move,
    h("button.al-button.al-button--sm", { type: "button", onclick: async () => {
      const body = await askArchive(many());
      if (body) await bulkProcesses({ ids: ids(), action: "archive", reason: body.archive_reason, stage_id: body.stage_id, note: body.archive_note }, after);
    } }, "Close…"),
    h("button.al-button.al-button--sm", { type: "button", onclick: () => bulkProcesses({ ids: ids(), action: "resume" }, after) }, "Reopen"),
    h("button.al-button.al-button--sm", { type: "button", onclick: async () => {
      const tag = await askTag(`Tag ${many()}`, "Add tag");
      if (tag) await bulkProcesses({ ids: ids(), action: "tag", tags: [tag] }, after);
    } }, "Add tag…"),
    h("button.al-button.al-button--sm", { type: "button", onclick: async () => {
      const tag = await askTag(`Untag ${many()}`, "Remove tag");
      if (tag) await bulkProcesses({ ids: ids(), action: "untag", tags: [tag] }, after);
    } }, "Remove tag…"),
    h("button.al-button.al-button--sm", { type: "button", onclick: async () => {
      const data = await ask({
        title: `Remind me, for ${many()}`,
        body: h("div.fields", {},
          h("div.field", {}, h("label", { for: "bulk-next" }, "Remind me to"), h("input", { id: "bulk-next", name: "next", required: true, placeholder: "e.g. send availability" })),
          h("div.field", {}, h("label", { for: "bulk-due" }, "When"), h("input", { id: "bulk-due", name: "due", type: "datetime-local" }))),
        ok: "Add reminders",
      });
      if (!data) return;
      const made = await attempt(async () => {
        const out = [];
        for (const id of ids()) out.push(await post("reminders", { process_id: id, title: data.get("next"), due_at: data.get("due") || null }));
        return out;
      });
      if (!made) return;
      toast(`Reminders added: ${made.length}`, "info", { label: "Undo", onclick: async () => {
        if (await attempt(async () => { for (const r of made) await del(`reminders/${r.id}`); return true; })) { toast("Undone"); after(); }
      } });
      after();
    } }, "Remind…"),
    h("button.al-button.al-button--sm.al-button--quiet.al-button--danger", { type: "button", onclick: async () => {
      if (!(await confirmDelete(`${many()} and their applications`, "Their applications go, with every process of theirs."))) return;
      await bulkProcesses({ ids: ids(), action: "delete" }, after);
    } }, "Delete…"),
  ];
}

/** What can be done to selected records of a list: tag, untag, delete. */
function recordActions(resource, ids, after) {
  const r = R(resource);
  const many = () => `${ids().length} ${ids().length === 1 ? r.entity : r.title.toLowerCase()}`;
  const tags = async (add) => {
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
  return [
    r.taggable ? h("button.al-button.al-button--sm", { type: "button", onclick: () => tags(true) }, "Add tag…") : null,
    r.taggable ? h("button.al-button.al-button--sm", { type: "button", onclick: () => tags(false) }, "Remove tag…") : null,
    h("button.al-button.al-button--sm.al-button--quiet.al-button--danger", { type: "button", onclick: async () => {
      if (!(await confirmDelete(many(), "All of them go, or none: one that can't (a company with applications) stops the rest."))) return;
      const res = await attempt(() => post(`${resource}/bulk-delete`, { ids: ids() }));
      if (res) { toast(`Deleted: ${res.deleted.length}`); after(); }
    } }, "Delete…"),
  ];
}

/**
 * Checkboxes for a table's rows: one per row (keyed), one in the header
 * for every row shown, and shift-click for a run of them. `sel` is a Set;
 * `changed()` is told after each change.
 */
function selectCell(sel, key, keys, changed, label) {
  const box = h("input", { type: "checkbox", checked: sel.has(key), "aria-label": `Select ${label}` });
  box.addEventListener("click", (e) => {
    e.stopPropagation();
    const list = keys();
    // Shift: everything between this and the last one ticked, set the same.
    if (e.shiftKey && selectCell.last != null && list.includes(selectCell.last)) {
      const [a, b] = [list.indexOf(selectCell.last), list.indexOf(key)].sort((x, y) => x - y);
      for (const k of list.slice(a, b + 1)) { if (box.checked) sel.add(k); else sel.delete(k); }
    } else if (box.checked) sel.add(key);
    else sel.delete(key);
    selectCell.last = key;
    changed();
  });
  return h("td.row-select", {}, box);
}

/** The header's checkbox: all the rows shown, or none. */
function selectAllCell(sel, keys, changed) {
  const list = keys();
  const all = list.length > 0 && list.every((k) => sel.has(k));
  const box = h("input", { type: "checkbox", checked: all, "aria-label": "Select every row shown" });
  box.indeterminate = !all && list.some((k) => sel.has(k));
  box.addEventListener("click", (e) => {
    e.stopPropagation();
    for (const k of list) { if (box.checked) sel.add(k); else sel.delete(k); }
    changed();
  });
  return h("th.row-select", {}, box);
}

// Escape lets go of the board's selection (when nothing else wants it).
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !BOARD_SEL.size || document.querySelector("dialog[open]")) return;
  if (!document.querySelector(".board .columns")) return;
  BOARD_SEL.clear();
  showBoard();
});
