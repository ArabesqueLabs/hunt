// hunt's logo as PNG files, for other apps and profiles: the boxed
// starburst from src/web/img/logo.svg, in the app's colours, drawn by
// headless Chrome at each size.
//
//   node scripts/logo.mjs        (or `make logo`)
//
// Writes docs/logo/:
//   logo-light-SIZE.png   the accent (teal) on the light theme's paper
//   logo-dark-SIZE.png    the accent (mint) on the dark theme's paper
//   logo-SIZE.png         the teal logo on a transparent background
//   avatar-light-SIZE.png, avatar-dark-SIZE.png
//                         padded for profile pictures, which crop to a circle
// Needs Node 22+ and Chrome or Chromium (CHROME= to say where).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT = "docs/logo";
const SIZES = [16, 32, 48, 64, 128, 180, 192, 256, 512, 1024];
const AVATARS = [400, 512, 1024];
// The app's colours (src/web/tokens.css): accent and paper, light and dark.
const THEMES = {
  light: { accent: "oklch(45.5% .079 176)", paper: "oklch(95.1% .005 100)" },
  dark: { accent: "oklch(82.5% .105 168)", paper: "oklch(18.2% .017 265)" },
};
const PORT = 9348;
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

// The logo, drawn in `accent`, its tick in `paper` (as the app draws it).
const svg = readFileSync("src/web/img/logo.svg", "utf8")
  .replace(/\swidth="28" height="28"/, ' width="100%" height="100%"')
  .replace('stroke="#fff"', 'stroke="var(--paper)"');

/** A page drawing the logo: `pad` is the margin, as a share of the side. */
function page({ accent, paper, background, pad }) {
  return `<!doctype html><html><head><style>
    html, body { margin: 0; width: 100vw; height: 100vh; background: ${background}; }
    body { display: grid; place-items: center; color: ${accent}; --paper: ${paper}; }
    .logo { width: ${100 - 2 * pad}vmin; height: ${100 - 2 * pad}vmin; }
    svg { display: block; overflow: visible !important; }
  </style></head><body><div class="logo">${svg}</div></body></html>`;
}

const profile = mkdtempSync(join(tmpdir(), "hunt-logo-"));
const proc = spawn(chrome(), ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, "--no-first-run", "--force-color-profile=srgb", "about:blank"], { stdio: "ignore" });
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page"); } catch { /* starting */ }
    if (!target) await sleep(200);
  }
  if (!target) throw new Error("Chrome didn't start");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const waiting = new Map();
  ws.addEventListener("message", (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable");
  // A transparent page shows through where nothing's drawn.
  await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });

  const draw = async (file, size, look) => {
    await send("Emulation.setDeviceMetricsOverride", { width: size, height: size, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: `data:text/html;base64,${Buffer.from(page(look)).toString("base64")}` });
    await sleep(250);
    const r = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: size, height: size, scale: 1 } });
    writeFileSync(join(OUT, file), Buffer.from(r.result.data, "base64"));
  };

  mkdirSync(OUT, { recursive: true });
  let n = 0;
  for (const size of SIZES) {
    // Small sizes keep a sliver of margin so the box's edge isn't cut.
    const pad = size <= 32 ? 2 : 4;
    for (const [name, t] of Object.entries(THEMES)) {
      await draw(`logo-${name}-${size}.png`, size, { ...t, background: t.paper, pad });
      n++;
    }
    await draw(`logo-${size}.png`, size, { ...THEMES.light, background: "transparent", pad });
    n++;
  }
  // Profile pictures are cropped to a circle: the box sits well inside it.
  for (const size of AVATARS) {
    for (const [name, t] of Object.entries(THEMES)) {
      await draw(`avatar-${name}-${size}.png`, size, { ...t, background: t.paper, pad: 18 });
      n++;
    }
  }
  console.log(`logo: ${n} images in ${OUT}`);
  ws.close();
} finally {
  // Chrome's profile goes once Chrome has gone.
  const gone = new Promise((r) => proc.once("exit", r));
  proc.kill();
  await Promise.race([gone, sleep(3000)]);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
