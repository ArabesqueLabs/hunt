// The theme (Settings → Appearance): auto follows the system; light or
// dark is remembered, in this browser.

import { store, stored } from "./storage";

export const THEMES = [["auto", "Auto (follow the system)"], ["light", "Light"], ["dark", "Dark"]];
export const currentTheme = () => stored("theme") || "auto";
export function setTheme(t: string) {
  store("theme", t);
  if (t === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}
