// The app: the sidebar, the page at the address, and what floats over them
// (the modal, questions, toasts, a tag's colours).

import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { get } from "./lib/api";
import { BOARD_SEL } from "./lib/board";
import { runningCycles, viewedCycle } from "./lib/cycles";
import { LISTS } from "./lib/lists";
import { tenancy } from "./lib/meta";
import { go, opensEditing, useVisit } from "./lib/router";
import { baseTitle } from "./lib/shell";
import { S, useShared } from "./lib/state";
import { store, stored } from "./lib/storage";
import { toast } from "./lib/toast";
import { DialogStack, ModalHost } from "./components/dialogs";
import { SysIcon } from "./components/ui";
import { importSentProfile } from "./components/importer";
import { newApplication } from "./components/NewApplication";
import { Sidebar, sectionOf } from "./components/Sidebar";
import { TagColoursHost } from "./components/tags";
import { Toaster } from "./components/Toaster";
import { AccountScreen, AdminPage } from "./pages/Account";
import { ActivityPage } from "./pages/Activity";
import { ApplicationPage } from "./pages/Application";
import { Home } from "./pages/Board";
import { CalendarPage } from "./pages/Calendar";
import { CelebratePage } from "./pages/Celebrate";
import { CyclesPage } from "./pages/Cycles";
import { StashPage, SentToStash, quickCapture } from "./pages/Stash";
import { Launcher } from "./pages/Launcher";
import { ContactsPage, ListPage, NewRecord } from "./pages/Lists";
import { NotesPage } from "./pages/Notes";
import { PrepPage } from "./pages/Prep";
import { RecordPage } from "./pages/Record";
import { SettingsPage } from "./pages/Settings";
import { StatsPage } from "./pages/Stats";
import { TablePage } from "./pages/Table";
import { TakeHomePage } from "./pages/TakeHome";

/** A profile sent by the “Send to hunt” bookmark: People, and choosing what to keep of it. */
function SentProfile() {
  const [data] = useState(() => {
    const d = new URLSearchParams(location.search).get("d");
    // Off the address bar, so going back or reloading doesn't import it again.
    history.replaceState(null, "", "/people");
    return d;
  });
  useEffect(() => { importSentProfile(data, (path) => go(path)).catch((e) => toast(e.message, "error")); }, [data]);
  return <ListPage page="people" />;
}

/** A process: its application's page (older links, the calendar, the log). */
function ProcessLink({ id }: { id: string }) {
  useEffect(() => {
    get(`processes/${id}`)
      .then((p) => go(`/applications/${p.application_id}?process=${p.id}`, { replace: true }))
      .catch((e) => toast(e.message, "error"));
  }, [id]);
  return null;
}

/** Contacts, as they were last left: all of them, or companies or people. */
function Contacts() {
  const kept = stored("contacts");
  const to = ["companies", "people"].includes(kept || "") && !new URLSearchParams(location.search).has("all") ? `/${kept}` : null;
  useEffect(() => { if (to) go(to, { replace: true }); }, [to]);
  return to ? null : <ContactsPage />;
}

/** The page at the address now. */
function Page({ page, arg }: { page: string; arg?: string }) {
  const query = new URLSearchParams(location.search);
  if (location.pathname === "/linkedin") return <SentProfile />;
  if (page === "") return <Home />;
  if (page === "applications" && !arg) return <TablePage />;
  if (page === "p" && arg) return <ProcessLink id={arg} />;
  if (page === "stash" && arg === "new") return <SentToStash />;
  if (page === "applications" && arg) return <ApplicationPage id={Number(arg)} processId={Number(query.get("process")) || null} editing={opensEditing(query)} />;
  if (LISTS[page]) {
    if (arg === "new") return <NewRecord page={page} />;
    if (arg) return <RecordPage page={page} id={Number(arg)} versionId={Number(query.get("version")) || null} editing={opensEditing(query)} />;
    return <ListPage page={page} />;
  }
  const pages: Record<string, () => ReactNode> = {
    contacts: () => <Contacts />,
    cycles: () => <CyclesPage />,
    stash: () => <StashPage />,
    tasks: () => <PrepPage />,
    // Tasks were called Prep: its old address leads there.
    prep: () => <Moved to={`/tasks${location.search}`} />,
    calendar: () => <CalendarPage />,
    settings: () => <SettingsPage />,
    notes: () => <NotesPage />,
    stats: () => <StatsPage />,
    activity: () => <ActivityPage />,
    celebrate: () => <CelebratePage />,
    admin: () => <AdminPage />,
    "take-home": () => <TakeHomePage />,
  };
  if (pages[page]) return <>{pages[page]()}</>;
  return <Elsewhere />;
}

/**
 * The admins' notice, over every page, for everyone: until closed, in this
 * browser (a new notice shows again).
 */
function Announcement() {
  const text = S.META?.about?.announcement;
  const [closed, setClosed] = useState(() => stored("announcementClosed"));
  if (!text || closed === text) return null;
  return (
    <div className="al-notice al-notice--info announcement" role="status">
      <SysIcon name="info" />
      <div className="al-notice__body" translate="no">{text}</div>
      <button className="al-button al-button--icon al-button--sm al-button--quiet al-notice__dismiss" type="button" aria-label="Close the notice"
        onClick={() => { store("announcementClosed", text); setClosed(text); }}><SysIcon name="close" className="al-icon al-icon--sm" /></button>
    </div>
  );
}

/** A page that has a new address: it, in this one's place. */
function Moved({ to }: { to: string }) {
  useEffect(() => { go(to, { replace: true }); }, [to]);
  return null;
}

/** An address that isn't one of hunt's pages: the board. */
function Elsewhere() {
  useEffect(() => { go("/", { replace: true }); }, []);
  return null;
}

export function App() {
  useShared();
  const visit = useVisit();
  // A new hunt, or one without an owner yet: its launcher, until it's done.
  const launching = !!S.META.setup;
  // Not (yet) theirs: the account screen, and nothing else.
  const account = !launching && tenancy()?.account?.status !== "active";
  const [, page = "", arg] = location.pathname.split("/");
  const section = sectionOf(page, new URLSearchParams(location.search));
  // Settings and the admin centre have the sidebar to themselves, each in its own colour.
  useLayoutEffect(() => {
    document.body.classList.toggle("admin-mode", page === "admin");
    document.body.classList.toggle("settings-mode", page === "settings");
    // Pages that put their own title first set it as they draw.
    if (!(LISTS[page] && arg && arg !== "new")) document.title = baseTitle();
  }, [visit]);
  // N, anywhere but in a field or a dialog: add an application. I: keep
  // something in the stash.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!["n", "i"].includes(e.key) || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if ((e.target as Element).closest?.("input, textarea, select, [contenteditable], dialog[open]") || document.querySelector("dialog[open]")) return;
      if (account || launching) return;
      if (e.key === "i") { e.preventDefault(); quickCapture(); return; }
      if (!runningCycles().length || viewedCycle()) return;
      e.preventDefault();
      newApplication();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [account, launching]);
  // Leaving the board lets go of what's selected on it.
  useEffect(() => { if (page !== "") BOARD_SEL.clear(); }, [page]);
  // The sidebar and the page in the page's own <aside> and <main>, the
  // shell's children; what floats over them, here.
  if (launching) {
    return <>{createPortal(<Launcher />, document.getElementById("view")!)}<ModalHost /><DialogStack /><Toaster /></>;
  }
  return (
    <>
      {createPortal(<Sidebar page={page} section={section} account={account} />, document.getElementById("sidebar")!)}
      {createPortal(<><Announcement />{account ? <AccountScreen /> : <Page key={visit} page={page} arg={arg} />}</>, document.getElementById("view")!)}
      <ModalHost />
      <DialogStack />
      <Toaster />
      <TagColoursHost />
    </>
  );
}
