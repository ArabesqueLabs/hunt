// The App Store's screenshots and app preview of the Safari extension
// (extension/): its real popup and settings page, talking to a hunt of its
// own with the demo data (scripts/demo.sh), shown in a Mac browser window on
// a page of their own, with a short caption each, in light and dark, as
// Apple's asset guidance has them
// (https://developer.apple.com/app-store/asset-best-practices/). Safari's
// popups can't be driven from a script, so headless Chrome shows the
// extension's pages, with the browser's side of them (chrome.*) stood in for.
//
//   node scripts/extension-screenshots.mjs     (or `make extension-screenshots`, which builds first)
//   PREVIEW=0 node scripts/extension-screenshots.mjs    (the screenshots alone)
//
// Writes docs/app-store/mac/<n>-<screen>-<theme>.png, at 2880×1800 (App Store
// Connect's largest Mac size), and the app preview, preview.mp4 (1920×1080,
// 30 fps, H.264, with a silent stereo track, as App Store Connect wants).
//
// Every page is at an example.com address, served by a proxy of the
// script's own that Chrome is pointed at: hunt (hunt.example.com, the demo),
// the extension's pages (ext.example.com, with chrome.* stood in for), the
// pages they're shown on (jobs.example.com, news.example.com), and the
// screens framing them (shots.example.com).
//
// Needs Node 22+, Chrome (CHROME=), ffmpeg for the preview, and what
// scripts/demo.sh needs. No packages.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";

const HUNT_ADDR = process.env.SHOTS_ADDR || "127.0.0.1:4865";
const HUNT_BASE = `http://${HUNT_ADDR}`;
const PROXY_PORT = 4866;
const HUNT = process.env.HUNT || "target/debug/hunt";
const OUT = "docs/app-store/mac";
const PORT = 9349;
const PREVIEW = process.env.PREVIEW !== "0";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The screenshots: 1440×900, at 2x. The preview: 1440×810, at 4/3 (1920×1080).
const SHOT = { width: 1440, height: 900, scale: 2 };
const VIDEO = { width: 1440, height: 810, scale: 4 / 3, fps: 30 };

/** The posting kept in the screenshots and the preview: a company the demo hasn't heard of. */
const POSTING = {
  url: "https://brightwave.example/careers/senior-platform-engineer",
  title: "Senior Platform Engineer — Brightwave",
  selection: "You'll own the deploy pipeline that ships Brightwave to 40 million homes, and lead a team of four.",
};
/** The link stashed from the right-click menu. */
const LINK = { url: "https://kestrel.example/jobs/staff-engineer-networking", title: "Staff Engineer, Networking — Kestrel Networks" };
/** What's waiting in the stash already, as if kept by the extension. */
const STASH = [
  { url: "https://fernwise.example/careers/engineering-manager-payments", title: "Engineering Manager, Payments — Fernwise", source: "extension" },
  { text: "Lumenbank's interview loop: a take-home, then two hours of system design. Ask Dana which team.", source: "extension" },
  { url: "https://blog.example.net/system-design-interviews", title: "How we run system design interviews", body: "Read before the Quillnote onsite.", source: "extension" },
];

/** The screenshots, in the order someone would use it: each a caption, a line under it, and what's shown. */
const SCREENS = [
  { name: "keep", caption: "Keep a posting the moment you find it", sub: "Its title and what you've selected on the page come with it.",
    page: "posting", popup: { selection: true } },
  { name: "kept", caption: "hunt knows what it could become", sub: "A job posting? It's an application in one step, when you sort it.",
    page: "posting", popup: { selection: true, act: "keep" } },
  { name: "menu", caption: "Or right-click any link", sub: "Pages, links, images and selections go straight to your stash. Or press ⌥⇧K.",
    page: "news", menu: true },
  { name: "stash", caption: "Sort it all later, in hunt", sub: "Everything waits in your stash, with what each could become.",
    page: "stash", scroll: 430 },
  { name: "settings", caption: "Your hunt, your data", sub: "It talks only to your own hunt, with a token you can revoke there.",
    page: "settings" },
];

/** The colours: the iOS app's screenshots' (scripts/app-screenshots.mjs). */
const THEME = {
  light: { bg: "#00776b", text: "#ffffff", sub: "#ffffffcc", shadow: "#00342e80", window: "#ffffff", bar: "#f3f2ee", line: "#d9d7cf", field: "#e6e4dc", ink: "#1d1d1b", muted: "#6b6a64" },
  dark: { bg: "#0e121a", text: "#7cdcb9", sub: "#abaaa1", shadow: "#000000b0", window: "#16181d", bar: "#22252c", line: "#33363d", field: "#2d3038", ink: "#ecebe6", muted: "#9b9a93" },
};

// The demo's owner: the extension's token is made as them.
const OWNER = { email: "user@example.com", password: "huntdemo" };
const AUTH = { Authorization: `Basic ${Buffer.from(`${OWNER.email}:${OWNER.password}`).toString("base64")}` };

async function api(method, path, body, headers = AUTH) {
  const r = await fetch(`${HUNT_BASE}/api/${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: body && JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${path}: ${await r.text()}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}

// ---- the pages the extension is shown on ----------------------------------------------------

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Brightwave's posting: what's selected on it, marked as a selection is. */
function postingPage(theme) {
  const dark = theme === "dark";
  return `<!doctype html><meta charset="utf-8"><title>${esc(POSTING.title)}</title><style>
  body { margin: 0; font: 16px/1.55 -apple-system, "Helvetica Neue", sans-serif; color: ${dark ? "#e8e6e1" : "#22201c"}; background: ${dark ? "#121417" : "#fbfaf7"}; }
  header { display: flex; align-items: center; gap: 10px; padding: 18px 56px; border-bottom: 1px solid ${dark ? "#2a2d33" : "#e8e5dd"}; font-weight: 700; font-size: 18px; }
  header i { width: 26px; height: 26px; border-radius: 8px; background: linear-gradient(135deg, #f4a259, #e4572e); }
  header nav { margin-inline-start: auto; display: flex; gap: 26px; font-weight: 500; font-size: 15px; color: ${dark ? "#a9a69e" : "#6d6a62"}; }
  main { max-width: 760px; padding: 40px 56px; }
  .crumb { font-size: 14px; color: ${dark ? "#a9a69e" : "#6d6a62"}; }
  h1 { font-size: 38px; line-height: 1.15; margin: 8px 0 12px; letter-spacing: -0.01em; }
  .meta { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 26px; }
  .meta span { padding: 4px 12px; border-radius: 999px; font-size: 14px; background: ${dark ? "#23262c" : "#efece4"}; }
  .apply { display: inline-block; padding: 11px 22px; border-radius: 10px; background: #e4572e; color: #fff; font-weight: 600; margin-bottom: 30px; }
  h2 { font-size: 20px; margin: 26px 0 8px; }
  p, li { color: ${dark ? "#cfccc4" : "#3d3a34"}; }
  mark { background: ${dark ? "#2f5d9e" : "#b3d4fd"}; color: inherit; }
</style><header><i></i>Brightwave<nav><span>Product</span><span>Company</span><span>Careers</span></nav></header>
<main><div class="crumb">Careers › Engineering</div><h1>Senior Platform Engineer</h1>
<div class="meta"><span>London or remote (UK)</span><span>Full time</span><span>£95,000 – £120,000</span></div>
<span class="apply">Apply for this job</span>
<h2>The role</h2>
<p>Brightwave makes the software inside smart home hubs. <mark>${esc(POSTING.selection)}</mark> You'll work with product and hardware teams to make releases boring.</p>
<h2>What you'll do</h2>
<ul><li>Run the build and release platform, and make it faster every quarter</li><li>Lead the move of our fleet updates to staged rollouts</li><li>Mentor engineers across three teams</li></ul>
<h2>About you</h2>
<ul><li>Six or more years building infrastructure at scale</li><li>Kubernetes, Terraform and a CI system you've bent to your will</li></ul>
</main>`;
}

/** A newsletter of roles: the link that's right-clicked, and (`menu`) the menu, its "Stash this link to hunt" under the pointer. */
function newsPage(theme, menu, hover, pointer = true) {
  const dark = theme === "dark";
  const roles = [
    ["Kestrel Networks", "Staff Engineer, Networking", LINK.url, "Remote, Europe · from €110k"],
    ["Openfield", "Senior Backend Engineer, Developer tools", "https://openfield.example/jobs/3412", "All remote · $150–180k"],
    ["Orbit Metrics", "Principal Engineer, Storage", "https://orbitmetrics.example/careers/principal-storage", "New York · hybrid"],
    ["Skylark Deploy", "Engineering Manager, Edge", "https://skylark.example/jobs/em-edge", "San Francisco or remote (US)"],
  ];
  return `<!doctype html><meta charset="utf-8"><title>The Platform Roles Weekly</title><style>
  body { margin: 0; font: 17px/1.6 Georgia, serif; color: ${dark ? "#e6e3dc" : "#26231e"}; background: ${dark ? "#151515" : "#fffdf8"}; }
  main { max-width: 680px; margin: 0 auto; padding: 44px 32px; }
  .kicker { font: 600 13px -apple-system, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: #c2410c; }
  h1 { font-size: 36px; line-height: 1.15; margin: 6px 0 10px; }
  .by { font: 14px -apple-system, sans-serif; color: ${dark ? "#9d998f" : "#77726a"}; margin-bottom: 26px; }
  .role { padding: 16px 0; border-top: 1px solid ${dark ? "#2c2b28" : "#ece6d8"}; }
  .role b { display: block; font: 600 13px -apple-system, sans-serif; letter-spacing: .04em; color: ${dark ? "#9d998f" : "#77726a"}; text-transform: uppercase; }
  .role a { font-size: 21px; color: ${dark ? "#8ab4f8" : "#1a56b8"}; text-decoration: underline; text-underline-offset: 3px; }
  .role a.on { background: ${dark ? "#2f5d9e66" : "#b3d4fd99"}; border-radius: 3px; }
  .role span { display: block; font: 14px -apple-system, sans-serif; color: ${dark ? "#9d998f" : "#77726a"}; }
  .menu { position: absolute; z-index: 2; width: 268px; padding: 5px; border-radius: 10px; font: 13.5px/1 -apple-system, "Helvetica Neue", sans-serif;
    background: ${dark ? "#2b2c30" : "#f6f5f2"}; color: ${dark ? "#ecebe6" : "#1d1d1b"}; box-shadow: 0 10px 30px #0005, 0 0 0 0.5px ${dark ? "#ffffff30" : "#00000030"}; }
  .menu div { display: flex; align-items: center; gap: 8px; padding: 5px 9px; border-radius: 5px; height: 14px; }
  .menu hr { border: 0; border-top: 1px solid ${dark ? "#ffffff22" : "#0000001c"}; margin: 5px 9px; }
  .menu .on { background: #0a63d8; color: #fff; }
  .menu img { width: 15px; height: 15px; }
</style><main><div class="kicker">Issue 112</div><h1>The Platform Roles Weekly</h1><div class="by">Twelve roles worth your time, picked by people who've done them.</div>
${roles.map(([co, role, url, where], i) => `<div class="role"><b>${co}</b><a href="${url}" id="r${i}" class="${menu && i === 0 ? "on" : ""}">${role}</a><span>${where}</span></div>`).join("")}
</main>
${menu ? `<div class="menu" id="menu" style="left: ${menu.x}px; top: ${menu.y}px">
  <div>Open Link in New Tab</div><div>Open Link in New Window</div><div>Download Linked File</div><div>Add Link to Bookmarks</div><div>Copy Link</div><hr>
  <div class="${hover ? "on" : ""}"><img src="http://ext.example.com/icons/${hover || theme === "dark" ? "38-reversed" : "38"}.png" alt="">Stash this link to hunt</div><hr>
  <div>Share…</div><div>Inspect Element</div></div>
${hover && pointer ? `<svg style="position:absolute; z-index:3; left:${menu.x + 150}px; top:${menu.y + 140}px" width="22" height="33" viewBox="0 0 22 33"><path d="M2 2v24l6-6 4.5 10 4-1.8L12 18.4h8.5z" fill="#000" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>` : ""}` : ""}`;
}

// ---- the extension's side of the browser, stood in for ---------------------------------------

/**
 * Run in the extension's pages before their own scripts: chrome.* as the
 * browser would give it, from `?c=` (base64 JSON): the settings, the tab it's
 * opened on, what's selected there, and what to do (`act: "keep"`). It also
 * tells the screen it's in its height, and takes the preview's typing and
 * pressing as messages.
 */
const STUB = `(() => {
  const c = JSON.parse(decodeURIComponent(escape(atob(new URLSearchParams(location.search).get("c") || "e30="))));
  const none = { addListener() {} };
  window.chrome = {
    runtime: { id: "hunt", openOptionsPage() {}, getURL: (p) => location.origin + "/" + p, onInstalled: none, onStartup: none },
    storage: { local: { get: async (d) => Object.assign({}, d, c.settings), set: async () => {} }, onChanged: none },
    tabs: { query: async () => [c.tab], create: async () => {} },
    scripting: { executeScript: async () => [{ result: c.selection || "" }] },
    permissions: { contains: async () => true, request: async () => true, remove: async () => true },
    commands: { getAll: async () => c.commands || [] },
    i18n: { getUILanguage: () => "en" },
  };
  window.close = () => {};
  // hunt is at https://hunt.example.com, as far as the pages know; the proxy is http.
  const fetch0 = window.fetch;
  window.fetch = (url, opts) => fetch0(String(url).replace("https://hunt.example.com", "http://hunt.example.com"), opts);
  addEventListener("DOMContentLoaded", () => {
    const main = document.querySelector("main");
    // The page's own height, however it's scrolled: its body's, and the body's margins.
    const tell = () => { const b = getComputedStyle(document.body); parent.postMessage({ height: Math.ceil(document.body.offsetHeight + parseFloat(b.marginTop) + parseFloat(b.marginBottom)) }, "*"); scrollTo(0, 0); };
    new ResizeObserver(tell).observe(main);
    if (c.act === "keep") setTimeout(() => document.getElementById("keep").click(), 400);
  });
  addEventListener("message", (e) => {
    const note = document.getElementById("note");
    // Typed: the note grows to show it all, as it's typed.
    if (e.data.note !== undefined) { note.value = e.data.note; note.rows = 7; note.focus(); note.setSelectionRange(note.value.length, note.value.length); }
    if (e.data.press) document.getElementById(e.data.press).classList.add("hx-pressed");
    if (e.data.keep) document.getElementById("keep").click();
  });
})();`;

const TOKEN = { value: "" };

/** The extension page's address, with what its stand-in gives it. */
function extPage(path, extra = {}) {
  const c = {
    settings: { server: "https://hunt.example.com", token: TOKEN.value, email: OWNER.email, language: "en" },
    commands: [
      { name: "_execute_action", description: "Open hunt", shortcut: "⌥⇧H" },
      { name: "send-page", description: "Stash the current page in your hunt", shortcut: "⌥⇧K" },
    ],
    ...extra,
  };
  return `http://ext.example.com/${path}?c=${Buffer.from(JSON.stringify(c)).toString("base64")}`;
}

// ---- the screens --------------------------------------------------------------------------

const ICON = (theme) => `http://ext.example.com/icons/${theme === "dark" ? "38-reversed" : "38"}.png`;

/**
 * A Mac browser window: its toolbar (the address, and the extension's button
 * at the end), and the page in it (`src`). `popup`: the extension's popup,
 * open under its button.
 */
function windowHtml(theme, { x, y, width, height, address, src, popup, badge, id = "win" }) {
  const t = THEME[theme];
  return `<div class="win" id="${id}" style="left:${x}px; top:${y}px; width:${width}px; height:${height}px">
  <div class="bar"><span class="dots"><i></i><i></i><i></i></span><span class="nav">‹ ›</span>
    <span class="address"><svg viewBox="0 0 10 12" width="9" height="11"><rect x="1" y="5" width="8" height="6.5" rx="1.2" fill="${t.muted}"/><path d="M3 5V3.6a2 2 0 0 1 4 0V5" stroke="${t.muted}" stroke-width="1.3" fill="none"/></svg>${esc(address)}</span>
    <span class="tools"><span class="button" id="${id}-button"><img src="${ICON(theme)}" alt="hunt">${badge ? `<b class="badge" id="${id}-badge">${badge}</b>` : ""}</span></span></div>
  <iframe class="page" id="${id}-page" src="${src}"></iframe>
  ${popup ? `<div class="popover" id="${id}-popover"><iframe id="${id}-popup" src="${popup}"></iframe></div>` : ""}
</div>`;
}

function style(theme, size) {
  const t = THEME[theme];
  return `<style>
  @font-face { font-family: Jost; src: url("/jost.woff2") format("woff2"); font-weight: 100 900; }
  html, body { margin: 0; width: ${size.width}px; height: ${size.height}px; overflow: hidden; background: ${t.bg}; }
  body { position: relative; font-family: Jost, system-ui, sans-serif; color-scheme: ${theme}; }
  header { position: absolute; left: 0; right: 0; text-align: center; }
  h1 { margin: 0; color: ${t.text}; font-size: 52px; font-weight: 500; line-height: 1.08; letter-spacing: -0.01em; }
  header p { margin: 12px auto 0; color: ${t.sub}; font-size: 24px; line-height: 1.3; }
  .win { position: absolute; border-radius: 12px; overflow: hidden; background: ${t.window}; box-shadow: 0 30px 80px ${t.shadow}, 0 0 0 1px ${theme === "dark" ? "#ffffff24" : "#00000014"}; }
  .bar { height: 52px; display: flex; align-items: center; gap: 14px; padding: 0 16px; background: ${t.bar}; border-bottom: 1px solid ${t.line};
    font: 13px -apple-system, "Helvetica Neue", sans-serif; color: ${t.ink}; }
  .dots { display: flex; gap: 8px; } .dots i { width: 12px; height: 12px; border-radius: 50%; background: #ff5f57; } .dots i + i { background: #febc2e; } .dots i + i + i { background: #28c840; }
  .nav { color: ${t.muted}; font-size: 22px; letter-spacing: 10px; margin-inline-start: 18px; }
  .address { flex: 1; max-width: 520px; margin: 0 auto; height: 32px; border-radius: 8px; background: ${t.field}; display: flex; align-items: center; justify-content: center; gap: 7px; color: ${t.ink}; }
  .tools { display: flex; gap: 10px; align-items: center; }
  .button { position: relative; width: 34px; height: 30px; border-radius: 7px; display: grid; place-items: center; }
  .button.on { background: ${t.field}; }
  .button img { width: 19px; height: 19px; }
  .badge { position: absolute; right: -2px; bottom: 0; min-width: 14px; height: 14px; border-radius: 7px; background: #2f7d4f; color: #fff; font: 700 10px/14px -apple-system, sans-serif; text-align: center; }
  .page { display: block; width: 100%; height: calc(100% - 53px); border: 0; background: ${t.window}; }
  .popover { position: absolute; top: 56px; right: 12px; width: 352px; border-radius: 12px; overflow: hidden; transform-origin: 85% 0;
    box-shadow: 0 18px 50px #0006, 0 0 0 0.5px ${theme === "dark" ? "#ffffff40" : "#00000030"}; background: ${t.window}; }
  .popover iframe { display: block; width: 352px; height: 420px; border: 0; }
  .cursor { position: absolute; z-index: 10; width: 22px; height: 33px; pointer-events: none; }
</style>`;
}

/** The screens' script: popups take the height their page says. */
const SIZE_POPUPS = `<script>addEventListener("message", (e) => {
  for (const f of document.querySelectorAll(".popover iframe")) if (f.contentWindow === e.source && e.data.height) f.style.height = e.data.height + "px";
});</script>`;

/** A screenshot's screen: its caption, and the window under it. */
function shotHtml(theme, s) {
  const pages = {
    posting: { address: "brightwave.example/careers/senior-platform-engineer", src: `http://jobs.example.com/posting?theme=${theme}` },
    news: { address: "rolesweekly.example/issues/112", src: `http://news.example.com/?theme=${theme}&menu=1&hover=1` },
    stash: { address: "hunt.example.com/stash", src: "http://hunt.example.com/stash" },
    settings: { address: "hunt — Settings", src: extPage("options/options.html") },
  };
  const page = pages[s.page];
  const popup = s.popup && extPage("popup/popup.html", {
    tab: { id: 1, index: 0, url: POSTING.url, title: POSTING.title },
    selection: s.popup.selection ? POSTING.selection : "",
    act: s.popup.act,
  });
  return `<!doctype html><meta charset="utf-8">${style(theme, SHOT)}
<header style="top: 52px"><h1>${esc(s.caption)}</h1><p>${esc(s.sub)}</p></header>
${windowHtml(theme, { x: 120, y: 215, width: 1200, height: 760, ...page, popup })}
${SIZE_POPUPS}`;
}

// ---- the proxy: every example.com address -----------------------------------------------------

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json" };
const screens = new Map();

function proxy() {
  const ext = resolve("extension/src");
  const server = createServer((req, res) => {
    const url = new URL(req.url.startsWith("http") ? req.url : `http://${req.headers.host}${req.url}`);
    const send = (status, type, body) => { res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" }); res.end(body); };
    const q = url.searchParams;
    switch (url.hostname) {
      case "hunt.example.com": {
        const up = request({ host: HUNT_ADDR.split(":")[0], port: HUNT_ADDR.split(":")[1], path: url.pathname + url.search, method: req.method, headers: req.headers }, (r) => {
          res.writeHead(r.statusCode, r.headers);
          r.pipe(res);
        });
        up.on("error", () => send(502, "text/plain", "hunt isn't there"));
        req.pipe(up);
        return;
      }
      case "ext.example.com": {
        if (url.pathname === "/__stub.js") return send(200, TYPES[".js"], STUB);
        const file = join(ext, url.pathname);
        if (!file.startsWith(ext) || !existsSync(file)) return send(404, "text/plain", "no such file");
        let body = readFileSync(file);
        if (extname(file) === ".html") body = body.toString().replace("<head>", '<head><script src="/__stub.js"></script>');
        return send(200, TYPES[extname(file)] || "application/octet-stream", body);
      }
      case "jobs.example.com":
        return send(200, TYPES[".html"], postingPage(q.get("theme")));
      case "news.example.com":
        return send(200, TYPES[".html"], newsPage(q.get("theme"), q.get("menu") && { x: Number(q.get("mx") || 470), y: 212 }, q.get("hover"), q.get("pointer") !== "0"));
      case "shots.example.com":
        if (url.pathname === "/jost.woff2") return send(200, TYPES[".woff2"], readFileSync("src/web/fonts/jost.woff2"));
        if (url.pathname === "/app-icon.png") return send(200, TYPES[".png"], readFileSync("extension/safari/app-icon.png"));
        return screens.has(url.pathname) ? send(200, TYPES[".html"], screens.get(url.pathname)) : send(404, "text/plain", "no such screen");
      default:
        return send(404, "text/plain", `nothing at ${url.hostname}`);
    }
  });
  server.listen(PROXY_PORT, "127.0.0.1");
  return server;
}

// ---- a tiny Chrome DevTools Protocol driver ---------------------------------------------------

function chrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(mac)) return mac;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    if (spawnSync("which", [name]).status === 0) return name;
  }
  throw new Error("no Chrome or Chromium found: set CHROME to one");
}

async function browser() {
  const profile = mkdtempSync(join(tmpdir(), "hunt-ext-shots-"));
  // Every address through the proxy; the extension's pages may call hunt's
  // API from their own address, as the extension may from the browser's.
  const proc = spawn(chrome(), ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`, "--no-first-run", "--force-color-profile=srgb", `--proxy-server=http://127.0.0.1:${PROXY_PORT}`,
    "--disable-web-security", "about:blank"], { stdio: "ignore" });
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
  ws.addEventListener("message", (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable");
  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result.result.value;
  };
  return {
    size: (s) => send("Emulation.setDeviceMetricsOverride", { width: s.width, height: s.height, deviceScaleFactor: s.scale, mobile: false }),
    scheme: (value) => send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] }),
    go: async (url, wait = 1800) => { await send("Page.navigate", { url }); await sleep(wait); },
    eval: evaluate,
    shot: async (format = "png") => Buffer.from((await send("Page.captureScreenshot", { format, quality: format === "jpeg" ? 92 : undefined, captureBeyondViewport: false })).result.data, "base64"),
    close: async () => { ws.close(); proc.kill(); await sleep(500); rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); },
  };
}

// ---- the preview -------------------------------------------------------------------------------

// The pointer: macOS's arrow.
const CURSOR = `<svg class="cursor" id="cursor" viewBox="0 0 22 33"><path d="M2 2v24l6-6 4.5 10 4-1.8L12 18.4h8.5z" fill="#000" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

/**
 * The preview: three windows, one after another. Keeping Brightwave's
 * posting with the popup (a note added), stashing a link from the
 * right-click menu, and both in hunt's stash. Its script, `at(t)`, sets
 * the screen to how it is `t` seconds in; the driver steps through.
 */
function previewHtml(theme) {
  const w = { x: 70, y: 40, width: 1300, height: 730 };
  const popup = extPage("popup/popup.html", { tab: { id: 1, index: 0, url: POSTING.url, title: POSTING.title }, selection: POSTING.selection });
  return `<!doctype html><meta charset="utf-8">${style(theme, VIDEO)}
<style>.win { transition: none; } .popover { opacity: 0; } .card { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; color: ${THEME[theme].text}; }
.card img { width: 120px; margin: 0 auto 26px; border-radius: 26px; } .card h1 { font-size: 64px; } .card p { color: ${THEME[theme].sub}; font-size: 28px; margin: 14px 0 0; }</style>
${windowHtml(theme, { ...w, id: "a", address: "brightwave.example/careers/senior-platform-engineer", src: `http://jobs.example.com/posting?theme=${theme}`, popup })}
${windowHtml(theme, { ...w, id: "b", address: "rolesweekly.example/issues/112", src: `http://news.example.com/?theme=${theme}`, badge: "✓" })}
${windowHtml(theme, { ...w, id: "c", address: "hunt.example.com/stash", src: "http://hunt.example.com/stash" })}
<div class="card" id="end"><img src="/app-icon.png" alt=""><h1>hunt for Safari</h1><p>Keep postings, links and people as you find them.</p></div>
${CURSOR}
${SIZE_POPUPS}
<script>
const $ = (id) => document.getElementById(id);
const ease = (x) => x < 0 ? 0 : x > 1 ? 1 : x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
const span = (t, a, b) => ease((t - a) / (b - a));
// The pointer's path: [time, x, y], eased between.
const PATH = [[0, 900, 520], [1.2, 900, 520], [2.6, 1337, 66], [3.4, 1337, 66], [4.6, 1180, 330], [8.6, 1180, 330], [9.4, 1062, 466], [10.4, 1062, 466],
  [11.2, 900, 600], [12.2, 590, 305], [13, 590, 305], [13.8, 740, 445], [14.8, 740, 445], [16.5, 1100, 640], [21, 1100, 640]];
const NOTE = ${JSON.stringify(POSTING.selection + "\n\nAsk Priya about the team.")};
let typed = -1, kept = false, menu = "", shown = "";
function show(id) { if (shown === id) return; shown = id; for (const w of ["a", "b", "c", "end"]) $(w).style.opacity = w === id ? 1 : 0; }
window.at = (t) => {
  let i = PATH.findIndex((p) => p[0] > t); if (i < 0) i = PATH.length - 1;
  const [t0, x0, y0] = PATH[Math.max(i - 1, 0)], [t1, x1, y1] = PATH[i], k = span(t, t0, t1);
  $("cursor").style.left = (x0 + (x1 - x0) * k) + "px"; $("cursor").style.top = (y0 + (y1 - y0) * k) + "px";
  $("cursor").style.opacity = t < 21 ? 1 : 0;
  show(t < 11.2 ? "a" : t < 16.4 ? "b" : t < 21 ? "c" : "end");
  // The popup: opened at 3.2s, the note typed from 4.8s, kept at 10s.
  const open = span(t, 3.2, 3.45);
  $("a-popover").style.opacity = open; $("a-popover").style.transform = "scale(" + (0.94 + 0.06 * open) + ")";
  $("a-button").classList.toggle("on", t >= 3.2);
  const chars = Math.max(0, Math.min(NOTE.length, ${POSTING.selection.length} + Math.floor((t - 4.8) * 9)));
  if (t >= 4.8 && chars !== typed) { typed = chars; $("a-popup").contentWindow.postMessage({ note: NOTE.slice(0, chars) }, "*"); }
  if (t >= 10 && !kept) { kept = true; $("a-popup").contentWindow.postMessage({ keep: true }, "*"); }
  // The right-click menu: open at 13s, "Stash this link to hunt" under the pointer at 14.2s, chosen at 14.8s.
  const m = t < 13 ? "" : t < 13.8 ? "menu=1" : t < 14.8 ? "menu=1&hover=1" : "";
  let loading = false;
  if (m !== menu) { menu = m; loading = true; $("b-page").src = "http://news.example.com/?theme=${theme}&mx=520&pointer=0&" + m; }
  $("b-badge").style.display = t >= 14.8 ? "block" : "none";
  return { kept, stash: t >= 14.8, loading };
};
</script>`;
}

// ---- making them ----------------------------------------------------------------------------

const work = mkdtempSync(join(tmpdir(), "hunt-ext-shots-db-"));
const db = join(work, "demo.db");
if (spawnSync("scripts/demo.sh", [db], { stdio: "inherit", env: { ...process.env, DEMO_EMAIL: OWNER.email, DEMO_PASSWORD: OWNER.password } }).status !== 0) process.exit(1);
const hunt = spawn(HUNT, ["serve", "--addr", HUNT_ADDR, "--db", db], { stdio: "ignore", env: { ...process.env, HUNT_PASSWORD: "", HUNT_ADMIN_EMAIL: "", HUNT_ADMIN_PASSWORD: "" } });
const px = proxy();
const b = await browser();
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${HUNT_BASE}/api/meta`)).ok) break; } catch { /* starting */ }
    if (i > 50) throw new Error(`hunt didn't start on ${HUNT_ADDR}`);
    await sleep(200);
  }
  TOKEN.value = (await api("POST", "tokens", { name: "Safari on my Mac", scope: "stash" })).secret;
  const asExtension = { Authorization: `Bearer ${TOKEN.value}` };
  for (const item of STASH) { await api("POST", "stash", item, asExtension); await sleep(1100); }

  // The browser signs in to hunt as the owner, once: its cookie lasts the run.
  await b.size(SHOT);
  await b.go("http://hunt.example.com/login");
  await b.eval(`document.querySelector("#email").value = ${JSON.stringify(OWNER.email)}; document.querySelector("#password").value = ${JSON.stringify(OWNER.password)}; document.querySelector("form").submit(); return 1`);
  await sleep(1500);

  /** What the extension kept in a pass, put away after it: each pass starts as the last did. */
  const putAway = async () => {
    for (const item of await api("GET", "stash")) {
      if ([POSTING.url, LINK.url].includes(item.url)) await api("POST", `stash/${item.id}/dismiss`);
    }
  };
  /** hunt's own pages in `theme`: the account's setting, and this browser's. */
  const huntTheme = async (theme) => {
    await api("PATCH", "settings", { language: "en", theme });
    await b.go("http://hunt.example.com/settings", 1000);
    await b.eval(`localStorage.clear(); localStorage.setItem("theme", ${JSON.stringify(theme)}); return 1`);
  };

  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) if (f.endsWith(".png") || f.endsWith(".mp4")) rmSync(join(OUT, f));
  for (const theme of ["light", "dark"]) {
    await b.scheme(theme);
    await huntTheme(theme);
    for (const [n, s] of SCREENS.entries()) {
      screens.set(`/${s.name}-${theme}`, shotHtml(theme, s));
      await b.go(`http://shots.example.com/${s.name}-${theme}`, s.popup?.act ? 3000 : 2200);
      if (s.scroll) { await b.eval(`document.getElementById("win-page").contentWindow.scrollTo(0, ${s.scroll}); return 1`); await sleep(400); }
      const file = join(OUT, `${n + 1}-${s.name}-${theme}.png`);
      writeFileSync(file, await b.shot());
      process.stdout.write(`  ${file}\n`);
    }
    await putAway();
  }

  if (PREVIEW) {
    // The preview, light: each frame set by its script, then photographed.
    const theme = "light";
    await b.scheme(theme);
    await huntTheme(theme);
    await b.size(VIDEO);
    screens.set("/preview", previewHtml(theme));
    await b.go("http://shots.example.com/preview", 3000);
    const frames = mkdtempSync(join(tmpdir(), "hunt-ext-preview-"));
    const seconds = 24;
    let stashed = false, reloaded = false;
    for (let f = 0; f < seconds * VIDEO.fps; f++) {
      const t = f / VIDEO.fps;
      const state = await b.eval(`return at(${t})`);
      // The link, kept as the menu would; then hunt's stash, fresh, before it's shown.
      if (state.stash && !stashed) { stashed = true; await api("POST", "stash", { ...LINK, source: "extension" }, asExtension); }
      if (state.loading) await sleep(700);
      if (t >= 15.5 && !reloaded) {
        reloaded = true;
        await b.eval(`document.getElementById("c-page").src = "http://hunt.example.com/stash"; return 1`);
        await sleep(2500);
        await b.eval(`document.getElementById("c-page").contentWindow.scrollTo(0, 430); return 1`);
      }
      if (state.kept && f % VIDEO.fps === 0) await sleep(150);
      await b.eval("return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
      writeFileSync(join(frames, `${String(f).padStart(5, "0")}.jpg`), await b.shot("jpeg"));
      if (f % VIDEO.fps === 0) process.stdout.write(`\r  preview: ${t}s of ${seconds}s`);
    }
    process.stdout.write("\n");
    const file = join(OUT, "preview.mp4");
    // H.264 at 30 fps, as App Store Connect takes it, with a silent stereo track (it wants one).
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(VIDEO.fps), "-i", join(frames, "%05d.jpg"),
      "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100", "-shortest",
      "-c:v", "libx264", "-profile:v", "high", "-level", "4.0", "-pix_fmt", "yuv420p", "-b:v", "10M", "-maxrate", "12M", "-bufsize", "20M",
      "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", file]);
    rmSync(frames, { recursive: true, force: true });
    await putAway();
    console.log(`  ${file}`);
  }
  console.log(`extension screenshots: in ${OUT}`);
} finally {
  await b.close();
  px.close();
  hunt.kill();
  rmSync(work, { recursive: true, force: true });
}
