// Adding an application, onto the board.

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { attempt, del, enc, get, post } from "../lib/api";
import { boardQuery, boardStages } from "../lib/board";
import { currentCycle, loadCycles, runningCycles } from "../lib/cycles";
import { fmtMoney, parsePay } from "../lib/format";
import { fieldOf } from "../lib/meta";
import { go, route } from "../lib/router";
import { S } from "../lib/state";
import { toast } from "../lib/toast";
import type { Row } from "../lib/types";
import { closeModal, openModal } from "./dialogs";
import { logoFromImport } from "./importer";
import { Field, Input, Label, Notice, Select } from "./ui";

/**
 * Add an application, onto the board: from a posting's link, read into the
 * fields below (each marked as it was filled), or by hand. Its cycle (when
 * more than one runs) and its stage are chosen here.
 */
export async function newApplication({ stageId = null }: { stageId?: number | null } = {}) {
  // Its stages, if the board hasn't been drawn yet.
  if (!S.BOARD) S.BOARD = S.BOARD || await get(`board?${boardQuery()}`);
  openModal(<NewApplication stageId={stageId} />);
}

type Key = "company" | "title" | "location" | "work_mode" | "pay" | "employment";

function NewApplication({ stageId }: { stageId: number | null }) {
  const stages = S.BOARD ? boardStages(S.BOARD) : [];
  const run = runningCycles();
  const found = useRef<Row | null>(null);
  const [vals, setVals] = useState<Record<Key, string>>({ company: "", title: "", location: "", work_mode: "", pay: "", employment: "" });
  const [stage, setStage] = useState(String(stageId ?? stages[0]?.id ?? ""));
  const [cycle, setCycle] = useState(String(currentCycle() && !currentCycle()!.ended_on ? currentCycle()!.id : run[0]?.id ?? ""));
  const [filled, setFilled] = useState(new Set<Key>());
  const [readNote, setReadNote] = useState<ReactNode>(null);
  const [already, setAlready] = useState<ReactNode>(null);
  const [reading, setReading] = useState<"no" | "busy" | "done">("no");
  const [adding, setAdding] = useState(false);
  const [companies, setCompanies] = useState<Row[]>([]);
  const [, redraw] = useState(0);
  const link = useRef<HTMLInputElement>(null);
  useEffect(() => {
    get("companies").then(setCompanies).catch(() => {});
    link.current?.focus();
  }, []);
  const modes = fieldOf("applications", "work_mode").options;
  const emps = fieldOf("applications", "employment").options;
  const set = (k: Key, v: string) => { setVals((x) => ({ ...x, [k]: v })); };
  const typed = (k: Key, v: string) => {
    set(k, v);
    setFilled((f) => { const n = new Set(f); n.delete(k); return n; });
  };
  async function readIt() {
    const url = (link.current?.value || "").trim();
    if (!url || reading === "busy") return;
    setReading("busy");
    samePosting(url).then(setAlready);
    try {
      const got = await post("applications/lookup", { url });
      found.current = got;
      const next = { ...vals };
      const now = new Set<Key>();
      const put = (k: Key, v: unknown) => { if (v == null || v === "") return; next[k] = String(v); now.add(k); };
      put("company", got.company);
      put("title", got.title);
      put("location", got.location);
      put("work_mode", got.work_mode);
      put("employment", got.employment);
      put("pay", fmtMoney(got.salary_min, got.salary_max, got.currency, got.pay_period).replace(/[⁦⁩]/g, ""));
      setVals(next);
      setFilled(now);
      setReadNote(
        <Notice kind="success">
          <div className="al-notice__title">{`Read from ${got.platform}`}</div>
          <div className="small">{now.size ? `${now.size} ${now.size === 1 ? "field" : "fields"} filled in, marked below. Check them, then add it.` : "It didn't say much: fill in the rest below."}</div>
        </Notice>,
      );
    } catch (e) {
      found.current = null;
      setReadNote(<Notice kind="danger" role="alert">{`Couldn't read it: ${(e as Error).message}. Fill in the fields below; the link is kept.`}</Notice>);
    }
    setReading("done");
    redraw((n) => n + 1);
  }
  const field = (key: Key, label: string, control: ReactNode) => (
    <Field>
      <Label className="new-label" htmlFor={`nf-${key}`}>{label}<span className="new-filled" hidden={!filled.has(key)}>from the posting</span></Label>
      {control}
    </Field>
  );
  const text = (key: Key, placeholder: string, extra: object = {}) => (
    <Input id={`nf-${key}`} placeholder={placeholder} value={vals[key]} onChange={(e) => typed(key, e.target.value)} {...extra} />
  );
  const choose = (key: Key, any: string, options: [string, string][]) => (
    <Select id={`nf-${key}`} value={vals[key]} onChange={(e) => typed(key, e.target.value)}>
      <option value="">{any}</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </Select>
  );
  const st = stages.find((s) => String(s.id) === stage);
  const name = vals.company.trim();
  const known = companies.find((c) => c.name.toLowerCase() === name.toLowerCase());
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      if (!name || adding) return;
      setAdding(true);
      const body: Row = {};
      const f = found.current;
      if (f) {
        for (const [k, v] of Object.entries(f)) if (v != null && k !== "platform") body[k] = v;
      }
      const url = (link.current?.value || "").trim();
      if (url) body.url = body.url || url;
      body.company = name;
      for (const k of ["title", "location", "work_mode", "employment"] as Key[]) body[k] = vals[k] || null;
      // Pay typed or changed by hand is read again.
      if (!filled.has("pay")) {
        for (const k of ["salary_min", "salary_max", "currency", "pay_period"]) delete body[k];
        Object.assign(body, parsePay(vals.pay) || {});
      }
      body.stage_id = Number(stage);
      if (cycle) body.cycle_id = Number(cycle);
      const card = await attempt(() => post("processes", body));
      setAdding(false);
      if (!card) return;
      await logoFromImport(card.company_id, body.company_logo);
      closeModal();
      const at = stages.find((s) => s.id === card.stage_id);
      toast(`Added ${card.company} to ${at?.name || card.stage}`, "info", { label: "Undo", onclick: async () => {
        if (await attempt(() => del(`applications/${card.application_id}`))) { toast("Undone"); route(); }
      } });
      await loadCycles();
      const page = location.pathname.split("/")[1] || "";
      if (page === "" || page === "applications") route(); else go("/");
    }}>
      <h2 className="al-dialog__title" id="modal-title">Add an application</h2>
      <div className="al-dialog__body">
        <Field>
          <Label htmlFor="new-link">Posting link</Label>
          <div className="new-link-row">
            <Input id="new-link" type="url" ref={link} placeholder="Paste a Greenhouse, Lever, Workable, LinkedIn or careers page link"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); readIt(); } }}
              onPaste={() => setTimeout(readIt, 0)} />
            <button className="al-button" type="button" aria-busy={reading === "busy" ? "true" : undefined} onClick={readIt}>
              {reading === "busy" ? "Reading…" : reading === "done" ? "Read again" : "Read posting"}
            </button>
          </div>
          <span className="al-hint">Or skip it and fill in the fields yourself.</span>
        </Field>
        <div className="new-read" aria-live="polite">{readNote}</div>
        <div className="same-posting" aria-live="polite">{already}</div>
        <div className="new-fields">
          {field("company", "Company", text("company", "e.g. Harbour Health", { autoComplete: "off" }))}
          {field("title", "Role", text("title", "e.g. Senior Platform Engineer"))}
          {field("location", "Location", text("location", "City or region"))}
          {field("work_mode", "Work mode", choose("work_mode", "Remote, hybrid or on-site", modes))}
          {field("pay", "Pay", text("pay", "e.g. £85k–100k"))}
          {field("employment", "Employment", choose("employment", "Full-time, contract…", emps))}
        </div>
        {run.length > 1 ? (
          <Field><Label htmlFor="new-cycle">Cycle</Label>
            <Select id="new-cycle" value={cycle} onChange={(e) => setCycle(e.target.value)}>
              {run.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        ) : null}
        <Field><Label htmlFor="new-stage">Add to</Label>
          <Select id="new-stage" value={stage} onChange={(e) => setStage(e.target.value)}>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <p className="muted small new-side" aria-live="polite" hidden={!name}>
          {!name ? "" : known ? `Adds it under ${known.name}, already in your companies.`
            : `Also adds ${name} to your companies${found.current?.company_website ? ", with its website from the posting" : ""}.`}
        </p>
      </div>
      <div className="al-dialog__actions">
        <button className="al-button" type="button" onClick={closeModal}>Cancel</button>
        <button className="al-button al-button--primary" type="submit" disabled={!name} aria-busy={adding ? "true" : undefined}>{`Add to ${st?.name || "the board"}`}</button>
      </div>
    </form>
  );
}

/**
 * A warning if a posting link is already tracked, however it was copied;
 * null if not. `except` leaves out one application (the one being edited).
 */
export async function samePosting(url: string, except: number | null = null): Promise<ReactNode> {
  const list = await samePostings(url, except);
  if (!list?.length) return null;
  return (
    <Notice kind="warning" role="status">
      <b>Already tracked: </b>
      {list.map((a, i) => (
        <Fragment key={a.id}>
          {i ? "; " : ""}
          <a href={`/applications/${a.id}`}>{a.label}</a>
          {a.processes.length
            ? <>{" ("}{a.processes.map((p: Row, j: number) => <Fragment key={p.id}>{j ? ", " : ""}<a href={`/p/${p.id}`}>{p.status === "archived" ? `closed at ${p.stage}` : `in ${p.stage}`}</a></Fragment>)}{")"}</>
            : " (not on the board)"}
        </Fragment>
      ))}
      . You can still add it, e.g. if you're applying again.
    </Notice>
  );
}

/** The applications already tracking a posting link, but `except`. */
async function samePostings(url: string, except: number | null): Promise<Row[] | null> {
  if (!url) return null;
  try { return (await get(`applications/same-posting?url=${enc(url)}`)).filter((a: Row) => a.id !== except); } catch { return null; }
}

/** Say so if an application's posting link is one another application already has. */
export async function warnIfSamePosting(app: Row) {
  const list = await samePostings(app.url, app.id);
  if (list?.length) toast(`Another application has this posting link: ${list[0].label}`, "error");
}
