// In the top bar: what's coming up, a click away from any page. Reminders
// that are due (or overdue), interviews, and applications closing, from
// today until tomorrow's end; how many, on the bell's corner in red, and a
// red dot on the tab's icon. From the calendar's events, read again on each
// page.

import { useEffect, useState } from "react";
import { get } from "../lib/api";
import { fmtDay, isOverdue, isoToday, parseLocal } from "../lib/format";
import { t } from "../lib/i18n";
import { go, useVisit } from "../lib/router";
import type { Row } from "../lib/types";
import { MenuButton, MenuItem } from "./Menu";
import { ICONS, Logo, PathIcon } from "./ui";

/** What each kind of event is called, beside its company. */
const KIND: Record<string, string> = { next: "Next action", step: "Interview", closes: "Applications close" };

/** Tomorrow, as YYYY-MM-DD. */
function tomorrow() {
  const d = parseLocal(isoToday());
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** What's due: every open reminder up to tomorrow (the overdue too), and interviews and closings from today. */
async function loadDue(): Promise<Row[]> {
  const today = isoToday();
  const events: Row[] = await get(`calendar?to=${tomorrow()}`);
  return events
    .filter((e) => e.kind === "next" || (String(e.at).slice(0, 10) >= today && (e.kind === "closes" || e.detail === "scheduled")))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/** The tab's icon as the page has it, and as it is with the dot, drawn once. */
let plainIcon: string | null = null;
let markedIcon: Promise<string> | null = null;
let marked = false;

/** The tab's icon with a red dot on its corner. */
function drawMarked(href: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = 64;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no canvas"));
      ctx.drawImage(img, 0, 0, size, size);
      const r = size * 0.22, cx = size - r - 1, cy = r + 1;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 4, 0, 2 * Math.PI);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.fillStyle = "#e5342b";
      ctx.fill();
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = reject;
    img.src = href;
  });
}

/** Marks the tab's icon while something's due, and takes the mark off when not. */
function markTab(on: boolean) {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  if (plainIcon === null) plainIcon = link.href;
  marked = on;
  if (!on) {
    link.type = "image/svg+xml";
    link.href = plainIcon;
    return;
  }
  markedIcon ??= drawMarked(plainIcon);
  markedIcon.then((href) => { if (!marked) return; link.type = "image/png"; link.href = href; }).catch(() => { markedIcon = null; });
}

export function DueMenu() {
  const visit = useVisit();
  const [due, setDue] = useState<Row[] | null>(null);
  useEffect(() => {
    let alive = true;
    loadDue().then((d) => { if (alive) setDue(d); }).catch(() => {});
    return () => { alive = false; };
  }, [visit]);
  const n = due?.length ?? 0;
  useEffect(() => { markTab(n > 0); }, [n]);
  useEffect(() => () => markTab(false), []);
  const label = n ? `Coming up: ${n}` : "Coming up";
  return (
    <MenuButton className="al-button al-button--icon al-button--quiet topbar-button" menuClassName="due-menu" label={label}
      items={(close) => <>
        <p className="al-menu__label">Today and tomorrow</p>
        {due && due.length ? due.map((e) => {
          const overdue = e.kind === "next" && isOverdue(e.at);
          const href = e.process_id ? `/applications/${e.application_id}?process=${e.process_id}` : `/applications/${e.application_id}`;
          return (
            <MenuItem key={`${e.kind}-${e.ref_id}`} close={close} onClick={() => go(href)} className={`due-item${overdue ? " is-late" : ""}`}
              hint={<><span translate="no">{e.company}</span>{` · ${t(KIND[e.kind] || "")} · `}<span className="due-when">{overdue ? `${fmtDay(e.at)}, overdue` : fmtDay(e.at)}</span></>}>
              <Logo id={e.company_id} logo={e.company_logo} name={e.company} size={18} />
              <span translate={e.kind === "closes" ? undefined : "no"}>{e.title}</span>
            </MenuItem>
          );
        }) : <p className="due-none">Nothing due today or tomorrow.</p>}
        <hr className="al-menu__separator" />
        <MenuItem close={close} onClick={() => go("/calendar?view=agenda")}>Open the calendar</MenuItem>
      </>}>
      <PathIcon d={ICONS.bell} className="al-icon" />
      {n ? <span className="topbar-count al-badge al-badge--count" aria-hidden="true">{n > 99 ? "99+" : n}</span> : null}
    </MenuButton>
  );
}
