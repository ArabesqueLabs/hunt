// Dialogs, the design system's: the one modal a page opens (a new
// application, starting a cycle …), and small questions asked over whatever
// is open, each in a dialog of its own. Closing the modal with something
// written in it and not saved (Cancel, Escape, a click outside) asks first.

import { Fragment, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { onLeave } from "../lib/router";
import { createStore, useStore } from "../lib/state";
import { mayDiscard } from "../lib/unsaved";

// ---- the modal ------------------------------------------------------------------------

interface Modal { content: ReactNode; wide: boolean; onClose?: () => void; key: number }
const modal = createStore<Modal | null>(null);
let modalEl: HTMLDialogElement | null = null;
let modalKey = 0;

/** Open the modal with `content` (or put it in place of what's in it). */
export function openModal(content: ReactNode, { wide = false, onClose }: { wide?: boolean; onClose?: () => void } = {}) {
  modal.set({ content, wide, onClose, key: ++modalKey });
}

/** Close the modal, what's in it done with (saved, or nothing to save). */
export function closeModal() {
  if (modalEl?.open) modalEl.close();
  else if (modal.get()) { const m = modal.get(); modal.set(null); m?.onClose?.(); }
}

/** Close the modal without what's in it: asking first, if something's written there. */
export function dismissModal() {
  if (mayDiscard(modalEl)) closeModal();
}

/** Whether the modal is open. */
export const modalOpen = () => !!modalEl?.open;

// The dialog left open (a new application) closes as the page changes.
onLeave(() => {
  const m = modal.get();
  if (m) m.onClose = undefined;
  closeModal();
});

export function ModalHost() {
  const m = useStore(modal);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { modalEl = ref.current; return () => { modalEl = null; }; }, []);
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d || !m) return;
    if (!d.open) d.showModal();
    // The cursor goes to the first field, unless something already has it.
    if (!d.contains(document.activeElement) || document.activeElement === d) {
      d.querySelector<HTMLElement>("form input:not([type=hidden]), form select, form textarea")?.focus({ preventScroll: true });
    }
  }, [m]);
  return (
    <dialog id="modal" ref={ref} className={m?.wide ? "al-dialog wide" : "al-dialog al-dialog--md"} aria-labelledby="modal-title" data-unsaved=""
      onClose={() => { const cur = modal.get(); modal.set(null); cur?.onClose?.(); }}
      onCancel={(e) => { if (!mayDiscard(e.currentTarget)) e.preventDefault(); }}
      onClick={(e) => { if (e.target === e.currentTarget && mayDiscard(e.currentTarget)) e.currentTarget.close(); }}>
      {m ? <Fragment key={m.key}>{m.content}</Fragment> : null}
    </dialog>
  );
}

// ---- dialogs of their own ----------------------------------------------------------------

interface Stacked { id: number; className: string; render: (close: () => void) => ReactNode; onClosed: () => void }
const stack = createStore<Stacked[]>([]);
let stackId = 0;

/**
 * A dialog of its own, over whatever is open: `render(close)` draws what's
 * in it; `onClosed` once it's closed (and gone).
 */
export function pushDialog({ className, render, onClosed = () => {} }: { className: string; render: (close: () => void) => ReactNode; onClosed?: () => void }) {
  stack.set([...stack.get(), { id: ++stackId, className, render, onClosed }]);
}

function StackedDialog({ d }: { d: Stacked }) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => { ref.current?.showModal(); }, []);
  const close = () => ref.current?.close();
  return (
    <dialog ref={ref} className={d.className} onClose={() => { stack.set(stack.get().filter((x) => x.id !== d.id)); d.onClosed(); }}>
      {d.render(close)}
    </dialog>
  );
}

export function DialogStack() {
  const list = useStore(stack);
  return <>{list.map((d) => <StackedDialog key={d.id} d={d} />)}</>;
}

/** A small question in its own dialog, over whatever is open. Resolves to the form's data, or null. */
export function ask({ title, body, ok = "OK", danger = false }: { title: string; body: ReactNode; ok?: string; danger?: boolean }): Promise<FormData | null> {
  return new Promise((resolve) => {
    let answered = false;
    pushDialog({
      className: "al-dialog ask",
      onClosed: () => { if (!answered) resolve(null); },
      render: (close) => (
        <form method="dialog" onSubmit={(e) => { e.preventDefault(); answered = true; resolve(new FormData(e.currentTarget)); close(); }}>
          <h2 className="al-dialog__title">{title}</h2>
          {body}
          <div className="al-dialog__actions">
            <button className="al-button" type="button" onClick={close}>Cancel</button>
            <button type="submit" className={`al-button ${danger ? "al-button--danger al-button--primary" : "al-button--primary"}`}>{ok}</button>
          </div>
        </form>
      ),
    });
  });
}

export async function confirmDelete(what: string, detail?: string | null) {
  return (await ask({ title: `Delete ${what}?`, body: <p>{detail || "This can't be undone, though the activity log keeps a record of it."}</p>, ok: "Delete", danger: true })) !== null;
}
