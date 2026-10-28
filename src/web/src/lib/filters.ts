// Filters for Applications, shared by its two views (board and
// table). They live in the address (/?mode=remote&pay=120000), so a filtered
// view can be bookmarked and Back undoes a change; the last ones used are
// remembered.

import { enc } from "./api";
import { boardStages, nextOf, stageNamer, type Next } from "./board";
import { homePay, isoToday, zonedNow } from "./format";
import { here, settle } from "./router";
import { store, stored } from "./storage";
import { tagNames } from "./tags";
import type { Board, Card, Row } from "./types";

/** Every filter, by its name in the address. */
export const FILTER_KEYS = ["q", "attn", "watch", "mode", "pay", "payknown", "source", "company", "person", "added", "applied",
  "closing", "loc", "emp", "reason", "has", "status", "stage", "lane", "tag"] as const;
export type Filters = Record<(typeof FILTER_KEYS)[number], string>;

export const readFilters = (): Filters => {
  const q = new URLSearchParams(location.search);
  const f = Object.fromEntries(FILTER_KEYS.map((k) => [k, q.get(k) || ""])) as Filters;
  // An interview soon, or gone quiet, were "attention" once.
  if (["soon", "quiet"].includes(f.attn)) { f.watch = f.watch || f.attn; f.attn = ""; }
  return f;
};
export const activeFilters = (f: Filters) => FILTER_KEYS.filter((k) => f[k]).length;

/** Put filters in the address (Back undoes them if `push`), and remember them. */
export function setFilters(f: Filters, { push = true } = {}) {
  const qs = new URLSearchParams(FILTER_KEYS.filter((k) => f[k]).map((k) => [k, f[k]])).toString();
  // An ended cycle being looked at stays looked at.
  const cycle = new URLSearchParams(location.search).get("cycle");
  const all = [cycle ? `cycle=${enc(cycle)}` : "", qs].filter(Boolean).join("&");
  const url = location.pathname + (all ? `?${all}` : "");
  if (url !== here()) {
    if (push) history.pushState(null, "", url);
    else history.replaceState(null, "", url);
  }
  settle();
  store("filters", qs);
}

/** Opening the board with no filters in the address: the ones last used. */
export function restoreFilters() {
  const kept = stored("filters");
  if (!location.search && kept) {
    history.replaceState(null, "", `${location.pathname}?${kept}`);
    settle();
  }
}

// ---- what's filtered: a row per process (or application not on the board) ----

/** A process (or application) as the filters read it. */
export interface FilterRow {
  process_id: number | null; application_id: number; company_id: number; company: string; title: string; reference: string;
  location: string; source: string; work_mode: string; employment: string; closes_on: string;
  pay: number | null; created: string; applied: string | null; updated: string; next_step_at: string | null;
  next: Next | null; status: string; archive_reason: string | null; stage_id: number | null; stage_name: string; stage_n: number;
  lane_id: number | null; lane_name: string; lane_n: number; tags: string[]; people: Row[];
  emails: number; files: number; people_count: number;
}

/** Pay a year in the home currency, at its top. */
function payTop(x: Row) {
  const p = homePay(x);
  const top = p && (p[1] ?? p[0]);
  if (top == null) return null;
  return top * (({ month: 12, day: 220, hour: 1760 } as Record<string, number>)[x.pay_period] || 1);
}

/** Where a card is (its stage and sub stage), by name and place on the board, from the board's stages. */
export type Place = (c: Card) => { stage: string; stage_n: number; lane: string; lane_n: number };
export function placeOf(b: Board): Place {
  const stages = new Map<number, [string, number]>(), lanes = new Map<number, [string, number]>();
  const named = stageNamer(b);
  boardStages(b).forEach((st, i) => {
    stages.set(st.id, [named(st), i]);
    (st.lanes || []).forEach((l, j) => lanes.set(l.id, [l.name, j]));
  });
  return (c) => {
    const [stage, stage_n] = stages.get(c.stage_id) || ["", -1];
    const [lane, lane_n] = (c.lane_id != null && lanes.get(c.lane_id)) || ["", -1];
    return { stage, stage_n, lane, lane_n };
  };
}

export function rowFromCard(c: Card, place: Place): FilterRow {
  const at = place(c);
  return {
    process_id: c.id, application_id: c.application_id, company_id: c.company_id, company: c.company, title: c.title, reference: c.reference,
    location: c.location, source: c.source, work_mode: c.work_mode, employment: c.employment, closes_on: c.closes_on,
    pay: payTop(c), created: c.created_at, applied: c.applied_on, updated: c.updated_at, next_step_at: c.next_step_at,
    next: nextOf(c),
    status: c.status, archive_reason: c.archive_reason, stage_id: c.stage_id, stage_name: at.stage, stage_n: at.stage_n,
    lane_id: at.lane ? c.lane_id : null, lane_name: at.lane, lane_n: at.lane_n, tags: tagNames(c.tags), people: c.people_list || [],
    emails: c.emails || 0, files: c.files || 0, people_count: c.people || 0,
  };
}

export function rowFromApplication(a: Row, company?: Row | null): FilterRow {
  return {
    process_id: null, application_id: a.id, company_id: a.company_id, company: company?.name, title: a.title, reference: a.reference,
    location: a.location, source: a.source, work_mode: a.work_mode, employment: a.employment, closes_on: a.closes_on,
    pay: payTop(a), created: a.created_at, applied: null, updated: a.updated_at, next_step_at: null, next: null,
    status: "none", archive_reason: null, stage_id: null, stage_name: "", stage_n: -1,
    lane_id: null, lane_name: "", lane_n: -1, tags: tagNames(a.tags), people: [], emails: 0, files: 0, people_count: 0,
  };
}

const today = () => isoToday();
const daysFrom = (n: number) => { const d = zonedNow(); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };

/** Does a row pass every filter? */
export function matchesFilters(r: FilterRow, f: Filters) {
  const lc = (s: string | null | undefined) => (s || "").toLowerCase();
  if (f.q) {
    const text = lc([r.company, r.title, r.reference, r.location, r.source, r.stage_name, r.lane_name, ...r.tags, ...r.people.map((p) => p.name)].join(" "));
    if (!lc(f.q).split(/\s+/).filter(Boolean).every((w) => text.includes(w))) return false;
  }
  if (f.attn === "next" && !r.next) return false;
  if (f.attn === "overdue" && !r.next?.overdue) return false;
  if (f.watch === "soon" && !(r.next_step_at && r.next_step_at.slice(0, 10) >= today() && r.next_step_at.slice(0, 10) <= daysFrom(7))) return false;
  if (f.watch === "quiet" && !(r.status === "active" && r.updated && r.updated.slice(0, 10) <= daysFrom(-14))) return false;
  if (f.mode && r.work_mode !== f.mode) return false;
  if (f.pay && (r.pay == null ? f.payknown : r.pay < Number(f.pay))) return false;
  if (f.source && lc(r.source) !== lc(f.source)) return false;
  if (f.company && String(r.company_id) !== f.company) return false;
  if (f.person && !r.people.some((p) => String(p.id) === f.person)) return false;
  if (f.added && !(r.created && r.created.slice(0, 10) >= daysFrom(-Number(f.added)))) return false;
  if (f.applied && !(r.applied && r.applied >= daysFrom(-Number(f.applied)))) return false;
  if (f.closing && !(r.closes_on && r.closes_on >= today() && r.closes_on <= daysFrom(Number(f.closing)))) return false;
  if (f.loc && !lc(r.location).includes(lc(f.loc))) return false;
  if (f.emp && r.employment !== f.emp) return false;
  if (f.reason && !(r.status === "archived" && r.archive_reason === f.reason)) return false;
  if (f.has === "emails" && !r.emails) return false;
  if (f.has === "files" && !r.files) return false;
  if (f.has === "people" && !r.people_count) return false;
  if (f.has === "nothing" && (r.emails || r.files || r.people_count)) return false;
  if (f.status && r.status !== f.status) return false;
  if (f.stage && String(r.stage_id) !== f.stage) return false;
  if (f.lane && String(r.lane_id) !== f.lane) return false;
  if (f.tag && !r.tags.some((t) => lc(t) === lc(f.tag))) return false;
  return true;
}
