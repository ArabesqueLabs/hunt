"use strict";

// The application page: one application on a page of its own
// (/applications/ID). The board's cards and the Applications list both open
// it. It reads first; Edit turns it into a form whose changes are saved
// together, or discarded. What acts as you go (people, files sent, emails)
// works in either mode.
//
// Built on app.js's helpers (h, get, post, combo, …), loaded before this.

// ---- formatting text that was pasted in ---------------------------------------

const URL_RE = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

/** Text with its links made clickable. */
function linkify(text) {
  return String(text).split(URL_RE).map((part, i) => (i % 2
    ? h("a", { href: part, target: "_blank", rel: "noreferrer" }, part)
    : part));
}

const BULLET = /^\s*(?:[-*•·▪‣–]|\d{1,2}[.)])\s+/;

/**
 * A job posting's text, as paragraphs, lists and headings: blank lines end
 * paragraphs; lines starting with a bullet or number are list items; a
 * short line ending in a colon, or in capitals, before more text is a
 * heading.
 */
function formatPosting(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let para = [];
  let list = null;
  const flushPara = () => { if (para.length) { out.push(h("p", {}, para.map((l, i) => [i ? h("br") : null, linkify(l)]))); para = []; } };
  const flushList = () => { if (list) { out.push(list.el); list = null; } };
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) { flushPara(); flushList(); return; }
    const bullet = line.match(BULLET);
    if (bullet) {
      flushPara();
      const ordered = /\d/.test(bullet[0]);
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, el: h(ordered ? "ol" : "ul") }; }
      list.el.append(h("li", {}, linkify(line.slice(bullet[0].length))));
      return;
    }
    const next = (lines[i + 1] || "").trim();
    const heading = line.length <= 60 && !/[.!?]$/.test(line)
      && (line.endsWith(":") || (line === line.toUpperCase() && /[A-Z]/.test(line)) || (!para.length && BULLET.test(next))
        || (!para.length && line.split(/\s+/).length <= 6 && next.length > 2 * line.length));
    if (heading && (next || lines[i + 2])) {
      flushPara(); flushList();
      out.push(h("h3", {}, line.replace(/:$/, "")));
      return;
    }
    flushList();
    para.push(line);
  });
  flushPara(); flushList();
  return out;
}

/** An email's text: quoted lines (">") folded into a muted quote, links clickable. */
function formatEmail(text) {
  const out = [];
  let quote = null;
  let plain = [];
  const flush = () => { if (plain.length) { out.push(h("div.email-plain", {}, linkify(plain.join("\n")))); plain = []; } };
  for (const line of String(text).replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*>/.test(line)) {
      flush();
      if (!quote) { quote = []; out.push({ quote }); }
      quote.push(line.replace(/^\s*>\s?/, ""));
    } else {
      if (quote && !line.trim()) continue;
      quote = null;
      plain.push(line);
    }
  }
  flush();
  return out.map((x) => (x instanceof Node ? x : h("blockquote.email-quote", {}, linkify(x.quote.join("\n")))));
}

/** Now, as a local date and time: when a posting was last read. */
function localNow() {
  return `${isoToday()}T${zonedNow().toTimeString().slice(0, 5)}`;
}

/** A link's site: `jobs.ashbyhq.com`. */
const hostOf = (url) => url.replace(/^https?:\/\/(www\.)?/, "").split(/[/?#]/)[0];

/**
 * Read an application's posting links, all at once, and choose what to keep.
 * `links`: [{key, url, text}], `key` being "main" (the application's own) or
 * a posting's id. Each field a link has something new for is a row: what's
 * there now, then what each link says, one to choose; a row where they
 * disagree is marked. Each link's text is kept for that link, if ticked.
 * `apply({fields, texts, read})`: the fields chosen, the texts kept (by
 * key), and every link that was read.
 */
function openPostingReview({ links, current, apply }) {
  const dlg = h("dialog.al-dialog.al-dialog--md.ask.import.posting-review");
  const result = h("div.import-result", {}, h("p.muted", {}, links.length > 1 ? `Reading ${links.length} postings…` : "Reading the posting…"));
  dlg.append(h("div.al-dialog__inner", {}, h("h2.al-dialog__title", {}, links.length > 1 ? "Refresh from the postings" : "Refresh from the posting"), result));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  Promise.all(links.map((l) => post("applications/lookup", { url: l.url })
    .then((found) => ({ ...l, found }), (err) => ({ ...l, error: err.message }))))
    .then((read) => { if (dlg.open) review(read); });

  function review(read) {
    const ok = read.filter((r) => r.found);
    const fields = R("applications").fields;
    // A link by where it is; by its address too when two are on one site.
    const base = (r) => (r.found?.platform && r.found.platform !== "the page" ? r.found.platform : hostOf(r.url));
    const name = (r) => (ok.filter((x) => base(x) === base(r)).length > 1
      ? r.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").slice(0, 48) : base(r));
    const filled = (v) => v != null && v !== "";
    const same = (a, b) => String(a ?? "") === String(b ?? "");
    const show = (k, v) => {
      if (!filled(v)) return h("span.muted", {}, "—");
      const f = fields.find((x) => x.name === k);
      if (f?.type === "enum") return optionLabel(f.options, v);
      if (f?.type === "number") return Number(v).toLocaleString(LOC());
      if (f?.type === "date") return fmtDay(v);
      return String(v);
    };
    const failed = read.filter((r) => r.error).map((r) => notice("danger", { role: "alert" }, `${hostOf(r.url)}: ${r.error}`));
    const close = h("button.al-button", { type: "button", onclick: () => dlg.close() }, "Close");

    // The fields: a choice where some link says something new.
    const keys = POSTING_FIELDS.filter((k) => !["url", "description"].includes(k)
      && ok.some((r) => filled(r.found[k]) && !same(r.found[k], current[k])));
    const rows = keys.map((k) => {
      // Marked when the links themselves disagree.
      const differ = new Set(ok.map((r) => r.found[k]).filter(filled).map(String)).size > 1;
      // What's there stays, unless it's empty: then the first link's.
      const pick = filled(current[k]) ? "now" : String(ok.findIndex((r) => filled(r.found[k])));
      const choice = (value, label, shown) => h("label.choice", {},
        h("input", { type: "radio", name: `pick-${k}`, value, checked: value === pick, "aria-label": `${fields.find((f) => f.name === k)?.label || k}: ${label}` }), shown);
      return h("tr", { class: differ ? "differ" : "" },
        h("th", { scope: "row" }, fields.find((f) => f.name === k)?.label || k, differ ? h("span.differ-mark", { title: "The links disagree" }, " ≠") : null),
        h("td", {}, choice("now", "keep", show(k, current[k]))),
        ok.map((r, i) => h("td", {}, filled(r.found[k]) ? choice(String(i), name(r), show(k, r.found[k])) : h("span.muted", {}, "—"))));
    });
    // Each link's own text: kept for it, when it's new.
    const texts = ok.filter((r) => filled(r.found.description) && !same(r.found.description, r.text))
      .map((r) => h("label.check", {}, h("input", { type: "checkbox", checked: true, dataset: { key: String(r.key) } }),
        ` The posting text from ${name(r)}${r.text ? " (it has changed)" : ""}`));

    if (!rows.length && !texts.length) {
      fill(result, failed, ok.length ? h("p", {}, ok.length > 1 ? "Nothing new: the postings say what's already here." : "Nothing new: the posting says what's already here.") : null,
        h("div.actions", {}, close));
      // Still, they were read now.
      if (ok.length) apply({ fields: {}, texts: {}, read: ok });
      return;
    }
    const table = rows.length ? h("div.al-table-wrap", {}, h("table.import-table.posting-choices", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Field"), h("th", {}, "Now"), ok.map((r) => h("th", {}, h("a", { href: r.url, target: "_blank", rel: "noreferrer" }, name(r)))))),
      h("tbody", {}, rows))) : null;
    const textList = texts.length ? h("div.posting-texts", {}, texts) : null;
    fill(result, failed,
      h("p.muted.small", {}, rows.length
        ? `Choose one for each field: what's there now, or what ${ok.length > 1 ? "a link" : "the link"} says.${ok.length > 1 ? " ≠ marks where they disagree." : ""}`
        : ""),
      table, textList,
      h("div.actions", {},
        h("button.al-button", { type: "button", onclick: () => dlg.close() }, "Cancel"),
        h("button.al-button.al-button--primary", { type: "button", onclick: async () => {
          const chosen = {};
          for (const k of keys) {
            const v = dlg.querySelector(`input[name="pick-${k}"]:checked`)?.value;
            if (v && v !== "now") chosen[k] = ok[Number(v)].found[k];
          }
          const kept = {};
          dlg.querySelectorAll(".posting-texts input:checked").forEach((b) => {
            const r = ok.find((x) => String(x.key) === b.dataset.key);
            kept[r.key] = r.found.description;
          });
          await apply({ fields: chosen, texts: kept, read: ok });
          dlg.close();
        } }, "Use these")));
  }
}

/** A thread's key: Gmail's thread, or else the subject without Re:/Fwd:. */
const threadKey = (m) => m.gm_thrid || `s:${(m.subject || "").toLowerCase().replace(/^\s*((re|fwd?|aw|sv|tr)\s*(\[\d+\])?\s*:\s*)+/i, "").replace(/\s+/g, " ").trim()}`;

/** The fields of a record the page edits, as `{field: value}`. */
const pickKeys = (rec, keys) => Object.fromEntries(keys.map((k) => [k, rec?.[k] ?? null]));

const APP_KEYS = ["company_id", "title", "url", "location", "work_mode", "employment", "source",
  "salary_min", "salary_max", "currency", "pay_period", "bonus", "equity", "comp", "note", "description"];
const COMPANY_KEYS = ["website", "industry", "size", "description"];
const PROCESS_KEYS = ["stage_id", "applied_on"];
const STEP_KEYS = ["title", "at", "status", "format", "attendees", "note"];
const EVENT_KEYS = ["body", "happened_on"];

/** Everything the page shows: the application, its company, its processes,
 * its other postings, and the process shown (`processId`, or the newest
 * active one). */
async function loadApplication(id, processId) {
  const app = await get(`applications/${id}`);
  const [company, procs, allStages, postings, lanes, links] = await Promise.all([
    get(`companies/${app.company_id}`),
    get(`processes?application_id=${id}`),
    get("stages"),
    get(`postings?application_id=${id}`),
    get("lanes"),
    get(`links?application_id=${id}`),
  ]);
  procs.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const process = procs.find((p) => p.id === processId) || procs.find((p) => p.status === "active") || procs[0] || null;
  const [detail, reminders, prep] = process
    ? await Promise.all([get(`processes/${process.id}/detail`), get(`reminders?process_id=${process.id}`), get(`prep?process_id=${process.id}`)])
    : [null, [], []];
  // The board's stages; a closed process is in an inactive one, having reached one of these.
  const stages = allStages.filter((st) => st.active !== 0);
  return { app, company, procs, stages, allStages, postings, lanes, process, detail, links, reminders, prep };
}

/** What Edit starts from: the editable parts, copied. */
function draftOf(s) {
  return {
    app: pickKeys(s.app, APP_KEYS),
    company: pickKeys(s.company, COMPANY_KEYS),
    companyName: s.company.name,
    companyLogo: s.company.logo,
    tags: tagNames(s.app.tags),
    process: s.process ? pickKeys(s.process, PROCESS_KEYS) : null,
    steps: (s.detail?.steps || []).map((x) => ({ id: x.id, ...pickKeys(x, STEP_KEYS), people: (x.people || []).map((p) => ({ id: p.id, name: p.name })) })),
    events: (s.detail?.notes || []).map((x) => ({ id: x.id, ...pickKeys(x, EVENT_KEYS), happened_on: x.happened_on || x.created_at.slice(0, 10) })),
  };
}

// The page asks before leaving with unsaved changes (see route() in app.js).
let leaveGuard = null;

async function showApplication(id, { processId = null, editing = false, readLink = null } = {}) {
  let s;
  try {
    s = await loadApplication(id, processId);
  } catch (e) {
    fill(view, h("div.page", {}, notice("danger", { role: "alert" }, e.message), h("a", { href: "/applications" }, "← Applications")));
    return;
  }
  let edit = editing;
  // What the timeline's form adds, while it's open: a note, an interview
  // step, or a reminder; null, closed.
  let composer = null;
  let orig = draftOf(s);
  let draft = structuredClone(orig);
  // What's open: folded sections, and add forms shown in View mode.
  const opened = new Set();
  const toggle = (key) => { if (opened.has(key)) opened.delete(key); else opened.add(key); render(); };
  const page = h("div.page.application");
  const dirty = () => edit && JSON.stringify(draft) !== JSON.stringify(orig);
  leaveGuard = () => dirty();
  window.onbeforeunload = (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ""; } };

  const reload = async (opts = {}) => {
    leaveGuard = null;
    await showApplication(id, { processId: s.process?.id ?? null, ...opts });
  };
  const setEdit = (on, focus = null) => {
    if (!on && dirty() && !confirm("Discard your changes?")) return;
    edit = on;
    draft = structuredClone(orig);
    render();
    if (on) page.querySelector(focus || ".app-head input, .app-head .combo input")?.focus();
  };

  // ---- small parts ----

  const input = (obj, key, attrs = {}) => {
    // A date: the design system's date picker, in hunt's language and digits.
    if (attrs.type === "date") {
      return datePicker({ value: obj[key], label: attrs["aria-label"] || attrs.placeholder || key,
        onChange: (v) => { obj[key] = v; },
        onBad: () => toast(t("Enter a date, day first, like 30/11/2026"), "error") });
    }
    const el = h(attrs.multiline ? "textarea" : "input", {
      ...attrs, multiline: null, "aria-label": attrs["aria-label"] || attrs.placeholder || key,
      value: obj[key] ?? "", type: attrs.multiline ? null : attrs.type || "text",
    });
    el.addEventListener("input", () => { obj[key] = el.value.trim() === "" ? null : el.value; });
    return el;
  };
  const select = (obj, key, options, { empty = "Not set", label } = {}) => {
    const el = h("select", { "aria-label": label || key },
      empty ? h("option", { value: "" }, empty) : null,
      options.map(([v, l]) => h("option", { value: v, selected: obj[key] === v }, l)));
    el.addEventListener("change", () => { obj[key] = el.value || null; });
    return el;
  };
  const optionsOf = (resource, name) => R(resource).fields.find((f) => f.name === name).options;
  const labeled = (label, control) => {
    // A field is named by its label, not its placeholder.
    if (control.matches("input, select, textarea")) control.setAttribute("aria-label", label);
    return h("label.app-field", {}, h("span", {}, label), control);
  };
  const inline = (label, value) => h("div.app-inline", {}, h("dt", {}, label), h("dd", {}, value ?? h("span.muted", {}, "—")));
  // Every section folds from its header; folded ones are remembered.
  const FOLDED_FIRST = { company: true, posting: !edit };
  let folds = {};
  try { folds = JSON.parse(stored("appFolds") || "{}"); } catch { folds = {}; }
  const isFolded = (key) => folds[key] ?? FOLDED_FIRST[key] ?? false;
  const setFolded = (key, folded) => { folds[key] = folded; store("appFolds", JSON.stringify(folds)); };
  const section = (key, title, { count, action } = {}, ...body) => {
    // Its buttons sit in the header's row, but outside the summary (a
    // control inside one can't be reached properly), so they show while
    // it's open.
    const tools = action ? h("div.app-section-tools", {}, action) : null;
    return h("details.al-disclosure.app-section", { open: !isFolded(key), dataset: { section: key },
      ontoggle: (e) => { if (e.target === e.currentTarget) setFolded(key, !e.currentTarget.open); } },
    h("summary", {}, h("h2", {}, title, count != null ? h("span.count", {}, count) : null)), tools,
    h("div.app-section-body", {}, body));
  };
  const addButton = (label, onclick) => h("button.al-button.al-button--quiet.app-add", { type: "button", onclick }, "+ ", label);
  /** Add a row to something saved with the rest: in View mode, this starts editing. */
  const addRow = (fn, focus) => () => {
    if (!edit) { edit = true; draft = structuredClone(orig); }
    fn();
    render();
    page.querySelector(focus)?.focus();
  };
  /** An add form that acts at once: shown in Edit mode, behind its button in View mode. */
  const showForm = (key) => edit || opened.has(key);
  const formButton = (key, label) => edit ? null
    : h("button.al-button.al-button--quiet.app-add", { type: "button", "aria-expanded": String(opened.has(key)), onclick: () => toggle(key) }, opened.has(key) ? "Close" : `+ ${label}`);
  const removeButton = (label, onclick) => h("button.al-button.al-button--icon.al-button--sm.al-button--danger", { type: "button", "aria-label": label, title: label, onclick }, "×");
  const empty = (text) => h("p.muted.small", {}, text, edit ? "" : " Edit to add some.");
  const link = (url) => h("a", { href: /^https?:/.test(url) ? url : `https://${url}`, target: "_blank", rel: "noreferrer" },
    url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""), " ↗");

  // ---- the head: logo, company and role, tags, and the mode ----

  function head() {
    const a = s.app;
    const title = edit
      ? h("div.app-names", {},
        (() => {
          const box = combo({
            label: "Company", placeholder: "Company", value: draft.companyName, source: refSource("companies"), allowCreate: true,
            onPick: async (it) => {
              const c = it.create ? await attempt(() => post("companies", { name: it.value })) : await get(`companies/${it.value}`);
              if (!c) return;
              draft.app.company_id = c.id;
              draft.companyName = c.name;
              draft.companyLogo = c.logo;
              // The company section follows the company chosen.
              Object.assign(draft.company, pickKeys(c, COMPANY_KEYS));
              orig.company = pickKeys(c, COMPANY_KEYS);
              render();
            },
          });
          return box;
        })(),
        input(draft.app, "title", { placeholder: "Role" }))
      : h("h1", { id: "app-title" }, s.company.name, a.title ? [h("span.muted", {}, " — "), a.title] : null);
    const mode = h("div.al-segmented", { role: "group", "aria-label": "Mode" },
      h("button", { type: "button", "aria-pressed": String(!edit), onclick: () => edit && setEdit(false) }, "View"),
      h("button", { type: "button", "aria-pressed": String(edit), onclick: () => !edit && setEdit(true) }, "Edit"));
    const tools = edit
      ? [h("button.al-button", { type: "button", onclick: () => setEdit(false) }, "Discard"),
        h("button.al-button.al-button--primary", { type: "button", onclick: save }, "✓ Save changes")]
      : [];
    return h("header.app-head", {},
      logoOf(edit ? draft.app.company_id : a.company_id, edit ? draft.companyLogo : s.company.logo, edit ? draft.companyName : s.company.name, 48),
      h("div.app-title", {}, title),
      h("div.app-mode", {}, mode, tools));
  }

  function importPosting() {
    openImport({
      kind: postingImport, url: s.app.url || "", current: s.app,
      apply: async (fields) => {
        if (await attempt(() => patch(`applications/${id}`, fields))) { toast("Imported"); reload(); }
      },
    });
  }

  /** Every posting link: the application's own first. */
  const postingLinks = () => [
    ...(s.app.url ? [{ key: "main", url: s.app.url, text: s.app.description }] : []),
    ...s.postings.map((p) => ({ key: p.id, url: p.url, text: p.description })),
  ];

  /** Read these links (all of them, by default) and choose what to keep;
   * with none, ask for one. */
  function readPostings(links = postingLinks()) {
    if (!links.length) { importPosting(); return; }
    openPostingReview({
      links, current: s.app,
      apply: async ({ fields, texts, read }) => {
        const done = await attempt(async () => {
          const mine = { ...fields, ...("main" in texts ? { description: texts.main } : {}) };
          if (Object.keys(mine).length) await patch(`applications/${id}`, mine);
          for (const r of read) {
            if (r.key === "main") continue;
            await patch(`postings/${r.key}`, { platform: r.found.platform || null, read_at: localNow(), ...(r.key in texts ? { description: texts[r.key] } : {}) });
          }
          return Object.keys(mine).length + Object.keys(texts).length;
        });
        if (done != null) { if (done) toast("Refreshed"); reload(); }
      },
    });
  }

  /** Add a posting link, and read it straight away. */
  async function addPostingLink(url) {
    if (!s.app.url) {
      if (!(await attempt(() => patch(`applications/${id}`, { url })))) return;
    } else if (!(await attempt(() => post("postings", { application_id: id, url })))) {
      return;
    }
    warnIfSamePosting({ ...s.app, url });
    opened.delete("posting-add");
    leaveGuard = null;
    showApplication(id, { processId: s.process?.id ?? null, readLink: url });
  }

  // ---- where it stands: its stage, and whether it's archived ----

  function standing() {
    const p = s.process;
    if (!p) {
      return h("div.app-standing", {}, h("p.muted", {}, "Not on the board. ",
        h("button.al-button.al-button--sm.al-button--quiet", { type: "button", onclick: async () => {
          const card = await attempt(() => post("processes", { application_id: id }));
          if (card) { toast("On the board"); showApplication(id, { processId: card.id }); }
        } }, "Add it to the board")));
    }
    const archived = p.status === "archived";
    // Closed: the stage it reached, unless another is being chosen.
    const current = edit && draft.process.stage_id !== p.stage_id ? draft.process.stage_id : archived ? p.reached_stage_id : p.stage_id;
    const at = s.stages.findIndex((st) => st.id === current);
    const stepper = h("nav.stepper", { "aria-label": "Stage", class: archived ? "archived" : "" },
      h("ol", {}, s.stages.map((st, i) => h("li", {},
        h("button", {
          type: "button", disabled: !edit, "aria-current": i === at ? "step" : null,
          class: i === at ? "current" : i < at ? "past" : "",
          onclick: () => { draft.process.stage_id = st.id; render(); },
        }, h("span.stage-no", {}, i + 1), " ", st.name)))));
    // The stage's lanes, if its column is divided: which one it's in.
    const lanes = s.lanes.filter((l) => l.stage_id === p.stage_id);
    const lanePick = !edit && !archived && lanes.length
      ? h("div.lane-pick", {}, h("span.muted.small", {}, `In ${s.stages.find((st) => st.id === p.stage_id)?.name || "this stage"}:`),
        h("div.al-segmented", { role: "group", "aria-label": "Sub stage" },
          [{ id: null, name: "No sub stage" }, ...lanes].map((l) => h("button", { type: "button", "aria-pressed": String((p.lane_id ?? null) === l.id),
            onclick: async () => {
              if ((p.lane_id ?? null) === l.id) return;
              if (await attempt(() => post(`processes/${p.id}/move`, { stage_id: p.stage_id, lane_id: l.id }))) { toast(l.id ? `In ${l.name}` : "Out of its lane"); reload(); }
            } }, l.name))))
      : null;
    return h("div.app-standing", {},
      archived
        ? h("div.app-archived", {}, h("span.al-badge", {}, "Closed"),
          h("span", {}, closedWhy(p, s.allStages.find((st) => st.id === p.stage_id)?.name), p.archive_note ? h("span.muted", {}, ` — ${p.archive_note}`) : null),
          h("button.al-button.al-button--sm", { type: "button", onclick: async () => {
            // Back to the stage it reached.
            if (await attempt(() => patch(`processes/${p.id}`, { status: "active" }))) { toast("Back on the board"); reload(); }
          } }, "Reopen"))
        : null,
      stepper,
      lanePick,
      edit ? h("p.muted.small", {}, archived ? "Choosing a stage puts it back on the board." : "Choose a stage to move it.") : null);
  }

  // ---- sections ----

  /** The role: where and how first, then pay, then the rest. */
  function role() {
    const a = s.app;
    const f = (n) => optionsOf("applications", n);
    if (edit) {
      return h("div.app-section.app-role", {}, h("div.app-grid.app-key-fields", {},
        labeled("Location", input(draft.app, "location", { placeholder: "e.g. London" })),
        labeled("Work mode", select(draft.app, "work_mode", f("work_mode"), { label: "Work mode" })),
        labeled("Employment", select(draft.app, "employment", f("employment"), { label: "Employment" }))),
      h("div.app-grid.app-pay-fields", {},
        h("label.app-field.wide", {}, h("span", {}, "Base salary"), h("div.app-salary", {},
          input(draft.app, "currency", { placeholder: HOME(), "aria-label": "Currency" }),
          input(draft.app, "salary_min", { placeholder: "From, e.g. 150k", "aria-label": "From" }),
          input(draft.app, "salary_max", { placeholder: "To", "aria-label": "To" }),
          select(draft.app, "pay_period", f("pay_period"), { empty: "Per…", label: "Per" }))),
        labeled("Bonus", input(draft.app, "bonus", { placeholder: "e.g. 15% target" })),
        labeled("Equity", input(draft.app, "equity", { placeholder: "e.g. £200k RSUs over 4 years" })),
        h("label.app-field.wide", {}, h("span", {}, "Pay notes"),
          input(draft.app, "comp", { multiline: true, rows: 2, placeholder: "Benefits, negotiation…", "aria-label": "Pay notes" }))),
      h("div.app-grid.app-more-fields", {},
        labeled("Posting link", input(draft.app, "url", { type: "url", placeholder: "https://…" })),
        labeled("Source", input(draft.app, "source", { placeholder: "e.g. LinkedIn, referral" })),
        draft.process ? labeled("Applied on", input(draft.process, "applied_on", { type: "date" })) : null));
    }
    const salary = fmtMoney(a.salary_min, a.salary_max, a.currency, a.pay_period);
    // Pay in the home currency leads; the posting's own figures follow, smaller.
    const foreign = salary && (a.currency || "").toUpperCase() !== HOME();
    const home = foreign ? homePay(a) : null;
    const inHome = home ? fmtMoney(home[0] == null ? null : Math.round(home[0]), home[1] == null ? null : Math.round(home[1]), HOME(), a.pay_period) : "";
    const rate = a.gbp_rate != null ? `${a.gbp_rate.toFixed(4)} GBP per ${a.currency}, the rate on ${a.gbp_rate_on}` : null;
    const payLine = !salary ? null : inHome
      ? [h("p.app-salary-line", {}, inHome),
        h("p.muted.small.app-salary-orig", { title: rate ? `At ${rate}${HOME() !== "GBP" ? `; GBP to ${HOME()} at the rate on ${PREFS.currency_rate_on}` : ""}` : "" }, salary)]
      : [h("p.app-salary-line", {}, salary), foreign ? h("p.muted.small.app-salary-orig", {}, `No ${HOME()} rate yet`) : null];
    return h("div.app-section.app-role", {},
      h("dl.app-inlines.app-key", {},
        inline("Location", a.location),
        inline("Work mode", a.work_mode ? optionLabel(f("work_mode"), a.work_mode) : null),
        inline("Employment", a.employment ? optionLabel(f("employment"), a.employment) : null)),
      salary || a.bonus || a.equity
        ? h("div.app-pay", {},
          payLine,
          // What it would leave, where take-home pay is on.
          salary && takeHomeOn() ? takeHomeLine(a) : null,
          a.bonus || a.equity ? h("dl.app-inlines", {},
            a.bonus ? inline("Bonus", a.bonus) : null,
            a.equity ? inline("Equity", a.equity) : null) : null)
        : null,
      a.comp ? h("p.muted.small.app-pay-notes", {}, a.comp) : null,
      h("dl.app-inlines.app-more", {},
        inline("Posting", a.url ? link(a.url) : null),
        inline("Source", a.source),
        s.process ? inline("Applied", s.process.applied_on ? fmtDay(s.process.applied_on) : null) : null,
        a.posted_on ? inline("Posted", fmtDay(a.posted_on)) : null,
        a.closes_on ? inline("Closes", fmtDay(a.closes_on)) : null));
  }

  /** The timeline: interview steps and what happened, in date order. */
  function timeline() {
    if (!s.process) return section("timeline", "Timeline", {}, h("p.muted.small", {}, "Put it on the board to track its steps."));
    const statuses = optionsOf("steps", "status");
    const steps = edit ? draft.steps : s.detail?.steps || [];
    const events = edit ? draft.events : (s.detail?.notes || []).map((n) => ({ ...n, happened_on: n.happened_on || n.created_at.slice(0, 10) }));
    // Undated rows (new steps) go last.
    const items = [
      ...steps.map((st, i) => ({ kind: "step", when: st.at || "~", st, i })),
      ...events.map((ev, i) => ({ kind: "event", when: ev.happened_on || "~", ev, i })),
    ].sort((x, y) => x.when.localeCompare(y.when));
    const action = [
      addButton("Add a step", addRow(() => {
        draft.steps.push({ id: null, title: null, at: null, status: "scheduled", format: null, attendees: null, note: null, people: [], fresh: true });
      }, ".app-timeline .fresh input")),
      addButton("Add an event", addRow(() => {
        draft.events.push({ id: null, body: null, happened_on: isoToday(), fresh: true });
      }, ".app-timeline .fresh input[type=text]")),
    ];
    const stepRow = ({ st, i }) => h("li", { class: `is-${st.status}${st.fresh ? " fresh" : ""}`, dataset: { step: i } },
      h("span.dot", { "aria-hidden": "true" }),
      edit
        ? h("div.app-step-edit", {},
          h("div.app-row", {}, input(st, "title", { placeholder: "A step, e.g. Recruiter screen", "aria-label": "Step" }),
            removeButton("Remove step", () => { draft.steps.splice(i, 1); render(); })),
          h("div.app-grid", {},
            input(st, "at", { type: "datetime-local", step: 900, "aria-label": "When" }),
            select(st, "status", statuses, { empty: null, label: "Status" }),
            input(st, "format", { placeholder: "Format: video call, on-site…", "aria-label": "Format" })),
          stepPeople(st, i),
          input(st, "note", { multiline: true, rows: 2, placeholder: "Prep, questions asked, feedback…", "aria-label": "Notes" }))
        : h("div", {},
          h("div.app-step-head", {}, h("h3", {}, st.title || "Untitled step"),
            h("span.muted.small", {}, st.at ? fmtStamp(st.at) : "No date")),
          h("p.muted.small", {}, [optionLabel(statuses, st.status), st.format].filter(Boolean).join(" · "),
            st.people?.length
              ? [" · with ", st.people.map((pe, j) => [j ? ", " : "", h("a", { href: `/people/${pe.id}` }, pe.name)])]
              : st.attendees ? ` · with ${st.attendees}` : null),
          st.note ? h("p.app-step-note", {}, st.note) : null));
    const eventRow = ({ ev, i }) => h("li", { class: `is-event${ev.fresh ? " fresh" : ""}` },
      h("span.dot", { "aria-hidden": "true" }),
      edit
        ? h("div.app-event-edit", {}, input(ev, "happened_on", { type: "date", "aria-label": "When" }),
          input(ev, "body", { placeholder: "What happened", "aria-label": "What happened" }),
          removeButton("Remove event", () => { draft.events.splice(i, 1); render(); }))
        : h("div.app-event", {}, h("span.app-event-body", { translate: "no" }, ev.body), h("time.muted.small", { datetime: ev.happened_on }, fmtDay(ev.happened_on))));
    return section("timeline", "Timeline", { count: items.length, action },
      items.length ? h("ol.app-steps.app-timeline", {}, items.map((it) => (it.kind === "step" ? stepRow(it) : eventRow(it))))
        : h("p.muted.small", {}, "No steps or events yet."));
  }

  /** Who a step is with: people from People, or new names, made on Save. */
  function stepPeople(st, i) {
    const refocus = () => page.querySelector(`.app-timeline [data-step="${i}"] .app-with input`)?.focus();
    const people = refSource("people");
    const box = combo({
      label: "With whom", placeholder: st.people.length ? "Add someone else…" : "With whom: someone from People, or a new name",
      allowCreate: true,
      source: async (q) => (await people(q)).filter((it) => !st.people.some((p) => p.id === it.value)),
      onPick: (it) => {
        if (it.create) {
          if (!st.people.some((p) => p.id == null && p.name.toLowerCase() === it.value.toLowerCase())) st.people.push({ id: null, name: it.value });
        } else {
          st.people.push({ id: it.value, name: it.label.replace(/ \([^)]*\)$/, "") });
        }
        render();
        refocus();
      },
    });
    return h("div.app-with", {},
      h("span.app-with-label", {}, "With"),
      st.people.map((p, j) => h("span.al-tag", { title: p.id == null ? "Added to People when you save" : null }, p.name, p.id == null ? " (new)" : "",
        h("button.al-tag__remove", { type: "button", "aria-label": `Remove ${p.name}`, onclick: () => { st.people.splice(j, 1); render(); refocus(); } }, "×"))),
      box,
      st.attendees ? h("p.muted.small.app-with-before", {}, `Written before: “${st.attendees}” `,
        h("button.al-button.al-button--sm.al-button--quiet", { type: "button", onclick: () => { st.attendees = null; render(); } }, "Clear")) : null);
  }

  function notes() {
    const action = addButton("Add a note", addRow(() => {}, 'textarea[aria-label="Your notes"]'));
    return section("notes", "Notes", { action }, edit
      ? input(draft.app, "note", { multiline: true, rows: 6, placeholder: "Your private notes on this application", "aria-label": "Your notes" })
      : s.app.note ? h("p.app-notes", {}, s.app.note) : h("p.muted.small", {}, "No notes."));
  }

  function emails() {
    if (!s.process) return null;
    const list = s.detail.emails || [];
    const add = async (items) => {
      const added = await attempt(async () => {
        const out = [];
        for (const [name, body] of items) {
          const res = await fetch(`/api/processes/${s.process.id}/emails`, { method: "POST", headers: { "Content-Type": "message/rfc822" }, body });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(`${name}: ${data.error || res.statusText}`);
          out.push(data.subject);
        }
        return out;
      });
      if (added) { opened.delete("emails"); toast(`Added ${added.map((x) => `“${x}”`).join(", ")}`); refreshDetail(); }
      return !!added;
    };

    // Adding: a file (dropped or chosen), or the message's text pasted.
    let panel = null;
    if (showForm("emails")) {
      const box = h("textarea", { rows: 5, placeholder: "…or paste the message's original text here", "aria-label": "The email's original text" });
      const picker = h("input", { type: "file", accept: ".eml,message/rfc822", multiple: true, hidden: true,
        onchange: () => { if (picker.files.length) add([...picker.files].map((f) => [f.name, f])); } });
      panel = h("form.email-add", { onsubmit: async (e) => {
        e.preventDefault();
        if (!box.value.trim()) { toast("Paste the message first, or choose a file", "error"); box.focus(); return; }
        await add([["the pasted email", box.value]]);
      } },
      h("div.email-add-ways", {},
        picker,
        h("button.al-button", { type: "button", onclick: () => picker.click() }, "Drop or choose an .eml file"),
        h("span.muted.small", {}, "or"),
        h("button.al-button", { type: "button", onclick: async () => {
          try { box.value = await navigator.clipboard.readText(); } catch { /* the browser asks; fall back to typing */ }
          box.focus();
          if (!box.value) toast("Paste it into the box (⌘V)");
        } }, "Paste it")),
      box,
      h("div.actions", {},
        h("button.al-button", { type: "button", onclick: () => { box.value = ""; if (!edit) toggle("emails"); } }, "Cancel"),
        h("button.al-button.al-button--primary", { type: "submit" }, "Add email")));
      acceptDrop(panel, (files) => add(files.map((f) => [f.name, f])));
    }

    // Threads, newest first; each folded until opened.
    const threads = new Map();
    for (const m of [...list].sort((x, y) => x.sent_at.localeCompare(y.sent_at))) {
      const k = threadKey(m);
      if (!threads.has(k)) threads.set(k, []);
      threads.get(k).push(m);
    }
    const ordered = [...threads.values()].sort((x, y) => y.at(-1).sent_at.localeCompare(x.at(-1).sent_at));
    const who = (m) => (m.outgoing ? "You" : m.from_name || m.from_addr || "Unknown");
    const message = (m) => {
      const text = h("div.email-text", {}, h("span.muted.small", {}, "Loading…"));
      const art = h("article.email-msg", {},
        h("header", {}, h("b", {}, who(m)),
          h("span.muted.small", {}, m.to_addrs ? ` to ${m.to_addrs}` : ""),
          h("time.muted.small", { datetime: m.sent_at, title: m.sent_at.replace("T", " ") }, fmtStamp(m.sent_at))),
        text,
        h("div.app-email-tools", {},
          m.gmail_url ? h("a.small-button.button", { href: m.gmail_url, target: "_blank", rel: "noreferrer" }, "Open in Gmail ↗") : null,
          edit ? h("button.al-button.al-button--sm.al-button--quiet.al-button--danger", { type: "button", onclick: async () => {
            if (!(await confirmDelete(`email “${m.subject || "(no subject)"}”`))) return;
            if (await attempt(() => del(`emails/${m.id}`))) { toast("Removed"); refreshDetail(); }
          } }, "Remove") : null));
      art.load = async () => {
        if (art.dataset.loaded) return;
        const full = await attempt(() => get(`emails/${m.id}`));
        if (!full) return;
        art.dataset.loaded = "1";
        fill(text, full.body ? formatEmail(full.body) : h("span.muted", {}, "(no text)"));
      };
      return art;
    };
    const thread = (msgs) => {
      const last = msgs.at(-1);
      const people = [...new Set(msgs.map(who))];
      const arts = msgs.map(message);
      const d = h("details.email-thread", { ontoggle: () => { if (d.open) arts.forEach((a) => a.load()); } },
        h("summary", {},
          h("span.app-email-icon", { "aria-hidden": "true" }, "✉"),
          h("span.app-email-what", {}, h("b", {}, msgs[0].subject || "(no subject)"),
            h("span.muted.small", {}, people.join(", "), msgs.length > 1 ? ` · ${msgs.length} messages` : "")),
          h("time.muted.small", { datetime: last.sent_at }, fmtStamp(last.sent_at))),
        h("div.email-thread-body", {}, arts));
      return h("li", {}, d);
    };
    return section("emails", "Emails", { count: list.length, action: formButton("emails", "Add an email") },
      panel,
      ordered.length ? h("ul.app-emails", {}, ordered.map(thread)) : h("p.muted.small", {}, "No emails saved."));
  }

  // Read like an email: where it's from, the text in its own box, and a
  // way back to the original.
  // Postings read like emails: where each is from, its text in its own
  // box, and ways back to it. The application's own link comes first.
  function posting() {
    const a = s.app;
    const links = postingLinks();
    const count = links.length || (a.description ? 1 : 0);
    const card = (l) => {
      const main = l.key === "main";
      const p = main ? null : s.postings.find((x) => x.id === l.key);
      const when = main
        ? [a.posted_on ? `Posted ${fmtDay(a.posted_on)}` : null, a.closes_on ? `closes ${fmtDay(a.closes_on)}` : null].filter(Boolean).join(", ")
        : p.read_at ? `Read ${fmtStamp(p.read_at)}` : "";
      const where = main ? a.title || "The posting" : p.platform && p.platform !== "the page" ? p.platform : hostOf(l.url);
      return h("article.email-msg.app-posting", { dataset: { posting: String(l.key) } },
        h("header", {}, h("b", {}, where),
          l.url && (main || where !== hostOf(l.url)) ? h("span.muted.small", {}, ` from ${hostOf(l.url)}`) : null,
          main && links.length > 1 ? h("span.al-badge.al-badge--outline", { title: "The application's own link" }, "main") : null,
          when ? h("span.muted.small.posting-when", {}, when) : null),
        l.text ? h("div.email-text.posting-text", {}, formatPosting(l.text))
          : h("p.muted.small", {}, l.url ? "No text yet: Refresh reads it." : "No text."),
        h("div.app-email-tools", {},
          l.url ? h("a.small-button.button", { href: l.url, target: "_blank", rel: "noreferrer" }, "Open ↗") : null,
          l.url && !edit ? h("button.al-button.al-button--sm", { type: "button", onclick: () => readPostings([l]) }, "Refresh") : null,
          !main && !edit ? h("button.al-button.al-button--sm.al-button--quiet.al-button--danger", { type: "button", onclick: async () => {
            if (!(await confirmDelete(`posting ${hostOf(l.url)}`))) return;
            if (await attempt(() => del(`postings/${l.key}`))) { toast("Removed"); reload(); }
          } }, "Remove") : null));
    };
    const box = h("input", { type: "url", placeholder: "https://…", "aria-label": "Posting link", required: true });
    const adding = !edit && opened.has("posting-add")
      ? h("form.inline-add.posting-add", { onsubmit: (e) => { e.preventDefault(); if (box.value.trim()) addPostingLink(box.value.trim()); } },
        box, h("button.al-button.al-button--primary", { type: "submit" }, "Add and read"))
      : null;
    if (adding) setTimeout(() => box.focus(), 0);
    const action = edit ? null : [
      links.length > 1 ? h("button.al-button.al-button--quiet.app-add", { type: "button", onclick: () => readPostings() }, "Refresh all") : null,
      formButton("posting-add", "Add a posting link")];
    const body = edit
      ? [input(draft.app, "description", { multiline: true, rows: 14, placeholder: "Paste the job description", "aria-label": "Posting text" }),
        s.postings.map((p) => card({ key: p.id, url: p.url, text: p.description }))]
      : [adding, count ? [a.url || a.description ? card({ key: "main", url: a.url, text: a.description }) : null,
        s.postings.map((p) => card({ key: p.id, url: p.url, text: p.description }))] : h("p.muted.small", {}, "No posting yet: add its link, and hunt reads it.")];
    return section("posting", "About the job", { count: count > 1 ? count : null, action }, body);
  }

  function company() {
    const c = s.company;
    return section("company", "Company", {}, edit
      ? h("div.app-grid", {},
        labeled("Website", input(draft.company, "website", { type: "url", placeholder: "https://acme.com" })),
        labeled("Industry", input(draft.company, "industry", { placeholder: "e.g. Software" })),
        labeled("Size", input(draft.company, "size", { placeholder: "e.g. 1,000+ employees" })),
        h("label.app-field.wide", {}, h("span", {}, "About"), input(draft.company, "description", { multiline: true, rows: 4, placeholder: "Culture, team, research…", "aria-label": "About" })))
      : h("dl.facts", {},
        h("dt", {}, "Website"), h("dd", {}, c.website ? link(c.website) : h("span.muted", {}, "—")),
        h("dt", {}, "Industry"), h("dd", {}, c.industry || h("span.muted", {}, "—")),
        h("dt", {}, "Size"), h("dd", {}, c.size || h("span.muted", {}, "—")),
        c.headquarters ? [h("dt", {}, "Based in"), h("dd", {}, c.headquarters)] : null,
        h("dt", {}, "About"), h("dd", {}, c.description ? h("div.prose.small", {}, c.description) : h("span.muted", {}, "—"))),
    h("p.small", {}, h("a", { href: `/companies/${edit ? draft.app.company_id : c.id}` }, "The company's page →")));
  }

  // People on the process, and files sent with it: these act at once.
  function people() {
    const p = s.process;
    const list = s.detail.people || [];
    const roles = META.person_roles.map((r) => [r.value, r.label]);
    const after = (fresh) => { if (fresh) { s.detail.people = fresh; render(); } };
    let form = null;
    if (showForm("people")) {
      let chosen = null;
      const who = combo({ label: "Person", placeholder: "Name, or a LinkedIn profile link", source: refSource("people"), allowCreate: true,
        onPick: (it) => { chosen = it; }, onInput: () => { chosen = null; } });
      const role = h("select", { "aria-label": "Role" }, h("option", { value: "" }, "Role…"), roles.map(([v, l]) => h("option", { value: v }, l)));
      form = h("form.person-add", { onsubmit: async (e) => {
        e.preventDefault();
        const name = who.input.value.trim();
        if (!name) return;
        let body = chosen && !chosen.create ? { person_id: chosen.value } : { name };
        // A profile link: read it, and add who it's about.
        if (looksLikeProfile(name)) {
          toast("Reading the profile…");
          const found = await attempt(() => post("people/lookup", { url: name }));
          const person = found && await attempt(() => personFromProfile(found));
          if (!person) return;
          body = { person_id: person.id };
        }
        body.role = role.value || null;
        opened.delete("people");
        after(await attempt(() => post(`processes/${p.id}/people`, body)));
      } }, who, role, h("button.al-button", { type: "submit" }, "Add"));
    }
    return holder("people", "People", { count: list.length, action: formButton("people", "Add a person") },
      list.length ? h("ul.app-people", {}, list.map((pe) => h("li", {},
        h("span.with-logo", {}, photoOf(pe.id, pe.photo, pe.name, 28), h("a", { href: `/people/${pe.id}` }, pe.name)),
        edit
          ? [h("select", { "aria-label": `${pe.name}'s role`, onchange: async (e) => after(await attempt(() => patch(`processes/${p.id}/people/${pe.id}`, { role: e.target.value || null }))) },
            h("option", { value: "" }, "Role…"), roles.map(([v, l]) => h("option", { value: v, selected: v === pe.role }, l))),
          removeButton(`Take ${pe.name} off`, async () => after(await attempt(() => del(`processes/${p.id}/people/${pe.id}`))))]
          : [h("span.muted.small", {}, [pe.role ? optionLabel(roles, pe.role) : null, pe.title].filter(Boolean).join(" · ")),
            // Their email and phone, a click away.
            pe.email || pe.phone ? h("span.app-contact", {},
              pe.email ? h("a", { href: `mailto:${pe.email}`, title: `Email ${pe.name}` }, icon("mail"), pe.email) : null,
              pe.phone ? h("a", { href: `tel:${pe.phone.replace(/[^\d+]/g, "")}`, title: `Call ${pe.name}` }, icon("phone"), pe.phone) : null) : null])))
        : h("p.muted.small", {}, "Nobody yet."),
      form);
  }

  function files() {
    const p = s.process;
    const list = s.detail.files || [];
    const after = (fresh) => { if (fresh) { s.detail.files = fresh; render(); } };
    let form = null;
    if (showForm("files")) {
      let chosen = null;
      const which = combo({ label: "File", placeholder: "Search files, e.g. resume", source: refSource("versions"),
        onPick: (it) => { chosen = it; }, onInput: () => { chosen = null; } });
      form = h("form.file-add", { onsubmit: async (e) => {
        e.preventDefault();
        if (!chosen) { toast("Pick a version from the list", "error"); return; }
        opened.delete("files");
        after(await attempt(() => post(`processes/${p.id}/files`, { version_id: chosen.value })));
      } }, which, h("button.al-button", { type: "submit" }, "Add"));
    }
    return holder("files", "Files sent", { count: list.length, action: formButton("files", "Send a file") },
      list.length ? h("ul.files", {}, list.map((f) => h("li", {},
        h("a", { href: `/files/${f.document_id}?version=${f.id}` }, f.label),
        h("span.muted", {}, ` ${f.filename}`),
        edit ? removeButton(`Take ${f.label} off`, async () => after(await attempt(() => del(`processes/${p.id}/files/${f.id}`)))) : null)))
        : h("p.muted.small", {}, "None recorded."),
      form,
      showForm("files") ? h("p.muted.small", {}, "Upload new versions under ", h("a", { href: "/files" }, "Files"), ".") : null);
  }

  /** The end of the page: tags, other processes, and what's done to the
   * whole application. */
  function footer() {
    const p = s.process;
    const rest = s.procs.filter((x) => x.id !== p?.id);
    const tags = edit
      ? (() => {
        const add = h("input.tag-input", { "aria-label": "Add a tag", placeholder: "Add a tag…" });
        const addTag = () => {
          const t = add.value.trim();
          if (t && !draft.tags.some((x) => x.toLowerCase() === t.toLowerCase())) draft.tags.push(t);
          add.value = "";
          render();
          page.querySelector(".tag-input")?.focus();
        };
        add.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); } });
        add.addEventListener("blur", () => { if (add.value.trim()) addTag(); });
        return [draft.tags.map((t) => tagChip(t, h("button.al-tag__remove", { type: "button", "aria-label": `Remove tag ${t}`,
          onclick: () => { draft.tags = draft.tags.filter((x) => x !== t); render(); } }, "×"))), add];
      })()
      : [tagNames(s.app.tags).map((t) => colourTagChip(t)),
        opened.has("tag")
          ? (() => {
            const add = h("input.tag-input", { "aria-label": "New tag", placeholder: "A tag, then Enter" });
            add.addEventListener("keydown", async (e) => {
              if (e.key === "Escape") { opened.delete("tag"); render(); return; }
              if (e.key !== "Enter" || !add.value.trim()) return;
              e.preventDefault();
              const saved = await attempt(() => put(`applications/${id}/tags`, { tags: [...tagNames(s.app.tags), add.value.trim()] }));
              if (saved) { s.app.tags = saved; orig.tags = saved; opened.delete("tag"); TAGS = await get("tags"); render(); }
            });
            setTimeout(() => add.focus(), 0);
            return add;
          })()
          : h("button.al-button.al-button--quiet.app-add", { type: "button", onclick: () => toggle("tag") }, "+ Add tag")];
    return h("section.app-section.app-footer", {},
      h("div.app-tags", {}, h("span.eyebrow", {}, "Tags"), tags),
      rest.length ? h("div.app-others", {}, h("span.eyebrow", {}, "Other processes"),
        rest.map((x, i) => [i ? ", " : "", h("a", { href: `/applications/${id}?process=${x.id}` }, `#${x.id}`),
          ` (${x.status === "archived" ? "closed" : "active"}, added ${fmtDay(x.created_at.slice(0, 10))})`])) : null,
      edit ? null : h("div.actions", {},
        h("button.al-button", { type: "button", onclick: () => readPostings() }, "Import from link…"),
        // At its offer: accept it, wrap up the rest, and celebrate.
        atOffer(p, s.stages) && !s.lanes.some((l) => l.id === p.lane_id && isAcceptedLane(l)) ? h("button.al-button.al-button--primary", { type: "button", onclick: () => acceptOffer(p, s.company.name, s.app.title) }, "🎉 Accept the offer…") : null,
        p && p.status === "active" ? h("button.al-button", { type: "button", onclick: async () => {
          const body = await askArchive(`${s.company.name}${s.app.title ? ` — ${s.app.title}` : ""}`);
          if (body && await attempt(() => patch(`processes/${p.id}`, body))) { toast("Closed"); reload(); }
        } }, "Close…") : null,
        h("span.spacer"),
        h("button.al-button.al-button--quiet.al-button--danger", { type: "button", onclick: async () => {
          if (!(await confirmDelete(`application ${s.app.label}`, "Its processes on the board go with it."))) return;
          if (await attempt(() => del(`applications/${id}`))) { leaveGuard = null; toast("Deleted"); go("/applications"); }
        } }, "Delete application")));
  }

  async function refreshDetail() {
    if (!s.process) return;
    s.detail = await get(`processes/${s.process.id}/detail`);
    render();
  }
  const liveParts = () => (s.process ? [people(), emails(), files()] : []);

  // ---- saving ----

  const changed = (a, b, keys) => Object.fromEntries(keys.filter((k) => (a[k] ?? null) !== (b[k] ?? null)).map((k) => [k, a[k] ?? null]));

  async function save() {
    const button = page.querySelector(".app-mode .al-button--primary");
    if (isBusy(button)) return;
    busy(button);
    const done = await attempt(async () => {
      const fields = changed(draft.app, orig.app, APP_KEYS);
      if (Object.keys(fields).length) {
        Object.assign(orig.app, pickKeys(await patch(`applications/${id}`, fields), APP_KEYS));
        if ("url" in fields) warnIfSamePosting({ ...s.app, url: fields.url });
      }
      const cfields = changed(draft.company, orig.company, COMPANY_KEYS);
      if (Object.keys(cfields).length) {
        Object.assign(orig.company, pickKeys(await patch(`companies/${draft.app.company_id}`, cfields), COMPANY_KEYS));
      }
      if (JSON.stringify(draft.tags) !== JSON.stringify(orig.tags)) {
        orig.tags = await put(`applications/${id}/tags`, { tags: draft.tags });
      }
      if (s.process) {
        const pid = s.process.id;
        if (draft.process.stage_id !== orig.process.stage_id || (s.process.status === "archived" && draft.process.stage_id !== orig.process.stage_id)) {
          await post(`processes/${pid}/move`, { stage_id: draft.process.stage_id });
          orig.process.stage_id = draft.process.stage_id;
        }
        const pfields = changed(draft.process, orig.process, ["applied_on"]);
        if (Object.keys(pfields).length) {
          Object.assign(orig.process, pickKeys(await patch(`processes/${pid}`, pfields), PROCESS_KEYS));
        }
        const before = new Map(orig.steps.map((x) => [x.id, (x.people || []).map((p) => p.id).sort().join(",")]));
        await saveList("steps", draft.steps, orig.steps, STEP_KEYS, (x) => !x.title, { process_id: pid });
        // Who each step is with: new names become people, at this company.
        for (const st of draft.steps) {
          if (st.id == null) continue;
          for (const p of st.people) {
            if (p.id == null) p.id = (await post("people", { name: p.name, company_id: draft.app.company_id })).id;
          }
          const ids = st.people.map((p) => p.id);
          if (ids.slice().sort().join(",") !== (before.get(st.id) || "")) {
            await put(`steps/${st.id}/people`, { person_ids: ids });
            before.set(st.id, ids.slice().sort().join(","));
          }
        }
        await saveList("notes", draft.events, orig.events, EVENT_KEYS, (x) => !x.body, { process_id: pid });
      }
      return true;
    });
    busy(button, false);
    if (done) {
      toast("Saved");
      leaveGuard = null;
      // A new posting link is read, as Refresh does.
      const link = draft.app.url && draft.app.url !== s.app.url ? draft.app.url : null;
      await reload({ readLink: link });
    }
  }

  /** Save a list's rows: new ones made, changed ones updated, gone ones
   * deleted. `blank(row)`: a new row left empty is skipped. */
  async function saveList(resource, rows, before, keys, blank, extra) {
    for (const old of [...before]) {
      if (!rows.some((r) => r.id === old.id)) {
        await del(`${resource}/${old.id}`);
        before.splice(before.indexOf(old), 1);
      }
    }
    for (const row of rows) {
      if (row.id == null) {
        if (blank(row)) continue;
        const made = await post(resource, { ...extra, ...pickKeys(row, keys) });
        row.id = made.id;
        before.push({ ...row });
        continue;
      }
      const old = before.find((b) => b.id === row.id);
      const fields = changed(row, old, keys);
      if (Object.keys(fields).length) {
        await patch(`${resource}/${row.id}`, fields);
        Object.assign(old, fields);
      }
    }
  }

  // ---- the page as it reads: what's next, the timeline, and the facts beside ----

  const ended = () => !!cycleById(s.process?.cycle_id)?.ended_on;
  const saveState = h("span.al-save-state", { role: "status" });
  /** A quick change, with the save state saying so. */
  async function saving(fn) {
    saveState.dataset.state = "saving";
    saveState.textContent = "Saving…";
    const r = await attempt(fn);
    if (r) { saveState.dataset.state = "saved"; saveState.textContent = "Saved"; } else { delete saveState.dataset.state; saveState.textContent = ""; }
    return r;
  }
  const panel = (key, title, { count, action } = {}, ...body) => h("section.al-panel.app-panel", { dataset: { section: key }, "aria-labelledby": `panel-${key}` },
    h("div.app-panel-head", {}, h("h2", { id: `panel-${key}` }, title), count != null ? h("span.al-badge.al-badge--count", {}, count) : null,
      action ? h("div.app-panel-tools", {}, action) : null),
    body);
  /** People and files: a section of the form, being edited; a panel beside, being read. */
  const holder = (...args) => (edit ? section(...args) : panel(...args));
  const stageName = (id) => s.allStages.find((st) => st.id === id)?.name || "—";
  const dayAfter = (at) => {
    const base = at && at.slice(0, 10) > isoToday() ? parseLocal(at) : parseLocal(isoToday());
    base.setDate(base.getDate() + 1);
    const d = base.toLocaleDateString("en-CA");
    return at && at.length > 10 ? `${d}${at.slice(10)}` : d;
  };

  async function archiveIt() {
    const p = s.process;
    const body = await askArchive(s.company.name, stageName(p.stage_id));
    if (!body) return;
    if (await attempt(() => patch(`processes/${p.id}`, body))) {
      toast(`Closed ${s.company.name}: ${closingLabel(body).toLowerCase()}`, "info", { label: "Undo", onclick: async () => {
        if (await attempt(() => post(`processes/${p.id}/move`, { stage_id: p.stage_id, lane_id: p.lane_id ?? null }))) { toast("Back on the board"); reload(); }
      } });
      go("/");
    }
  }

  function pageHead() {
    const a = s.app, c = s.company, p = s.process;
    const mode = a.work_mode ? optionLabel(optionsOf("applications", "work_mode"), a.work_mode) : null;
    const run = runningCycles();
    const cycle = p && run.length > 1 && !ended()
      ? h("select.app-cycle", { "aria-label": "Cycle", title: "Cycle", translate: "no", onchange: async (e) => {
        const to = Number(e.target.value), before = p.cycle_id;
        if (!(await saving(() => patch(`processes/${p.id}`, { cycle_id: to })))) return;
        p.cycle_id = to;
        await loadCycles();
        toast(`Moved to ${cycleById(to).name}`, "info", { label: "Undo", onclick: async () => {
          if (await attempt(() => patch(`processes/${p.id}`, { cycle_id: before }))) { await loadCycles(); reload(); }
        } });
      } }, run.map((cy) => h("option", { value: cy.id, selected: cy.id === p.cycle_id }, cy.name)))
      : null;
    const where = [mode, a.location].filter(Boolean).join(", ");
    return h("header.al-page-head.app-page-head", {},
      logoOf(c.id, c.logo, c.name, 48),
      h("div.app-titles", {},
        h("h1", { id: "app-title", translate: "no" }, a.title || c.name),
        h("div.app-sub", {}, h("a", { href: `/companies/${c.id}`, translate: "no" }, c.name),
          where ? [h("span", { "aria-hidden": "true" }, "·"), h("span", {}, where)] : null)),
      h("div.al-page-head__end", {},
        cycle, saveState,
        ended() ? null : h("button.al-button.al-button--quiet", { type: "button", onclick: () => setEdit(true) }, icon("edit"), h("span", {}, "Edit details")),
        atOffer(p, s.stages) && !s.lanes.some((l) => l.id === p.lane_id && isAcceptedLane(l)) && !ended() ? h("button.al-button", { type: "button", onclick: () => acceptOffer(p, s.company.name, s.app.title) }, "Accept the offer…") : null,
        p && p.status === "active" && !ended() ? h("button.al-button", { type: "button", onclick: archiveIt }, icon("archive"), h("span", {}, "Close")) : null,
        p && !ended() ? h("button.al-button.al-button--primary", { type: "button", onclick: () => openComposer("step") },
          icon("plus"), h("span", {}, "Log a step")) : null));
  }

  /** Its stage, as a row of the board's stages to move it along; its lane; or why it's archived. */
  function stageBar() {
    const p = s.process;
    if (!p) return standing();
    const archived = p.status === "archived";
    // Closed, it's in an inactive stage: the row shows the one it reached.
    const at = s.stages.findIndex((st) => st.id === (archived ? p.reached_stage_id : p.stage_id));
    const lanes = s.lanes.filter((l) => l.stage_id === p.stage_id);
    const moveTo = async (st, lane = null) => {
      if (st.id === p.stage_id && !archived && (lane ?? null) === (p.lane_id ?? null)) return;
      const before = { stage_id: p.stage_id, lane_id: p.lane_id ?? null };
      if (!(await saving(() => post(`processes/${p.id}/move`, { stage_id: st.id, lane_id: lane })))) return;
      toast(archived ? `Back on the board, in ${st.name}` : `Moved ${s.company.name} from ${stageName(before.stage_id)} to ${st.name}`, "info", { label: "Undo", onclick: async () => {
        if (await attempt(() => post(`processes/${p.id}/move`, before))) reload();
      } });
      reload();
    };
    return h("div.app-standing", {},
      archived ? notice("info", {},
        h("div.al-notice__title", {}, "Closed: ", closedWhy(p, stageName(p.stage_id))),
        p.archive_note ? h("div.small", { translate: "no" }, p.archive_note) : null,
        p.reached_stage_id ? h("div.small", {}, `Got to ${stageName(p.reached_stage_id)}`) : null,
        ended() ? null : h("div.al-notice__actions", {}, h("button.al-button.al-button--sm", { type: "button", onclick: () => moveTo(s.stages[Math.max(at, 0)]) }, "Back on the board"))) : null,
      ended() ? notice("info", {}, h("div.al-notice__title", {}, `${cycleById(p.cycle_id).name} has ended`),
        h("div.small", {}, "This application is kept as it was then.")) : null,
      h("ol.app-stages", { "aria-label": "Stage", style: `--stages: ${s.stages.length}`, class: archived ? "archived" : "" },
        s.stages.map((st, i) => h("li", {}, h("button", { type: "button", "aria-current": i === at ? "step" : null, class: i <= at ? "reached" : "",
          disabled: ended() || null, onclick: () => moveTo(st) }, h("span.stage-no", {}, i + 1), " ", st.name)))),
      lanes.length && !archived ? h("div.lane-pick", {}, h("span.muted.small", {}, `In ${stageName(p.stage_id)}:`),
        h("div.al-segmented", { role: "group", "aria-label": "Sub stage" },
          [{ id: null, name: "No sub stage" }, ...lanes].map((l) => h("button", { type: "button", "aria-pressed": String((p.lane_id ?? null) === l.id),
            disabled: ended() || null, onclick: () => moveTo(s.stages[at], l.id) }, l.name)))) : null);
  }

  const steps = () => s.detail?.steps || [];
  const isUrl = (v) => /^(https?:\/\/|[\w-]+\.[\w.-]+\/)/i.test(v || "");
  const hrefOf = (v) => (/^https?:/i.test(v) ? v : `https://${v}`);
  const minutesText = (n) => (n ? (n >= 240 ? "Half a day" : n % 60 === 0 && n >= 60 ? `${n / 60} hr` : `${n} min`) : null);
  const withWhom = (st) => (st.people?.length || st.attendees
    ? h("span", {}, h("span", {}, "with"), " ", h("span", { translate: "no" }, st.people?.length ? st.people.map((pe) => pe.name).join(", ") : st.attendees)) : null);

  /** What's coming: scheduled steps, and reminders not yet done. */
  function upNext() {
    const sched = steps().filter((st) => st.status === "scheduled").sort((a, b) => (a.at || "9").localeCompare(b.at || "9"));
    const rems = s.reminders.filter((r) => !r.done_at).sort((a, b) => (a.due_at || "9").localeCompare(b.due_at || "9"));
    const stepItem = (st) => h("li.upnext-item", {},
      h("span.upnext-icon.is-step", {}, icon("cal")),
      h("div.upnext-what", {}, h("span", { translate: "no" }, st.title),
        h("span.upnext-due", {}, dotted([st.at ? fmtStamp(st.at) : "Date not set", st.format, minutesText(st.minutes), withWhom(st)]))),
      h("div.upnext-tools", {}, isUrl(st.place) ? h("a.al-button.al-button--sm", { href: hrefOf(st.place), target: "_blank", rel: "noreferrer", title: st.place }, "Join") : null));
    const remItem = (r) => {
      const late = isOverdue(r.due_at);
      return h("li.upnext-item", {},
        h("span.upnext-icon", { class: late ? "is-late" : "" }, icon("bell")),
        h("div.upnext-what", {}, h("span", { translate: "no" }, r.title),
          h("span.upnext-due", { class: late ? "is-late" : "" }, r.due_at ? (late ? `Was due ${fmtDay(r.due_at)}` : fmtDay(r.due_at)) : "No date")),
        ended() ? null : h("div.upnext-tools", {},
          h("button.al-button.al-button--quiet.al-button--sm", { type: "button", onclick: async () => {
            const before = r.due_at;
            if (await saving(() => patch(`reminders/${r.id}`, { due_at: dayAfter(r.due_at) }))) {
              toast("Snoozed until tomorrow", "info", { label: "Undo", onclick: async () => { if (await attempt(() => patch(`reminders/${r.id}`, { due_at: before }))) reload(); } });
              reload();
            }
          } }, "Snooze a day"),
          h("button.al-button.al-button--sm", { type: "button", onclick: async () => {
            if (await saving(() => patch(`reminders/${r.id}`, { done_at: localNow() }))) {
              toast(`Marked done: ${r.title}`, "info", { label: "Undo", onclick: async () => { if (await attempt(() => patch(`reminders/${r.id}`, { done_at: null }))) reload(); } });
              reload();
            }
          } }, icon("check"), h("span", {}, "Done"))));
    };
    const items = [...sched.map(stepItem), ...rems.map(remItem)];
    return panel("upnext", "Up next", { count: items.length },
      items.length ? h("ul.upnext", {}, items)
        : h("p.muted.small", {}, s.process ? "Nothing coming up. Add a reminder to follow up, or log the next interview." : "Put it on the board to track what's next."),
      s.process && !ended() ? h("div.upnext-add", {},
        h("button.al-button.al-button--quiet.al-button--sm", { type: "button", "aria-expanded": String(composer === "reminder"), onclick: () => openComposer("reminder") },
          icon("plus"), h("span", {}, "Add reminder")),
        h("button.al-button.al-button--quiet.al-button--sm", { type: "button", "aria-expanded": String(composer === "note" || composer === "step"), onclick: () => openComposer("note") },
          icon("plus"), h("span", {}, "Add an update"))) : null);
  }

  /** Open the timeline's form, to add `kind`, and take the cursor there. */
  function openComposer(kind) {
    composer = kind;
    render();
    const box = page.querySelector(".composer");
    box?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    page.querySelector("#composer")?.focus({ preventScroll: true });
  }

  /** Adding to the timeline: an update (a note, or an interview step), or a reminder. */
  function composerBox() {
    const p = s.process;
    const close = () => { composer = null; render(); };
    const kinds = composer === "reminder"
      ? h("h3.composer-title", {}, "Add a reminder")
      : h("div.al-segmented.composer-kinds", { role: "group", "aria-label": "Add" },
        [["note", "Note"], ["step", "Interview step"]].map(([k, l]) =>
          h("button", { type: "button", "aria-pressed": String(composer === k), onclick: () => { composer = k; render(); page.querySelector("#composer")?.focus(); } }, l)));
    let form;
    if (composer === "note") {
      const text = h("input", { id: "composer", placeholder: "Write a note; Enter adds it", "aria-label": "New note" });
      const add = h("button.al-button", { type: "submit" }, "Add note");
      form = h("form.composer-note", { onsubmit: async (e) => {
        e.preventDefault();
        if (!text.value.trim()) return;
        if (await saving(() => post("notes", { process_id: p.id, body: text.value.trim(), happened_on: isoToday() }))) { toast("Note added"); composer = null; refreshDetail(); }
      } }, text, add);
    } else if (composer === "step") {
      const v = { title: "", date: null, time: "", minutes: "60", format: "Video call", with: "", place: "", prep: "", remind: "hour" };
      const set = (k) => (e) => { v[k] = e.target.value; };
      const people = s.detail?.people || [];
      form = h("form.composer-form", { onsubmit: async (e) => {
        e.preventDefault();
        if (!v.title.trim()) return;
        const person = people.find((pe) => pe.name.toLowerCase() === v.with.trim().toLowerCase());
        const made = await saving(async () => {
          const st = await post("steps", { process_id: p.id, title: v.title.trim(), at: v.date ? `${v.date}T${v.time || "00:00"}` : null,
            minutes: v.minutes ? Number(v.minutes) : null, format: v.format || null, attendees: person ? null : v.with.trim() || null,
            place: v.place.trim() || null, prep_note: v.prep.trim() || null, remind: v.remind || null });
          if (person) await put(`steps/${st.id}/people`, { person_ids: [person.id] });
          return st;
        });
        if (made) { toast(`Step added${v.remind && v.date ? ` · reminder set ${v.remind === "hour" ? "an hour" : "the day"} before` : ""}`); composer = null; refreshDetail(); }
      } },
      h("div.field.composer-wide", {}, h("label", { for: "composer" }, "Step"), h("input", { id: "composer", placeholder: "e.g. Final round with the CTO", oninput: set("title") })),
      h("div.field", {}, h("label", { for: "sf-date" }, "Date"), datePicker({ id: "sf-date", value: null, onChange: (d) => { v.date = d; } })),
      h("div.field", {}, h("label", { for: "sf-time" }, "Time"), h("input", { id: "sf-time", type: "time", oninput: set("time") })),
      h("div.field", {}, h("label", { for: "sf-dur" }, "Length"), h("select", { id: "sf-dur", onchange: set("minutes") },
        [["30", "30 min"], ["45", "45 min"], ["60", "60 min"], ["90", "90 min"], ["240", "Half a day"], ["", "Not set"]].map(([m, l]) => h("option", { value: m, selected: m === v.minutes }, l)))),
      h("div.field", {}, h("label", { for: "sf-format" }, "Format"), h("select", { id: "sf-format", onchange: set("format") },
        ["Video call", "Phone", "On-site", "Take-home"].map((f) => h("option", { value: f }, f)))),
      h("div.field.composer-half", {}, h("label", { for: "sf-with" }, "With ", h("span.al-label__optional", {}, "(optional)")),
        h("input", { id: "sf-with", list: "sf-people", placeholder: "Pick from People or type a name", oninput: set("with") }),
        h("datalist", { id: "sf-people" }, people.map((pe) => h("option", { value: pe.name })))),
      h("div.field.composer-half", {}, h("label", { for: "sf-where" }, "Joining link or address ", h("span.al-label__optional", {}, "(optional)")),
        h("input", { id: "sf-where", placeholder: "meet.example/… or office address", oninput: set("place") })),
      h("div.field.composer-wide", {}, h("label", { for: "sf-prep" }, "What to prepare ", h("span.al-label__optional", {}, "(optional)")),
        h("textarea", { id: "sf-prep", rows: 2, placeholder: "Topics they mentioned, things to bring", oninput: set("prep") })),
      h("div.composer-foot", {},
        h("label.composer-remind", { for: "sf-remind" }, h("span.al-label", {}, "Remind me"),
          h("select", { id: "sf-remind", onchange: set("remind") }, [["hour", "An hour before"], ["day", "The day before"], ["", "Don't remind me"]].map(([r, l]) => h("option", { value: r }, l)))),
        h("button.al-button.al-button--primary", { type: "submit" }, "Add step")));
    } else {
      const v = { title: "", date: null, time: "" };
      const date = datePicker({ id: "rf-date", value: null, onChange: (d) => { v.date = d; } });
      const quick = (label, days) => h("button.al-button.al-button--quiet.al-button--sm", { type: "button", onclick: () => {
        const d = zonedNow(); d.setDate(d.getDate() + days);
        v.date = d.toLocaleDateString("en-CA");
        const input = date.input || date;
        input.value = parseLocal(v.date).toLocaleDateString(LOC(), { day: "2-digit", month: "2-digit", year: "numeric" });
        input.dispatchEvent(new Event("change", { bubbles: true }));
      } }, label);
      form = h("form.composer-form", { onsubmit: async (e) => {
        e.preventDefault();
        if (!v.title.trim()) return;
        const due = v.date ? (v.time ? `${v.date}T${v.time}` : v.date) : null;
        if (await saving(() => post("reminders", { process_id: p.id, title: v.title.trim(), due_at: due }))) { toast("Reminder added"); reload(); }
      } },
      h("div.field.composer-wide", {}, h("label", { for: "composer" }, "Remind me to"),
        h("input", { id: "composer", placeholder: "e.g. Ask Dana for feedback", oninput: (e) => { v.title = e.target.value; } })),
      h("div.field", {}, h("label", { for: "rf-date" }, "On"), date),
      h("div.field", {}, h("label", { for: "rf-time" }, "At ", h("span.al-label__optional", {}, "(optional)")),
        h("input", { id: "rf-time", type: "time", oninput: (e) => { v.time = e.target.value; } })),
      h("div.composer-foot", {}, h("span.al-hint", {}, "Quick:"), quick("Tomorrow", 1), quick("In 3 days", 3), quick("In a week", 7),
        h("button.al-button.al-button--primary", { type: "submit" }, "Add reminder")));
    }
    return h("div.composer", { onkeydown: (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } } },
      h("div.composer-head", {}, kinds,
        h("button.al-button.al-button--quiet.al-button--sm", { type: "button", onclick: close }, "Cancel")),
      form);
  }

  /** Everything that happened, and is to come: steps, notes, reminders done, and the moves on the board. */
  function timelinePanel() {
    if (!s.process) return null;
    const statuses = optionsOf("steps", "status");
    const notes = s.detail?.notes || [];
    const events = (s.detail?.activity || []).filter((a) => a.entity === "process" && a.entity_id === s.process.id).map((a) => {
      const ch = a.changes || {};
      let title = null;
      if (a.action === "created") title = "Added to the board";
      else if (ch.stage_id) title = `Moved from ${stageName(ch.stage_id[0])} to ${stageName(ch.stage_id[1])}`;
      else if (ch.status?.[1] === "archived") title = `Closed: ${archiveReason(ch.archive_reason?.[1])}`;
      else if (ch.status?.[1] === "active") title = "Back on the board";
      else if (ch.applied_on?.[1]) title = "Applied";
      return title && { kind: "event", at: a.at, title };
    }).filter(Boolean);
    const items = [
      ...steps().map((st) => ({ kind: "step", at: st.at || st.created_at, st })),
      ...notes.map((n) => ({ kind: "note", at: n.happened_on ? `${n.happened_on}T${n.created_at.slice(11)}` : n.created_at, n })),
      ...s.reminders.filter((r) => r.done_at).map((r) => ({ kind: "event", at: r.done_at, title: [h("span", {}, "Done:"), " ", h("span", { translate: "no" }, r.title)] })),
      ...events,
    ].sort((a, b) => (b.at || "").localeCompare(a.at || ""));
    const row = (it) => {
      if (it.kind === "step") {
        const st = it.st;
        const done = st.status !== "scheduled" && st.status !== "cancelled";
        return h("li.tl-item.tl-step", { class: done ? "done" : "" },
          h("span.tl-dot", { "aria-hidden": "true" }),
          h("div.tl-what", {}, h("span.tl-title", { translate: "no" }, st.title),
            h("span.tl-sub", {}, dotted([optionLabel(statuses, st.status), st.format, minutesText(st.minutes), withWhom(st)])),
            st.place ? (isUrl(st.place) ? h("a.al-link.tl-where", { href: hrefOf(st.place), target: "_blank", rel: "noreferrer" }, st.place) : h("span.tl-sub", {}, st.place)) : null,
            st.prep_note ? h("span.tl-prep", {}, "Prepare: ", h("span", { translate: "no" }, st.prep_note)) : null,
            st.note ? h("span.tl-note", { translate: "no" }, st.note) : null),
          h("span.tl-when", {}, st.at ? fmtStamp(st.at) : "Not set"));
      }
      if (it.kind === "note") {
        return h("li.tl-item.tl-note-item", {}, h("span.tl-dot", { "aria-hidden": "true" }),
          h("div.tl-what", {}, h("span.tl-title.tl-serif", { translate: "no" }, it.n.body)),
          h("span.tl-when", {}, fmtDay(it.n.happened_on || it.n.created_at.slice(0, 10))));
      }
      return h("li.tl-item.tl-event", {}, h("span.tl-dot", { "aria-hidden": "true" }),
        h("div.tl-what", {}, h("span.tl-title", {}, it.title)),
        h("span.tl-when", {}, fmtDay(it.at.slice(0, 10))));
    };
    return panel("timeline", "Timeline", { count: items.length },
      composer && !ended() ? composerBox() : null,
      items.length ? h("ol.tl", {}, items.map(row)) : h("p.muted.small", {}, "Nothing yet."));
  }

  /** The facts of the role, at a glance. */
  function detailsPanel() {
    const a = s.app, p = s.process;
    const o = (n, v) => (v ? optionLabel(optionsOf("applications", n), v) : null);
    const facts = [
      ["Work mode", o("work_mode", a.work_mode)], ["Employment", o("employment", a.employment)], ["Location", a.location],
      ["Source", a.source], ["Applied", p ? (p.applied_on ? fmtDay(p.applied_on) : "Not yet") : null],
      ["Posted", a.posted_on ? fmtDay(a.posted_on) : null], ["Closes", a.closes_on ? fmtDay(a.closes_on) : null],
      ["Posting", a.url ? h("a", { href: a.url, target: "_blank", rel: "noreferrer" }, hostOf(a.url)) : null],
      ["Bonus", a.bonus], ["Equity", a.equity],
    ].filter(([, v]) => v);
    return panel("details", "Details", {}, facts.length
      ? h("dl.app-facts", {}, facts.map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]))
      : h("p.muted.small", {}, "Nothing filled in yet."));
  }

  /** Its prep: how far along, and what's next. */
  function prepPanel() {
    const p = s.process;
    if (!p) return null;
    const mine = s.prep.filter((x) => x.status !== "closed");
    const done = mine.filter(isDone).length;
    const open = mine.filter((x) => !isDone(x)).sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]).slice(0, 3);
    return panel("prep", "Prep", { action: h("a.al-link.small", { href: "/prep", onclick: (e) => { e.preventDefault(); store("prep", JSON.stringify({ ...prepState(), tab: "tasks", for: String(p.id), step: "" })); go("/prep"); } }, "Open in Prep") },
      mine.length ? [
        h("span.prep-bar", { "aria-hidden": "true" }, h("span", { style: `inline-size: ${(done / mine.length) * 100}%` })),
        h("span.muted.small", {}, `${done} of ${mine.length} done`),
        open.length ? h("ul.app-prep", {}, open.map((x) => h("li", {},
          h("input", { type: "checkbox", "aria-label": `Done: ${x.title}`, disabled: ended() || null, onchange: async (e) => {
            if (await saving(() => post(`prep/${x.id}/tick`, { done: e.target.checked }))) { toast(`Done: ${x.title}`); reload(); }
          } }),
          h("span", { translate: "no" }, x.title)))) : null,
      ] : h("p.muted.small", {}, "Nothing to prepare yet."),
      ended() ? null : h("button.al-button.al-button--quiet.al-button--sm.app-panel-add", { type: "button", onclick: () => {
        store("prep", JSON.stringify({ ...prepState(), tab: "tasks", for: String(p.id), step: "" }));
        history.pushState(null, "", appPath("/prep"));
        lastUrl = here();
        showPrep({ adding: true, for: String(p.id) });
      } }, icon("plus"), h("span", {}, `Add prep for ${s.company.name}`)));
  }

  /** Links kept with it: the candidate portal, prep material, invites. */
  function linksPanel() {
    const kinds = optionsOf("links", "kind");
    const adding = opened.has("link");
    let form = null;
    if (adding) {
      const v = { url: "", label: "", kind: "portal" };
      form = h("form.app-link-form", { onsubmit: async (e) => {
        e.preventDefault();
        if (!v.url.trim()) return;
        if (await saving(() => post("links", { application_id: id, url: v.url.trim(), label: v.label.trim() || null, kind: v.kind }))) {
          opened.delete("link"); toast("Link added"); reload();
        }
      } },
      h("div.field", {}, h("label", { for: "lf-url" }, "Link"), h("input", { id: "lf-url", type: "url", placeholder: "https://", oninput: (e) => { v.url = e.target.value; } })),
      h("div.field", {}, h("label", { for: "lf-label" }, "Name ", h("span.al-label__optional", {}, "(optional)")), h("input", { id: "lf-label", placeholder: "e.g. Candidate portal", oninput: (e) => { v.label = e.target.value; } })),
      h("div.field", {}, h("label", { for: "lf-kind" }, "Kind"), h("select", { id: "lf-kind", onchange: (e) => { v.kind = e.target.value; } }, kinds.map(([k, l]) => h("option", { value: k }, l)))),
      h("button.al-button.al-button--primary.al-button--sm", { type: "submit" }, "Add link"));
      setTimeout(() => page.querySelector("#lf-url")?.focus(), 0);
    }
    return panel("links", "Links", {
      action: h("button.al-button.al-button--quiet.al-button--sm", { type: "button", "aria-expanded": String(adding), onclick: () => toggle("link") }, adding ? "Cancel" : "Add a link"),
    },
    s.links.length ? h("ul.app-links", {}, s.links.map((l) => h("li", {},
      h("div.app-link", {}, h("a", { href: l.url, target: "_blank", rel: "noreferrer", title: l.url, translate: "no" }, l.label || hostOf(l.url)),
        h("span.muted.small", {}, dotted([optionLabel(kinds, l.kind), h("span", { translate: "no" }, hostOf(l.url))]))),
      h("button.al-button.al-button--quiet.al-button--sm", { type: "button", "aria-label": `Remove ${l.label || l.url}`, onclick: async () => {
        if (!(await saving(() => del(`links/${l.id}`)))) return;
        toast("Link removed", "info", { label: "Undo", onclick: async () => {
          if (await attempt(() => post("links", { application_id: id, url: l.url, label: l.label, kind: l.kind }))) reload();
        } });
        reload();
      } }, "Remove"))))
      : adding ? null : h("p.muted.small", {}, "Keep the candidate portal, prep material and anything else you'll open again."),
    form);
  }

  /** Its tags, to add to or take off. */
  function tagsPanel() {
    return panel("tags", "Tags", {}, tagEditor("applications", s.app, (saved) => { s.app.tags = saved; orig.tags = saved; }));
  }

  function readLayout() {
    const p = s.process;
    const rest = s.procs.filter((x) => x.id !== p?.id);
    return [
      h("a.al-back-link", { href: "/" }, "Tracking board"),
      pageHead(),
      stageBar(),
      h("div.app-layout", {},
        h("div.app-main", {},
          timelinePanel(),
          posting(),
          ...(p ? [emails()] : []),
          company(),
          p ? activityPanel(s.detail.activity) : null),
        h("aside.app-aside", { "aria-label": "About this application" },
          upNext(),
          takeHomeOn() || s.app.salary_min != null || s.app.salary_max != null ? payPanel(s.app, p, s.stages, () => setEdit(true, ".app-pay-fields input")) : null,
          detailsPanel(),
          prepPanel(),
          linksPanel(),
          p ? people() : null,
          p ? files() : null,
          tagsPanel(),
          rest.length ? panel("others", "Other processes", {}, h("ul.app-links", {}, rest.map((x) => h("li", {},
            h("a", { href: `/applications/${id}?process=${x.id}` }, x.status === "archived" ? `Closed at ${stageName(x.reached_stage_id)}` : `In ${stageName(x.stage_id)}`),
            h("span.muted.small", {}, `${cycleById(x.cycle_id)?.name || ""} · added ${fmtDay(x.created_at.slice(0, 10))}`))))) : null,
          h("div.app-delete", {},
            h("button.al-button.al-button--danger.al-button--quiet.al-button--sm", { type: "button", onclick: async () => {
              if (!(await confirmDelete(`application ${s.app.label}`, "Its processes on the board go with it."))) return;
              if (await attempt(() => del(`applications/${id}`))) { leaveGuard = null; toast("Deleted"); go("/"); }
            } }, "Delete application")))),
    ];
  }

  // ---- the page ----

  function render() {
    const scroll = window.scrollY;
    page.classList.toggle("reading", !edit);
    if (!edit) {
      fill(page, readLayout());
      window.scrollTo(0, scroll);
      return;
    }
    fill(page,
      h("nav.crumbs", { "aria-label": "Back to" }, h("a", { href: "/" }, "← Tracking Board")),
      h("article.al-card.app", { class: edit ? "editing" : "" },
        head(),
        standing(),
        h("div.app-sections", {},
          role(), timeline(), notes(), posting(),
          ...liveParts(),
          company(),
          s.process ? activityPanel(s.detail.activity) : null,
          footer())));
    window.scrollTo(0, scroll);
  }

  page.addEventListener("keydown", (e) => {
    if (edit && (e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); }
  });
  fill(view, page);
  render();
  document.title = `${s.app.label} · ${BASE_TITLE}`;
  // A posting link just added: read it, as Refresh does.
  if (readLink) readPostings(postingLinks().filter((l) => l.url === readLink));
}
