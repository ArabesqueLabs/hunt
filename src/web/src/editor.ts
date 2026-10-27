// The rich text editor, Lexical (MIT), on an element made editable: rich
// text's paragraphs, bold and italic, lists, quotes and links, with undo.
// Built as a script of its own (editor.js), loaded the first time an
// editor opens: see components/RichText.tsx, which draws its toolbar and
// asks this for what it does.

import {
  $createParagraphNode, $getRoot, $getSelection, $insertNodes, $isElementNode, $isRangeSelection, $isRootOrShadowRoot, $isTextNode,
  configExtension, defineExtension, FORMAT_TEXT_COMMAND, HISTORY_MERGE_TAG, TextNode, type LexicalEditor, type LexicalNode,
} from "lexical";
import { buildEditorFromExtensions } from "@lexical/extension";
import { HistoryExtension } from "@lexical/history";
import { $generateHtmlFromNodes, $generateNodesFromDOM } from "@lexical/html";
import { $isLinkNode, AutoLinkExtension, autoLinkUrlMatcher, LinkExtension, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { $isListNode, INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND, ListExtension, ListNode, REMOVE_LIST_COMMAND } from "@lexical/list";
import { $createQuoteNode, $isQuoteNode, RichTextExtension } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import { $findMatchingParent, $getNearestNodeOfType } from "@lexical/utils";

/** What's on where the cursor is, for the toolbar; and whether there's anything written. */
export interface Formats { bold: boolean; italic: boolean; list: "bullet" | "number" | null; quote: boolean; link: string | null; empty: boolean }
export type Action = "bold" | "italic" | "bullet" | "number" | "quote" | "clear";

export interface RichEditor {
  /** What's written, as the HTML rich text is kept in ("" when nothing is). */
  getContent(): string;
  setContent(html: string): void;
  act(action: Action): void;
  /** Link what's chosen to `url`; null takes the link off. */
  link(url: string | null): void;
  focus(): void;
  remove(): void;
}

// Only what rich text is shown with (lib/rich.ts) is kept: the editor's own
// spans, classes and styles go, and headings fit h2 to h4.
const KEEP_ATTRS = new Set(["href", "target", "rel", "dir"]);
const HEADING: Record<string, string> = { H1: "h2", H5: "h4", H6: "h4" };
function tidy(html: string): string {
  const body = new DOMParser().parseFromString(`<!doctype html><body>${html}`, "text/html").body;
  for (const el of [...body.querySelectorAll("*")].reverse()) {
    for (const a of [...el.attributes]) if (!KEEP_ATTRS.has(a.name)) el.removeAttribute(a.name);
    const only = el.children.length === 1 && el.childNodes.length === 1 ? el.children[0].tagName : null;
    // A span is the editor's; bold is written <b><strong>, italic <i><em>.
    if (el.tagName === "SPAN" || (el.tagName === "B" && only === "STRONG") || (el.tagName === "I" && only === "EM")) el.replaceWith(...el.childNodes);
    else if (HEADING[el.tagName]) {
      const h = document.createElement(HEADING[el.tagName]);
      h.append(...el.childNodes);
      el.replaceWith(h);
    }
  }
  return body.innerHTML;
}

/** The list the cursor is in, if it's in one. */
function $listType(node: LexicalNode): Formats["list"] {
  const list = $getNearestNodeOfType(node, ListNode);
  return list ? (list.getListType() === "number" ? "number" : "bullet") : null;
}

function $formats(): Formats {
  const empty = $getRoot().getTextContent().trim() === "" && !$getRoot().getChildren().some((n) => $isListNode(n));
  const sel = $getSelection();
  if (!$isRangeSelection(sel)) return { bold: false, italic: false, list: null, quote: false, link: null, empty };
  const node = sel.anchor.getNode();
  const block = $findMatchingParent(node, (n) => $isElementNode(n) && !n.isInline() && $isRootOrShadowRoot(n.getParent()));
  const link = $findMatchingParent(node, $isLinkNode);
  return { bold: sel.hasFormat("bold"), italic: sel.hasFormat("italic"), list: $listType(node), quote: $isQuoteNode(block), link: link && $isLinkNode(link) ? link.getURL() : null, empty };
}

function $setHtml(editor: LexicalEditor, html: string) {
  const root = $getRoot();
  root.clear();
  const nodes = html ? $generateNodesFromDOM(editor, new DOMParser().parseFromString(html, "text/html")) : [];
  if (nodes.length) { root.select(); $insertNodes(nodes); }
  if (!root.getChildrenSize()) root.append($createParagraphNode());
}

/**
 * The editor, on `root` (an element of its own, made editable here),
 * starting with `html`. `onChange(html)` as it's written (not as it opens);
 * `onFormats` as the cursor moves.
 */
export function createEditor(root: HTMLElement, { html, onChange, onFormats }: {
  html: string; onChange: (html: string) => void; onFormats: (f: Formats) => void;
}): RichEditor {
  const editor = buildEditorFromExtensions(defineExtension({
    name: "hunt/rich-text",
    namespace: "hunt",
    dependencies: [RichTextExtension, HistoryExtension, ListExtension, LinkExtension,
      configExtension(AutoLinkExtension, { matchers: [autoLinkUrlMatcher] })],
    theme: { text: { underline: "rich-u", strikethrough: "rich-s", underlineStrikethrough: "rich-us" } },
    onError: (e: Error) => console.error(e),
    register: (ed: LexicalEditor) => ed.registerNodeTransform(TextNode, (n) => {
      // What's pasted keeps its bold and links, not its colours and sizes.
      if (n.getStyle()) n.setStyle("");
    }),
  }));
  const content = () => editor.getEditorState().read(() => ($formats().empty ? "" : tidy($generateHtmlFromNodes(editor, null))));
  editor.update(() => $setHtml(editor, html), { discrete: true, tag: HISTORY_MERGE_TAG });
  editor.setRootElement(root);
  const stop = editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves, tags }) => {
    onFormats(editorState.read($formats));
    if (tags.has(HISTORY_MERGE_TAG) || (!dirtyElements.size && !dirtyLeaves.size)) return;
    onChange(content());
  });
  onFormats(editor.getEditorState().read($formats));
  const toggleList = (type: "bullet" | "number") => {
    const now = editor.getEditorState().read(() => { const s = $getSelection(); return $isRangeSelection(s) ? $listType(s.anchor.getNode()) : null; });
    editor.dispatchCommand(now === type ? REMOVE_LIST_COMMAND : type === "bullet" ? INSERT_UNORDERED_LIST_COMMAND : INSERT_ORDERED_LIST_COMMAND, undefined);
  };
  return {
    getContent: content,
    setContent: (h) => editor.update(() => $setHtml(editor, h), { discrete: true, tag: HISTORY_MERGE_TAG }),
    act: (action) => {
      if (action === "bold" || action === "italic") editor.dispatchCommand(FORMAT_TEXT_COMMAND, action);
      else if (action === "bullet" || action === "number") toggleList(action);
      else editor.update(() => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel)) return;
        if (action === "quote") $setBlocksType(sel, () => ($formats().quote ? $createParagraphNode() : $createQuoteNode()));
        else {
          for (const n of sel.getNodes()) if ($isTextNode(n)) { n.setFormat(0); n.setStyle(""); }
          sel.format = 0;
        }
      });
      editor.focus();
    },
    link: (url) => { editor.dispatchCommand(TOGGLE_LINK_COMMAND, url ? { url, target: "_blank", rel: "noreferrer" } : null); editor.focus(); },
    focus: () => editor.focus(),
    remove: () => { stop(); editor.setRootElement(null); editor.dispose(); },
  };
}
