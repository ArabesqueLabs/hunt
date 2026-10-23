// Rich text: TinyMCE on a textarea, writing the direction the page reads
// (right to left in Arabic) unless the text says otherwise; and rich text
// shown, cleaned. lib/rich.ts says how it's kept.

import { useEffect, useRef } from "react";
import { CATALOGS, LANG, t } from "../lib/i18n";
import { clean, isRich, toHtml } from "../lib/rich";

interface Editor {
  getContent(): string;
  setContent(html: string): void;
  focus(): void;
  remove(): void;
  on(events: string, f: (e: KeyboardEvent) => void): void;
}
interface TinyMCE { init(options: Record<string, unknown>): Promise<Editor[]>; addI18n(code: string, words: Record<string, string>): void }

/** The editor's own words that show (its toolbar, the link dialog), in the page's language. */
const EDITOR_WORDS = ["Bold", "Italic", "Bullet list", "Numbered list", "Blockquote", "Insert/edit link", "Insert/Edit Link", "Clear formatting",
  "URL", "Text to display", "Title", "Open link in...", "Current window", "New window", "Save", "Cancel", "Remove link", "Open link", "Undo", "Redo"];

/** The page's typefaces (its @font-face rules), for the editor's frame, which has none of its own. */
const fontFaces = () => [...document.styleSheets].flatMap((sheet) => { try { return [...sheet.cssRules]; } catch { return []; } })
  .filter((r) => r instanceof CSSFontFaceRule).map((r) => r.cssText).join("\n");

// The editor's script, loaded once, the first time one opens: at the
// address app.js has, fingerprinted the same.
let loading: Promise<TinyMCE> | null = null;
const loadEditor = () => {
  loading ??= import(/* @vite-ignore */ `/editor.js${new URL(import.meta.url).search}`).then((m) => m.default as TinyMCE);
  return loading;
};

/** Whether the page is drawn dark: chosen, or as the system is. */
const isDark = () => {
  const chosen = document.documentElement.dataset.theme;
  return chosen ? chosen === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
};

/**
 * A rich text editor in place of a textarea. `value` is where it starts
 * (plain text opens as paragraphs). `onChange(html)` as it's written;
 * `onCommit(html)` as it's left, changed (as a field's change does).
 * `onSave` and `onEscape`: ⌘S or Ctrl+S, and Escape, inside it. Until
 * the editor has loaded, the textarea itself takes the typing.
 */
export function RichText({ id, value, label, placeholder, rows = 6, onChange, onCommit, onSave, onEscape, autoFocus = false }: {
  id?: string; value: string | null | undefined; label: string; placeholder?: string; rows?: number;
  onChange?: (html: string) => void; onCommit?: (html: string) => void; onSave?: () => void; onEscape?: () => void; autoFocus?: boolean;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const editor = useRef<Editor | null>(null);
  const handlers = useRef({ onChange, onCommit, onSave, onEscape });
  handlers.current = { onChange, onCommit, onSave, onEscape };
  useEffect(() => {
    const el = area.current!;
    let alive = true;
    let committed = el.value;
    const emit = () => handlers.current.onChange?.(editor.current ? editor.current.getContent() : el.value);
    const commit = () => {
      const now = editor.current ? editor.current.getContent() : el.value;
      if (now !== committed) { committed = now; handlers.current.onCommit?.(now); }
    };
    // Set from outside, as a field is (an import filling the form in): into the editor too.
    const outside = () => {
      if (editor.current && el.value !== editor.current.getContent()) editor.current.setContent(toHtml(el.value));
      emit();
      commit();
    };
    el.addEventListener("change", outside);
    const style = getComputedStyle(document.body);
    // Prose reads in the page's serif, as it shows once saved.
    const serif = getComputedStyle(document.documentElement).getPropertyValue("--al-font-serif") || style.fontFamily;
    loadEditor().then((tinymce) => {
      if (!alive) return null;
      // Another language: the editor's words in it, and its toolbar the way it reads.
      const language = LANG !== "en" && CATALOGS[LANG] ? LANG : undefined;
      if (language) tinymce.addI18n(language, { _dir: CATALOGS[LANG].dir, ...Object.fromEntries(EDITOR_WORDS.map((w) => [w, t(w)])) });
      return tinymce.init({
        target: el,
        license_key: "gpl",
        skin: isDark() ? "oxide-dark" : "oxide",
        content_css: isDark() ? "dark" : "default",
        // The text runs as the page does: right to left in Arabic.
        directionality: document.documentElement.dir === "rtl" ? "rtl" : "ltr",
        language,
        menubar: false,
        statusbar: false,
        branding: false,
        promotion: false,
        plugins: "autolink autoresize link lists",
        toolbar: "bold italic | bullist numlist | blockquote link | removeformat",
        min_height: Math.max(140, rows * 28),
        autoresize_bottom_margin: 16,
        link_default_target: "_blank",
        link_target_list: false,
        convert_urls: false,
        // Only what rich text is shown with (lib/rich.ts): nothing else is kept.
        valid_elements: "p,br,strong/b,em/i,u,s,a[href|target|rel],ul,ol,li,h2,h3,h4,blockquote,code,pre",
        entity_encoding: "raw",
        placeholder: placeholder && t(placeholder),
        iframe_aria_text: t(label),
        content_style: `${fontFaces()}\nbody { font-family: ${serif}; font-size: ${style.fontSize}; line-height: 1.6; margin: 0.75rem; }`,
        setup: (ed: Editor) => {
          ed.on("input change undo redo", emit);
          ed.on("blur", commit);
          ed.on("keydown", (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "s" && handlers.current.onSave) { e.preventDefault(); commit(); handlers.current.onSave(); }
            else if (e.key === "Escape" && handlers.current.onEscape) { e.preventDefault(); handlers.current.onEscape(); }
          });
        },
      });
    }).then((made) => {
      if (!made) return;
      if (!alive) { made[0]?.remove(); return; }
      editor.current = made[0];
      committed = editor.current.getContent();
      if (autoFocus) editor.current.focus();
    }).catch(() => { /* the textarea stays, and still works */ });
    return () => {
      alive = false;
      el.removeEventListener("change", outside);
      editor.current?.remove();
      editor.current = null;
    };
  }, []);
  return (
    <div className="rich-editor">
      <textarea ref={area} id={id} className="al-textarea" rows={rows} aria-label={label} placeholder={placeholder} defaultValue={toHtml(value)} autoFocus={autoFocus}
        onInput={(e) => handlers.current.onChange?.(e.currentTarget.value)} />
    </div>
  );
}

/** Rich text shown: the editor's HTML, cleaned; plain text as it was written. */
export function RichView({ value, className, as: Tag = "div" }: { value: string | null | undefined; className?: string; as?: "div" | "dd" }) {
  if (isRich(value)) return <Tag className={`${className ? `${className} ` : ""}rich`} translate="no" dangerouslySetInnerHTML={{ __html: clean(value as string) }} />;
  return <Tag className={className} translate="no">{value}</Tag>;
}
