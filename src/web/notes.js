"use strict";

// General notes (/notes): thoughts about the search, not one application.
// A note reads as text; clicking it edits it in place. Built on app.js.

async function showNotes() {
  let q = "";
  let tag = "";
  let editing = null; // a note's id, or "new"
  let notes = [];
  const page = h("div.page.notes-page");
  const search = h("input", { type: "search", placeholder: "Search notes", "aria-label": "Search notes" });
  let timer;
  search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { q = search.value; load(); }, 150); });
  const list = h("div.notes-grid");

  async function load() {
    notes = await get(`memos?q=${enc(q)}${tag ? `&tag=${enc(tag)}` : ""}`);
    render();
  }

  function editor(note) {
    const title = h("input", { "aria-label": "Title", placeholder: "Title (optional)", value: note?.title || "" });
    const body = h("textarea", { "aria-label": "Note", placeholder: "Write anything…", rows: Math.max(6, (note?.body || "").split("\n").length + 1) });
    body.value = note?.body || "";
    const save = async () => {
      if (!body.value.trim()) { toast("Write something first", "error"); body.focus(); return; }
      const fields = { title: title.value.trim() || null, body: body.value };
      const saved = await attempt(() => (note ? patch(`memos/${note.id}`, fields) : post("memos", fields)));
      if (saved) { toast(note ? "Saved" : "Note added"); editing = null; load(); }
    };
    const card = h("article.al-card.note-card.editing", {},
      title, body,
      note ? tagEditor("memos", note, () => {}) : null,
      h("div.actions", {},
        note ? h("button.al-button.al-button--sm.al-button--quiet.al-button--danger", { type: "button", onclick: async () => {
          if (!(await confirmDelete(`note “${note.label}”`))) return;
          if (await attempt(() => del(`memos/${note.id}`))) { toast("Deleted"); editing = null; load(); }
        } }, "Delete") : null,
        h("span.spacer"),
        h("button.al-button", { type: "button", onclick: () => { editing = null; render(); } }, "Cancel"),
        h("button.al-button.al-button--primary", { type: "button", onclick: save }, note ? "Save" : "Add note")));
    card.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); }
      if (e.key === "Escape") { editing = null; render(); }
    });
    setTimeout(() => (note ? body : body).focus(), 0);
    return card;
  }

  function card(note) {
    const open = () => { editing = note.id; render(); };
    // The system's interactive card: a click anywhere opens it; its one
    // control, Edit, is how the keyboard does.
    return h("article.al-card.al-card--interactive.note-card", { onclick: (e) => { if (!e.target.closest("a, button")) open(); } },
    note.title ? h("h2", {}, note.title) : null,
    h("div.note-body", {}, note.body),
    h("footer", {},
      tagNames(note.tags).map((t) => tagChip(t)),
      h("time.muted.small", { datetime: note.updated_at, title: `Written ${fmtStamp(note.created_at)}` }, fmtStamp(note.updated_at)),
      h("button.al-button.al-button--sm.al-button--quiet", { type: "button", "aria-label": `Edit note ${note.label}`, onclick: open }, "Edit")));
  }

  function render() {
    fill(list,
      editing === "new" ? editor(null) : null,
      notes.length || editing === "new"
        ? notes.map((n) => (editing === n.id ? editor(n) : card(n)))
        : q || tag
          ? emptyState("No notes match", "Try other words, or another tag.")
          : emptyState("No notes yet", "Notes here are about the search as a whole: what you want next, what you've learned, who to ask.",
            h("button.al-button.al-button--primary", { type: "button", onclick: () => { editing = "new"; render(); } }, "Write a note")));
  }

  page.append(
    h("header.al-page-head", {}, h("h1", {}, "Notes"),
      h("p.al-page-head__lede", {}, "About the search as a whole, not one application: what you want next, what you've learned, who to ask."),
      h("div.al-page-head__end", {},
        h("button.al-button.al-button--primary", { type: "button", onclick: () => { editing = "new"; render(); } }, icon("plus"), h("span", {}, "New note")))),
    h("div.list-tools", {}, searchBox(search), TAGS.length ? tagFilter(tag, (t) => { tag = t; load(); }) : null),
    list);
  fill(view, page);
  await load();
}
