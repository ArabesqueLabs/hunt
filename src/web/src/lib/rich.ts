// Rich text: what people write in the editor (TinyMCE) is kept as HTML.
// Text written before, or brought in from a page (a company's About), is
// plain: it shows as it was written, and the editor opens it as paragraphs.
// HTML is always cleaned before it's shown.

import DOMPurify from "dompurify";

// Links open in a tab of their own, and tell the page nothing of hunt.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noreferrer");
  }
});

/** Whether text is the editor's HTML, not plain text. */
export const isRich = (v: string | null | undefined) => /^\s*<(p|h[1-6]|ul|ol|blockquote|div|pre|table)[\s>]/i.test(v || "");

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Plain text as HTML for the editor: paragraphs at blank lines, line breaks kept. */
export function toHtml(v: string | null | undefined): string {
  if (!v) return "";
  if (isRich(v)) return v;
  return v.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((p) => `<p>${escape(p).replace(/\n/g, "<br>")}</p>`).join("");
}

/** HTML made safe to show: only what text needs (no scripts, styles or frames). */
export function clean(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["p", "br", "strong", "b", "em", "i", "u", "s", "a", "ul", "ol", "li", "h2", "h3", "h4", "blockquote", "code", "pre"],
    ALLOWED_ATTR: ["href", "target", "rel", "dir"],
  });
}

/** Rich text as plain, for a one-line excerpt or a search. */
export function toPlain(v: string | null | undefined): string {
  if (!isRich(v)) return v || "";
  const doc = new DOMParser().parseFromString(clean(v as string), "text/html");
  return (doc.body.textContent || "").trim();
}

/**
 * The fields written with the editor: prose people write themselves. Not
 * a posting's text, read from its page, nor the short notes on a step or
 * a version, which show on one line.
 */
const RICH = new Set(["memos.body", "applications.note", "companies.description", "companies.note", "people.about", "people.note",
  "documents.description", "stories.situation", "stories.task", "stories.action", "stories.result"]);
export const isRichField = (resource: string, field: string) => RICH.has(`${resource}.${field}`);
