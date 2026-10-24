// The sidebar, the design system's (.al-sidebar): hunt's name, the cycles,
// what's coming up, the sections, and settings at its foot. In Settings and the admin centre,
// their sections take the app's place, with the way back to it. Full, or
// narrowed to its icons (remembered in this browser); on a phone, a bar
// with a menu.

import { useEffect, useState, type ReactNode } from "react";
// The logo, inline so it takes the theme's colours (its tick is drawn in
// the paper colour, to show on the accent in both themes).
import logoSvg from "../../img/logo.svg?raw";
import { initSidebars } from "../../vendor/arabesque/js/sidebar.js";
import { attempt, patch } from "../lib/api";
import { boardCycle, cycleWeek, endedCycles, pickCycle, runningCycles, viewedCycle } from "../lib/cycles";
import { longDate } from "../lib/format";
import { setLanguage, t } from "../lib/i18n";
import { isAdmin, siteName } from "../lib/meta";
import { go } from "../lib/router";
import { offerNav, sectionNav } from "../lib/shell";
import { S, useShared, useStore } from "../lib/state";
import { store } from "../lib/storage";
import { currentTheme, chooseTheme } from "../lib/theme";
import type { Cycle } from "../lib/types";
import { DueMenu } from "./Due";
import { FLAG, Icon, PathIcon, SysIcon } from "./ui";

const LOGO = logoSvg.trim().replace(/stroke="#fff"/g, 'style="stroke: var(--al-color-bg)"');
const Logo = () => <span className="brand-logo" style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: LOGO }} />;

/** A link in the sidebar: its icon (a path) and name. */
function NavLink({ href, nav, d, label, current, hidden, mini, children }: {
  href: string; nav: string; d: string; label: string; current: boolean; hidden?: boolean; mini: boolean; children?: ReactNode;
}) {
  return (
    <a className="al-sidebar__link" href={href} data-nav={nav} hidden={hidden} aria-current={current ? "page" : undefined} title={mini ? t(label) : undefined}>
      <svg className="al-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>
      <span className="al-sidebar__label">{label}{children}</span>
    </a>
  );
}

const SECTIONS: [string, string, string, string][] = [
  ["/", "board", "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 7v7M12 7v4M16 7v9", "Applications"],
  ["/cycles", "cycles", "M4 22V4M4 4h12l-2 4 2 4H4", "Cycles"],
  ["/calendar", "calendar", "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM16 2v4M8 2v4M3 10h18", "Calendar"],
  ["/prep", "prep", "M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2zM22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z", "Prep"],
  ["/contacts", "contacts", "M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21a8 8 0 0 1 16 0", "Contacts"],
  ["/files", "files", "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z", "Files"],
  ["/notes", "notes", "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5", "Notes"],
  ["/stats", "stats", "M3 3v18h18M8 17v-5M13 17V8M18 17v-8", "Stats"],
];
const TAKE_HOME = "M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h.01M16 19h.01";
const STAR = "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z";
const SLIDERS = "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6";
const SHIELD = "M12 3.5l7.5 3v5.5c0 4.3-3.1 7.6-7.5 8.5-4.4-.9-7.5-4.2-7.5-8.5V6.5z";
const LOGOUT = "M14.5 4.5h5v15h-5M10 8l-4 4 4 4M6 12h10";

/** The sidebar's section for a page: the board's pages are the board's, contacts' the contacts'. */
export function sectionOf(page: string, query: URLSearchParams) {
  return page === "" && query.get("cycle") ? "cycles"
    : ["", "p", "applications"].includes(page) ? "board"
      : ["companies", "people", "contacts"].includes(page) ? "contacts" : page;
}

export function Sidebar({ page, section, account }: { page: string; section: string; account: boolean }) {
  useShared();
  const offer = useStore(offerNav);
  const sections = useStore(sectionNav);
  const [mini, setMini] = useState(document.body.dataset.sidebar === "collapsed");
  useEffect(() => { initSidebars(); }, []);
  const toggle = () => {
    const next = !mini;
    if (next) document.body.dataset.sidebar = "collapsed";
    else delete document.body.dataset.sidebar;
    store("sidebar", next ? "mini" : "full");
    setMini(next);
  };
  const own = (page === "admin" || page === "settings") && sections ? sections : null;
  const here = SECTIONS.find(([, nav]) => nav === section)?.[3]
    ?? ({ "take-home": "Take-home pay", celebrate: "Your offer", settings: "Settings", admin: "Admin" } as Record<string, string>)[section] ?? "";
  const M = S.META;
  // Drawn into the page's own <aside> (the shell's child, as the design system lays it out).
  return (
    <>
      {/* On a phone: the logo, where you are, and the menu button (the design system's js/sidebar.js). */}
      <div className="al-sidebar__bar">
        <a className="brand" href="/" aria-label={`${siteName()}, the board`}><Logo /></a>
        <span className="al-sidebar__here" id="sidebar-here">{here}</span>
        <button type="button" className="al-button al-button--icon al-button--quiet al-sidebar__toggle" data-sidebar-menu-toggle aria-controls="sidebar-menu" aria-expanded="false" aria-label="Menu">
          <SysIcon name="menu" className="al-icon al-sidebar__open" /><SysIcon name="close" className="al-icon al-sidebar__close" />
        </button>
      </div>
      {/* The sidebar itself; on a phone, the menu that drops below the bar. */}
      <div className="al-sidebar__menu" id="sidebar-menu">
        <a className="brand" href="/" aria-label={`${siteName()}, the board`}>
          <Logo />
          <span className="al-sidebar__label" translate={S.META?.about?.name ? "no" : undefined}>{siteName()}</span>
        </a>
        {account ? null : <CycleBox page={page} />}
        {account || !S.META ? null : <div className="due-box"><DueMenu mini={mini} /></div>}
        <nav className="al-sidebar__nav app-nav" aria-label="Sections">
          {SECTIONS.map(([href, nav, d, label]) => <NavLink key={nav} href={href} nav={nav} d={d} label={label} current={nav === section} mini={mini} />)}
          <NavLink href="/take-home" nav="take-home" d={TAKE_HOME} label="Take-home pay " current={section === "take-home"} mini={mini}>
            <svg className="uk-flag" viewBox="0 0 60 30" role="img" aria-label="UK only, for now"><title>UK only, for now</title><clipPath id="uk-flag-t"><path d="M30 15h30v15zv15H0zH0V0zV0h30z" /></clipPath><path d="M0 0v30h60V0z" fill="#012169" /><path d="M0 0l60 30m0-30L0 30" stroke="#fff" strokeWidth="6" /><path d="M0 0l60 30m0-30L0 30" clipPath="url(#uk-flag-t)" stroke="#c8102e" strokeWidth="4" /><path d="M30 0v30M0 15h60" stroke="#fff" strokeWidth="10" /><path d="M30 0v30M0 15h60" stroke="#c8102e" strokeWidth="6" /></svg>
          </NavLink>
          <NavLink href="/celebrate" nav="celebrate" d={STAR} label="Your offer" current={section === "celebrate"} hidden={!offer} mini={mini} />
        </nav>
        {/* In Settings and the admin centre, their sections in the app's place, and the way back to the app. */}
        <nav className="al-sidebar__nav section-nav" id="section-nav" aria-label={own?.label}>
          {own ? <>
            <a className="al-sidebar__link section-back" href="/"><Icon name="back" className="al-icon al-mirror" /><span className="al-sidebar__label">{`Back to ${siteName()}`}</span></a>
            {own.tabs.map(([k, text, hint, ic]) => (
              <a key={k} className="al-sidebar__link" href={`/${own.base}?tab=${k}`} id={`${own.base}-tab-${k}`} title={hint || undefined} aria-current={k === own.tab ? "page" : undefined}>
                <Icon name={ic} className="al-icon" /><span className="al-sidebar__label">{text}</span>
              </a>
            ))}
          </> : null}
        </nav>
        <div className="al-sidebar__foot">
          {/* The theme and the language, a click away. */}
          <QuickSettings />
          <nav className="al-sidebar__nav" aria-label="Settings">
            <NavLink href="/settings" nav="settings" d={SLIDERS} label="Settings" current={section === "settings"} mini={mini} />
            <NavLink href="/admin" nav="admin" d={SHIELD} label="Admin" current={section === "admin"} hidden={!(M && isAdmin())} mini={mini} />
            {/* Behind Cloudflare Access, its log out; with a password, hunt's own. */}
            <a className="al-sidebar__link" href={M?.password && !M?.access ? "/logout" : "/cdn-cgi/access/logout"} id="logout" hidden={!M || (!M.access && !M.password)}
              title={M?.access?.email ? `Signed in as ${M.access.email}` : mini ? t("Log out") : undefined}>
              <svg className="al-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={LOGOUT} /></svg><span className="al-sidebar__label">Log out</span>
            </a>
          </nav>
          <button type="button" className="al-sidebar__link al-sidebar__collapse" id="sidebar-toggle" aria-expanded={String(!mini) as "true" | "false"} title={mini ? t("Expand sidebar") : ""} onClick={toggle}>
            <SysIcon name="sidebar" className="al-icon al-mirror" /><span className="al-sidebar__label">{mini ? "Expand sidebar" : "Collapse sidebar"}</span>
          </button>
          {/* The version, linked to its release on GitHub (tagged v0.2.0 …). */}
          <p className="app-version" id="version">
            {M?.version ? <a href={`https://github.com/ArabesqueLabs/hunt/releases/tag/v${M.version}`} target="_blank" rel="noreferrer" title={`Release notes for hunt ${M.version}`}>{`hunt ${M.version}`}<Icon name="external" /></a> : null}
          </p>
        </div>
      </div>
    </>
  );
}

/**
 * In the sidebar's foot, on every page: the theme (light, dark, or as the
 * system is) and the language (the next one hunt
 * speaks, named in itself), each a click away.
 */
function QuickSettings() {
  useShared();
  const now = currentTheme();
  const [busy, setBusy] = useState(false);
  const M = S.META;
  if (!M?.languages) return <div className="quick-settings" id="quick-settings" role="group" aria-label="Quick settings" />;
  const THEME_NEXT: Record<string, string> = { light: "dark", dark: "auto", auto: "light" };
  const themeName: Record<string, string> = { light: "Light", dark: "Dark", auto: "Match the system" };
  const langs = M.languages;
  const here = S.PREFS.language || "en";
  const other = langs[(langs.findIndex((l) => l.value === here) + 1) % langs.length];
  return (
    <div className="quick-settings" id="quick-settings" role="group" aria-label="Quick settings">
      <button className="al-sidebar__link quick-theme" type="button" title={`Theme: ${themeName[now]}`} aria-label={`Theme: ${themeName[now]}. Change to ${themeName[THEME_NEXT[now]]}`}
        onClick={() => chooseTheme(THEME_NEXT[now])}>
        <SysIcon name="theme" /><span className="al-sidebar__label">{themeName[now]}</span>
      </button>
      {other && other.value !== here ? (
        <button className="al-sidebar__link quick-language" type="button" lang={other.value} title={other.label} aria-busy={busy ? "true" : undefined}
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            const saved = await attempt(() => patch("settings", { language: other.value }));
            if (!saved) { setBusy(false); return; }
            S.PREFS = saved;
            setLanguage(saved.language, saved.numerals);
            location.reload();
          }}>
          <SysIcon name="language" /><span className="al-sidebar__label" translate="no">{other.label.replace(/\s*\(.*\)$/, "")}</span>
        </button>
      ) : null}
    </div>
  );
}

/**
 * Under hunt's name: a box for each running cycle, saying how far along it
 * is; the ones the board shows are marked. Choosing one shows it alone;
 * choosing it again, every running one. An ended cycle being looked at has
 * a box too. Collapsed, each is its flag.
 */
function CycleBox({ page }: { page: string }) {
  if (!S.META || !S.CYCLES) return <div className="cycle-box" id="cycle-box" hidden />;
  const run = runningCycles();
  const viewing = viewedCycle();
  const chosen = boardCycle();
  const onBoard = ["", "applications", "stats"].includes(page);
  const card = (c: Cycle, { current, meta, onClick, past = false }: { current: boolean; meta: string; onClick: () => void; past?: boolean }) => (
    <button key={`${past ? "past" : "run"}-${c.id}`} className={`al-sidebar__link cycle-card${past ? " is-past" : ""}`} type="button" aria-current={current ? "true" : undefined}
      title={`${c.name}: ${meta}`} onClick={onClick}>
      <PathIcon d={FLAG} className="al-icon" />
      <span className="al-sidebar__label cycle-what">
        <span className="cycle-name"><span className="cycle-name-text" translate="no">{c.name}</span>
          {past ? null : <span className="al-badge al-badge--accent">Active</span>}</span>
        <span className="cycle-meta">{meta}</span>
      </span>
    </button>
  );
  const cards: ReactNode[] = run.map((c) => {
    const shown = !viewing && (chosen === "" || String(c.id) === chosen);
    return card(c, {
      current: shown && onBoard,
      meta: `Week ${cycleWeek(c)} · ${c.counts.active} active`,
      // This one alone; again, when it's the one shown, every running one.
      onClick: () => pickCycle(run.length > 1 && String(c.id) === chosen && onBoard ? "" : c.id),
    });
  });
  if (viewing) cards.push(card(viewing, { current: true, past: true, meta: `Ended ${longDate(viewing.ended_on)} · read-only`, onClick: () => go(`/?cycle=${viewing.id}`) }));
  if (!run.length && !viewing) {
    const last = endedCycles()[0];
    cards.push(
      <a key="none" className="al-sidebar__link cycle-card is-past" href="/cycles" title="No active cycle">
        <PathIcon d={FLAG} className="al-icon" />
        <span className="al-sidebar__label cycle-what"><span className="cycle-name">No active cycle</span>
          <span className="cycle-meta">{last ? `Last: ${last.name}` : "Start one"}</span></span>
      </a>,
    );
  }
  return <div className="cycle-box" id="cycle-box"><div className="cycle-cards" role="group" aria-label="Cycles">{cards}</div></div>;
}
