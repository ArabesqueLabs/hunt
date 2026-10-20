"use strict";

// Prep (/prep): what to read, practise and rehearse, for a particular
// interview or in general. The interviews coming up come first, each with
// how much of its prep is done; then the tasks, in progress, next and done;
// and the stories to tell, under their own tab. Built on app.js.

const PREP_MINUTES = [[15, "15 min"], [30, "30 min"], [60, "1 hr"], [120, "2 hr"], [240, "Half a day"]];
const minutesLabel = (n) => (PREP_MINUTES.find(([m]) => m === n) || [n, n ? `${n} min` : ""])[1];
const prepKinds = () => R("prep").fields.find((f) => f.name === "kind").options;
const PRIORITY_ORDER = { high: 0, normal: 1, low: 2 };

/** Whether a daily item was done today. */
const doneToday = (x) => x.repeats === "daily" && x.last_done_on === isoToday();
const isDone = (x) => (x.repeats === "daily" ? doneToday(x) : x.status === "done");

/** What's remembered of the page in this browser: the tab and the filters. */
const prepState = () => {
  try { return { tab: "tasks", for: "all", step: "", kind: "all", ...JSON.parse(stored("prep") || "{}") }; } catch { return { tab: "tasks", for: "all", step: "", kind: "all" }; }
};

async function showPrep(opts = {}) {
  const st = { ...prepState(), ...opts };
  const keep = () => store("prep", JSON.stringify({ tab: st.tab, for: st.for, step: st.step, kind: st.kind }));
  let adding = opts.adding || false;
  let items = [];
  let stories = [];
  let steps = new Map();
  let processes = [];
  const page = h("div.page.prep-page");
  view.replaceChildren(page);

  async function load() {
    const running = new Set(runningCycles().map((c) => c.id));
    const [all, st_, procs, sts] = await Promise.all([get("prep"), get("stories"), get("processes?status=active"), get("steps")]);
    items = all.filter((x) => x.status !== "closed");
    stories = st_;
    processes = procs.filter((p) => running.has(p.cycle_id));
    steps = new Map(sts.map((s) => [s.id, s]));
  }

  const procById = (id) => processes.find((p) => p.id === id);
  const forLabel = (x) => {
    const p = procById(x.process_id);
    if (!p) return null;
    const s = x.step_id && steps.get(x.step_id);
    return `${p.label.split(" — ")[0]}${s ? ` · ${s.title}` : ""}`;
  };
  /** When it's to be done by: its own date, or else before its step. */
  const dueOf = (x) => {
    if (x.due_on) return { at: x.due_on, text: fmtDay(x.due_on) };
    const s = x.step_id && steps.get(x.step_id);
    return s?.at && s.status === "scheduled" ? { at: s.at, text: `Before ${fmtDay(s.at)}` } : null;
  };
  const order = (a, b) => ((dueOf(a)?.at || "9") > (dueOf(b)?.at || "9") ? 1 : (dueOf(a)?.at || "9") < (dueOf(b)?.at || "9") ? -1 : 0)
    || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.id - b.id;

  const inScope = (x) => (st.for === "all" || (st.for === "general" ? !x.process_id : String(x.process_id) === st.for))
    && (!st.step || String(x.step_id) === st.step) && (st.kind === "all" || x.kind === st.kind);

  async function setItem(x, fields, message) {
    const saved = await attempt(() => patch(`prep/${x.id}`, fields));
    if (saved) { Object.assign(x, saved); if (message) toast(message); render(); }
  }

  function itemView(x) {
    const done = isDone(x);
    const due = !done && dueOf(x);
    const soon = due && daysFromToday(parseLocal(due.at)) <= 1;
    const title = x.url
      ? h("a.prep-title", { href: x.url, target: "_blank", rel: "noreferrer", title: x.url, translate: "no" }, x.title)
      : h("span.prep-title", { translate: "no" }, x.title);
    const fl = forLabel(x);
    return h("li.prep-item", { class: done ? "done" : "" },
      h("input", { type: "checkbox", checked: done, "aria-label": `Done: ${x.title}`, onchange: async (e) => {
        const ticked = await attempt(() => post(`prep/${x.id}/tick`, { done: e.target.checked }));
        if (!ticked) return;
        Object.assign(x, ticked);
        toast(x.repeats === "daily"
          ? (e.target.checked ? `Done for today · ${x.streak}-day streak` : "Back on today's list")
          : (e.target.checked ? `Done: ${x.title}` : "Back on the list"));
        render();
      } }),
      h("div.prep-body", {},
        h("div.prep-line", {}, title,
          x.priority === "high" && !done ? h("span.al-badge.al-badge--accent", {}, "High priority") : null,
          x.status === "doing" && !done ? h("span.al-badge.al-badge--info", {}, "In progress") : null),
        h("div.prep-meta", {},
          h("span", {}, optionLabel(prepKinds(), x.kind)),
          x.minutes ? h("span", {}, minutesLabel(x.minutes)) : null,
          fl ? h("a", { href: `/p/${x.process_id}`, translate: "no" }, fl) : h("span", {}, "General"),
          due ? h("span", { class: soon ? "prep-soon" : "" }, due.text) : null,
          x.repeats === "daily" ? h("span", {}, x.streak ? `Daily · ${x.streak}-day streak` : "Daily · starts today") : null),
        done && x.repeats !== "daily" ? h("div.prep-confidence", {},
          h("span.al-hint", {}, "How solid does it feel?"),
          h("div.al-segmented", { role: "group", "aria-label": `How solid, ${x.title}` },
            [["shaky", "Shaky"], ["ok", "OK"], ["solid", "Solid"]].map(([v, l]) => h("button", { type: "button", "aria-pressed": String(x.confidence === v),
              onclick: () => setItem(x, { confidence: v }) }, l))),
          x.confidence === "shaky" ? h("button.al-button.al-button--quiet.al-button--sm", { type: "button",
            onclick: () => setItem(x, { status: "todo", priority: "high", confidence: null }, "Back on the list, high priority") }, "Go over it again") : null) : null),
      h("div.prep-tools", {},
        x.status === "todo" && !done ? h("button.al-button.al-button--sm", { type: "button", onclick: () => setItem(x, { status: "doing" }) }, "Start") : null,
        h("button.al-button.al-button--quiet.al-button--sm.al-button--icon", { type: "button", "aria-label": `Delete ${x.title}`, title: "Delete", onclick: async () => {
          if (!(await attempt(() => del(`prep/${x.id}`)))) return;
          const { id, label, created_at, updated_at, streak, last_done_on, ...again } = x;
          await load(); render();
          toast(`Deleted ${x.title}`, "info", { label: "Undo", onclick: async () => { if (await attempt(() => post("prep", again))) { await load(); render(); } } });
        } }, icon("trash"))));
  }

  function group(label, list, hint, empty) {
    return h("section.prep-group", { "aria-label": label },
      h("div.prep-group-head", {}, h("h2", {}, label), h("span.al-badge.al-badge--count", {}, list.length), hint ? h("span.al-hint", {}, hint) : null),
      list.length ? h("ul.prep-list", {}, list.map(itemView)) : h("p.prep-empty", {}, empty));
  }

  function addForm() {
    const vals = { title: "", url: "", kind: "read", process_id: st.for !== "all" && st.for !== "general" ? st.for : "", step_id: st.step || "",
      minutes: 30, due_on: null, priority: "normal", repeats: false };
    const submit = h("button.al-button.al-button--primary", { type: "submit", disabled: true }, "Add prep");
    const stepField = h("div.field");
    const dueHint = h("span.al-hint");
    const drawSteps = () => {
      const mine = [...steps.values()].filter((s) => String(s.process_id) === String(vals.process_id) && s.status === "scheduled");
      stepField.hidden = !mine.length;
      fill(stepField, h("label", { for: "pa-step" }, "Step ", h("span.al-label__optional", {}, "(optional)")),
        h("select", { id: "pa-step", onchange: (e) => { vals.step_id = e.target.value; drawHint(); } },
          h("option", { value: "" }, "The whole process"),
          mine.map((s) => h("option", { value: s.id, selected: String(s.id) === String(vals.step_id) }, s.title))));
      drawHint();
    };
    const drawHint = () => {
      const s = vals.step_id && steps.get(Number(vals.step_id));
      dueHint.textContent = s?.at ? `Leave empty to finish before ${fmtDay(s.at)}` : "";
    };
    const pri = h("div.al-segmented", { role: "group", "aria-label": "Priority" });
    const drawPri = () => fill(pri, [["high", "High"], ["normal", "Normal"], ["low", "Low"]].map(([v, l]) =>
      h("button", { type: "button", "aria-pressed": String(vals.priority === v), onclick: () => { vals.priority = v; drawPri(); } }, l)));
    drawPri();
    const form = h("form.al-panel.prep-add", { "aria-label": "Add prep", onsubmit: async (e) => {
      e.preventDefault();
      if (!vals.title.trim() || isBusy(submit)) return;
      busy(submit);
      const made = await attempt(() => post("prep", {
        title: vals.title.trim(), url: vals.url.trim() || null, kind: vals.kind, priority: vals.priority, minutes: vals.minutes,
        process_id: vals.process_id ? Number(vals.process_id) : null, step_id: vals.step_id ? Number(vals.step_id) : null,
        due_on: vals.due_on, repeats: vals.repeats ? "daily" : null,
      }));
      busy(submit, false);
      if (!made) return;
      adding = false;
      await load();
      const shown = inScope(made);
      if (!shown) { st.for = "all"; st.step = ""; st.kind = "all"; keep(); }
      render();
      toast(shown ? "Added to prep" : "Added to prep · filters widened to show it");
    } },
    h("div.field.prep-wide", {}, h("label", { for: "pa-title" }, "What to do"),
      h("input", { id: "pa-title", placeholder: "e.g. Practise designing a rate limiter", oninput: (e) => { vals.title = e.target.value; submit.disabled = !vals.title.trim(); } })),
    h("div.field.prep-wide", {}, h("label", { for: "pa-url" }, "Link ", h("span.al-label__optional", {}, "(optional)")),
      h("input", { id: "pa-url", type: "url", placeholder: "Article, video, exercise or doc", oninput: (e) => { vals.url = e.target.value; } })),
    h("div.field", {}, h("label", { for: "pa-kind" }, "Kind"),
      h("select", { id: "pa-kind", onchange: (e) => { vals.kind = e.target.value; } }, prepKinds().map(([v, l]) => h("option", { value: v }, l)))),
    h("div.field", {}, h("label", { for: "pa-for" }, "For"),
      h("select", { id: "pa-for", onchange: (e) => { vals.process_id = e.target.value; vals.step_id = ""; drawSteps(); } },
        h("option", { value: "" }, "General prep"),
        processes.map((p) => h("option", { value: p.id, selected: String(p.id) === String(vals.process_id) }, p.label)))),
    stepField,
    h("div.field", {}, h("label", { for: "pa-est" }, "Takes about"),
      h("select", { id: "pa-est", onchange: (e) => { vals.minutes = Number(e.target.value); } },
        PREP_MINUTES.map(([m, l]) => h("option", { value: m, selected: m === vals.minutes }, l)))),
    h("div.field", {}, h("label", { for: "pa-due" }, "Do by ", h("span.al-label__optional", {}, "(optional)")),
      datePicker({ id: "pa-due", value: null, onChange: (v) => { vals.due_on = v; } }), dueHint),
    h("div.field", {}, h("span.al-label", {}, "Priority"), pri),
    h("label.prep-daily", {}, h("input", { type: "checkbox", onchange: (e) => { vals.repeats = e.target.checked; } }),
      h("span.al-choice__text", {}, h("span", {}, "Repeat daily"), h("span.al-choice__hint", {}, "For drills, with a streak"))),
    h("div.prep-add-actions", {},
      h("button.al-button", { type: "button", onclick: () => { adding = false; render(); } }, "Cancel"), submit));
    drawSteps();
    return form;
  }

  function tasksTab() {
    const scoped = items.filter(inScope);
    const doing = scoped.filter((x) => x.status === "doing" && !isDone(x)).sort(order);
    const todo = scoped.filter((x) => x.status === "todo" && !isDone(x)).sort(order);
    const done = scoped.filter(isDone);
    const forSel = h("select", { id: "pf-for", onchange: (e) => { st.for = e.target.value; st.step = ""; keep(); render(); } },
      h("option", { value: "all" }, "Everything"), h("option", { value: "general", selected: st.for === "general" }, "General prep"),
      processes.map((p) => h("option", { value: p.id, selected: String(p.id) === st.for }, p.label)));
    const kindSel = h("select", { id: "pf-kind", onchange: (e) => { st.kind = e.target.value; keep(); render(); } },
      h("option", { value: "all" }, "All kinds"), prepKinds().map(([v, l]) => h("option", { value: v, selected: v === st.kind }, l)));
    const filtered = st.for !== "all" || st.kind !== "all" || st.step;
    const stepName = st.step && steps.get(Number(st.step))?.title;
    return [
      h("div.prep-filters", {},
        h("div.field", {}, h("label", { for: "pf-for" }, "For"), forSel),
        h("div.field", {}, h("label", { for: "pf-kind" }, "Kind"), kindSel),
        filtered ? h("button.al-button.al-button--quiet.al-button--sm", { type: "button", onclick: () => { st.for = "all"; st.step = ""; st.kind = "all"; keep(); render(); } }, "Show everything") : null,
        h("span.al-hint.prep-summary", {}, `${done.length} of ${scoped.length} done${stepName ? ` for ${stepName}` : ""}`)),
      adding ? addForm() : null,
      group("In progress", doing, "", "Nothing started. Pick something from Next."),
      group("Next", todo, "Soonest interview first, then priority", "All done here."),
      group("Done", done, "Mark how solid it feels; shaky ones can go back on the list", "Nothing done yet."),
    ];
  }

  function storyForm(s, onDone) {
    const vals = { title: s?.title || "", situation: s?.situation || "", task: s?.task || "", action: s?.action || "", result: s?.result || "", themes: s?.themes || "", told: s?.told || "" };
    const field = (k, label, long, ph) => {
      const id = `story-${s?.id || "new"}-${k}`;
      const c = long ? h("textarea", { id, rows: 2, placeholder: ph, oninput: (e) => { vals[k] = e.target.value; } }) : h("input", { id, placeholder: ph, value: vals[k], oninput: (e) => { vals[k] = e.target.value; } });
      if (long) c.value = vals[k];
      return h("div.field", { class: long || k === "title" ? "prep-wide" : "" }, h("label", { for: id }, label), c);
    };
    return h("form.al-panel.story-form", { onsubmit: async (e) => {
      e.preventDefault();
      if (!vals.title.trim()) return;
      const body = Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, v.trim() || null]));
      const saved = await attempt(() => (s ? patch(`stories/${s.id}`, body) : post("stories", body)));
      if (saved) { toast(s ? "Saved" : "Story added"); onDone(); }
    } },
    field("title", "Title", false, "e.g. Cut p99 latency of the billing API by 60%"),
    field("situation", "Situation", true, "What was going on"),
    field("task", "Task", true, "What you had to do"),
    field("action", "Action", true, "What you did"),
    field("result", "Result", true, "How it turned out"),
    field("themes", "Themes", false, "e.g. Leadership, Conflict"),
    field("told", "Told at", false, "e.g. Quillnote, Fernwise"),
    h("div.prep-add-actions", {},
      s ? h("button.al-button.al-button--quiet.al-button--danger.al-button--sm", { type: "button", onclick: async () => {
        if (!(await confirmDelete(`story “${s.title}”`))) return;
        if (await attempt(() => del(`stories/${s.id}`))) { toast("Deleted"); onDone(); }
      } }, "Delete") : null,
      h("span.spacer"),
      h("button.al-button", { type: "button", onclick: () => onDone(false) }, "Cancel"),
      h("button.al-button.al-button--primary", { type: "submit" }, s ? "Save" : "Add story")));
  }

  let storyEditing = null; // a story's id, or "new"
  function storiesTab() {
    const again = async (changed = true) => { storyEditing = null; if (changed) await load(); render(); };
    return [
      h("p.prep-intro", {}, "Stories from your work to tell in behavioural questions, written once as situation, task, action and result, and reused across interviews."),
      h("div.story-list", {}, stories.map((s) => storyEditing === s.id ? storyForm(s, again) : h("details.al-disclosure.story", {},
        h("summary", {},
          h("span.story-head", {}, h("span.story-title", { translate: "no" }, s.title),
            s.themes ? h("span.story-themes", {}, s.themes.split(",").map((t) => t.trim()).filter(Boolean).map((t) => h("span.al-badge.al-badge--outline", { translate: "no" }, t))) : null),
          h("span.al-disclosure__value", {}, s.told ? h("span", {}, "Told at ", h("span", { translate: "no" }, s.told)) : "Not told yet")),
        h("div.al-disclosure__body", {},
          h("dl.story-parts", {}, [["Situation", s.situation], ["Task", s.task], ["Action", s.action], ["Result", s.result]]
            .filter(([, v]) => v).map(([k, v]) => [h("dt", {}, k), h("dd", { translate: "no" }, v)])),
          h("div.cycle-actions", {},
            h("button.al-button.al-button--quiet.al-button--sm", { type: "button", onclick: () => { storyEditing = s.id; render(); } }, "Edit"),
            h("button.al-button.al-button--quiet.al-button--sm", { type: "button", onclick: async () => {
              if (await attempt(() => post("prep", { title: `Run through: ${s.title}`, kind: "practise", minutes: 15 }))) { await load(); render(); toast("Added a run-through to prep"); }
            } }, "Add a run-through to prep")))))),
      storyEditing === "new" ? storyForm(null, again)
        : h("button.al-button.prep-add-story", { type: "button", onclick: () => { storyEditing = "new"; render(); } }, icon("plus"), h("span", {}, "Add a story")),
    ];
  }

  function render() {
    const tabs = [["tasks", "To do", items.filter((x) => !isDone(x)).length], ["stories", "Stories", stories.length]];
    fill(page,
      h("header.al-page-head", {},
        h("h1", {}, "Prep"),
        h("p.al-page-head__lede", {}, "What to read, practise and rehearse, for a particular interview or in general."),
        h("div.al-page-head__end", {},
          h("button.al-button.al-button--primary", { type: "button", onclick: () => { adding = true; st.tab = "tasks"; keep(); render(); page.querySelector("#pa-title")?.focus(); } },
            icon("plus"), h("span", {}, "Add prep")))),
      h("div.al-tabs", { role: "tablist", "aria-label": "Prep" }, tabs.map(([k, l, n]) =>
        h("button.al-tab", { type: "button", role: "tab", id: `prep-tab-${k}`, "aria-controls": "prep-panel", "aria-selected": String(st.tab === k),
          onclick: () => { st.tab = k; keep(); render(); } }, l, h("span.al-tab__count", {}, n)))),
      h("div.prep-panel", { id: "prep-panel", role: "tabpanel", "aria-labelledby": `prep-tab-${st.tab}` }, st.tab === "stories" ? storiesTab() : tasksTab()));
  }

  await load();
  render();
  if (adding) page.querySelector("#pa-title")?.focus();
}
