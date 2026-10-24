// The audit log (/activity): every change, newest first, by day; more on asking.

import { useEffect, useState } from "react";
import { get } from "../lib/api";
import { fmtDay, fmtTime } from "../lib/format";
import { routeOf } from "../lib/lists";
import { R } from "../lib/meta";
import { S } from "../lib/state";
import { toast } from "../lib/toast";
import type { Row } from "../lib/types";
import { BusyButton, Icon, LoadingBlock, Select } from "../components/ui";

/** How many changes a page of the log holds; Show more asks for as many again. */
const PAGE = 200;

/** Each kind of change: its icon, and what it's called (for a screen reader). */
const KINDS: Record<string, [string, string]> = {
  created: ["plus", "Added"],
  updated: ["edit", "Changed"],
  moved: ["forward", "Moved"],
  deleted: ["trash", "Deleted"],
};

export function ActivityPage() {
  const [entity, setEntity] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [rows, setRows] = useState<Row[] | null>(null);
  const load = (n: number) => get(`activity?limit=${n}${entity ? `&entity=${entity}` : ""}`).then(setRows).catch((e) => toast(e.message, "error"));
  useEffect(() => { setRows(null); setLimit(PAGE); load(PAGE); }, [entity]);
  // By day, as they happened: each day's changes under its date.
  const days: [string, Row[]][] = [];
  for (const a of rows || []) {
    const day = String(a.at).slice(0, 10);
    if (days.at(-1)?.[0] === day) days.at(-1)![1].push(a);
    else days.push([day, [a]]);
  }
  return (
    <div className="page">
      <div className="al-page-head page-head">
        <h1>Audit Log</h1>
        <Select aria-label="Show changes to" value={entity} onChange={(e) => setEntity(e.target.value)}>
          <option value="">Everything</option>
          {S.META.resources.map((r) => <option key={r.entity} value={r.entity}>{r.title}</option>)}
        </Select>
      </div>
      <section className="al-panel panel">
        {rows == null ? <LoadingBlock lines={10} />
          : !rows.length ? <p className="muted">No changes yet.</p>
            : days.map(([day, list]) => (
              <section key={day} className="log-day" aria-labelledby={`log-${day}`}>
                <h2 className="log-date" id={`log-${day}`}><time dateTime={day}>{fmtDay(day)}</time><span className="count">{list.length}</span></h2>
                <ol className="log">
                  {list.map((a, i) => {
                    const page = routeOf(R(a.entity)?.name);
                    const link = a.process_id ? `/p/${a.process_id}` : page && a.action !== "deleted" ? `/${page}/${a.entity_id}` : null;
                    const [icon, kind] = KINDS[a.action] || ["edit", "Changed"];
                    return (
                      <li key={a.id ?? i} className={`log-item ${a.action}`}>
                        <span className="log-icon" title={kind}><Icon name={icon} className={icon === "forward" ? "al-mirror" : undefined} /><span className="al-visually-hidden">{kind}</span></span>
                        {/* The log's sentences are written by the service, in English: kept as written. */}
                        {link ? <a href={link} translate="no">{a.summary}</a> : <span translate="no">{a.summary}</span>}
                        <time dateTime={a.at}>{fmtTime(String(a.at).slice(11, 16))}</time>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
        {rows && rows.length >= limit ? (
          <BusyButton className="al-button log-more" onClick={async () => { const n = limit + PAGE; setLimit(n); await load(n); }}>Show more</BusyButton>
        ) : null}
      </section>
    </div>
  );
}
