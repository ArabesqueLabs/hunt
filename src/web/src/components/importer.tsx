// Importing what a page says: a company's website or LinkedIn page, a
// person's LinkedIn profile, or a job posting; read, then chosen field by
// field. And the “Send to hunt” bookmark, which sends a profile from the
// browser.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { attempt, enc, get, patch, post } from "../lib/api";
import { R, optionLabel } from "../lib/meta";
import { toPlain } from "../lib/rich";
import { toast } from "../lib/toast";
import type { Row } from "../lib/types";
import { refSource } from "./fields";
import { Combo } from "./Combo";
import { ask, pushDialog } from "./dialogs";
import { Field, Input, Label, Logo, Notice, Photo, Table } from "./ui";

export const IMPORTED = ["logo", "name", "website", "linkedin", "industry", "size", "headquarters", "founded", "description"];
export const POSTING_FIELDS = [
  "title", "url", "location", "work_mode", "employment", "salary_min", "salary_max", "currency",
  "pay_period", "posted_on", "closes_on", "description",
];

export interface ImportKind {
  title: string;
  prompt: string;
  placeholder: string;
  endpoint: string;
  resource: string;
  keys: string[];
  hideLink?: boolean;
  whenUnread?: (url: string) => ReactNode;
}

/** What a company's page says: for openImport. */
export const companyImport: ImportKind = {
  title: "Import company details",
  prompt: "The company's website, or its LinkedIn page",
  placeholder: "acme.com or linkedin.com/company/acme",
  endpoint: "companies/lookup",
  resource: "companies",
  keys: IMPORTED,
};

/** What a LinkedIn profile says about someone: for openImport. */
export const personImport: ImportKind = {
  title: "Import from LinkedIn",
  prompt: "Their LinkedIn profile",
  placeholder: "https://www.linkedin.com/in/…",
  endpoint: "people/lookup",
  resource: "people",
  keys: ["photo", "name", "title", "company", "location", "linkedin", "about"],
  // LinkedIn often keeps profiles from anyone not signed in: then the
  // bookmark, on the profile in your browser, reads it instead.
  whenUnread: (url) => (/linkedin\.com\/in\//.test(url)
    ? <a className="al-button al-button--primary" href={url} target="_blank" rel="noreferrer">Open the profile ↗</a>
    : null),
};

/** What a job posting says: for openImport. */
export const postingImport: ImportKind = {
  title: "Import a job posting",
  prompt: "The job posting's link: Ashby, Greenhouse, Lever, Workable, LinkedIn, or a careers page",
  placeholder: "https://jobs.ashbyhq.com/acme/…",
  endpoint: "applications/lookup",
  resource: "applications",
  keys: POSTING_FIELDS,
};

/** Apply what an import chose to a company: the fields, then the logo, which is fetched. */
export async function applyToCompany(companyId: number, fields: Row) {
  const { logo, ...rest } = fields;
  if (Object.keys(rest).length && !(await attempt(() => patch(`companies/${companyId}`, rest)))) return false;
  if (logo && !(await attempt(() => post(`companies/${companyId}/logo/fetch`, { url: logo })))) return false;
  return true;
}

/** The company with this name, found or made, with its LinkedIn page if new. */
export async function companyNamed(name: string, linkedin?: string | null) {
  const found = (await get(`companies?q=${enc(name)}`)).find((c: Row) => c.name.toLowerCase() === name.toLowerCase());
  if (found) return found;
  return post("companies", linkedin ? { name, linkedin } : { name });
}

/** Apply what a profile import chose to a person: the fields, their company (by name), then the photo. */
export async function applyToPerson(personId: number, fields: Row, found: Row) {
  const { photo, company, ...rest } = fields;
  return attempt(async () => {
    if (company) rest.company_id = (await companyNamed(company, found.company_linkedin)).id;
    if (Object.keys(rest).length) await patch(`people/${personId}`, rest);
    if (photo) await post(`people/${personId}/photo/fetch`, { url: photo });
    return true;
  });
}

/**
 * The person a LinkedIn profile is about: the one already kept with that
 * profile (filling in what they're missing), or a new one.
 */
export async function personFromProfile(found: Row) {
  const existing = found.linkedin ? (await get(`people?linkedin=${enc(found.linkedin)}`))[0] : null;
  const fields: Row = {};
  for (const k of ["name", "title", "location", "linkedin", "about"]) if (found[k] && !(existing && existing[k])) fields[k] = found[k];
  if (found.company && !(existing && existing.company_id)) fields.company_id = (await companyNamed(found.company, found.company_linkedin)).id;
  const person = existing
    ? (Object.keys(fields).length ? await patch(`people/${existing.id}`, fields) : existing)
    : await post("people", fields);
  if (found.photo && !person.photo) {
    try { await post(`people/${person.id}/photo/fetch`, { url: found.photo }); } catch { /* no photo, no fuss */ }
  }
  return person;
}

export const looksLikeProfile = (s: string) => /linkedin\.com\/in\//i.test(s);

/** After an import names a logo, fetch it for the company if it has none. */
export async function logoFromImport(companyId: number | null | undefined, url: string | null | undefined) {
  if (!url || !companyId) return;
  try {
    const c = await get(`companies/${companyId}`);
    if (!c.logo) await post(`companies/${companyId}/logo/fetch`, { url });
  } catch { /* a logo that can't be had isn't worth a fuss */ }
}

/**
 * Read a company's or person's LinkedIn page again (the link they already
 * have) and choose what to take from it. `done()` once something changed.
 */
export function refreshFromLinkedIn(entity: string, rec: Row, done: () => void) {
  const kind = entity === "company" ? companyImport : personImport;
  openImport({
    kind: { ...kind, title: "Refresh from LinkedIn", hideLink: true },
    url: rec.linkedin,
    current: rec,
    apply: async (fields, found) => {
      const ok = entity === "company" ? await applyToCompany(rec.id, fields) : await applyToPerson(rec.id, fields, found);
      if (ok) { toast("Refreshed"); done(); }
    },
  });
}

interface ImportOptions {
  url?: string;
  /** The record as it is (or the form so far). */
  current?: Row;
  /** Gets the chosen fields. */
  apply: (fields: Row, found: Row) => unknown;
  kind?: ImportKind;
  /** Already read (sent by the bookmark): straight to choosing. */
  found?: Row | null;
}

/** Read a page and choose what to keep from it. */
export function openImport(opts: ImportOptions) {
  pushDialog({ className: "al-dialog al-dialog--md ask import", render: (close) => <ImportDialog {...opts} close={close} /> });
}

function ImportDialog({ url = "", current = {}, apply, kind = companyImport, found = null, close }: ImportOptions & { close: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReactNode>(null);
  const readPage = async () => {
    if (busy) return;
    setBusy(true);
    setResult(<p className="muted">Reading the page…</p>);
    const link = input.current?.value || url;
    try {
      review(await post(kind.endpoint, { url: link }));
    } catch (err) {
      // With no link to change (a refresh), what's left is to go, or close.
      setResult(<>
        <Notice kind="danger" role="alert">{(err as Error).message}</Notice>
        {kind.hideLink ? <div className="actions">{kind.whenUnread?.(link)}<button className="al-button" type="button" onClick={close}>Close</button></div> : null}
      </>);
    } finally {
      setBusy(false);
    }
  };
  function review(found: Row) {
    const keys = kind.keys.filter((k) => found[k] != null && found[k] !== "" && String(found[k] ?? "") !== String(current[k] ?? ""));
    if (!keys.length) { setResult(<p>Nothing new: the page says what's already here.</p>); return; }
    setResult(<ImportReview kind={kind} keys={keys} found={found} current={current} close={close} apply={apply} />);
  }
  useEffect(() => {
    if (found) { review(found); return; }
    input.current?.select();
    if (url) readPage();
  }, []);
  return (
    <div className="al-dialog__inner">
      <h2 className="al-dialog__title">{kind.title}</h2>
      {found || kind.hideLink ? null : (
        <form onSubmit={(e) => { e.preventDefault(); readPage(); }}>
          <Field>
            <Label htmlFor="import-url">{kind.prompt}</Label>
            <div className="inline-add">
              <Input type="url" id="import-url" ref={input} defaultValue={url} placeholder={kind.placeholder} required />
              <button className="al-button al-button--primary" type="submit" aria-busy={busy ? "true" : undefined}>Read it</button>
            </div>
          </Field>
        </form>
      )}
      <div className="import-result">{result}</div>
    </div>
  );
}

/** What a page says beside what's here, each field ticked to use it. */
function ImportReview({ kind, keys, found, current, close, apply }: { kind: ImportKind; keys: string[]; found: Row; current: Row; close: () => void; apply: ImportOptions["apply"] }) {
  const fields = R(kind.resource).fields;
  const [ticked, setTicked] = useState(() => new Set(keys.filter((k) => current[k] == null || current[k] === "")));
  const show = (k: string, v: any): ReactNode => {
    if (v == null || v === "") return <span className="muted">—</span>;
    if (k === "photo") {
      return String(v).startsWith("http")
        ? <img className="logo-preview round" src={v} alt="Their photo" referrerPolicy="no-referrer" />
        : <Photo id={current.id} photo={v} name={current.name} size={32} />;
    }
    if (k === "logo") {
      return String(v).startsWith("http")
        ? <img className="logo-preview" src={v} alt="The logo found" referrerPolicy="no-referrer" />
        : <Logo id={current.id} logo={v} name={current.name} size={32} />;
    }
    const f = fields.find((x) => x.name === k);
    if (f && f.type === "enum") return optionLabel(f.options, v);
    if (k === "description") return <div className="clamp">{toPlain(v)}</div>;
    return String(v);
  };
  const from = found.source || found.url;
  return (
    <>
      <p className="muted small">{found.platform ? `From ${found.platform}: ` : "From "}<a href={from} target="_blank" rel="noreferrer">{from}</a>
        . Ticked fields are used; what's already filled in stays unless you tick it.</p>
      <div className="al-table-wrap">
        <Table className="import-table">
          <thead><tr><th><span className="al-visually-hidden">Use</span></th><th>Field</th><th>Now</th><th>From the page</th></tr></thead>
          <tbody>
            {keys.map((k) => {
              const label = ({ logo: "Logo", photo: "Photo", company: "Company" } as Record<string, string>)[k] || fields.find((f) => f.name === k)?.label || k;
              return (
                <tr key={k}>
                  <td><input type="checkbox" checked={ticked.has(k)} onChange={(e) => {
                    const next = new Set(ticked);
                    if (e.target.checked) next.add(k); else next.delete(k);
                    setTicked(next);
                  }} /></td>
                  <th scope="row">{label}</th>
                  <td>{show(k, current[k])}</td>
                  <td>{show(k, found[k])}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>
      <div className="actions">
        <button className="al-button" type="button" onClick={close}>Cancel</button>
        <button className="al-button al-button--primary" type="button" onClick={async () => {
          const chosen: Row = {};
          for (const k of keys) if (ticked.has(k)) chosen[k] = found[k];
          if (!Object.keys(chosen).length) { toast("Tick what to use", "error"); return; }
          await apply(chosen, found);
          close();
        }}>Use these</button>
      </div>
    </>
  );
}

/** Two names for the same person: the same words, whatever the case or order. */
export function sameName(a: string, b: string) {
  const words = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(Boolean).sort().join(" ");
  return !!words(a) && words(a) === words(b);
}

/**
 * Someone sent from LinkedIn has the name of someone already here: merge
 * into them, someone else, or add a new person? Resolves to the person, null
 * for a new one, or undefined when cancelled.
 */
async function choosePerson(found: Row, named: Row[]): Promise<Row | null | undefined> {
  let other: number | null = null;
  const otherRadio = { current: null as HTMLInputElement | null };
  const option = (value: string, label: ReactNode, extra: ReactNode = null, checked = false) => (
    <label key={value} className="choice al-choice"><input type="radio" name="who" value={value} defaultChecked={checked} />{label}{extra}</label>
  );
  const data = await ask({
    title: `Is ${found.name} already here?`,
    body: (
      <div className="fields choose-person">
        <p className="muted">{`Someone here has that name, under ${named.length === 1 ? "no or another LinkedIn profile" : "no or other LinkedIn profiles"}. Merging fills them in from this profile (you choose what) and keeps their history.`}</p>
        {named.map((p, i) => option(String(p.id), <span className="with-logo"><Photo id={p.id} photo={p.photo} name={p.name} size={22} /><b>{p.label}</b></span>,
          p.title ? <span className="muted">{` · ${p.title}`}</span> : null, i === 0))}
        <label className="choice al-choice">
          <input type="radio" name="who" value="other" ref={(el) => { otherRadio.current = el; }} />
          <Combo label="Someone else" placeholder="Someone else…" source={refSource("people")}
            onPick={(it) => { other = it.value; if (otherRadio.current) otherRadio.current.checked = true; }} />
        </label>
        {option("new", <span>Add a new person</span>)}
      </div>
    ),
    ok: "Continue",
  });
  if (!data) return undefined;
  const who = data.get("who");
  if (who === "new") return null;
  const id = who === "other" ? other : Number(who);
  if (!id) { toast("Pick who it is from the list", "error"); return undefined; }
  return get(`people/${id}`);
}

/**
 * A profile sent by the “Send to hunt” bookmark (/linkedin?d=…): read it,
 * then choose what to keep, for the person already kept with that profile
 * or a new one. `go` opens a page.
 */
export async function importSentProfile(data: string | null, go: (path: string) => void) {
  let page;
  try { page = JSON.parse(data || ""); } catch { toast("The bookmark sent nothing hunt can read", "error"); return; }
  const found = await attempt(() => post("people/from-page", page));
  if (!found) return;
  found.platform = "LinkedIn, in your browser";
  // The same profile: them. Otherwise someone of the same name may be them.
  let existing: Row | null | undefined = (await get(`people?linkedin=${enc(found.linkedin)}`))[0];
  if (!existing) {
    const rule = (await get("settings")).same_name;
    const named = rule === "new" ? [] : (await get(`people?q=${enc(found.name)}`)).filter((p: Row) => sameName(p.name, found.name));
    if (rule === "merge" && named.length === 1) {
      existing = named[0];
      toast(`Merging into ${existing!.label}`);
    } else if (named.length) {
      const picked = await choosePerson(found, named);
      if (picked === undefined) return;
      existing = picked;
    }
  }
  if (existing && existing.company_id) {
    existing.company = (await get(`companies/${existing.company_id}`).catch(() => ({}))).name;
  }
  openImport({
    kind: personImport, found, current: existing || {},
    apply: async (chosen) => {
      if (existing) {
        if (await applyToPerson(existing.id, chosen, found)) { toast(`Updated ${existing.name}`); go(`/people/${existing.id}`); }
        return;
      }
      const made = await attempt(async () => {
        const { photo, company, ...rest } = chosen;
        rest.name = rest.name || found.name;
        rest.linkedin = rest.linkedin || found.linkedin;
        if (company) rest.company_id = (await companyNamed(company, found.company_linkedin)).id;
        const person = await post("people", rest);
        if (photo) { try { await post(`people/${person.id}/photo/fetch`, { url: photo }); } catch { /* no photo, no fuss */ } }
        return person;
      });
      if (made) { toast(`Added ${made.name}`); go(`/people/${made.id}`); }
    },
  });
}

/**
 * The “Send to hunt” bookmarklet. On a LinkedIn profile it collects the
 * page's text (hunt reads it) and opens hunt with it, in a new tab: opening
 * a page isn't something LinkedIn's security rules stop, as sending data
 * from its page would be.
 */
export function profileBookmarklet(origin = location.origin) {
  const code = `(()=>{const H=${JSON.stringify(origin)};
if(!/(^|\\.)linkedin\\.com$/.test(location.hostname)||!/^\\/in\\//.test(location.pathname)){alert("Open someone's LinkedIn profile first, then click “Send to hunt”.");return}
const t=e=>(e&&e.innerText||"").trim();
const n=document.querySelector("main h1")||document.querySelector("h1");
const top=n&&(n.closest("section")||n.parentElement);
const sec=id=>{const a=document.getElementById(id);return a&&a.closest("section")};
let ph={s:"",w:0};
if(top)for(const i of top.querySelectorAll("img")){const s=i.currentSrc||i.src||"";const w=i.naturalWidth||1;
if(/licdn\\.com/.test(s)&&w>=ph.w&&(/profile-displayphoto|profile-framedphoto/.test(s)||(n&&i.alt&&i.alt.includes(t(n)))))ph={s,w}}
const c=document.querySelector('[aria-label^="Current company"]');
const d={url:location.href.split("?")[0],title:document.title,name:t(n),top:t(top).slice(0,3000),
about:t(sec("about")).slice(0,4000),experience:t(sec("experience")).slice(0,2500),
company:c?c.getAttribute("aria-label")||"":"",photo:ph.s};
window.open(H+"/linkedin?d="+encodeURIComponent(JSON.stringify(d)),"_blank")})()`;
  return `javascript:${encodeURIComponent(code.replace(/\n/g, ""))}`;
}
