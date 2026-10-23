// hunt's web UI: a client of the JSON API under /api, like the CLI. React,
// built with Vite into one script and one stylesheet, which the service
// compiles in (see vite.config.ts).

import "../vendor/arabesque/arabesque.css";
import "../tokens.css";
import "../style.css";
import "../footer.css";

import { createRoot } from "react-dom/client";
import { initTooltips } from "../vendor/arabesque/js/tooltip.js";
import { App } from "./App";
import { setLanguage } from "./lib/i18n";
import { reloadMeta } from "./lib/meta";
import { startRouting } from "./lib/router";
import { S } from "./lib/state";

/**
 * Tooltips (the design system's) on the controls that are only an icon,
 * from their name (aria-label, or title, which then gives way so the
 * browser's own doesn't show too); and on the sidebar's links while it's
 * collapsed to icons. Set as the pointer or the focus comes to one, before
 * the tooltip looks, so they're in the page's language as it is then.
 */
function tipIcons(e: Event) {
  const el = (e.target as Element).closest?.("button, a, summary, [role=button], [title]") as HTMLElement | null;
  if (!el || el.closest(".al-tooltip")) return;
  let name: string | null = null;
  if (el.matches(".al-sidebar__link")) {
    const rail = document.querySelector('[data-sidebar="collapsed"]') && !matchMedia("(max-width: 52rem)").matches;
    // Its label's lines (a cycle's: name, state, week) on one.
    if (rail) name = (el.querySelector(".al-sidebar__label") as HTMLElement | null)?.innerText.trim().split(/\s*\n\s*/).join(" · ") || null;
    if (name) el.setAttribute("aria-label", name);
    else if (el.dataset.iconTip) el.removeAttribute("aria-label");
  } else if (el.querySelector("svg") && !el.textContent?.trim()) {
    if (el.title && !el.getAttribute("aria-label")) el.setAttribute("aria-label", el.title);
    el.removeAttribute("title");
    name = el.getAttribute("aria-label");
  }
  if (name) {
    // "|name": the name in the tip's plain weight (its bold part, a value, is empty).
    el.dataset.alTip = `|${name}`;
    el.dataset.iconTip = "1";
  } else if (el.dataset.iconTip) {
    delete el.dataset.alTip;
    delete el.dataset.iconTip;
  }
}

// The collapsed sidebar's tooltips: beside the link (after it, as the page
// reads), level with it, once the tooltip has put itself above.
function tipBeside(e: Event) {
  const link = (e.target as Element).closest?.(".al-sidebar__link[data-icon-tip]");
  const tip = document.getElementById("al-tooltip");
  if (!link || !tip || tip.hidden) return;
  const r = link.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  const rtl = getComputedStyle(link).direction === "rtl";
  tip.style.left = `${rtl ? r.left - 8 - t.width : r.right + 8}px`;
  tip.style.top = `${Math.max(8, r.top + r.height / 2 - t.height / 2)}px`;
}

document.addEventListener("pointerover", tipIcons, true);
document.addEventListener("focusin", tipIcons, true);
window.addEventListener("pointerover", tipBeside);
window.addEventListener("focusin", tipBeside);
initTooltips(document);
startRouting();

const root = createRoot(document.getElementById("root")!);

(async function start() {
  try {
    await reloadMeta();
    setLanguage(S.PREFS.language || "en", S.PREFS.numerals || "auto");
  } catch (e) {
    createRoot(document.getElementById("view")!).render(<div className="page"><h1>Can't load hunt</h1><p>{(e as Error).message}</p></div>);
    return;
  }
  root.render(<App />);
})();
