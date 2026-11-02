// Which hunt this app talks to, and as whom. The server's address and a
// personal access token are kept in the phone's secure storage; the
// password never is. Signing in sends the address and password once, as
// the CLI does (Authorization: Basic), to make a token with full access:
// the API takes it from then on (Authorization: Bearer).

import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { ApiError, configureApi } from "@web/api";
import { reloadMeta } from "@web/meta";
import { S, createStore, useStore } from "@web/state";

export type Session =
  | { status: "loading" }
  /** Not connected: no server yet, or one that needs signing in to. */
  | { status: "out"; server: string | null; needsSignIn: boolean }
  /** The server couldn't be reached, or didn't answer as a hunt. */
  | { status: "unreachable"; server: string; message: string }
  | { status: "in"; server: string; email: string | null };

const SERVER = "hunt.server";
const TOKEN = "hunt.token";

export const session = createStore<Session>({ status: "loading" });
export const useSession = () => useStore(session);

let token: string | null = null;

/** Talk to `server`'s API, with the token if there is one. */
function point(server: string) {
  configureApi({
    base: `${server}/api/`,
    headers: (): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {}),
    failed: (status, data) => {
      // The token was revoked (Settings → Connected apps): sign in again.
      if (status === 401 && data?.account === "signed-out" && session.get().status === "in") {
        forgetToken().then(() => session.set({ status: "out", server, needsSignIn: true }));
      }
    },
  });
}

/** An address as typed: https:// unless it says otherwise, without a trailing slash. */
export function normalizeServer(typed: string): string {
  let s = typed.trim().replace(/\/+$/, "");
  if (s && !/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s.replace(/\/api$/, "");
}

/**
 * Whether `server` answers as a hunt: what it says about itself, loaded
 * into S.META (and, signed in, the settings, tags and cycles). An error
 * that says what's wrong, if not.
 */
async function reach(server: string): Promise<void> {
  point(server);
  try {
    await reloadMeta();
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new Error(`Couldn't reach ${server}. Check the address, and that this phone can get to it.`);
  }
  if (!Array.isArray(S.META?.resources)) {
    throw new Error(`${server} didn't answer as a hunt. If it's behind Cloudflare Access or a sign-in proxy, the app can't sign in to it yet.`);
  }
  // A new hunt, on its launcher: its owner is made there, in a browser.
  if (S.META.setup) throw new Error(`${server} is a new hunt: open it in a browser to set it up, then sign in here.`);
}

/** Whoever's signed in on the hunt reached, if anyone is (or it needs no one). */
function signedIn(): boolean {
  const t = S.META.tenancy;
  // A hunt without its own sign-in, or with no accounts yet: open to whoever reaches it.
  if (!t || !t.built_in) return true;
  return !!t.signed_in;
}

/**
 * The App Store's screenshots (scripts/app-screenshots.mjs), on a simulator
 * nothing can type into or tap: a build bundled with
 * EXPO_PUBLIC_SCREENSHOTS=1, launched with -huntServer, -huntToken and
 * -huntRoute, is signed in as those say and opens at that screen. Other
 * builds leave this out.
 */
export function screenshotArgs(): { server: string; token: string; route: string | null } | null {
  if (!process.env.EXPO_PUBLIC_SCREENSHOTS || Platform.OS !== "ios") return null;
  const { Settings } = require("react-native") as typeof import("react-native");
  const [server, token, route] = [Settings.get("huntServer"), Settings.get("huntToken"), Settings.get("huntRoute")];
  if (typeof server !== "string" || typeof token !== "string") return null;
  return { server, token, route: typeof route === "string" ? route : null };
}

/** As the app opens: the server and token kept, if they still work. */
export async function restore() {
  const shot = screenshotArgs();
  if (shot) {
    await SecureStore.setItemAsync(SERVER, shot.server);
    await SecureStore.setItemAsync(TOKEN, shot.token);
  }
  const server = await SecureStore.getItemAsync(SERVER);
  token = await SecureStore.getItemAsync(TOKEN);
  if (!server) {
    session.set({ status: "out", server: null, needsSignIn: false });
    return;
  }
  try {
    await reach(server);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      await forgetToken();
      session.set({ status: "out", server, needsSignIn: true });
    } else {
      session.set({ status: "unreachable", server, message: (e as Error).message });
    }
    return;
  }
  if (signedIn()) session.set({ status: "in", server, email: S.META.tenancy?.email ?? null });
  else {
    await forgetToken();
    session.set({ status: "out", server, needsSignIn: true });
  }
}

/** Use the hunt at `typed`: signed in already if it needs no one, else asking to sign in. */
export async function connect(typed: string): Promise<void> {
  const server = normalizeServer(typed);
  if (!/^https?:\/\/[^/\s]+/i.test(server)) throw new Error("That isn't a web address: something like https://hunt.example.com.");
  token = null;
  await reach(server);
  await SecureStore.setItemAsync(SERVER, server);
  await forgetToken();
  if (signedIn()) session.set({ status: "in", server, email: S.META.tenancy?.email ?? null });
  else session.set({ status: "out", server, needsSignIn: true });
}

/** An `Authorization: Basic` header for an address and password (UTF-8, as hunt reads it). */
function basic(email: string, password: string): string {
  const bytes = new TextEncoder().encode(`${email}:${password}`);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `Basic ${btoa(binary)}`;
}

/** What this phone's token is called, in Settings → Connected apps. */
const tokenName = () => `hunt app (${Platform.OS === "ios" ? "iOS" : Platform.OS === "android" ? "Android" : Platform.OS})`;

/** Sign in to the server chosen: its address and password, for a token. */
export async function signIn(email: string, password: string): Promise<void> {
  const s = session.get();
  if (s.status !== "out" || !s.server) throw new Error("Choose a hunt first.");
  const server = s.server;
  let res: Response;
  try {
    res = await fetch(`${server}/api/tokens`, {
      method: "POST",
      headers: { Authorization: basic(email.trim(), password), "Content-Type": "application/json" },
      body: JSON.stringify({ name: tokenName(), scope: "full" }),
    });
  } catch {
    throw new Error(`Couldn't reach ${server}.`);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error("That address and password don't match an account here.");
  if (!res.ok || typeof data.secret !== "string") throw new Error(data.error || `${res.status} ${res.statusText}`);
  token = data.secret;
  await SecureStore.setItemAsync(TOKEN, data.secret);
  await reach(server);
  session.set({ status: "in", server, email: S.META.tenancy?.email ?? email.trim() });
}

async function forgetToken() {
  token = null;
  await SecureStore.deleteItemAsync(TOKEN);
}

/**
 * Sign out: this phone forgets its token. (A token can't revoke itself:
 * it stays in Settings → Connected apps on the web, to revoke there.)
 */
export async function signOut() {
  const s = session.get();
  await forgetToken();
  const server = s.status === "loading" ? null : s.server;
  session.set({ status: "out", server, needsSignIn: !!server });
}

/** Use another hunt: forget this one, and its token. */
export async function forgetServer() {
  await forgetToken();
  await SecureStore.deleteItemAsync(SERVER);
  session.set({ status: "out", server: null, needsSignIn: false });
}
