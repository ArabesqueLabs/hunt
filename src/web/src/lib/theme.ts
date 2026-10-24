// The theme (Settings → General): light, dark, or as the system is. Kept
// with your settings, so every device you sign in on has it; and in this
// browser too, so the page starts in it before the settings load.

import { attempt, patch } from "./api";
import { S, changed } from "./state";
import { store, stored } from "./storage";

export const currentTheme = () => S.PREFS.theme || stored("theme") || "auto";

/** Show the page in a theme, and remember it here for the next start. */
export function applyTheme(t: string) {
  store("theme", t);
  if (t === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

/** Choose a theme: shown at once, and kept with your settings (or put back, if it can't be). */
export async function chooseTheme(t: string) {
  applyTheme(t);
  const saved = await attempt(() => patch("settings", { theme: t }));
  if (saved) S.PREFS = saved;
  else applyTheme(S.PREFS.theme || "auto");
  changed();
  return !!saved;
}

/**
 * Once the settings are in: their theme. A theme chosen in this browser
 * before themes were kept with the settings is kept with them, once.
 */
export function startTheme() {
  const here = stored("theme");
  const first = stored("themeKept") !== "1";
  store("themeKept", "1");
  if (first && S.PREFS.theme === "auto" && (here === "light" || here === "dark")) chooseTheme(here);
  else applyTheme(S.PREFS.theme || "auto");
}
