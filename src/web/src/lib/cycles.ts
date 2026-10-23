// Cycles: job searches. Several can run at once (by season, place or
// industry), and one that has ended keeps its board as it was.

import { get } from "./api";
import { parseLocal, zonedNow } from "./format";
import { go } from "./router";
import { S, changed } from "./state";
import { store, stored } from "./storage";
import type { Cycle } from "./types";

export const runningCycles = () => S.CYCLES.filter((c) => !c.ended_on);
export const endedCycles = () => S.CYCLES.filter((c) => c.ended_on);
export const cycleById = (id: unknown) => S.CYCLES.find((c) => String(c.id) === String(id));

/** Which week of a cycle a day is in, counting its first as week 1. */
export function cycleWeek(c: Cycle, until: string | null = null) {
  const end = until ? parseLocal(until) : zonedNow();
  return Math.max(1, Math.floor((end.getTime() - parseLocal(c.started_on).getTime()) / (7 * 864e5)) + 1);
}

/** How many weeks an ended cycle ran. */
export const cycleWeeks = (c: Cycle) => cycleWeek(c, c.ended_on);

export async function loadCycles() {
  S.CYCLES = await get("cycles/overview");
  changed();
  return S.CYCLES;
}

/**
 * The running cycle the board shows (its id, as text), or "" for all of
 * them: remembered in this browser. With one running, that one.
 */
export function boardCycle(): string {
  const run = runningCycles();
  const v = stored("boardCycle");
  if (run.some((c) => String(c.id) === v)) return v as string;
  return run.length === 1 ? String(run[0].id) : "";
}

/** An ended cycle being looked at (?cycle= on the board), or null. */
export function viewedCycle(): Cycle | null {
  const id = new URLSearchParams(location.search).get("cycle");
  const c = id && cycleById(id);
  return c && c.ended_on ? c : null;
}

/** The cycle the board shows: one being looked at, the chosen one, or null for all running. */
export function currentCycle(): Cycle | null {
  return viewedCycle() || cycleById(boardCycle()) || null;
}

/** Show another running cycle ("" for all of them) where it matters, or its board. */
export function pickCycle(id: number | string) {
  store("boardCycle", String(id));
  const page = location.pathname.split("/")[1] || "";
  if (["", "applications", "stats"].includes(page)) go(page ? `/${page}` : "/");
  else go("/");
}

/** A season and year to name a cycle by, as the service does: Autumn 2026. */
export function seasonName(d: Date) {
  const m = d.getMonth() + 1;
  const season = m >= 3 && m <= 5 ? "Spring" : m >= 6 && m <= 8 ? "Summer" : m >= 9 && m <= 11 ? "Autumn" : "Winter";
  return `${season} ${d.getFullYear()}`;
}
