// Applications (/): the cycle's processes as cards, in a column per
// stage, in swimlanes; filtered, folded, dragged from stage to stage, and
// selected to act on together. Its other view is the table (Table.tsx).

import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { attempt, post } from "../lib/api";
import {
  BOARD_SEL, boardStages, boardSwimlanes, cardDetail, cardsCount, hiddenStages, isTerminal, loadBoard, nextOf,
  packOpen, setBoardRedraw, setPacksOpen, setStageHidden, showBoard, stageFolded, swimlaneChoices, swimlaneOpen, type Next,
} from "../lib/board";
import { boardCycle, cycleById, cycleWeek, cycleWeeks, currentCycle, endedCycles, pickCycle, runningCycles, viewedCycle } from "../lib/cycles";
import { activeFilters, matchesFilters, readFilters, restoreFilters, rowFromCard, type FilterRow, type Filters } from "../lib/filters";
import { fmtDay, longDate, nf } from "../lib/format";
import { closedWhy, fieldOf, optionLabel } from "../lib/meta";
import { go } from "../lib/router";
import { S } from "../lib/state";
import { store, stored } from "../lib/storage";
import { tagNames } from "../lib/tags";
import { toast } from "../lib/toast";
import type { Board, Card, Stage } from "../lib/types";
import { BulkBar, ProcessActions, bulkProcesses } from "../components/bulk";
import { endCycle, resumeCycle, startCycle } from "../components/cycleDialogs";
import { FilterBar } from "../components/FilterBar";
import { newApplication } from "../components/NewApplication";
import { TagChip } from "../components/tags";
import { Icon, Input, LoadingPage, Logo, Notice, Table, dotted } from "../components/ui";
import { celebrating, Celebration } from "./Celebrate";

/** What's next, to show: its title as written, then when, in the page's language. */
export const NextLabel = ({ n }: { n: Next }) => <><span translate="no">{n.title}</span>{n.when ? <>{", "}<span>{n.when}</span></> : null}</>;

/** The home page: an offer accepted is celebrated; else the board, as it was last seen (board or table, with the filters last used). */
export function Home() {
  const [offer, setOffer] = useState<Card | null | undefined>(undefined);
  useEffect(() => {
    celebrating().then((o) => {
      if (o) { setOffer(o); return; }
      if (stored("boardMode") === "table") { go(`/applications${location.search}`, { replace: true }); return; }
      restoreFilters();
      setOffer(null);
    }).catch((e) => toast(e.message, "error"));
  }, []);
  if (offer === undefined) return null;
  if (offer) return <Celebration offer={offer} />;
  return <BoardPage />;
}

/** Board or Table: the switch at the top of both views. */
export function ViewSwitch({ current }: { current: string }) {
  const choice = (value: string, label: string, path: string) => (
    <button type="button" aria-pressed={String(current === value) as "true" | "false"}
      // Filters come along.
      onClick={() => { if (current !== value) { store("boardMode", value); go(path + location.search); } }}>{label}</button>
  );
  return (
    <div className="al-segmented view-switch" role="group" aria-label="View">
      {choice("board", "Board", "/")}{choice("table", "Table", "/applications")}
    </div>
  );
}

/** The board's head: its name, what it shows, and what to do. */
export function BoardHead({ b, current }: { b: Board; current: string }) {
  const cur = currentCycle();
  const run = runningCycles();
  const total = b.stages.reduce((n, s) => n + s.cards.length, 0);
  const sub = b.read_only
    ? `${total} on the board · ${b.archived_total} closed`
    : cur ? `${cur.name} · week ${cycleWeek(cur)} · ${total} active · ${b.archived_total} closed`
      : run.length > 1 ? `${run.length} cycles · ${total} active · ${b.archived_total} closed` : "";
  return (
    <header className="al-page-head board-head">
      <h1>Applications</h1>
      {sub ? <p className="board-count">{sub}</p> : null}
      <div className="al-page-head__end">
        {cur && !b.read_only ? <button className="al-button al-button--quiet" type="button" onClick={() => endCycle(cur)}><Icon name="flag" /><span>End this cycle…</span></button> : null}
        {run.length || b.read_only ? <ViewSwitch current={current} /> : null}
        {run.length && !b.read_only ? (
          <button className="al-button al-button--primary" type="button" onClick={() => newApplication()} aria-keyshortcuts="n">
            <Icon name="plus" /><span>Add application</span><kbd className="al-kbd board-kbd" aria-hidden="true">N</kbd>
          </button>
        ) : null}
      </div>
    </header>
  );
}

/** Above the board: an ended cycle's notice, or none running; and which running cycle to show. */
export function BoardContext() {
  const viewing = viewedCycle();
  const run = runningCycles();
  if (viewing) {
    const back = cycleById(boardCycle());
    return (
      <Notice kind="info" className="board-viewing">
        <div className="al-notice__title">{`${viewing.name}, ended ${longDate(viewing.ended_on)}`}</div>
        <div className="small">Read-only, exactly as it was when it ended.{viewing.outcome_note ? <>{" "}<span translate="no">{viewing.outcome_note}</span>.</> : null}</div>
        <div className="al-notice__actions">
          <a className="al-button al-button--sm" href="/">{back ? `Back to ${back.name}` : run.length ? "Back to the board" : "Back to Cycles"}</a>
          <button className="al-button al-button--quiet al-button--sm" type="button" onClick={() => resumeCycle(viewing)}>Resume this cycle</button>
          <a className="al-button al-button--quiet al-button--sm" href="/cycles">All cycles</a>
        </div>
      </Notice>
    );
  }
  if (run.length > 1) {
    const chosen = boardCycle();
    return (
      <div className="board-cycles">
        <span className="al-label">Cycle</span>
        <div className="al-segmented" role="group" aria-label="Cycle">
          {[{ id: "", name: "All active" }, ...run].map((c) => (
            <button key={c.id} type="button" aria-pressed={String(String(c.id) === chosen) as "true" | "false"} onClick={() => pickCycle(c.id)}>
              <span translate={c.id ? "no" : undefined}>{c.name}</span>
              {c.id ? <span className="al-badge al-badge--accent">Active</span> : null}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return null;
}

/**
 * No cycle running: a welcome, and starting the next one; past cycles in a
 * fold, a table of how each went.
 */
export function NoCycle() {
  const past = endedCycles();
  const outcomes = fieldOf("cycles", "outcome").options;
  const n = past.length;
  return (
    <div className="board-welcome">
      <div className="al-empty board-empty">
        <h1 className="al-empty__title">Welcome!</h1>
        <p className="al-empty__text">Let's explore greener pastures, and start a new cycle!</p>
        <button className="al-button al-button--primary" type="button" onClick={() => startCycle()}><Icon name="plus" /><span>Start a new cycle</span></button>
        <p className="muted small">{n === 0 ? "You've had no cycles before." : n === 1 ? "You've had 1 cycle before." : `You've had ${n} cycles before.`}</p>
      </div>
      {n ? (
        <details className="al-disclosure past-cycles">
          <summary><span>Past cycles</span><span className="al-badge al-badge--count al-badge--outline">{n}</span></summary>
          <div className="al-disclosure__body">
            <div className="al-table-wrap">
              <Table className="al-table--interactive">
                <thead><tr>
                  <th>Cycle</th><th>Ran</th><th className="al-table__num">Weeks</th><th>How it ended</th>
                  <th className="al-table__num">Applied</th><th className="al-table__num">Interviewed</th><th className="al-table__num">Offers</th>
                  <th><span className="al-visually-hidden">Actions</span></th>
                </tr></thead>
                <tbody>
                  {past.map((c) => {
                    const href = `/?cycle=${c.id}`;
                    return (
                      <tr key={c.id} tabIndex={0} onClick={(e) => { if (!(e.target as Element).closest("a")) go(href); }} onKeyDown={(e) => { if (e.key === "Enter") go(href); }}>
                        <td><a href={href} translate="no">{c.name}</a>{c.outcome_note ? <div className="muted small" translate="no">{c.outcome_note}</div> : null}</td>
                        <td className="nowrap">{`${longDate(c.started_on)} – ${longDate(c.ended_on)}`}</td>
                        <td className="al-table__num">{nf(cycleWeeks(c))}</td>
                        <td><span className={`al-badge ${c.outcome === "offer" ? "al-badge--success" : "al-badge--outline"}`}>{optionLabel(outcomes, c.outcome || "other")}</span></td>
                        <td className="al-table__num">{nf(c.counts.applied)}</td>
                        <td className="al-table__num">{nf(c.counts.interviewed)}</td>
                        <td className="al-table__num">{nf(c.counts.offers)}</td>
                        <td><button className="al-button al-button--quiet al-button--sm" type="button" onClick={(e) => { e.stopPropagation(); resumeCycle(c); }} onKeyDown={(e) => e.stopPropagation()}>Resume</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
            <a className="al-link al-link--arrow" href="/cycles">All about your cycles</a>
          </div>
        </details>
      ) : null}
    </div>
  );
}

// ---- the board -------------------------------------------------------------------------

interface Drag { card: Card }
interface Over { list: string; before: number | null }

/** What every part of the board needs: the board, the filters' verdicts, dragging, and drawing again. */
interface Ctx {
  b: Board;
  ro: boolean;
  detailed: boolean;
  shown: (c: Card) => boolean;
  filtering: boolean;
  drag: Drag | null;
  setDrag: (d: Drag | null) => void;
  over: Over | null;
  setOver: (o: Over | null) => void;
  redraw: () => void;
  toggleCard: (id: number) => void;
}

export function BoardPage() {
  const [b, setB] = useState<Board | null>(null);
  const [f, setF] = useState<Filters>(readFilters());
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<Over | null>(null);
  const [, bump] = useState(0);
  const redraw = () => bump((n) => n + 1);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const y = window.scrollY;
      const fresh = await loadBoard();
      if (!alive) return;
      setB({ ...fresh });
      requestAnimationFrame(() => window.scrollTo(0, y));
    };
    setBoardRedraw(load);
    load().catch((e) => toast(e.message, "error"));
    // Escape lets go of the board's selection (when nothing else wants it).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !BOARD_SEL.size || document.querySelector("dialog[open]")) return;
      BOARD_SEL.clear();
      redraw();
    };
    document.addEventListener("keydown", onKey);
    return () => { alive = false; setBoardRedraw(null); document.removeEventListener("keydown", onKey); };
  }, []);
  if (!b) return <LoadingPage kind="board" />;
  if (!runningCycles().length && !b.read_only) return <div className="board"><NoCycle /></div>;
  const detail = cardDetail();
  // Filters hide cards (in place, so dragging still lands where it should).
  const all = [...b.stages.flatMap((st) => st.cards), ...b.archived];
  const rows = new Map<number, FilterRow>(all.map((c) => [c.id, rowFromCard(c)]));
  const shown = (c: Card) => { const r = rows.get(c.id); return !r || matchesFilters(r, f); };
  const visible = boardStages(b).flatMap((st) => st.cards).filter(shown).length;
  // Selected cards stay to those on the board.
  const known = new Set(all.map((c) => c.id));
  for (const id of [...BOARD_SEL]) if (!known.has(id)) BOARD_SEL.delete(id);
  const toggleCard = (id: number) => { if (BOARD_SEL.has(id)) BOARD_SEL.delete(id); else BOARD_SEL.add(id); redraw(); };
  const ctx: Ctx = { b, ro: !!b.read_only, detailed: detail === "detailed", shown, filtering: !!activeFilters(f), drag, setDrag, over, setOver, redraw, toggleCard };
  // How many columns fit across the page: 4, or 3 when no swimlane has more
  // than 2, or 5 when one has more than 5.
  const lanes = boardSwimlanes(b);
  const most = Math.max(0, ...lanes.map((g) => g.stages.length));
  const across = most < 3 ? 3 : most > 5 ? 5 : 4;
  const detailed = (
    <label className="switch al-choice" title="Show everything on each card">
      <Input type="checkbox" role="switch" checked={detail === "detailed"}
        onChange={(e) => { store("cardView", e.target.checked ? "detailed" : "compact"); showBoard(); }} />
      Detailed
    </label>
  );
  return (
    <div className={`board ${detail}${b.read_only ? " read-only" : ""}`} style={{ "--board-columns": across } as React.CSSProperties}>
      <BoardHead b={b} current="board" />
      <BoardContext />
      <GettingStarted b={b} />
      <FilterBar rows={[...rows.values()]} initial={f} onChange={setF} shown={visible} total={boardStages(b).flatMap((st) => st.cards).length} extra={detailed} />
      <HiddenStagesBar b={b} />
      {lanes.map((g) => <Swimlane key={String(g.lane.id ?? 0)} g={g} ctx={ctx} />)}
      {b.read_only ? null : (
        // Selected cards (Ctrl/⌘-click): what to do with them, after them.
        <BulkBar count={BOARD_SEL.size} clear={() => { BOARD_SEL.clear(); redraw(); }}
          actions={<ProcessActions ids={() => [...BOARD_SEL]} stages={b.stages} after={() => { BOARD_SEL.clear(); showBoard(); }} />} />
      )}
    </div>
  );
}

/**
 * A new board's first steps, above it: adding applications, and making hunt
 * fit (the board's stages, working hours, the calendar in a calendar app,
 * LinkedIn in one click). Each says whether it's done, where hunt can tell.
 * Until there are a few applications, or it's hidden.
 */
function GettingStarted({ b }: { b: Board }) {
  const apps = new Set([...b.stages.flatMap((st) => st.cards), ...b.archived].map((c) => c.application_id)).size;
  if (b.read_only || apps >= 3 || stored("gettingStarted") === "hidden") return null;
  const done = <span className="al-badge al-badge--success">Done</span>;
  const optional = <span className="al-badge al-badge--outline">Optional</span>;
  const task = (name: ReactNode, hint: string, status: ReactNode) => (
    <li className="al-task-list__item"><span className="al-task-list__name">{name}</span><span className="al-task-list__hint">{hint}</span><span className="al-task-list__status">{status}</span></li>
  );
  return (
    <section className="al-panel getting-started" aria-labelledby="getting-started">
      <div className="panel-head">
        <h2 id="getting-started">Getting started</h2>
        <button className="al-button al-button--sm al-button--quiet" type="button" onClick={() => { store("gettingStarted", "hidden"); showBoard(); }}>Hide this</button>
      </div>
      <ol className="al-task-list">
        {task(<a href="/cycles">Start a cycle</a>, "A job search, from its first application to its end.", done)}
        {task(<button type="button" onClick={() => newApplication()}>Add your first application</button>,
          "From a posting's link, which hunt reads, or by hand.", apps ? done : <span className="al-badge al-badge--accent">Next</span>)}
        {task(<a href="/settings?tab=board">Make the board yours</a>, "Its stages, and the swimlanes that group them.", optional)}
        {task(<a href="/settings?tab=calendar">Put interviews in your calendar</a>, "Your working hours, and a link your calendar app can follow.", S.PREFS.calendar_feed ? done : optional)}
        {task(<a href="/settings?tab=connections">Add people from LinkedIn in one click</a>, "A bookmark that sends a profile to hunt.", optional)}
      </ol>
    </section>
  );
}

/** The stages hidden from the board, to show again: above its columns. */
function HiddenStagesBar({ b }: { b: Board }) {
  const hidden = hiddenStages();
  const gone = boardStages(b).filter((st) => hidden.has(st.id));
  return (
    <div className="hidden-columns" hidden={!gone.length}>
      <span className="muted small">Hidden:</span>
      {gone.map((st) => (
        <button key={st.id} className="chip-button" type="button" title={`Show ${st.name}`} onClick={() => setStageHidden(st.id, false)}>
          <Icon name="eye" />{st.name}<span className="muted">{` ${st.cards.length}`}</span>
        </button>
      ))}
      {gone.length > 1 ? <button className="al-button al-button--sm al-button--quiet" type="button" onClick={() => { store("hiddenStages", "[]"); showBoard(); }}>Show all</button> : null}
    </div>
  );
}

/** A swimlane: a row of the board, its stages' columns, folded until opened or not. */
function Swimlane({ g, ctx }: { g: ReturnType<typeof boardSwimlanes>[number]; ctx: Ctx }) {
  const columns = useRef<HTMLDivElement>(null);
  const count = g.stages.reduce((n, st) => n + st.cards.length, 0);
  const shownCount = g.stages.reduce((n, st) => n + st.cards.filter(ctx.shown).length, 0);
  const key = String(g.lane.id ?? 0);
  const title = `swimlane-${key}`;
  return (
    <details className="al-disclosure zone swimlane" open={swimlaneOpen(key, g.lane)} aria-labelledby={title} data-swimlane={key}
      onToggle={(e) => {
        const c = swimlaneChoices();
        c[key] = { open: (e.currentTarget as HTMLDetailsElement).open, was: !!g.lane.folded };
        store("swimlanes", JSON.stringify(c));
      }}>
      <summary>
        <h2 id={title}>{g.lane.name}</h2>
        <span className="al-badge al-badge--outline al-badge--count swimlane-count" data-total={count}>{ctx.filtering ? shownCount : count}</span>
      </summary>
      <div className="al-disclosure__body">
        <StagePager stages={g.stages} columns={columns} />
        <div className="columns" ref={columns} style={{ "--columns": g.stages.length } as React.CSSProperties}>
          {g.stages.map((st, i) => <Column key={st.id} stage={st} number={i + 1} ctx={ctx} />)}
        </div>
      </div>
    </details>
  );
}

/**
 * On a phone, where a column is the screen's width: the stages as tabs above
 * them, the one in view marked, each going to its column.
 */
function StagePager({ stages, columns }: { stages: Stage[]; columns: React.RefObject<HTMLDivElement | null> }) {
  const hidden = hiddenStages();
  const shown = stages.filter((st) => !hidden.has(st.id));
  const pager = useRef<HTMLElement>(null);
  const [at, setAt] = useState<string | null>(null);
  useLayoutEffect(() => {
    const cols = columns.current;
    if (!cols) return;
    // The column nearest the middle is the one in view.
    const mark = () => {
      const box = cols.getBoundingClientRect();
      const mid = box.left + box.width / 2;
      let here: string | null = null, best = Infinity;
      for (const col of cols.querySelectorAll<HTMLElement>(".column:not([hidden])")) {
        const r = col.getBoundingClientRect();
        const d = Math.abs(r.left + r.width / 2 - mid);
        if (d < best) { best = d; here = col.dataset.stage || null; }
      }
      // As tall as that column, not the tallest (only where the tabs show).
      const col = cols.querySelector<HTMLElement>(`.column[data-stage="${here}"]`);
      cols.style.blockSize = pager.current?.offsetParent && col ? `${col.offsetHeight + 8}px` : "";
      setAt(here);
    };
    let frame = 0;
    const onScroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(mark); };
    cols.addEventListener("scroll", onScroll, { passive: true });
    frame = requestAnimationFrame(mark);
    return () => { cols.removeEventListener("scroll", onScroll); cancelAnimationFrame(frame); };
  }, [columns]);
  useEffect(() => {
    pager.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [at]);
  return (
    <nav className="stage-pager" aria-label="Stages" ref={pager}>
      {shown.map((st) => (
        <button key={st.id} type="button" data-stage={st.id} aria-current={String(String(st.id) === at) as "true" | "false"}
          onClick={() => columns.current?.querySelector(`.column[data-stage="${st.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" })}>
          <span>{st.name}</span><span className="stage-pager-count" aria-label={`${st.cards.length} active`}>{st.cards.length}</span>
        </button>
      ))}
    </nav>
  );
}

/** A button folding the packs `keys` (`folded` saying how they start), or unfolding them. */
function FoldButton({ keys, folded, what, ctx }: { keys: string[]; folded: (k: string) => boolean; what: string; ctx: Ctx }) {
  const open = keys.some((k) => packOpen(k, folded));
  const label = `${open ? "Fold" : "Unfold"} ${what}`;
  return (
    <button className="al-button al-button--icon al-button--sm al-button--quiet pack-fold" type="button" title={label} aria-label={label}
      aria-expanded={String(open) as "true" | "false"} data-fold={keys.join(" ")}
      onClick={() => { setPacksOpen(keys, folded, !open); ctx.redraw(); }}><Icon name="chevron" /></button>
  );
}

function Column({ stage, number, ctx }: { stage: Stage; number: number; ctx: Ctx }) {
  const lanes = stage.lanes || [];
  const { ro } = ctx;
  // Cards in no lane: the column's top (all of it, when it isn't divided).
  const loose = stage.cards.filter((c) => c.lane_id == null || !lanes.some((l) => l.id === c.lane_id));
  const top = `${stage.id}:`;
  const keys = [top, ...lanes.map((l) => `${stage.id}:${l.id}`)];
  const folded = stageFolded(stage);
  const moveAll = (lane: number | null) => (ids: number[]) => bulkProcesses({ ids, action: "move", stage_id: stage.id, lane_id: lane }, () => BOARD_SEL.clear());
  // All of it folded: one pile, its sub stages in it; opened, its top
  // (and its sub stages, folded as they are).
  const whole = !keys.some((k) => packOpen(k, folded));
  const terminal = isTerminal(stage);
  const visible = stage.cards.filter(ctx.shown).length;
  return (
    <section className={["column", lanes.length && !whole ? "has-lanes" : "", terminal ? "terminal" : ""].filter(Boolean).join(" ")}
      data-stage={stage.id} aria-labelledby={`col-${stage.id}`} hidden={hiddenStages().has(stage.id)}>
      <header>
        <span className="stage-no" aria-hidden="true">{number}</span>
        <h2 id={`col-${stage.id}`}>{stage.name}</h2>
        <span className="al-badge al-badge--count count" title={`${stage.cards.length} ${terminal ? "closed" : "active"}`}>{visible}</span>
        <button className="col-hide" type="button" title={`Hide ${stage.name}`} aria-label={`Hide the ${stage.name} column`} onClick={() => setStageHidden(stage.id, true)}><Icon name="eye-off" /></button>
        <FoldButton keys={keys} folded={folded} what={`everything in ${stage.name}`} ctx={ctx} />
      </header>
      {whole
        ? <CardList listKey={top} cards={stage.cards} label={`${stage.name} cards`} pack={{ key: top, folded, what: stage.name }} ctx={ctx}
          drop={ro ? null : { one: (id) => post(`processes/${id}/move`, { stage_id: stage.id }), many: moveAll(null) }} />
        : <>
          <CardList listKey={top} cards={loose} label={`${stage.name} cards`} pack={{ key: top, folded, what: stage.name, quiet: lanes.length > 0 }} ctx={ctx}
            className={lanes.length && !loose.length ? "unlaned empty" : lanes.length ? "unlaned" : ""}
            drop={ro ? null : { one: (id, index) => post(`processes/${id}/move`, { stage_id: stage.id, index, top: true }), many: moveAll(null) }} />
          {/* Its lanes, top to bottom, each a place to drop cards. */}
          {lanes.map((l) => {
            const cards = stage.cards.filter((c) => c.lane_id === l.id);
            const key = `${stage.id}:${l.id}`;
            return (
              <section key={l.id} className="lane" data-lane={l.id}>
                <header>
                  <h3>{l.name}</h3>
                  {l.is_default ? <span className="lane-default" title={`Where a card going into ${stage.name} goes`}>default</span> : null}
                  <span className="lane-count">{cards.filter(ctx.shown).length}</span>
                  {ro ? null : <FoldButton keys={[key]} folded={folded} what={l.name} ctx={ctx} />}
                </header>
                <CardList listKey={key} cards={cards} label={`${stage.name}: ${l.name} cards`} pack={{ key, folded, what: l.name }} ctx={ctx}
                  drop={ro ? null : { one: (id, index) => post(`processes/${id}/move`, { stage_id: stage.id, lane_id: l.id, index }), many: moveAll(l.id) }} />
              </section>
            );
          })}
        </>}
      {ro ? null : (
        <footer>
          <button className="al-button al-button--quiet al-button--sm add-card" type="button" onClick={() => newApplication({ stageId: stage.id })}>
            <Icon name="plus" /><span>{`Add to ${stage.name}`}</span>
          </button>
        </footer>
      )}
    </section>
  );
}

/**
 * A list of cards, as a pack (folded: its cards a blank pile saying how
 * many, or that it's empty; `quiet`: an empty one says nothing, a column's
 * top above its sub stages), and a place cards are dropped: `drop.one(id,
 * index)` moves one, `drop.many(ids)` the selected ones together.
 */
function CardList({ listKey, cards, label, pack, drop, className = "", ctx }: {
  listKey: string; cards: Card[]; label: string; className?: string; ctx: Ctx;
  pack: { key: string; folded: (k: string) => boolean; what: string; quiet?: boolean };
  drop: { one: (id: number, index: number) => Promise<unknown>; many: (ids: number[]) => Promise<unknown> } | null;
}) {
  const list = useRef<HTMLOListElement>(null);
  const packed = !packOpen(pack.key, pack.folded);
  const n = cards.length;
  const visible = cards.filter(ctx.shown).length;
  const over = ctx.over?.list === listKey ? ctx.over : null;
  const placeholder = <li key="placeholder" className="placeholder" aria-hidden="true" />;
  const items: ReactNode[] = [];
  for (const c of cards) {
    if (over && over.before === c.id) items.push(placeholder);
    items.push(<CardView key={c.id} c={c} ctx={ctx} />);
  }
  if (over && over.before == null) items.push(placeholder);
  const handlers = drop ? {
    onDragOver: (e: DragEvent<HTMLOListElement>) => {
      if (!ctx.drag) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const before = [...list.current!.querySelectorAll<HTMLElement>(".card:not(.dragging)")].find((card) => {
        const r = card.getBoundingClientRect();
        return e.clientY < r.top + r.height / 2;
      });
      const at = before ? Number(before.dataset.id) : null;
      if (ctx.over?.list !== listKey || ctx.over.before !== at) ctx.setOver({ list: listKey, before: at });
    },
    onDragLeave: (e: DragEvent<HTMLOListElement>) => {
      if (list.current?.contains(e.relatedTarget as Node)) return;
      if (ctx.over?.list === listKey) ctx.setOver(null);
    },
    onDrop: async (e: DragEvent<HTMLOListElement>) => {
      e.preventDefault();
      if (!ctx.drag) return;
      const { card } = ctx.drag;
      // Where the placeholder sits among the cards, not counting the one being dragged.
      const rest = cards.filter((c) => c.id !== card.id);
      const at = over?.before == null ? rest.length : rest.findIndex((c) => c.id === over.before);
      const together = BOARD_SEL.has(card.id) && BOARD_SEL.size > 1;
      ctx.setOver(null);
      ctx.setDrag(null);
      await attempt(() => (together ? drop.many([...BOARD_SEL]) : drop.one(card.id, Math.max(0, at))));
      await showBoard();
    },
  } : {};
  return (
    <ol ref={list} className={["cards", className, packed ? "packed" : "", over ? "over" : ""].filter(Boolean).join(" ")} aria-label={label} {...handlers}>
      {packed && (n || !pack.quiet) ? (
        n
          ? <li className={["pile-face", n > 1 ? "several" : "", n > 2 ? "deep" : ""].filter(Boolean).join(" ")} data-total={n}>
            <button type="button" aria-label={`Unfold ${pack.what}: ${cardsCount(n)}`} onClick={() => { setPacksOpen([pack.key], pack.folded, true); ctx.redraw(); }}>
              {/* A pile says how many of its cards the filters leave. */}
              <span className="pile-count">{ctx.filtering && !visible ? "None shown" : cardsCount(ctx.filtering ? visible : n)}</span>
            </button>
          </li>
          : <li className="pile-face empty" data-total={0}><span>Empty</span></li>
      ) : null}
      {items}
    </ol>
  );
}

/** How many of a card's tags it shows; the rest are a count. */
const TAGS_SHOWN = 3;

function CardView({ c, ctx }: { c: Card; ctx: Ctx }) {
  const { ro } = ctx;
  const tags = tagNames(c.tags);
  const next = c.status === "active" ? nextOf(c) : null;
  const mode = c.work_mode && optionLabel(fieldOf("applications", "work_mode").options, c.work_mode);
  const meta = [mode, c.source && <span translate="no">{c.source}</span>,
    c.people ? `${c.people} ${c.people === 1 ? "person" : "people"}` : null,
    c.files ? `${c.files} ${c.files === 1 ? "file" : "files"}` : null,
    c.emails ? `${c.emails} ${c.emails === 1 ? "email" : "emails"}` : null].filter(Boolean);
  const selected = BOARD_SEL.has(c.id);
  const dragging = ctx.drag?.card.id === c.id;
  const open = (e?: React.MouseEvent) => {
    if (ro) { toast(`${c.company}: read-only in a past cycle`); return; }
    // Ctrl/⌘-click, or x, selects it (with others, to act on together).
    if (e?.metaKey || e?.ctrlKey) { e.preventDefault(); ctx.toggleCard(c.id); } else go(`/applications/${c.application_id}?process=${c.id}`);
  };
  return (
    <li className={["card al-card al-card--interactive", c.status, selected ? "selected" : "", dragging ? "dragging" : ""].filter(Boolean).join(" ")}
      data-id={c.id} data-tags={tags.join("|").toLowerCase()} draggable={ro ? undefined : "true"} tabIndex={0}
      aria-label={`${c.company}${c.title ? `, ${c.title}` : ""}`} aria-selected={selected ? "true" : undefined} hidden={!ctx.shown(c)}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
        else if (e.key === "x" && !ro) { e.preventDefault(); ctx.toggleCard(c.id); }
      }}
      onDragStart={ro ? undefined : (e) => {
        e.dataTransfer.setData("text/plain", String(c.id));
        e.dataTransfer.effectAllowed = "move";
        // Marked as dragging once the browser has its picture of it.
        requestAnimationFrame(() => ctx.setDrag({ card: c }));
      }}
      onDragEnd={ro ? undefined : () => { ctx.setDrag(null); ctx.setOver(null); }}>
      <div className="card-company"><Logo id={c.company_id} logo={c.company_logo} name={c.company} size={22} /><span className="card-company-name" translate="no">{c.company}</span></div>
      {c.title ? <div className="card-role" translate="no">{c.title}</div> : null}
      {next ? <div className={`card-next${next.overdue ? " overdue" : ""}`}><Icon name="clock" /><span><NextLabel n={next} /></span></div> : null}
      {/* A closed one: how far it got, why it closed, and when. */}
      {c.status === "archived" ? (
        <div className="card-closed">
          <span className="al-badge" title={c.archive_note || undefined}>{closedWhy(c)}</span>
          <span className="card-meta">{dotted([c.reached_stage ? `Got to ${c.reached_stage}` : null, fmtDay(c.updated_at.slice(0, 10))])}</span>
        </div>
      ) : null}
      {/* A few tags, and how many more (named on hovering it). */}
      {ctx.detailed && tags.length ? (
        <div className="card-tags">
          {tags.slice(0, TAGS_SHOWN).map((t) => <TagChip key={t} name={t} />)}
          {tags.length > TAGS_SHOWN ? <span className="tag-more" title={tags.slice(TAGS_SHOWN).join(", ")} translate="no">{`+${tags.length - TAGS_SHOWN}`}</span> : null}
        </div>
      ) : null}
      {ctx.detailed && meta.length ? <div className="card-meta">{dotted(meta)}</div> : null}
    </li>
  );
}
