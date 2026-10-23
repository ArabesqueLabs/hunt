// A date field: the design system's date picker, so its calendar is in
// hunt's language and digits (the browser's own date field follows the
// browser's).

import { useEffect, useRef } from "react";
import { initDatePickers as init } from "../../vendor/arabesque/js/datepicker.js";
import { DIGITS, LANG, t } from "../lib/i18n";
import { SysIcon } from "./ui";

interface Picker { value: string | null }
const initDatePickers = init as unknown as (root: Element, options: object) => Picker[];

/**
 * Typed day first, in either digit set, or chosen from the calendar.
 * `onChange` gets an ISO date, or null when it's cleared; a date that can't
 * be read calls `onBad` instead, so it isn't saved as nothing. The picker
 * owns its input once it's drawn: give it a new `key` to start it again
 * from another value.
 */
export function DatePicker({ id, value, label, onChange, onBad }: {
  id?: string; value?: string | null; label?: string; onChange: (v: string | null) => void; onBad?: () => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onChange, onBad });
  handlers.current = { onChange, onBad };
  useEffect(() => {
    const el = wrap.current!;
    const input = el.querySelector("input")!;
    const [picker] = initDatePickers(el, {
      lang: () => LANG,
      numerals: () => (DIGITS === "arab" ? "arab" : "latn"),
      labels: () => ({ previous: t("Previous month"), next: t("Next month") }),
    });
    const f = () => {
      if (input.value.trim() && !picker.value) handlers.current.onBad?.();
      else handlers.current.onChange(picker.value);
    };
    input.addEventListener("change", f);
    return () => input.removeEventListener("change", f);
  }, []);
  return (
    <div className="al-date-picker" ref={wrap}>
      <input id={id} className="al-input" defaultValue={value ?? ""} aria-label={label || undefined} autoComplete="off" data-al-date-picker="" />
      <button className="al-button al-button--icon al-date-picker__toggle" type="button" aria-label="Choose date" title="Choose date">
        <SysIcon name="calendar" />
      </button>
    </div>
  );
}
