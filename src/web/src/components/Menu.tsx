// A button that opens a menu: the design system's al-menu, as a popover
// beside the button. What's in it is drawn only while it's open; choosing
// an item closes it. Up and down move between the items.

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { place } from "../../vendor/arabesque/js/position.js";

export function MenuButton({ className = "al-button", menuClassName, label, title, children, items }: {
  className?: string; menuClassName?: string; label?: string; title?: string; children: ReactNode;
  items: (close: () => void) => ReactNode;
}) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const el = box.current!;
    const hide = () => el.hidePopover();
    const onToggle = (e: Event) => {
      const opening = (e as ToggleEvent).newState === "open";
      setOpen(opening);
      if (opening) {
        addEventListener("resize", hide);
        addEventListener("scroll", hide, { capture: true, passive: true });
      } else {
        removeEventListener("resize", hide);
        removeEventListener("scroll", hide, { capture: true });
      }
    };
    el.addEventListener("toggle", onToggle);
    return () => { el.removeEventListener("toggle", onToggle); hide(); };
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    place(box.current!, btn.current!);
    box.current!.querySelector<HTMLElement>('.al-menu__item[aria-checked="true"], .al-menu__item')?.focus();
  }, [open]);
  const close = () => { box.current?.hidePopover(); btn.current?.focus(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const all = [...box.current!.querySelectorAll<HTMLElement>(".al-menu__item:not(:disabled)")];
    const here = all.indexOf(document.activeElement as HTMLElement);
    all[(here + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length]?.focus();
  };
  return <>
    <button ref={btn} type="button" className={className} aria-label={label} title={title ?? label} aria-haspopup="menu" popoverTarget={id}>{children}</button>
    <div ref={box} id={id} className={menuClassName ? `al-menu ${menuClassName}` : "al-menu"} popover="auto" role="menu" onKeyDown={onKey}>{open ? items(close) : null}</div>
  </>;
}

/** One of a menu's items: `onClick` runs once the menu is closed. */
export function MenuItem({ close, onClick, checked, danger, hint, children, className }: {
  close: () => void; onClick: () => void; checked?: boolean; danger?: boolean; hint?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <button type="button" role={checked == null ? "menuitem" : "menuitemradio"} aria-checked={checked == null ? undefined : String(checked) as "true" | "false"}
      className={`al-menu__item${danger ? " al-menu__item--danger" : ""}${hint ? " al-menu__item--described" : ""}${className ? ` ${className}` : ""}`}
      onClick={() => { close(); onClick(); }}>
      {hint ? <><span>{children}</span><span className="al-menu__description">{hint}</span></> : children}
    </button>
  );
}
