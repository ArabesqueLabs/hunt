// What the whole app shares: what the service says about itself (META), the
// settings (PREFS), the tags, the cycles and the board last loaded. Code
// reads them from S as it needs them; whatever changes them calls changed(),
// and the components that use them (useShared) draw again.

import { useSyncExternalStore } from "react";
import type { Board, Cycle, Meta, Row, Tag } from "./types";

export const S = {
  META: null as unknown as Meta,
  /** The service's settings: localisation (region, clock, week, currency) and more. */
  PREFS: {} as Row,
  TAGS: [] as Tag[],
  /** Every cycle, running ones first, with their counts (GET cycles/overview). */
  CYCLES: [] as Cycle[],
  BOARD: null as Board | null,
  /** The Gmail connection and how much waits in triage. */
  MAIL: null as Row | null,
};

let version = 0;
const listeners = new Set<() => void>();

/** Say that something in S changed: what shows it draws again. */
export function changed() {
  version++;
  for (const f of listeners) f();
}

const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

/** Draw again whenever S changes. */
export function useShared() {
  return useSyncExternalStore(subscribe, () => version);
}

/** A tiny store of one value, for state that lives outside any component. */
export function createStore<T>(initial: T) {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) { value = next; for (const f of subs) f(); },
    subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
  };
}

/** Use a store made by createStore. */
export function useStore<T>(s: ReturnType<typeof createStore<T>>): T {
  return useSyncExternalStore(s.subscribe, s.get);
}
