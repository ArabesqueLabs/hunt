// Applications' data: what it shows (the cycle chosen), its stages
// and swimlanes, what's next on a card, and what's remembered in this
// browser about how it's laid out (hidden stages, folded packs, swimlanes).

import { get } from "./api";
import { currentCycle } from "./cycles";
import { daysFromToday, fmtDay, isOverdue, parseLocal } from "./format";
import { route } from "./router";
import { S } from "./state";
import { store, stored } from "./storage";
import type { Board, Card, Stage } from "./types";

/** The board's address in the API: the cycle shown. */
export function boardQuery() {
  const q = new URLSearchParams();
  const c = currentCycle();
  if (c) q.set("cycle", String(c.id));
  return q.toString();
}

export async function loadBoard(): Promise<Board> {
  S.BOARD = await get(`board?${boardQuery()}`);
  return S.BOARD as Board;
}

// The board on the page, if it's drawn: it loads and draws itself again.
let redraw: (() => Promise<void>) | null = null;
export const setBoardRedraw = (f: (() => Promise<void>) | null) => { redraw = f; };

/** Load the board again and draw it (as it's scrolled); elsewhere, the page again. */
export async function showBoard() {
  if (redraw) await redraw();
  else route();
}

/** The board's stages hidden from it (by id), remembered in this browser. */
export function hiddenStages(): Set<number> {
  try { return new Set(JSON.parse(stored("hiddenStages") || "[]")); } catch { return new Set(); }
}
export function setStageHidden(id: number, hide: boolean) {
  const set = hiddenStages();
  if (hide) set.add(id); else set.delete(id);
  store("hiddenStages", JSON.stringify([...set]));
  showBoard();
}

/** Whether cards show everything ("detailed", the default) or just company, role and what's next. */
export const cardDetail = () => (stored("cardView") === "compact" ? "compact" : "detailed");

/** Whether the board shown is an ended cycle's, kept as it was. */
export const boardReadOnly = () => !!S.BOARD?.read_only;

export interface Next { title: string; at: string | null; kind: string; overdue?: boolean; when?: string | null; text?: string }

/**
 * What's next on a card: its soonest open reminder or scheduled step, as
 * {title, at, overdue, text}; null with neither.
 */
export function nextOf(c: Card): Next | null {
  const all = ([
    c.reminder ? { title: c.reminder, at: c.reminder_at, kind: "reminder" } : null,
    c.next_step ? { title: c.next_step, at: c.next_step_at, kind: "step" } : null,
  ].filter(Boolean) as Next[]).sort((a, b) => (a.at || "9").localeCompare(b.at || "9"));
  const n = all[0];
  if (!n) return null;
  n.overdue = n.kind === "reminder" && isOverdue(n.at);
  const late = n.overdue ? -daysFromToday(parseLocal(n.at as string)) : 0;
  n.when = n.overdue ? (late > 1 ? `${late} days overdue` : late === 1 ? "a day overdue" : "overdue") : n.at ? fmtDay(n.at) : null;
  n.text = n.when ? `${n.title}, ${n.when}` : n.title;
  return n;
}

/** Every stage, in order, with its cards: an active one's from the board, a terminal one's from what's closed. */
export function boardStages(b: Board): Stage[] {
  const closed = (b.closed_stages || []).map((st) => ({ ...st, cards: b.archived.filter((c) => c.stage_id === st.id) }));
  return [...b.stages, ...closed].sort((x, y) => x.position - y.position || x.id - y.id);
}
/** A terminal stage: a process in it is closed (its sub stage says why). */
export const isTerminal = (st: Stage) => st.active === 0;

/**
 * The board's swimlanes, top to bottom, each with its stages (a stage in
 * none, in the first); those with none left out. One for every stage, if
 * there are no swimlanes.
 */
export function boardSwimlanes(b: Board) {
  const lanes = b.swimlanes?.length ? b.swimlanes : [{ id: null, name: "Processes" }];
  const known = new Set(lanes.map((l) => l.id));
  const of = (st: Stage) => (known.has(st.swimlane_id) ? st.swimlane_id : lanes[0].id);
  const stages = boardStages(b);
  return lanes.map((l) => ({ lane: l, stages: stages.filter((st) => of(st) === l.id) })).filter((g) => g.stages.length);
}

/**
 * A stage's name, as a list of the board's stages says it: with its
 * swimlane's, when a stage in another swimlane has the same name.
 */
export function stageNamer(b: Board) {
  const lanes = boardSwimlanes(b);
  const of = new Map(lanes.flatMap((g) => g.stages.map((st) => [st.id, g.lane.name] as const)));
  const seen = new Map<string, number>();
  for (const st of boardStages(b)) seen.set(st.name.toLowerCase(), (seen.get(st.name.toLowerCase()) || 0) + 1);
  return (st: { id: number; name: string }) => ((seen.get(st.name.toLowerCase()) || 0) > 1 && of.get(st.id) ? `${st.name} (${of.get(st.id)})` : st.name);
}

/**
 * Packs: a list of cards (a sub stage's, or a column's top) folded into
 * one card on the rest, until unfolded. A stage says how its own start
 * (`folded`), and a sub stage how its do (or as its stage); `folded(key)`
 * says it for a pack. Folding or unfolding one here is remembered in this
 * browser, by `stage:lane` key, while it still says what it said then.
 */
function packChoices(): Record<string, { open: boolean; was: boolean }> {
  try { return JSON.parse(stored("packs") || "{}") || {}; } catch { return {}; }
}
export function packOpen(key: string, folded: (k: string) => boolean) {
  const c = packChoices()[key];
  return c && c.was === folded(key) ? c.open : !folded(key);
}
export function setPacksOpen(keys: string[], folded: (k: string) => boolean, open: boolean) {
  const c = packChoices();
  for (const k of keys) c[k] = { open, was: folded(k) };
  store("packs", JSON.stringify(c));
}
/** How a stage's packs start: its top as it says, each sub stage as it says or as the stage. */
export function stageFolded(stage: Stage) {
  const lanes = new Map((stage.lanes || []).map((l) => [`${stage.id}:${l.id}`, l]));
  return (key: string) => {
    const l = lanes.get(key);
    return l && l.folded != null ? !!l.folded : !!stage.folded;
  };
}

/**
 * Whether a swimlane is open on the board: as it says (`folded`), or as it
 * was opened or folded here, remembered in this browser while it still
 * says what it said then.
 */
export function swimlaneChoices(): Record<string, { open: boolean; was: boolean }> {
  try { return JSON.parse(stored("swimlanes") || "{}") || {}; } catch { return {}; }
}
export function swimlaneOpen(key: string, lane: { folded?: unknown }) {
  const c = swimlaneChoices()[key];
  return c && c.was === !!lane.folded ? c.open : !lane.folded;
}

export const cardsCount = (n: number) => `${n} ${n === 1 ? "card" : "cards"}`;

/** The board's selected processes, by id: kept while the board is drawn again. */
export const BOARD_SEL = new Set<number>();
