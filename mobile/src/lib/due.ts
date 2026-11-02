// What's due: open reminders (the overdue too), interviews and
// applications closing, from the calendar, as the web's Coming up menu
// reads them; here for the week ahead, grouped by day.

import { get } from "@web/api";
import { daysFromToday, isOverdue, isoToday, parseLocal } from "@web/format";
import type { Row } from "@web/types";

/** What each kind of event is called. */
export const KIND: Record<string, string> = { next: "Next action", step: "Interview", closes: "Applications close" };

/** A day `n` days from today, as YYYY-MM-DD. */
function dayFrom(n: number) {
  const d = parseLocal(isoToday());
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface DueGroup { title: string; data: Row[] }

/** What's due, through the next `days` days: Overdue, Today, Tomorrow, Later this week. */
export async function loadDue(days = 7): Promise<DueGroup[]> {
  const today = isoToday();
  const events: Row[] = await get(`calendar?to=${dayFrom(days)}`);
  const due = events
    .filter((e) => e.kind === "next" || (String(e.at).slice(0, 10) >= today && (e.kind === "closes" || e.detail === "scheduled")))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const groups: DueGroup[] = [
    { title: "Overdue", data: [] },
    { title: "Today", data: [] },
    { title: "Tomorrow", data: [] },
    { title: "Later this week", data: [] },
  ];
  for (const e of due) {
    if (e.kind === "next" && isOverdue(e.at)) { groups[0].data.push(e); continue; }
    if (!e.at) { groups[3].data.push(e); continue; }
    const n = daysFromToday(parseLocal(String(e.at)));
    groups[n <= 0 ? 1 : n === 1 ? 2 : 3].data.push(e);
  }
  return groups.filter((g) => g.data.length);
}

/** Where an event leads: its application, at its process. */
export const eventHref = (e: Row) =>
  e.process_id ? `/application/${e.application_id}?process=${e.process_id}` : `/application/${e.application_id}`;
