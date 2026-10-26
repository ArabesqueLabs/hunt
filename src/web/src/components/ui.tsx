// The small pieces every page uses: icons, notices, empty states, search
// boxes, and form controls in the design system's classes (its fields, text
// fields, selects, textareas, labels, choices and tables).

import { Fragment, useRef, useState, type ComponentProps, type ReactNode } from "react";

// ---- icons ------------------------------------------------------------------------------

const ICONS: Record<string, string> = {
  refresh: "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8 M21 3v5h-5",
  chevron: "M6 9l6 6 6-6",
  edit: "M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z M15 5l4 4",
  mail: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z M22 6l-10 7L2 6",
  phone: "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z",
  eye: "M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  "eye-off": "M9.88 9.88a3 3 0 1 0 4.24 4.24 M10.73 5.08A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68 M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.39-1.61 M2 2l20 20",
  external: "M15 3h6v6 M10 14 21 3 M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
  remove: "M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M10 11v6 M14 11v6",
  plus: "M12 5v14M5 12h14",
  flag: "M4 22V4M4 4h12l-2 4 2 4H4",
  check: "M20 6 9 17l-5-5",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  bell: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0",
  cal: "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM16 2v4M8 2v4M3 10h18",
  archive: "M3 3h18v5H3zM5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M10 12h4",
  trash: "M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5",
  grip: "M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01",
  more: "M5 12h1M12 12h1M19 12h1",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  download: "M12 3v12M7 10l5 5 5-5M5 21h14",
  back: "M19 12H5M11 18l-6-6 6-6",
  forward: "M5 12h14M13 6l6 6-6 6",
  sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  key: "M15.5 7.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0zM12 11v10M12 15h3M12 18h2",
  users: "M9 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM1 21a8 8 0 0 1 16 0M17 4.5a4 4 0 0 1 0 7M19.5 14.5A8 8 0 0 1 23 21",
  server: "M4 3h16v7H4zM4 14h16v7H4zM8 6.5h.01M8 17.5h.01",
  bug: "M8 7a4 4 0 0 1 8 0v1H8zM6 8h12v5a6 6 0 0 1-12 0zM12 13v8M2 13h4M18 13h4M3 7l3 2M21 7l-3 2M3 20l3-3M21 20l-3-3",
  board: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 7v7M12 7v4M16 7v9",
  database: "M4 5c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  link: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
  calc: "M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h.01M16 19h.01",
  tag: "M3 3h8l10 10-8 8L3 11zM7.5 7.5h.01",
  user: "M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21a8 8 0 0 1 16 0",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 16v-5M12 8h.01",
  // For stages, chosen in the board's settings (STAGE_ICONS).
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.35-4.35",
  send: "M22 2 11 13M22 2l-7 20-4-9-9-4z",
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  code: "M16 18l6-6-6-6M8 6l-6 6 6 6",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
  target: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z",
  star: "M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z",
  award: "M12 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM8.2 13.1 7 22l5-3 5 3-1.2-8.9",
  briefcase: "M4 7h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2",
  heart: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z",
  pause: "M6 4h4v16H6zM14 4h4v16h-4z",
  x: "M18 6 6 18M6 6l12 12",
};

/** The icons a stage can have, each with its name in words, in the order they're offered. */
export const STAGE_ICONS: [string, string][] = [
  ["search", "Looking"], ["send", "Sent"], ["mail", "Email"], ["phone", "Call"], ["chat", "Conversation"],
  ["cal", "Scheduled"], ["clock", "Waiting"], ["code", "Technical"], ["file", "Take-home task"], ["users", "Panel"],
  ["target", "Final"], ["star", "Shortlisted"], ["award", "Offer"], ["briefcase", "Job"], ["heart", "Accepted"],
  ["check", "Done"], ["flag", "Flag"], ["pause", "On hold"], ["x", "Declined"],
];

/** A line icon, drawn in the text's colour. */
export function Icon({ name, className }: { name: string; className?: string }) {
  // Arrows pointing out of the page point the other way, right to left.
  const cls = [className, name === "external" ? "flip-rtl" : ""].filter(Boolean).join(" ") || undefined;
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cls}>
      <path d={ICONS[name]} />
    </svg>
  );
}

/** A line icon from a path, in the system's icon size. */
export function PathIcon({ d, className = "al-icon al-icon--sm" }: { d: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export const FLAG = "M4 22V4M4 4h12l-2 4 2 4H4";

/** One of the design system's icons (its sprite, vendored), for its components. */
export function SysIcon({ name, className = "al-icon" }: { name: string; className?: string }) {
  return <svg className={className} aria-hidden="true"><use href={`/vendor/arabesque/dist/icons.svg#al-icon-${name}`} /></svg>;
}

// ---- notices, empty states --------------------------------------------------------------

/**
 * A notice in the page, the design system's: "danger" for an error (only
 * for errors), "warning", "success" or "info"; its icon says the kind too,
 * so it isn't told by colour alone.
 */
export function Notice({ kind, className, children, ...rest }: { kind: string } & ComponentProps<"div">) {
  return (
    <div className={`al-notice al-notice--${kind}${className ? ` ${className}` : ""}`} {...rest}>
      <SysIcon name={kind} />
      <div className="al-notice__body">{children}</div>
    </div>
  );
}

/**
 * A page or region with nothing in it, the design system's empty state: why
 * it's empty, and the one thing to do next, if there's one.
 */
export function EmptyState({ title, text, action }: { title: string; text?: string | null; action?: ReactNode }) {
  return (
    <div className="al-empty">
      <p className="al-empty__title">{title}</p>
      {text ? <p className="al-empty__text">{text}</p> : null}
      {action}
    </div>
  );
}

// ---- loading ------------------------------------------------------------------------------

/** One of the design system's skeletons, `w` wide (any CSS length) and `h` tall. */
const Bone = ({ w, h }: { w?: string; h?: string }) => (
  <span className="al-skeleton" style={{ inlineSize: w, blockSize: h }} />
);

/**
 * Where a page will be while it loads: its shape in the system's skeletons,
 * so it doesn't jump in. Shown only after a moment (in CSS), so a quick
 * load doesn't flash. `kind`: "board" (columns of cards), "table" (rows),
 * "detail" (a record: its text, its facts beside), or a plain page.
 */
export function LoadingPage({ kind = "page" }: { kind?: "page" | "board" | "table" | "detail" }) {
  const lines = (n: number) => [...Array(n)].map((_, i) => <Bone key={i} w={`${90 - ((i * 23) % 40)}%`} />);
  return (
    <div className={`page loading loading-${kind}`} role="status" aria-busy="true">
      <span className="al-visually-hidden">Loading…</span>
      <div className="loading-head"><Bone w="min(22rem, 60%)" h="2.75rem" /><Bone w="min(14rem, 40%)" /></div>
      {kind === "board" ? (
        <div className="loading-columns">
          {[3, 2, 2, 1].map((n, i) => <div key={i} className="loading-column"><Bone w="60%" h="1.5rem" />{[...Array(n)].map((_, j) => <Bone key={j} h="6.5rem" />)}</div>)}
        </div>
      ) : kind === "table" ? (
        <div className="loading-rows">{[...Array(8)].map((_, i) => <Bone key={i} h="2.25rem" />)}</div>
      ) : kind === "detail" ? (
        <div className="loading-split"><div className="loading-lines">{lines(7)}</div><div className="loading-lines">{lines(5)}</div></div>
      ) : (
        <div className="loading-lines">{lines(6)}</div>
      )}
    </div>
  );
}

/** A table's body while it loads: `rows` rows of `cols` cells, in skeletons. */
export function LoadingRows({ cols, rows = 6 }: { cols: number; rows?: number }) {
  return <>{[...Array(rows)].map((_, i) => (
    <tr key={i} className="loading" aria-hidden="true">
      {[...Array(cols)].map((_, j) => <td key={j}><Bone w={j ? "70%" : "85%"} /></td>)}
    </tr>
  ))}</>;
}

/** A region of a page while it loads: `lines` lines in skeletons, `tall` blocks if asked. */
export function LoadingBlock({ lines = 4, tall = 0 }: { lines?: number; tall?: number }) {
  return (
    <div className="loading loading-block" role="status" aria-busy="true">
      <span className="al-visually-hidden">Loading…</span>
      {tall ? <div className="loading-tiles">{[...Array(tall)].map((_, i) => <Bone key={i} h="6rem" />)}</div> : null}
      <div className="loading-lines">{[...Array(lines)].map((_, i) => <Bone key={i} w={`${90 - ((i * 23) % 40)}%`} />)}</div>
    </div>
  );
}

// ---- form controls, in the design system's classes ---------------------------------------

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ") || undefined;

/** The input types that are text fields, styled as the design system's. */
const TEXT_FIELDS = new Set(["text", "email", "url", "search", "password", "number", "tel", "date", "datetime-local", "time", "month", "week"]);

/** A field's wrapper: its label, control, hint and error. */
export function Field({ className, ...rest }: ComponentProps<"div">) {
  return <div className={cx("field al-field", className)} {...rest} />;
}

/** An input; a text field's in the system's class (a switch's, as a switch). */
export function Input({ className, type = "text", ...rest }: ComponentProps<"input">) {
  const cls = cx(TEXT_FIELDS.has(type) && "al-input", rest.role === "switch" && "al-switch", className);
  return <input type={type} className={cls} {...rest} />;
}

/** A password, with an eye at its end that shows it, and hides it again. */
export function PasswordInput({ className, ...rest }: Omit<ComponentProps<"input">, "type">) {
  const [shown, setShown] = useState(false);
  return (
    <span className="password-field">
      <Input {...rest} type={shown ? "text" : "password"} className={className} />
      <button className="password-field__eye" type="button" aria-pressed={shown} aria-controls={rest.id}
        aria-label={shown ? "Hide password" : "Show password"} title={shown ? "Hide password" : "Show password"}
        onClick={() => setShown(!shown)}><Icon name={shown ? "eye-off" : "eye"} /></button>
    </span>
  );
}

export function Select({ className, ...rest }: ComponentProps<"select">) {
  return <select className={cx("al-select", className)} {...rest} />;
}

export function TextArea({ className, ...rest }: ComponentProps<"textarea">) {
  return <textarea className={cx("al-textarea", className)} {...rest} />;
}

/** A label naming a control (by its id). */
export function Label({ className, ...rest }: ComponentProps<"label">) {
  return <label className={cx(rest.htmlFor && "al-label", className)} {...rest} />;
}

/** A label around a checkbox or radio: the system's choice, the whole row its target. */
export function Choice({ className, ...rest }: ComponentProps<"label">) {
  return <label className={cx("al-choice", className)} {...rest} />;
}

export function Table({ className, ...rest }: ComponentProps<"table">) {
  return <table className={cx("al-table", className)} {...rest} />;
}

/** "(optional)" after a label. */
export const Optional = () => <span className="al-label__optional">(optional)</span>;

/**
 * Facts, as terms and values: the system's summary list, each term with its
 * value a row. `rows`: [term, value] pairs (a value may be several nodes).
 */
export function Facts({ rows, className }: { rows: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cx("facts al-summary-list", className)}>
      {rows.map(([k, v], i) => (
        <div key={i} className="al-summary-list__row al-summary-list__row--no-actions">
          <dt className="al-summary-list__key">{k}</dt>
          <dd className="al-summary-list__value">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A search field, the design system's: its icon, and Clear once there's
 * text (Escape clears it too), which empties it as typing would.
 */
export function SearchBox({ value, onValue, ...rest }: { value: string; onValue: (v: string) => void } & Omit<ComponentProps<"input">, "value" | "onChange">) {
  const input = useRef<HTMLInputElement>(null);
  const clear = () => { onValue(""); input.current?.focus(); };
  return (
    <div className="al-search">
      <SysIcon name="search" />
      <Input ref={input} type="search" value={value} {...rest} onChange={(e) => onValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape" && value) { e.preventDefault(); e.stopPropagation(); clear(); } }} />
      <button className="al-search__clear" type="button" aria-label="Clear search" title="Clear search" onClick={clear}>
        <SysIcon name="close" className="al-icon al-icon--sm" />
      </button>
    </div>
  );
}

/**
 * A button that's working (saving, reading, syncing) while what it does
 * runs: the design system's busy button, with its spinner, rather than a
 * disabled one, so it keeps its look and its place in the tab order. It
 * takes no clicks while busy.
 */
export function BusyButton({ onClick, busy: forced, children, ...rest }: Omit<ComponentProps<"button">, "onClick"> & {
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => unknown; busy?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const on = busy || !!forced;
  return (
    <button type="button" {...rest} aria-busy={on ? "true" : undefined} onClick={async (e) => {
      if (on || !onClick) return;
      setBusy(true);
      try { await onClick(e); } finally { setBusy(false); }
    }}>{children}</button>
  );
}

// ---- pictures ---------------------------------------------------------------------------

/** A company's logo, or its initial in a square when it has none. */
export function Logo({ id, logo, name, size = 28 }: { id: number; logo?: string | null; name?: string | null; size?: number }) {
  // The initial is drawn by CSS, so it isn't part of the name's text.
  return (
    <span className="logo" style={{ "--size": `${size}px` } as React.CSSProperties} aria-hidden="true"
      data-initial={logo ? undefined : (name || "?").trim().charAt(0).toUpperCase()}>
      {logo ? <img src={`/api/companies/${id}/logo?v=${logo.slice(0, 12)}`} alt="" loading="lazy" /> : null}
    </span>
  );
}

/** A person's photo, round; their initial when there's none. */
export function Photo({ id, photo, name, size = 28 }: { id: number; photo?: string | null; name?: string | null; size?: number }) {
  return (
    <span className="logo round" style={{ "--size": `${size}px` } as React.CSSProperties} aria-hidden="true"
      data-initial={photo ? undefined : (name || "?").trim().charAt(0).toUpperCase()}>
      {photo ? <img src={`/api/people/${id}/photo?v=${photo.slice(0, 12)}`} alt="" loading="lazy" /> : null}
    </span>
  );
}

/** Parts joined by middle dots, each its own phrase (for translating); data marked as written. */
export function dotted(parts: ReactNode[]): ReactNode[] {
  return parts.filter(Boolean).map((p, i) => <Fragment key={i}>{i ? " · " : null}{typeof p === "string" ? <span>{p}</span> : p}</Fragment>);
}
