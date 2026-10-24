// What the service says about itself (GET /api/meta): its resources and
// their fields, the reasons a process closes, the experiments on, and who's
// signed in; with the settings and the tags, loaded together.

import { get } from "./api";
import { loadCycles } from "./cycles";
import { S, changed } from "./state";
import type { Choice, ResourceDef, Row } from "./types";

/** A resource's description, by its name (applications) or entity (application). */
export const R = (name: string): ResourceDef => S.META.resources.find((r) => r.name === name || r.entity === name) as ResourceDef;
/** A field of a resource. */
export const fieldOf = (resource: string, name: string) => R(resource).fields.find((f) => f.name === name)!;
export const optionLabel = (options: [string, string][], v: string) => (options.find(([value]) => value === v) || [v, v])[1];
export const archiveReason = (v: string) => (S.META.archive_reasons.find((r) => r.value === v) || { label: v }).label;
/** Why a closed process is closed: its reason (the lane it's in), or else the inactive stage it's in. */
export const closedWhy = (p: Row, stage = p.stage) => (p.archive_reason ? archiveReason(p.archive_reason) : stage || "Closed");
/** An editable list's {value, label}s, for a `choice` field. */
export const choicesOf = (resource?: string): Choice[] => (resource === "reasons" ? S.META.archive_reasons : []);

/** The label of a {value, label} choice. */
export const choiceLabel = (choices: Choice[], v: string | null | undefined) => (choices.find((c) => c.value === v) || { label: v as string }).label;

/** The currencies pay can be shown in. */
export const CURRENCIES = ["GBP", "EUR", "USD", "CAD", "AUD", "NZD", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF",
  "JPY", "CNY", "HKD", "SGD", "INR", "KRW", "ZAR", "BRL", "MXN", "ILS", "TRY"];

/** Whether an experiment is on for whoever's signed in (`hunt serve --experiment`). */
export const trying = (name: string) => (S.META?.experiments || []).includes(name);

/** Take-home pay works out UK tax: for those who live in the UK (Settings → Location). */
export const takeHomeOn = () => !!S.PREFS.uk_resident;

/**
 * A page of this hunt's website (its terms of use, privacy notice…): run
 * for others, hunt has one (META.site). In English for now: careerhunt.app's
 * Arabic pages wait for their translation to be reviewed. Once they're
 * published, give Arabic readers theirs, under /ar.
 */
export const sitePage = (path: string) => `${S.META.site}${path}`;

// ---- several people ----------------------------------------------------------------------

/** Whether hunt is shared, and this person may use it: else the account screen. */
export const tenancy = () => S.META.tenancy || null;
export const myAccount = () => tenancy()?.account || null;
export const isAdmin = () => myAccount()?.role === "admin" && myAccount()?.status === "active";

/** This hunt's name: as its admins name it, or hunt's own. */
export const siteName = () => S.META?.about?.name || "hunt";

/** Reload what the forms offer: archive reasons, tags. */
export async function reloadMeta() {
  S.META = await get("meta");
  // Shared, without an account that may use it: nothing else to load.
  if (S.META.tenancy && S.META.tenancy.account?.status !== "active") { changed(); return; }
  [S.TAGS, S.PREFS] = await Promise.all([get("tags"), get("settings")]);
  await loadCycles();
  changed();
}

/** Reload the tags, as they're suggested and filtered by. */
export async function reloadTags() {
  S.TAGS = await get("tags");
  changed();
}
