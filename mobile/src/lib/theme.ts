// Colours: the design system's (Arabesque, src/web/vendor/arabesque),
// light and dark, as the web UI has them. Its oklch() values, as hex.

import { useColorScheme } from "react-native";

const light = {
  bg: "#f8fafc", // cloud-98
  surface: "#ffffff",
  sunk: "#f1f5f9", // cloud-96
  text: "#0f172b", // cloud-21
  muted: "#45556c", // cloud-45
  line: "#e2e8f0", // cloud-93
  accent: "#00776b", // teal-51
  onAccent: "#ffffff",
  accentWash: "#0095861f",
  danger: "#cd171e", // red-54
  dangerWash: "#f139361a",
  warning: "#835600", // amber-49
  warningWash: "#f7cd3a4d",
};

export type Colors = typeof light;

const dark: Colors = {
  bg: "#0e121a", // slate-18
  surface: "#151921", // slate-21
  sunk: "#1c2029", // slate-24
  text: "#e8e7e3", // sand-93
  muted: "#abaaa1", // sand-74
  line: "#ffffff1f",
  accent: "#7cdcb9", // teal-83
  onAccent: "#0e121a",
  accentWash: "#7cdcb91f",
  danger: "#ef6661", // red-68
  dangerWash: "#ef666124",
  warning: "#e1b75c", // amber-80
  warningWash: "#e1b75c1f",
};

/** The colours for the phone's light or dark appearance. */
export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const radius = 8;
