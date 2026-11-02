// Rich text (the web editor's HTML) as plain text, to show here; text
// written here is kept plain, which the web shows as it was written.

/** Whether text is the editor's HTML, not plain text (as the web's rich.ts reads it). */
const isRich = (v: string | null | undefined) => /^\s*<(p|h[1-6]|ul|ol|blockquote|div|pre|table)[\s>]/i.test(v || "");

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function plainText(v: string | null | undefined): string {
  if (!v) return "";
  if (!isRich(v)) return v;
  return v
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/(p|h[1-6]|li|blockquote|pre|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) =>
      e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
