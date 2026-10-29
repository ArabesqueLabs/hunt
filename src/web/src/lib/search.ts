// The search's scope: what the page you're on lists, and its filters, for
// the one field in the top bar (components/Search.tsx). A page that lists
// things says so (usePageScope): its name ("Applications"), its filters
// (each with the keyword it's typed as: `stage:`, `tag:`, `is:`), the
// values on, and keeping others. The field starts in that scope, as a chip
// at its start; with the chip gone, it searches everything instead.
//
// The search's language, as typed: words, "a phrase", and keywords, each
// `keyword:value` (`company:"Acme Labs"`, `added:7d`, `is:overdue`). A
// keyword stands for a filter of the scope's (values are its choices, by
// what they're called, or how they're typed); `in:contacts` is a scope.
// Any other words are searched for. See docs/web-ui/search.md.

import { useEffect, useLayoutEffect, useState } from "react";
import { settle } from "./router";
import { createStore } from "./state";

/** The filters on, by key; "" is off. The words searched for are `q`. */
export type Values = Record<string, string>;

/** A filter the field offers. */
export interface FilterDef {
  key: string;
  /** What it's called: "Stage". */
  label: string;
  /** How it's typed, before its colon: "stage". Filters may share one (`is:`): their values tell them apart. */
  keyword: string;
  /** What it can be: [value, what it says]. */
  choices: [string, string][];
  /** A value as typed (after the colon), when what it says won't do: "7d", "100k". */
  word?: (v: string) => string;
  /** Typed words can be it as they are: what that says ("Location contains “{v}”"). */
  contains?: (v: string) => string;
  /** Not a filter of its own: a choice under another's (known pay only, under pay). */
  under?: string;
  /** Its chip, when "Label: choice" won't do. */
  chip?: (v: string) => string;
  /** No counts beside its choices (the server applies it, or it's not about rows). */
  uncounted?: boolean;
}

/** What a page lists, and its filters: the field's scope while you're on it. */
export interface Scope<T = unknown> {
  /** How `in:` names it: "applications". */
  key: string;
  /** Its chip: "Applications". */
  name: string;
  defs: FilterDef[];
  /** The filters kept (in the address, mostly). */
  values: Values;
  /** Keep others (`push`: so Back undoes it). */
  commit: (next: Values, push?: boolean) => void;
  /** Apply what's being typed, without keeping it. */
  preview: (next: Values) => void;
  /** Tidy values a change upsets (another stage: its sub stage goes). */
  adjust?: (next: Values, key: string) => Values;
  /** The rows the counts are of, and whether one passes: none for a page the server filters. */
  rows?: T[];
  matches?: (row: T, values: Values) => boolean;
  /** How many pass, of how many: once something's on. */
  shown?: number;
  total?: number;
  /** Every filter off (the page's own included). */
  clear: () => void;
  /** What the field says with nothing in it. */
  placeholder: string;
}

/** Every scope `in:` can name, and its page. */
export const SCOPES: [string, string, string][] = [
  ["applications", "Applications", "/applications"],
  ["contacts", "Contacts", "/contacts"],
  ["companies", "Companies", "/companies"],
  ["people", "People", "/people"],
  ["files", "Files", "/files"],
  ["notes", "Notes", "/notes"],
  ["calendar", "Calendar", "/calendar"],
];

/** The page's scope, if it lists things. */
export const pageScope = createStore<Scope<any> | null>(null);

/**
 * This page's scope, for the field, kept up with each drawing; gone with
 * the page.
 */
export function usePageScope<T>(scope: Scope<T> | null) {
  useLayoutEffect(() => { pageScope.set(scope as Scope<any> | null); });
  useEffect(() => () => pageScope.set(null), []);
}

/** How many of `values` are on (but those in `except`). */
export const countOn = (values: Values, except: string[] = []) => Object.keys(values).filter((k) => values[k] && !except.includes(k)).length;

const lc = (s: string) => s.toLowerCase();

/** Does `text` have every word of `q` in it (any case)? */
export const hasWords = (text: string, q: string) => {
  const t = lc(text);
  return lc(q).split(/\s+/).filter(Boolean).every((w) => t.includes(w));
};

// ---- the language -----------------------------------------------------------------------

/** A piece of what's typed: a keyword and its value, or words (`key` none). */
export interface Token { key?: string; value: string; start: number; end: number }

/** What's typed, in pieces: `key:value`, `key:"two words"`, "a phrase", a word. */
export function tokens(s: string): Token[] {
  const out: Token[] = [];
  const re = /([A-Za-z]+):(?:"([^"]*)"?|(\S*))|"([^"]*)"?|(\S+)/g;
  for (let m; (m = re.exec(s)); ) {
    if (m[1]) out.push({ key: lc(m[1]), value: m[2] ?? m[3] ?? "", start: m.index, end: m.index + m[0].length });
    else out.push({ value: m[4] ?? m[5] ?? "", start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** A value as typed: in quotes if it has spaces. */
export const quoted = (v: string) => (/[\s"]/.test(v) ? `"${v.replace(/"/g, "")}"` : v);

/** A choice of a filter's, as typed after its keyword. */
export const wordOf = (d: FilterDef, v: string) => (d.word ? d.word(v) : d.choices.find(([x]) => x === v)?.[1] ?? v);

/** A filter on, as it's typed: `stage:Applied`. */
export const typed = (d: FilterDef, v: string) => `${d.keyword}:${quoted(wordOf(d, v))}`;

/** The filters a keyword can be (one, or several sharing it). */
export const defsFor = (defs: FilterDef[], key: string) => defs.filter((d) => d.keyword === key);

/**
 * What `keyword:value` means among `defs`: which filter, set to what; none
 * when it's no filter's, or no choice of one. Its choice by how it's typed,
 * what it says, or itself, in any case; a filter of any text takes it as it is.
 */
export function resolve(defs: FilterDef[], key: string, value: string): [string, string] | null {
  const v = lc(value.trim());
  if (!v) return null;
  const mine = defsFor(defs, key);
  for (const d of mine) {
    const c = d.choices.find(([x, l]) => lc(wordOf(d, x)) === v || lc(l) === v || lc(x) === v);
    if (c) return [d.key, c[0]];
  }
  const free = mine.find((d) => d.contains);
  return free ? [free.key, value.trim()] : null;
}

/** The scope `in:` names, by its key or its name. */
export const scopeNamed = (v: string) => SCOPES.find(([k, n]) => lc(v) === k || lc(v) === lc(n)) || null;

/**
 * What's typed, read: the filters it sets (on top of `values`), the words
 * left to search for, and the scope an `in:` names. Keywords that aren't
 * filters here are searched for as words.
 */
export function read(defs: FilterDef[], s: string, values: Values = {}) {
  const next = { ...values };
  const words: string[] = [];
  let scope: string | null = null;
  for (const t of tokens(s)) {
    if (t.key === "in" && scopeNamed(t.value)) { scope = scopeNamed(t.value)![0]; continue; }
    // A keyword with nothing after it yet: nothing.
    if (t.key && !t.value.trim()) continue;
    const hit = t.key ? resolve(defs, t.key, t.value) : null;
    if (hit) next[hit[0]] = hit[1];
    else if (t.key) words.push(`${t.key}:${t.value}`);
    else if (t.value) words.push(t.value);
  }
  return { next, words: words.join(" "), scope };
}

// ---- filters in the address -----------------------------------------------------------

/**
 * A page's filters in the address (?q=…&tag=…): what they are, what the
 * page applies (as they're typed, before they're kept), and keeping them
 * (`push`: so Back undoes it). Other things in the address stay.
 */
export function useAddressFilters(keys: string[]) {
  const [values, setValues] = useState<Values>(() => {
    const q = new URLSearchParams(location.search);
    return Object.fromEntries(keys.map((k) => [k, q.get(k) || ""]));
  });
  const [applied, setApplied] = useState(values);
  const commit = (next: Values, push = true) => {
    setValues(next);
    setApplied(next);
    const q = new URLSearchParams(location.search);
    for (const k of keys) if (next[k]) q.set(k, next[k]); else q.delete(k);
    const url = location.pathname + (q.toString() ? `?${q}` : "");
    if (url !== location.pathname + location.search) {
      if (push) history.pushState(null, "", url); else history.replaceState(null, "", url);
    }
    settle();
  };
  const clear = () => commit(Object.fromEntries(keys.map((k) => [k, ""])));
  return { values, applied, commit, preview: setApplied, clear };
}
