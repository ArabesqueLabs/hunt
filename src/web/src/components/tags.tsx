// Tags: chips in their colours, choosing a tag's colour, a record's tags to
// add and remove, and filtering by one.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { place } from "../../vendor/arabesque/js/position.js";
import { attempt, patch, put } from "../lib/api";
import { t as tr } from "../lib/i18n";
import { reloadTags } from "../lib/meta";
import { S, changed, createStore, useShared, useStore } from "../lib/state";
import { TAG_SHADES, tagColor, tagHueShade, tagNames, tagPaint } from "../lib/tags";
import type { Row, Tag } from "../lib/types";
import { Combo } from "./Combo";
import { Icon, Select } from "./ui";

/** A tag: the design system's, in its colour (repainted wherever it shows when that changes). */
export function TagChip({ name, children }: { name: string; children?: ReactNode }) {
  useShared();
  return <span className="al-tag" data-tag={String(name).toLowerCase()} {...tagPaint(tagColor(name))}>{name}{children}</span>;
}

/** A tag whose name opens its colours (TagColours); `onChange(color)` once one is chosen. */
export function ColourTagChip({ name, children, onChange }: { name: string; children?: ReactNode; onChange?: (c: string) => void }) {
  useShared();
  const tag = S.TAGS.find((t) => t.name.toLowerCase() === String(name).toLowerCase());
  if (!tag) return <TagChip name={name}>{children}</TagChip>;
  return (
    <span className="al-tag" data-tag={String(name).toLowerCase()} {...tagPaint(tagColor(name))}>
      <button className="tag-colour" type="button" aria-haspopup="true" aria-expanded="false" aria-label={`Colour of ${name}`} title="Change colour"
        onClick={(e) => openTagColours(tag, e.currentTarget, onChange)}>{name}</button>
      {children}
    </span>
  );
}

// ---- a tag's colours -----------------------------------------------------------------

interface Pop { tag: Tag; anchor: HTMLElement; onChange?: (c: string) => void; key: number }
const pop = createStore<Pop | null>(null);
let closedAt = { anchor: null as HTMLElement | null, at: 0 };
let popKey = 0;

/**
 * A tag's colours, laid out as Gmail lays out a label's: a popover beside
 * `anchor` of swatches, each a small copy of the tag in that colour. A
 * column is a hue, palest at the top, deepest at the foot; the wheel runs
 * in two bands, then Plain. Above them, the tag as it would look and the
 * colour's name, for the swatch pointed at or focused. Choosing saves it
 * and repaints the tag wherever it shows. Arrow keys move, Enter chooses.
 */
export function openTagColours(tag: Tag, anchor: HTMLElement, onChange?: (c: string) => void) {
  // A click on what opened it closes it (the click lands after the popover's own light dismiss).
  if (closedAt.anchor === anchor && performance.now() - closedAt.at < 300) return;
  pop.set({ tag, anchor, onChange, key: ++popKey });
}

export function TagColoursHost() {
  const p = useStore(pop);
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = el.current!;
    const close = () => box.hidePopover();
    const onToggle = (e: Event) => {
      const at = pop.get();
      const opening = (e as ToggleEvent).newState === "open";
      at?.anchor.setAttribute("aria-expanded", String(opening));
      if (opening) {
        addEventListener("resize", close);
        addEventListener("scroll", close, { capture: true, passive: true });
        return;
      }
      removeEventListener("resize", close);
      removeEventListener("scroll", close, { capture: true });
      closedAt = { anchor: at?.anchor ?? null, at: performance.now() };
      if ((box.contains(document.activeElement) || document.activeElement === document.body) && at?.anchor.isConnected) at.anchor.focus();
    };
    box.addEventListener("toggle", onToggle);
    return () => box.removeEventListener("toggle", onToggle);
  }, []);
  useLayoutEffect(() => {
    const box = el.current!;
    if (!p) return;
    if (!box.matches(":popover-open")) box.showPopover();
    place(box, p.anchor.closest(".al-tag") || p.anchor);
    box.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  }, [p]);
  return (
    <div className="al-menu tag-colours" popover="auto" ref={el}>
      {p ? <TagColours key={p.key} p={p} close={() => el.current?.hidePopover()} /> : null}
    </div>
  );
}

function TagColours({ p, close }: { p: Pop; close: () => void }) {
  const { tag } = p;
  const current = tag.color || "";
  const [shown, setShown] = useState(current);
  const group = useRef<HTMLDivElement>(null);
  const choose = async (value: string) => {
    close();
    if (value === current || !(await attempt(() => patch(`tags/${tag.id}`, { color: value || null })))) return;
    tag.color = value || null;
    for (const t of S.TAGS) if (t.id === tag.id) t.color = tag.color;
    changed();
    p.onChange?.(value);
  };
  const letter = [...tag.name][0] || "a";
  const radio = (value: string, label: string) => ({
    role: "radio", "aria-checked": String(value === current) as "true" | "false", "aria-label": tr(label), "data-value": value,
    tabIndex: value === current ? 0 : -1, onClick: () => choose(value),
  });
  const hues = [...new Set(S.META.tag_colors.map((c) => tagHueShade(c.value)[0]))];
  const half = Math.ceil(hues.length / 2);
  // A band of hues, a row per shade: left and right walk the wheel, up and down the shades.
  const band = (some: string[]) => (
    <div className="tag-swatch-grid" style={{ "--hues": some.length } as React.CSSProperties}>
      {TAG_SHADES.flatMap((shade) => some.map((hue) => {
        const c = S.META.tag_colors.find((x) => x.value === (shade === "light" ? hue : `${hue}-${shade}`));
        return c
          ? <button key={c.value} className="al-tag tag-swatch" type="button" {...radio(c.value, c.label)} {...tagPaint(c.value)}>
            <span translate="no">{c.value === current ? "✓" : letter}</span></button>
          : <span key={`${hue}-${shade}`} />;
      }))}
    </div>
  );
  const pointed = (e: { target: EventTarget }) => (e.target as Element).closest?.('[role="radio"]') as HTMLElement | null;
  const onKey = (e: React.KeyboardEvent) => {
    const g = group.current!;
    const radios = [...g.querySelectorAll<HTMLElement>('[role="radio"]')];
    const here = radios.indexOf(document.activeElement as HTMLElement);
    if (here < 0) return;
    const rtl = getComputedStyle(g).direction === "rtl";
    const at = radios[here].getBoundingClientRect();
    const mid = (b: DOMRect) => b.left + b.width / 2;
    const boxes = radios.map((el) => [el, el.getBoundingClientRect()] as const);
    let next: HTMLElement | null = null;
    if (e.key === "Home") next = radios[0];
    else if (e.key === "End") next = radios[radios.length - 1];
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      // Along its row; off its end, round to the other.
      const row = boxes.filter(([, b]) => b.top === at.top).map(([el]) => el);
      const i = row.indexOf(radios[here]) + ((e.key === "ArrowRight") !== rtl ? 1 : -1);
      next = row[(i + row.length) % row.length];
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      // The nearest row that way, and in it the swatch nearest the same column.
      const down = e.key === "ArrowDown";
      const that = boxes.filter(([, b]) => (down ? b.top >= at.bottom : b.bottom <= at.top));
      if (that.length) {
        const row = (down ? Math.min : Math.max)(...that.map(([, b]) => b.top));
        next = that.filter(([, b]) => b.top === row)
          .sort(([, a], [, b]) => Math.abs(mid(a) - mid(at)) - Math.abs(mid(b) - mid(at)))[0][0];
      }
    }
    if (!next) return;
    e.preventDefault();
    for (const el of radios) el.tabIndex = el === next ? 0 : -1;
    next.focus();
  };
  return (
    <>
      <div className="tag-colours-head">
        <span className="al-tag" translate="no" {...tagPaint(shown)}>{tag.name}</span>
        <span className="tag-colours-name">{tr(S.META.tag_colors.find((c) => c.value === shown)?.label || "Plain")}</span>
      </div>
      {/* The name follows the pointer, else the focus, else what it is now. */}
      <div className="tag-swatches" role="radiogroup" aria-label={`Colour of ${tag.name}`} ref={group}
        onPointerOver={(e) => { const r = pointed(e); if (r) setShown(r.dataset.value || ""); }}
        onFocus={(e) => { const r = pointed(e); if (r) setShown(r.dataset.value || ""); }}
        onPointerLeave={() => {
          const r = group.current?.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
          setShown(r ? r.dataset.value || "" : current);
        }}
        onKeyDown={onKey}>
        {band(hues.slice(0, half))}
        {band(hues.slice(half))}
        <hr className="al-menu__separator" />
        <button className="al-menu__item" type="button" {...radio("", "Plain")}>Plain</button>
      </div>
    </>
  );
}

// ---- a record's tags ------------------------------------------------------------------

/**
 * A record's tags, as chips to remove and a + that opens a box to add one
 * (from the existing tags, or a new one), closed by Escape or leaving it.
 * Saves as it goes.
 */
export function TagEditor({ resource, rec, onChange }: { resource: string; rec: Row; onChange?: (tags: string[]) => void }) {
  const [tags, setTags] = useState<string[]>(tagNames(rec.tags));
  const input = useRef<HTMLInputElement>(null);
  const plus = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => { if (adding) input.current?.focus(); }, [adding]);
  const save = async (next: string[]) => {
    const saved = await attempt(() => put(`${resource}/${rec.id}/tags`, { tags: next }));
    if (!saved) return;
    setTags(saved);
    rec.tags = saved;
    // A new tag: learn of it, for suggestions and filters.
    if (saved.some((n: string) => !S.TAGS.some((t) => t.name.toLowerCase() === n.toLowerCase()))) await reloadTags();
    onChange?.(saved);
  };
  return (
    <div className="tag-editor">
      <span className="tag-editor-label">Tags</span>
      <span className="tag-chips">
        {tags.map((t) => (
          <ColourTagChip key={t} name={t}>
            <button className="al-tag__remove" type="button" aria-label={`Remove tag ${t}`} title="Remove" onClick={() => save(tags.filter((x) => x !== t))}>×</button>
          </ColourTagChip>
        ))}
      </span>
      {adding ? <Combo className="tag-add" placeholder="Add a tag…" label="Add a tag" allowCreate inputRef={input}
        onBlur={() => setAdding(false)}
        source={async (q) => S.TAGS
          .filter((t) => !tags.some((n) => n.toLowerCase() === t.name.toLowerCase()))
          .filter((t) => t.name.toLowerCase().includes(q.toLowerCase()))
          .map((t) => ({ value: t.name, label: t.name }))}
        onPick={(it) => { if (input.current) input.current.value = ""; save([...tags, it.value]); }}
        onKeyDown={(e) => {
          // Escape: put the box away, back to the +.
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setAdding(false);
            setTimeout(() => plus.current?.focus());
            return;
          }
          // Enter with nothing highlighted: add what's typed.
          const el = input.current!;
          if (e.key === "Enter" && !e.defaultPrevented && el.value.trim()) {
            e.preventDefault();
            const v = el.value.trim();
            el.value = "";
            save([...tags, v]);
          }
        }} />
        : <button ref={plus} className="al-button al-button--quiet al-button--icon al-button--sm tag-plus" type="button" aria-label="Add a tag" title="Add a tag" onClick={() => setAdding(true)}><Icon name="plus" /></button>}
    </div>
  );
}

/** A select of tags to filter by; `onPick(name)` ("" for all). */
export function TagFilter({ current, onPick }: { current: string; onPick: (name: string) => void }) {
  useShared();
  return (
    <Select className="tag-filter" aria-label="Filter by tag" value={current} onChange={(e) => onPick(e.target.value)}>
      <option value="">All tags</option>
      {S.TAGS.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
    </Select>
  );
}
