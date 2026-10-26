// Toasts: a line about what just happened, the design system's; hunt's own
// red one for an error. Drawn by <Toaster/>.

import { S, createStore } from "./state";

export interface ToastAction { label: string; onclick: () => void }
export interface Toast { id: number; message: string; kind: string; action: ToastAction | null; leaving: boolean }

export const toasts = createStore<Toast[]>([]);
let uid = 0;

const drop = (id: number) => toasts.set(toasts.get().filter((t) => t.id !== id));

/** How long a toast with an action (Undo) stays, in ms: as the admins set it (5 seconds unless changed), or 0, until it's used or dismissed. */
const undoStay = () => 1000 * (S.META?.undo_seconds ?? 5);

export function toast(message: string, kind = "info", action: ToastAction | null = null) {
  // With an action (Undo), it stays as long as the admins say, or until it's
  // used, dismissed, or replaced by the next one with an action.
  const t: Toast = { id: ++uid, message, kind, action, leaving: false };
  toasts.set([...(action ? toasts.get().filter((x) => !x.action) : toasts.get()), t]);
  const stay = action ? undoStay() : kind === "error" ? 6000 : 2500;
  if (!stay) return;
  setTimeout(() => toasts.set(toasts.get().map((x) => (x.id === t.id ? { ...x, leaving: true } : x))), stay);
  setTimeout(() => drop(t.id), stay + 500);
}

/** Take a toast away (its action used, or dismissed). */
export const dismissToast = drop;
