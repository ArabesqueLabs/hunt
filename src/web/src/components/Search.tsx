// The one field, in the top bar: searching, and narrowing the page you're
// on. On a page that lists things, it starts in that page's scope (its
// chip, first: "Applications"), and what's typed narrows the page as you
// go, suggesting the filters it could mean, each with how many it'd leave;
// with nothing typed, it lists every filter to pick from. Filters on are
// chips after the scope's; they can be typed too, as keywords
// (`tag:remote`, `is:overdue`; lib/search.ts has the language). With the
// scope's chip gone (×, or Backspace), or on a page that lists nothing, it
// searches everything instead: the best few applications, companies,
// people, notes and files. "/" or ⌘K (Ctrl+K) comes here from anywhere.

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { enc, get } from "../lib/api";
import { nf } from "../lib/format";
import { R, choiceLabel } from "../lib/meta";
import { go, useVisit } from "../lib/router";
import { SCOPES, countOn, defsFor, pageScope, read, resolve, tokens, typed, wordOf, type FilterDef, type Scope, type Values } from "../lib/search";
import { S, useStore } from "../lib/state";
import type { Row } from "../lib/types";
import { Icon, Logo, Photo, SysIcon } from "./ui";

/** A line in the list: what it says, its keyword, how many it'd leave, and what choosing it does. */
interface Opt {
  id: string; text: ReactNode; hint?: string; count?: number; current?: boolean; more?: boolean; back?: boolean; quiet?: boolean;
  picture?: ReactNode; pick: () => void;
}
interface Group { title: string; opts: Opt[] }

/** How many of each filter's choices a few typed letters suggest. */
const FEW = 4;

const lc = (s: string) => s.toLowerCase();
const words = (s: string) => lc(s).split(/\s+/).filter(Boolean);

// ---- everything: GET /api/search ----------------------------------------------------------

/** A kind of result: where all of them are, searched. */
const ALL_OF: Record<string, string> = {
  applications: "/applications", companies: "/companies", people: "/people", memos: "/notes", documents: "/files",
};

/** A group of results, and the results in it, as GET /api/search has them. */
interface Found { kind: string; title: string; count: number; more: boolean; items: Row[] }

/** A result's picture: a company's logo, a person's photo, or what it is. */
function picture(kind: string, it: Row): ReactNode {
  if (it.picture === "logo") return <Logo id={it.company_id} logo={it.logo} name={it.detail || it.label} size={20} />;
  if (it.picture === "photo") return <Photo id={it.id} photo={it.photo} name={it.label} size={20} />;
  return <Icon name={kind === "memos" ? "file" : "copy"} className="al-icon al-icon--sm" />;
}

/** A result's line: as the search found it, or a file's kind, in words. */
function detail(kind: string, it: Row) {
  if (kind === "documents" && it.kind) {
    const field = (R("documents") as Row)?.fields?.find((f: Row) => f.name === "kind");
    return <span>{choiceLabel(field?.choices || [], it.kind)}</span>;
  }
  return it.detail ? <span translate="no">{it.detail}</span> : null;
}

/** Everything that matches `q`, a moment after the typing stops: null until asked. */
function useEverything(q: string, on: boolean) {
  const [found, setFound] = useState<Found[] | null>(null);
  const asked = useRef(0);
  useEffect(() => {
    const n = ++asked.current;
    if (!on || !q.trim()) { setFound(null); return; }
    const t = setTimeout(async () => {
      try {
        const got: Found[] = await get(`search?q=${enc(q.trim())}`);
        if (n === asked.current) setFound(got);
      } catch { if (n === asked.current) setFound([]); }
    }, 150);
    return () => clearTimeout(t);
  }, [q, on]);
  return found;
}

// ---- the field -------------------------------------------------------------------------

/**
 * The field. In a dialog (a phone's), `onDone` closes it, and the keys
 * that come here from anywhere are the bar's.
 */
export function SearchField({ autoFocus, onDone }: { autoFocus?: boolean; onDone?: () => void }) {
  const id = useId();
  const page = useStore(pageScope);
  const visit = useVisit();
  // The scope's chip taken off: everything, until another page.
  const [everywhere, setEverywhere] = useState(false);
  const scope: Scope<any> | null = everywhere ? null : page;
  // What's being typed: narrowing the page as it's typed, on top of what's kept.
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  // Choosing among one filter's choices, or (null) among every filter.
  const [cat, setCat] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  // The words searched being changed (their chip clicked): back as they were on Escape.
  const [was, setWas] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const path = useRef(location.pathname);

  // Another page: its scope, afresh (the same page, a filter changed: as it was).
  useEffect(() => {
    if (location.pathname === path.current) return;
    path.current = location.pathname;
    setEverywhere(false); setDraft(""); setCat(null); setOpen(false); setWas(null);
  }, [visit]);
  // "/" or ⌘K (Ctrl+K) comes here from anywhere (the bar's, not a dialog's).
  useEffect(() => {
    if (onDone) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as Element).closest?.("input, textarea, select, [contenteditable]");
      const k = (e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey) && !e.altKey;
      if (!(k || (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey))) return;
      if (document.querySelector("dialog[open]")) return;
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
      setOpen(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDone]);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Everything is searched for the words typed (an `in:` is where, not what).
  const wanted = read([], draft).words;
  const found = useEverything(wanted, !scope && open);

  // ---- the scope's filters ----
  const defs: FilterDef[] = scope?.defs || [];
  const values: Values = scope?.values || {};
  const q = values.q || "";
  const byKey = new Map(defs.map((d) => [d.key, d]));
  // Only filters with something to choose; those under another only once it's on.
  const shownDefs = defs.filter((d) => d.choices.length && (!d.under || values[d.under]));
  const listedDefs = shownDefs.filter((d) => !d.under);
  const rows = scope?.rows;
  /** How many a choice would leave, with the filters on (none when the page can't say). */
  const count = (d: FilterDef, v: string) => {
    if (d.uncounted || !rows || !scope?.matches) return undefined;
    const next = { ...values, [d.key]: v };
    return rows.reduce((n, r) => n + (scope.matches!(r, next) ? 1 : 0), 0);
  };
  /** What's typed, read: its keywords as filters, its words added to those searched. */
  const reading = (s: string) => {
    const r = read(defs, s, values);
    return { ...r, next: { ...r.next, q: [q, r.words].filter(Boolean).join(" ") } };
  };

  const keepValues = (next: Values, push = true) => { clearTimeout(timer.current); scope?.commit(next, push); };
  /** Back to the list of every filter, nothing typed. */
  const reset = () => { setDraft(""); setCat(null); setActive(0); setWas(null); };
  const change = (k: string, v: string, rest = "") => {
    let next = { ...values, [k]: v };
    // Off: those under it go too.
    if (!v) for (const d of defs) if (d.under === k) next[d.key] = "";
    if (scope?.adjust) next = scope.adjust(next, k);
    reset();
    if (rest.trim()) { setDraft(rest); setOpen(true); } else setOpen(false);
    keepValues(next);
  };
  /** Elsewhere, in its scope: the page that lists it, searched. */
  const goTo = (key: string, w: string) => {
    const [, , href] = SCOPES.find(([k]) => k === key)!;
    reset(); setOpen(false); input.current?.blur(); onDone?.();
    go(w.trim() ? `${href}?q=${enc(w.trim())}` : href);
  };
  /** Searching everything for what's typed (the scope's chip off). */
  const everything = (text = draft) => { setEverywhere(true); setCat(null); setDraft(text); setActive(0); setOpen(true); input.current?.focus(); };
  /** Back in the page's scope. */
  const backInScope = () => { setEverywhere(false); setCat(null); setActive(0); setOpen(true); input.current?.focus(); };

  // Typed: the page narrowed a moment after the typing stops; kept only once it's chosen.
  const type = (v: string) => {
    setDraft(v);
    setOpen(true);
    setActive(0);
    if (!scope) return;
    clearTimeout(timer.current);
    // A keyword still being typed (`tag:`, `stage:app`) narrows nothing until it's chosen or whole.
    const ts = tokens(v);
    const end = ts[ts.length - 1];
    const typing = end?.key && v.length === end.end && (end.key === "in" || defsFor(defs, end.key).length) && !resolve(defs, end.key, end.value);
    const settled = typing ? v.slice(0, end.start) : v;
    timer.current = setTimeout(() => scope.preview(reading(settled).next), 150);
  };
  // What's typed, kept: its keywords as chips, its words searched (their chip); an `in:` elsewhere goes there.
  const keep = () => {
    if (!scope || !draft.trim()) { setWas(null); return; }
    const r = reading(draft);
    if (r.scope && r.scope !== scope.key) { goTo(r.scope, r.words); return; }
    keepValues(r.next, false);
    setDraft("");
    setWas(null);
  };

  // ---- the chips: the scope, the words searched, then each filter on ----
  const chipText = (k: string): string => {
    const v = values[k];
    if (k === "q") return `“${v}”`;
    const d = byKey.get(k)!;
    if (d.chip) return d.chip(v);
    return `${d.label}: ${d.choices.find(([x]) => x === v)?.[1] ?? v}`;
  };
  const chips = scope ? ["q", ...defs.map((d) => d.key)].filter((k) => values[k] && (k === "q" || byKey.has(k))).map((k) => ({
    k, text: chipText(k), typed: k === "q" ? values.q : typed(byKey.get(k)!, values[k]),
    remove: () => change(k, ""),
    // Changing it: the words back to typing (still searched), a filter's choices (one under another, that one's).
    edit: k === "q"
      ? () => { setWas(q); setDraft(q); setCat(null); setOpen(true); keepValues({ ...values, q: "" }, false); scope.preview(values); input.current?.focus(); }
      : () => { setCat(byKey.get(k)!.under || k); setDraft(""); setActive(0); setOpen(true); input.current?.focus(); },
  })) : [];

  // ---- the list ----
  const groups: Group[] = [];
  const fits = (text: string, t: string[]) => t.every((w) => lc(text).includes(w));
  const choiceOpt = (d: FilterDef, [v, l]: [string, string], rest = "", quiet = false): Opt => {
    const current = values[d.key] === v;
    return { id: `${d.key}-${v}`, text: l, hint: typed(d, v), count: count(d, v), current, quiet, pick: () => change(d.key, current ? "" : v, rest) };
  };
  const leaves = (o: Opt) => o.count == null || o.count > 0 || o.current;
  const browse = (k: string) => () => { setCat(k); setDraft(""); setActive(0); };
  const containing = (d: FilterDef, v: string, rest = ""): Opt => ({ id: `${d.key}-typed`, text: d.contains!(v), hint: `${d.keyword}:${v}`, pick: () => change(d.key, v, rest) });
  // The last piece typed, if it's a keyword's (`stage:app`): that keyword's choices, narrowed.
  const all = tokens(draft);
  const last = all[all.length - 1];
  const keyed = last?.key && draft.length === last.end ? last : null;
  const before = keyed ? draft.slice(0, keyed.start) : draft;
  const scopeOpts = (t: string[], w: string): Opt[] => SCOPES.filter(([k, n]) => fits(`${k} ${n}`, t)).map(([k, n]) => ({
    id: `in-${k}`, text: scope?.key === k ? `${n} (here)` : n, hint: `in:${k}`, current: page?.key === k && !!scope, more: true,
    pick: () => (page?.key === k ? (setDraft(before), backInScope()) : goTo(k, w)),
  }));

  if (keyed?.key === "in") {
    // `in:` → where: the scopes it could be.
    groups.push({ title: "Search in", opts: scopeOpts(words(keyed.value), read(defs, before).words) });
  } else if (scope) {
    const d = cat ? byKey.get(cat) : null;
    const typedWords = words(draft);
    if (keyed && defsFor(defs, keyed.key!).length) {
      // `keyword:…` → its choices (or, for any text, that), narrowed by what's after the colon.
      for (const x of defsFor(defs, keyed.key!).filter((x) => !x.under || values[x.under])) {
        const t = words(keyed.value);
        const opts = x.choices.filter(([v, l]) => fits(`${l} ${wordOf(x, v)}`, t)).map((c) => choiceOpt(x, c, before)).filter(leaves);
        if (x.contains && keyed.value.trim()) opts.unshift(containing(x, keyed.value.trim(), before));
        if (opts.length) groups.push({ title: x.label, opts });
      }
    } else if (d) {
      // One filter's choices, narrowed by what's typed (those that would leave some first);
      // back to every filter first, and any filter under it after.
      const choices = d.choices.filter(([v, l]) => fits(`${l} ${wordOf(d, v)}`, typedWords)).map((c) => choiceOpt(d, c, "", true))
        .sort((a, b) => Number(!leaves(a)) - Number(!leaves(b)));
      if (d.contains && typedWords.length) choices.unshift(containing(d, draft.trim()));
      groups.push({ title: "", opts: [{ id: "back", text: "All filters", back: true, pick: reset }] }, { title: d.label, opts: choices });
      for (const u of shownDefs.filter((x) => x.under === d.key)) groups.push({ title: "", opts: u.choices.map((c) => choiceOpt(u, c)) });
    } else if (!typedWords.length) {
      // Nothing typed: every filter, with what it's set to, and its keyword.
      groups.push({ title: "Filter by", opts: listedDefs.map((x) => {
        const set = values[x.key] ? (x.choices.find(([v]) => v === values[x.key])?.[1] ?? values[x.key]) : "";
        return { id: `cat-${x.key}`, text: set ? `${x.label}: ${set}` : x.label, hint: `${x.keyword}:`, more: true, current: !!set, pick: browse(x.key) };
      }) });
    } else {
      // Typed: what it reads as (keywords, typed whole), the choices its last words could mean
      // (leaving out those that would leave none), the filters it names, then searching for it,
      // here or everywhere.
      const r = read(defs, draft);
      const meant = tokens(draft).filter((t) => t.key && (t.key === "in" || resolve(defs, t.key, t.value)));
      for (const x of shownDefs) {
        const hits = x.choices.filter(([v, l]) => fits(`${l} ${wordOf(x, v)}`, typedWords) || fits(`${x.label} ${l}`, typedWords)).map((c) => choiceOpt(x, c)).filter(leaves);
        if (hits.length) groups.push({ title: x.label, opts: hits.slice(0, FEW) });
      }
      const named = listedDefs.filter((x) => fits(`${x.label} ${x.keyword}`, typedWords)).map((x): Opt => ({ id: `cat-${x.key}`, text: x.label, hint: `${x.keyword}:`, more: true, pick: browse(x.key) }));
      if (named.length) groups.push({ title: "Filter by", opts: named });
      const w = r.words.trim();
      groups.push({ title: "", opts: [
        ...(meant.length || w ? [{ id: "search", text: meant.length ? `Apply “${draft.trim()}”` : `Search ${scope.name.toLowerCase()} for “${w}”`, pick: () => { keep(); setOpen(false); } }] : []),
        ...(meant.length ? [] : listedDefs.filter((x) => x.contains).map((x) => containing(x, draft.trim()))),
        ...(w ? [{ id: "everywhere", text: `Search everything for “${w}”`, more: true, pick: () => everything(w) }] : []),
      ] });
    }
  } else {
    // Everything: an `in:` typed whole, there first; back in the page's scope (if it has one); then what matches.
    const r = read([], draft);
    if (r.scope) {
      const [, name] = SCOPES.find(([k]) => k === r.scope)!;
      groups.push({ title: "", opts: [{ id: "in", text: r.words ? `Search ${name.toLowerCase()} for “${r.words}”` : `Search ${name.toLowerCase()}`, hint: `in:${r.scope}`, more: true, pick: () => goTo(r.scope!, r.words) }] });
    }
    if (page) groups.push({ title: "", opts: [{ id: "scope", text: draft.trim() ? `Search ${page.name.toLowerCase()} for “${draft.trim()}”` : `Search ${page.name.toLowerCase()}`, hint: `in:${page.key}`, more: true, pick: backInScope }] });
    for (const g of found || []) {
      const opts: Opt[] = g.items.map((it) => ({
        id: `${g.kind}-${it.id}`, picture: picture(g.kind, it),
        text: <span className="search-hit__text"><span className="search-hit__label" translate="no">{it.label || "Untitled"}</span>{detail(g.kind, it)}</span>,
        pick: () => choose(it.href),
      }));
      if (g.count > g.items.length) opts.push({ id: `${g.kind}-all`, text: <span className="search-hit__all">{g.more ? `See all ${g.title.toLowerCase()}` : `See all ${g.count}`}</span>, pick: () => choose(`${ALL_OF[g.kind]}?q=${enc(wanted.trim())}`) });
      groups.push({ title: g.title, opts });
    }
  }
  function choose(href: string) { reset(); setOpen(false); input.current?.blur(); onDone?.(); go(href); }
  const flat = groups.flatMap((g) => g.opts);
  const at = Math.min(active, flat.length - 1);
  const nothing = !scope && wanted.trim() && found && !found.length;
  const listed = open && (flat.length > 0 || !!nothing);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      if (!flat.length) return;
      setActive((a) => (e.key === "ArrowDown" ? (a + 1) % flat.length : (a - 1 + flat.length) % flat.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (listed && flat[at]) flat[at].pick(); else keep();
    } else if (e.key === "Escape") {
      // A step back each time: out of a filter's choices, what's typed, the list, the field.
      e.preventDefault();
      e.stopPropagation();
      if (cat) reset();
      else if (was != null) { setDraft(""); setWas(null); keepValues({ ...values, q: was }, false); }
      else if (draft) type("");
      else if (open) setOpen(false);
      else { input.current?.blur(); onDone?.(); }
    } else if (e.key === "Backspace" && !draft && input.current?.selectionStart === 0) {
      // Nothing typed: out of a filter's choices, the last chip off, then the scope's.
      if (cat) { reset(); return; }
      const lastChip = chips[chips.length - 1];
      if (lastChip) { e.preventDefault(); lastChip.remove(); }
      else if (scope) { e.preventDefault(); everything(""); }
    }
  };

  const on = scope ? countOn(values) : 0;
  const option = (o: Opt) => `${id}-${o.id}`;
  let n = -1;
  const help = S.META?.search_help as string | undefined;
  return (
    <div className="topbar-search" ref={box} role="search"
      onBlur={(e) => { if (!box.current?.contains(e.relatedTarget as Node)) { if (scope) keep(); setOpen(false); setCat(null); } }}>
      <div className={`al-input filter-input${chips.length || scope ? " set" : ""}`}
        onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); input.current?.focus(); setOpen(true); } }}>
        <SysIcon name="search" />
        {scope || chips.length ? (
          <ul className="filter-chips" aria-label="Searching">
            {scope ? (
              <li><span className="al-tag search-scope" title={`Searching ${scope.name.toLowerCase()} (in:${scope.key})`}>
                <span className="filter-chip">{scope.name}</span>
                <button className="al-tag__remove" type="button" aria-label={`Search everything, not just ${scope.name.toLowerCase()}`} title="Search everything" onClick={() => everything()}>×</button>
              </span></li>
            ) : null}
            {chips.map((c) => (
              <li key={c.k}><span className="al-tag">
                <button type="button" className="filter-chip" title={`Change ${c.text} (${c.typed})`} onClick={c.edit}>{c.text}</button>
                <button className="al-tag__remove" type="button" aria-label={`Remove filter: ${c.text}`} title="Remove" onClick={c.remove}>×</button>
              </span></li>
            ))}
          </ul>
        ) : null}
        {/* Where to type, how many pass, clearing them and help: kept together when the chips wrap. */}
        <span className="filter-tail">
          <input ref={input} type="search" className="filter-input__text" value={draft} autoFocus={autoFocus}
            placeholder={cat ? "Type to narrow" : scope ? (chips.length ? "Add a filter or words" : scope.placeholder) : "Search applications, companies, people, notes and files"}
            aria-label={scope ? `Search ${scope.name.toLowerCase()}` : "Search everything"}
            role="combobox" aria-expanded={listed} aria-controls={`${id}-list`} aria-autocomplete="list"
            aria-activedescendant={listed && flat[at] ? option(flat[at]) : undefined}
            onChange={(e) => type(e.target.value)} onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onKeyDown={onKey} />
          {draft || chips.length || onDone ? null : <kbd className="al-kbd filter-kbd" aria-hidden="true">/</kbd>}
          {/* How many pass, and every filter off at once. */}
          {scope && scope.total != null && (on || draft.trim()) ? (
            <span className="filter-count" aria-live="polite" title={`${scope.shown} of ${scope.total} shown`}>{`${nf(scope.shown ?? 0)} of ${nf(scope.total)}`}</span>
          ) : null}
          {scope && on ? (
            <button className="al-search__clear filter-clear" type="button" aria-label="Clear all filters" title="Clear all filters" onClick={() => { reset(); scope.clear(); }}>
              <SysIcon name="close" className="al-icon al-icon--sm" />
            </button>
          ) : !scope && draft ? (
            <button className="al-search__clear filter-clear" type="button" aria-label="Clear search" title="Clear search" onClick={() => { type(""); input.current?.focus(); }}>
              <SysIcon name="close" className="al-icon al-icon--sm" />
            </button>
          ) : null}
        </span>
      </div>
      <div className="search-results filter-results" hidden={!listed}>
        <ul id={`${id}-list`} role="listbox" aria-label={scope ? "Filters" : "Results"}>
          {groups.filter((g) => g.opts.length).map((g, gi) => (
            <li key={`${gi}-${g.title}`} role="presentation" className="search-group">
              {g.title ? <span className="search-group__title" aria-hidden="true">{g.title}</span> : null}
              <ul role="group" aria-label={g.title || undefined}>
                {g.opts.map((o) => {
                  const i = ++n;
                  return (
                    <li key={o.id} id={option(o)} role="option" aria-selected={i === at}
                      className={`search-hit filter-hit${o.quiet && !leaves(o) ? " is-empty" : ""}`}
                      onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => { o.pick(); input.current?.focus(); }}>
                      {o.back ? <Icon name="back" className="al-icon al-icon--sm flip-rtl" /> : o.picture ?? null}
                      {typeof o.text === "string" ? <span className="filter-hit__text">{o.text}</span> : o.text}
                      {o.hint ? <code className="filter-hit__keyword" translate="no" dir="ltr">{o.hint}</code> : null}
                      {o.current ? <Icon name="check" className="al-icon al-icon--sm filter-hit__on" /> : null}
                      {o.count != null ? <span className="filter-hit__count">{nf(o.count)}</span> : null}
                      {o.more ? <Icon name="forward" className="al-icon al-icon--sm flip-rtl filter-hit__more" /> : null}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
        {nothing ? <p className="search-none" role="status">Nothing matches. Try other words.</p> : null}
        {help ? (
          <p className="search-help">
            <a href={help} target="_blank" rel="noopener" onMouseDown={(e) => e.preventDefault()}>
              <Icon name="info" className="al-icon al-icon--sm" /><span>Keywords and tips</span>
            </a>
          </p>
        ) : null}
      </div>
    </div>
  );
}

