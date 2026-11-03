// An interview (a step of a process): when it is, its links, and the
// dialog that adds or edits it, and shows it whole. Its time is a day, a
// start and an end, the end kept as its length (`minutes`); a time is
// picked from a list in quarter hours, or typed as people say them (3pm,
// 15:30), the end's list saying how long each would make it.

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { patch, post, put } from "../lib/api";
import { daysFromToday, fmtDay, fmtTime, isOverdue, parseLocal, timeZone, twelveHour, zonedNow } from "../lib/format";
import { R, listOf, optionLabel, reloadTags } from "../lib/meta";
import { S } from "../lib/state";
import { tagNames } from "../lib/tags";
import { hostName, markColour, platformOf } from "../lib/platforms";
import { toPlain } from "../lib/rich";
import { toast } from "../lib/toast";
import type { Row } from "../lib/types";
import { mayDiscard } from "../lib/unsaved";
import { Combo } from "../components/Combo";
import { DatePicker } from "../components/DatePicker";
import { closeModal, dismissModal } from "../components/dialogs";
import { refSource } from "../components/fields";
import { RichText, RichView } from "../components/RichText";
import { TagChip } from "../components/tags";
import { Field, Icon, Input, Label, Optional, Select } from "../components/ui";

/** Doing something that saves, the page's way: its errors shown, `undefined` for one that failed. */
export type Saving = <T>(fn: () => Promise<T>) => Promise<T | undefined>;

// ---- its time ------------------------------------------------------------------------------

/** Minutes past midnight, of a time of day ("15:30"), and back. */
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const toHHMM = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
/** A time so many minutes after another, the same day; none past midnight. */
const later = (hhmm: string, n: number) => (toMin(hhmm) + n < 24 * 60 ? toHHMM(toMin(hhmm) + n) : null);

/** A length: as Admin's list names it, or in minutes and hours. */
export const minutesText = (n: number | null | undefined) => {
  if (!n) return null;
  const named = listOf("step_length").find(([v]) => Number(v) === Number(n));
  return named ? named[1] : n % 60 === 0 && n >= 60 ? `${n / 60} hr` : `${n} min`;
};

/** An interview's day, start, end and length, from its `at` and `minutes`; a time of 00:00 is none. */
export function stepTimes(x: Row): { date: string | null; start: string | null; end: string | null; minutes: number | null } {
  const at: string | null = x.at || null;
  const date = at ? at.slice(0, 10) : null;
  const start = at && at.length > 10 && at.slice(11, 16) !== "00:00" ? at.slice(11, 16) : null;
  const minutes = x.minutes ? Number(x.minutes) : null;
  return { date, start, end: start && minutes ? later(start, minutes) : null, minutes };
}

/** When it is, in words: Tomorrow 3:00 pm – 4:00 pm · 1 hr. */
export function WhenText({ step, fallback }: { step: Row; fallback?: string }) {
  const { date, start, end, minutes } = stepTimes(step);
  if (!date) return fallback ? <span className="muted">{fallback}</span> : null;
  const late = step.status === "scheduled" && isOverdue(step.at);
  return (
    <span className={`step-when${late ? " is-late" : ""}`}>
      <time dateTime={step.at}>{fmtDay(date)}</time>
      {start ? <span translate="no">{end ? `${fmtTime(start)} – ${fmtTime(end)}` : fmtTime(start)}</span> : null}
      {minutes ? <><span aria-hidden="true">·</span><span>{minutesText(minutes)}</span></> : null}
    </span>
  );
}

/** A time typed as people say them: 3, 3pm, 3:30, 15:30, 1530, 3.30 pm, in either digit set; "HH:MM", or null. */
export function parseTime(text: string, twelve: boolean): string | null {
  const t = text.trim().toLowerCase()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));
  if (!t) return null;
  const pm = /p|م/.test(t), am = !pm && /a|ص/.test(t);
  let h: number, m: number;
  const bare = t.match(/^(\d{3,4})\s*[a-zء-ي.]*$/);
  if (bare) { h = Number(bare[1].slice(0, -2)); m = Number(bare[1].slice(-2)); }
  else {
    const p = t.match(/^(\d{1,2})(?:\s*[:.h٫]\s*(\d{1,2}))?/);
    if (!p) return null;
    h = Number(p[1]); m = p[2] ? Number(p[2]) : 0;
  }
  if (m > 59 || h > 23 || ((pm || am) && (h > 12 || h === 0))) return null;
  if (pm && h < 12) h += 12;
  else if (am && h === 12) h = 0;
  // On a 12-hour clock, an interview at "3" is in the afternoon.
  else if (!pm && !am && twelve && h >= 1 && h <= 7) h += 12;
  return toHHMM(h * 60 + m);
}

/**
 * A time of day: typed, or picked from a list in quarter hours, opened as
 * it's focused at the time it has (or 9:00). Given `after` (a start), it's
 * an end: its list runs from just after it, each saying how long that is,
 * and a time before it is turned away.
 */
export function TimeField({ id, value, after, label, placeholder, disabled, onChange }: {
  id?: string; value: string | null; after?: string | null; label: string; placeholder?: string; disabled?: boolean;
  onChange: (v: string | null) => void;
}) {
  const listId = useId();
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const twelve = twelveHour();
  const options: { v: string; hint?: string }[] = [];
  if (after) {
    for (let n = toMin(after) + 15; n < 24 * 60 && n <= toMin(after) + 12 * 60; n += 15) options.push({ v: toHHMM(n), hint: minutesText(n - toMin(after)) || undefined });
  } else {
    for (let n = 0; n < 24 * 60; n += 15) options.push({ v: toHHMM(n) });
  }
  /** The option at or just after a time. */
  const near = (hhmm: string | null) => {
    if (!hhmm) return after ? Math.min(3, options.length - 1) : options.findIndex((o) => o.v === "09:00");
    const i = options.findIndex((o) => toMin(o.v) >= toMin(hhmm));
    return i < 0 ? options.length - 1 : i;
  };
  const show = (i: number) => {
    setActive(i);
    requestAnimationFrame(() => {
      const ul = list.current, li = ul?.children[i] as HTMLElement | undefined;
      if (ul && li) ul.scrollTop = li.offsetTop - ul.clientHeight / 2 + li.offsetHeight / 2;
    });
  };
  const fits = (v: string | null) => !v || !after || toMin(v) > toMin(after);
  const pick = (v: string | null) => { setTyped(null); setOpen(false); onChange(v); };
  /** What's in the box, read from it (not the last render), taken as the time: none if it's cleared, as it was if it can't be read. */
  const commit = (text: string) => {
    if (text === (value ? fmtTime(value) : "")) return setTyped(null);
    if (!text.trim()) return pick(null);
    const v = parseTime(text, twelve);
    if (v && fits(v)) pick(v);
    else setTyped(null);
  };
  useEffect(() => { if (open) show(near((typed != null && parseTime(typed, twelve)) || value)); }, [open]);
  return (
    <div className="combo time-field">
      <Input id={id} type="text" inputMode="text" autoComplete="off" role="combobox" aria-label={label} placeholder={placeholder}
        aria-autocomplete="list" aria-expanded={open ? "true" : "false"} aria-controls={listId} disabled={disabled}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        value={typed ?? (value ? fmtTime(value) : "")}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={(e) => { commit(e.currentTarget.value); setOpen(false); }}
        onInput={(e) => {
          const text = e.currentTarget.value;
          setTyped(text);
          setOpen(true);
          const v = parseTime(text, twelve);
          if (v) show(near(v));
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) { setOpen(true); return; }
            show(Math.max(0, Math.min(options.length - 1, active + (e.key === "ArrowDown" ? 1 : -1))));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const text = e.currentTarget.value;
            if (text !== (value ? fmtTime(value) : "") && parseTime(text, twelve)) commit(text);
            else if (open && active >= 0) pick(options[active].v);
          } else if (e.key === "Escape" && open) {
            e.preventDefault(); e.stopPropagation();
            setTyped(null); setOpen(false);
          }
        }} />
      <ul ref={list} className="combo-list time-list" id={listId} role="listbox" aria-label={label} hidden={!open}>
        {open ? options.map((o, i) => (
          <li key={o.v} id={`${listId}-${i}`} role="option" aria-selected={o.v === value ? "true" : "false"}
            className={[i === active ? "active" : "", o.v === value ? "chosen" : ""].join(" ").trim() || undefined}
            onMouseDown={(e) => { e.preventDefault(); pick(o.v); }}>
            <span translate="no">{fmtTime(o.v)}</span>{o.hint ? <small>{o.hint}</small> : null}
          </li>
        )) : null}
      </ul>
    </div>
  );
}

/** Its day, start and end, as the form has them. */
export interface When { date: string | null; start: string | null; end: string | null }

/**
 * When an interview is: its day, from the calendar or typed; its start; and
 * its end, or a length from Admin's list, which sets the end. Moving the
 * start keeps its length; a first start gets an hour (or the list's first).
 */
export function WhenFields({ w, idPrefix }: { w: When; idPrefix: string }) {
  const [, redraw] = useState(0);
  const lengths = listOf("step_length").map(([m, l]) => [Number(m), l] as [number, string]).filter(([m]) => m > 0);
  const usual = lengths.some(([m]) => m === 60) ? 60 : lengths[0]?.[0] || 60;
  const length = w.start && w.end ? toMin(w.end) - toMin(w.start) : null;
  const set = (k: keyof When, v: string | null) => { w[k] = v; redraw((n) => n + 1); };
  return (
    <div className="step-when-fields">
      <Field><Label htmlFor={`${idPrefix}-date`}>Day</Label><DatePicker id={`${idPrefix}-date`} value={w.date} onChange={(d) => set("date", d)} /></Field>
      <Field><Label htmlFor={`${idPrefix}-start`}>Starts</Label>
        <TimeField id={`${idPrefix}-start`} label="Starts" placeholder="Time" value={w.start} onChange={(v) => {
          const kept = length ?? usual;
          w.start = v;
          w.end = v ? later(v, kept) : null;
          redraw((n) => n + 1);
        }} /></Field>
      <Field><Label htmlFor={`${idPrefix}-end`}>Ends</Label>
        <TimeField id={`${idPrefix}-end`} label="Ends" placeholder={w.start ? "Time" : "Start first"} value={w.end} after={w.start} disabled={!w.start}
          onChange={(v) => set("end", v)} /></Field>
      <div className="step-when-length" role="group" aria-label="Length">
        <span className="step-when-length-label">Length</span>
        {lengths.map(([m, l]) => (
          <button key={m} type="button" className="al-button al-button--sm step-chip" aria-pressed={length === m ? "true" : "false"} disabled={!w.start || !later(w.start, m)}
            onClick={() => set("end", later(w.start!, m))}>{l}</button>
        ))}
        {length && !lengths.some(([m]) => m === length) ? <span className="step-when-length-now">{minutesText(length)}</span> : null}
      </div>
      <p className="al-hint step-when-zone">{`Times are in ${timeZone().replace(/_/g, " ")}`}</p>
    </div>
  );
}

/** Whether an interview can still be joined: it's to come, has a link, and hasn't ended (an hour, if its length isn't set). */
export function joinable(x: Row): boolean {
  if (x.status !== "scheduled" || !isUrl(x.place)) return false;
  const { date, start, minutes } = stepTimes(x);
  if (!date) return true;
  if (!start) return daysFromToday(parseLocal(date)) >= 0;
  return parseLocal(x.at).getTime() + (minutes || 60) * 60000 > zonedNow().getTime();
}

/** Where to go, for one in person: its address, or one written as its joining link before. */
export const addressOf = (x: Row): string | null => x.address || (x.place && !isUrl(x.place) ? x.place : null);
/** A number to call, as a link: its digits, + and what dials on (a pause, a PIN's #). */
export const telOf = (phone: string) => `tel:${phone.replace(/[^\d+,;*#]/g, "")}`;

/** Where an address opens: a maps link as it is; written out, a search for it in a map. */
export const mapHref = (address: string) => (isUrl(address) ? hrefOf(address) : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`);

/** A joining link or an address: a link, by how it starts. */
export const isUrl = (v: string | null | undefined) => /^(https?:\/\/|[\w-]+\.[\w.-]+\/)/i.test(v || "");
export const hrefOf = (v: string) => (/^https?:/i.test(v) ? v : `https://${v}`);

/** Join: its platform's logo (a camera, for one hunt doesn't know), and the word; while it can be joined. */
export function JoinButton({ step }: { step: Row }) {
  if (!joinable(step)) return null;
  const name = platformOf(step.place)?.name;
  return (
    <a className="al-button al-button--sm step-join" href={hrefOf(step.place)} target="_blank" rel="noreferrer" title={name ? `Join on ${name}` : step.place}>
      <PlatformMark url={step.place} video /><span>Join</span></a>
  );
}

/** Beside Join, while it's to come: a phone to call it on, and a map to where it is, each an icon. */
export function CallButtons({ step }: { step: Row }) {
  if (step.status !== "scheduled") return null;
  const address = addressOf(step);
  return <>
    {step.phone ? <a className="al-button al-button--sm al-button--icon step-icon-button" href={telOf(step.phone)} title={step.phone} aria-label={`Call ${step.phone}`}><Icon name="phone" /></a> : null}
    {address ? <a className="al-button al-button--sm al-button--icon step-icon-button" href={mapHref(address)} target="_blank" rel="noreferrer"
      title={isUrl(address) ? "Open the map" : address} aria-label="Open the map"><Icon name="map" /></a> : null}
  </>;
}

// ---- its links -------------------------------------------------------------------------------

/** One of an interview's links, as it's edited: a name (or none) and its address. */
export type StepLink = { label: string | null; url: string };

/** An address as it's opened: one typed without its scheme gets https. */
export const linkHref = (v: string) => (/^[a-z][\w+.-]*:/i.test(v) ? v : `https://${v}`);

/** Its links, written: each with its address, trimmed; a blank name none. */
export const cleanLinks = (links: StepLink[]): StepLink[] => links
  .filter((l) => l.url && l.url.trim())
  .map((l) => ({ label: l.label?.trim() || null, url: linkHref(l.url.trim()) }));

/**
 * What a link goes to, drawn: its platform's logo, in its colour, if hunt
 * knows the platform and has its logo; otherwise a call's camera (`video`,
 * or a platform known for calls) or a link.
 */
export function PlatformMark({ url, video = false }: { url: string; video?: boolean }) {
  const p = platformOf(url);
  if (!p?.mark) return <Icon name={video || p?.video ? "video" : "link"} />;
  const [hex, d, evenOdd] = p.mark;
  return (
    <svg className="platform-mark" viewBox="0 0 24 24" width={16} height={16} aria-hidden="true" style={{ color: markColour(hex) }}>
      <path d={d} fill="currentColor" fillRule={evenOdd ? "evenodd" : undefined} />
    </svg>
  );
}

/** A link's name: as written, or its platform's, or its host. */
export const linkTitle = (l: StepLink) => l.label || platformOf(l.url)?.name || hostName(l.url);

/** Each link row's key, for as long as it's edited: kept when one before it goes. */
const linkKeys = new WeakMap<StepLink, number>();
let nextLinkKey = 0;
const linkKey = (l: StepLink) => { if (!linkKeys.has(l)) linkKeys.set(l, ++nextLinkKey); return linkKeys.get(l)!; };

/** An interview's links, edited: a name and an address each, its logo beside once it's known. */
export function StepLinksEditor({ links, onChange }: { links: StepLink[]; onChange?: () => void }) {
  const [, redraw] = useState(0);
  const changed = () => { redraw((n) => n + 1); onChange?.(); };
  const list = useRef<HTMLDivElement>(null);
  return (
    <div className="step-links-edit" ref={list}>
      {links.map((l, i) => (
        <div key={linkKey(l)} className="step-links-row">
          <span className="step-links-mark">{l.url ? <PlatformMark url={l.url} /> : <Icon name="link" />}</span>
          <Input aria-label="Name" placeholder="Name, e.g. Coding pad" defaultValue={l.label ?? ""}
            onInput={(e) => { l.label = e.currentTarget.value; onChange?.(); }} />
          <Input aria-label="Link" placeholder="https://" inputMode="url" defaultValue={l.url}
            onInput={(e) => { l.url = e.currentTarget.value; changed(); }} />
          <button className="al-button al-button--quiet al-button--sm" type="button" aria-label="Remove link" title="Remove link"
            onClick={() => { links.splice(i, 1); changed(); }}><Icon name="x" /></button>
        </div>
      ))}
      <button className="al-button al-button--quiet al-button--sm step-links-add" type="button" onClick={() => {
        links.push({ label: "", url: "" });
        changed();
        requestAnimationFrame(() => list.current?.querySelector<HTMLInputElement>(".step-links-row:last-of-type input")?.focus());
      }}><Icon name="plus" /><span>Add a link</span></button>
    </div>
  );
}


// ---- who it's with -----------------------------------------------------------------------

/** Who an interview is with: people from People, or new names, made as it's saved. */
function PeoplePicker({ people, attendees, clearAttendees }: { people: Row[]; attendees?: string | null; clearAttendees?: () => void }) {
  const [, redraw] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const source = refSource("people");
  const changed = () => { redraw((n) => n + 1); requestAnimationFrame(() => box.current?.querySelector("input")?.focus()); };
  return (
    <div className="app-with step-with" ref={box}>
      {people.map((p, j) => (
        <span key={`${p.id}-${p.name}`} className="al-tag" title={p.id == null ? "Added to People when you save" : undefined}>{p.name}{p.id == null ? " (new)" : ""}
          <button className="al-tag__remove" type="button" aria-label={`Remove ${p.name}`} onClick={() => { people.splice(j, 1); changed(); }}>×</button></span>
      ))}
      <Combo key={people.length} id="sf-with" label="With whom" placeholder={people.length ? "Add someone else…" : "Someone from People, or a new name"} allowCreate
        source={async (q) => (await source(q)).filter((it) => !people.some((p) => p.id === it.value))}
        onPick={(it) => {
          if (it.create) {
            if (!people.some((p) => p.id == null && p.name.toLowerCase() === String(it.value).toLowerCase())) people.push({ id: null, name: it.value });
          } else {
            people.push({ id: it.value, name: it.label.replace(/ \([^)]*\)$/, "") });
          }
          changed();
        }} />
      {attendees ? <p className="muted small app-with-before">{`Written before: “${attendees}” `}
        <button className="al-button al-button--sm al-button--quiet" type="button" onClick={() => { clearAttendees?.(); redraw((n) => n + 1); }}>Clear</button></p> : null}
    </div>
  );
}

/** A tag still being typed into the tag box, added as if it were picked: Enter, a comma, or saving takes it. */
function takeTyped(tags: string[], input: HTMLInputElement | null): boolean {
  const n = (input?.value || "").replace(/,/g, " ").split(/\s+/).filter(Boolean).join(" ");
  if (input) input.value = "";
  if (!n || tags.some((t) => t.toLowerCase() === n.toLowerCase())) return false;
  tags.push(S.TAGS.find((t) => t.name.toLowerCase() === n.toLowerCase())?.name || n);
  return true;
}

/** Its tags, as the form has them: chips to remove, and a box to add one (an existing tag, or a new one); saved with it. */
function TagsPicker({ tags }: { tags: string[] }) {
  const [, redraw] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const changed = () => { redraw((n) => n + 1); requestAnimationFrame(() => box.current?.querySelector("input")?.focus()); };
  const has = (n: string) => tags.some((t) => t.toLowerCase() === n.toLowerCase());
  return (
    <div className="app-with step-tags" ref={box}>
      {tags.map((t, j) => (
        <TagChip key={t} name={t}>
          <button className="al-tag__remove" type="button" aria-label={`Remove tag ${t}`} onClick={() => { tags.splice(j, 1); changed(); }}>×</button>
        </TagChip>
      ))}
      <Combo key={tags.length} id="sf-tags" label="Add a tag" placeholder={tags.length ? "Add another…" : "e.g. Coding, System design"} allowCreate
        source={async (q) => S.TAGS.filter((t) => !has(t.name) && t.name.toLowerCase().includes(q.toLowerCase())).map((t) => ({ value: t.name, label: t.name }))}
        onPick={(it) => { const n = String(it.value).trim(); if (n && !has(n)) tags.push(n); changed(); }}
        onKeyDown={(e) => {
          // Enter or a comma adds what's typed (Enter would otherwise save the form without it).
          if (e.defaultPrevented || (e.key !== "Enter" && e.key !== ",")) return;
          if (!e.currentTarget.value.trim()) return;
          e.preventDefault();
          takeTyped(tags, e.currentTarget);
          changed();
        }} />
    </div>
  );
}

// ---- adding or editing it, in a dialog ------------------------------------------------------

/**
 * Add an interview to process `p`, or edit `step`: in groups, what it is
 * and when first, then who and where, then what to prepare. New names in
 * With become people at `companyId`. `cancel` goes back (to its details);
 * without, it closes.
 */
export function StepForm({ p, step, companyId, saving, done, cancel }: {
  p: Row; step?: Row; companyId: number | null; saving: Saving; done: () => void; cancel?: () => void;
}) {
  const formats = listOf("step_format");
  const statuses = R("steps").fields.find((f) => f.name === "status")!.options;
  const v = useRef((() => {
    const t = step ? stepTimes(step) : { date: null, start: null, end: null };
    return {
      title: step?.title || "", format: step ? step.format || "" : formats[0]?.[0] || "", status: step?.status || "scheduled",
      remind: step ? step.remind || "" : "hour", place: isUrl(step?.place) ? step!.place : "",
      phone: step?.phone || "", address: (step && addressOf(step)) || "", prep: step?.prep_note || "", note: step?.note || "",
      people: ((step?.people || []) as Row[]).map((x) => ({ id: x.id, name: x.name })), attendees: (step?.attendees || null) as string | null,
      links: ((step?.links || []) as StepLink[]).map((l) => ({ label: l.label ?? "", url: l.url })),
      when: { date: t.date, start: t.start, end: t.end } as When,
      tags: [...tagNames(step?.tags)],
    };
  })()).current;
  const [status, setStatus] = useState(v.status);
  const haveFormat = !v.format || formats.some(([f]) => f === v.format) ? formats : [...formats, [v.format, v.format] as [string, string]];
  const back = cancel ? () => { if (mayDiscard(document.getElementById("modal"))) cancel(); } : dismissModal;
  return (
    <form className="step-form" onSubmit={async (e) => {
      e.preventDefault();
      if (!v.title.trim()) { document.getElementById("sf-title")?.focus(); return; }
      takeTyped(v.tags, document.getElementById("sf-tags") as HTMLInputElement | null);
      const w = v.when;
      const minutes = w.start && w.end ? toMin(w.end) - toMin(w.start) : w.start ? null : step?.minutes ?? null;
      const fields: Row = {
        title: v.title.trim(), at: w.date ? `${w.date}T${w.start || "00:00"}` : null, minutes, format: v.format || null, status: v.status,
        remind: v.status === "scheduled" ? v.remind || null : null, place: v.place.trim() || null,
        phone: v.phone.trim() || null, address: v.address.trim() || null,
        prep_note: v.prep && toPlain(v.prep).trim() ? v.prep : null, note: v.note.trim() || null, attendees: v.attendees,
      };
      const ok = await saving(async () => {
        let id = step?.id;
        if (step) {
          const was: Row = { ...step, at: step.at || null, note: step.note || null };
          const changed = Object.fromEntries(Object.entries(fields).filter(([k, x]) => (x ?? null) !== (was[k] ?? null) && !(k === "minutes" && Number(x) === Number(was[k]))));
          if (Object.keys(changed).length) await patch(`steps/${id}`, changed);
        } else {
          id = (await post("steps", { process_id: p.id, ...fields })).id;
        }
        for (const x of v.people) {
          if (x.id == null) x.id = (await post("people", { name: x.name, company_id: companyId })).id;
        }
        const ids = v.people.map((x) => x.id);
        const had = ((step?.people || []) as Row[]).map((x) => x.id);
        if (ids.slice().sort().join(",") !== had.slice().sort().join(",")) await put(`steps/${id}/people`, { person_ids: ids });
        const links = cleanLinks(v.links);
        if (JSON.stringify(links) !== JSON.stringify(cleanLinks(step?.links || []))) await put(`steps/${id}/links`, { links });
        if (JSON.stringify(v.tags) !== JSON.stringify(tagNames(step?.tags))) {
          await put(`steps/${id}/tags`, { tags: v.tags });
          if (v.tags.some((n) => !S.TAGS.some((t) => t.name.toLowerCase() === n.toLowerCase()))) await reloadTags();
        }
        return true;
      });
      if (!ok) return;
      if (step) toast("Saved");
      else toast(`Interview added${fields.remind && w.date ? ` · reminder set ${fields.remind === "hour" ? "an hour" : "the day"} before` : ""}`);
      done();
    }}>
      <h2 className="al-dialog__title" id="modal-title">{step ? "Edit the interview" : "Add an interview"}</h2>
      <div className="al-dialog__body step-form-body">
        <Field className="step-form-title"><Label htmlFor="sf-title">Interview</Label>
          <Input id="sf-title" placeholder="e.g. Final round with the CTO" defaultValue={v.title} onInput={(e) => { v.title = e.currentTarget.value; }} /></Field>
        <fieldset className="step-form-group">
          <legend>When</legend>
          <WhenFields w={v.when} idPrefix="sf" />
        </fieldset>
        <fieldset className="step-form-group">
          <legend>What, and with whom</legend>
          <div className="step-form-row">
            <Field><Label htmlFor="sf-format">Format</Label>
              <Select id="sf-format" defaultValue={v.format} onChange={(e) => { v.format = e.currentTarget.value; }}>
                {[...haveFormat, ["", "Not set"]].map(([f, l]) => <option key={f} value={f}>{l}</option>)}
              </Select></Field>
            <Field><Label htmlFor="sf-status">Status</Label>
              <Select id="sf-status" defaultValue={v.status} onChange={(e) => { v.status = e.currentTarget.value; setStatus(v.status); }}>
                {statuses.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select></Field>
            <Field><Label htmlFor="sf-remind">Remind me</Label>
              <Select id="sf-remind" defaultValue={v.remind} disabled={status !== "scheduled"} onChange={(e) => { v.remind = e.currentTarget.value; }}>
                {[["hour", "An hour before"], ["day", "The day before"], ["", "Don't remind me"]].map(([r, l]) => <option key={r} value={r}>{l}</option>)}
              </Select></Field>
          </div>
          <Field><Label htmlFor="sf-with">With <Optional /></Label>
            <PeoplePicker people={v.people} attendees={v.attendees} clearAttendees={() => { v.attendees = null; }} /></Field>
          <Field><Label htmlFor="sf-tags">Tags <Optional /></Label><TagsPicker tags={v.tags} /></Field>
        </fieldset>
        <fieldset className="step-form-group">
          <legend>Where</legend>
          <div className="step-form-row step-form-row--where">
            <Field><Label htmlFor="sf-where">Joining link <Optional /></Label>
              <PlaceInput value={v.place} onInput={(x) => { v.place = x; }} /></Field>
            <Field><Label htmlFor="sf-phone">Phone <Optional /></Label>
              <div className="step-place"><span className="step-place-mark" aria-hidden="true"><Icon name="phone" /></span>
                <Input id="sf-phone" type="tel" placeholder="A dial-in, or the call's backup" defaultValue={v.phone} onInput={(e) => { v.phone = e.currentTarget.value; }} /></div></Field>
          </div>
          <Field><Label htmlFor="sf-address">Address <Optional /></Label>
            <div className="step-place"><span className="step-place-mark" aria-hidden="true"><Icon name="map" /></span>
              <Input id="sf-address" placeholder="An address, or a maps link" defaultValue={v.address} onInput={(e) => { v.address = e.currentTarget.value; }} /></div></Field>
          <Field><Label>Other links <Optional /></Label><StepLinksEditor links={v.links} /></Field>
        </fieldset>
        <fieldset className="step-form-group">
          <legend>Prepare, and how it went</legend>
          <Field><Label htmlFor="sf-prep">What to prepare <Optional /></Label>
            <RichText id="sf-prep" value={v.prep} rows={3} label="What to prepare" placeholder="Topics they mentioned, things to bring" onChange={(html) => { v.prep = html; }} /></Field>
          {step ? <Field><Label htmlFor="sf-note">Notes <Optional /></Label>
            <textarea id="sf-note" className="al-textarea" rows={3} placeholder="Questions asked, feedback…" defaultValue={v.note} onInput={(e) => { v.note = e.currentTarget.value; }} /></Field> : null}
        </fieldset>
      </div>
      <div className="al-dialog__actions">
        <button className="al-button" type="button" onClick={back}>{cancel ? "Back" : "Cancel"}</button>
        <button className="al-button al-button--primary" type="submit">{step ? "Save" : "Add interview"}</button>
      </div>
    </form>
  );
}

/** The joining link or address, its platform's logo beside once it's a link. */
function PlaceInput({ value, onInput }: { value: string; onInput: (v: string) => void }) {
  const [now, setNow] = useState(value);
  return (
    <div className="step-place">
      <span className="step-place-mark" aria-hidden="true">{isUrl(now) ? <PlatformMark url={now} video /> : <Icon name="video" />}</span>
      <Input id="sf-where" inputMode="url" placeholder="meet.example/…, zoom.us/j/…" defaultValue={value}
        onInput={(e) => { const x = e.currentTarget.value; setNow(x); onInput(x); }} />
    </div>
  );
}

// ---- its details, whole ---------------------------------------------------------------------

/**
 * An interview, whole, in the dialog: when, what, with whom, where, its
 * links, what to prepare (and the tasks for it), and how it went. Edit
 * turns the dialog into its form.
 */
export function StepView({ step, prep, canEdit, onEdit }: { step: Row; prep: Row[]; canEdit: boolean; onEdit: () => void }) {
  const statuses = R("steps").fields.find((f) => f.name === "status")!.options;
  const tone = step.status === "failed" ? "danger" : ["passed", "completed", "done"].includes(step.status) ? "success" : step.status === "scheduled" ? "accent" : undefined;
  const links: StepLink[] = step.links || [];
  const people: Row[] = step.people || [];
  const fact = (term: string, value: ReactNode) => (value ? <><dt>{term}</dt><dd>{value}</dd></> : null);
  return (
    <div className="al-dialog__inner step-view">
      <div className="step-view-head">
        <h2 className="al-dialog__title" id="modal-title" translate="no">{step.title}</h2>
        <span className={`al-badge${tone ? ` al-badge--${tone}` : ""}`}>{optionLabel(statuses, step.status)}</span>
      </div>
      {tagNames(step.tags).length ? <div className="step-tag-chips">{tagNames(step.tags).map((t: string) => <TagChip key={t} name={t} />)}</div> : null}
      <div className="al-dialog__body step-view-body">
        <div className="step-view-when">
          <Icon name="cal" /><WhenText step={step} fallback="Date not set" />
          <span className="step-view-actions"><JoinButton step={step} /><CallButtons step={step} /></span>
        </div>
        <dl className="app-facts step-view-facts">
          {fact("Format", step.format)}
          {fact("With", people.length ? <span className="step-view-people">{people.map((x, i) => <span key={x.id}>{i ? ", " : null}<a href={`/people/${x.id}`} translate="no">{x.name}</a></span>)}</span>
            : step.attendees ? <span translate="no">{step.attendees}</span> : null)}
          {fact("Joining link", isUrl(step.place)
            ? <a className="step-link" href={hrefOf(step.place)} target="_blank" rel="noreferrer"><PlatformMark url={step.place} video /><span>{step.place}</span></a> : null)}
          {fact("Phone", step.phone ? <a className="step-link" href={telOf(step.phone)}><Icon name="phone" /><span translate="no">{step.phone}</span></a> : null)}
          {fact("Address", addressOf(step) ? <a className="step-link" href={mapHref(addressOf(step)!)} target="_blank" rel="noreferrer"><Icon name="map" />
            <span translate="no">{isUrl(addressOf(step)) ? "Open the map" : addressOf(step)}</span></a> : null)}
          {fact("Links", links.length ? <ul className="step-view-links">{links.map((l, i) => (
            <li key={i}><a className="step-link" href={linkHref(l.url)} target="_blank" rel="noreferrer" title={l.url}>
              <PlatformMark url={l.url} /><span translate="no">{linkTitle(l)}</span></a>
              {l.label ? <span className="muted small" translate="no">{hostName(l.url)}</span> : null}</li>
          ))}</ul> : null)}
          {fact("Reminder", step.status === "scheduled" && step.remind ? (step.remind === "hour" ? "An hour before" : "The day before") : null)}
        </dl>
        {step.prep_note ? <section className="step-view-part"><h3>What to prepare</h3><RichView className="tl-rich step-view-text" value={step.prep_note} /></section> : null}
        {prep.length ? <section className="step-view-part"><h3>Tasks for it</h3>
          <ul className="step-view-tasks">{prep.map((x) => (
            <li key={x.id} className={x.status === "done" ? "is-done" : undefined}><Icon name={x.status === "done" ? "check" : "target"} /><span translate="no">{x.title}</span></li>
          ))}</ul></section> : null}
        {step.note ? <section className="step-view-part"><h3>Notes</h3><RichView className="tl-rich step-view-text" value={step.note} /></section> : null}
      </div>
      <div className="al-dialog__actions">
        <button className="al-button" type="button" onClick={closeModal}>Close</button>
        {canEdit ? <button className="al-button al-button--primary" type="button" onClick={onEdit}><Icon name="edit" /><span>Edit</span></button> : null}
      </div>
    </div>
  );
}
