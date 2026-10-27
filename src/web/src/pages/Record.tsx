// Pages for companies, people and documents (/companies/ID, /people/ID,
// /files/ID), made like the application page: they read first; Edit turns
// the details into a form saved together, or discarded. Tags and what's done
// to the whole record (import, picture, delete) are at the end. New ones
// have pages too (/companies/new …).

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { attempt, del, get, patch, put } from "../lib/api";
import { fmtDay, fmtSize, fmtStamp } from "../lib/format";
import { LISTS } from "../lib/lists";
import { R, closedWhy, optionLabel, reloadTags } from "../lib/meta";
import { go, route, setLeaveGuard, settle } from "../lib/router";
import { baseTitle } from "../lib/shell";
import { store, stored } from "../lib/storage";
import { toPlain } from "../lib/rich";
import { tagNames } from "../lib/tags";
import { toast } from "../lib/toast";
import type { ResourceDef, Row } from "../lib/types";
import { ActivityPanel } from "../components/activity";
import { confirmDelete } from "../components/dialogs";
import { FieldControl, RecordView, fieldLayout } from "../components/fields";
import { FileDrop, Preview, uploadVersion, useFilePicker } from "../components/files";
import { applyToCompany, applyToPerson, companyImport, openImport, personImport, refreshFromLinkedIn } from "../components/importer";
import { ColourTagChip, TagChip, TagEditor } from "../components/tags";
import { Icon, Input, LoadingPage, Logo, Notice, Photo } from "../components/ui";
import { RichView } from "../components/RichText";
import { VersionsPanel } from "../components/VersionsPanel";

/** The editable fields of a resource. */
const editableFields = (r: ResourceDef) => r.fields.filter((f) => !f.readonly);

/** Load the page again, as it is (nothing unsaved to lose). */
const reload = () => { setLeaveGuard(null); route(); };

interface Loaded { rec: Row; profile: Row | null; doc: { versions: Row[]; uses: Map<number, Row[]> } | null }

export function RecordPage({ page, id, editing = false, versionId = null }: { page: string; id: number; editing?: boolean; versionId?: number | null }) {
  const r = R(LISTS[page].resource);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      let rec: Row;
      try { rec = await get(`${r.name}/${id}`); } catch (e) { setError((e as Error).message); return; }
      let profile: Row | null = null;
      let doc: Loaded["doc"] = null;
      if (r.entity === "document") {
        // A document, read: its preview in the main column, the rest beside it.
        const versions: Row[] = (await get(`versions?document_id=${id}`)).sort((a: Row, b: Row) => b.number - a.number);
        const uses = await Promise.all(versions.map((v) => get(`versions/${v.id}/uses`)));
        doc = { versions, uses: new Map(versions.map((v, i) => [v.id, uses[i]])) };
      } else if (r.entity === "company") {
        const [apps, people, board] = await Promise.all([get(`applications?company_id=${id}`), get(`people?company_id=${id}`), get("board?archived_since=")]);
        const cards = [...board.stages.flatMap((st: Row) => st.cards), ...board.archived].sort((x: Row, y: Row) => y.created_at.localeCompare(x.created_at));
        profile = { apps, people, cards };
      } else if (r.entity === "person") {
        const company = rec.company_id ? await get(`companies/${rec.company_id}`).catch(() => null) : null;
        profile = { company };
      }
      setData({ rec, profile, doc });
      document.title = `${rec.label} · ${baseTitle()}`;
    })().catch((e) => toast(e.message, "error"));
  }, [r.name, r.entity, id]);
  if (error) return <div className="page"><Notice kind="danger" role="alert">{error}</Notice><a href={`/${page}`}>{`← ${r.title}`}</a></div>;
  if (!data) return <LoadingPage kind="detail" />;
  return <Record page={page} id={id} r={r} loaded={data} editing={editing} versionId={versionId} />;
}

function Record({ page, id, r, loaded, editing, versionId }: { page: string; id: number; r: ResourceDef; loaded: Loaded; editing: boolean; versionId: number | null }) {
  const { rec, profile, doc } = loaded;
  const keys = editableFields(r).map((f) => f.name);
  const [edit, setEditing] = useState(editing);
  const orig = useRef({ fields: Object.fromEntries(keys.map((k) => [k, rec[k] ?? null])), tags: tagNames(rec.tags) });
  const [draft, setDraft] = useState(() => structuredClone(orig.current));
  const [formKey, setFormKey] = useState(0);
  const [addingTag, setAddingTag] = useState(false);
  const [shown, setShown] = useState<number | null>(() => doc ? (doc.versions.find((v) => v.id === versionId) || doc.versions[0])?.id ?? null : null);
  const [uploading, setUploading] = useState(false);
  const pageEl = useRef<HTMLDivElement>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const dirty = () => edit && JSON.stringify(draftRef.current) !== JSON.stringify(orig.current);
  useEffect(() => {
    setLeaveGuard(() => dirty());
    window.onbeforeunload = (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ""; } };
  });
  useEffect(() => () => { window.onbeforeunload = null; }, []);
  const setEdit = (on: boolean) => {
    if (!on && dirty() && !confirm("Discard your changes?")) return;
    setEditing(on);
    setDraft(structuredClone(orig.current));
    setFormKey((k) => k + 1);
  };
  useEffect(() => {
    if (edit) pageEl.current?.querySelector<HTMLElement>(".record-form input, .record-form select, .record-form textarea")?.focus();
  }, [edit]);
  const picture = r.entity === "company" ? "logo" : r.entity === "person" ? "photo" : null;
  const pickPicture = useFilePicker("image/*", async (f) => {
    const res = await fetch(`/api/${r.name}/${id}/${picture}`, { method: "PUT", headers: { "Content-Type": f.type || "application/octet-stream" }, body: f });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { toast(out.error || "Couldn't use that image", "error"); return; }
    toast(`The ${picture} is updated`);
    reload();
  });
  const removePicture = async () => {
    if (await attempt(() => del(`${r.name}/${id}/${picture}`))) { toast(`The ${picture} is removed`); reload(); }
  };
  const tagsSaved = (saved: string[]) => { rec.tags = saved; orig.current.tags = saved; setDraft((d) => ({ ...d, tags: [...saved] })); };

  async function save() {
    const d = draftRef.current;
    const changed = Object.fromEntries(keys.filter((k) => (d.fields[k] ?? null) !== (orig.current.fields[k] ?? null)).map((k) => [k, d.fields[k]]));
    const done = await attempt(async () => {
      if (Object.keys(changed).length) await patch(`${r.name}/${id}`, changed);
      if ((r as Row).taggable && JSON.stringify(d.tags) !== JSON.stringify(orig.current.tags)) {
        await put(`${r.name}/${id}/tags`, { tags: d.tags });
        await reloadTags();
      }
      return true;
    });
    if (done) { toast("Saved"); reload(); }
  }
  const importer = () => rec.linkedin
    ? <button className="al-button" type="button" onClick={() => refreshFromLinkedIn(r.entity, rec, reload)}>Refresh from LinkedIn</button>
    : <button className="al-button" type="button" onClick={() => openImport({
      kind: r.entity === "company" ? companyImport : personImport,
      url: r.entity === "company" ? rec.website || "" : "",
      current: rec,
      apply: async (fields, found) => {
        const done = r.entity === "company" ? await applyToCompany(id, fields) : await applyToPerson(id, fields, found);
        if (done) { toast("Imported"); reload(); }
      },
    })}>Import from link…</button>;
  const deleteIt = async (to: string, detail?: string) => {
    if (!(await confirmDelete(`${r.entity} ${rec.label}`, detail))) return;
    if (await attempt(() => del(`${r.name}/${id}`))) { setLeaveGuard(null); toast("Deleted"); go(to); }
  };
  const panel = (key: string, title: string, { count, action }: { count?: number; action?: ReactNode } = {}, ...body: ReactNode[]) => (
    <section key={key} className="al-panel app-panel" data-section={key} aria-labelledby={`panel-${key}`}>
      <div className="app-panel-head"><h2 id={`panel-${key}`}>{title}</h2>{count != null ? <span className="al-badge al-badge--count">{count}</span> : null}
        {action ? <div className="app-panel-tools">{action}</div> : null}</div>
      {body}
    </section>
  );
  // Each application's stage: its newest active process's, or else its newest one's, archived.
  const stageOf = (a: Row) => {
    const mine = (profile!.cards as Row[]).filter((c) => c.application_id === a.id);
    const c = mine.find((x) => x.status === "active") || mine[0];
    if (!c) return <span className="al-badge">Not on the board</span>;
    return c.status === "active"
      ? <span className="al-badge al-badge--accent">{c.stage}</span>
      : <span className="al-badge" title={c.archive_note || ""}>{`${c.reached_stage || c.stage} · ${closedWhy(c)}`}</span>;
  };

  // ---- a document, read --------------------------------------------------------------
  function documentLayout() {
    const { versions, uses } = doc!;
    const v = versions.find((x) => x.id === shown) || null;
    const kind = optionLabel(r.fields.find((f) => f.name === "kind")!.options, rec.kind);
    const show = (x: Row) => {
      setShown(x.id);
      history.replaceState(null, "", `/${page}/${id}?version=${x.id}`);
      settle();
    };
    const next = versions.length ? versions[0].number + 1 : 1;
    return <>
      <a className="al-back-link" href={`/${page}`}>Files</a>
      <header className="al-page-head app-page-head">
        <span className="logo doc-icon" aria-hidden="true">▤</span>
        <div className="app-titles"><h1 translate="no">{rec.label}</h1>
          <div className="app-sub"><span>{kind}</span><span aria-hidden="true">·</span><span>{versions.length === 1 ? "1 version" : `${versions.length} versions`}</span></div></div>
        <div className="al-page-head__end">
          <button className="al-button al-button--quiet" type="button" onClick={() => setEdit(true)}><Icon name="edit" /><span>Edit details</span></button>
          <button className="al-button al-button--primary" type="button" onClick={() => { setUploading(true); setTimeout(() => pageEl.current?.querySelector<HTMLElement>(".doc-upload input[type=file]")?.focus()); }}>
            <Icon name="plus" /><span>{`Upload version ${next}`}</span></button>
        </div>
      </header>
      <div className="app-layout">
        <div className="app-main">
          {panel("preview", v ? `Version ${v.number}` : "Preview", {
            action: v ? <>
              <a className="al-button al-button--sm" href={`/api/versions/${v.id}/file`} target="_blank" rel="noopener">Open in a tab</a>
              <a className="al-button al-button--sm" href={`/api/versions/${v.id}/file?download=1`}><Icon name="download" /><span>Download</span></a>
            </> : null,
          }, v ? <Fragment key="v"><p className="muted small doc-shown" translate="no">{v.filename}{" · "}{fmtSize(v.size)}{" · "}{fmtStamp(v.created_at)}</p><Preview v={v} /></Fragment>
            : <div key="none" className="preview-none"><p>Upload a file to see it here.</p></div>)}
          <ActivityPanel url={`activity?entity=${r.entity}&entity_id=${id}`} />
        </div>
        <aside className="app-aside" aria-label="About this file">
          {panel("details", "Details", {},
            <dl key="facts" className="app-facts">
              <dt>Kind</dt><dd>{kind}</dd>
              <dt>Versions</dt><dd>{String(versions.length)}</dd>
              {v ? <><dt>Latest</dt><dd>{`v${versions[0].number} · ${fmtDay(versions[0].created_at.slice(0, 10))}`}</dd></> : null}
              <dt>Added</dt><dd>{fmtDay(rec.created_at.slice(0, 10))}</dd>
            </dl>,
            rec.description ? <RichView key="desc" className="doc-description" value={rec.description} /> : null)}
          {panel("versions", "Versions", {
            count: versions.length,
            action: <button className="al-button al-button--quiet al-button--sm" type="button" aria-expanded={String(uploading) as "true" | "false"} onClick={() => setUploading(!uploading)}>
              {uploading ? "Cancel" : <><Icon name="plus" /><span>{`Upload version ${next}`}</span></>}</button>,
          },
          uploading ? <DocUpload key="upload" id={id} next={next} /> : null,
          versions.length ? (
            <ol key="list" className="doc-version-list">
              {versions.map((x) => {
                const sent = uses.get(x.id) || [];
                return (
                  <li key={x.id}>
                    <button className="doc-version" type="button" aria-current={x.id === v?.id ? "true" : undefined} onClick={() => show(x)}>
                      <span className="doc-version-head"><b>{`v${x.number}`}</b><span className="doc-version-name" translate="no">{x.filename}</span></span>
                      <span className="muted small">{`${fmtSize(x.size)} · ${fmtDay(x.created_at.slice(0, 10))}`}</span>
                      {x.tag || x.note ? <span className="small doc-version-note">{x.tag ? <TagChip name={x.tag} /> : null}{x.note ? <span translate="no">{` ${toPlain(x.note)}`}</span> : null}</span> : null}
                    </button>
                    <span className="small muted doc-version-sent">{sent.length
                      ? <>Sent with {sent.map((u, i) => <Fragment key={u.id}>{i ? ", " : ""}<a href={`/p/${u.id}`}>{u.label}</a></Fragment>)}</>
                      : "Not sent with anything yet"}</span>
                  </li>
                );
              })}
            </ol>
          ) : <p key="none" className="muted small">No versions yet.</p>)}
          {panel("tags", "Tags", {}, <TagEditor key="tags" resource={r.name} rec={rec} onChange={tagsSaved} />)}
          <div className="app-delete">
            <button className="al-button al-button--danger al-button--quiet al-button--sm" type="button" onClick={() => deleteIt(`/${page}`, "All its versions go with it.")}>Delete file</button>
          </div>
        </aside>
      </div>
    </>;
  }

  // ---- a company or a person, read ----------------------------------------------------
  // What they're about and what's theirs in the main column, the facts
  // beside it, as an application's page has it.
  function profileLayout() {
    const long = r.fields.filter((f) => f.type === "long-text");
    const pic = picture === "logo" ? <Logo id={id} logo={rec.logo} name={rec.name} size={48} /> : <Photo id={id} photo={rec.photo} name={rec.name} size={48} />;
    const sub = r.entity === "company"
      ? [rec.industry, rec.headquarters].filter(Boolean).map((x, i) => <span key={i} translate="no">{x}</span>)
      : [rec.title ? <span key="t" translate="no">{rec.title}</span> : null,
        profile!.company ? <a key="c" href={`/companies/${profile!.company.id}`} translate="no">{profile!.company.name}</a> : null,
        rec.location ? <span key="l" translate="no">{rec.location}</span> : null].filter(Boolean);
    // The main column: what they're about, and what's theirs.
    const about = long.filter((f) => rec[f.name]).map((f) => panel(f.name, f.label, {}, <RichView key="p" className="prose profile-prose" value={rec[f.name]} />));
    const main: ReactNode[] = [...about];
    if (!about.length) main.push(panel("about", "About", {}, <p key="p" className="muted small">Nothing written yet. <button className="al-button al-button--quiet al-button--sm" type="button" onClick={() => setEdit(true)}>Add something</button></p>));
    if (r.entity === "company") {
      const { apps, people } = profile as { apps: Row[]; people: Row[] };
      main.push(panel("applications", "Applications", { count: apps.length },
        apps.length ? (
          <ul key="l" className="viz-list company-apps">
            {apps.map((a) => (
              <li key={a.id}><Logo id={id} logo={rec.logo} name={rec.name} size={22} />
                <div className="company-app"><a href={`/applications/${a.id}`} translate="no">{a.title || a.label}</a>
                  <div className="company-app-meta">{stageOf(a)}{tagNames(a.tags).map((t) => <TagChip key={t} name={t} />)}</div></div>
                <span className="muted small">{fmtDay(a.created_at.slice(0, 10))}</span></li>
            ))}
          </ul>
        ) : <p key="n" className="muted small">None yet.</p>));
      main.push(panel("company-people", "People", { count: people.length },
        people.length ? (
          <ul key="l" className="viz-list">
            {people.map((p) => <li key={p.id}><Photo id={p.id} photo={p.photo} name={p.name} size={22} /><a href={`/people/${p.id}`} translate="no">{p.name}</a><span className="muted small" translate="no">{p.title || ""}</span></li>)}
          </ul>
        ) : <p key="n" className="muted small">Nobody yet.</p>));
    }
    main.push(<ActivityPanel key="log" url={`activity?entity=${r.entity}&entity_id=${id}`} />);
    const has = picture && rec[picture];
    return <>
      <a className="al-back-link" href="/contacts">Contacts</a>
      <header className="al-page-head app-page-head">{pic}
        <div className="app-titles"><h1 translate="no">{rec.label}</h1>
          {sub.length ? <div className="app-sub">{sub.map((x, i) => <Fragment key={i}>{i ? <span aria-hidden="true">·</span> : null}{x}</Fragment>)}</div> : null}</div>
        <div className="al-page-head__end">
          <button className="al-button al-button--quiet" type="button" onClick={() => setEdit(true)}><Icon name="edit" /><span>Edit details</span></button>
          {importer()}
        </div>
      </header>
      <div className="app-layout">
        <div className="app-main">{main}</div>
        <aside className="app-aside" aria-label={r.entity === "company" ? "About this company" : "About this person"}>
          {/* Beside it: the facts, the picture, tags, and deleting. */}
          {panel("details", "Details", {}, <RecordView key="v" resource={r.name} record={rec} skip={["name", ...long.map((f) => f.name)]} />)}
          {panel("picture", picture === "logo" ? "Logo" : "Photo", {},
            <div key="p" className="profile-picture">{picture === "logo" ? <Logo id={id} logo={rec.logo} name={rec.name} size={64} /> : <Photo id={id} photo={rec.photo} name={rec.name} size={64} />}
              <div className="cycle-actions">{pickPicture.input}
                <button className="al-button al-button--sm" type="button" onClick={pickPicture.open}>{has ? `Change ${picture}` : `Upload a ${picture}`}</button>
                {has ? <button className="al-button al-button--quiet al-button--sm" type="button" onClick={removePicture}>{`Remove ${picture}`}</button> : null}
              </div></div>)}
          {(r as Row).taggable ? panel("tags", "Tags", {}, <TagEditor key="t" resource={r.name} rec={rec} onChange={tagsSaved} />) : null}
          <div className="app-delete">
            <button className="al-button al-button--danger al-button--quiet al-button--sm" type="button"
              onClick={() => deleteIt("/contacts", ({ company: "Its applications must go first." } as Record<string, string>)[r.entity])}>{`Delete ${r.entity}`}</button>
          </div>
        </aside>
      </div>
    </>;
  }

  // ---- editing (and a record that's neither) --------------------------------------------
  function section(key: string, title: string, count: number | null, body: ReactNode) {
    let folds: Record<string, boolean> = {};
    try { folds = JSON.parse(stored("appFolds") || "{}"); } catch { folds = {}; }
    return (
      <details key={key} className="al-disclosure app-section" open={!(folds[key] ?? false)} data-section={key}
        onToggle={(e) => { if (e.target === e.currentTarget) { folds[key] = !e.currentTarget.open; store("appFolds", JSON.stringify(folds)); } }}>
        <summary><h2>{title}{count != null ? <span className="count">{count}</span> : null}</h2></summary>
        <div className="app-section-body">{body}</div>
      </details>
    );
  }
  function related() {
    const out: ReactNode[] = [];
    if (r.entity === "company" && profile) {
      const { apps, people } = profile as { apps: Row[]; people: Row[] };
      out.push(section("applications", "Applications", apps.length, apps.length ? (
        <ul className="viz-list company-apps">{apps.map((a) => (
          <li key={a.id}><Logo id={id} logo={rec.logo} name={rec.name} size={22} />
            <div className="company-app"><a href={`/applications/${a.id}`}>{a.title || a.label}</a>
              <div className="company-app-meta">{stageOf(a)}{tagNames(a.tags).map((t) => <TagChip key={t} name={t} />)}</div></div>
            <span className="muted small">{fmtDay(a.created_at.slice(0, 10))}</span></li>
        ))}</ul>
      ) : <p className="muted small">None yet.</p>));
      out.push(section("company-people", "People", people.length, people.length ? (
        <ul className="viz-list">{people.map((p) => <li key={p.id}><Photo id={p.id} photo={p.photo} name={p.name} size={22} /><a href={`/people/${p.id}`}>{p.name}</a><span className="muted small">{p.title || ""}</span></li>)}</ul>
      ) : <p className="muted small">Nobody yet.</p>));
    }
    // A document's versions follow the mode: read, or edited.
    if (r.entity === "document") out.push(section("versions", "Versions", null, <div className="versions-slot"><VersionsPanel key={String(edit)} doc={rec} versionId={versionId} editing={edit} /></div>));
    out.push(<ActivityPanel key="log" url={`activity?entity=${r.entity}&entity_id=${id}`} />);
    return out;
  }
  function footer() {
    let tags: ReactNode = null;
    if ((r as Row).taggable) {
      tags = edit
        ? <>{draft.tags.map((t) => (
          <TagChip key={t} name={t}><button className="al-tag__remove" type="button" aria-label={`Remove tag ${t}`}
            onClick={() => setDraft({ ...draft, tags: draft.tags.filter((x) => x !== t) })}>×</button></TagChip>
        ))}<DraftTagInput onAdd={(t) => {
          if (t && !draft.tags.some((x) => x.toLowerCase() === t.toLowerCase())) setDraft((d) => ({ ...d, tags: [...d.tags, t] }));
        }} /></>
        : <>{tagNames(rec.tags).map((t) => <ColourTagChip key={t} name={t} />)}
          {addingTag ? <Input className="tag-input" aria-label="New tag" placeholder="A tag, then Enter" autoFocus onKeyDown={async (e) => {
            const add = e.currentTarget;
            if (e.key === "Escape") { setAddingTag(false); return; }
            if (e.key !== "Enter" || !add.value.trim()) return;
            e.preventDefault();
            const saved = await attempt(() => put(`${r.name}/${id}/tags`, { tags: [...tagNames(rec.tags), add.value.trim()] }));
            if (saved) { tagsSaved(saved); setAddingTag(false); await reloadTags(); }
          }} /> : <button className="al-button al-button--quiet app-add" type="button" onClick={() => setAddingTag(true)}>+ Add tag</button>}</>;
    }
    const tools: ReactNode[] = [];
    if (!edit && (r.entity === "company" || r.entity === "person")) tools.push(<Fragment key="import">{importer()}</Fragment>);
    if (!edit && picture) {
      const has = rec[picture];
      tools.push(<Fragment key="pick">{pickPicture.input}<button className="al-button" type="button" onClick={pickPicture.open}>{has ? `Change ${picture}` : `Upload a ${picture}`}</button></Fragment>);
      if (has) tools.push(<button key="rm" className="al-button" type="button" onClick={removePicture}>{`Remove ${picture}`}</button>);
    }
    return (
      <section className="app-section app-footer">
        {tags ? <div className="app-tags"><span className="eyebrow">Tags</span>{tags}</div> : null}
        {edit ? null : (
          <div className="actions">
            {tools}
            <span className="spacer" />
            <button className="al-button al-button--quiet al-button--danger" type="button"
              onClick={() => deleteIt(`/${page}`, ({ company: "Its applications must go first.", document: "All its versions go with it." } as Record<string, string>)[r.entity])}>{`Delete ${r.entity}`}</button>
          </div>
        )}
      </section>
    );
  }
  const head = () => {
    const pic = picture === "logo" ? <Logo id={id} logo={rec.logo} name={rec.name} size={48} />
      : picture === "photo" ? <Photo id={id} photo={rec.photo} name={rec.name} size={48} />
        : <span className="logo doc-icon" aria-hidden="true">▤</span>;
    return (
      <header className="app-head">
        {pic}
        <div className="app-title"><h1>{rec.label}</h1></div>
        <div className="app-mode">
          <div className="al-segmented" role="group" aria-label="Mode">
            <button type="button" aria-pressed={String(!edit) as "true" | "false"} onClick={() => edit && setEdit(false)}>View</button>
            <button type="button" aria-pressed={String(edit) as "true" | "false"} onClick={() => !edit && setEdit(true)}>Edit</button>
          </div>
          {edit ? <>
            <button className="al-button" type="button" onClick={() => setEdit(false)}>Discard</button>
            <button className="al-button al-button--primary" type="button" onClick={save}>✓ Save changes</button>
          </> : null}
        </div>
      </header>
    );
  };
  const details = () => {
    // The name is the heading already.
    if (!edit) return <div className="app-section app-role"><RecordView resource={r.name} record={rec} skip={["name"]} /></div>;
    return (
      <div className="app-section app-role record-form" key={formKey}>
        <div className="fields">{fieldLayout(editableFields(r), (f, label) => (
          <FieldControl resource={r.name} field={f} value={draft.fields[f.name]} label={label} quiet
            save={(v) => { draftRef.current.fields[f.name] = v; setDraft({ ...draftRef.current, fields: { ...draftRef.current.fields } }); }} />
        ))}</div>
      </div>
    );
  };
  const reading = !!(doc || profile) && !edit;
  return (
    <div className={`page application record-page${reading ? " reading" : ""}`} ref={pageEl}
      onKeyDown={(e) => { if (edit && (e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); } }}>
      {reading ? (doc ? documentLayout() : profileLayout()) : <>
        <nav className="crumbs" aria-label="Back to"><a href={`/${page}`}>{`← ${r.title}`}</a></nav>
        <article className={`al-card app${edit ? " editing" : ""}`}>
          {head()}
          <div className="app-sections">{details()}{related()}{footer()}</div>
        </article>
      </>}
    </div>
  );
}

/** A document's next version, dropped or chosen, with a tag and note. */
function DocUpload({ id, next }: { id: number; next: number }) {
  const [tag, setTag] = useState("");
  const [note, setNote] = useState("");
  return (
    <div className="upload doc-upload">
      <FileDrop multiple label={`Drop version ${next} here, or choose it`} onFiles={async (files) => {
        const made = await attempt(async () => {
          const out: Row[] = [];
          for (const file of files) out.push(await uploadVersion(id, file, { tag: tag.trim(), note: note.trim() }));
          return out;
        });
        if (made) {
          toast(`Uploaded ${made.map((m) => `v${m.number}`).join(", ")}`);
          history.replaceState(null, "", `${location.pathname}?version=${made[made.length - 1].id}`);
          reload();
        }
      }} />
      <div className="upload-meta">
        <Input aria-label="Tag for the new version" placeholder="Tag, e.g. rust-focused" value={tag} onChange={(e) => setTag(e.target.value)} />
        <Input aria-label="Note for the new version" placeholder="What changed" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <p className="muted small">Set a tag or note first if you like; they go with the next file you drop.</p>
    </div>
  );
}

/** A tag to add to the draft: Enter or a comma adds it, and so does leaving it. */
function DraftTagInput({ onAdd }: { onAdd: (t: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const add = () => {
    const el = ref.current!;
    const t = el.value.trim();
    el.value = "";
    onAdd(t);
    el.focus();
  };
  return <Input className="tag-input" ref={ref} aria-label="Add a tag" placeholder="Add a tag…"
    onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }}
    onBlur={() => { if (ref.current?.value.trim()) add(); }} />;
}

/** A page for something new: a company, a person or a document. */
export function NewRecordPage({ page, children }: { page: string; children: ReactNode }) {
  const r = R(LISTS[page].resource);
  const title = r.entity === "document" ? "New document" : `New ${r.entity}`;
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => { el.current?.querySelector<HTMLElement>("article input, article select, article textarea")?.focus(); }, []);
  return (
    <div className="page application record-page" ref={el}>
      <nav className="crumbs" aria-label="Back to"><a href={`/${page}`}>{`← ${r.title}`}</a></nav>
      <article className="al-card app">
        <header className="app-head no-pic"><div className="app-title"><h1>{title}</h1></div></header>
        <div className="app-sections">{children}</div>
      </article>
    </div>
  );
}
