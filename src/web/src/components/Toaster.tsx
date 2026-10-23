// The toasts, at the foot of the page (lib/toast.ts says what they are).

import { useEffect, useRef } from "react";
import { useStore } from "../lib/state";
import { dismissToast, toasts } from "../lib/toast";

export function Toaster() {
  const list = useStore(toasts);
  const box = useRef<HTMLDivElement>(null);
  // Where focus was when F6 took it to the toast with an action, to go back to.
  const before = useRef<Element | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = box.current?.querySelector<HTMLButtonElement>(".al-toast__action");
      if (e.key !== "F6" || !action) return;
      e.preventDefault();
      before.current = document.activeElement;
      action.focus();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  const done = (id: number, el: HTMLElement | null) => {
    const back = el?.contains(document.activeElement) || document.activeElement === document.body;
    dismissToast(id);
    if (back) (before.current as HTMLElement | null)?.focus?.();
    before.current = null;
  };
  return (
    <div id="toasts" ref={box} className="al-toaster" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`al-toast${t.kind === "error" ? " error" : ""}`} data-leaving={t.leaving ? "" : undefined}>
          <span>{t.message}</span>
          {t.action ? <button className="al-toast__action" type="button" onClick={(e) => { done(t.id, e.currentTarget.parentElement); t.action!.onclick(); }}>{t.action.label}</button> : null}
          {t.action ? <button className="al-toast__dismiss" type="button" aria-label="Dismiss" title="Dismiss" onClick={(e) => done(t.id, e.currentTarget.parentElement)}>×</button> : null}
        </div>
      ))}
    </div>
  );
}
