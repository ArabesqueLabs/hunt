// What's typed into a form and not yet saved. A form that asks (marked
// data-unsaved: the dialogs, forms edited in the page) is read the moment
// someone first touches it, and closing it, or leaving the page, compares
// it with that: if it's changed, it asks before what's written is lost.

/** A form's controls, and what they held, the moment it was first touched. */
interface Snapshot { controls: Element[]; state: string }
const snapshots = new WeakMap<Element, Snapshot>();

// Its fields, the rich text in it (RichText keeps what's written on its
// data-rich), and its segmented choices; not the rich text's own textarea,
// which only types until the editor loads.
const CONTROLS = "input:not([type=hidden]), select, textarea:not(.rich-editor[data-ready] textarea), .rich-editor[data-ready], .al-segmented [aria-pressed]";

const controlsOf = (form: Element) => [...form.querySelectorAll(CONTROLS)];
const stateOf = (controls: Element[]) => JSON.stringify(controls.map((c) => {
  if (c instanceof HTMLInputElement) return c.type === "checkbox" || c.type === "radio" ? c.checked : c.value;
  if (c instanceof HTMLSelectElement || c instanceof HTMLTextAreaElement) return c.value;
  return c.getAttribute("data-rich") ?? c.getAttribute("aria-pressed");
}));

/** A form's snapshot, while it's the form it was: once all its controls are gone, it's another. */
function current(form: Element): Snapshot | null {
  const s = snapshots.get(form);
  return s && s.controls.some((c) => c.isConnected && form.contains(c)) ? s : null;
}

// The first touch: before the key, click, paste or drop changes anything.
const touched = (e: Event) => {
  if (!e.isTrusted) return;
  const form = (e.target as Element).closest?.("[data-unsaved]");
  if (!form || current(form)) return;
  const controls = controlsOf(form);
  snapshots.set(form, { controls, state: stateOf(controls) });
};
for (const type of ["pointerdown", "keydown", "paste", "drop"]) document.addEventListener(type, touched, true);

/** Whether `form` (or the form `el` is in) has changes not yet saved. */
export function unsaved(el: Element | null | undefined): boolean {
  const form = el?.closest("[data-unsaved]");
  const s = form && current(form);
  return !!s && stateOf(controlsOf(form)) !== s.state;
}

/** Whether a form anywhere on the page has changes not yet saved. */
export const anyUnsaved = () => [...document.querySelectorAll("[data-unsaved]")].some(unsaved);

/**
 * Whether to go on closing the form `el` is in: nothing in it is unsaved,
 * or the person says to discard it. Closing it forgets what it was.
 */
export function mayDiscard(el: Element | null | undefined): boolean {
  if (unsaved(el) && !confirm("Discard your changes?")) return false;
  const form = el?.closest("[data-unsaved]");
  if (form) snapshots.delete(form);
  return true;
}

// Closing the tab, or reloading it, asks too.
window.addEventListener("beforeunload", (e) => { if (anyUnsaved()) { e.preventDefault(); e.returnValue = ""; } });
