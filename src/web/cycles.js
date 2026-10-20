"use strict";

// Cycles: job searches. Several can run at once (by season, place or
// industry), and one that has ended keeps its board as it was. Here: the
// box under hunt's name that says which the board shows and switches
// between them, the Cycles page (/cycles), and starting and ending one.
// Built on app.js.

/** Every cycle, running ones first, with their counts (GET cycles/overview). */
let CYCLES = [];

const runningCycles = () => CYCLES.filter((c) => !c.ended_on);
const endedCycles = () => CYCLES.filter((c) => c.ended_on);
const cycleById = (id) => CYCLES.find((c) => String(c.id) === String(id));

/** A date as a cycle's are written: 18 Aug 2026. */
const longDate = (iso) => (iso ? parseLocal(iso).toLocaleDateString(LOC(), { day: "numeric", month: "short", year: "numeric" }) : "");

/** Which week of a cycle a day is in, counting its first as week 1. */
function cycleWeek(c, until = null) {
  const end = until ? parseLocal(until) : zonedNow();
  return Math.max(1, Math.floor((end - parseLocal(c.started_on)) / (7 * 864e5)) + 1);
}

/** How many weeks an ended cycle ran. */
const cycleWeeks = (c) => cycleWeek(c, c.ended_on);

async function loadCycles() {
  CYCLES = await get("cycles/overview");
  drawCycleBox();
  return CYCLES;
}

/**
 * The running cycle the board shows (its id, as text), or "" for all of
 * them: remembered in this browser. With one running, that one.
 */
function boardCycle() {
  const run = runningCycles();
  const v = stored("boardCycle");
  if (run.some((c) => String(c.id) === v)) return v;
  return run.length === 1 ? String(run[0].id) : "";
}

/** An ended cycle being looked at (?cycle= on the board), or null. */
function viewedCycle() {
  const id = new URLSearchParams(location.search).get("cycle");
  const c = id && cycleById(id);
  return c && c.ended_on ? c : null;
}

/** The cycle the board shows: one being looked at, the chosen one, or null for all running. */
function currentCycle() {
  return viewedCycle() || cycleById(boardCycle()) || null;
}

/** Show another running cycle ("" for all of them) where it matters, or its board. */
function pickCycle(id) {
  store("boardCycle", String(id));
  const page = location.pathname.split("/")[1] || "";
  if (["", "applications", "stats"].includes(page)) go(page ? `/${page}` : "/");
  else go("/");
}

const FLAG = "M4 22V4M4 4h12l-2 4 2 4H4";

/** A line icon from a path, in the system's icon size. */
function pathIcon(d, cls = "al-icon al-icon--sm") {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  for (const [k, v] of Object.entries({ class: cls, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    "stroke-width": 1.75, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(k, v);
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", d);
  svg.append(path);
  return svg;
}

/**
 * Under hunt's name: a box for each running cycle, saying how far along it
 * is; the ones the board shows are marked. Choosing one shows it alone;
 * choosing it again, every running one. An ended cycle being looked at has
 * a box too. Collapsed, each is its flag.
 */
function drawCycleBox() {
  const box = document.getElementById("cycle-box");
  if (!box) return;
  box.hidden = false;
  const run = runningCycles();
  const viewing = viewedCycle();
  const chosen = boardCycle();
  const page = location.pathname.split("/")[1] || "";
  const onBoard = ["", "applications", "stats"].includes(page);
  const card = (c, { current, meta, onclick, past = false }) => h("button.al-sidebar__link.cycle-card", {
    type: "button", "aria-current": current ? "true" : null, class: past ? "is-past" : "", title: `${c.name}: ${meta}`, onclick,
  },
  pathIcon(FLAG, "al-icon"),
  h("span.al-sidebar__label.cycle-what", {},
    h("span.cycle-name", {}, h("span.cycle-name-text", { translate: "no" }, c.name),
      past ? null : h("span.al-badge.al-badge--accent", {}, "Active")),
    h("span.cycle-meta", {}, meta)));
  const cards = run.map((c) => {
    const shown = !viewing && (chosen === "" || String(c.id) === chosen);
    return card(c, {
      current: shown && onBoard,
      meta: `Week ${cycleWeek(c)} · ${c.counts.active} active`,
      // This one alone; again, when it's the one shown, every running one.
      onclick: () => pickCycle(run.length > 1 && String(c.id) === chosen && onBoard ? "" : c.id),
    });
  });
  if (viewing) cards.push(card(viewing, { current: true, past: true, meta: `Ended ${longDate(viewing.ended_on)} · read-only`, onclick: () => go(`/?cycle=${viewing.id}`) }));
  if (!run.length && !viewing) {
    const last = endedCycles()[0];
    cards.push(h("a.al-sidebar__link.cycle-card.is-past", { href: "/cycles", title: "No active cycle" },
      pathIcon(FLAG, "al-icon"),
      h("span.al-sidebar__label.cycle-what", {}, h("span.cycle-name", {}, "No active cycle"),
        h("span.cycle-meta", {}, last ? `Last: ${last.name}` : "Start one"))));
  }
  fill(box, h("div.cycle-cards", { role: "group", "aria-label": "Cycles" }, cards));
}

// ---- the Cycles page ---------------------------------------------------------------------

async function showCycles() {
  await loadCycles();
  let editing = null; // a cycle's id
  const page = h("div.page.cycles-page");
  view.replaceChildren(page);

  function editor(c) {
    const vals = { name: c.name, description: c.description || "", started_on: c.started_on, ended_on: c.ended_on };
    const problem = h("p.al-error", { id: `cycle-${c.id}-err`, hidden: true });
    const save = h("button.al-button.al-button--primary.al-button--sm", { type: "submit" }, "Save");
    const check = () => {
      const bad = c.ended_on && vals.started_on && vals.ended_on && vals.ended_on < vals.started_on;
      fill(problem, bad ? "It ends before it starts. Pick a later end date, or an earlier start." : "");
      problem.hidden = !bad;
      save.disabled = !vals.name.trim() || !vals.started_on || (c.ended_on && !vals.ended_on) || bad;
    };
    const name = h("input", { id: `ce-name-${c.id}`, value: vals.name, oninput: (e) => { vals.name = e.target.value; check(); } });
    const desc = h("textarea", { id: `ce-desc-${c.id}`, rows: 3, placeholder: "What this cycle is for: a place, an industry, a kind of role",
      oninput: (e) => { vals.description = e.target.value; } });
    desc.value = vals.description;
    const form = h("form.cycle-edit", {
      onsubmit: async (e) => {
        e.preventDefault();
        const fields = { name: vals.name.trim(), description: vals.description.trim() || null, started_on: vals.started_on };
        if (c.ended_on) fields.ended_on = vals.ended_on;
        const before = { name: c.name, description: c.description, started_on: c.started_on, ...(c.ended_on ? { ended_on: c.ended_on } : {}) };
        const saved = await attempt(() => patch(`cycles/${c.id}`, fields));
        if (!saved) return;
        editing = null;
        await render();
        toast(`Saved ${saved.name}`, "info", { label: "Undo", onclick: async () => { if (await attempt(() => patch(`cycles/${c.id}`, before))) render(); } });
      },
    },
    h("div.field", {}, h("label", { for: `ce-name-${c.id}` }, "Name"), name),
    h("div.field", {}, h("label", { for: `ce-desc-${c.id}` }, "Description ", h("span.al-label__optional", {}, "(optional)")), desc),
    h("div.cycle-dates", {},
      h("div.field", {}, h("label", { for: `ce-start-${c.id}` }, "Started"),
        datePicker({ id: `ce-start-${c.id}`, value: vals.started_on, onChange: (v) => { vals.started_on = v; check(); } })),
      c.ended_on ? h("div.field", {}, h("label", { for: `ce-end-${c.id}` }, "Ended"),
        datePicker({ id: `ce-end-${c.id}`, value: vals.ended_on, onChange: (v) => { vals.ended_on = v; check(); } })) : null),
    problem,
    h("p.al-hint", {}, c.ended_on ? "Only the details change. Its board stays exactly as it was." : "Week numbers and stats count from the start date."),
    h("div.cycle-actions", {}, save,
      h("button.al-button.al-button--sm", { type: "button", onclick: () => { editing = null; render(); } }, "Cancel")));
    queueMicrotask(check);
    return form;
  }

  const stat = (label, value) => h("div.al-stat", {}, h("span.al-stat__label", {}, label), h("span.al-stat__value", {}, value));

  function runningRow(c) {
    if (editing === c.id) return h("article.al-panel.cycle-running", {}, editor(c));
    return h("article.al-panel.cycle-running", {},
      h("div.cycle-head", {},
        h("h3", { translate: "no" }, c.name), h("span.al-badge.al-badge--accent", {}, "Active"),
        h("span.al-hint", {}, `Since ${longDate(c.started_on)} · week ${cycleWeek(c)}`),
        h("button.al-button.al-button--quiet.al-button--sm.cycle-edit-button", { type: "button", onclick: () => { editing = c.id; render(); } }, "Edit details")),
      c.description ? h("p.cycle-desc", { translate: "no" }, c.description) : null,
      h("div.cycle-stats", {},
        stat("Active", c.counts.active), stat("Closed", c.counts.archived),
        stat("Interviewing", c.counts.interviewed), stat("Offers", c.counts.offers)),
      h("div.cycle-actions", {},
        h("button.al-button", { type: "button", onclick: () => pickCycle(c.id) }, "Open its board"),
        h("button.al-button.al-button--quiet", { type: "button", onclick: () => endCycle(c) }, pathIcon(FLAG), h("span", {}, "End this cycle…"))));
  }

  const OUTCOME_BADGE = { offer: "al-badge--success" };
  function pastRow(c) {
    if (editing === c.id) return h("article.al-card.cycle-past-card", {}, editor(c));
    return h("article.al-card.cycle-past-card", {},
      h("div.cycle-head", {},
        h("h3", { translate: "no" }, c.name),
        h("span.al-hint", {}, `${longDate(c.started_on)} to ${longDate(c.ended_on)} · ${cycleWeeks(c)} weeks`),
        h("button.al-button.al-button--quiet.al-button--sm.cycle-edit-button", { type: "button", onclick: () => { editing = c.id; render(); } }, "Edit details")),
      c.description ? h("p.cycle-desc", { translate: "no" }, c.description) : null,
      h("div.cycle-outcome", {},
        h(`span.al-badge.${OUTCOME_BADGE[c.outcome] || "al-badge--outline"}`, {}, optionLabel(R("cycles").fields.find((f) => f.name === "outcome").options, c.outcome || "other")),
        c.outcome_note ? h("span", { translate: "no" }, c.outcome_note) : null),
      h("dl.cycle-figures", {},
        [["Applied", c.counts.applied], ["Interviewed", c.counts.interviewed], ["Offers", c.counts.offers], ["On the board at the end", c.counts.active]]
          .map(([k, v]) => h("div", {}, h("dt", {}, k), h("dd", {}, v)))),
      h("div.cycle-actions", {},
        h("a.al-button.al-button--sm", { href: `/?cycle=${c.id}` }, "Look at its board"),
        h("button.al-button.al-button--quiet.al-button--sm", { type: "button", onclick: () => resumeCycle(c) }, "Resume"),
        h("a.al-button.al-button--quiet.al-button--sm", { href: `/stats?cycle=${c.id}` }, "Its stats")));
  }

  async function render() {
    await loadCycles();
    const run = runningCycles();
    const past = endedCycles();
    fill(page,
      h("header.al-page-head", {},
        h("h1", {}, "Cycles"),
        h("p.al-page-head__lede", {}, "Group applications however suits you: by season, place or industry. Several cycles can run at once. An ended cycle keeps its board exactly as it was. Companies, people, stories and settings are shared by all of them."),
        h("div.al-page-head__end", {},
          h("button.al-button.al-button--primary", { type: "button", onclick: () => startCycle() }, icon("plus"), h("span", {}, "Start a new cycle")))),
      h("section.cycle-section", { "aria-labelledby": "cycles-running" },
        h("h2", { id: "cycles-running" }, "Active"),
        run.length ? run.map(runningRow) : h("p.muted", {}, "No cycle is active. Start one to begin tracking applications.")),
      h("section.cycle-section", { "aria-labelledby": "cycles-past" },
        h("h2", { id: "cycles-past" }, "Past cycles"),
        past.length ? past.map(pastRow) : h("p.muted", {}, "None yet. When a cycle ends, its board is kept here.")));
    page.querySelector(".cycle-edit input")?.focus();
  }
  await render();
}

// ---- starting and ending ---------------------------------------------------------------

/**
 * Start a cycle: its name, when, what it's for; and, from the cycle that
 * ended last, what to bring back (what was still open, and what was on
 * hold), each as a new card in the first stage, with its history.
 */
async function startCycle() {
  await loadCycles();
  const last = endedCycles().sort((a, b) => (b.ended_on > a.ended_on ? 1 : -1))[0];
  let carry = [];
  if (last) {
    const b = await get(`board?cycle=${last.id}`);
    carry = [
      ...b.stages.slice(0, -1).flatMap((s) => s.cards.map((c) => ({ c, state: `Was in ${s.name}` }))),
      ...b.archived.filter((c) => c.archive_reason === "paused").map((c) => ({ c, state: "Closed: on hold" })),
    ];
  }
  const vals = { name: seasonName(zonedNow()), started_on: isoToday(), description: "" };
  const chosen = new Set();
  const go_ = h("button.al-button.al-button--primary", { type: "submit" });
  const label = () => {
    go_.textContent = chosen.size ? `Start, with ${chosen.size} brought back` : "Start with an empty board";
    go_.disabled = !vals.name.trim();
  };
  const name = h("input", { id: "start-name", value: vals.name, required: true, oninput: (e) => { vals.name = e.target.value; label(); } });
  const desc = h("textarea", { id: "start-desc", rows: 2, placeholder: "What this cycle is for: a place, an industry, a kind of role", oninput: (e) => { vals.description = e.target.value; } });
  const form = h("form", {
    onsubmit: async (e) => {
      e.preventDefault();
      if (isBusy(go_)) return;
      busy(go_);
      const made = await attempt(() => post("cycles/start", { ...vals, name: vals.name.trim(), bring_back: [...chosen] }));
      busy(go_, false);
      if (!made) return;
      modal.close();
      store("boardCycle", String(made.id));
      await loadCycles();
      go("/");
      toast(`Started ${made.name}${chosen.size ? ` with ${chosen.size} brought back` : ""}`);
    },
  },
  h("h2.al-dialog__title", { id: "modal-title" }, "Start a new cycle"),
  h("div.al-dialog__body", {},
    h("div.cycle-dates", {},
      h("div.field", {}, h("label", { for: "start-name" }, "Name"), name),
      h("div.field", {}, h("label", { for: "start-date" }, "Starts"),
        datePicker({ id: "start-date", value: vals.started_on, onChange: (v) => { vals.started_on = v || isoToday(); } }))),
    h("div.field", {}, h("label", { for: "start-desc" }, "Description ", h("span.al-label__optional", {}, "(optional)")), desc),
    h("p.muted.small", {}, "It starts with an empty board, and any running cycles carry on. Target pay, tags, stages, stories and contacts are shared."),
    carry.length ? h("fieldset.al-fieldset", {},
      h("legend", {}, `Bring back from ${last.name} `, h("span.al-label__optional", {}, "(optional)")),
      h("span.al-hint", {}, "Applications that were still open, or on hold, when it ended. They come back as Considering, with their history."),
      h("div.al-choices", {}, carry.map(({ c, state }) => h("label", {},
        h("input", { type: "checkbox", onchange: (e) => { if (e.target.checked) chosen.add(c.id); else chosen.delete(c.id); label(); } }),
        h("span.al-choice__text", {}, h("span", { translate: "no" }, `${c.company}${c.title ? ` · ${c.title}` : ""}`), h("span.al-choice__hint", {}, state)))))) : null),
  h("div.al-dialog__actions", {},
    h("button.al-button", { type: "button", onclick: () => modal.close() }, "Cancel"), go_));
  label();
  openModal(form);
}

/** A season and year to name a cycle by, as the service does: Autumn 2026. */
function seasonName(d) {
  const m = d.getMonth() + 1;
  const season = m >= 3 && m <= 5 ? "Spring" : m >= 6 && m <= 8 ? "Summer" : m >= 9 && m <= 11 ? "Autumn" : "Winter";
  return `${season} ${d.getFullYear()}`;
}

/** End a running cycle: how it ended (with an offer, which), its name, and what happens. */
/**
 * Run an ended cycle again, after asking: its board opens as it was, to
 * change once more. What its ending put away (reminders, prep) stays so.
 */
async function resumeCycle(c) {
  const ok_ = h("button.al-button.al-button--primary", { type: "submit" }, "Resume");
  openModal(h("form", {
    onsubmit: async (e) => {
      e.preventDefault();
      if (isBusy(ok_)) return;
      busy(ok_);
      const resumed = await attempt(() => post(`cycles/${c.id}/resume`, {}));
      busy(ok_, false);
      if (!resumed) return;
      modal.close();
      await loadCycles();
      pickCycle(resumed.id);
      toast(`Resumed ${resumed.name}`);
    },
  },
  h("h2.al-dialog__title", { id: "modal-title" }, `Resume ${c.name}?`),
  h("div.al-dialog__body", {},
    h("p", {}, "It runs again, from where it ended: its board can change once more, and it counts as active."),
    h("p.muted.small", {}, "Reminders and prep put away when it ended stay that way. It can be ended again any time.")),
  h("div.al-dialog__actions", {},
    h("button.al-button", { type: "button", onclick: () => modal.close() }, "Cancel"), ok_)));
}

async function endCycle(c) {
  const b = await get(`board?cycle=${c.id}`);
  const cards = b.stages.flatMap((s) => s.cards);
  // Offers to choose from: what reached the last two stages, latest first.
  const late = b.stages.slice(-2).reverse().flatMap((s) => s.cards);
  const vals = { outcome: "offer", process_id: late[0]?.id ?? "", name: c.name };
  const others = runningCycles().length > 1;
  const effects = h("ul.cycle-effects");
  const offerField = h("div.field", {}, h("label", { for: "end-offer" }, "Which offer?"),
    h("select", { id: "end-offer", onchange: (e) => { vals.process_id = e.target.value; drawEffects(); } },
      late.map((p) => h("option", { value: p.id, selected: p.id === vals.process_id }, `${p.company}${p.title ? ` · ${p.title}` : ""}`)),
      h("option", { value: "", selected: !late.length }, "One that isn't on the board")),
    h("span.al-hint", {}, "It moves to the last stage, Accepted if it has that sub stage. Its take-home and pay stay on record."));
  function drawEffects() {
    const open = cards.length;
    const off = vals.outcome === "offer" && cards.find((p) => String(p.id) === String(vals.process_id));
    offerField.hidden = vals.outcome !== "offer";
    fill(effects,
      h("li", {}, open === 1 ? "1 open application is kept as it is: stage, sub stage, timeline, notes and files." : `${open} open applications are kept as they are: stage, sub stage, timeline, notes and files.`),
      h("li", {}, b.archived_total === 1 ? "1 closed application stays closed, inside the cycle." : `${b.archived_total} closed applications stay closed, inside the cycle.`),
      off ? h("li", { translate: "no" }, `${off.company} moves to ${b.stages[b.stages.length - 1]?.name}.`) : null,
      h("li", {}, "Open reminders and prep for these applications are closed. General prep stays."),
      others ? h("li", {}, "Your other running cycles are not affected.") : null,
      h("li", {}, "You can look at its board any time under Cycles."));
  }
  const HOWS = [["offer", "I accepted an offer", "Congratulations"], ["break", "I'm taking a break", "Pick it up again later with a new cycle"],
    ["stopped", "I stopped looking", "Staying where you are, or something else"], ["other", "Something else", ""]];
  const ok_ = h("button.al-button.al-button--primary", { type: "submit" }, "End the cycle");
  const form = h("form", {
    onsubmit: async (e) => {
      e.preventDefault();
      if (isBusy(ok_) || !vals.name.trim()) return;
      busy(ok_);
      const ended = await attempt(() => post(`cycles/${c.id}/end`, {
        outcome: vals.outcome, name: vals.name.trim(),
        process_id: vals.outcome === "offer" && vals.process_id ? Number(vals.process_id) : null,
      }));
      busy(ok_, false);
      if (!ended) return;
      modal.close();
      await loadCycles();
      go("/cycles");
      toast(`Ended ${ended.name}. Its board is saved below.`);
    },
  },
  h("h2.al-dialog__title", { id: "modal-title" }, `End the ${c.name} cycle`),
  h("div.al-dialog__body", {},
    h("fieldset.al-fieldset", {}, h("legend", {}, "How did it end?"),
      h("div.al-choices", {}, HOWS.map(([v, l, hint]) => h("label", {},
        h("input", { type: "radio", name: "end-how", value: v, checked: vals.outcome === v, onchange: () => { vals.outcome = v; drawEffects(); } }),
        h("span.al-choice__text", {}, h("span", {}, l), hint ? h("span.al-choice__hint", {}, hint) : null))))),
    offerField,
    h("div.field", {}, h("label", { for: "end-name" }, "Name"),
      h("input", { id: "end-name", value: vals.name, oninput: (e) => { vals.name = e.target.value; ok_.disabled = !vals.name.trim(); } })),
    h("div.cycle-what-happens", {}, h("span.al-label", {}, "What happens"), effects)),
  h("div.al-dialog__actions", {},
    h("button.al-button", { type: "button", onclick: () => modal.close() }, "Cancel"), ok_));
  drawEffects();
  openModal(form);
}
