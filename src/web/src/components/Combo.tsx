// A text input with suggestions: the design system's combobox pattern.

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { Input } from "./ui";

export interface ComboItem { value: any; label: string; hint?: string; icon?: ReactNode; create?: boolean }

export interface ComboProps {
  value?: string;
  placeholder?: string;
  /** Resolves to the items for what's typed. */
  source: (q: string) => Promise<ComboItem[]>;
  /** Typing a new name offers to add it ({create: true, value: text}). */
  allowCreate?: boolean;
  /** Suggest nothing until something's typed (not on focus, with the input empty). */
  typeFirst?: boolean;
  onPick?: (it: ComboItem) => void;
  onInput?: (v: string) => void;
  /** The input's own change (as it loses focus, changed). */
  onChange?: (v: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  onBlur?: () => void;
  id?: string;
  label?: string;
  required?: boolean;
  className?: string;
  inputRef?: Ref<HTMLInputElement>;
}

/**
 * A text input with suggestions. `source(q)` resolves to items
 * {value, label, hint?}. With `allowCreate`, typing a new name offers to
 * add it; with `typeFirst`, nothing's suggested until something's typed.
 * The input is the page's: what's typed stays in it (`inputRef`
 * reads or sets it).
 */
export function Combo({ value = "", placeholder, source, allowCreate = false, typeFirst = false, onPick, onInput, onChange, onKeyDown, onBlur, id, label, required, className, inputRef }: ComboProps) {
  const listId = useId();
  const input = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<ComboItem[]>([]);
  const [active, setActive] = useState(-1);
  const [focused, setFocused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const seq = useRef(0);
  const latest = useRef({ source, onChange });
  latest.current = { source, onChange };

  async function refresh() {
    const q = (input.current?.value || "").trim();
    const mine = ++seq.current;
    if (typeFirst && !q) { setItems([]); return; }
    let found: ComboItem[] = [];
    try { found = await latest.current.source(q); } catch { found = []; }
    if (mine !== seq.current) return;
    const next = found.slice(0, 12);
    if (allowCreate && q && !next.some((i) => String(i.label).toLowerCase() === q.toLowerCase())) {
      next.push({ create: true, value: q, label: `Add “${q}”` });
    }
    setActive(-1);
    setItems(next);
  }
  function pick(it: ComboItem) {
    if (input.current) input.current.value = it.create ? it.value : it.label;
    setItems([]);
    onPick?.(it);
  }
  // The input's own change event (React's onChange is every keystroke).
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const f = () => latest.current.onChange?.(el.value);
    el.addEventListener("change", f);
    return () => el.removeEventListener("change", f);
  }, []);
  const open = items.length > 0 && focused;
  const setRef = (el: HTMLInputElement | null) => {
    input.current = el;
    if (typeof inputRef === "function") inputRef(el);
    else if (inputRef) (inputRef as { current: HTMLInputElement | null }).current = el;
  };
  return (
    <div className={`combo${className ? ` ${className}` : ""}`}>
      <Input ref={setRef} type="text" defaultValue={value} placeholder={placeholder} id={id} required={required} autoComplete="off" role="combobox"
        aria-autocomplete="list" aria-expanded={String(open) as "true" | "false"} aria-controls={listId} aria-label={label}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        onInput={(e) => {
          clearTimeout(timer.current);
          timer.current = setTimeout(refresh, 120);
          onInput?.((e.target as HTMLInputElement).value);
        }}
        onFocus={() => { setFocused(true); refresh(); }}
        onBlur={() => { setTimeout(() => { setFocused(false); setItems([]); }, 120); onBlur?.(); }}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === "ArrowDown") { setActive((active + 1) % items.length); e.preventDefault(); }
            else if (e.key === "ArrowUp") { setActive((active - 1 + items.length) % items.length); e.preventDefault(); }
            else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(items[active]); }
            else if (e.key === "Escape") { setItems([]); e.preventDefault(); e.stopPropagation(); }
          }
          onKeyDown?.(e);
        }} />
      <ul className="combo-list" id={listId} role="listbox" hidden={!open}>
        {items.map((it, i) => (
          <li key={i} role="option" id={`${listId}-${i}`} className={[i === active ? "active" : "", it.create ? "create" : ""].join(" ").trim() || undefined}
            aria-selected={i === active ? "true" : "false"} onMouseDown={(e) => { e.preventDefault(); pick(it); }}>
            <span className="combo-item">{it.icon}{it.label}</span>
            {it.hint ? <small>{it.hint}</small> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
