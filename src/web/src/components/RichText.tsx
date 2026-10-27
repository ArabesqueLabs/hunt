// Rich text: Lexical on an element of its own, under a toolbar drawn here,
// writing the direction the page reads (right to left in Arabic) unless the
// text says otherwise; and rich text shown, cleaned. lib/rich.ts says how
// it's kept.

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Action, Formats, RichEditor } from "../editor";
import { clean, isRich, toHtml } from "../lib/rich";
import { ask } from "./dialogs";
import { Input, PathIcon } from "./ui";

type EditorModule = { createEditor: typeof import("../editor").createEditor };

// The editor's script, loaded once, the first time one opens: at the
// address app.js has, fingerprinted the same.
let loading: Promise<EditorModule> | null = null;
const loadEditor = () => {
  loading ??= import(/* @vite-ignore */ `/editor.js${new URL(import.meta.url).search}`) as Promise<EditorModule>;
  return loading;
};

/** The toolbar: what each button does, its name, and its icon. */
const TOOLS: [Action, string, string][] = [
  ["bold", "Bold", "M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"],
  ["italic", "Italic", "M19 4h-9M14 20H5M15 4 9 20"],
  ["bullet", "Bullet list", "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"],
  ["number", "Numbered list", "M10 6h10M10 12h10M10 18h10M4 4.5h1.5V9M4 9h3M4 14.5a1.5 1.5 0 0 1 3 0c0 1.5-3 2-3 4h3"],
  ["quote", "Blockquote", "M17 6H3M21 12H8M21 18H8M3 12v6"],
];
const LINK = "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7";
const CLEAR = "M4 7V4h16v3M9 20h6M12 4l-4 16M3 3l18 18";

const pressed = (f: Formats, a: Action) => (a === "bullet" || a === "number" ? f.list === a : a === "quote" ? f.quote : a === "clear" ? false : f[a]);

/**
 * A rich text editor. `value` is where it starts (plain text opens as
 * paragraphs). `onChange(html)` as it's written; `onCommit(html)` as it's
 * left, changed (as a field's change does). ⌘K or Ctrl+K links. Until the
 * editor has loaded, a textarea takes the typing; one set from outside (an
 * import filling the form in) sets the editor too.
 */
export function RichText({ id, value, label, placeholder, rows = 6, onChange, onCommit, autoFocus = false }: {
  id?: string; value: string | null | undefined; label: string; placeholder?: string; rows?: number;
  onChange?: (html: string) => void; onCommit?: (html: string) => void; autoFocus?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const editor = useRef<RichEditor | null>(null);
  const committed = useRef("");
  // Whether the cursor goes into the editor once it shows.
  const focusOnReady = useRef(false);
  const [formats, setFormats] = useState<Formats | null>(null);
  const handlers = useRef({ onChange, onCommit });
  handlers.current = { onChange, onCommit };
  const now = () => (editor.current ? editor.current.getContent() : area.current!.value);
  // What's written, where lib/unsaved.ts looks for it.
  const mark = (html: string) => wrap.current?.setAttribute("data-rich", html);
  const commit = () => {
    const html = now();
    if (html !== committed.current) { committed.current = html; handlers.current.onCommit?.(html); }
  };
  useEffect(() => {
    const el = area.current!;
    let alive = true;
    committed.current = el.value;
    // Set from outside, as a field is: into the editor too.
    const outside = () => {
      editor.current?.setContent(toHtml(el.value));
      mark(now());
      handlers.current.onChange?.(now());
      commit();
    };
    el.addEventListener("change", outside);
    loadEditor().then(({ createEditor }) => {
      if (!alive) return;
      focusOnReady.current = autoFocus || document.activeElement === el;
      editor.current = createEditor(root.current!, {
        html: el.value,
        onChange: (html) => { mark(html); handlers.current.onChange?.(html); },
        onFormats: setFormats,
      });
      committed.current = editor.current.getContent();
      mark(committed.current);
    }).catch(() => { /* the textarea stays, and still works */ });
    return () => {
      alive = false;
      el.removeEventListener("change", outside);
      editor.current?.remove();
      editor.current = null;
    };
  }, []);
  const ready = formats != null;
  useEffect(() => {
    if (ready && focusOnReady.current) { focusOnReady.current = false; editor.current?.focus(); }
  }, [ready]);
  const linkIt = async () => {
    const was = formats?.link || "";
    const answer = await ask({ title: "Insert/edit link", ok: "Save", body: <Input name="url" inputMode="url" aria-label="URL" placeholder="https://" defaultValue={was} autoFocus /> });
    if (!answer) { editor.current?.focus(); return; }
    const url = String(answer.get("url") || "").trim();
    editor.current?.link(url ? (/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`) : null);
  };
  const keys = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k" && editor.current) { e.preventDefault(); linkIt(); }
    // Saving with ⌘S (a note does) saves what's written up to now.
    else if ((e.metaKey || e.ctrlKey) && e.key === "s") commit();
  };
  const tool = (a: Action, name: string, d: string, on: boolean, act = () => editor.current?.act(a)) => (
    <button key={a} type="button" className="al-button al-button--sm al-button--quiet al-button--icon" aria-label={name} title={name}
      aria-pressed={a === "clear" ? undefined : (String(on) as "true" | "false")}
      // The cursor stays in the text as a button is pressed.
      onMouseDown={(e) => e.preventDefault()} onClick={act}><PathIcon d={d} /></button>
  );
  return (
    <div className="rich-editor" ref={wrap} data-ready={ready ? "" : undefined} onKeyDown={keys}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commit(); }}>
      {ready ? (
        <div className="rich-editor-tools" role="toolbar" aria-label={`${label}: formatting`}>
          {TOOLS.map(([a, name, d]) => tool(a, name, d, pressed(formats, a)))}
          <button type="button" className="al-button al-button--sm al-button--quiet al-button--icon" aria-label="Insert/edit link" title="Insert/edit link"
            aria-pressed={String(!!formats.link) as "true" | "false"} onMouseDown={(e) => e.preventDefault()} onClick={linkIt}><PathIcon d={LINK} /></button>
          {tool("clear", "Clear formatting", CLEAR, false)}
        </div>
      ) : null}
      <div className="rich-editor-text">
        <div ref={root} id={ready ? id : undefined} className="rich" role="textbox" aria-multiline="true" aria-label={label}
          contentEditable={ready} suppressContentEditableWarning translate="no"
          hidden={!ready} style={{ minBlockSize: `${Math.max(140, rows * 28)}px` }} />
        {ready && formats.empty && placeholder ? <div className="rich-editor-placeholder" aria-hidden="true">{placeholder}</div> : null}
      </div>
      <textarea ref={area} id={ready ? undefined : id} className="al-textarea" rows={rows} aria-label={label} placeholder={placeholder}
        defaultValue={toHtml(value)} autoFocus={autoFocus} hidden={ready} tabIndex={ready ? -1 : undefined}
        onInput={(e) => { mark(e.currentTarget.value); handlers.current.onChange?.(e.currentTarget.value); }} />
    </div>
  );
}

/** Rich text shown: the editor's HTML, cleaned; plain text as it was written. */
export function RichView({ value, className, as: Tag = "div" }: { value: string | null | undefined; className?: string; as?: "div" | "dd" }) {
  if (isRich(value)) return <Tag className={`${className ? `${className} ` : ""}rich`} translate="no" dangerouslySetInnerHTML={{ __html: clean(value as string) }} />;
  return <Tag className={className} translate="no">{value}</Tag>;
}
