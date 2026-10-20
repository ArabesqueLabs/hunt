"use strict";

// An offer accepted: marking it, wrapping up the other processes, and the
// celebration that takes the board's place on the home page.
//
// Accepting moves the process to its stage's Accepted lane: an accepted
// offer isn't an ending (references, checks and a start date may still be
// ahead), and it's closed as "I started the job" once work begins. A stage
// without that lane closes it as accepted, as before. Then the other open
// processes are wrapped up, each as chosen: closed (withdrawn), kept open
// with a reminder to tell the recruiter (the default for those that got
// far), or left as they are. From then on the home page (/) is the
// celebration, until "Back to the board" (remembered in this browser);
// /celebrate shows it again. Built on app.js.

/** The closing reason a job started (or, without an Accepted lane, an accepted offer) is filed under. */
const ACCEPTED = "accepted";

/** Whether a lane is where accepted offers wait. */
const isAcceptedLane = (l) => /^accepted$/i.test(l.name.trim());

/**
 * The most recently accepted offer's process, in a running cycle (in an
 * Accepted lane, or closed as accepted), or null. An ended cycle's offer
 * was celebrated when it was accepted, and is saved with its board.
 */
async function acceptedOffer() {
  const [closed, open, lanes, cycles] = await Promise.all([
    get(`processes?status=archived&archive_reason=${ACCEPTED}`), get("processes?status=active"), get("lanes"), get("cycles")]);
  const accepted = new Set(lanes.filter(isAcceptedLane).map((l) => l.id));
  const running = new Set(cycles.filter((c) => !c.ended_on).map((c) => c.id));
  const list = [...closed, ...open.filter((p) => accepted.has(p.lane_id))].filter((p) => running.has(p.cycle_id));
  return list.sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] || null;
}

/** Whether the home page is the celebration: an offer accepted, and not set aside for the board. */
async function celebrating() {
  const offer = await acceptedOffer();
  showOfferNav(offer);
  return offer && stored("celebrated") !== String(offer.id) ? offer : null;
}

/** The sidebar's link to the celebration, while there's an offer to celebrate. */
function showOfferNav(offer) {
  const link = document.querySelector('.sidebar a[data-nav="celebrate"]');
  if (link) link.hidden = !offer;
}

/** Whether an application's process is at its offer: the "Offer" stage, or the last. */
function atOffer(process, stages) {
  if (!process || process.status !== "active") return false;
  const at = stages.findIndex((st) => st.id === process.stage_id);
  return /offer/i.test(stages[at]?.name || "") || at === stages.length - 1;
}

/**
 * Accept the offer of `process` (at `company`, for `title`): into its
 * stage's Accepted lane (or, without one, closed as accepted), then the rest
 * wrapped up, then the celebration.
 */
async function acceptOffer(process, company, title) {
  const name = `${company}${title ? ` — ${title}` : ""}`;
  const lane = (await get(`lanes?stage_id=${process.stage_id}`)).find(isAcceptedLane);
  const data = await ask({
    title: "Accept the offer",
    body: h("div.fields", {},
      h("p", {}, lane
        ? `Accept the offer from ${name}? It moves to Accepted and stays on the board until you start; then close it as “I started the job”. Next, you choose what happens to your other processes.`
        : `Accept the offer from ${name}? It's closed as accepted; then you choose what happens to your other processes.`),
      h("div.field", {}, h("label", { for: "accept-note" }, "Note"),
        h("input", { id: "accept-note", name: "note", placeholder: "e.g. Start date 1 December" }))),
    ok: "🎉 Accept the offer",
  });
  if (!data) return false;
  const note = (data.get("note") || "").trim();
  const done = await attempt(async () => {
    if (!lane) return patch(`processes/${process.id}`, { status: "archived", archive_reason: ACCEPTED, archive_note: note || null });
    await post(`processes/${process.id}/move`, { stage_id: process.stage_id, lane_id: lane.id });
    if (note) await post("notes", { process_id: process.id, body: `Accepted the offer: ${note}`, happened_on: isoToday() });
    return true;
  });
  if (!done) return false;
  toast("Congratulations!");
  await wrapUp(process.id, company);
  go("/celebrate");
  return true;
}

/**
 * The other open processes, each to archive (withdrawn), keep open with a
 * step to tell the recruiter, or leave: those at Screening or beyond default
 * to telling the recruiter, the rest to archiving.
 */
async function wrapUp(acceptedId, company) {
  const board = await get("board");
  const stages = board.stages;
  const open = stages.flatMap((st, i) => st.cards.map((c) => ({ ...c, at: i, stageName: st.name }))).filter((c) => c.id !== acceptedId);
  if (!open.length) return;
  const withdrew = META.archive_reasons.find((r) => r.value === "withdrew")?.value || META.archive_reasons.at(-1)?.value;
  const CHOICES = [["archive", "Close it (I withdrew)"], ["reach", "Tell the recruiter first"], ["keep", "Leave it open"]];
  const rows = open.map((c) => {
    const choice = h("select", { "aria-label": `What happens to ${c.company}${c.title ? ` — ${c.title}` : ""}` },
      CHOICES.map(([v, l]) => h("option", { value: v, selected: v === (c.at >= 2 ? "reach" : "archive") }, l)));
    return { card: c, choice, row: h("tr", {},
      h("td", {}, h("span.with-logo", {}, logoOf(c.company_id, c.company_logo, c.company, 20), h("b", {}, c.company)),
        c.title ? h("span.muted.small", { translate: "no" }, ` — ${c.title}`) : null),
      h("td", {}, c.stageName),
      h("td", {}, choice)) };
  });
  const all = (v) => rows.forEach((r) => { r.choice.value = v; });
  return new Promise((resolve) => {
    const dlg = h("dialog.al-dialog.al-dialog--md.ask.import.wrap-up");
    const finish = () => { dlg.close(); resolve(); };
    dlg.append(h("div.al-dialog__inner", {},
      h("h2.al-dialog__title", {}, "Wrap up the rest"),
      h("p.muted", {}, `${open.length} other ${open.length === 1 ? "process is" : "processes are"} still open. Close those you're done with; for those that got far, a reminder to tell the recruiter you've accepted another offer.`),
      h("div.wrap-up-all", {}, h("span.muted.small", {}, "All:"),
        h("button.al-button.al-button--sm", { type: "button", onclick: () => all("archive") }, "Close"),
        h("button.al-button.al-button--sm", { type: "button", onclick: () => all("reach") }, "Tell the recruiter"),
        h("button.al-button.al-button--sm", { type: "button", onclick: () => all("keep") }, "Leave open")),
      h("div.al-table-wrap", {}, h("table.import-table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "Process"), h("th", {}, "Stage"), h("th", {}, "What happens"))),
        h("tbody", {}, rows.map((r) => r.row)))),
      h("div.actions", {},
        h("button.al-button", { type: "button", onclick: finish }, "Not now"),
        h("button.al-button.al-button--primary", { type: "button", onclick: async () => {
          const tomorrow = (() => { const d = zonedNow(); d.setDate(d.getDate() + 1); return d.toLocaleDateString("en-CA"); })();
          const done = await attempt(async () => {
            let archived = 0, reminded = 0;
            for (const { card, choice } of rows) {
              if (choice.value === "archive") {
                await patch(`processes/${card.id}`, { status: "archived", archive_reason: withdrew, archive_note: `Accepted an offer at ${company}` });
                archived++;
              } else if (choice.value === "reach") {
                await post("reminders", { process_id: card.id, title: "Tell the recruiter I've accepted another offer", due_at: `${tomorrow}T10:00` });
                reminded++;
              }
            }
            return [archived, reminded];
          });
          if (!done) return;
          toast(`Closed ${done[0]}; ${done[1]} to tell the recruiter`);
          finish();
        } }, "Do it"))));
    dlg.addEventListener("cancel", () => resolve());
    document.body.append(dlg);
    dlg.showModal();
  });
}

/** The celebration: the offer, large, and the search that led to it, below. */
async function showCelebration(offer = null) {
  offer = offer || (await acceptedOffer());
  if (!offer) { go("/", { replace: true }); return; }
  showOfferNav(offer);
  const [app, st, detail] = await Promise.all([
    get(`applications/${offer.application_id}`), get("stats"), get(`processes/${offer.id}/detail`)]);
  const company = await get(`companies/${app.company_id}`);
  const pay = (() => {
    const p = homePay(app);
    return p ? fmtMoney(p[0] == null ? null : Math.round(p[0]), p[1] == null ? null : Math.round(p[1]), HOME(), app.pay_period)
      : fmtMoney(app.salary_min, app.salary_max, app.currency, app.pay_period);
  })();
  // From the first process added to the yes.
  const all = await get("board?archived_since=");
  const started = [...all.stages.flatMap((s) => s.cards), ...all.archived].map((c) => c.applied_on || c.created_at.slice(0, 10)).sort()[0];
  const accepted = offer.updated_at.slice(0, 10);
  const days = started ? Math.max(1, Math.round((parseLocal(accepted) - parseLocal(started)) / 864e5)) : null;
  const t = st.totals;
  const mode = optionLabel(R("applications").fields.find((f) => f.name === "work_mode").options, app.work_mode);
  const tile = (value, label) => h("div.al-stat.viz-tile.celebrate-tile", {}, h("span.al-stat__value", {}, value), h("span.al-stat__label", {}, label));
  const people = (detail.people || []);
  const confetti = h("div.confetti", { "aria-hidden": "true" },
    Array.from({ length: 36 }, (_, i) => h("span", { style: `--i:${i};--x:${(i * 37) % 100}%;--d:${(i % 7) * 0.35}s;--hue:${(i * 47) % 360}` })));
  fill(view, h("div.page.celebrate", {},
    h("header.al-page-head", {}, h("h1", {}, "Your offer"),
      h("p.al-page-head__lede", {}, "The offer you accepted, and the search that led to it.")),
    h("section.celebrate-hero", {},
      confetti,
      h("p.eyebrow", {}, "Offer accepted"),
      h("h2.celebrate-title", {}, "Congratulations!"),
      h("p.celebrate-lead", {}, "You accepted the offer from ", h("b", { translate: "no" }, company.name), "."),
      h("article.celebrate-offer", {},
        logoOf(company.id, company.logo, company.name, 56),
        h("div", {},
          h("h2", { translate: "no" }, app.title || company.name),
          h("p.muted", {}, [app.location ? h("span", { translate: "no" }, app.location) : null, app.work_mode ? mode : null, `Accepted ${fmtDay(accepted)}`]
            .filter(Boolean).flatMap((x, i) => (i ? [" · ", x] : [x]))),
          pay ? h("p.celebrate-pay", {}, pay) : null,
          offer.archive_note ? h("p.celebrate-note", { translate: "no" }, offer.archive_note) : null,
          h("a", { href: `/applications/${app.id}?process=${offer.id}` }, "Open the application →")))),
    h("section.celebrate-stats", {},
      h("h2", {}, "How you got here"),
      h("div.viz-tiles.celebrate-tiles", {},
        days ? tile(days === 1 ? "1 day" : `${days} days`, "from your first application to a yes") : null,
        tile(nf(t.applications), "applications"),
        tile(nf(t.companies), "companies you looked at"),
        tile(nf(t.interviews_done), "interviews done"),
        tile(nf(t.people), "people you met"),
        tile(nf(t.offers), t.offers === 1 ? "offer reached" : "offers reached"),
        t.files_sent ? tile(nf(t.files_sent), "files sent") : null,
        t.emails ? tile(nf(t.emails), "emails saved") : null)),
    people.length ? h("section.celebrate-thanks", {},
      h("h2", {}, "Say thank you"),
      h("p.muted", {}, "The people who were part of this one."),
      h("ul.app-people", {}, people.map((pe) => h("li", {},
        h("span.with-logo", {}, photoOf(pe.id, pe.photo, pe.name, 28), h("a", { href: `/people/${pe.id}` }, pe.name)),
        pe.email ? h("a.small-button.button", { href: `mailto:${pe.email}?subject=${encodeURIComponent("Thank you")}` }, icon("mail"), "Email") : null)))) : null,
    h("div.actions.celebrate-actions", {},
      h("button.al-button", { type: "button", onclick: () => { store("celebrated", String(offer.id)); go("/"); } }, "Back to the board"),
      h("a.al-button.al-button--sm", { href: "/stats" }, "See all the stats"))));
  document.title = `Congratulations · ${BASE_TITLE}`;
}
