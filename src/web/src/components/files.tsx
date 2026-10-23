// Files: taking them in (dropped, or chosen), and previewing them.

import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { enc, get, post } from "../lib/api";
import type { Row } from "../lib/types";

/** Upload a file as the next version of a document. */
export async function uploadVersion(docId: number, file: File, { tag, note }: { tag?: string; note?: string } = {}) {
  const q = new URLSearchParams({ filename: file.name });
  if (tag) q.set("tag", tag);
  if (note) q.set("note", note);
  const res = await fetch(`/api/documents/${docId}/versions?${q}`, {
    method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${file.name}: ${data.error || res.statusText}`);
  return data;
}

export const stem = (filename: string) => filename.replace(/\.[^.]+$/, "").trim() || filename;

export function guessKind(filename: string) {
  const n = filename.toLowerCase();
  if (n.includes("cover")) return "cover-letter";
  if (/\b(cv|resume|résumé)\b|^cv|cv[-_ .]|resume/.test(n)) return "resume";
  if (n.includes("portfolio")) return "portfolio";
  if (/(^|[^a-z])nda([^a-z]|$)|non[-_ ]?disclosure|confidentiality/.test(n)) return "nda";
  if (/background[-_ ]?check|\bdbs\b|screening[-_ ]consent/.test(n)) return "background-check";
  if (/right[-_ ]to[-_ ]work|passport|\bvisa\b|\bbrp\b|share[-_ ]code|\bid[-_ ]card/.test(n)) return "right-to-work";
  if (n.includes("reference")) return "reference";
  if (/certificate|transcript|diploma|degree/.test(n)) return "certificate";
  if (/screen ?shot|screenshot|^screen[-_ ]|^img[-_]\d|^cleanshot/.test(n)) return "screenshot";
  if (/job[-_ ]?description|\bjd\b|^jd[-_ .]/.test(n)) return "job-description";
  if (/take[-_ ]?home|assignment|exercise|\bchallenge\b|case[-_ ]study/.test(n)) return "assignment";
  if (/\boffer\b|offer[-_ .]letter/.test(n)) return "offer";
  if (/contract|agreement|terms/.test(n)) return "contract";
  if (/feedback|review|debrief/.test(n)) return "feedback";
  if (/candidate|guide|prep|handbook|interview[-_ ]?(info|process)/.test(n)) return "candidate-resource";
  return "other";
}

/** Take in files: each becomes the next version of the document named like it, or a new document. */
export async function acceptFiles(files: File[]) {
  const done: string[] = [];
  for (const f of files) {
    const name = stem(f.name);
    const found = (await get(`documents?q=${enc(name)}`)).find((d: Row) => d.name.toLowerCase() === name.toLowerCase());
    const doc = found || (await post("documents", { name, kind: guessKind(f.name) }));
    const v = await uploadVersion(doc.id, f);
    done.push(v.label);
  }
  return done;
}

/**
 * Let files be dropped on an element: spread `props` on it; `over` while
 * files are held over it (its class, file-over).
 */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);
  const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types || [])].includes("Files");
  return {
    over,
    props: {
      onDragOver: (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); setOver(true); },
      onDragLeave: (e: DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); },
      onDrop: (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]);
      },
    },
  };
}

/** A drop zone with a file picker in it. */
export function FileDrop({ multiple = false, label, hint, onFiles }: { multiple?: boolean; label: string; hint?: string; onFiles: (files: File[]) => void }) {
  const id = useId();
  const drop = useFileDrop(onFiles);
  return (
    <div className={`dropzone${drop.over ? " file-over" : ""}`} {...drop.props}>
      <label className="al-label" htmlFor={id}>{label}</label>
      <input type="file" id={id} multiple={multiple} onChange={(e) => {
        const input = e.currentTarget;
        if (input.files?.length) onFiles([...input.files]);
        input.value = "";
      }} />
      {hint ? <p className="muted small">{hint}</p> : null}
    </div>
  );
}

/** A text file's text, loaded. */
function TextPreview({ url }: { url: string }) {
  const [text, setText] = useState("Loading…");
  useEffect(() => {
    fetch(url).then((r) => r.text()).then((t) => setText(t.length > 500000 ? `${t.slice(0, 500000)}\n…` : t))
      .catch(() => setText("Couldn't load it."));
  }, [url]);
  return <pre className="preview-text">{text}</pre>;
}

/** What a version looks like: the browser's own viewer where it has one. */
export function Preview({ v }: { v: Row }) {
  const url = `/api/versions/${v.id}/file`;
  const type = (v.content_type || "").split(";")[0].trim();
  if (type === "application/pdf") return <iframe className="preview-frame" src={url} title={`Preview of ${v.filename}`} />;
  if (type.startsWith("image/")) return <div className="preview-image"><img src={url} alt={`Preview of ${v.filename}`} /></div>;
  if (type.startsWith("text/") || type === "application/json") return <TextPreview url={url} />;
  return (
    <div className="preview-none">
      <p>{`The browser can't show ${v.filename} here.`}</p>
      <a className="al-button al-button--sm" href={`${url}?download=1`}>Download it</a>
    </div>
  );
}

/** A hidden file picker, opened by a button of the page's: `open()`. */
export function useFilePicker(accept: string, onFile: (f: File) => void) {
  const ref = useRef<HTMLInputElement>(null);
  return {
    open: () => ref.current?.click(),
    input: <input type="file" accept={accept} hidden ref={ref} onChange={(e) => {
      const f = e.currentTarget.files?.[0];
      e.currentTarget.value = "";
      if (f) onFile(f);
    }} />,
  };
}
