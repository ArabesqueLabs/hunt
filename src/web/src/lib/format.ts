// Dates, times, money and numbers, as Settings say to write them: the
// region, the clock, the week, the time zone and the home currency.

import { CATALOGS, LANG } from "./i18n";
import { S } from "./state";
import type { Row } from "./types";

/**
 * The locale dates and numbers are written for: the region chosen, or else
 * the language's (the browser's, for English); with the digits chosen in
 * Settings, or the language's own.
 */
export function LOC(): string | undefined {
  const base: string | undefined = S.PREFS.locale || (LANG !== "en" ? LANG : undefined);
  const digits = S.PREFS.numerals && S.PREFS.numerals !== "auto" ? S.PREFS.numerals : CATALOGS[LANG]?.digits;
  if (!digits || base?.includes("-u-")) return base;
  return `${base || navigator.language}-u-nu-${digits}`;
}

/** A number as the region writes it; a dash for none. */
export const nf = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString(LOC()));

/**
 * Now, as the clock reads in the time zone chosen in Settings (the
 * browser's, if none): a Date whose local fields are that zone's.
 */
export function zonedNow(): Date {
  const now = new Date();
  if (!S.PREFS.timezone) return now;
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: S.PREFS.timezone, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(now).map((x) => [x.type, x.value]));
    return new Date(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  } catch { return now; }
}

/** Today's date, YYYY-MM-DD, in hunt's time zone. */
export const isoToday = () => { const d = zonedNow(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** A time of day ("14:30") as the clock setting has it. */
export function fmtTime(hhmm: string | null | undefined): string {
  if (!hhmm) return "";
  if (S.PREFS.clock === "24") return hhmm;
  const [hr, min] = hhmm.split(":").map(Number);
  const d = new Date(2000, 0, 1, hr, min);
  return d.toLocaleTimeString(LOC(), { hour: "numeric", minute: "2-digit", ...(S.PREFS.clock === "12" ? { hour12: true } : {}) });
}

/** "2026-10-09" or "2026-10-09T15:00", as a local Date. */
export function parseLocal(s: string): Date;
export function parseLocal(s: string | null | undefined): Date | null;
export function parseLocal(s: string | null | undefined): Date | null {
  if (!s) return null;
  const [d, t = "00:00"] = s.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [hh, mm] = t.split(":").map(Number);
  return new Date(y, m - 1, day, hh, mm);
}

export function daysFromToday(date: Date | string | number): number {
  const a = zonedNow();
  a.setHours(0, 0, 0, 0);
  const b = new Date(date);
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 864e5);
}

/** A date for people: Today, Tomorrow, Fri, 9 Oct; with the time if set. */
export function fmtDay(s: string | null | undefined): string {
  const d = parseLocal(s);
  if (!d || !s) return "";
  const n = daysFromToday(d);
  const thisYear = d.getFullYear() === zonedNow().getFullYear();
  let day;
  if (n === 0) day = "Today";
  else if (n === 1) day = "Tomorrow";
  else if (n === -1) day = "Yesterday";
  else if (n > 1 && n < 7) day = d.toLocaleDateString(LOC(), { weekday: "short" });
  else day = d.toLocaleDateString(LOC(), { day: "numeric", month: "short", year: thisYear ? undefined : "numeric" });
  const hasTime = s.includes("T") && !s.endsWith("T00:00");
  return hasTime ? `${day} ${fmtTime(s.slice(11, 16))}` : day;
}

export function fmtStamp(s: string | null | undefined): string {
  if (!s) return "";
  return `${fmtDay(s.slice(0, 10))} ${fmtTime(s.slice(11, 16))}`;
}

/** A date as a cycle's are written: 18 Aug 2026. */
export const longDate = (iso: string | null | undefined) => (iso ? parseLocal(iso).toLocaleDateString(LOC(), { day: "numeric", month: "short", year: "numeric" }) : "");

/** A reminder or step's time has passed: a day before today, or a time before now. */
export function isOverdue(at: string | null | undefined): boolean {
  if (!at) return false;
  const d = parseLocal(at);
  return at.length > 10 && !at.endsWith("T00:00") ? d < zonedNow() : daysFromToday(d) < 0;
}

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ---- money in the home currency -------------------------------------------------------
// Pay is converted to GBP when it's saved, and kept that way; it's shown in
// the home currency (Settings → Appearance), at one rate from GBP.

/** The home currency, while hunt has a rate for it; GBP until then. */
export const HOME = (): string => (S.PREFS.currency && S.PREFS.currency_rate ? S.PREFS.currency : "GBP");

/** A GBP amount in the home currency. */
export const fromGbp = (n: number | null | undefined) => (n == null ? null : HOME() === "GBP" ? n : n / S.PREFS.currency_rate);

/** An application's (or card's) pay in the home currency: [min, max], or null. */
export function homePay(a: Row): [number | null, number | null] | null {
  const cur = (a.currency || "").toUpperCase();
  if (a.salary_min == null && a.salary_max == null) return null;
  if (!cur || cur === HOME()) return [a.salary_min, a.salary_max];
  if (cur === "GBP") return [fromGbp(a.salary_min), fromGbp(a.salary_max)];
  if (a.salary_min_gbp == null && a.salary_max_gbp == null) return null;
  return [fromGbp(a.salary_min_gbp), fromGbp(a.salary_max_gbp)];
}

/** A currency's symbol where it has a well-known one, else its code. */
export const curSym = (code: string | null | undefined): string | undefined =>
  ({ GBP: "£", USD: "$", EUR: "€", JPY: "¥", INR: "₹" } as Record<string, string>)[(code || "").toUpperCase()];

/** Text that reads left to right (an amount: £85k–100k/yr), kept whole on a right-to-left page. */
export const ltr = (s: string) => (document.documentElement.dir === "rtl" && s ? `⁦${s}⁩` : s);

/** An amount in the home currency, short: £150k, €95k, CHF 120k. */
export function homeK(n: number | null | undefined): string {
  if (n == null) return "—";
  const v = n >= 10000 ? `${Math.round(n / 1000)}k` : Math.round(n).toLocaleString(LOC());
  const sym = curSym(HOME());
  return ltr(sym ? `${sym}${v}` : `${HOME()} ${v}`);
}

export function fmtMoney(min: number | null | undefined, max: number | null | undefined, currency?: string | null, period?: string | null): string {
  if (min == null && max == null) return "";
  const sym = curSym(currency);
  // 150000 → 150k; 101856 → 101.9k; small amounts (hourly pay) as they are.
  const k = (n: number) => {
    if (n < 10000) return Math.round(n).toLocaleString(LOC());
    const t = n / 1000;
    return `${Number.isInteger(t) ? t : t.toFixed(1).replace(/\.0$/, "")}k`;
  };
  const m = (n: number) => (sym ? sym + k(n) : k(n));
  // A range, or one figure when it's fixed (or only one end is given).
  const range = min != null && max != null && min !== max ? `${m(min)}–${k(max)}` : m((min ?? max) as number);
  const per = period ? ({ year: "/yr", month: "/mo", day: "/day", hour: "/hr" } as Record<string, string>)[period] : "";
  return ltr(`${range}${sym || !currency ? "" : " " + currency}${per}`);
}

/** Pay as typed ("£85k–100k", "95,000 a year", "$600/day"): {salary_min, salary_max, currency, pay_period}, or null. */
export function parsePay(text: string | null | undefined) {
  const t = (text || "").trim();
  if (!t) return null;
  const sym: Record<string, string> = { "£": "GBP", "$": "USD", "€": "EUR", "¥": "JPY", "₹": "INR" };
  const code = t.match(/\b([A-Z]{3})\b/)?.[1] || sym[t.match(/[£$€¥₹]/)?.[0] ?? ""] || null;
  const nums = [...t.replace(/,(?=\d{3})/g, "").matchAll(/(\d+(?:\.\d+)?)\s*(k|m)?/gi)]
    .map(([, n, unit]) => Number(n) * (/k/i.test(unit || "") ? 1e3 : /m/i.test(unit || "") ? 1e6 : 1));
  if (!nums.length) return null;
  // "85–100k": the first takes the second's thousands.
  if (nums.length > 1 && nums[0] < 1000 && nums[1] >= 1000 && !/\d\s*k/i.test(t.split(/[-–]/)[0])) nums[0] *= 1000;
  const period = /day|\/d\b|daily/i.test(t) ? "day" : /hour|\/h|hourly/i.test(t) ? "hour" : /month|\/mo/i.test(t) ? "month" : "year";
  return { salary_min: Math.round(nums[0]), salary_max: Math.round(nums[1] ?? nums[0]), currency: code || HOME(), pay_period: period };
}
