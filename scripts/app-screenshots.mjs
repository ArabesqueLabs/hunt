// The App Store's screenshots of the iOS app (mobile/): the demo data
// (scripts/demo.sh), served by a hunt of its own, shown by the app in
// simulators, each screen then framed with a short caption, in light and
// dark, as Apple's asset guidance has them
// (https://developer.apple.com/app-store/asset-best-practices/): the app in
// use, in the order someone would use it, a short phrase each.
//
//   node scripts/app-screenshots.mjs     (or `make app-screenshots`, which builds first)
//
// Writes docs/app-store/<device>/<n>-<screen>-<theme>.png, at the sizes App
// Store Connect asks for (iPhone 6.9", 1320×2868; iPad 13", 2064×2752), and
// the screens as the simulators showed them beside, in raw/.
//
// Needs Xcode (its simulators: IPHONE= and IPAD= to say which, by name),
// Node 22+, Chrome (CHROME=) and what scripts/demo.sh needs. The app is
// built for the simulator, in Release, with EXPO_PUBLIC_SCREENSHOTS=1: so
// signed in by its launch arguments (see mobile/src/lib/session.ts), since
// nothing can type into a simulator here. No packages.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ADDR = process.env.SHOTS_ADDR || "127.0.0.1:4861";
const BASE = `http://${ADDR}`;
const HUNT = process.env.HUNT || "target/debug/hunt";
const OUT = "docs/app-store";
const BUNDLE = "app.careerhunt.hunt";
const PORT = 9348;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", ...opts });

/** The devices: a simulator each, and the size App Store Connect wants its screenshots at. */
const DEVICES = [
  { dir: "iphone-6.9", sim: process.env.IPHONE || "iPhone 18 Pro Max", width: 1320, height: 2868, caption: 104, sub: 50, pad: 120 },
  { dir: "ipad-13", sim: process.env.IPAD || "iPad Pro 13-inch (M5)", width: 2064, height: 2752, caption: 112, sub: 54, pad: 150 },
];

/**
 * The screens, in the order someone would use them: where the app opens,
 * what's due, then the applications, one of them, and the stash. Each: the
 * app's route to it (its -huntRoute), and its caption (a short phrase, and a line under it).
 */
const SCREENS = [
  { name: "due", route: "/", caption: "Know what's next", sub: "Interviews, follow-ups and closing dates, overdue first." },
  { name: "applications", route: "/applications", caption: "Applications, by stage", sub: "Search them, or show what's due next or overdue." },
  { name: "application", route: (ids) => `/application/${ids.app}`, caption: "Ready for the next step", sub: "Its stage, reminders, interviews and notes, all in one place." },
  { name: "stash", route: "/stash", caption: "Keep postings for later", sub: "Share a link from any app, then sort it when you're ready." },
];

/** Postings and notes in the stash, as if shared to the app (the demo's has none). */
const STASH = [
  { url: "https://jobs.example.com/brightwave/senior-platform-engineer", title: "Senior Platform Engineer, Brightwave", body: "Remote (UK). Mentioned by Priya: the team is hiring two.", source: "share" },
  { url: "https://careers.example.org/fernhill/staff-engineer-payments", title: "Staff Engineer, Payments — Fernhill", source: "share" },
  { text: "Ask Dana about the Lumen referral before Friday", source: "app" },
  { url: "https://blog.example.net/system-design-interviews", title: "How we run system design interviews", body: "Read before the Quillnote onsite.", source: "share" },
];

/** The colours: the app's (mobile/src/lib/theme.ts). */
const THEME = {
  light: { bg: "#00776b", text: "#ffffff", sub: "#ffffffcc", shadow: "#00342e66" },
  dark: { bg: "#0e121a", text: "#7cdcb9", sub: "#abaaa1", shadow: "#00000099" },
};

// The demo's owner: the app's token is made as them.
const OWNER = { email: "user@example.com", password: "huntdemo" };
const AUTH = { Authorization: `Basic ${Buffer.from(`${OWNER.email}:${OWNER.password}`).toString("base64")}` };

async function api(method, path, body) {
  const r = await fetch(`${BASE}/api/${path}`, { method, headers: { "Content-Type": "application/json", ...AUTH }, body: body && JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${path}: ${await r.text()}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}

// ---- the simulators -------------------------------------------------------------------------

/** A simulator's UDID, by its name: the newest runtime's, if there are several. */
function udid(name) {
  const { devices } = JSON.parse(sh("xcrun", ["simctl", "list", "devices", "available", "--json"]));
  const found = Object.entries(devices).sort(([a], [b]) => b.localeCompare(a, undefined, { numeric: true }))
    .flatMap(([, list]) => list).find((d) => d.name === name);
  if (!found) throw new Error(`no simulator called ${name}: say which with IPHONE= or IPAD=`);
  return found.udid;
}

const simctl = (...args) => sh("xcrun", ["simctl", ...args]);

/** The app, built for the simulator, in Release, with its screenshot sign-in. */
function build(sim) {
  const derived = join(tmpdir(), "hunt-app-shots-build");
  const app = join(derived, "Build/Products/Release-iphonesimulator/hunt.app");
  if (process.env.APP) return resolve(process.env.APP);
  // The native project, made if there isn't one (it's generated: mobile/ios is ignored).
  if (!existsSync("mobile/ios")) sh("npx", ["expo", "prebuild", "--platform", "ios"], { cwd: "mobile", stdio: "inherit" });
  console.log("building the app for the simulator (Release)…");
  const r = spawnSync("xcodebuild", ["-workspace", "ios/hunt.xcworkspace", "-scheme", "hunt", "-configuration", "Release",
    "-sdk", "iphonesimulator", "-destination", `id=${sim}`, "-derivedDataPath", derived, "build"],
  { cwd: "mobile", stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, EXPO_PUBLIC_SCREENSHOTS: "1" } });
  if (r.status !== 0) throw new Error("the app didn't build");
  return app;
}

// ---- a tiny Chrome DevTools Protocol driver, to frame them ----------------------------------

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
  const profile = mkdtempSync(join(tmpdir(), "hunt-app-shots-"));
  const proc = spawn(chrome(), ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`, "--no-first-run", "--force-color-profile=srgb", "--allow-file-access-from-files", "about:blank"], { stdio: "ignore" });
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
  return {
    /** `html`, at width × height, as a PNG at `path`. */
    render: async (html, width, height, path) => {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      const file = join(profile, "frame.html");
      writeFileSync(file, html);
      await send("Page.navigate", { url: `file://${file}` });
      await sleep(600);
      const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      writeFileSync(path, Buffer.from(r.result.data, "base64"));
    },
    close: () => { ws.close(); proc.kill(); rmSync(profile, { recursive: true, force: true }); },
  };
}

/** A screen, framed: its caption above, the screen below, rounded, on the theme's colour. */
function frame(device, screen, theme, png) {
  const t = THEME[theme];
  const font = resolve("src/web/fonts/jost.woff2");
  const img = `data:image/png;base64,${readFileSync(png).toString("base64")}`;
  return `<!doctype html><meta charset="utf-8"><style>
  @font-face { font-family: Jost; src: url("file://${font}") format("woff2"); font-weight: 100 900; }
  html, body { margin: 0; width: ${device.width}px; height: ${device.height}px; overflow: hidden; background: ${t.bg}; }
  body { display: flex; flex-direction: column; align-items: center; font-family: Jost, system-ui, sans-serif; }
  header { box-sizing: border-box; height: ${Math.round(device.caption * 1.1 + device.sub * 3.6 + device.pad)}px; padding: ${device.pad}px ${device.pad}px 0; text-align: center; }
  h1 { margin: 0; color: ${t.text}; font-size: ${device.caption}px; font-weight: 500; line-height: 1.08; letter-spacing: -0.01em; }
  p { margin: ${device.sub * 0.5}px auto 0; max-width: 24ch; color: ${t.sub}; font-size: ${device.sub}px; line-height: 1.3; }
  img { display: block; margin-top: ${device.pad * 0.6}px; width: ${Math.round(device.width * 0.8)}px; border-radius: ${Math.round(device.width * 0.055)}px;
    box-shadow: 0 ${device.pad * 0.3}px ${device.pad * 0.8}px ${t.shadow}; ${theme === "dark" ? "outline: 3px solid #ffffff1f;" : ""} }
</style><body><header><h1>${screen.caption}</h1><p>${screen.sub}</p></header><img src="${img}"></body>`;
}

// ---- making them ----------------------------------------------------------------------------

const app = build(udid(DEVICES[0].sim));
const work = mkdtempSync(join(tmpdir(), "hunt-app-shots-db-"));
const db = join(work, "demo.db");
if (spawnSync("scripts/demo.sh", [db], { stdio: "inherit", env: { ...process.env, DEMO_EMAIL: OWNER.email, DEMO_PASSWORD: OWNER.password } }).status !== 0) process.exit(1);
const server = spawn(HUNT, ["serve", "--addr", ADDR, "--db", db], { stdio: "ignore" });
const b = await browser();
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${BASE}/api/meta`)).ok) break; } catch { /* starting */ }
    if (i > 50) throw new Error(`hunt didn't start on ${ADDR}`);
    await sleep(200);
  }
  for (const item of STASH) { await api("POST", "stash", item); await sleep(1100); }
  const ids = { app: (await api("GET", "applications?q=Quillnote"))[0].id };
  const token = (await api("POST", "tokens", { name: "hunt app (iOS)", scope: "full" })).secret;

  for (const device of DEVICES) {
    const sim = udid(device.sim);
    spawnSync("xcrun", ["simctl", "boot", sim]);
    simctl("bootstatus", sim);
    // 9:41, full bars and battery, as Apple's own.
    simctl("status_bar", sim, "override", "--time", "9:41", "--dataNetwork", "wifi", "--wifiMode", "active", "--wifiBars", "3",
      "--cellularMode", "active", "--cellularBars", "4", "--batteryState", "charged", "--batteryLevel", "100");
    simctl("install", sim, app);
    const raw = join(OUT, device.dir, "raw");
    mkdirSync(raw, { recursive: true });
    for (const theme of ["light", "dark"]) {
      simctl("ui", sim, "appearance", theme);
      for (const [n, s] of SCREENS.entries()) {
        // Each screen on a fresh launch, opened at it: a link (simctl openurl)
        // would ask first whether to open it in hunt.
        spawnSync("xcrun", ["simctl", "terminate", sim, BUNDLE]);
        simctl("launch", sim, BUNDLE, "-huntServer", BASE, "-huntToken", token,
          "-huntRoute", typeof s.route === "function" ? s.route(ids) : s.route);
        await sleep(5000);
        const shot = join(raw, `${n + 1}-${s.name}-${theme}.png`);
        spawnSync("xcrun", ["simctl", "io", sim, "screenshot", "--type=png", shot], { stdio: "ignore" });
        await b.render(frame(device, s, theme, shot), device.width, device.height, join(OUT, device.dir, `${n + 1}-${s.name}-${theme}.png`));
        process.stdout.write(`  ${device.dir}/${n + 1}-${s.name}-${theme}.png\n`);
      }
    }
    simctl("status_bar", sim, "clear");
  }
  console.log(`app screenshots: in ${OUT}`);
} finally {
  b.close();
  server.kill();
  rmSync(work, { recursive: true, force: true });
}
