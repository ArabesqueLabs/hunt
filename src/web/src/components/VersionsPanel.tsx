// A document's versions, newest first, next to a preview of the chosen one;
// editing, their tags and notes as fields, and delete.

import { Fragment, useEffect, useState } from "react";
import { attempt, del, get, patch } from "../lib/api";
import { fmtSize, fmtStamp } from "../lib/format";
import { R } from "../lib/meta";
import { toast } from "../lib/toast";
import type { Row } from "../lib/types";
import { confirmDelete } from "./dialogs";
import { FieldControl } from "./fields";
import { FileDrop, Preview, uploadVersion } from "./files";
import { TagChip } from "./tags";
import { Input } from "./ui";

export function VersionsPanel({ doc, after = () => {}, versionId = null, editing = false }: { doc: Row; after?: () => void; versionId?: number | null; editing?: boolean }) {
  const [versions, setVersions] = useState<Row[] | null>(null);
  const [uses, setUses] = useState<Map<number, Row[]>>(new Map());
  const [shown, setShown] = useState<number | null>(null);
  const [uploading, setUploading] = useState(editing);
  const [tag, setTag] = useState("");
  const [note, setNote] = useState("");
  const [version, setVersion] = useState(0);
  const rerender = () => { setVersion((n) => n + 1); after(); };
  useEffect(() => {
    (async () => {
      const list: Row[] = await get(`versions?document_id=${doc.id}`);
      const used = await Promise.all(list.map((v) => get(`versions/${v.id}/uses`)));
      setUses(new Map(list.map((v, i) => [v.id, used[i]])));
      setVersions(list);
      // The version asked for (from a link), or the newest.
      setShown((s) => s ?? list[Math.max(0, list.findIndex((v) => v.id === versionId))]?.id ?? null);
    })().catch(() => {});
  }, [doc.id, version]);
  if (!versions) return <section className="al-panel panel doc-versions" />;
  const vr = R("versions");
  const f = (n: string) => vr.fields.find((x) => x.name === n)!;
  const v = versions.find((x) => x.id === shown) || null;
  const next = versions.length ? Math.max(...versions.map((x) => x.number)) + 1 : 1;
  return (
    <section className="al-panel panel doc-versions">
      <div className="doc-list">
        {editing ? null : (
          <button className="al-button al-button--quiet app-add" type="button" onClick={() => setUploading(!uploading)}>
            {uploading ? "Close" : `+ Upload version ${next}`}
          </button>
        )}
        {/* Uploading: open in Edit mode, behind its button when reading. */}
        <div className="upload" hidden={!uploading}>
          <FileDrop multiple label={`Drop version ${next} here, or choose it`} onFiles={async (files) => {
            const made = await attempt(async () => {
              const out: Row[] = [];
              for (const file of files) out.push(await uploadVersion(doc.id, file, { tag: tag.trim(), note: note.trim() }));
              return out;
            });
            if (made) { toast(`Uploaded ${made.map((m) => `v${m.number}`).join(", ")}`); rerender(); }
          }} />
          <div className="upload-meta">
            <Input aria-label="Tag for the new version" placeholder="Tag, e.g. rust-focused" value={tag} onChange={(e) => setTag(e.target.value)} />
            <Input aria-label="Note for the new version" placeholder="What changed" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <p className="muted small">Set a tag or note first if you like; they go with the next file you drop.</p>
        </div>
        {versions.length ? (
          <ol className="versions">
            {versions.map((x) => {
              const sent = uses.get(x.id) || [];
              return (
                <li key={x.id} className={`version${x.id === shown ? " selected" : ""}`}>
                  <button className="version-head" type="button" onClick={() => setShown(x.id)} aria-label={`Preview version ${x.number}`}>
                    <b>{`v${x.number}`}</b><span className="version-name">{x.filename}</span>
                    <span className="muted">{`${fmtSize(x.size)} · ${fmtStamp(x.created_at)}`}</span>
                  </button>
                  {/* Reading: its tag and note; editing: them as fields, and delete. */}
                  {editing
                    ? <div className="fields">{["tag", "note"].map((n) => <FieldControl key={n} resource="versions" field={f(n)} value={x[n]} save={async (val) => { await patch(`versions/${x.id}`, { [n]: val }); after(); }} />)}</div>
                    : x.tag || x.note ? <p className="small">{x.tag ? <TagChip name={x.tag} /> : null}{x.note ? ` ${x.note}` : null}</p> : null}
                  <div className="version-foot">
                    {sent.length
                      ? <span className="small muted">Sent with {sent.map((u, i) => <Fragment key={u.id}>{i ? ", " : ""}<a href={`/p/${u.id}`}>{u.label}</a></Fragment>)}</span>
                      : <span className="small muted">Not sent with anything yet</span>}
                    {editing ? (
                      <button className="al-button al-button--icon al-button--sm al-button--danger" type="button" aria-label={`Delete version ${x.number}`} title="Delete version" onClick={async () => {
                        if (!(await confirmDelete(`version ${x.number}`))) return;
                        if (await attempt(() => del(`versions/${x.id}`))) { toast("Version deleted"); rerender(); }
                      }}>×</button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : <p className="muted">No versions yet.</p>}
      </div>
      <div className="preview-pane">
        {v ? <>
          <div className="preview-bar">
            <b>{`v${v.number}`}</b>{` ${v.filename}`}
            <span className="spacer" />
            <a className="al-button al-button--sm" href={`/api/versions/${v.id}/file`} target="_blank" rel="noopener">Open in a tab</a>
            <a className="al-button al-button--sm" href={`/api/versions/${v.id}/file?download=1`}>Download</a>
          </div>
          <Preview v={v} />
        </> : <div className="preview-none"><p>Upload a file to see it here.</p></div>}
      </div>
    </section>
  );
}
