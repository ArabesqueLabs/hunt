// Record lists: companies, people and files, and Contacts (companies and
// people together); and the pages for new ones.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { attempt, del, enc, get, post } from "../lib/api";
import { LOC, fmtDay, fmtMoney, fmtSize } from "../lib/format";
import { LISTS, LIST_LEDES } from "../lib/lists";
import { R, optionLabel } from "../lib/meta";
import { go } from "../lib/router";
import { S, useShared } from "../lib/state";
import { store } from "../lib/storage";
import { tagNames } from "../lib/tags";
import { toast } from "../lib/toast";
import type { Row } from "../lib/types";
import { BulkBar, RecordActions, SelectAllCell, SelectCell } from "../components/bulk";
import { useColumns } from "../components/columns";
import { confirmDelete } from "../components/dialogs";
import { CreateForm, FieldControl, GbpLine, setField } from "../components/fields";
import { FileDrop, acceptFiles, guessKind, stem, uploadVersion, useFileDrop } from "../components/files";
import { IMPORTED, logoFromImport, openImport, personFromProfile, refreshFromLinkedIn } from "../components/importer";
import { newApplication } from "../components/NewApplication";
import { TagChip, TagFilter } from "../components/tags";
import { Icon, Input, LoadingRows, Logo, Notice, Photo, SearchBox, Select, Table } from "../components/ui";
import { NewRecordPage } from "./Record";

/**
 * A listing row's actions: edit (its page, in Edit mode) and remove; and,
 * given `onRefresh`, refresh (from its LinkedIn link).
 */
export function RowIcons({ what, editHref, onRemove, onRefresh }: { what: string; editHref: string; onRemove: () => void; onRefresh?: (() => void) | null }) {
  return (
    <td className="row-icons">
      {onRefresh ? <button className="al-button al-button--icon al-button--sm" type="button" aria-label={`Refresh ${what} from LinkedIn`} title="Refresh from LinkedIn" onClick={onRefresh}><Icon name="refresh" /></button> : null}
      <a className="al-button al-button--icon al-button--sm" href={editHref} aria-label={`Edit ${what}`} title="Edit"><Icon name="edit" /></a>
      <button className="al-button al-button--icon al-button--sm al-button--danger" type="button" aria-label={`Remove ${what}`} title="Remove" onClick={onRemove}><Icon name="remove" /></button>
    </td>
  );
}

/** Contacts: everyone and every company, or one of them. */
function ContactsSwitch({ current }: { current: string }) {
  return (
    <div className="al-segmented" role="group" aria-label="Show">
      {([["all", "All", "/contacts"], ["companies", "Companies", "/companies"], ["people", "People", "/people"]] as [string, string, string][]).map(([k, l, path]) => (
        <button key={k} type="button" aria-pressed={String(k === current) as "true" | "false"} onClick={() => { store("contacts", k); go(path); }}>{l}</button>
      ))}
    </div>
  );
}

/** A search box's value, and the same a moment after the typing stops. */
function useSearch(delay = 150) {
  const [q, setQ] = useState("");
  const [settled, setSettled] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const set = (v: string) => { setQ(v); clearTimeout(timer.current); timer.current = setTimeout(() => setSettled(v), delay); };
  return [q, settled, set] as const;
}

/** A document's row: a file dropped on it becomes its next version. */
function DropRow({ rec, onDone, children, ...rest }: { rec: Row; onDone: () => void; children: ReactNode } & React.ComponentProps<"tr">) {
  const drop = useFileDrop(async (files) => {
    const made = await attempt(async () => {
      const out: Row[] = [];
      for (const f of files) out.push(await uploadVersion(rec.id, f));
      return out;
    });
    if (made) { toast(`Uploaded ${made.map((v) => v.label).join(", ")}`); onDone(); }
  });
  return <tr {...rest} {...drop.props} className={drop.over ? "file-over" : undefined}>{children}</tr>;
}

export function ListPage({ page }: { page: string }) {
  useShared();
  const { resource, columns: cols } = LISTS[page];
  const r = R(resource) as Row;
  const [q, settled, setQ] = useSearch();
  const [tag, setTag] = useState("");
  // Files: of one kind, or all.
  const kindField = resource === "documents" ? r.fields.find((f: Row) => f.name === "kind") : null;
  const [kind, setKind] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [companies, setCompanies] = useState<Map<number, Row> | null>(null);
  const [version, setVersion] = useState(0);
  const load = () => setVersion((n) => n + 1);
  // Rows selected (by id), to tag, untag or delete together.
  const [sel] = useState(() => new Set<number>());
  const [, bump] = useState(0);
  const redraw = () => bump((n) => n + 1);
  const contacts = ["companies", "people"].includes(page);
  const columns = useColumns(page, [{ name: "select", label: "", fixed: true }, { name: "Name", label: "Name", fixed: true },
    ...cols.map(([k, l]) => ({ name: k, label: l })), { name: "tags", label: "Tags" }, { name: "Actions", label: "Actions", fixed: true }]);
  useEffect(() => { if (contacts) store("contacts", page); }, [contacts, page]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const list: Row[] = await get(`${resource}?q=${enc(settled)}${tag ? `&tag=${enc(tag)}` : ""}${kind ? `&kind=${enc(kind)}` : ""}`);
      // Applications and people belong to companies: show whose logo.
      const cos = ["applications", "people"].includes(resource) ? new Map<number, Row>((await get("companies")).map((c: Row) => [c.id, c])) : null;
      if (resource === "documents") {
        // Each document's newest version, and how many there are.
        const versions: Row[] = await get("versions");
        for (const d of list) {
          const mine = versions.filter((v) => v.document_id === d.id);
          d.versions = mine.length;
          d.latest = mine.reduce<Row | null>((a, v) => (!a || v.number > a.number ? v : a), null);
        }
      }
      if (!alive) return;
      // Selected rows stay to those shown.
      const ids = list.map((rec) => rec.id);
      for (const k of [...sel]) if (!ids.includes(k)) sel.delete(k);
      setCompanies(cos);
      setRows(list);
    })().catch((e) => toast(e.message, "error"));
    return () => { alive = false; };
  }, [resource, settled, tag, kind, version, sel]);
  const shownIds = (rows || []).map((rec) => rec.id);
  const cell = (rec: Row, key: string): ReactNode => {
    if (key === "salary") {
      const pay = fmtMoney(rec.salary_min, rec.salary_max, rec.currency, rec.pay_period);
      return pay ? <>{pay}{" "}<GbpLine a={rec} /></> : rec.comp || "";
    }
    if (key === "created_at") return fmtDay(rec.created_at.slice(0, 10));
    if (key === "latest") return rec.latest ? <><a href={`/files/${rec.id}?version=${rec.latest.id}`}>{`v${rec.latest.number}`}</a>{` ${rec.latest.filename} · ${fmtDay(rec.latest.created_at.slice(0, 10))}`}</> : <span className="muted">none yet</span>;
    if (key === "versions") return rec.versions ?? 0;
    const f = r.fields.find((x: Row) => x.name === key);
    const v = rec[key];
    if (v == null) return "";
    if (f && f.type === "enum") return optionLabel(f.options, v);
    if (f && f.type === "url") return <a href={v} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{v.replace(/^https?:\/\//, "")}</a>;
    return v;
  };
  const nameCell = (rec: Row) => {
    if (resource === "people") return <span className="with-logo"><Photo id={rec.id} photo={rec.photo} name={rec.name} size={24} /><b>{rec.label}</b></span>;
    const co = resource === "companies" ? rec : companies?.get(rec.company_id);
    return co ? <span className="with-logo"><Logo id={co.id} logo={co.logo} name={co.name} size={22} /><b>{rec.label}</b></span> : <b>{rec.label}</b>;
  };
  const row = (rec: Row) => {
    const props = {
      tabIndex: 0, "aria-selected": sel.has(rec.id) ? "true" as const : undefined,
      onClick: (e: React.MouseEvent) => { if (!(e.target as Element).closest("a, button, .row-select")) go(`/${page}/${rec.id}`); },
      onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" && e.target === e.currentTarget) go(`/${page}/${rec.id}`); },
    };
    const cells = <>
      <SelectCell sel={sel} id={rec.id} keys={() => shownIds} changed={redraw} label={rec.label} />
      <td>{nameCell(rec)}</td>
      {cols.map(([k]) => <td key={k}>{cell(rec, k)}</td>)}
      <td className="tags-cell">{tagNames(rec.tags).map((t) => <TagChip key={t} name={t} />)}</td>
      <RowIcons what={rec.label} editHref={`/${page}/${rec.id}?edit=1`} onRemove={async () => {
        const detail = ({ company: "Its applications must go first.", document: "All its versions go with it.", application: "Its processes on the board go with it." } as Record<string, string>)[r.entity];
        if (!(await confirmDelete(`${r.entity} ${rec.label}`, detail))) return;
        if (await attempt(() => del(`${resource}/${rec.id}`))) { toast("Deleted"); load(); }
      }} onRefresh={rec.linkedin && ["company", "person"].includes(r.entity) ? () => refreshFromLinkedIn(r.entity, rec, load) : null} />
    </>;
    return resource === "documents"
      ? <DropRow key={rec.id} rec={rec} onDone={load} {...props}>{cells}</DropRow>
      : <tr key={rec.id} {...props}>{cells}</tr>;
  };
  return (
    <div className="page list-page" data-list={page}>
      <header className="al-page-head">
        <h1>{contacts ? "Contacts" : r.title}</h1>
        {LIST_LEDES[contacts ? "contacts" : page] ? <p className="al-page-head__lede">{LIST_LEDES[contacts ? "contacts" : page]}</p> : null}
        <div className="al-page-head__end">
          <button className="al-button al-button--primary" type="button" onClick={() => (resource === "applications" ? newApplication() : go(`/${page}/new`))}>
            <Icon name="plus" /><span>{resource === "documents" ? "New document" : `New ${r.entity}`}</span></button>
        </div>
      </header>
      <div className="list-tools">
        {contacts ? <ContactsSwitch current={page} /> : null}
        <SearchBox placeholder={`Search ${r.title.toLowerCase()}`} aria-label="Search" value={q} onValue={setQ} />
        {kindField ? (
          <Select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All kinds</option>
            {kindField.options.map(([v, l]: [string, string]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        ) : null}
        {S.TAGS.length ? <TagFilter current={tag} onPick={setTag} /> : null}
      </div>
      {columns.style}
      {columns.bar}
      <div className="al-table-wrap">
        <Table className="al-table--interactive" data-columns={page}>
          <thead>
            <tr>
              <SelectAllCell sel={sel} keys={shownIds} changed={redraw} />
              <th>Name</th>
              {cols.map(([k, l]) => <th key={k} data-col={k} className={columns.thClass(k)}>{l}{columns.hide(k)}</th>)}
              <th data-col="tags" className={columns.thClass("tags")}>Tags{columns.hide("tags")}</th>
              <th className="row-icons">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows == null ? <LoadingRows cols={cols.length + 4} /> : rows.length ? rows.map(row)
              : <tr><td className="muted" colSpan={cols.length + 4}>{q || tag || kind ? "No matches." : `No ${r.title.toLowerCase()} yet.`}</td></tr>}
          </tbody>
        </Table>
      </div>
      {/* Taking files in comes after the files. */}
      {resource === "documents" ? (
        <FileDrop multiple label="Drop files here, or choose them"
          hint="A file named like a document (cv.pdf → “cv”) becomes its next version; anything else becomes a new document. Drop on a row to add a version to that document."
          onFiles={async (files) => {
            const done = await attempt(() => acceptFiles(files));
            if (done) { toast(`Uploaded ${done.join(", ")}`); load(); }
          }} />
      ) : null}
      <BulkBar count={sel.size} clear={() => { sel.clear(); redraw(); }}
        actions={<RecordActions resource={resource} ids={() => [...sel]} after={() => { sel.clear(); load(); }} />} />
    </div>
  );
}

/** Contacts, all together: companies and people in one list, by name. */
export function ContactsPage() {
  useShared();
  const [q, settled, setQ] = useSearch();
  const [tag, setTag] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => { store("contacts", "all"); }, []);
  useEffect(() => {
    let alive = true;
    (async () => {
      const query = `q=${enc(settled)}${tag ? `&tag=${enc(tag)}` : ""}`;
      const [companies, people] = await Promise.all([get(`companies?${query}`), get(`people?${query}`)]);
      const byId = new Map<number, Row>((await get("companies")).map((c: Row) => [c.id, c]));
      const list = [
        ...companies.map((c: Row) => ({ key: `c${c.id}`, kind: "Company", href: `/companies/${c.id}`, name: c.name, pic: <Logo id={c.id} logo={c.logo} name={c.name} size={22} />,
          about: [c.industry, c.size].filter(Boolean).join(" · "), where: c.headquarters, tags: tagNames(c.tags) })),
        ...people.map((p: Row) => ({ key: `p${p.id}`, kind: "Person", href: `/people/${p.id}`, name: p.name, pic: <Photo id={p.id} photo={p.photo} name={p.name} size={22} />,
          about: [p.title, byId.get(p.company_id)?.name].filter(Boolean).join(" · "), where: p.location, tags: tagNames(p.tags) })),
      ].sort((a, b) => a.name.localeCompare(b.name, LOC(), { sensitivity: "base" }));
      if (alive) setRows(list);
    })().catch((e) => toast(e.message, "error"));
    return () => { alive = false; };
  }, [settled, tag]);
  return (
    <div className="page list-page" data-list="contacts">
      <header className="al-page-head">
        <h1>Contacts</h1>
        <p className="al-page-head__lede">{LIST_LEDES.contacts}</p>
        <div className="al-page-head__end">
          <button className="al-button" type="button" onClick={() => go("/people/new")}><Icon name="plus" /><span>New person</span></button>
          <button className="al-button al-button--primary" type="button" onClick={() => go("/companies/new")}><Icon name="plus" /><span>New company</span></button>
        </div>
      </header>
      <div className="list-tools">
        <ContactsSwitch current="all" />
        <SearchBox placeholder="Search companies and people" aria-label="Search" value={q} onValue={setQ} />
        {S.TAGS.length ? <TagFilter current={tag} onPick={setTag} /> : null}
      </div>
      <div className="al-table-wrap">
        <Table className="al-table--interactive">
          <thead><tr><th>Name</th><th>Kind</th><th>About</th><th>Where</th><th>Tags</th></tr></thead>
          <tbody>
            {rows == null ? <LoadingRows cols={5} /> : rows.length ? rows.map((x) => (
              <tr key={x.key} tabIndex={0} onClick={(e) => { if (!(e.target as Element).closest("a")) go(x.href); }} onKeyDown={(e) => { if (e.key === "Enter") go(x.href); }}>
                <td><span className="with-logo">{x.pic}<a className="table-app" href={x.href} translate="no"><b>{x.name}</b></a></span></td>
                <td>{x.kind}</td>
                <td translate="no">{x.about}</td>
                <td translate="no">{x.where || ""}</td>
                <td className="tags-cell">{x.tags.map((t: string) => <TagChip key={t} name={t} />)}</td>
              </tr>
            )) : <tr><td className="muted" colSpan={5}>{q || tag ? "No matches." : "No contacts yet."}</td></tr>}
          </tbody>
        </Table>
      </div>
    </div>
  );
}

// ---- new records ---------------------------------------------------------------------

/** The page for a new one of a list's records. */
export function NewRecord({ page }: { page: string }) {
  const r = R(LISTS[page].resource);
  if (r.entity === "document") return <NewDocument />;
  if (r.entity === "company") return <NewCompany />;
  if (r.entity === "person") return <NewPerson />;
  return (
    <NewRecordPage page={page}>
      <CreateForm resource={r.name} onCreated={(made) => { toast(`Added ${made.label}`); go(`/${page}/${made.id}`); }} />
    </NewRecordPage>
  );
}

/** A new company, optionally filled in from its website or LinkedIn page. */
function NewCompany() {
  const form = useRef<HTMLFormElement>(null);
  const foundLogo = useRef<string | null>(null);
  const current = () => Object.fromEntries(IMPORTED.map((k) => {
    const c = form.current?.querySelector<HTMLInputElement>(`[data-field="${k}"] input, [data-field="${k}"] textarea`);
    return [k, c && c.value ? c.value : null];
  }));
  return (
    <NewRecordPage page="companies">
      <div className="import-bar">
        <button className="al-button" type="button" onClick={() => openImport({
          current: current(),
          apply: (fields) => {
            const { logo, ...rest } = fields;
            foundLogo.current = logo || foundLogo.current;
            for (const [k, v] of Object.entries(rest)) setField(form.current, k, v);
            if (logo) toast("The logo is added with the company");
          },
        })}>Import from website or LinkedIn…</button>
        <span className="muted small">Fills in the form; nothing is saved until you add the company.</span>
      </div>
      <CreateForm resource="companies" submitLabel="Add company" formRef={form} onCreated={async (made) => {
        if (foundLogo.current) await logoFromImport(made.id, foundLogo.current);
        toast(`Added ${made.label}`);
        go(`/companies/${made.id}`);
      }} />
    </NewRecordPage>
  );
}

/** A new person, by hand or from their LinkedIn profile. */
function NewPerson() {
  const link = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<ReactNode>(null);
  useEffect(() => { link.current?.focus(); }, []);
  return (
    <NewRecordPage page="people">
      <p className="muted">From their LinkedIn profile: name, headline, company, location, photo.</p>
      <form className="profile-add" onSubmit={async (e) => {
        e.preventDefault();
        const url = (link.current?.value || "").trim();
        if (!url) return;
        setStatus(<p className="muted small">Reading the profile…</p>);
        try {
          const found = await post("people/lookup", { url });
          const person = await personFromProfile(found);
          toast(`Added ${person.name}`);
          go(`/people/${person.id}`);
        } catch (err) {
          setStatus(<Notice kind="danger" className="small" role="alert">{`${(err as Error).message}`}</Notice>);
        }
      }}>
        <div className="inline-add"><Input type="url" ref={link} aria-label="LinkedIn profile" placeholder="https://www.linkedin.com/in/…" /><button className="al-button al-button--primary" type="submit">Import</button></div>
        <div className="posting-preview" aria-live="polite">{status}</div>
      </form>
      <div className="application-form"><div className="or"><span>or fill in</span></div></div>
      <CreateForm resource="people" submitLabel="Add person" onCreated={(made) => { toast(`Added ${made.label}`); go(`/people/${made.id}`); }} />
    </NewRecordPage>
  );
}

function NewDocument() {
  const r = R("documents");
  const values = useRef<Row>({});
  const fields = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<File | null>(null);
  return (
    <NewRecordPage page="files">
      <form className="create" onSubmit={async (e) => {
        e.preventDefault();
        const made = await attempt(() => post("documents", values.current));
        if (!made) return;
        if (file && !(await attempt(() => uploadVersion(made.id, file)))) return;
        toast(`Added ${made.label}`);
        go(`/files/${made.id}`);
      }}>
        <FileDrop label="Drop the first version here, or choose it" onFiles={([f]) => {
          setFile(f);
          const name = fields.current?.querySelector<HTMLInputElement>('[data-field="name"] input');
          if (name && !name.value) { name.value = stem(f.name); values.current.name = stem(f.name); }
          const kind = fields.current?.querySelector<HTMLSelectElement>('[data-field="kind"] select');
          if (kind && !values.current.kind) { kind.value = guessKind(f.name); values.current.kind = kind.value; }
        }} />
        <p className="small">{file ? `First version: ${file.name} (${fmtSize(file.size)})` : "No file yet: you can add one later."}</p>
        <div className="fields" ref={fields}>
          {r.fields.map((f) => <FieldControl key={f.name} resource="documents" field={f} value={values.current[f.name]} quiet save={(v) => { values.current[f.name] = v; }} />)}
        </div>
        <div className="actions"><button className="al-button al-button--primary" type="submit">Add document</button></div>
      </form>
    </NewRecordPage>
  );
}
