// General notes (/notes): thoughts about the search, not one application.
// A note reads as text; clicking it edits it in place.

import { useEffect, useRef, useState } from "react";
import { attempt, del, enc, get, patch, post } from "../lib/api";
import { fmtStamp } from "../lib/format";
import { S, useShared } from "../lib/state";
import { tagNames } from "../lib/tags";
import { toast } from "../lib/toast";
import type { Row } from "../lib/types";
import { confirmDelete } from "../components/dialogs";
import { TagChip, TagEditor, TagFilter } from "../components/tags";
import { RichText, RichView } from "../components/RichText";
import { toPlain } from "../lib/rich";
import { EmptyState, Icon, Input, LoadingBlock, SearchBox } from "../components/ui";

export function NotesPage() {
  useShared();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [notes, setNotes] = useState<Row[] | null>(null);
  const [version, setVersion] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const load = () => setVersion((n) => n + 1);
  useEffect(() => {
    get(`memos?q=${enc(query)}${tag ? `&tag=${enc(tag)}` : ""}`).then(setNotes).catch((e) => toast(e.message, "error"));
  }, [query, tag, version]);
  const done = () => { setEditing(null); load(); };
  const card = (note: Row) => {
    const open = () => setEditing(note.id);
    // The system's interactive card: a click anywhere opens it; its one
    // control, Edit, is how the keyboard does.
    return (
      <article key={note.id} className="al-card al-card--interactive note-card" onClick={(e) => { if (!(e.target as Element).closest("a, button")) open(); }}>
        {note.title ? <h2>{note.title}</h2> : null}
        <RichView className="note-body" value={note.body} />
        <footer>
          {tagNames(note.tags).map((t) => <TagChip key={t} name={t} />)}
          <time className="muted small" dateTime={note.updated_at} title={`Written ${fmtStamp(note.created_at)}`}>{fmtStamp(note.updated_at)}</time>
          <button className="al-button al-button--sm al-button--quiet" type="button" aria-label={`Edit note ${note.label}`} onClick={open}>Edit</button>
        </footer>
      </article>
    );
  };
  const list = notes || [];
  return (
    <div className="page notes-page">
      <header className="al-page-head">
        <h1>Notes</h1>
        <p className="al-page-head__lede">About the search as a whole, not one application: what you want next, what you've learned, who to ask.</p>
        <div className="al-page-head__end">
          <button className="al-button al-button--primary" type="button" onClick={() => setEditing("new")}><Icon name="plus" /><span>New note</span></button>
        </div>
      </header>
      <div className="list-tools">
        <SearchBox placeholder="Search notes" aria-label="Search notes" value={q}
          onValue={(v) => { setQ(v); clearTimeout(timer.current); timer.current = setTimeout(() => setQuery(v), 150); }} />
        {S.TAGS.length ? <TagFilter current={tag} onPick={setTag} /> : null}
      </div>
      <div className="notes-grid">
        {editing === "new" ? <NoteEditor note={null} done={done} cancel={() => setEditing(null)} /> : null}
        {notes == null ? <LoadingBlock tall={3} lines={0} /> : list.length || editing === "new"
          ? list.map((n) => (editing === n.id ? <NoteEditor key={n.id} note={n} done={done} cancel={() => setEditing(null)} /> : card(n)))
          : query || tag
            ? <EmptyState title="No notes match" text="Try other words, or another tag." />
            : <EmptyState title="No notes yet" text="Notes here are about the search as a whole: what you want next, what you've learned, who to ask."
              action={<button className="al-button al-button--primary" type="button" onClick={() => setEditing("new")}>Write a note</button>} />}
      </div>
    </div>
  );
}

function NoteEditor({ note, done, cancel }: { note: Row | null; done: () => void; cancel: () => void }) {
  const [title, setTitle] = useState(note?.title || "");
  // What's written, as the editor has it now (it saves from inside, too).
  const body = useRef(note?.body || "");
  const save = async () => {
    if (!toPlain(body.current).trim()) { toast("Write something first", "error"); return; }
    const fields = { title: title.trim() || null, body: body.current };
    const saved = await attempt(() => (note ? patch(`memos/${note.id}`, fields) : post("memos", fields)));
    if (saved) { toast(note ? "Saved" : "Note added"); done(); }
  };
  return (
    <article className="al-card note-card editing" onKeyDown={(e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); }
      if (e.key === "Escape") cancel();
    }}>
      <Input aria-label="Title" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
      <RichText value={note?.body} label="Note" placeholder="Write anything…" rows={Math.max(6, (note?.body || "").split("\n").length + 1)} autoFocus
        onChange={(html) => { body.current = html; }} onSave={save} onEscape={cancel} />
      {note ? <TagEditor resource="memos" rec={note} /> : null}
      <div className="actions">
        {note ? <button className="al-button al-button--sm al-button--quiet al-button--danger" type="button" onClick={async () => {
          if (!(await confirmDelete(`note “${note.label}”`))) return;
          if (await attempt(() => del(`memos/${note.id}`))) { toast("Deleted"); done(); }
        }}>Delete</button> : null}
        <span className="spacer" />
        <button className="al-button" type="button" onClick={cancel}>Cancel</button>
        <button className="al-button al-button--primary" type="button" onClick={save}>{note ? "Save" : "Add note"}</button>
      </div>
    </article>
  );
}
