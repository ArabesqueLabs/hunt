// Tags' names and colours.

import { S } from "./state";

export const tagColor = (name: string) => S.TAGS.find((t) => t.name.toLowerCase() === String(name).toLowerCase())?.color || "";
/** Tags as a list of names, from a record (an array) or a card (joined by |). */
export const tagNames = (v: unknown): string[] => (Array.isArray(v) ? v : v ? String(v).split("|") : []);
/** The shades a tag's hue comes in, lightest first; "light" is the hue's own name (`green`), the others a suffix (`green-deep`). */
export const TAG_SHADES = ["pale", "light", "bold", "deep"];
/** A tag colour's hue and shade: `green-deep` → ["green", "deep"], `green` → ["green", "light"]. */
export const tagHueShade = (color: string | null | undefined) => {
  const [hue, shade = "light"] = String(color || "").split("-");
  return [hue, shade];
};
/** The data attributes that paint a tag chip (or a swatch) a colour (style.css draws each hue and shade); none for plain. */
export function tagPaint(color: string | null | undefined): Record<string, string> {
  const [hue, shade] = tagHueShade(color);
  return color && S.META.tag_colors.some((c) => c.value === color) ? { "data-hue": hue, "data-shade": shade } : {};
}
