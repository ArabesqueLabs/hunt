"use strict";

// Speaking the reader's language: hunt's words, translated as they're drawn.
//
// The code writes English. A language's catalog (i18n-ar.js for Arabic)
// maps each English phrase to its translation, and this file swaps them in
// as the page draws: text, and the placeholder, title, aria-label and alt
// attributes. A phrase with numbers or names in it is a pattern ("{n}
// active, {m} archived."), whose parts are translated too, when they can be.
// What people wrote (names, notes, postings, emails) is kept as written:
// anything inside translate="no".
//
// A language also sets the page's direction (right to left for Arabic) and
// how numbers are written. Loaded before app.js; app.js calls setLanguage
// once the settings are in.

/** Each language's catalog, as its file adds it: {phrases: {en: tr}, patterns: [[en, tr]]}. */
const CATALOGS = {};

/** The language the page is in; English needs no catalog. */
let LANG = "en";
/** Which digits numbers use: "latn", "arab", or null for the language's own. */
let DIGITS = null;
let EXACT = new Map();
let PATTERNS = [];

/**
 * The catalog's patterns as regular expressions, {name} becoming a named
 * group: a number for {n}, {m}, {n2} …, anything else for other names. The
 * most specific (the most fixed words) is tried first.
 */
function compilePatterns(list) {
  return list.map(([from, to]) => {
    const source = from.replace(/[.*+?^$()|[\]\\]/g, "\\$&")
      .replace(/\{(\w+)\}/g, (_, name) => (/^(n\d*|m)$/.test(name) ? `(?<${name}>[0-9٠-٩][0-9٠-٩.,]*)` : `(?<${name}>.+?)`));
    return { re: new RegExp(`^${source}$`, "s"), to, fixed: from.replace(/\{\w+\}/g, "").length };
  }).sort((a, b) => b.fixed - a.fixed);
}

/** A phrase in the current language, or null when the catalog has none. Spaces around it are kept. */
function translatePhrase(text) {
  if (LANG === "en" || text == null) return null;
  const s = String(text);
  const key = s.trim();
  if (!key) return null;
  let hit = EXACT.get(key);
  if (hit == null) {
    for (const p of PATTERNS) {
      const m = p.re.exec(key);
      if (!m) continue;
      hit = p.to.replace(/\{(\w+)\}/g, (_, name) => {
        const v = m.groups?.[name] ?? "";
        return translatePhrase(v) ?? v;
      });
      break;
    }
  }
  return hit == null ? null : s.replace(key, () => hit);
}

/** Translate a phrase for code that isn't drawn (confirm boxes, the title); `vars` fill its {name}s. */
function t(text, vars) {
  let out = translatePhrase(text) ?? String(text);
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return withDigits(out);
}

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
/**
 * Digits in the script chosen: Arabic-Indic, when that's how numbers are
 * written. Addresses, emails and version numbers keep theirs.
 */
function withDigits(s) {
  if (DIGITS !== "arab" || !/[0-9]/.test(s) || /:\/\/|@|\bv?\d+\.\d+\.\d+/.test(s)) return s;
  return s.replace(/[0-9]/g, (d) => ARABIC_DIGITS[d]);
}

// ---- the page --------------------------------------------------------------------------

/**
 * Left as written: code, what people type, anything marked translate="no",
 * and what people wrote: names on cards, lists and pages, postings, emails,
 * notes, tags.
 */
const KEEP = ["script", "style", "textarea", "code", "pre", "[translate=no]", "[contenteditable]",
  ".card-company", ".card-role", "#app-title", ".app-title h1", ".with-logo b", ".with-logo a",
  ".posting-text", ".email-plain", ".email-quote", ".app-notes", ".note-body", ".al-tag", ".clamp", ".brand"].join(", ");
const ATTRS = ["placeholder", "title", "aria-label", "alt"];

function translateText(node) {
  const parent = node.parentElement;
  if (!parent || parent.closest(KEEP)) return;
  const was = node.data;
  const now = withDigits(translatePhrase(was) ?? was);
  if (now !== was) node.data = now;
}

function translateAttrs(el) {
  for (const a of ATTRS) {
    const was = el.getAttribute(a);
    if (was == null) continue;
    const now = withDigits(translatePhrase(was) ?? was);
    if (now !== was) el.setAttribute(a, now);
  }
}

/** Translate an element and everything in it, or one text node. */
function translateTree(node) {
  if (node.nodeType === Node.TEXT_NODE) { translateText(node); return; }
  if (node.nodeType !== Node.ELEMENT_NODE || node.closest(KEEP)) return;
  translateAttrs(node);
  const walk = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeType === Node.ELEMENT_NODE && n.matches(KEEP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) translateText(n);
    else translateAttrs(n);
  }
}

// What's drawn from now on is translated as it appears. A translation set
// here changes the page again; the second pass finds nothing left to do.
const translator = new MutationObserver((changes) => {
  for (const c of changes) {
    if (c.type === "childList") c.addedNodes.forEach(translateTree);
    else if (c.type === "characterData") translateText(c.target);
    else if (c.type === "attributes" && !c.target.closest(KEEP)) translateAttrs(c.target);
  }
});

/**
 * Speak `lang` (a code from META.languages), writing numbers in `digits`
 * ("latn", "arab", or "auto" for the language's own). Sets the page's
 * language and direction, and translates what's there and what comes.
 */
function setLanguage(lang, digits = "auto") {
  LANG = CATALOGS[lang] ? lang : "en";
  const cat = CATALOGS[LANG];
  DIGITS = digits === "auto" ? (cat?.digits ?? null) : digits;
  const root = document.documentElement;
  root.lang = LANG;
  // English, and any language without a catalog, reads left to right.
  root.dir = cat?.dir || "ltr";
  translator.disconnect();
  EXACT = new Map(Object.entries(cat?.phrases || {}));
  PATTERNS = compilePatterns(cat?.patterns || []);
  if (LANG === "en" && DIGITS !== "arab") return;
  translateTree(document.head);
  translateTree(document.body);
  translator.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

// Boxes the browser draws itself say the same in the reader's language.
{
  const ask = window.confirm.bind(window);
  window.confirm = (message) => ask(t(message));
}
