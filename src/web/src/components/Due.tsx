// In the sidebar: what's coming up, a click away from any page. Reminders
// that are due (or overdue), interviews, and applications closing, from
// today until tomorrow's end; how many, on the button. From the calendar's
// events, read again on each page.

import { useEffect, useState } from "react";
import { get } from "../lib/api";
import { fmtDay, isOverdue, isoToday, parseLocal } from "../lib/format";
import { t } from "../lib/i18n";
import { go, useVisit } from "../lib/router";
import type { Row } from "../lib/types";
import { MenuButton, MenuItem } from "./Menu";
import { Logo, PathIcon } from "./ui";

const BELL = "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0";

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

export function DueMenu({ mini }: { mini: boolean }) {
  const visit = useVisit();
  const [due, setDue] = useState<Row[] | null>(null);
  useEffect(() => {
    let alive = true;
    loadDue().then((d) => { if (alive) setDue(d); }).catch(() => {});
    return () => { alive = false; };
  }, [visit]);
  const n = due?.length ?? 0;
  const late = due?.some((e) => e.kind === "next" && isOverdue(e.at));
  const label = n ? `Coming up: ${n}` : "Coming up";
  return (
    <MenuButton className="al-sidebar__link due-button" menuClassName="due-menu" label={label} title={mini ? t(label) : ""}
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
      <PathIcon d={BELL} className="al-icon" />
      <span className="al-sidebar__label">Coming up</span>
      {n ? <span className={`due-count al-badge al-badge--count${late ? " al-badge--warning" : " al-badge--accent"}`} aria-hidden="true">{n}</span> : null}
    </MenuButton>
  );
}
