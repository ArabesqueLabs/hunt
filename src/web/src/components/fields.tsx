// Records' fields, from their descriptions in /api/meta: an editor for one
// field, a record edited in place, a form that creates one, and a record to
// read.

import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { attempt, enc, get, patch, post } from "../lib/api";
import { fmtDay, fmtMoney, homePay, HOME } from "../lib/format";
import { t } from "../lib/i18n";
import { routeOf } from "../lib/lists";
import { R, choicesOf, optionLabel } from "../lib/meta";
import { toast } from "../lib/toast";
import type { FieldDef, Row } from "../lib/types";
import { isRichField } from "../lib/rich";
import { Combo, type ComboItem } from "./Combo";
import { RichText, RichView } from "./RichText";
import { DatePicker } from "./DatePicker";
import { Facts, Field, Input, Label, Logo, Notice, Select, SysIcon, TextArea } from "./ui";

/** Suggestions from a resource's records, by what's typed. */
export const refSource = (resource: string, extra = "") => async (q: string): Promise<ComboItem[]> =>
  (await get(`${resource}?limit=12&q=${enc(q)}${extra}`)).map((r: Row) => ({
    value: r.id, label: r.label,
    icon: resource === "companies" ? <Logo id={r.id} logo={r.logo} name={r.name} size={18} /> : null,
  }));

/** Suggestions from what a field has said before. */
export const suggestSource = (resource: string, field: string) => async (q: string): Promise<ComboItem[]> =>
  (await get(`suggest/${resource}/${field}?q=${enc(q)}`)).map((v: string) => ({ value: v, label: v }));

/** Listen for an element's own change event (as it loses focus, changed): React's onChange is every keystroke. */
export function useNativeChange<T extends HTMLElement>(fn: (el: T) => void) {
  const ref = useRef<T>(null);
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const f = () => latest.current(el);
    el.addEventListener("change", f);
    return () => el.removeEventListener("change", f);
  }, []);
  return ref;
}

/** Pay in the home currency, when the posting gave another: "≈ £93k–157k". */
export function GbpLine({ a }: { a: Row }) {
  if ((a.currency || "").toUpperCase() === HOME()) return null;
  const home = homePay(a);
  if (!home) return null;
  const pay = fmtMoney(home[0] == null ? null : Math.round(home[0]), home[1] == null ? null : Math.round(home[1]), HOME(), a.pay_period);
  return <span className="gbp" title={a.gbp_rate != null ? `At ${a.gbp_rate.toFixed(4)} GBP per ${a.currency}, the rate on ${a.gbp_rate_on}` : ""}>{`≈ ${pay}`}</span>;
}

/** Whether a GbpLine has anything to say. */
export const hasGbpLine = (a: Row) => (a.currency || "").toUpperCase() !== HOME() && !!homePay(a);

interface FieldControlProps {
  resource: string;
  field: FieldDef;
  value: any;
  /** Called with the new value (null when cleared); may return a promise. Failures show next to the field. */
  save: (v: any) => unknown;
  /** Saving isn't announced (for forms that create on submit). */
  quiet?: boolean;
  /** Overrides the field's own label (as inside a group). */
  label?: string;
}

/** An editor for one field, built from its description in /api/meta. */
export function FieldControl({ resource, field, value, save, quiet = false, label }: FieldControlProps) {
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);
  // Under the field: the design system's save state (Saving…, Saved), or
  // its error when a value can't be saved, tied to the control.
  const [status, setStatus] = useState<{ state: string | null; text: string; error?: string }>({ state: null, text: "" });
  const [openHref, setOpenHref] = useState<string | null>(null);
  const latest = useRef(save);
  latest.current = save;
  const placeholder = field.placeholder || undefined;
  const statusId = `${id}-status`;
  const refreshOpen = (v: string | null | undefined) => {
    const s = (v || "").trim();
    setOpenHref(/^https?:\/\//.test(s) ? s : null);
  };
  useEffect(() => { if (field.type === "url") refreshOpen(value); }, []);
  // The control says it's invalid while its value can't be saved.
  useEffect(() => {
    const c = wrap.current?.querySelector("input:not([type=hidden]), select, textarea");
    if (!c) return;
    if (status.error) { c.setAttribute("aria-invalid", "true"); c.setAttribute("aria-describedby", statusId); }
    else { c.removeAttribute("aria-invalid"); c.removeAttribute("aria-describedby"); }
  }, [status.error, statusId]);
  const fail = (message: string) => setStatus({ state: null, text: "", error: message });
  const commit = async (v: any) => {
    if (v === "") v = null;
    if (!quiet) setStatus({ state: "saving", text: "Saving…" });
    try {
      await latest.current(v);
      if (quiet) setStatus({ state: null, text: "" });
      else {
        setStatus({ state: "saved", text: "Saved" });
        setTimeout(() => setStatus((s) => (s.state === "saved" ? { state: null, text: "" } : s)), 1500);
      }
      if (field.type === "url") refreshOpen(v);
    } catch (e) {
      fail((e as Error).message);
    }
  };
  const control = (() => {
    switch (field.type) {
      case "long-text":
        // Prose people write themselves: the rich text editor.
        if (isRichField(resource, field.name)) {
          return <RichText id={id} value={value} label={label || field.label} placeholder={placeholder} rows={field.name === "description" ? 8 : 4}
            onCommit={commit} onChange={quiet ? commit : undefined} />;
        }
        return <NativeTextArea id={id} placeholder={placeholder} rows={field.name === "description" ? 8 : 3} defaultValue={value ?? ""} onCommit={commit} />;
      case "number":
        // Text, so "150k" can be typed; the service reads it.
        return <NativeInput id={id} type="text" inputMode="decimal" placeholder={placeholder} defaultValue={value ?? ""} onCommit={commit} />;
      case "date":
        return <DatePicker id={id} value={value} onChange={commit} onBad={() => fail(t("Enter a date, day first, like 30/11/2026"))} />;
      case "date-time":
      case "url":
      case "email": {
        const type = ({ "date-time": "datetime-local", url: "url", email: "email" } as Record<string, string>)[field.type];
        return <NativeInput id={id} type={type} placeholder={placeholder} defaultValue={value ?? ""} step={type === "datetime-local" ? 900 : undefined} onCommit={commit} />;
      }
      case "enum":
        return (
          <Select id={id} defaultValue={value ?? ""} onChange={(e) => commit(e.target.value)}>
            {field.required ? null : <option value="">Not set</option>}
            {field.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        );
      case "choice":
        return (
          <Select id={id} defaultValue={value ?? ""} onChange={(e) => commit(e.target.value)}>
            {field.required ? null : <option value="">Not set</option>}
            {choicesOf(field.resource).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        );
      case "ref":
        if (field.resource === "stages") return <StageSelect id={id} value={value} required={!!field.required} onCommit={commit} />;
        return <RefCombo id={id} field={field} value={value} onCommit={commit} />;
      default:
        if (field.suggest) {
          return <Combo id={id} value={value ?? ""} placeholder={placeholder} source={suggestSource(resource, field.name)}
            onPick={(it) => commit(it.value)} onChange={(v) => commit(v)} />;
        }
        return <NativeInput id={id} type="text" placeholder={placeholder} defaultValue={value ?? ""} onCommit={commit} />;
    }
  })();
  const required = field.required && !field.defaulted;
  return (
    <Field className={`type-${field.type}${status.error ? " bad" : ""}`} data-field={field.name} ref={wrap}>
      <Label htmlFor={id}>
        {label || field.label}
        {required ? <span className="req" title="required"> *</span> : null}
        {field.type === "url" ? <a className="open-link" target="_blank" rel="noreferrer" title="Open in a new tab" hidden={!openHref} href={openHref || undefined}>Open ↗</a> : null}
      </Label>
      {control}
      {status.error
        ? <p className="al-error" id={statusId} role="status"><SysIcon name="danger" className="al-icon al-icon--sm" />{status.error}</p>
        : <p className="al-save-state" id={statusId} role="status" data-state={status.state || undefined}>{status.text}</p>}
    </Field>
  );
}

/** A text field that commits as it loses focus, changed (its own change event). */
function NativeInput({ onCommit, ...rest }: React.ComponentProps<"input"> & { onCommit: (v: string) => void }) {
  const ref = useNativeChange<HTMLInputElement>((el) => onCommit(el.value));
  return <Input ref={ref} {...rest} />;
}

function NativeTextArea({ onCommit, ...rest }: React.ComponentProps<"textarea"> & { onCommit: (v: string) => void }) {
  const ref = useNativeChange<HTMLTextAreaElement>((el) => onCommit(el.value));
  return <TextArea ref={ref} {...rest} />;
}

/** Short lists (stages): a plain select. */
function StageSelect({ id, value, required, onCommit }: { id: string; value: any; required: boolean; onCommit: (v: any) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => { get("stages").then(setRows).catch(() => {}); }, []);
  return (
    <Select id={id} value={rows ? (value ?? "") : undefined} defaultValue={rows ? undefined : (value ?? "")}
      onChange={(e) => onCommit(e.target.value ? Number(e.target.value) : null)}>
      {required ? null : <option value="">Not set</option>}
      {(rows || []).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
    </Select>
  );
}

/** Another record, found by name (a company can be added as it's typed). */
function RefCombo({ id, field, value, onCommit }: { id: string; field: FieldDef; value: any; onCommit: (v: any) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const current = useRef(value);
  const shown = useRef("");
  useEffect(() => {
    if (value == null) return;
    get(`${field.resource}/${value}`).then((r) => {
      shown.current = r.label;
      if (input.current) input.current.value = r.label;
    }).catch(() => {});
  }, []);
  const what = (R(field.resource!)?.title || "").toLowerCase();
  return (
    <Combo id={id} placeholder={`Search ${what}…`} source={refSource(field.resource!)} allowCreate={field.resource === "companies"} inputRef={input}
      onPick={async (it) => {
        if (it.create) {
          const made = await attempt(() => post("companies", { name: it.value }));
          if (!made) return;
          it = { value: made.id, label: made.label };
          toast(`Added company ${made.label}`);
        }
        current.current = it.value;
        shown.current = it.label;
        onCommit(it.value);
      }}
      onBlur={() => setTimeout(() => {
        const el = input.current;
        if (!el) return;
        if (el.value.trim() === "" && current.current != null && !field.required) {
          current.current = null;
          shown.current = "";
          onCommit(null);
        } else {
          el.value = shown.current;
        }
      }, 150)} />
  );
}

/**
 * Field editors in the resource's order, with grouped fields (a salary's
 * from, to, currency and period) set together under their group's name.
 * `make(field, label)` builds each editor.
 */
export function fieldLayout(fields: FieldDef[], make: (f: FieldDef, label?: string) => ReactNode): ReactNode[] {
  const out: ReactNode[] = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (!f.group) { out.push(<Fragment key={f.name}>{make(f)}</Fragment>); continue; }
    const members: FieldDef[] = [];
    while (i < fields.length && fields[i].group === f.group) members.push(fields[i++]);
    i--;
    out.push(
      <fieldset key={`group-${f.group}`} className="group">
        <legend>{f.group}</legend>
        <div className="group-fields" style={{ "--n": members.length } as React.CSSProperties}>
          {members.map((m) => <Fragment key={m.name}>{make(m, m.short)}</Fragment>)}
        </div>
      </fieldset>,
    );
  }
  return out;
}

/** Edit a record in place: every field saves as it changes. */
export function RecordEditor({ resource, record, only, skip = [], onSaved }: {
  resource: string; record: Row; only?: string[]; skip?: string[]; onSaved?: (saved: Row, field: string) => void;
}) {
  const r = R(resource);
  const fields = r.fields.filter((f) => (!only || only.includes(f.name)) && !skip.includes(f.name) && !f.readonly);
  if (only) fields.sort((a, b) => only.indexOf(a.name) - only.indexOf(b.name));
  return (
    <div className="fields">
      {fieldLayout(fields, (f, label) => (
        <FieldControl resource={r.name} field={f} value={record[f.name]} label={label} save={async (v) => {
          const saved = await patch(`${r.name}/${record.id}`, { [f.name]: v });
          Object.assign(record, saved);
          onSaved?.(saved, f.name);
        }} />
      ))}
    </div>
  );
}

/** The fields each kind of record asks for first; the rest wait under "More details". */
const ESSENTIAL: Record<string, string[]> = {
  companies: ["name", "kind", "website", "linkedin"],
  people: ["name", "company_id", "title", "email"],
  steps: ["title", "at"],
  stages: ["name"],
  documents: ["name", "kind"],
};

/**
 * A form that creates a record on submit. Required fields and the
 * essentials come first; anything else is folded away. Problems show in the
 * form, not just a toast, and the button waits while saving. `formRef` is
 * the form, for filling fields in as if typed (setField).
 */
export function CreateForm({ resource, initial = {}, only, onCreated, submitLabel, formRef }: {
  resource: string; initial?: Row; only?: string[]; onCreated?: (made: Row) => void; submitLabel?: string;
  formRef?: React.RefObject<HTMLFormElement | null>;
}) {
  const r = R(resource);
  const values = useRef<Row>({ ...initial });
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fields = r.fields.filter((f) => (only ? only.includes(f.name) : !(f.name in initial)));
  const essential = only || ESSENTIAL[r.name] || fields.map((f) => f.name);
  const first = fields.filter((f) => (f.required && !f.defaulted) || essential.includes(f.name));
  const rest = fields.filter((f) => !first.includes(f));
  const make = (f: FieldDef, label?: string) => (
    <FieldControl resource={r.name} field={f} value={values.current[f.name]} label={label} quiet save={(v) => { values.current[f.name] = v; }} />
  );
  return (
    <form className="create" ref={formRef} onSubmit={async (e) => {
      e.preventDefault();
      // Text typed into a field but not yet "changed" still counts.
      e.currentTarget.querySelectorAll("input, textarea, select").forEach((c) => { if (document.activeElement === c) c.dispatchEvent(new Event("change", { bubbles: true })); });
      if (busy) return;
      setProblem(null);
      setBusy(true);
      try {
        const made = await post(r.name, values.current);
        onCreated?.(made);
      } catch (err) {
        setProblem((err as Error).message);
      } finally {
        setBusy(false);
      }
    }}>
      <div className="fields">{fieldLayout(first, make)}</div>
      {rest.length ? <details className="al-disclosure more"><summary>More details</summary><div className="fields">{fieldLayout(rest, make)}</div></details> : null}
      <Notice kind="danger" role="alert" hidden={!problem} className="form-error">{problem}</Notice>
      <div className="actions">
        <button className="al-button al-button--primary" type="submit" aria-busy={busy ? "true" : undefined}>{submitLabel || `Add ${r.entity}`}</button>
      </div>
    </form>
  );
}

/** Set a field in a form built by FieldControl, as if typed. */
export function setField(container: Element | null, name: string, value: unknown) {
  const control = container?.querySelector<HTMLInputElement>(`[data-field="${name}"] input, [data-field="${name}"] textarea, [data-field="${name}"] select`);
  if (!control) return;
  control.value = value == null ? "" : String(value);
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

/** A reference's label, linked to its page, once it's known. */
function RefValue({ resource, id }: { resource: string; id: number }) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => { get(`${resource}/${id}`).then((x) => setLabel(x.label)).catch(() => {}); }, [resource, id]);
  if (label == null) return <span>{`#${id}`}</span>;
  const page = routeOf(resource);
  return <span>{page ? <a href={`/${page}/${id}`}>{label}</a> : label}</span>;
}

/** An application's pay, converted again at today's rate on request. */
function SalaryValue({ resource, record }: { resource: string; record: Row }) {
  const [, redraw] = useState(0);
  const [busy, setBusy] = useState(false);
  const pay = fmtMoney(record.salary_min, record.salary_max, record.currency, record.pay_period);
  const [refreshed, setRefreshed] = useState(false);
  const gbp = hasGbpLine(record);
  return (
    <>
      {pay}
      {gbp ? <>{" "}<GbpLine a={record} /></> : refreshed ? <>{" "}<span className="muted">no rate</span></> : null}
      {resource === "applications" && record.currency && record.currency !== "GBP" && !refreshed ? <>
        {" "}
        <button className="al-button al-button--sm al-button--quiet" type="button" title="Convert again at today's rate" aria-busy={busy ? "true" : undefined}
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            const fresh = await attempt(() => post(`applications/${record.id}/gbp`, {}));
            if (fresh) {
              Object.assign(record, fresh);
              setRefreshed(true);
              toast(`Rate refreshed: ${fresh.gbp_rate?.toFixed(4)} on ${fresh.gbp_rate_on}`);
              redraw((n) => n + 1);
            }
            setBusy(false);
          }}>{record.gbp_rate == null ? "Convert to GBP" : "Refresh rate"}</button>
      </> : null}
    </>
  );
}

/**
 * A record to read: its filled fields as a list of label and value, with
 * enums, references, dates, links and money shown for people. Long text
 * comes after, as prose.
 */
export function RecordView({ resource, record, only, skip = [] }: { resource: string; record: Row; only?: string[]; skip?: string[] }) {
  const r = R(resource);
  const fields = r.fields.filter((f) => (!only || only.includes(f.name)) && !skip.includes(f.name) && !f.readonly);
  if (only) fields.sort((a, b) => only.indexOf(a.name) - only.indexOf(b.name));
  const facts: [ReactNode, ReactNode][] = [];
  const prose: ReactNode[] = [];
  const shown = new Set<string>();
  for (const f of fields) {
    if (shown.has(f.name)) continue;
    const v = record[f.name];
    if (f.group === "Salary") {
      for (const g of fields.filter((x) => x.group === "Salary")) shown.add(g.name);
      if (fmtMoney(record.salary_min, record.salary_max, record.currency, record.pay_period)) facts.push(["Salary", <SalaryValue resource={resource} record={record} />]);
      continue;
    }
    if (v == null || v === "") continue;
    if (f.type === "long-text") {
      prose.push(<section key={f.name} className="prose-block"><h2>{f.label}</h2><RichView className="prose" value={v} /></section>);
      continue;
    }
    let value: ReactNode;
    if (f.type === "enum") value = optionLabel(f.options, v);
    else if (f.type === "choice") value = choicesOf(f.resource).find((c) => c.value === v)?.label ?? v;
    else if (f.type === "date") value = <time dateTime={v} title={v}>{fmtDay(v)}</time>;
    else if (f.type === "date-time") value = <time dateTime={v} title={v.replace("T", " ")}>{fmtDay(v)}</time>;
    else if (f.type === "url") value = <a href={v} target="_blank" rel="noreferrer">{v.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}{" ↗"}</a>;
    else if (f.type === "email") value = <a href={`mailto:${v}`}>{v}</a>;
    else if (f.type === "ref") value = <RefValue resource={f.resource!} id={v} />;
    else value = String(v);
    facts.push([f.label, value]);
  }
  return (
    <div className="record-view">
      {facts.length ? <Facts rows={facts} /> : <p className="muted">Nothing filled in yet.</p>}
      {prose}
    </div>
  );
}

/**
 * A section that reads as a view, with an Edit button that turns it into
 * the form, and Done to go back. `view()` and `edit()` draw each.
 */
export function ViewEdit({ title, view, edit, tools, startEditing = false }: {
  title: string; view: () => ReactNode; edit: () => ReactNode; tools?: ReactNode; startEditing?: boolean;
}) {
  const [editing, setEditing] = useState(startEditing);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { if (editing) body.current?.querySelector<HTMLElement>("input, select, textarea")?.focus(); }, [editing]);
  return (
    <section className="al-panel panel">
      <div className="panel-head">
        <h2>{title}</h2>
        <div className="panel-tools">
          {tools}
          <button className="al-button al-button--sm" type="button" aria-pressed={String(editing) as "true" | "false"} onClick={() => setEditing(!editing)}>{editing ? "Done" : "Edit"}</button>
        </div>
      </div>
      <div className="view-edit-body" ref={body}>{editing ? edit() : view()}</div>
    </section>
  );
}
