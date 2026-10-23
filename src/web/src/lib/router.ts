// Pages have real addresses (/applications/2, /stats): links within hunt
// change the address and draw the page without reloading; Back and Forward
// work. Old addresses (/#/applications/2) still lead to the same pages.
//
// Each visit (a link followed, go(), Back) draws the page afresh: <App/>
// keys the page by the visit, so it loads what it shows again.

import { useSyncExternalStore } from "react";

// The app's pages are real paths (/stats, /applications/2), drawn here as
// they're visited. A few of hunt's addresses aren't its pages, and load as
// pages do: the API, files, signing in and out, Cloudflare's own (/cdn-cgi/),
// and the addresses that lead elsewhere (/app/… from before, the website's).
const OUTSIDE = /^\/(api|cdn-cgi|dev|app|ar)(\/|$)|^\/(login|logout|healthz|about|docs|screenshots|privacy|terms|data-deletion)$|\.[a-z0-9]+$/i;

export const here = () => location.pathname + location.search;

// Where we were, to go back to when leaving would lose changes.
let lastUrl = here();
/** The address now is where we are (a page that changed it itself, as the calendar does). */
export const settle = () => { lastUrl = here(); };

/** Unsaved changes: a page sets this to say leaving would lose them. */
let leaveGuard: (() => boolean) | null = null;
export const setLeaveGuard = (f: (() => boolean) | null) => { leaveGuard = f; };

/** What happens as the page changes (the open dialog closes …). */
const leaving = new Set<() => void>();
export const onLeave = (f: () => void) => { leaving.add(f); return () => { leaving.delete(f); }; };

let visit = 0;
const listeners = new Set<() => void>();

/** Draw the page at the address now, afresh. */
export function route() {
  if (leaveGuard && leaveGuard() && here() !== lastUrl) {
    if (!confirm("Leave without saving your changes?")) {
      history.pushState(null, "", lastUrl || "/");
      return;
    }
  }
  leaveGuard = null;
  window.onbeforeunload = null;
  lastUrl = here();
  for (const f of leaving) f();
  visit++;
  for (const f of listeners) f();
}

/** Go to a page of hunt. */
export function go(path: string, { replace = false } = {}) {
  if (replace) history.replaceState(null, "", path);
  else if (path !== here()) history.pushState(null, "", path);
  route();
}

/** The visit being drawn: a number that changes with each. */
export function useVisit() {
  return useSyncExternalStore((f) => { listeners.add(f); return () => { listeners.delete(f); }; }, () => visit);
}

/**
 * Whether a record's page opens in Edit mode (?edit=1, from a list's edit
 * action). The address then drops it, so going back reads.
 */
export function opensEditing(query: URLSearchParams) {
  if (query.get("edit") !== "1") return false;
  query.delete("edit");
  history.replaceState(null, "", location.pathname + (query.toString() ? `?${query}` : ""));
  settle();
  return true;
}

/** Start listening: Back and Forward, and links within hunt, drawn here, not loaded again. */
export function startRouting() {
  // An old address, with the page after #: the same page, at its new address.
  if (location.hash.startsWith("#/")) history.replaceState(null, "", location.hash.slice(1));
  window.addEventListener("popstate", route);
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element).closest?.("a[href]") as HTMLAnchorElement | null;
    // data-reload: one of hunt's own pages outside the app (the privacy notice …).
    if (!a || a.target || a.hasAttribute("download") || a.hasAttribute("data-reload")) return;
    const url = new URL(a.href, location.href);
    // Cloudflare's own pages (/cdn-cgi/: Access's log out and identity) aren't hunt's.
    // Only the app's own pages: the rest loads as pages do.
    if (url.origin !== location.origin || OUTSIDE.test(url.pathname)) return;
    e.preventDefault();
    go(url.pathname + url.search);
  });
}
