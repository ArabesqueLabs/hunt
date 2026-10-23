// The change log: a record's or process's, collapsed until asked for.

import { useEffect, useState } from "react";
import { get } from "../lib/api";
import { fmtStamp } from "../lib/format";
import type { Row } from "../lib/types";

export function Timeline({ rows }: { rows: Row[] }) {
  if (!rows.length) return <li className="muted">Nothing yet.</li>;
  // The log's sentences are written by the service, in English: kept as written.
  return <>{rows.map((a, i) => <li key={a.id ?? i} className={a.action}><time dateTime={a.at}>{fmtStamp(a.at)}</time><span translate="no">{a.summary}</span></li>)}</>;
}

/** A change log, collapsed until asked for: `rows`, or loaded from `url` (and again when `version` changes). */
export function ActivityPanel({ rows: given, url, version = 0 }: { rows?: Row[]; url?: string; version?: number }) {
  const [rows, setRows] = useState<Row[]>(given || []);
  useEffect(() => { if (given) setRows(given); }, [given]);
  useEffect(() => { if (url) get(url).then(setRows).catch(() => {}); }, [url, version]);
  return (
    <details className="al-disclosure activity">
      <summary><h2>Audit Log</h2><span className="count">{rows.length}</span></summary>
      <ol className="timeline"><Timeline rows={rows} /></ol>
    </details>
  );
}
