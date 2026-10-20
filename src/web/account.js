"use strict";

// Several people sharing hunt (`hunt serve --tenants`): asking for an
// account, and the admin centre that decides.
//
// Someone signed in (through Cloudflare Access, with GitHub, LinkedIn …)
// without an account that may use hunt sees only the account screen: ask
// for one, or where their request stands. Admins get the admin centre
// (/admin): requests to approve or reject, and every account to manage.
// Built on app.js.

/** Whether hunt is shared, and this person may use it: else the account screen. */
const tenancy = () => META.tenancy || null;
const myAccount = () => tenancy()?.account || null;
const isAdmin = () => myAccount()?.role === "admin" && myAccount()?.status === "active";

/** The sidebar's link to the admin centre, for admins. */
function showAdminNav() {
  const link = document.querySelector('.sidebar a[data-nav="admin"]');
  if (link) link.hidden = !isAdmin();
}

/** What Cloudflare Access says about who's signed in: their name, and how. */
async function accessIdentity() {
  try {
    const res = await fetch("/cdn-cgi/access/get-identity", { credentials: "same-origin" });
    if (!res.ok) return {};
    const id = await res.json();
    return { name: id.name || null, provider: id.idp?.type || null };
  } catch {
    return {};
  }
}

/**
 * The account screen, for someone signed in without an account that may
 * use hunt: ask for one, or see where the request stands.
 */
async function showAccountScreen() {
  document.body.classList.add("no-account");
  const t = tenancy();
  const status = t?.account?.status || (t?.signed_in ? "none" : "signed-out");
  const page = h("div.page.account-page");
  fill(view, page);
  const head = (title, ...lead) => [h("h1", {}, title), lead.length ? h("p.account-lead", {}, ...lead) : null];
  const who = t?.email ? h("p.muted.small", {}, "Signed in as ", h("b", { translate: "no" }, t.email), ".") : null;
  const again = h("button.al-button", { type: "button", onclick: () => location.reload() }, "Check again");
  const ask = async (lead) => {
    const id = await accessIdentity();
    const name = h("input", { id: "ask-name", value: t?.account?.name || id.name || "", placeholder: "Your name", required: true });
    const reason = h("textarea", { id: "ask-reason", rows: 3, placeholder: "e.g. Looking for platform roles, recommended by a friend" });
    const agrees = h("input", { id: "ask-agrees", type: "checkbox", required: true });
    const form = h("form.account-form", { onsubmit: async (e) => {
      e.preventDefault();
      const done = await attempt(() => post("account/request", { name: name.value, reason: reason.value, provider: id.provider, agrees: agrees.checked }));
      if (done) location.reload();
    } },
    h("div.field", {}, h("label", { for: "ask-name" }, "Name"), name),
    h("div.field", {}, h("label", { for: "ask-reason" }, "What brings you to hunt?"), reason, h("p.muted.small", {}, "Optional: it helps us decide who to let in first.")),
    // A hunt run for others has terms of use, to agree to.
    META.terms ? h("label.check.agree", { for: "ask-agrees" }, agrees, " I agree to the ",
      h("a", { href: sitePage("/terms/"), target: "_blank" }, "terms of use"), ", and have read the ",
      h("a", { href: sitePage("/privacy/"), target: "_blank" }, "privacy notice"), ".") : null,
    h("div.actions", {}, h("button.al-button.al-button--primary", { type: "submit" }, "Join the list")));
    fill(page, head("Join the early access list", lead), who, form);
    name.focus();
  };
  if (status === "signed-out" && t?.trying_out) {
    // Trying hunt out, without Cloudflare Access: say who you are.
    const email = h("input", { id: "be-email", type: "email", required: true, placeholder: "you@example.com" });
    fill(page, head("Trying hunt out", "There's no sign-in here: say who you are, to be them in this browser."),
      h("form.account-form", { onsubmit: (e) => { e.preventDefault(); location.href = `/dev/as?email=${encodeURIComponent(email.value)}`; } },
        h("div.field", {}, h("label", { for: "be-email" }, "Email"), email),
        h("div.actions", {}, h("button.al-button.al-button--primary", { type: "submit" }, "Be them"))));
    email.focus();
  } else if (status === "signed-out") {
    fill(page, head("Sign in", "hunt is shared: sign in to use it."), h("p", {}, h("a.al-button.al-button--primary", { href: "/" }, "Sign in")));
  } else if ((status === "none" || status === "rejected") && t?.signups_open === false) {
    fill(page, head("The list is closed for now", "We aren't adding anyone to the early access list just now. Try again later."), who);
  } else if (status === "none") {
    await ask("hunt is in early access: we're letting people in a few at a time, as it grows.");
  } else if (status === "pending") {
    fill(page, head("You're on the list", "We're letting people in a few at a time. There's nothing more to do: come back any time to see if you're in."), who, h("div.actions", {}, again));
  } else if (status === "rejected") {
    await ask("You weren't let in this time. You can join the list again, saying a bit more about what you're looking for.");
  } else if (status === "disabled") {
    fill(page, head("Your account is disabled", "Ask an admin if you think it shouldn't be."), who);
  }
  document.title = `hunt · ${BASE_TITLE}`;
}

/** The admin centre: requests to decide, and every account. */
/** The admin centre's tabs: each one's key, name, and what's in it. */
const ADMIN_TABS = [
  ["general", "General", "This hunt, new accounts"],
  ["access", "Access and accounts", "Sign-ups, invites, accounts"],
  ["users", "User stats", "How accounts use hunt"],
  ["system", "System resources", "The machine, by account"],
  ["debug", "Debugging info", "Sign-in, health, the API"],
];

/** How many accounts a page of the admin's tables shows. */
const ADMIN_PAGE = 25;

/**
 * Accounts as a table to sort by any column (aria-sort, as the system's
 * tables do), find one in by its number, and go through a page at a time:
 * it grows with the accounts. A row chosen (click, or Enter) is the one
 * broken down: `onPick(id)`. `columns`: [{key, label, num, value(row), show(row)}].
 */
function accountsTable(columns, rows, { sort, desc = true, label, chosen = null, onPick }) {
  const state = { sort, desc, page: 0, q: "" };
  const head = h("tr");
  const body = h("tbody");
  const count = h("span.muted.small", { "aria-live": "polite" });
  const prev = h("button.al-button.al-button--sm", { type: "button", onclick: () => { state.page--; draw(); } }, "Previous");
  const next = h("button.al-button.al-button--sm", { type: "button", onclick: () => { state.page++; draw(); } }, "Next");
  const find = h("input", { type: "search", "aria-label": "Find an account by its number", placeholder: "Account number, e.g. 12" });
  let timer;
  find.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { state.q = find.value.replace(/[#\s]/g, ""); state.page = 0; draw(); }, 150); });
  const draw = () => {
    const col = columns.find((c) => c.key === state.sort) || columns[0];
    const shown = rows.filter((r) => !state.q || String(r.id).startsWith(state.q)).sort((x, y) => {
      const a = col.value(x), b = col.value(y);
      const c = a < b ? -1 : a > b ? 1 : 0;
      return (state.desc ? -c : c) || x.id - y.id;
    });
    const pages = Math.max(1, Math.ceil(shown.length / ADMIN_PAGE));
    state.page = Math.min(Math.max(0, state.page), pages - 1);
    const from = state.page * ADMIN_PAGE;
    const page = shown.slice(from, from + ADMIN_PAGE);
    fill(head, columns.map((c) => h("th", { class: c.num ? "al-table__num" : "", "aria-sort": c.key === state.sort ? (state.desc ? "descending" : "ascending") : null },
      h("button.th-sort", { type: "button", onclick: () => {
        if (state.sort === c.key) state.desc = !state.desc; else { state.sort = c.key; state.desc = !!c.num; }
        state.page = 0;
        draw();
      } }, c.label))));
    fill(body, page.length ? page.map((r) => h("tr", {
      tabindex: "0", "aria-selected": String(r.id) === String(chosen) ? "true" : null,
      onclick: () => onPick(r.id), onkeydown: (e) => { if (e.key === "Enter") onPick(r.id); },
    }, columns.map((c) => h("td", { class: c.num ? "al-table__num" : "" }, c.show ? c.show(r) : c.value(r)))))
      : h("tr", {}, h("td.muted", { colspan: columns.length }, "No account with that number.")));
    count.textContent = shown.length ? `${nf(from + 1)}–${nf(from + page.length)} of ${nf(shown.length)}` : "";
    prev.disabled = state.page === 0;
    next.disabled = state.page >= pages - 1;
  };
  draw();
  return h("div.admin-accounts", {},
    h("div.list-tools", {}, searchBox(find), h("span.spacer"), count, prev, next),
    h("div.al-table-wrap", { tabindex: "0", "aria-label": label }, h("table.al-table--interactive", {}, h("thead", {}, head), body)),
    h("p.muted.small", {}, "Choose an account to break its figures down."));
}

/** The account broken down (?account=), kept in the address so it can be linked to. */
function setAdminAccount(id) {
  const q = new URLSearchParams(location.search);
  if (id) q.set("account", id); else q.delete("account");
  history.replaceState(null, "", `/admin?${q}`);
  lastUrl = here();
}

/** Above the breakdown of one account: which, and the way back to them all. */
const breakdownHead = (one, back) => h("div.admin-breakdown-head", {},
  h("h2.admin-sub", {}, `Account #${one.id}`),
  h("button.al-button.al-button--quiet.al-button--sm", { type: "button", onclick: back }, "Every account"));

async function showAdmin() {
  if (!isAdmin()) { fill(view, h("div.page", {}, notice("danger", {}, "Only admins can see this."))); return; }
  const q = new URLSearchParams(location.search);
  const tab = ADMIN_TABS.some(([k]) => k === q.get("tab")) ? q.get("tab") : "general";
  const body = h("div.settings-content", { role: "region", "aria-labelledby": `admin-tab-${tab}` });
  const page = h("div.page.settings.admin-page", {},
    h("header.al-page-head", {}, h("h1", {}, "Admin"),
      h("p.al-page-head__lede", {}, "How this hunt is run, for everyone who uses it.")),
    h("div.settings-layout", {},
      h("nav.settings-nav", { "aria-label": "Admin sections" }, ADMIN_TABS.map(([k, label, hint]) => h("a", {
        href: `/admin?tab=${k}`, id: `admin-tab-${k}`, "aria-current": k === tab ? "page" : null,
      }, h("span", {}, label), h("span.settings-nav-hint", {}, hint)))),
      body));
  fill(view, page);
  document.title = `Admin · ${BASE_TITLE}`;
  let data;
  try { data = await get("admin/overview"); } catch (e) { body.append(notice("danger", {}, e.message)); return; }
  const parts = { general: adminGeneral, access: adminAccess, users: adminUsers, system: adminSystem, debug: () => [adminDebug()] };
  fill(body, await parts[tab](data));
}

/** General: this hunt, and what new accounts start with. */
function adminGeneral(data) {
  const about = settingsPanel("This hunt");
  about.append(h("dl.facts", {},
    h("dt", {}, "Version"), h("dd", {}, `hunt ${META.version}`),
    h("dt", {}, "Sign-in"), h("dd", {}, META.access ? "Cloudflare Access" : "Who's asking, as the server is told (for trying it out)"),
    META.operator ? [h("dt", {}, "Run by"), h("dd", { translate: "no" }, META.operator)] : null,
    h("dt", {}, "Accounts"), h("dd", {}, `${nf(data.totals.active)} active, ${nf(data.totals.admins)} of them admins`)));
  const d = data.defaults || {};
  const section = settingsPanel("New accounts start with", { intro: "Each account can change these in its own Settings. Leave one as it is for hunt's own default." });
  const pick = (id, options, value, none) => h("select", { id }, h("option", { value: "" }, none), options.map(([v, l]) => h("option", { value: v, selected: v === value }, l)));
  const lang = pick("def-language", META.languages.map((o) => [o.value, o.label]), d.language, "English (hunt's default)");
  const region = pick("def-region", REGIONS, d.region, "The browser's");
  const zone = pick("def-timezone", TIME_ZONES.map((z) => [z, z.replaceAll("_", " ")]), d.timezone, "The machine's");
  const cur = pick("def-currency", CURRENCIES.map((c) => [c, currencyName(c)]), d.currency, "GBP (hunt's default)");
  const field = (id, label, control) => h("div.field", {}, h("label", { for: id }, label), control);
  const save = h("button.al-button.al-button--primary", { type: "submit" }, "Save");
  section.append(h("form", { onsubmit: async (e) => {
    e.preventDefault();
    if (isBusy(save)) return;
    busy(save);
    const done = await attempt(() => patch("admin/settings", { defaults: { language: lang.value, region: region.value, timezone: zone.value, currency: cur.value } }));
    busy(save, false);
    if (done) toast("Saved: new accounts start with these");
  } },
  h("div.fields.two", {}, field("def-language", "Language", lang), field("def-region", "Region", region),
    field("def-timezone", "Time zone", zone), field("def-currency", "Currency", cur)),
  h("div.actions", {}, save)));
  return [about, section];
}

/** Access and accounts: sign-ups, invites, the early access list, every account. */
function adminAccess(data) {
  const reload = () => showAdmin();
  const decide = async (a, status, note = null) => {
    if (await attempt(() => post(`admin/accounts/${a.id}/decide`, { status, note }))) {
      toast({ active: `Approved ${a.email}`, rejected: `Rejected ${a.email}`, disabled: `Disabled ${a.email}` }[status] || "Done");
      reload();
    }
  };
  const when = (s) => (s ? fmtStamp(s) : h("span.muted", {}, "—"));
  const invited = (a) => a.provider === "invite" && !a.last_seen;
  const badge = (a) => (invited(a) ? h("span.al-badge.al-badge--info", {}, "Invited")
    : h("span.al-badge", { class: a.status === "active" ? "al-badge--accent" : "" },
      { active: "Active", pending: "Pending", rejected: "Rejected", disabled: "Disabled" }[a.status] || a.status));

  // Sign-ups: open, or closed (invites still work).
  const signups = settingsPanel("Sign-ups");
  signups.append(
    h("label.switch", {},
      h("input", { type: "checkbox", role: "switch", checked: data.signups_open, onchange: async (e) => {
        const open = e.target.checked;
        const done = await attempt(() => patch("admin/settings", { signups_open: open }));
        if (done) toast(open ? "Sign-ups open" : "Sign-ups closed"); else e.target.checked = !open;
      } }),
      "New people can join the early access list"),
    h("p.muted.small", {}, "Closed, someone new sees that the list is closed for now; those already on it, those invited, and accounts already here are as they are."));

  // Inviting someone: an account for them, open or closed.
  const invite = settingsPanel("Invite someone", { intro: "They can use hunt as soon as they sign in with this address, whether sign-ups are open or not." });
  const email = h("input", { id: "invite-email", type: "email", required: true, autocomplete: "off", placeholder: "name@example.com" });
  const name = h("input", { id: "invite-name", autocomplete: "off", placeholder: "Optional" });
  const send = h("button.al-button.al-button--primary", { type: "submit" }, "Invite");
  invite.append(h("form.admin-invite", { onsubmit: async (e) => {
    e.preventDefault();
    if (isBusy(send)) return;
    busy(send);
    const made = await attempt(() => post("admin/invites", { email: email.value, name: name.value || null }));
    busy(send, false);
    if (!made) return;
    try { await navigator.clipboard.writeText(`${location.origin}/app`); } catch { /* the toast says where */ }
    toast(`Invited ${made.email}. The link to send them: ${location.origin}/app`);
    reload();
  } },
  h("div.field", {}, h("label", { for: "invite-email" }, "Email address"), email),
  h("div.field", {}, h("label", { for: "invite-name" }, "Name"), name),
  send));

  // Requests: who's asking, and why.
  const pending = data.accounts.filter((a) => a.status === "pending");
  const requests = settingsPanel(`Early access list (${pending.length})`);
  requests.append(pending.length
    ? h("div.al-table-wrap", {}, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Who"), h("th", {}, "Signed in with"), h("th", {}, "Why"), h("th", {}, "Asked"), h("th.row-icons", {}, "Decide"))),
      h("tbody", {}, pending.map((a) => h("tr", {},
        h("td", {}, h("b", { translate: "no" }, a.name || a.email), a.name ? h("div.muted.small", { translate: "no" }, a.email) : null),
        h("td", {}, a.provider || h("span.muted", {}, "—")),
        h("td", { translate: "no" }, a.reason || h("span.muted", {}, "—")),
        h("td.nowrap", {}, when(a.requested_at)),
        h("td.row-icons", {},
          h("button.al-button.al-button--sm.al-button--primary", { type: "button", onclick: () => decide(a, "active") }, "Approve"), " ",
          h("button.al-button.al-button--sm.al-button--quiet.al-button--danger", { type: "button", onclick: async () => {
            const d = await ask({ title: `Reject ${a.email}`,
              body: h("div.fields", {}, h("div.field", {}, h("label", { for: "reject-note" }, "Note"),
                h("input", { id: "reject-note", name: "note", placeholder: "e.g. Not taking new people yet" }))),
              ok: "Reject", danger: true });
            if (d) decide(a, "rejected", d.get("note") || null);
          } }, "Reject")))))))
    : h("p.muted", {}, "No one is waiting."));

  // Every account.
  const others = data.accounts.filter((a) => a.status !== "pending");
  const accounts = settingsPanel(`Accounts (${others.length})`);
  accounts.append(h("div.al-table-wrap", {}, h("table", {},
    h("thead", {}, h("tr", {}, h("th", {}, "Who"), h("th", {}, "Status"), h("th", {}, "Role"), h("th.al-table__num", {}, "Applications"),
      h("th", {}, "Last seen"), h("th", {}, "CLI token"), h("th.row-icons", {}, "Actions"))),
    h("tbody", {}, others.map((a) => {
      const me = a.id === myAccount()?.id;
      const role = h("select", { "aria-label": `${a.email}'s role`, disabled: me, onchange: async () => {
        if (await attempt(() => patch(`admin/accounts/${a.id}`, { role: role.value }))) { toast("Role changed"); reload(); }
      } }, [["user", "User"], ["admin", "Admin"]].map(([v, l]) => h("option", { value: v, selected: a.role === v }, l)));
      return h("tr", {},
        h("td", {}, h("b", { translate: "no" }, a.name || a.email), me ? h("span.muted.small", {}, " (you)") : null,
          a.name ? h("div.muted.small", { translate: "no" }, a.email) : null,
          a.note ? h("div.muted.small", { translate: "no" }, a.note) : null),
        h("td", {}, badge(a)),
        h("td", {}, role),
        h("td.al-table__num", {}, nf(a.applications)),
        h("td.nowrap", {}, invited(a) ? h("span.muted", {}, "Not signed in yet") : when(a.last_seen)),
        h("td", {}, h("button.al-button.al-button--sm.al-button--quiet", { type: "button", onclick: async () => {
          const d = await ask({ title: `CLI token for ${a.email}`,
            body: h("div.fields", {}, h("p.muted.small", {}, "The Client ID of a Cloudflare Access service token: the CLI, sending it, acts as this account."),
              h("div.field", {}, h("label", { for: "cli-token" }, "Client ID"),
                h("input", { id: "cli-token", name: "token", value: a.service_token || "", placeholder: "xxxx.access" }))),
            ok: "Save" });
          if (d && await attempt(() => patch(`admin/accounts/${a.id}`, { service_token: d.get("token") || null }))) { toast("Saved"); reload(); }
        } }, a.service_token ? "change" : "set")),
        h("td.row-icons", {}, me ? null : [
          a.status === "active"
            ? h("button.al-button.al-button--sm", { type: "button", onclick: () => decide(a, "disabled") }, "Disable")
            : h("button.al-button.al-button--sm", { type: "button", onclick: () => decide(a, "active") }, a.status === "rejected" ? "Approve" : "Enable"),
          " ",
          h("button.al-button.al-button--sm.al-button--quiet.al-button--danger", { type: "button", onclick: async () => {
            const d = await ask({ title: `Remove ${a.email}`,
              body: h("div.fields", {}, h("p", {}, "They lose their account; they can ask for another."),
                h("label.check", {}, h("input", { type: "checkbox", name: "data" }), " And everything of theirs: applications, people, files, notes …")),
              ok: "Remove", danger: true });
            if (!d) return;
            const data = d.get("data") ? "1" : "";
            if (await attempt(() => del(`admin/accounts/${a.id}?data=${data}`))) { toast(`Removed ${a.email}`); reload(); }
          } }, "Remove…")]));
    })))));
  return [signups, invite, requests, accounts];
}

const DAY_MS = 864e5;
const daysAgo = (d) => (d ? Math.round((zonedNow() - parseLocal(d)) / DAY_MS) : null);

/** User stats: how accounts use hunt, by number, never by name. */
async function adminUsers() {
  const { accounts } = await get("admin/usage");
  const chosen = new URLSearchParams(location.search).get("account") || "";
  const out = h("div.admin-users");
  const draw = (id) => {
    setAdminAccount(id);
    const one = accounts.find((a) => String(a.id) === String(id));
    const sum = (k) => accounts.reduce((n, a) => n + (a[k] || 0), 0);
    const recent = accounts.filter((a) => a.last_seen && daysAgo(a.last_seen) <= 7).length;
    fill(out,
      one ? breakdownHead(one, () => draw("")) : null,
      one
        ? h("section.viz-tiles.admin-tiles", { "aria-label": `Account #${one.id}` },
          tile("Applications", nf(one.applications), `${nf(one.active)} on the board, ${nf(one.closed)} closed`),
          tile("Cycles", nf(one.cycles), `${nf(one.steps)} interview steps · ${nf(one.prep)} prep`),
          tile("Contacts", nf(one.companies + one.people), `${nf(one.companies)} companies, ${nf(one.people)} people`),
          tile("Changes", nf(one.changes), one.last_active ? `most recent: ${fmtDay(one.last_active)}` : "none yet"),
          tile("Files", nf(one.documents), fmtBytes(one.file_bytes)),
          tile("Joined", one.joined ? fmtDay(one.joined) : "—", one.last_seen ? `last seen ${fmtDay(one.last_seen)}` : "not seen yet"))
        : h("section.viz-tiles.admin-tiles", { "aria-label": "Every account" },
          tile("Accounts", nf(accounts.filter((a) => a.status === "active").length), `${nf(accounts.filter((a) => a.status === "pending").length)} waiting`),
          tile("Seen this week", nf(recent), `of ${nf(accounts.length)}`),
          tile("Applications", nf(sum("applications")), `${nf(sum("active"))} on boards`),
          tile("Interview steps", nf(sum("steps")), `${nf(sum("prep"))} prep`),
          tile("Changes", nf(sum("changes")), "in all")),
      accountsTable([
        { key: "id", label: "Account", value: (a) => a.id, show: (a) => `#${a.id}` },
        { key: "status", label: "Status", value: (a) => a.status, show: (a) => ({ active: "Active", pending: "Pending", rejected: "Rejected", disabled: "Disabled" })[a.status] || a.status },
        { key: "role", label: "Role", value: (a) => a.role, show: (a) => (a.role === "admin" ? "Admin" : "User") },
        { key: "joined", label: "Joined", value: (a) => a.joined || "", show: (a) => (a.joined ? fmtDay(a.joined) : "—") },
        { key: "last_seen", label: "Last seen", value: (a) => a.last_seen || "", show: (a) => (a.last_seen ? fmtDay(a.last_seen) : "—") },
        { key: "applications", label: "Applications", num: true, value: (a) => a.applications },
        { key: "active", label: "On the board", num: true, value: (a) => a.active },
        { key: "closed", label: "Closed", num: true, value: (a) => a.closed },
        { key: "cycles", label: "Cycles", num: true, value: (a) => a.cycles },
        { key: "steps", label: "Steps", num: true, value: (a) => a.steps },
        { key: "changes", label: "Changes", num: true, value: (a) => a.changes },
      ], accounts, { sort: "applications", label: "Accounts", chosen: one?.id, onPick: (v) => { draw(v); out.scrollIntoView({ block: "start" }); } }));
  };
  draw(chosen);
  return [h("p.muted.small", {}, "Counts and dates only: no names, addresses or anything an account keeps."), out];
}

/** Debugging info: links worth having to hand, about this hunt and around it. */
function adminDebug() {
  const here = location.origin;
  const link = (href, label, about) => h("li", {},
    h("a", { href, ...(href.startsWith("http") && !href.startsWith(here) ? { target: "_blank", rel: "noreferrer" } : {}) }, label),
    h("span.muted.small", {}, ` — ${about}`));
  const group = (title, ...items) => [h("h4", {}, title), h("ul.plain.links", {}, items)];
  return h("section.al-panel.panel.settings-panel", {},
    META.access
      ? group("Sign-in (Cloudflare Access)",
        link(`${here}/cdn-cgi/access/get-identity`, "Who you're signed in as", `the identity Access holds for you${META.access.email ? ` (${META.access.email})` : ""}`),
        link(`${here}/cdn-cgi/access/logout`, "Log out", "ends your Access session"),
        link("https://one.dash.cloudflare.com/", "Zero Trust dashboard", "Access applications, policies, service tokens and logs; the tunnel"))
      : h("p.muted.small", {}, "This hunt isn't behind Cloudflare Access, so there's no sign-in to link to."),
    group("This hunt",
      link(`${here}/healthz`, "Health check", "“ok” when hunt and its database answer"),
      link(`${here}/api/calendar.ics`, "Calendar feed", "interviews and deadlines, to subscribe to in a calendar app"),
      link(`${here}/api/backup`, "Download a backup", "everything, as JSON (also in Settings → Data)"),
      link(`${here}/api/meta`, "API: resources and fields", "what the JSON API knows about")),
    group("Source and deployment",
      link("https://github.com/ArabesqueLabs/hunt", "Source code", "github.com/ArabesqueLabs/hunt"),
      link("https://github.com/ArabesqueLabs/hunt/actions/workflows/image.yml", "Image builds", "the workflow that tests and publishes the container image"),
      link("https://github.com/orgs/ArabesqueLabs/packages/container/package/hunt", "Container image", "ghcr.io/arabesquelabs/hunt and its tags")));
}

/** System resources: the machine, and what each account takes of the database. */
async function adminSystem() {
  const { accounts } = await get("admin/usage");
  const all = accounts.reduce((n, a) => n + a.rows, 0);
  const out = h("div.admin-users");
  const draw = (id) => {
    setAdminAccount(id);
    const one = accounts.find((a) => String(a.id) === String(id));
    fill(out,
      one ? breakdownHead(one, () => draw("")) : h("h2.admin-sub", {}, "By account"),
      one ? h("section.viz-tiles.admin-tiles", { "aria-label": `Account #${one.id}` },
        tile("Rows", nf(one.rows), `${pct(one.rows, all)} of the database's`),
        tile("Files", fmtBytes(one.file_bytes), `${nf(one.documents)} documents`),
        tile("Changes logged", nf(one.changes), "rows in the audit log")) : null,
      accountsTable([
        { key: "id", label: "Account", value: (a) => a.id, show: (a) => `#${a.id}` },
        { key: "rows", label: "Rows", num: true, value: (a) => a.rows, show: (a) => nf(a.rows) },
        { key: "share", label: "Share", num: true, value: (a) => a.rows, show: (a) => pct(a.rows, all) },
        { key: "file_bytes", label: "Files", num: true, value: (a) => a.file_bytes, show: (a) => fmtBytes(a.file_bytes) },
        { key: "changes", label: "Changes logged", num: true, value: (a) => a.changes, show: (a) => nf(a.changes) },
      ], accounts, { sort: "rows", label: "Database, by account", chosen: one?.id, onPick: (v) => { draw(v); out.scrollIntoView({ block: "start" }); } }));
  };
  draw(new URLSearchParams(location.search).get("account") || "");
  return [await resourcesSection(), out];
}
