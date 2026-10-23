// Toasts: a line about what just happened, the design system's; hunt's own
// red one for an error. Drawn by <Toaster/>.

import { createStore } from "./state";

export interface ToastAction { label: string; onclick: () => void }
export interface Toast { id: number; message: string; kind: string; action: ToastAction | null; leaving: boolean }

export const toasts = createStore<Toast[]>([]);
let uid = 0;

const drop = (id: number) => toasts.set(toasts.get().filter((t) => t.id !== id));

export function toast(message: string, kind = "info", action: ToastAction | null = null) {
  // With an action (Undo), it has no time limit (WCAG 2.2.1): it stays until
  // it's used, dismissed, or replaced by the next one with an action.
  const t: Toast = { id: ++uid, message, kind, action, leaving: false };
  toasts.set([...(action ? toasts.get().filter((x) => !x.action) : toasts.get()), t]);
  if (action) return;
  const stay = kind === "error" ? 6000 : 2500;
  setTimeout(() => toasts.set(toasts.get().map((x) => (x.id === t.id ? { ...x, leaving: true } : x))), stay);
  setTimeout(() => drop(t.id), stay + 500);
}

/** Take a toast away (its action used, or dismissed). */
export const dismissToast = drop;
