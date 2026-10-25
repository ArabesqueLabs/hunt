// Screenshots of hunt's pages, for docs/screenshots.md and the website's
// Screenshots and home pages (careerhunt.app, which fetches them): the demo data
// (scripts/demo.sh) served by a hunt of its own, photographed by headless
// Chrome in light and dark, at desktop and phone widths.
//
//   node scripts/screenshots.mjs        (or `make screenshots`, which builds first)
//
// Writes docs/screenshots/*.png, docs/screenshots.md, and
// docs/screenshots.json (each shot's name, title, what it shows, and whether
// it's a phone's, for the website), replacing them.
// Needs Node 22+ (for its WebSocket), Chrome or Chromium (CHROME= to say
// where), and what scripts/demo.sh needs. No packages.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ADDR = process.env.SHOTS_ADDR || "127.0.0.1:4847";
const BASE = `http://${ADDR}`;
const HUNT = process.env.HUNT || "target/debug/hunt";
const OUT = "docs/screenshots";
const PORT = 9347;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(mac)) return mac;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    if (spawnSync("which", [name]).status === 0) return name;
  }
  throw new Error("no Chrome or Chromium found: set CHROME to one");
}

// ---- the pages -------------------------------------------------------------------------

/**
 * Each shot: a file name, a caption, the page, and what to do there first.
 * `full` takes the whole page, not just the window; `phone` is 390 wide.
 */
const SHOTS = [
  { name: "board", title: "Applications", about: "Applications by stage, with what's next on each; the cycles running side by side.", path: "/", detailed: true },
  // Every swimlane open, Terminated Processes too: its stages' cards folded
  // into piles, as they start.
  { name: "swimlanes", title: "Swimlanes, sub stages and folding",
    about: "The board's rows: what's active, the offers, and what's closed, each stage a column. Interviewing divided into sub stages; Backlog's Other, and the closed, folded into piles.",
    path: "/", full: true, act: `document.querySelectorAll("details.swimlane").forEach((d) => { d.open = true; })` },
  { name: "table", title: "Applications, as a table", about: "Every application, sortable, with the board's filters.", path: "/applications" },
  { name: "new-application", title: "Adding an application", about: "From a posting's link, or by hand, onto the board.", path: "/", act: `document.querySelector('[aria-keyshortcuts="n"]').click()` },
  { name: "application", title: "An application", about: "What's next, its timeline, and its pay, details, prep, links and people beside.",
    path: (ids) => `/applications/${ids.app}`, full: true,
    // Opened: the email thread, and the postings and company, folded at first.
    act: `document.querySelectorAll('details.email-thread, details[data-section="posting"], details[data-section="company"]').forEach((d) => { d.open = true; })` },
  { name: "cycles", title: "Cycles", about: "Job searches, several at once; one that has ended keeps its board.", path: "/cycles", full: true },
  { name: "past-cycle", title: "A cycle that ended", about: "Its board, read-only, as it was when it ended.", path: (ids) => `/?cycle=${ids.pastCycle}`, detailed: true },
  { name: "prep", title: "Prep", about: "What to read, practise and rehearse, around the interviews coming up.", path: "/prep", full: true },
  { name: "calendar", title: "Calendar", about: "Interviews, next actions and deadlines.", path: "/calendar" },
  { name: "calendar-week", title: "Calendar: a week", about: "Each event at its time, around what is coming up this week.", path: "/calendar?view=week" },
  { name: "companies", title: "Contacts: companies", path: "/companies" },
  { name: "company", title: "A company", about: "Its details, its applications with their stages and tags, and its people.", path: (ids) => `/companies/${ids.company}` },
  { name: "people", title: "Contacts: people", path: "/people" },
  { name: "person", title: "A person", path: (ids) => `/people/${ids.person}` },
  { name: "files", title: "Files", about: "Resumes, cover letters, offers and more, each with its versions.", path: "/files" },
  { name: "file", title: "A file", about: "Its versions, with a preview.", path: (ids) => `/files/${ids.document}` },
  { name: "notes", title: "Notes", path: "/notes" },
  // Without "System resources": that's the machine taking the pictures.
  { name: "stats", title: "Interview stats", about: "How the search is going.", path: "/stats", full: true,
    act: `document.querySelector(".viz-system")?.remove()` },
  // Northwind's offer, then a contract's day rate all three ways.
  { name: "take-home", title: "Take-home pay", about: "What a salary leaves after income tax and National Insurance, and what it costs the employer.",
    path: "/take-home?type=paye&amount=105000&per=year&currency=GBP", full: true },
  { name: "take-home-compare", title: "Take-home pay, three ways", about: "A day rate as an employee, and as a contractor inside and outside IR35, side by side.",
    path: "/take-home?type=all&amount=650&per=day&currency=GBP", full: true },
  { name: "activity", title: "Audit Log", about: "Every change, newest first.", path: "/activity" },
  { name: "settings", title: "Settings", path: "/settings", full: true },
  { name: "settings-board", title: "Settings: the board", about: "Swimlanes, their stages and the stages' sub stages: which stages close a process, which start folded, and where a card goes by default.",
    path: "/settings?tab=board", full: true },
  // In Arabic, right to left.
  { name: "board-ar", title: "In Arabic: the board", about: "Right to left, with Arabic-Indic digits; what people wrote stays as written.", path: "/", detailed: true, language: "ar" },
  { name: "application-ar", title: "In Arabic: an application", path: (ids) => `/applications/${ids.app}`, language: "ar" },
  // An offer accepted: the home page celebrates. Northwind's is accepted for
  // the shot, as Accept the offer does, into an Accepted sub stage of its
  // stage (the demo's has none: one is added), then put back.
  { name: "celebrate", title: "An offer accepted", about: "The home page celebrates it, with the search that led there below.", path: "/", full: true,
    prepare: async (ids) => {
      ids.acceptedLane = (await api("POST", "lanes", { stage_id: ids.offerStage, name: "Accepted" })).id;
      await api("POST", `processes/${ids.offer}/move`, { stage_id: ids.offerStage, lane_id: ids.acceptedLane });
    },
    restore: async (ids) => {
      await api("POST", `processes/${ids.offer}/move`, { stage_id: ids.offerStage, lane_id: ids.offerLane });
      await api("DELETE", `lanes/${ids.acceptedLane}`);
    } },
  { name: "phone-board", title: "On a phone: the board", path: "/", phone: true },
  { name: "phone-application", title: "On a phone: an application", path: (ids) => `/applications/${ids.app}`, phone: true },
];

/** hunt's API: `api("POST", "lanes", {…})`, and what it gives back. */
// The demo's hunt has an owner (made from HUNT_ADMIN_EMAIL and
// HUNT_ADMIN_PASSWORD, below): its API is asked as them, as the CLI asks.
const OWNER = { email: "demo@example.test", password: "screenshots" };
const AUTH = { Authorization: `Basic ${Buffer.from(`${OWNER.email}:${OWNER.password}`).toString("base64")}` };
const get = (path) => fetch(`${BASE}/api/${path}`, { headers: AUTH });

async function api(method, path, body) {
  const r = await fetch(`${BASE}/api/${path}`, { method, headers: { "Content-Type": "application/json", ...AUTH }, body: body && JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${path}: ${await r.text()}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}

// ---- a tiny Chrome DevTools Protocol driver ---------------------------------------------

async function browser() {
  const profile = mkdtempSync(join(tmpdir(), "hunt-shots-"));
  const proc = spawn(chrome(), ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`, "--no-first-run", "--force-color-profile=srgb", "about:blank"], { stdio: "ignore" });
  let page;
  for (let i = 0; i < 50 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page"); } catch { /* starting */ }
    if (!page) await sleep(200);
  }
  if (!page) throw new Error("Chrome didn't start");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const waiting = new Map();
  const errors = [];
  ws.addEventListener("message", (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
    if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Runtime.enable");
  await send("Page.enable");
  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result.result.value;
  };
  return {
    errors,
    // Phones at 2x, as they are; the desktop at 1x, to keep the files small.
    size: (width, height, mobile = false) => send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile }),
    scheme: (value) => send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] }),
    go: async (url) => { await send("Page.navigate", { url }); await sleep(1500); },
    eval: evaluate,
    shot: async (path) => {
      const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      writeFileSync(path, Buffer.from(r.result.data, "base64"));
    },
    close: () => { ws.close(); proc.kill(); rmSync(profile, { recursive: true, force: true }); },
  };
}

// ---- making them --------------------------------------------------------------------------

const work = mkdtempSync(join(tmpdir(), "hunt-shots-db-"));
const db = join(work, "demo.db");
if (spawnSync("scripts/demo.sh", [db], { stdio: "inherit" }).status !== 0) process.exit(1);
const server = spawn(HUNT, ["serve", "--addr", ADDR, "--db", db], {
  stdio: "ignore",
  env: { ...process.env, HUNT_PASSWORD: "", HUNT_ADMIN_EMAIL: OWNER.email, HUNT_ADMIN_PASSWORD: OWNER.password },
});
const b = await browser();
try {
  for (let i = 0; ; i++) {
    try { if ((await get("meta")).ok) break; } catch { /* starting */ }
    if (i > 50) throw new Error(`hunt didn't start on ${ADDR}`);
    await sleep(200);
  }
  const first = async (what, q) => (await (await get(`${what}?q=${encodeURIComponent(q)}`)).json())[0].id;
  const ids = {
    app: await first("applications", "Quillnote"),
    company: await first("companies", "Quillnote"),
    person: await first("people", "Dana Kim"),
    document: await first("documents", "Resume"),
  };
  ids.pastCycle = (await (await get("cycles")).json()).find((c) => c.ended_on).id;
  const northwind = (await (await get("processes?q=Northwind")).json())[0];
  Object.assign(ids, { offer: northwind.id, offerStage: northwind.stage_id, offerLane: northwind.lane_id });

  // The browser signs in as the owner, once: its cookie lasts the run.
  await b.go(`${BASE}/login`);
  await b.eval(`document.querySelector("#email").value = ${JSON.stringify(OWNER.email)}; document.querySelector("#password").value = ${JSON.stringify(OWNER.password)}; document.querySelector("form").submit(); return 1`);
  await sleep(1500);

  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) if (f.endsWith(".png")) rmSync(join(OUT, f));
  for (const theme of ["light", "dark"]) {
    await b.scheme(theme);
    for (const s of SHOTS) {
      const [width, height] = s.phone ? [390, 844] : [1440, 900];
      await b.size(width, height, !!s.phone);
      // The language is the service's setting: set for the shot, then back.
      await api("PATCH", "settings", { language: s.language || "en" });
      await b.go(`${BASE}/settings`);
      // Each shot as a first visit: nothing folded, opened or chosen before.
      await b.eval(`localStorage.clear(); localStorage.setItem("theme", ${JSON.stringify(theme)}); localStorage.setItem("cardView", ${JSON.stringify(s.detailed ? "detailed" : "compact")}); localStorage.setItem("boardMode", "board"); return 1`);
      if (s.prepare) await s.prepare(ids);
      await b.go(BASE + (typeof s.path === "function" ? s.path(ids) : s.path));
      if (s.act) { await b.eval(`${s.act}; return 1`); await sleep(1000); }
      if (s.full) {
        const tall = await b.eval("return Math.ceil(document.documentElement.scrollHeight)");
        await b.size(width, Math.min(Math.max(tall, height), 4000), !!s.phone);
        await sleep(400);
      }
      await b.eval("window.scrollTo(0, 0); document.activeElement?.blur(); return 1");
      await sleep(200);
      await b.shot(join(OUT, `${s.name}-${theme}.png`));
      if (s.restore) await s.restore(ids);
      process.stdout.write(`  ${s.name}-${theme}.png\n`);
    }
  }
  if (b.errors.length) throw new Error(`the pages had errors:\n${b.errors.join("\n")}`);

  // The page that shows them: light or dark, as the reader's system is.
  const md = [
    "# Screenshots",
    "",
    "hunt with its demo data (`make demo`): every company, person and address in",
    "it is made up. They show light or dark, as your system is set. Made by",
    "`make screenshots`.",
    "",
    ...SHOTS.flatMap((s) => [
      `## ${s.title}`,
      "",
      ...(s.about ? [s.about, ""] : []),
      "<picture>",
      `  <source media="(prefers-color-scheme: dark)" srcset="screenshots/${s.name}-dark.png">`,
      `  <img src="screenshots/${s.name}-light.png" alt="${s.title}"${s.phone ? ' width="320"' : ""}>`,
      "</picture>",
      "",
    ]),
  ].join("\n");
  writeFileSync("docs/screenshots.md", md);
  // For the website: each shot's name, title, what it shows and whether it's a phone's.
  const gallery = SHOTS.map((s) => ({ name: s.name, title: s.title, about: s.about || "", phone: !!s.phone }));
  writeFileSync("docs/screenshots.json", JSON.stringify(gallery, null, 2) + "\n");
  console.log(`screenshots: ${SHOTS.length * 2} in ${OUT}, and docs/screenshots.md and .json`);
} finally {
  b.close();
  server.kill();
  rmSync(work, { recursive: true, force: true });
}
