// The bar along the top of every page: the search (components/Search.tsx:
// the page's, or everything), what's coming up, and you (your photo, or
// your initials), with Settings, the admin centre and logging out in your
// menu. (The theme and the language are in the sidebar's foot.) On a
// phone, its tools are in the sidebar's bar, and searching opens a dialog.

import { useRef, useState } from "react";
import { isAdmin, myAccount } from "../lib/meta";
import { go } from "../lib/router";
import { phoneWidth } from "../lib/shell";
import { S, useShared, useStore } from "../lib/state";
import { DueMenu } from "./Due";
import { SearchField } from "./Search";
import { MenuButton, MenuItem } from "./Menu";
import { Icon, SysIcon } from "./ui";

// ---- you ------------------------------------------------------------------------------

/** Who you are, as far as hunt knows: your name and email address. */
function whoAmI() {
  const me = myAccount();
  const email: string = me?.email || S.META?.access?.email || S.META?.tenancy?.email || "";
  return { name: (me?.name as string | undefined)?.trim() || "", email };
}

/** Your initials: of your name's first and last words, or your email address's first letter. */
export function initials() {
  const { name, email } = whoAmI();
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length) return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
  return email ? email[0].toUpperCase() : "";
}

/** You, round: your photo, your initials when there's none, or a figure when hunt doesn't know you. */
export function Avatar({ size }: { size?: "sm" | "lg" | "xl" }) {
  useShared();
  const cls = `al-avatar${size ? ` al-avatar--${size}` : ""} me-avatar`;
  const photo = S.PREFS.photo as string | null | undefined;
  if (photo) return <img className={cls} src={`/api/settings/photo?v=${photo.slice(0, 12)}`} alt="" />;
  const letters = initials();
  return <span className={cls} aria-hidden="true" translate="no">{letters || <Icon name="user" />}</span>;
}

/** Where logging out goes: hunt's own sign-in, or Cloudflare Access's; none without either. */
function logoutHref() {
  const M = S.META;
  if (M?.tenancy?.account?.has_password) return "/logout";
  return M?.access ? "/cdn-cgi/access/logout" : null;
}

/**
 * Your badge, and its menu: who you are, Settings, the admin centre (for
 * admins), and logging out.
 */
function ProfileMenu() {
  useShared();
  const M = S.META;
  const { name, email } = whoAmI();
  const out = logoutHref();
  return (
    <MenuButton className="topbar-me" menuClassName="me-menu" label={name || email ? `Your account: ${name || email}` : "Your account"}
      items={(close) => <>
        {name || email ? (
          <div className="me-who">
            <Avatar />
            <div>{name ? <b translate="no">{name}</b> : null}{email ? <span className="muted small" translate="no">{email}</span> : null}</div>
          </div>
        ) : null}
        {name || email ? <hr className="al-menu__separator" /> : null}
        <MenuItem close={close} onClick={() => go("/settings")}><SysIcon name="settings" className="al-icon al-icon--sm" /><span>Settings</span></MenuItem>
        {M && isAdmin() ? <MenuItem close={close} onClick={() => go("/admin")}><Icon name="shield" className="al-icon al-icon--sm" /><span>Admin</span></MenuItem> : null}
        {out ? <>
          <hr className="al-menu__separator" />
          <MenuItem close={close} onClick={() => { location.href = out; }}><Icon name="logout" className="al-icon al-icon--sm al-mirror" /><span>Log out</span></MenuItem>
        </> : null}
      </>}>
      <Avatar />
    </MenuButton>
  );
}

/** On a phone: a button that opens the search in a dialog of its own. */
function SearchButton() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => dialog.current?.close();
  return <>
    <button type="button" className="al-button al-button--icon al-button--quiet topbar-button" aria-label="Search everything"
      onClick={() => { setOpen(true); dialog.current?.showModal(); }}>
      <SysIcon name="search" />
    </button>
    <dialog ref={dialog} className="al-dialog search-dialog" aria-label="Search everything" onClose={() => setOpen(false)}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      {open ? <SearchField autoFocus onDone={close} /> : null}
    </dialog>
  </>;
}

// ---- the bar ----------------------------------------------------------------------------

/**
 * What's at the bar's end: what's coming up, and you (Settings is in your
 * menu). Without an account that may use hunt yet, only you (to log out).
 */
export function TopBarTools({ phone, account }: { phone?: boolean; account?: boolean }) {
  if (account) return <div className="topbar-tools"><ProfileMenu /></div>;
  return (
    <div className="topbar-tools">
      {phone ? <SearchButton /> : null}
      <DueMenu />
      <ProfileMenu />
    </div>
  );
}

/** The bar along the top of the page, wider than a phone; on a phone, its tools are in the sidebar's bar. */
export function TopBar({ account }: { account: boolean }) {
  useShared();
  const phone = useStore(phoneWidth);
  if (phone) return null;
  return (
    <header className="topbar">
      {account ? <span /> : <SearchField />}
      <TopBarTools account={account} />
    </header>
  );
}
