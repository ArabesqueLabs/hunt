// The audit log (/activity): every change, newest first.

import { useEffect, useState } from "react";
import { get } from "../lib/api";
import { fmtStamp } from "../lib/format";
import { routeOf } from "../lib/lists";
import { R } from "../lib/meta";
import { S } from "../lib/state";
import { toast } from "../lib/toast";
import type { Row } from "../lib/types";
import { Select } from "../components/ui";

export function ActivityPage() {
  const [entity, setEntity] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    get(`activity?limit=300${entity ? `&entity=${entity}` : ""}`).then(setRows).catch((e) => toast(e.message, "error"));
  }, [entity]);
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
        <ol className="timeline full">
          {rows == null ? null : rows.length ? rows.map((a, i) => {
            const page = routeOf(R(a.entity)?.name);
            const link = a.process_id ? `/p/${a.process_id}` : page && a.action !== "deleted" ? `/${page}/${a.entity_id}` : null;
            return (
              <li key={a.id ?? i} className={a.action}><time dateTime={a.at}>{fmtStamp(a.at)}</time>
                {link ? <a href={link} translate="no">{a.summary}</a> : <span translate="no">{a.summary}</span>}</li>
            );
          }) : <li className="muted">No changes yet.</li>}
        </ol>
      </section>
    </div>
  );
}
