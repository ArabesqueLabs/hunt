// A table's columns, each hideable: an eye on its header (not the first,
// nor Actions) hides it, and the hidden ones are listed above the table to
// show again. Remembered per table, by key. Hiding is a stylesheet, so the
// rows needn't know.

import { useState, type ReactNode } from "react";
import { store, stored } from "../lib/storage";
import { Icon } from "./ui";

/** A column: its name (as remembered), its label, and whether it always shows. */
export interface Column { name: string; label: string; fixed?: boolean }

/**
 * Hideable columns for the table `key`, in order (checkbox columns
 * included, as fixed). Gives each header's hide button, the bar of hidden
 * ones (just above the table), and the stylesheet that hides them (in the
 * page, for `table[data-columns=key]`).
 */
export function useColumns(key: string, columns: Column[]) {
  const storeKey = `hiddenColumns:${key}`;
  const read = () => { try { return new Set<string>(JSON.parse(stored(storeKey) || "[]")); } catch { return new Set<string>(); } };
  const [hidden, setHidden] = useState(read);
  const save = (next: Set<string>) => { store(storeKey, JSON.stringify([...next])); setHidden(new Set(next)); };
  const gone = columns.filter((c) => !c.fixed && hidden.has(c.name));
  const at = columns.map((c, i) => (!c.fixed && hidden.has(c.name) ? i + 1 : null)).filter(Boolean);
  return {
    /** The header's hide button, for a hideable column (nothing for a fixed one). */
    hide(name: string): ReactNode {
      const c = columns.find((x) => x.name === name);
      if (!c || c.fixed) return null;
      return (
        <button className="col-hide" type="button" title={`Hide ${c.label}`} aria-label={`Hide the ${c.label} column`}
          onClick={(e) => { e.stopPropagation(); save(new Set([...hidden, name])); }}><Icon name="eye-off" /></button>
      );
    },
    /** A header's class: hideable, or not. */
    thClass: (name: string) => (columns.find((x) => x.name === name)?.fixed ? undefined : "hideable"),
    bar: (
      <div className="hidden-columns" hidden={!gone.length}>
        {gone.length ? <>
          <span className="muted small">Hidden:</span>
          {gone.map((c) => (
            <button key={c.name} className="chip-button" type="button" title={`Show ${c.label}`}
              onClick={() => { const next = new Set(hidden); next.delete(c.name); save(next); }}><Icon name="eye" />{c.label}</button>
          ))}
          {gone.length > 1 ? <button className="al-button al-button--sm al-button--quiet" type="button" onClick={() => save(new Set())}>Show all</button> : null}
        </> : null}
      </div>
    ),
    style: <style>{at.map((n) => `table[data-columns="${key}"] tr > :nth-child(${n}) { display: none; }`).join("\n")}</style>,
  };
}
