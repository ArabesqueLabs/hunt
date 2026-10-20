// Tooltips for anything with data-al-tip ("value|what it is"): shown on
// hover and on keyboard focus, hidden on leaving, on blur and on Escape;
// it stays while the pointer is over it, or crossing to it (WCAG 1.4.13).
// The text is also the element's accessible description, so it isn't only
// seen; descriptions the element already has are kept.
import { place } from "./position.js";

const ID = "al-tooltip";
// Long enough to cross the gap between the target and the tip.
const GRACE = 300;
let tip;
let shownFor = null;
let hideTimer;
const inited = new WeakSet();

function element() {
  if (tip?.isConnected) return tip;
  tip = document.createElement("div");
  tip.className = "al-tooltip";
  tip.setAttribute("role", "tooltip");
  tip.id = ID;
  tip.hidden = true;
  tip.addEventListener("pointerenter", () => clearTimeout(hideTimer));
  tip.addEventListener("pointerleave", (e) => { if (!shownFor?.contains(e.relatedTarget)) hideSoon(); });
  document.body.append(tip);
  return tip;
}
const describedBy = (el) => (el.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
function show(target) {
  clearTimeout(hideTimer);
  if (shownFor && shownFor !== target) hide();
  const el = element();
  const [value, what] = target.dataset.alTip.split("|");
  el.replaceChildren(...[Object.assign(document.createElement("b"), { textContent: value }), what ? ` ${what}` : ""].filter(Boolean));
  el.hidden = false;
  shownFor = target;
  // Its description, unless its name already says the same (a chart's mark).
  const ids = describedBy(target);
  const same = target.getAttribute("aria-label")?.trim() === el.textContent.trim();
  if (!same && !ids.includes(ID)) target.setAttribute("aria-describedby", [...ids, ID].join(" "));
  place(el, target, { side: "above" });
}
function hide() {
  clearTimeout(hideTimer);
  if (tip) tip.hidden = true;
  if (shownFor) {
    const ids = describedBy(shownFor).filter((id) => id !== ID);
    if (ids.length) shownFor.setAttribute("aria-describedby", ids.join(" "));
    else shownFor.removeAttribute("aria-describedby");
  }
  shownFor = null;
}
function hideSoon() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hide, GRACE);
}
export function initTooltips(root = document) {
  if (inited.has(root)) return;
  inited.add(root);
  root.addEventListener("pointerover", (e) => { const t = e.target.closest?.("[data-al-tip]"); if (t) show(t); });
  root.addEventListener("pointerout", (e) => {
    if (shownFor && !shownFor.contains(e.relatedTarget) && !tip?.contains(e.relatedTarget)) hideSoon();
  });
  root.addEventListener("focusin", (e) => { const t = e.target.closest?.("[data-al-tip]"); if (t) show(t); });
  root.addEventListener("focusout", (e) => { if (shownFor && !shownFor.contains(e.relatedTarget)) hide(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && shownFor) hide(); });
  // It follows its target while the page scrolls, and goes once the target is out of view.
  addEventListener("scroll", () => {
    if (!shownFor || tip.hidden) return;
    const r = shownFor.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) hide(); else place(tip, shownFor, { side: "above" });
  }, { capture: true, passive: true });
}
