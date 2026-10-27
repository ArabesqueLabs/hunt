// The calendar (/calendar): a month grid, a week, a day or an agenda of
// interviews, next actions and deadlines, searched.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { attempt, get } from "../lib/api";
import { LOC, daysFromToday, fmtTime, parseLocal, zonedNow } from "../lib/format";
import { R } from "../lib/meta";
import { here, settle } from "../lib/router";
import { S } from "../lib/state";
import { store, stored } from "../lib/storage";
import type { Row } from "../lib/types";
import { EmptyState, Input, LoadingBlock, Logo, SearchBox, SysIcon } from "../components/ui";

/** What the calendar shows, of active processes: all that's coming up, each kind in its colour, and what each is called beside its checkbox. */
const CAL_KINDS: [string, string][] = [["step", "Interviews"], ["next", "Next actions"], ["closes", "Deadlines"]];
const CAL_DEFAULTS: Record<string, string> = { view: "month", weekends: "", hide: "", q: "" };
/** The calendar's choices, by their names in the address. */
const CAL_KEYS = Object.keys(CAL_DEFAULTS);
const CAL_VIEWS = ["month", "week", "day", "agenda"];

/**
 * The calendar's choices, from the address (/calendar?view=week&weekends=hide),
 * so a view can be bookmarked and Back undoes a change. Opened with none, it
 * has the ones last used.
 */
function calendarFilters(): Record<string, string> {
  let q = new URLSearchParams(location.search);
  if (!CAL_KEYS.some((k) => q.has(k))) {
    const kept = stored("calendar") || "";
    // Remembered before the choices were in the address, as JSON: its view.
    try { q = new URLSearchParams(kept.startsWith("{") ? { view: JSON.parse(kept).view || "" } : kept); } catch { q = new URLSearchParams(); }
  }
  const f = Object.fromEntries(CAL_KEYS.map((k) => [k, q.get(k) || CAL_DEFAULTS[k]]));
  if (!CAL_VIEWS.includes(f.view)) f.view = CAL_DEFAULTS.view;
  return f;
}

/** The address for these choices (and the day the view is around, if not today). */
function calendarUrl(f: Record<string, string>, day: string) {
  const q = new URLSearchParams(CAL_KEYS.filter((k) => f[k] !== CAL_DEFAULTS[k]).map((k) => [k, f[k]]));
  if (day) q.set("date", day);
  return location.pathname + (q.toString() ? `?${q}` : "");
}

const isoDay = (d: Date) => d.toLocaleDateString("en-CA");
/** The day weeks start on: 1 for Monday, 0 for Sunday. */
const weekStart = () => (S.PREFS.week_start === "sunday" ? 0 : 1);
/** Saturday or Sunday. */
const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

/** An interview step's outcome, as Settings name it ("Passed"), if it has one. */
const stepOutcome = (e: Row) => (e.kind === "step" && e.detail && e.detail !== "scheduled"
  ? (R("step").fields.find((x) => x.name === "status")!.options.find(([v]) => v === e.detail) || [null, e.detail])[1]
  : null);
/** An event's classes: its kind, overdue, and an interview step's outcome. */
const eventClass = (e: Row, late: boolean) => `kind-${e.kind}${late ? " late" : ""}${e.kind === "step" && e.detail ? ` step-${e.detail}` : ""}`;

/** What the calendar's marks mean, under it (each kind's colour is its checkbox's). */
function Legend() {
  const item = (cls: string, text: string) => <li key={cls}><span className={`cal-key ${cls}`} aria-hidden="true" />{text}</li>;
  return (
    <ul className="cal-legend" aria-label="Key">
      {item("kind-step step-done", "Interview held")}
      {item("kind-next late", "Overdue")}
      {S.PREFS.work_hours ? item("cal-key-off", "Outside working hours") : null}
      {item("cal-key-now", "Now")}
    </ul>
  );
}

/** The calendar: a month grid, a week, a day or an agenda, searched. */
export function CalendarPage() {
  const [f, setF] = useState(calendarFilters);
  // The day the view is around: its month, its week, or itself.
  const today = () => { const d = zonedNow(); d.setHours(0, 0, 0, 0); return d; };
  const [at, setAt] = useState(() => {
    const given = new URLSearchParams(location.search).get("date");
    return given && /^\d{4}-\d{2}-\d{2}$/.test(given) ? parseLocal(given) : today();
  });
  const [q, setQ] = useState(f.q);
  const [events, setEvents] = useState<Row[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const atParam = (d: Date) => (isoDay(d) === isoDay(today()) ? "" : isoDay(d));
  // A change of view is a step Back undoes; moving through the months isn't.
  const keep = (next: Record<string, string>, d: Date, { push = true } = {}) => {
    const url = calendarUrl(next, atParam(d));
    if (url !== here()) history[push ? "pushState" : "replaceState"](null, "", url);
    settle();
    store("calendar", new URLSearchParams(CAL_KEYS.filter((k) => next[k] !== CAL_DEFAULTS[k]).map((k) => [k, next[k]])).toString());
  };
  const change = (o: Record<string, string>, { push = true } = {}) => { const next = { ...f, ...o }; setF(next); keep(next, at, { push }); };
  const moveTo = (d: Date) => { setAt(d); keep(f, d, { push: false }); };
  useEffect(() => { keep(f, at, { push: false }); }, []);
  // Weekends can be hidden from the month and the week only: a day and the
  // agenda show what there is.
  const hasWeekends = f.view === "month" || f.view === "week";
  const weekends = !hasWeekends || f.weekends !== "hide";
  // The kinds hidden, by their names in the address (hide=next,closes).
  const hidden = f.hide.split(",").filter(Boolean);
  const toggle = (kind: string, on: boolean) =>
    change({ hide: CAL_KINDS.map(([k]) => k).filter((k) => (k === kind ? !on : hidden.includes(k))).join(",") });

  const ws = weekStart();
  const month = new Date(at.getFullYear(), at.getMonth(), 1);
  let from: Date, to: Date, label: string;
  if (f.view === "week") {
    from = new Date(at); from.setDate(at.getDate() - ((at.getDay() - ws + 7) % 7));
    to = new Date(from); to.setDate(from.getDate() + 6);
    const same = from.getMonth() === to.getMonth();
    label = `${from.toLocaleDateString(LOC(), { day: "numeric", month: same ? undefined : "short" })} – ${to.toLocaleDateString(LOC(), { day: "numeric", month: "short", year: "numeric" })}`;
  } else if (f.view === "day") {
    from = new Date(at); to = new Date(at);
    label = at.toLocaleDateString(LOC(), { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  } else {
    from = new Date(month);
    to = new Date(at.getFullYear(), at.getMonth() + 1, 0);
    // The month grid runs a week at a time (from Monday, or Sunday as
    // Settings say), so it shows a few days either side.
    if (f.view === "month") {
      from.setDate(from.getDate() - ((from.getDay() - ws + 7) % 7));
      to.setDate(to.getDate() + ((ws + 6 - to.getDay() + 7) % 7));
    }
    label = month.toLocaleDateString(LOC(), { month: "long", year: "numeric" });
  }
  const unit = ({ week: "week", day: "day" } as Record<string, string>)[f.view] || "month";
  const range = `${isoDay(from)}|${isoDay(to)}`;
  useEffect(() => {
    let alive = true;
    const query = new URLSearchParams({ from: isoDay(from), to: isoDay(to), kinds: CAL_KINDS.map(([k]) => k).join(","), status: "active" });
    if (f.q) query.set("q", f.q);
    attempt(() => get(`calendar?${query}`)).then((list) => { if (alive && list) setEvents(list); });
    return () => { alive = false; };
  }, [range, f.q]);
  // Back or on: a month, a week or a day, as the view shows.
  const step = (n: number) => {
    const d = new Date(at);
    if (f.view === "week") d.setDate(d.getDate() + 7 * n);
    else if (f.view === "day") d.setDate(d.getDate() + n);
    else { moveTo(new Date(at.getFullYear(), at.getMonth() + n, 1)); return; }
    moveTo(d);
  };
  // Kinds unticked leave it; weekends hidden (in the month or the week), their days too.
  const shown = events ? events.filter((e) => !hidden.includes(e.kind) && (weekends || !isWeekend(parseLocal(e.at.slice(0, 10))))) : null;
  return (
    <div className="page calendar">
      <div className="al-page-head page-head">
        <h1>Calendar</h1>
        <SearchBox placeholder="Search companies, roles, steps" aria-label="Search the calendar" value={q} onValue={(v) => {
          setQ(v);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => change({ q: v.trim() }, { push: false }), 200);
        }} />
        {/* Working hours, time zones and sharing with calendar apps: in Settings. */}
        <a className="al-button al-button--icon al-button--quiet" href="/settings?tab=calendar" aria-label="Calendar settings" title="Calendar settings"><SysIcon name="settings" /></a>
      </div>
      {/* Where it is; then, at the end, weekends and the view, centred on the same line. */}
      <div className="cal-bar">
        <div className="cal-nav">
          <button className="al-button" type="button" aria-label={`Previous ${unit}`} onClick={() => step(-1)}>‹</button>
          <button className="al-button" type="button" onClick={() => moveTo(today())}>Today</button>
          <button className="al-button" type="button" aria-label={`Next ${unit}`} onClick={() => step(1)}>›</button>
          <h2 className="cal-month">{label}</h2>
        </div>
        <div className="cal-filters">
          <div className="cal-kinds" role="group" aria-label="Show">
            {CAL_KINDS.map(([k, l]) => (
              <label key={k} className={`cal-kind al-choice kind-${k}`}>
                <Input type="checkbox" checked={!hidden.includes(k)} onChange={(e) => toggle(k, e.target.checked)} />{l}
              </label>
            ))}
          </div>
          <label className="cal-kind al-choice" hidden={!hasWeekends}>
            <Input type="checkbox" checked={weekends} onChange={(e) => change({ weekends: e.target.checked ? "" : "hide" })} />Weekends
          </label>
          <div className="al-segmented" role="group" aria-label="View">
            {([["month", "Month"], ["week", "Week"], ["day", "Day"], ["agenda", "Agenda"]] as [string, string][]).map(([v, l]) => (
              <button key={v} type="button" aria-pressed={String(f.view === v) as "true" | "false"} onClick={() => change({ view: v })}>{l}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="cal-body" aria-live="polite">
        {shown == null ? <LoadingBlock tall={1} lines={5} />
          : f.view === "month" ? <MonthGrid from={from} to={to} month={month} events={shown} weekends={weekends} />
            : f.view === "week" ? <TimeGrid days={[...Array(7)].map((_, i) => { const d = new Date(from); d.setDate(from.getDate() + i); return d; }).filter((d) => weekends || !isWeekend(d))} events={shown} name="Week" />
              : f.view === "day" ? <TimeGrid days={[at]} events={shown} name="Day" />
                : <Agenda events={shown} />}
      </div>
      <Legend />
    </div>
  );
}

/** Where an event leads: its process, or else its application. */
const eventHref = (e: Row) => (e.process_id ? `/p/${e.process_id}` : `/applications/${e.application_id}`);

function eventLabel(e: Row) {
  const time = e.at && e.at.length > 10 && !e.at.endsWith("T00:00") ? fmtTime(e.at.slice(11, 16)) : null;
  const late = e.kind === "next" && daysFromToday(parseLocal(e.at)) < 0;
  return { time, late };
}

function MonthGrid({ from, to, month, events, weekends }: { from: Date; to: Date; month: Date; events: Row[]; weekends: boolean }) {
  const byDay = new Map<string, Row[]>();
  for (const e of events) {
    const d = e.at.slice(0, 10);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(e);
  }
  const today = isoDay(zonedNow());
  const days: Date[] = [];
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) if (weekends || !isWeekend(d)) days.push(new Date(d));
  // Day names in the region's language, from the week's first day; without
  // the weekend's, while it's hidden.
  const names = [...Array(7)].map((_, i) => new Date(2024, 0, 7 + weekStart() + i))
    .filter((d) => weekends || !isWeekend(d)).map((d) => d.toLocaleDateString(LOC(), { weekday: "short" }));
  // A grid to see, not one to move around in with the arrow keys: each day
  // says its whole date to a screen reader, and its events are links.
  return (
    <div className="cal-grid" role="group" aria-label="Month" style={{ "--cols": names.length } as React.CSSProperties}>
      {names.map((n, i) => <div key={i} className="cal-dow" aria-hidden="true">{n}</div>)}
      {days.map((d) => {
        const key = isoDay(d);
        const items = byDay.get(key) || [];
        return (
          <div key={key} className={["cal-day", d.getMonth() !== month.getMonth() ? "outside" : "", key === today ? "today" : ""].filter(Boolean).join(" ")}>
            <span className="cal-date"><span aria-hidden="true">{d.getDate()}</span>
              <span className="al-visually-hidden">{d.toLocaleDateString(LOC(), { weekday: "long", day: "numeric", month: "long" })}</span></span>
            {items.map((e, i) => {
              const { time, late } = eventLabel(e);
              const outcome = stepOutcome(e);
              return (
                <a key={i} className={`ev ${eventClass(e, late)}`} href={eventHref(e)} title={`${e.title} — ${e.company}${e.role ? `, ${e.role}` : ""}${outcome ? ` (${outcome})` : ""}`}>
                  <Logo id={e.company_id} logo={e.company_logo} name={e.company} size={14} />
                  {time ? <span className="ev-time">{time}</span> : null}<span className="ev-text">{`${e.company} · ${e.title}`}</span>
                </a>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** The zone the calendar's times are in: hunt's, or else the browser's. */
const calendarZone = () => S.PREFS.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

/** A zone's offset from UTC, in ms, at an instant. */
function zoneOffset(zone: string, ms: number) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(ms).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
}

/** A day's hour in the calendar's zone, as the time it is then in another ("14:30"). */
function hourIn(day: Date, hour: number, zone: string) {
  const wall = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), hour);
  const home = calendarZone();
  let at = wall - zoneOffset(home, wall);
  at = wall - zoneOffset(home, at);
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

/** A zone's short name on a day: its abbreviation or offset ("GMT+9"). */
function zoneShort(zone: string, day: Date) {
  try {
    return new Intl.DateTimeFormat(LOC(), { timeZone: zone, timeZoneName: "short" }).formatToParts(day).find((p) => p.type === "timeZoneName")?.value || zone;
  } catch { return zone; }
}

/**
 * Days side by side, midnight to midnight: each event at its time and an
 * hour long (as calendar apps are given them), what has no time above them,
 * all day. Events at the same time share the column. The hours scroll, and
 * open on the morning (the working day's, if Settings give one), or earlier
 * if something is. Outside working hours is shaded; other time zones'
 * hours run beside the calendar's own.
 */
function TimeGrid({ days, events, name }: { days: Date[]; events: Row[]; name: string }) {
  const HOUR = 2.1; // rem
  const scroller = useRef<HTMLDivElement>(null);
  const minutes = (e: Row) => Number(e.at.slice(11, 13)) * 60 + Number(e.at.slice(14, 16));
  const today = isoDay(zonedNow());
  const now = zonedNow();
  const dayName = (d: Date) => d.toLocaleDateString(LOC(), { weekday: "long", day: "numeric", month: "long" });
  const block = (e: Row, style?: React.CSSProperties, key?: number | string) => {
    const { time, late } = eventLabel(e);
    const outcome = stepOutcome(e);
    return (
      <a key={key} className={`ev ev-block ${eventClass(e, late)}`} href={eventHref(e)} style={style} title={`${e.title} — ${e.company}${e.role ? `, ${e.role}` : ""}${outcome ? ` (${outcome})` : ""}`}>
        {/* The time and title on one line, so an hour holds the company too. */}
        <span className="ev-line">{time ? <span className="ev-time">{time}</span> : null}
          <span className="ev-title" translate="no">{e.title}{outcome ? <span className="ev-outcome">{` · ${outcome}`}</span> : null}</span></span>
        <span className="ev-who"><Logo id={e.company_id} logo={e.company_logo} name={e.company} size={14} /><span translate="no">{e.company}</span></span>
      </a>
    );
  };
  const columns = days.map((d) => {
    const key = isoDay(d);
    const mine = events.filter((e) => e.at.slice(0, 10) === key);
    // Side by side where they overlap: each takes the first free column.
    const placed: { e: Row; start: number; col: number; cols?: number }[] = [];
    for (const e of mine.filter((x) => eventLabel(x).time)) {
      const start = minutes(e);
      const busy = placed.filter((p) => p.start < start + 60 && start < p.start + 60).map((p) => p.col);
      let col = 0;
      while (busy.includes(col)) col++;
      placed.push({ e, start, col });
    }
    for (const p of placed) p.cols = 1 + Math.max(...placed.filter((q) => q.start < p.start + 60 && p.start < q.start + 60).map((q) => q.col));
    return { d, key, allDay: mine.filter((x) => !eventLabel(x).time), placed };
  });
  const earliest = Math.min(...columns.flatMap((c) => c.placed.map((p) => p.start)));
  const work = S.PREFS.work_hours;
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const weekday = (d: Date) => ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][d.getDay()];
  // Outside working hours: the whole of a day off, or before and after.
  const shade = (d: Date): ReactNode => {
    if (!work) return null;
    if (!work.days.includes(weekday(d))) return <div className="cal-off" style={{ top: 0, bottom: 0 }} />;
    return <>
      <div className="cal-off" style={{ top: 0, height: `calc(${mins(work.start) / 60} * var(--hour))` }} />
      <div className="cal-off" style={{ top: `calc(${mins(work.end) / 60} * var(--hour))`, bottom: 0 }} />
    </>;
  };
  // Each zone's hours, the calendar's own last (beside the days), as the first day has them.
  const others: string[] = S.PREFS.calendar_zones || [];
  const gutter = (zone: string | null) => (
    <div key={zone || "home"} className={`cal-gutter${zone ? " other" : ""}`} aria-hidden="true">
      {[...Array(24)].map((_, n) => <span key={n} className="cal-hour">{n ? fmtTime(zone ? hourIn(days[0], n, zone) : `${String(n).padStart(2, "0")}:00`) : ""}</span>)}
    </div>
  );
  const zoneHeads = others.length ? [...others, calendarZone()].map((z) => <span key={z} className="cal-zone" title={z}>{zoneShort(z, days[0])}</span>) : [<span key="none" />];
  // Open an hour before the working day (or 7 in the morning without one),
  // or before the first thing, if earlier.
  const morning = work ? Math.max(0, Math.floor(mins(work.start) / 60) - 1) : 7;
  const open = Math.max(0, Math.min(morning, Number.isFinite(earliest) ? Math.floor(earliest / 60) - 1 : morning));
  useLayoutEffect(() => {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    if (scroller.current) scroller.current.scrollTop = open * HOUR * rem;
  }, [open, days.length]);
  const anyAllDay = columns.some((c) => c.allDay.length);
  return (
    <div className="cal-time" role="group" aria-label={name} style={{ "--hour": `${HOUR}rem`, "--days": days.length, "--zones": others.length + 1 } as React.CSSProperties}>
      <div className="cal-time-scroll" ref={scroller}>
        {/* The days' and zones' names, and what has no time, held at the top as
            the hours scroll: inside the scrolling, so they line up with its columns. */}
        <div className="cal-time-top">
          {days.length > 1 || others.length ? (
            <div className="cal-time-head" aria-hidden="true">{zoneHeads}{columns.map((c) => (
              <div key={c.key} className={`cal-time-day${c.key === today ? " today" : ""}`}>
                {days.length > 1 ? <><span className="cal-week-dow">{c.d.toLocaleDateString(LOC(), { weekday: "short" })}</span><span className="cal-date">{c.d.getDate()}</span></> : null}
              </div>
            ))}</div>
          ) : null}
          {/* What has no time, on its day; a screen reader hears it in its day's column. */}
          {anyAllDay ? (
            <div className="cal-time-allday" aria-hidden="true"><span className="cal-hour cal-allday-label">All day</span>
              {columns.map((c) => <div key={c.key} className="cal-allday-items">{c.allDay.map((e, i) => block(e, undefined, i))}</div>)}</div>
          ) : null}
        </div>
        <div className="cal-time-body">
          {others.map((z) => gutter(z))}{gutter(null)}
          {columns.map((c) => (
            <section key={c.key} className={`cal-col${c.key === today ? " today" : ""}`} aria-label={dayName(c.d)}>
              {shade(c.d)}
              {c.allDay.length ? <ul className="al-visually-hidden">{c.allDay.map((e, i) => <li key={i}>{block(e)}</li>)}</ul> : null}
              {c.placed.map((p, i) => block(p.e, { top: `calc(${p.start / 60} * var(--hour))`, height: "var(--hour)", insetInlineStart: `${(p.col / p.cols!) * 100}%`, width: `${100 / p.cols!}%` }, i))}
              {c.key === today ? <div className="cal-now" style={{ top: `calc(${(now.getHours() * 60 + now.getMinutes()) / 60} * var(--hour))` }} aria-hidden="true" /> : null}
            </section>
          ))}
        </div>
      </div>
      {events.length ? null : <p className="muted small cal-day-none">{`Nothing matches these filters this ${name.toLowerCase()}.`}</p>}
    </div>
  );
}

function Agenda({ events }: { events: Row[] }) {
  if (!events.length) return <EmptyState title="Nothing this month" text="Nothing matches these filters: try another month, or other filters." />;
  const kindLabel = (k: string) => ({ step: "Interview", next: "Next action", closes: "Deadline", applied: "Applied", posted: "Posted" } as Record<string, string>)[k] || k;
  const badge = (e: Row) => {
    const outcome = stepOutcome(e);
    if (!outcome) return null;
    const tone = ({ passed: "success", completed: "success", failed: "danger" } as Record<string, string>)[e.detail];
    return <span className={`al-badge${tone ? ` al-badge--${tone}` : ""}`}>{outcome}</span>;
  };
  const groups: [string, Row[]][] = [];
  for (const e of events) {
    const d = e.at.slice(0, 10);
    if (!groups.length || groups[groups.length - 1][0] !== d) groups.push([d, []]);
    groups[groups.length - 1][1].push(e);
  }
  return (
    <ol className="agenda">
      {groups.map(([d, items]) => (
        <li key={d} className="agenda-day">
          <h3><time dateTime={d}>{parseLocal(d).toLocaleDateString(LOC(), { weekday: "long", day: "numeric", month: "long" })}</time>
            {daysFromToday(parseLocal(d)) === 0 ? <span className="al-badge al-badge--accent">Today</span> : null}</h3>
          <ul className="agenda-items">
            {items.map((e, i) => {
              const { time, late } = eventLabel(e);
              return (
                <li key={i} className={eventClass(e, late)}>
                  <span className="agenda-time">{time || "All day"}</span>
                  <span className="agenda-kind">{kindLabel(e.kind)}</span>
                  <a className="agenda-what" href={eventHref(e)}><b>{e.title}</b>{badge(e)}</a>
                  <span className="agenda-who"><Logo id={e.company_id} logo={e.company_logo} name={e.company} size={20} />{e.company}{e.role ? <span className="muted">{` — ${e.role}`}</span> : null}
                    {e.stage ? <span className="muted small">{` · ${e.status === "archived" ? "closed at " : ""}${e.stage}`}</span> : null}</span>
                  {late ? <span className="due late">overdue</span> : null}
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}
