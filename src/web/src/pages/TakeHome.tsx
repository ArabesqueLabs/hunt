// Take-home pay (/take-home), an experiment (`hunt serve --experiment
// take-home=…`), for those who live in the UK (Settings → Location). Pay
// information first: gross pay offered, or the take-home pay wanted; as an
// employee (PAYE), a contractor inside IR35 (through an umbrella company)
// or outside it (through your own limited company), or all three side by
// side; and the amount, its currency and pay period. Then what that choice
// needs (a bonus, a working pattern, the umbrella's or the company's
// costs), and about you (tax year, student loans, pension). It works out
// the take-home pay, or the salary or rate that leaves what's wanted. The
// sums are the service's (/api/take-home): the page asks again as things
// are typed. What was typed is remembered, in this browser, and
// applications that give their pay show what it would leave
// (TakeHomeLine).

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { attempt, get, patch, post } from "../lib/api";
import { LOC, fmtMoney, fromGbp, HOME, homeK, homePay, ltr } from "../lib/format";
import { ARABIC_DIGITS, t } from "../lib/i18n";
import { CURRENCIES, choiceLabel, sitePage, takeHomeOn } from "../lib/meta";
import { S, changed as sharedChanged } from "../lib/state";
import { store, stored } from "../lib/storage";
import { toast } from "../lib/toast";
import type { Row } from "../lib/types";
import { Field, Icon, Input, Label, Notice, Select } from "../components/ui";

const TAKE_HOME_KEY = "takeHome";

/** Pay periods: gross pay offered is per one of these, and a rate is worked out per one. */
const PAY_PERIODS: [string, string][] = [["hour", "Hourly"], ["day", "Daily"], ["week", "Weekly"], ["month", "Monthly"], ["year", "Annually"]];

/** Rates to work out, from the take-home pay wanted. */
const RATE_UNITS: [string, string][] = [["hour", "Hourly rate"], ["day", "Daily rate"], ["week", "Weekly rate"], ["month", "Monthly rate"], ["year", "Annual rate"]];

/** Desired net take-home pay: its period, and how many make a year. */
const WANT_PER: [string, string, number][] = [["week", "Weekly", 52], ["month", "Monthly", 12], ["year", "Annually", 1]];

/** How the pay is paid: as an employee, or as a contractor either side of IR35. */
const EMPLOYMENT_TYPES: [string, string][] = [
  ["paye", "Employee (PAYE)"],
  ["inside", "Contractor inside IR35 (umbrella company)"],
  ["outside", "Contractor outside IR35 (your limited company)"],
  ["all", "Compare all three"],
];

/** "85,000", "£85k", "1.5m", "٨٥٬٠٠٠": a number, or null when there's none. */
export function takeHomeNumber(v: unknown): number | null {
  const s = String(v ?? "")
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d))).replace(/٫/g, ".")
    .replace(/[£,٬\s]/g, "").toLowerCase();
  if (!s) return null;
  const m = /^(\d*\.?\d+)([km]?)$/.exec(s);
  if (!m) return NaN;
  return Number(m[1]) * (m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : 1);
}

/** Money in a currency (pounds unless said): whole, or with pence. */
export function money(v: number | null | undefined, currency = "GBP", pence = false): string {
  if (v == null || Number.isNaN(v)) return "—";
  const digits = pence ? 2 : 0;
  // Nothing, never "-£0", from a hair below it.
  if (Math.abs(v) < (pence ? 0.005 : 0.5)) v = 0;
  try {
    return ltr(new Intl.NumberFormat(LOC(), { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v));
  } catch {
    return ltr(`${currency} ${Math.round(v).toLocaleString(LOC())}`);
  }
}

/** Pounds: whole, or with pence. */
const pounds = (v: number, pence = false) => money(v, "GBP", pence);

/** What the page remembers, in this browser. */
function takeHomeSaved(): Row {
  try { return JSON.parse(stored(TAKE_HOME_KEY) || "{}") || {}; } catch { return {}; }
}

/** A figure the page remembers, as a number; `fallback` when there's none. */
const savedNumber = (s: Row, key: string, fallback: number | null = null) => {
  const v = takeHomeNumber(s[key]);
  return v == null ? fallback : v;
};

/** Who's paid, as the page has it, in the part of the UK Settings says. */
const takeHomeYou = (s: Row): Row => ({
  year: s.year || undefined, scotland: S.PREFS.uk_region === "scotland", student_loans: s.student_loans || [],
  pension: savedNumber(s, "pension", 0), pension_kind: s.pension_kind || "net_pay", no_ni: !!s.no_ni,
  tax_code: String(s.tax_code || "").trim() || undefined, marriage: s.marriage || "none",
  children: Math.floor(savedNumber(s, "children", 0) as number), partner_higher: !!s.partner_higher,
  sacrifice: savedNumber(s, "sacrifice", 0), payroll_giving: savedNumber(s, "payroll_giving", 0), gift_aid: savedNumber(s, "gift_aid", 0),
});

/** Marriage Allowance choices. */
const MARRIAGE: [string, string][] = [["none", "None"], ["give", "You give £1,260 of yours to your partner"], ["receive", "Your partner gives you £1,260 of theirs"]];

/** A contract's terms, as the page has them; the service's defaults for what isn't. */
const contractTerms = (s: Row) => Object.fromEntries(
  ["hours_per_day", "days_per_week", "weeks", "umbrella_margin", "umbrella_pension", "director_salary", "expenses", "company_pension", "dividends"]
    .map((k) => [k, savedNumber(s, k) ?? undefined]));

/** Words joined with commas, each its own phrase (for translating). */
const listed = (words: string[]) => words.map((w, i) => <Fragment key={i}>{i ? ", " : null}<span>{w}</span></Fragment>);

/** A rate: 0.1075 → 10.75%. */
const ratePct = (r: number) => ltr(new Intl.NumberFormat(LOC(), { style: "percent", maximumFractionDigits: 2 }).format(r));

/** An employee's pay periods in a year: paid for all 52 weeks, holidays included. */
function employeePeriods(per: string, s: Row) {
  const days = savedNumber(s, "days_per_week", 5) as number;
  const hours = savedNumber(s, "hours_per_day", 7.5) as number;
  return ({ hour: hours * days * 52, day: days * 52, week: 52, month: 12, year: 1 } as Record<string, number>)[per] ?? 1;
}

/**
 * The disclaimer under the calculator: experimental, estimates only, not
 * advice, and no liability for relying on it, as far as the law allows. In
 * the name of whoever runs this hunt, or of hunt's authors.
 */
function Disclaimer() {
  const who = S.META.operator || "the authors and contributors of hunt";
  return (
    <aside className="th-disclaimer" aria-label="Disclaimer">
      <p><b>Experimental.</b>{" "}<span>Take-home pay is an experimental tool, still being tried out, and is for general information only. It isn't tax, financial, legal or employment advice, and mustn't be relied on as such.</span></p>
      <p><span>Its figures are estimates. They may be incomplete, out of date or wrong, and they leave out much that affects what you pay: other income, how and when you're actually paid, how HMRC and your employer operate your tax code, and the terms of any share plan. Check anything you rely on with HMRC (gov.uk) or a qualified adviser before you decide anything: accepting an offer, setting a rate, or filing a tax return.</span></p>
      <p><span>The tool is provided “as is”, without warranty of any kind. To the fullest extent the law allows,</span>{" "}
        <span translate="no">{who}</span>{", "}
        <span>and its directors, staff and contributors, accept no liability for any loss or damage, direct or indirect, arising from using it or relying on what it shows. Nothing here limits any liability that the law doesn't allow to be limited.</span></p>
      {S.META.terms ? <p><span>Your use of it is also covered by the</span>{" "}<a href={sitePage("/terms/")} target="_blank" rel="noopener">terms of use</a>.</p> : null}
    </aside>
  );
}

// ---- an offer's extras: a bonus as a %, shares, benefits in kind ------------------------

/** Share grants' vesting: how often. */
const GRANT_EVERY: [string, string][] = [["1", "Monthly"], ["3", "Quarterly"], ["6", "Every 6 months"], ["12", "Yearly"]];

/** Bonus multipliers, yours and the company's: 0% to 200%, in 5% steps. */
const MULTIPLIERS: [string, string][] = Array.from({ length: 41 }, (_, i) => [String(i * 5), `${i * 5}%`]);

/**
 * A bonus: an amount, or a % of salary ("15%"), as targeted; times your
 * performance multiplier and the company's (100% each, unless said).
 */
function bonusOut(s: Row) {
  const b = String(s.bonus ?? "").trim();
  const times = (Number(s.bonus_you ?? 100) / 100) * (Number(s.bonus_company ?? 100) / 100);
  if (b.endsWith("%")) return { bonus: 0, bonus_percent: (takeHomeNumber(b.slice(0, -1)) ?? 0) * times };
  return { bonus: (takeHomeNumber(b) ?? 0) * times, bonus_percent: 0 };
}

/** Share grants, as the page has them, for the service: those filled in enough to work out. */
function grantsOut(s: Row) {
  return (s.grants || []).map((g: Row) => {
    const num = (k: string) => savedNumber(g, k);
    const option = (g.kind || "rsu") !== "rsu";
    return {
      label: g.label || "", kind: g.kind || "rsu", currency: g.currency || s.currency || "GBP",
      ...(option
        ? { shares: num("shares"), price: num("price"), strike: num("strike") ?? 0, grant_price: num("grant_price") ?? undefined }
        : { value: num("value") }),
      years: num("years") ?? 4, every_months: Number(g.every || 3), cliff_months: num("cliff") ?? 0, listed: g.listed !== false,
    };
  }).filter((g: Row) => (g.kind === "rsu" ? g.value != null : g.shares != null && g.price != null));
}

/** Benefits in kind, as the page has them, for the service. */
function benefitsOut(s: Row) {
  const b = s.benefits || {};
  const num = (k: string) => savedNumber(b, k, 0);
  return {
    car: b.car ? {
      list_price: num("list_price"), contribution: num("contribution"), co2: num("co2"), electric_range: num("electric_range"),
      diesel: !!b.diesel, fuel: !!b.fuel, payments: num("payments"),
    } : null,
    van: !!b.van, van_fuel: !!b.van && !!b.van_fuel, medical: num("medical"), loan: num("loan"), loan_rate: num("loan_rate"), other: num("other"),
  };
}

/** Whether anything in what's asked isn't a number. */
const hasNaN = (v: unknown): boolean => (typeof v === "number" ? Number.isNaN(v)
  : v && typeof v === "object" ? Object.values(v).some(hasNaN) : false);

/**
 * Take-home pay works out UK tax: for anyone whose settings don't say they
 * live in the UK, say so, and let them say they do, here; then open it.
 */
function TakeHomeGate({ opened }: { opened: () => void }) {
  const [uk, setUk] = useState(false);
  const [region, setRegion] = useState<string>(S.PREFS.uk_region || S.META.uk_regions?.[0]?.value || "");
  return (
    <div className="page take-home">
      <div className="al-page-head page-head"><h1>Take-home pay</h1><span className="al-badge al-badge--warning">Experimental</span></div>
      <section className="al-panel panel th-gate">
        <h2>Only for UK residents</h2>
        <p>Take-home pay works out what you'd keep after UK income tax, National Insurance, student loans and pension, so it's for those who live in the UK. Your settings don't say you do.</p>
        <div className="location-fields">
          <label className="check al-choice"><input type="checkbox" id="th-gate-uk" checked={uk} onChange={(e) => setUk(e.target.checked)} /><span>I live in the UK (a UK resident, for tax)</span></label>
          <Field hidden={!uk}><Label htmlFor="th-gate-region">Part of the UK</Label>
            <Select id="th-gate-region" value={region} onChange={(e) => setRegion(e.target.value)}>{S.META.uk_regions.map((o: Row) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
            <span className="al-hint">Scotland has its own income tax bands.</span></Field>
        </div>
        <div className="actions">
          <button className="al-button al-button--primary" type="button" disabled={!uk} onClick={async () => {
            const saved = await attempt(() => patch("settings", { uk_resident: true, uk_region: region }));
            if (!saved) return;
            S.PREFS = saved;
            sharedChanged();
            toast("Saved: you live in the UK");
            opened();
          }}>Save, and open the calculator</button>
        </div>
        <p className="muted small"><span>You can change it later in</span>{" "}<a href="/settings">Settings → Location</a>.</p>
      </section>
      <Disclaimer />
    </div>
  );
}

export function TakeHomePage() {
  const [uk, setUk] = useState(!!S.PREFS.uk_resident);
  const [options, setOptions] = useState<Row | null>(null);
  useEffect(() => { if (uk) get("take-home").then(setOptions).catch((e) => toast(e.message, "error")); }, [uk]);
  if (!uk) return <TakeHomeGate opened={() => setUk(true)} />;
  if (!options) return null;
  return <Calculator options={options} />;
}

interface Answers { paye: Row | null; contract: Row | null }
interface Ctx { type: string; backwards: boolean; unit: string; perYear: (per: string) => number; hours: number; daysPerWeek: number; code: string }

function Calculator({ options }: { options: Row }) {
  const c = options.contract;
  const defaults: Row = {
    from: "pay", type: "paye", amount: "", currency: "GBP", period: "year", rate_unit: "day", bonus: "",
    sign_on: "", bonus_you: "100", bonus_company: "100", grants: [], benefits: {}, raise: "", share_growth: "", refresher: "", years: "",
    hours_per_day: c.hours_per_day, days_per_week: c.days_per_week, weeks: c.weeks,
    umbrella_margin: c.umbrella_margin, umbrella_pension: c.umbrella_pension,
    director_salary: "", expenses: "", company_pension: "", dividends: c.dividends,
    year: options.year, student_loans: [], pension: "", pension_kind: "net_pay", no_ni: false,
  };
  const s = useRef<Row>(null as unknown as Row);
  if (!s.current) {
    const saved = takeHomeSaved();
    // What an earlier page remembered: a salary, or a contract's rate.
    if (saved.type == null && saved.mode) {
      saved.type = saved.mode === "contract" ? "all" : "paye";
      if (saved.from === "take_home") Object.assign(saved, { amount: saved.want, period: saved.want_per, rate_unit: saved.rate_per });
      else if (saved.mode === "contract") Object.assign(saved, { amount: saved.rate ?? saved.day_rate, period: saved.rate_per || "day" });
      else Object.assign(saved, { amount: saved.salary, period: saved.per });
    }
    const x = { ...defaults, ...saved };
    // A year that's gone from the list: this one instead.
    if (!options.years.some((y: Row) => y.id === x.year)) x.year = options.year;
    const query = new URLSearchParams(location.search);
    const typed = ({ salary: "paye", contract: "all" } as Record<string, string>)[query.get("mode") || ""] || query.get("type");
    if (EMPLOYMENT_TYPES.some(([k]) => k === typed)) x.type = typed;
    // From an application's pay: its figure, what it's per, and its currency.
    if (query.get("amount")) {
      Object.assign(x, { from: "pay", amount: query.get("amount") });
      if (PAY_PERIODS.some(([p]) => p === query.get("per"))) x.period = query.get("per");
      if (query.get("currency")) x.currency = query.get("currency")!.toUpperCase();
    }
    if (query.toString()) history.replaceState(null, "", "/take-home");
    s.current = x;
  }
  const st = s.current;
  const [, force] = useState(0);
  const [result, setResult] = useState<{ answers: Answers; ctx: Ctx } | null>(null);
  const [empty, setEmpty] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [advised, setAdvised] = useState<string | null>(null);
  const asked = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // ---- asking ----
  const n = (key: string, fallback: number | null = null) => savedNumber(st, key, fallback);
  const backwards = () => st.from === "take_home";
  const employee = () => st.type === "paye" || st.type === "all";
  const contractor = () => st.type !== "paye";
  /** What a rate or salary is shown per: the pay period, or the rate to work out. */
  const unit = () => (!backwards() ? st.period : st.type === "paye" ? "year" : st.rate_unit);

  async function work() {
    const mine = ++asked.current;
    const amount = n("amount");
    if (amount == null) {
      setResult(null);
      setProblem(null);
      setEmpty(backwards()
        ? "Type the take-home pay you want, to see the pay that leaves it."
        : "Type the gross pay offered, to see what you'd take home.");
      return;
    }
    setEmpty(null);
    const yearly = backwards() ? amount * (WANT_PER.find(([p]) => p === st.period)?.[2] ?? 1) : null;
    const terms = contractTerms(st);
    const you = takeHomeYou(st);
    // An employee's offer: bonus, sign-on, shares, benefits, the years ahead.
    const offer = {
      ...bonusOut(st), employer_pension: n("employer_pension", 0), sign_on: n("sign_on", 0),
      grants: grantsOut(st), benefits: benefitsOut(st),
      raise: n("raise", 0), share_growth: n("share_growth", 0), refresher: n("refresher", 0),
      years: n("years") == null ? undefined : Math.round(n("years") as number),
    };
    const numbers = [amount, yearly, employeePeriods(st.period, st), ...Object.values(terms),
      you.pension, you.children, you.sacrifice, you.payroll_giving, you.gift_aid];
    if (numbers.some((v) => Number.isNaN(v)) || hasNaN(offer)) {
      setProblem("That isn't a number hunt can read: try 85000 or 85k.");
      return;
    }
    const base = { ...you, year: st.year, currency: st.currency };
    try {
      const [paye, contract] = await Promise.all([
        employee() ? post("take-home/salary", { ...base, ...offer,
          ...(backwards() ? { take_home: yearly } : { salary: amount * employeePeriods(st.period, st) }) }) : null,
        contractor() ? post("take-home/contract", { ...base, ...terms, per: unit(),
          ...(backwards() ? { take_home: yearly } : { rate: amount }) }) : null,
      ]);
      if (mine !== asked.current) return;
      setProblem(null);
      setResult({ answers: { paye, contract }, ctx: {
        type: st.type, backwards: backwards(), unit: unit(), perYear: (per) => employeePeriods(per, st),
        hours: n("hours_per_day", defaults.hours_per_day) as number, daysPerWeek: n("days_per_week", defaults.days_per_week) as number,
        code: st.tax_code,
      } });
      // The code these figures would give, to use: the employee's, or the contractor's.
      const first = paye || (st.type === "outside" ? contract.outside : contract.inside);
      setAdvised(first?.tax_code_advice?.code || null);
    } catch (e) {
      if (mine !== asked.current) return;
      setProblem((e as Error).message);
    }
  }
  const latestWork = useRef(work);
  latestWork.current = work;
  const changed = () => {
    store(TAKE_HOME_KEY, JSON.stringify(st));
    force((k) => k + 1);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => latestWork.current(), 150);
  };
  useEffect(() => {
    latestWork.current();
    // Back to this page from elsewhere (Settings in another tab, say): the
    // settings again, and the figures with them.
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      try { S.PREFS = await get("settings"); } catch { return; }
      latestWork.current();
    };
    document.addEventListener("visibilitychange", refresh);
    return () => { document.removeEventListener("visibilitychange", refresh); clearTimeout(timer.current); };
  }, []);

  // ---- the form ----
  const field = (id: string, label: string, input: ReactNode, hint?: string) => (
    <Field key={id}><Label htmlFor={id}>{label}</Label>{input}{hint ? <span className="al-hint">{hint}</span> : null}</Field>
  );
  const numberBox = (key: string, placeholder: string, obj: Row = st, id = `th-${key}`, extra: Row = {}) => (
    <Input id={id} type="text" inputMode="decimal" autoComplete="off" value={obj[key] ?? ""} placeholder={placeholder} {...extra}
      onChange={(e) => { obj[key] = e.target.value; changed(); }} />
  );
  const choose = (key: string, choices: [string, string][], obj: Row = st, id = `th-${key}`) => (
    <Select id={id} value={String(obj[key] ?? "")} onChange={(e) => { obj[key] = e.target.value; changed(); }}>
      {choices.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </Select>
  );
  const tick = (key: string, label: ReactNode, obj: Row = st) => (
    <label className="th-check al-choice"><input type="checkbox" checked={!!obj[key]} onChange={(e) => { obj[key] = e.target.checked; changed(); }} />{label}</label>
  );
  const currencies = [...new Set([st.currency, ...CURRENCIES])];
  // A fold that shows what's chosen inside it: the design system's disclosure.
  const fold = (title: string, chosen: ReactNode, ...body: ReactNode[]) => (
    <details className="al-disclosure th-fold">
      <summary><span>{title}</span><span className="th-chosen al-disclosure__value">{chosen}</span></summary>
      <div className="al-disclosure__body th-fields">{body}</div>
    </details>
  );
  const none = <span>None</span>;

  // About you.
  const codeKeyed = codeKey(st.tax_code);
  const setCode = (code: string) => { st.tax_code = code; changed(); };
  // Common codes to choose from, described; Scotland's with its S.
  const sc = S.PREFS.uk_region === "scotland" ? "S" : "";
  const common = ([
    advised ? [advised, "Recommended for these figures"] : null,
    [`${sc}1257L`, "The standard Personal Allowance"],
    [`${sc}1383M`, "Marriage Allowance received from your partner"],
    [`${sc}1131N`, "Marriage Allowance given to your partner"],
    [`${sc}BR`, "All at the basic rate: a second job or pension"],
    ...(sc ? [["SD0", "All at the intermediate rate: a second job"], ["SD1", "All at the higher rate: a second job"],
      ["SD2", "All at the advanced rate: a second job"], ["SD3", "All at the top rate: a second job"]]
      : [["D0", "All at the higher rate: a second job"], ["D1", "All at the additional rate: a second job"]]),
    [`${sc}0T`, "No Personal Allowance: used up, or a new job without your details"],
    ["NT", "No tax taken"],
    [`${sc}1257L W1`, "Emergency: each pay period on its own"],
  ].filter(Boolean) as [string, string][]).filter(([code], i, all) => all.findIndex(([d]) => codeKey(d) === codeKey(code)) === i);
  const loansChosen = options.student_loans.filter((p: Row) => st.student_loans.includes(p.value)).map((p: Row) => p.label);
  const pct = n("pension", 0) as number;
  const kids = Math.floor(n("children", 0) as number);
  const giving = (n("gift_aid", 0) as number) + (n("payroll_giving", 0) as number);

  const aboutYou = (
    <section className="al-panel panel">
      <h2>About you</h2>
      <div className="th-fields">
        {fold("Tax code", <>{st.tax_code ? <span translate="no">{String(st.tax_code).toUpperCase()}</span> : <span>Usual (1257L)</span>}
          {st.marriage && st.marriage !== "none" ? <>{", "}<span>Marriage Allowance</span></> : null}</>,
        // The code the figures would give, once they're worked out, to use.
        <p key="advice" className="th-hint th-advice">
          {advised ? <><span>Recommended for these figures:</span>{" "}<b translate="no">{advised}</b>
            {codeKeyed === codeKey(advised) ? <>{" "}<span>(the one you have)</span></>
              : <>{" · "}<button className="al-button al-button--sm al-button--quiet" type="button" onClick={() => setCode(advised)}>Use it</button></>}</> : null}
          {st.tax_code ? <>{advised ? " · " : null}<button className="al-button al-button--sm al-button--quiet" type="button" onClick={() => setCode("")}>Clear</button></> : null}
        </p>,
        // The code: typed, or chosen from common ones (the recommended first).
        field("th-tax_code", "Tax code", <>{numberBox("tax_code", "1257L, or choose one", st, "th-tax_code", { inputMode: "text", autoCapitalize: "characters", spellCheck: false, list: "th-codes" })}
          <datalist id="th-codes">{common.map(([code, about]) => <option key={code} value={code}>{about}</option>)}</datalist></>,
        "On your payslip or P60: type it, or choose a common one. Empty is the usual one, which tapers away from £100,000."),
        field("th-marriage", "Marriage Allowance", choose("marriage", MARRIAGE),
          "Between spouses or civil partners, when one pays no more than the basic rate. With the usual tax code only: a code already includes it."))}
        {fold("Student loans", loansChosen.length ? listed(loansChosen) : none,
          <div key="loans" className="th-checks" role="group" aria-label="Student loans">
            {options.student_loans.map((p: Row) => (
              <label key={p.value} className="th-check al-choice">
                <input type="checkbox" checked={st.student_loans.includes(p.value)} onChange={(e) => {
                  st.student_loans = e.target.checked ? [...new Set([...st.student_loans, p.value])] : st.student_loans.filter((x: string) => x !== p.value);
                  changed();
                }} />{p.label}
              </label>
            ))}
          </div>)}
        {fold("Workplace pension", pct && !Number.isNaN(pct) ? <>{ratePct(pct / 100)}{", "}<span>{choiceLabel(options.pension_kinds, st.pension_kind)}</span></> : none,
          <div key="pair" className="th-pair">
            {field("th-pension", "Your contribution (% of pay)", numberBox("pension", "0"))}
            {field("th-pension_kind", "How it's paid", choose("pension_kind", options.pension_kinds.map((k: Row) => [k.value, k.label])))}
          </div>,
          <p key="hint" className="th-hint">As an employee or inside IR35. Outside IR35, your company pays in instead.</p>,
          field("th-employer_pension", "Employer's contribution (% of salary)", numberBox("employer_pension", "0"),
            "As an employee: on top of your pay, so your take-home pay is the same."))}
        {fold("State Pension", <span>{st.no_ni ? "Over State Pension age" : "Under State Pension age"}</span>,
          <Fragment key="tick">{tick("no_ni", "Over the State Pension age (no National Insurance)")}</Fragment>,
          <p key="hint" className="th-hint">From State Pension age you stop paying National Insurance on your pay; income tax is the same. Employers still pay theirs.</p>)}
        {fold("Child Benefit", kids > 0 ? <span>{kids === 1 ? "1 child" : `${kids} children`}</span> : none,
          field("th-children", "Children you get Child Benefit for", numberBox("children", "0")),
          <Fragment key="tick">{tick("partner_higher", "Your partner's income is higher (they pay the charge, not you)")}</Fragment>,
          <p key="hint" className="th-hint">The High Income Child Benefit Charge takes back 1% of Child Benefit for every £200 of adjusted net income over £60,000, and all of it from £80,000. It's paid through Self Assessment.</p>)}
        {fold("Other salary sacrifice", (n("sacrifice", 0) as number) > 0 ? money(n("sacrifice", 0)) : none,
          field("th-sacrifice", "Salary sacrifice, a year", numberBox("sacrifice", "0"),
            "Cycle to Work, an electric car or other schemes: taken off your pay before tax and National Insurance. As an employee or inside IR35. A pension paid by salary sacrifice goes under Workplace pension."))}
        {fold("Gift Aid and payroll giving", giving > 0 ? money(giving) : none,
          <div key="pair" className="th-pair">
            {field("th-gift_aid", "Gift Aid donations, a year", numberBox("gift_aid", "0"))}
            {field("th-payroll_giving", "Payroll giving, a year", numberBox("payroll_giving", "0"))}
          </div>,
          <p key="hint" className="th-hint">Gift Aid: what you give; the charity claims the basic rate on top, and your basic rate band grows by the total, so higher-rate taxpayers pay less tax. Payroll giving comes off your pay before tax.</p>)}
      </div>
    </section>
  );

  // ---- shares, benefits in kind and the years ahead (employees) ----
  function offerSections() {
    // Shares: each grant, its kind, how much, and how it vests.
    const grantRow = (g: Row, i: number) => {
      const box = (k: string, label: string, placeholder: string, hint?: string) => field(`th-g${i}-${k}`, label, numberBox(k, placeholder, g, `th-g${i}-${k}`), hint);
      const sel = (k: string, label: string, choices: [string, string][]) => field(`th-g${i}-${k}`, label, choose(k, choices, g, `th-g${i}-${k}`));
      const option = (g.kind || "rsu") !== "rsu";
      return (
        <div key={i} className="th-grant">
          <div className="th-grant-head">
            <Input className="th-grant-name" type="text" value={g.label || ""} placeholder="e.g. New hire grant" aria-label="Grant name" onChange={(e) => { g.label = e.target.value; changed(); }} />
            <button className="al-button al-button--sm al-button--quiet al-button--danger" type="button" onClick={() => { st.grants.splice(i, 1); changed(); }}>Remove</button>
          </div>
          <div className="th-pair">
            {sel("kind", "Type", options.grant_kinds.map((k: Row) => [k.value, k.label]))}
            {sel("currency", "Currency", currencies.map((cur) => [cur, cur]))}
          </div>
          {option
            ? <div className="th-pair">{box("shares", "Options", "e.g. 1,000")}{box("price", "Share price now", "e.g. 10")}{box("strike", "Exercise price", "e.g. 4")}</div>
            : box("value", "Grant value", "e.g. 300,000", "What it's worth at grant, as the offer says.")}
          {g.kind === "emi" ? box("grant_price", "Market value at grant", "The share price now", "EMI is taxed only on any discount below it.") : null}
          <div className="th-pair">{box("years", "Vests over (years)", "4")}{sel("every", "Vests", GRANT_EVERY)}{box("cliff", "Cliff (months)", "0")}</div>
          <label className="th-check al-choice"><input type="checkbox" checked={g.listed !== false} onChange={(e) => { g.listed = e.target.checked; changed(); }} />
            <span>Listed (readily convertible): tax and NI through payroll</span></label>
        </div>
      );
    };
    const b = st.benefits;
    const bbox = (k: string, label: string, placeholder: string, hint?: string) => field(`th-b-${k}`, label, numberBox(k, placeholder, b, `th-b-${k}`), hint);
    const btick = (k: string, label: string) => tick(k, <span>{label}</span>, b);
    const names = [b.car && "Car", b.van && "Van", (savedNumber(b, "medical", 0) as number) > 0 && "Medical",
      (savedNumber(b, "loan", 0) as number) > 0 && "Loan", (savedNumber(b, "other", 0) as number) > 0 && "Other"].filter(Boolean) as string[];
    const yrs = n("years");
    return <>
      {fold("Shares: RSUs and options", st.grants.length ? <span>{st.grants.length === 1 ? "1 grant" : `${st.grants.length} grants`}</span> : none,
        <div key="grants" className="th-grants">
          {st.grants.map(grantRow)}
          <button className="al-button al-button--quiet app-add" type="button" onClick={() => {
            st.grants.push({ label: "", kind: "rsu", currency: st.currency, years: "4", every: "3", cliff: "0", listed: true });
            changed();
          }}>+ Add a grant</button>
        </div>,
        <p key="hint" className="th-hint">Taxed as they vest: RSUs on their value; unapproved options on the gain; EMI only on a discount at grant; CSOP options free of tax from 3 years after grant; Sharesave free. Options are taken as bought, and shares sold, as they vest.</p>)}
      {fold("Benefits in kind", names.length ? listed(names) : none,
        <div key="body" className="th-fields">
          {btick("car", "A company car")}
          {b.car ? (
            <div className="th-group">
              <div className="th-pair">{bbox("list_price", "List price", "e.g. 40,000")}{bbox("co2", "CO2 (g/km)", "0 for electric")}</div>
              <div className="th-pair">{bbox("electric_range", "Electric range (miles)", "For 1 to 50 g/km")}{bbox("contribution", "You paid towards it", "0")}</div>
              {bbox("payments", "You pay for private use, a year", "0")}
              {btick("diesel", "Diesel, not to the RDE2 standard (4% more)")}
              {btick("fuel", "Fuel for private journeys paid for")}
            </div>
          ) : null}
          {btick("van", "A company van")}
          {b.van ? btick("van_fuel", "And fuel for it") : null}
          {bbox("medical", "Private medical insurance, a year", "0", "What it costs your employer.")}
          <div className="th-pair">{bbox("loan", "A loan from your employer", "0")}{bbox("loan_rate", "Interest you pay (%)", "0")}</div>
          {bbox("other", "Other benefits, a year", "0", "Their taxable value, as on a P11D.")}
          <p className="th-hint">Taxed as pay, though not paid: no employee's National Insurance, and your employer pays Class 1A on them. HMRC usually takes the tax through your tax code. Loans of £10,000 or less are free of tax.</p>
        </div>)}
      {fold("Over the years", yrs ? <span>{`${Math.round(yrs)} years`}</span> : <span>As the shares vest</span>,
        <div key="a" className="th-pair">
          {field("th-raise", "Pay rise a year (%)", numberBox("raise", "0"))}
          {field("th-share_growth", "Share price growth a year (%)", numberBox("share_growth", "0"))}
        </div>,
        <div key="b" className="th-pair">
          {field("th-refresher", "Refresher RSUs a year", numberBox("refresher", "0"), "Granted each year from the second, vesting as the first RSU grant.")}
          {field("th-years", "Years", numberBox("years", "4"), "As long as the longest grant, at least 4, unless said.")}
        </div>)}
    </>;
  }

  // ---- pay information ----
  // Desired take-home pay is weekly, monthly or annual.
  const periods: [string, string][] = backwards() ? WANT_PER.map(([v, l]) => [v, l]) : PAY_PERIODS;
  if (!periods.some(([v]) => v === st.period)) st.period = backwards() ? "month" : "year";
  const amountLabel = backwards() ? "Take-home pay (after tax)"
    : ({ paye: "Gross salary (before tax)", inside: "Contract rate (before tax)", outside: "Contract rate (before tax)", all: "Gross pay or rate (before tax)" } as Record<string, string>)[st.type];
  const per = unit();
  const hours = per === "hour";
  const days = contractor() || ["hour", "day"].includes(per);
  const payInfo = (
    <section className="al-panel panel th-pay-info">
      <h2>Pay information</h2>
      <div className="th-fields">
        <Field><span className="th-label" id="th-start-label">Start from</span>
          <div className="al-segmented al-segmented--fill th-from" role="group" aria-labelledby="th-start-label">
            {([["pay", "Gross pay offered"], ["take_home", "Desired net take-home pay"]] as [string, string][]).map(([v, l]) => (
              <button key={v} type="button" aria-pressed={String(st.from === v) as "true" | "false"} onClick={() => {
                // Switching to take-home pay: start from what Settings says you want.
                if (v === "take_home" && st.from !== v && S.PREFS.desired_take_home != null) {
                  Object.assign(st, { amount: String(S.PREFS.desired_take_home), period: S.PREFS.desired_take_home_per || "month", currency: HOME() });
                }
                st.from = v; changed();
              }}>{l}</button>
            ))}
          </div></Field>
        {field("th-type", "Employment type", choose("type", EMPLOYMENT_TYPES))}
        <div className="th-money">
          {field("th-amount", amountLabel, numberBox("amount", backwards() ? "e.g. 4,000" : "e.g. 85,000"))}
          {field("th-currency", "Currency", choose("currency", currencies.map((cur) => [cur, cur])))}
          {field("th-period", "Pay period", choose("period", periods))}
        </div>
        {backwards() && contractor() ? field("th-rate_unit", "Rate to work out", choose("rate_unit", RATE_UNITS)) : null}
        {employee() ? (
          <div className="th-pair th-top">
            {field("th-bonus", "Bonus, a year (before tax)", numberBox("bonus", "0, or 15%"),
              backwards() ? "On top of the salary worked out: an amount, or a % of salary." : "An amount, or a % of salary (a target bonus).")}
            {field("th-sign_on", "Sign-on bonus", numberBox("sign_on", "0"), "Paid in the first year.")}
          </div>
        ) : null}
        {employee() ? <div className="th-pair">{field("th-bonus_you", "Your performance", choose("bonus_you", MULTIPLIERS))}{field("th-bonus_company", "The company's performance", choose("bonus_company", MULTIPLIERS))}</div> : null}
        {employee() ? <p className="th-hint">Multipliers on the target bonus, as your company pays it: 100% each is the target.</p> : null}
        {employee() && st.type === "all" ? <p className="th-hint">Bonuses, shares and benefits are for the employee only.</p> : null}
        {hours || days ? (
          <div className="th-group"><h3>Working pattern</h3>
            <div className="th-pair">
              {hours ? field("th-hours_per_day", "Hours a day", numberBox("hours_per_day", "7.5")) : null}
              {days ? field("th-days_per_week", "Days a week", numberBox("days_per_week", "5")) : null}
              {contractor() ? field("th-weeks", "Weeks worked a year", numberBox("weeks", "46")) : null}
            </div>
            <p className="th-hint">{contractor()
              ? "Contractors are paid only for weeks worked: 52, less holidays, bank holidays and time between contracts."
              : "Employees are paid for all 52 weeks, holidays included."}</p>
          </div>
        ) : null}
        {employee() ? offerSections() : null}
        {["inside", "all"].includes(st.type) ? (
          <details className="al-disclosure th-more">
            <summary>Umbrella company (inside IR35)</summary>
            <div className="th-fields">
              <div className="th-pair">
                {field("th-umbrella_margin", "Umbrella margin, a week", numberBox("umbrella_margin", "20"))}
                {field("th-umbrella_pension", "Employer pension contribution (%)", numberBox("umbrella_pension", "0"))}
              </div>
              <p className="th-hint">Umbrella companies pay their costs out of your rate: their margin, employer's National Insurance, the Apprenticeship Levy and any employer pension contribution (3% of qualifying earnings, if you're enrolled).</p>
            </div>
          </details>
        ) : null}
        {["outside", "all"].includes(st.type) ? (
          <details className="al-disclosure th-more">
            <summary>Your limited company (outside IR35)</summary>
            <div className="th-fields">
              {field("th-director_salary", "Director's salary, a year", numberBox("director_salary", "12,570"), "The Personal Allowance, unless you say otherwise.")}
              <div className="th-pair">
                {field("th-expenses", "Business expenses, a year", numberBox("expenses", "0"))}
                {field("th-company_pension", "Employer pension contribution, a year", numberBox("company_pension", "0"))}
              </div>
              {field("th-dividends", "Profit taken as dividends (%)", numberBox("dividends", "100"), "What isn't taken stays in the company, to take later.")}
              <p className="th-hint">In pounds: the company is in the UK.</p>
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );

  // Something half typed: say what, above the last figures, faded, until
  // it can be worked out again (or in place of nothing, the first time).
  const problemNote = problem ? <Notice kind="danger" role="status" className="th-problem">{problem}</Notice> : null;
  return (
    <div className="page take-home">
      <div className="al-page-head page-head"><h1>Take-home pay</h1><span className="al-badge al-badge--warning">Experimental</span>
        {/* Where you live (Settings → Location) and the tax year: what the rates are. */}
        <div className="th-meta">
          <div className="th-where"><span className="th-head-label">Where you live</span>
            <a href="/settings" title={t("Change in Settings")}>{choiceLabel(S.META.uk_regions, S.PREFS.uk_region)}</a></div>
          <div className="th-year"><label className="th-head-label al-label" htmlFor="th-year">Tax year</label>{choose("year", options.years.map((y: Row) => [y.id, y.label]))}</div>
        </div>
      </div>
      <p className="muted th-intro">What you'd keep in the UK after income tax, National Insurance, student loans and pension: as an employee, or as a contractor inside or outside IR35. Or the other way round: the pay that leaves what you want.</p>
      <div className="th-layout">
        <form className="th-form" onSubmit={(e) => e.preventDefault()}>{payInfo}{aboutYou}</form>
        <div className={`th-results${problem && result ? " th-stale" : ""}`} aria-live="polite">
          {empty ? <p className="empty">{empty}</p>
            : result ? <>{problemNote}<TakeHomeResults answers={result.answers} ctx={result.ctx} /></>
              : problemNote}
        </div>
      </div>
      <ApplicationsAgainstWant />
      <p className="muted small th-small-print">Estimates for a whole tax year, as if paid evenly through it, at HMRC's rates for the year chosen; other currencies at the day's rate. Other income and VAT aren't included.</p>
      <Disclaimer />
    </div>
  );
}

// ---- results --------------------------------------------------------------------------

type MoneyRow = [string, number, string?] | null;

/** A table of money: rows of [label, value, kind], in columns that divide a year. */
function MoneyTable({ caption, periods, rows }: { caption: string; periods: [string, number][]; rows: MoneyRow[] }) {
  return (
    <div className="al-table-wrap"><table className="th-table al-table">
      <caption className="al-visually-hidden">{caption}</caption>
      <thead><tr><th><span className="al-visually-hidden">What</span></th>{periods.map(([l]) => <th key={l} className="al-table__num" scope="col">{l}</th>)}</tr></thead>
      <tbody>{(rows.filter(Boolean) as [string, number, string?][]).map(([label, v, kind], i) => (
        <tr key={i} className={kind ? `al-table__row--${kind}` : undefined}>
          <th scope="row">{label}</th>
          {periods.map(([l, by]) => <td key={l} className="al-table__num">{pounds(v / by)}</td>)}
        </tr>
      ))}</tbody>
    </table></div>
  );
}

/** How a figure was reached: bands, rates, and how much of the income is in each. */
function BandsTable({ title, slices }: { title: string; slices: Row[] | null | undefined }) {
  if (!slices?.length) return null;
  return (
    <div className="th-bands"><h3>{title}</h3>
      <table className="th-table al-table">
        <thead><tr><th>Band</th><th className="al-table__num">Rate</th><th className="al-table__num">On</th><th className="al-table__num">Comes to</th></tr></thead>
        <tbody>{slices.map((b, i) => (
          <tr key={i}><th scope="row">{b.name}</th><td className="al-table__num">{ratePct(b.rate)}</td><td className="al-table__num">{pounds(b.on)}</td><td className="al-table__num">{pounds(b.tax, true)}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/** The workings of a payslip, folded. */
function Workings({ p }: { p: Row }) {
  return (
    <details className="al-disclosure th-workings"><summary>How it's worked out</summary>
      <p className="small"><span>Personal allowance (tax-free)</span>{" "}<b>{pounds(p.personal_allowance)}</b></p>
      <BandsTable title="Income tax" slices={p.tax_bands} />
      <BandsTable title="Dividend tax" slices={p.dividend_bands} />
      <BandsTable title="National Insurance" slices={p.ni_bands} />
      <BandsTable title="Student loans" slices={p.loans} />
      {p.tax_code_advice ? (
        <div className="th-bands"><h3><span>Tax code for these figures:</span>{" "}<span translate="no">{p.tax_code_advice.code}</span></h3>
          <ul className="th-reasons">{p.tax_code_advice.reasons.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>
          <p className="muted small">Worked out as HMRC does, from these figures alone: other income, benefits in kind or tax owed would change it.</p></div>
      ) : null}
    </details>
  );
}

/** A tax code, for comparing: capitals, no spaces. */
const codeKey = (c: unknown) => String(c || "").replace(/\s+/g, "").toUpperCase();

const ThTile = ({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) => (
  <div className="al-stat viz-tile"><span className="al-stat__label">{label}</span><span className="al-stat__value">{value}</span>{note ? <span className="al-stat__note">{note}</span> : null}</div>
);

/** Pounds back in the currency pay was typed in. */
const inCurrency = (r: Row, gbp: number | null) => (gbp == null ? null : gbp / (r.gbp_rate || 1));

/** Pounds in your currency (Settings → Language and region). */
const inHome = (gbp: number) => (HOME() === "GBP" ? gbp : fromGbp(gbp) as number);

/** A day's rate to pounds: "1 EUR = 0.8448 GBP, the rate on 12 Oct 2026". */
const rateOf = (currency: string, rate: number, on: string | null) => <>{ltr(`1 ${currency} = ${rate.toFixed(4)} GBP`)}
  {on ? <>{", "}<span>the rate on</span>{" "}{new Date(`${on}T12:00`).toLocaleDateString(LOC(), { day: "numeric", month: "short", year: "numeric" })}</> : null}</>;

/** The rates amounts were turned at: from the currency typed, and to yours, where they aren't pounds. */
function RateNote({ r }: { r: Row }) {
  const typed = r.currency || "GBP";
  const rates = [
    typed !== "GBP" ? rateOf(typed, r.gbp_rate, r.gbp_rate_on) : null,
    HOME() !== "GBP" && HOME() !== typed ? rateOf(HOME(), S.PREFS.currency_rate, S.PREFS.currency_rate_on) : null,
  ].filter(Boolean);
  if (!rates.length) return null;
  return <p className="muted small th-rate-note"><span>Exchange rates</span>{": "}{rates.map((x, i) => <Fragment key={i}>{i ? "; " : ""}{x}</Fragment>)}.</p>;
}

/**
 * An amount worked out in pounds, in your currency (Settings → Language
 * and region); with the currency pay was typed in beside it, smaller, when
 * that's another.
 */
function both(r: Row, gbp: number, pence = false): ReactNode {
  const home = HOME();
  const typed = r.currency || "GBP";
  const mine = money(inHome(gbp), home, pence);
  if (typed === home) return mine;
  return <>{mine}<span className="th-also">{" ("}{money(inCurrency(r, gbp), typed, pence)}{")"}</span></>;
}

/** Pay per a period, as words: "a day". */
const perPay = (per: string) => ({ hour: "an hour", day: "a day", week: "a week", month: "a month", year: "a year" } as Record<string, string>)[per] || per;

/** What's needed per a period: "Daily rate needed"; an employee's, a year. */
const neededLabel = (per: string, employee: boolean) => (employee ? "Gross salary needed, a year"
  : ({ hour: "Hourly rate needed", day: "Daily rate needed", week: "Weekly rate needed", month: "Monthly rate needed", year: "Annual rate needed" } as Record<string, string>)[per]);

/** Pay needed per a period, whoever's paid it: "Daily pay needed". */
const payNeeded = (per: string) => ({ hour: "Hourly pay needed", day: "Daily pay needed", week: "Weekly pay needed", month: "Monthly pay needed", year: "Annual pay needed" } as Record<string, string>)[per];

/** A payslip's other deductions: before tax (sacrifice, giving), after it (Gift Aid, the Child Benefit charge), and beside it. */
const extras = (p: Row) => ({
  before: [
    p.sacrifice ? ["Salary sacrifice", p.sacrifice] : null,
    p.payroll_giving ? ["Payroll giving", p.payroll_giving] : null,
  ] as MoneyRow[],
  after: [
    p.gift_aid ? ["Gift Aid donations", p.gift_aid] : null,
    p.child_benefit_charge ? ["High Income Child Benefit Charge", p.child_benefit_charge] : null,
  ] as MoneyRow[],
  aside: [p.child_benefit ? ["Child Benefit (paid separately)", p.child_benefit, "aside"] : null] as MoneyRow[],
});

interface Side { key: string; title: string; r: Row; p: Row; about: string; needed: number | null; pence: boolean; paid: number; taxes: number; salaryLike: number; periods: [string, number][]; rows: MoneyRow[] }

/**
 * Each way of being paid that was asked about: its name, what it takes
 * home, what it needs (from take-home pay wanted), its breakdown, and the
 * figures it's compared by.
 */
function takeHomeSides({ paye, contract }: Answers, ctx: Ctx): Side[] {
  const out: Side[] = [];
  const pence = ctx.unit !== "year";
  if (paye) {
    const r = paye;
    out.push({
      key: "paye", title: "Employee (PAYE)", r, p: r,
      about: "Paid through your employer's payroll: income tax and National Insurance are taken before you're paid.",
      needed: ctx.backwards ? r.salary / ctx.perYear(ctx.unit) : null, pence,
      paid: r.gross + (r.shares || 0), taxes: r.income_tax + r.ni + r.student_loan + r.child_benefit_charge, salaryLike: r.gross,
      periods: [["Year", 1], ["Month", 12], ["Week", 52], ["Day", 260]],
      rows: [
        ["Gross pay", r.gross, "sub"],
        r.shares ? ["Shares vesting", r.shares, "sub"] : null,
        r.pension ? ["Your pension", r.pension] : null,
        ...extras(r).before,
        ["Income tax", r.income_tax],
        ["National Insurance", r.ni],
        r.student_loan ? ["Student loan", r.student_loan] : null,
        ...extras(r).after,
        ["Take-home pay", r.take_home, "total"],
        r.pension_in ? ["Into your pension", r.pension_in, "aside"] : null,
        r.employer_pension ? ["Employer pension contribution", r.employer_pension, "aside"] : null,
        r.benefits_in_kind ? ["Benefits in kind (taxed, not paid)", r.benefits_in_kind, "aside"] : null,
        r.class_1a ? ["Employer's Class 1A NI", r.class_1a, "aside"] : null,
        ...extras(r).aside,
        ["Employer's National Insurance", r.employer_ni, "aside"],
        ["What you cost your employer", r.employer_cost, "aside"],
      ],
    });
  }
  if (contract && contract.inside && ["inside", "all"].includes(ctx.type)) {
    const i = contract.inside;
    out.push({
      key: "inside", title: "Inside IR35", r: contract, p: i,
      about: "Through an umbrella company, as its employee: its costs come out of your rate, then you're taxed as on a salary.",
      needed: ctx.backwards ? i.rate : null, pence,
      paid: i.income, taxes: i.employer_ni + i.levy + i.income_tax + i.ni + i.student_loan + i.child_benefit_charge, salaryLike: i.salary_like,
      periods: [["Year", 1], ["Month", 12]],
      rows: [
        ["Your client pays", i.income, "sub"],
        ["Umbrella margin", i.margin],
        ["Employer's National Insurance", i.employer_ni],
        ["Apprenticeship Levy", i.levy],
        i.employer_pension ? ["Employer pension contribution", i.employer_pension] : null,
        ["Gross pay", i.gross, "sub"],
        i.pension ? ["Your pension", i.pension] : null,
        ...extras(i).before,
        ["Income tax", i.income_tax],
        ["National Insurance", i.ni],
        i.student_loan ? ["Student loan", i.student_loan] : null,
        ...extras(i).after,
        ["Take-home pay", i.take_home, "total"],
        i.pension_in ? ["Into your pension", i.pension_in, "aside"] : null,
        ...extras(i).aside,
      ],
    });
  }
  if (contract && contract.outside && ["outside", "all"].includes(ctx.type)) {
    const o = contract.outside;
    out.push({
      key: "outside", title: "Outside IR35", r: contract, p: o,
      about: "Through your own limited company: a director's salary, Corporation Tax on the profit, and the rest as dividends.",
      needed: ctx.backwards ? o.rate : null, pence,
      paid: o.income, taxes: o.employer_ni + o.corporation_tax + o.income_tax + o.dividend_tax + o.ni + o.student_loan + o.child_benefit_charge, salaryLike: o.salary_like,
      periods: [["Year", 1], ["Month", 12]],
      rows: [
        ["Your client pays", o.income, "sub"],
        o.expenses ? ["Business expenses", o.expenses] : null,
        ["Director's salary", o.salary],
        ["Employer's National Insurance", o.employer_ni],
        o.company_pension ? ["Employer pension contribution", o.company_pension] : null,
        ["Profit", o.profit, "sub"],
        ["Corporation Tax", o.corporation_tax],
        ["Dividends", o.dividends, "sub"],
        o.retained ? ["Left in the company", o.retained] : null,
        ["Income tax", o.income_tax],
        ["Dividend tax", o.dividend_tax],
        o.ni ? ["National Insurance", o.ni] : null,
        o.student_loan ? ["Student loan", o.student_loan] : null,
        ...extras(o).after,
        ["Take-home pay", o.take_home, "total"],
        o.pension_in ? ["Into your pension", o.pension_in, "aside"] : null,
        ...extras(o).aside,
      ],
    });
  }
  return out;
}

/** A way of being paid, in full: its table and how it's worked out. */
const SideCard = ({ side, ctx }: { side: Side; ctx: Ctx }) => (
  <section className="al-card viz-card th-side">
    <header><h2>{side.title}</h2><p className="muted small">{side.about}</p></header>
    <CodeLine p={side.p} ctx={ctx} />
    <MoneyTable caption={side.title} periods={side.periods} rows={side.rows} />
    <Workings p={side.p} />
  </section>
);

/** The tax code these figures would give; and, where another was typed, that they differ. */
function CodeLine({ p, ctx }: { p: Row; ctx: Ctx }) {
  const advice = p.tax_code_advice;
  if (!advice) return null;
  const mine = codeKey(ctx.code);
  return (
    <p className="small th-code-advice"><span className="muted">Tax code for these figures:</span>{" "}<b translate="no">{advice.code}</b>
      {mine && mine !== codeKey(advice.code)
        ? <>{" · "}<span className="th-code-differs"><span>yours,</span>{" "}<span translate="no">{mine}</span><span>, is different: the tax taken through the year won't be right, and the difference is settled afterwards.</span></span></>
        : null}</p>
  );
}

/**
 * Take-home pay against what you want (Settings → Desired net take-home
 * pay), in your currency: an hour, a day, a month and a year, each way of
 * being paid, with how much more or short it is.
 */
function DesiredDelta({ sides, ctx }: { sides: Side[]; ctx: Ctx }) {
  const want = S.PREFS.desired_take_home;
  if (want == null) {
    return <p className="muted small th-desired-none"><span>Say what you want to take home in Settings, to see how these figures compare.</span>{" "}<a href="/settings">Settings</a></p>;
  }
  const per = S.PREFS.desired_take_home_per || "month";
  const wantYear = want * (({ week: 52, month: 12, year: 1 } as Record<string, number>)[per] || 12);
  const home = HOME();
  // How many of each a year: an employee is paid for all 52 weeks, a
  // contractor for the days worked.
  const units = (side: Side, u: string) => {
    if (u === "month") return 12;
    if (u === "year") return 1;
    const days = side.key === "paye" ? ctx.perYear("day") : side.r.days;
    return u === "day" ? days : days * (side.key === "paye" ? ctx.perYear("hour") / ctx.perYear("day") : ctx.hours);
  };
  const periods: [string, string][] = [["hour", "An hour"], ["day", "A day"], ["month", "A month"], ["year", "A year"]];
  const cell = (side: Side, u: string) => {
    const count = units(side, u);
    if (!count) return <td key={u} className="al-table__num">—</td>;
    const pence = u === "hour" || u === "day";
    const got = inHome(side.p.take_home) / count;
    // What you want is in your currency already.
    const diff = got - wantYear / count;
    const even = Math.abs(diff) < (pence ? 0.005 : 0.5);
    return (
      <td key={u} className="al-table__num">
        <span className="th-cell-main">{money(got, home, pence)}</span>
        <span className={`th-cell-diff${even ? "" : diff > 0 ? " th-more-pay" : " th-less-pay"}`}>
          {even ? <span>As you want</span> : <>{ltr(`${diff > 0 ? "+" : "−"}${money(Math.abs(diff), home, pence)}`)}{" "}<span>{diff > 0 ? "more" : "short"}</span></>}
        </span>
      </td>
    );
  };
  return (
    <section className="al-card viz-card th-desired">
      <header><h2>Against what you want</h2>
        <p className="muted small"><span>You want to take home</span>{" "}<b>{money(want, home)}</b>{" "}<span>{perPay(per)}</span>{" · "}<a href="/settings">Change in Settings</a></p></header>
      <div className="al-table-wrap"><table className="th-table th-desired-table al-table">
        <caption className="al-visually-hidden">Take-home pay, and the difference from what you want</caption>
        <thead><tr><th><span className="al-visually-hidden">What</span></th>{periods.map(([u, label]) => <th key={u} className="al-table__num" scope="col">{label}</th>)}</tr></thead>
        <tbody>{sides.map((side) => <tr key={side.key}><th scope="row">{side.title}</th>{periods.map(([u]) => cell(side, u))}</tr>)}</tbody>
      </table></div>
      <p className="muted small">Take-home pay in each period, and below it how much more or less than you want. Hours and days as paid: an employee for all 52 weeks, a contractor for the days worked.</p>
    </section>
  );
}

/** What's odd about the grants: over a scheme's limit, say. */
const OfferNotes = ({ r }: { r: Row | null }) => (r?.notes?.length
  ? <Notice kind="warning" className="th-notes">{r.notes.map((x: string, i: number) => <p key={i}>{x}</p>)}</Notice> : null);

/**
 * An employee's offer year by year, from the start: pay, shares, what's
 * taken and what's left; and each grant's vesting.
 */
function Projection({ r }: { r: Row | null }) {
  const years: Row[] = r?.projection || [];
  if (!years.length) return null;
  const yearHeads = years.map((y) => <th key={y.year} className="al-table__num" scope="col"><span>Year</span>{" "}{String(y.year)}</th>);
  const row = (label: string, pick: (y: Row) => number, kind?: string) => (years.some((y) => pick(y)) || kind === "total" || kind === "sub"
    ? <tr key={label} className={kind ? `al-table__row--${kind}` : undefined}><th scope="row">{label}</th>{years.map((y) => <td key={y.year} className="al-table__num">{pounds(pick(y))}</td>)}</tr> : null);
  const grants: Row[] = r!.grants || [];
  return (
    <section className="al-card viz-card th-projection">
      <header><h2>Year by year</h2>
        <p className="muted small">From the start: pay rising and shares vesting as set under Over the years, each year taxed at this tax year's rates.</p></header>
      <div className="al-table-wrap"><table className="th-table al-table">
        <caption className="al-visually-hidden">Year by year</caption>
        <thead><tr><th><span className="al-visually-hidden">What</span></th>{yearHeads}</tr></thead>
        <tbody>
          {row("Salary", (y) => y.salary)}
          {row("Bonus", (y) => y.bonus)}
          {row("Sign-on bonus", (y) => y.sign_on)}
          {row("Shares vesting", (y) => y.shares)}
          {row("Total compensation", (y) => y.total, "sub")}
          {row("Benefits in kind (taxed, not paid)", (y) => y.benefits_in_kind, "aside")}
          {row("Income tax", (y) => y.income_tax)}
          {row("National Insurance", (y) => y.ni)}
          {row("Student loan", (y) => y.student_loan)}
          {row("High Income Child Benefit Charge", (y) => y.child_benefit_charge)}
          {row("Your pension", (y) => y.pension)}
          {row("Take-home pay", (y) => y.take_home, "total")}
          {row("Take-home pay, a month", (y) => y.take_home / 12, "total")}
          {row("Of which from shares, after tax", (y) => y.shares_after_tax, "aside")}
          {row("Employer pension contribution", (y) => y.employer_pension, "aside")}
          <tr className="al-table__row--aside"><th scope="row">Tax code for the year</th>{years.map((y) => <td key={y.year} className="al-table__num" translate="no">{y.tax_code}</td>)}</tr>
        </tbody>
      </table></div>
      {grants.length ? (
        <details className="al-disclosure th-workings"><summary>Each grant's vesting</summary>
          <div className="al-table-wrap"><table className="th-table al-table">
            <thead><tr><th><span className="al-visually-hidden">Grant</span></th>{yearHeads}</tr></thead>
            <tbody>{grants.map((g, i) => <tr key={i}><th scope="row">{g.label || <span>A grant</span>}</th>{g.years.map((v: number, j: number) => <td key={j} className="al-table__num">{pounds(v)}</td>)}</tr>)}</tbody>
          </table></div>
        </details>
      ) : null}
    </section>
  );
}

function TakeHomeResults({ answers, ctx }: { answers: Answers; ctx: Ctx }) {
  const sides = takeHomeSides(answers, ctx);
  const fx = (answers.paye || answers.contract)!;
  const taken = (side: Side) => (side.paid ? ratePct(side.taxes / side.paid) : "—");

  // One way of being paid: its headline figures, then its breakdown.
  if (sides.length === 1) {
    const [side] = sides;
    const r = side.p;
    return <>
      <div className="th-tiles">
        {ctx.backwards
          ? <ThTile label={neededLabel(ctx.unit, side.key === "paye")} value={both(fx, side.needed as number, side.pence)}
            note={side.key === "paye" ? <span><span>a month:</span>{" "}{both(fx, (side.needed as number) / 12)}</span> : null} />
          : null}
        <ThTile label="Take-home, a month" value={both(fx, r.take_home / 12, true)} note={<span><span>a year:</span>{" "}{both(fx, r.take_home)}</span>} />
        <ThTile label="Taken in tax, NI and loans" value={taken(side)} note={<span>{both(fx, side.taxes)}{" "}<span>a year</span></span>} />
        {side.key === "paye"
          ? (ctx.backwards ? null : <ThTile label="Of your next £100" value={pounds(answers.paye!.next_100, true)} note="is yours to keep" />)
          : <ThTile label="Like a salary of" value={both(fx, side.salaryLike)} note="as an employee, for the same take-home pay" />}
        {side.key === "paye" && r.shares ? <ThTile label="From shares, after tax" value={both(fx, answers.paye!.shares_after_tax)}
          note={<span><span>of</span>{" "}{both(fx, r.shares)}{" "}<span>vesting</span></span>} /> : null}
      </div>
      <RateNote r={fx} />
      <OfferNotes r={answers.paye} />
      <DesiredDelta sides={sides} ctx={ctx} />
      <SideCard side={side} ctx={ctx} />
      <Projection r={answers.paye} />
    </>;
  }

  // All three: side by side, then each in full, folded.
  const best = sides.reduce((a, b) => (ctx.backwards ? ((b.needed as number) < (a.needed as number) ? b : a) : (b.p.take_home > a.p.take_home ? b : a)));
  const paye = sides.find((x) => x.key === "paye");
  const row = (label: string, pick: (x: Side) => number | null, kind?: string, pence = false) => (
    <tr className={kind ? `al-table__row--${kind}` : undefined}><th scope="row">{label}</th>{sides.map((x) => <td key={x.key} className="al-table__num">{pounds(pick(x) as number, pence)}</td>)}</tr>
  );
  const anyLoan = sides.some((x) => x.p.student_loan);
  return <>
    <div className="th-tiles">
      {sides.map((x) => <ThTile key={x.key} label={x.title}
        value={ctx.backwards ? both(fx, x.needed as number, x.pence) : both(fx, x.p.take_home / 12, true)}
        note={ctx.backwards
          ? <span><span>{perPay(ctx.unit)}</span>{x.key === "paye" ? <>{" · "}<span>a year:</span>{" "}{both(fx, x.p.gross)}</> : null}</span>
          : <span><span>take-home, a month</span></span>} />)}
    </div>
    {best && paye && best !== paye ? (
      <p className="th-verdict">{ctx.backwards
        ? <><span>{best.title}</span>{" "}<span>needs the least pay for what you want</span></>
        : <><span>{best.title}</span>{" "}<span>leaves you</span>{" "}<b>{both(fx, (best.p.take_home - paye.p.take_home) / 12)}</b>{" "}<span>a month more than as an employee</span></>}</p>
    ) : null}
    <RateNote r={fx} />
    <DesiredDelta sides={sides} ctx={ctx} />
    <section className="al-card viz-card"><header><h2>Side by side</h2></header>
      <div className="al-table-wrap"><table className="th-table th-side-by-side al-table">
        <caption className="al-visually-hidden">Side by side, a year</caption>
        <thead><tr><th><span className="al-visually-hidden">What</span></th>{sides.map((x) => <th key={x.key} className="al-table__num" scope="col">{x.title}</th>)}</tr></thead>
        <tbody>
          {ctx.backwards ? row(payNeeded(ctx.unit), (x) => x.needed, "sub", ctx.unit !== "year") : null}
          {row("Paid before tax", (x) => x.paid, "sub")}
          {row("Taken in tax, NI and loans", (x) => x.taxes)}
          {anyLoan ? row("Student loan", (x) => x.p.student_loan) : null}
          {row("Take-home pay, a year", (x) => x.p.take_home, "total")}
          {row("Take-home pay, a month", (x) => x.p.take_home / 12, "total")}
          {row("Like a salary of", (x) => x.salaryLike, "aside")}
        </tbody>
      </table></div>
      <p className="muted small">Taken in tax, NI and loans: income tax, National Insurance and student loans, and, for contractors, the employer's National Insurance, Apprenticeship Levy and Corporation Tax paid out of the rate.</p>
    </section>
    {sides.map((x) => <details key={x.key} className="al-disclosure th-full"><summary><span><span>{x.title}</span>{": "}<span>the full breakdown</span></span></summary><SideCard side={x} ctx={ctx} /></details>)}
    <OfferNotes r={answers.paye} />
    <Projection r={answers.paye} />
  </>;
}

// ---- an application's pay, taken home -------------------------------------------------

/** What's been worked out already, by what was asked: the page draws often. */
const takeHomeAsked = new Map<string, Promise<Row>>();
function askTakeHome(path: string, body: Row) {
  const key = `${path} ${JSON.stringify(body)}`;
  if (!takeHomeAsked.has(key)) takeHomeAsked.set(key, post(path, body).catch((e) => { takeHomeAsked.delete(key); throw e; }));
  return takeHomeAsked.get(key)!;
}

/** Something worked out once it's shown, or null while it's being, or if it can't be. */
function useWorkedOut<T>(fn: () => Promise<T> | null, deps: unknown[]): T | null | "failed" {
  const [v, setV] = useState<T | null | "failed">(null);
  useEffect(() => {
    let alive = true;
    const p = fn();
    if (!p) { setV("failed"); return; }
    p.then((x) => { if (alive) setV(x); }, () => { if (alive) setV("failed"); });
    return () => { alive = false; };
  }, deps);
  return v;
}

/**
 * What an application's pay would leave, a month: from its range (or its one
 * figure), in its currency, with your pension and loans as the Take-home
 * page has them. A salary's; or, for a contract (or pay by the day or hour),
 * inside and outside IR35. A line that fills in once it's worked out, and
 * goes if it can't be.
 */
export function TakeHomeLine({ a }: { a: Row }) {
  const ends = [...new Set([a.salary_min, a.salary_max].filter((v) => v != null && v > 0))] as number[];
  const period = a.pay_period || "year";
  const contract = a.employment === "contract" || ["day", "hour"].includes(period);
  const currency = (a.currency || HOME()).toUpperCase();
  const rs = useWorkedOut(() => {
    if (!ends.length) return null;
    const saved = takeHomeSaved();
    const you = { ...takeHomeYou(saved), year: undefined, currency };
    return Promise.all(ends.map((v) => (contract
      ? askTakeHome("take-home/contract", { ...you, ...contractTerms(saved), rate: v, per: period })
      : askTakeHome("take-home/salary", { ...you, salary: v * employeePeriods(period, saved) }))));
  }, [a.salary_min, a.salary_max, a.pay_period, a.employment, currency]);
  if (!ends.length || rs === "failed") return null;
  if (!rs) return <p className="muted small app-take-home" />;
  // A month's take-home, from the low end to the high: in your currency,
  // and the posting's beside it when that's another.
  const span = (lo: number | null, hi: number | null, cur: string) => (Math.round(lo as number) === Math.round(hi as number)
    ? money(lo, cur) : ltr(`${money(lo, cur)}–${money(hi, cur)}`));
  const range = (pick: (r: Row) => number) => {
    const [lo, hi] = [pick(rs[0]) / 12, pick(rs[rs.length - 1]) / 12];
    const mine = <b>{span(inHome(lo), inHome(hi), HOME())}</b>;
    return currency === HOME() ? mine : <>{mine}{" ("}{span(inCurrency(rs[0], lo), inCurrency(rs[0], hi), currency)}{")"}</>;
  };
  const work = <a href={`/take-home?type=${contract ? "all" : "paye"}&amount=${ends[0]}&per=${period}&currency=${currency}`}>Work it out</a>;
  return (
    <p className="muted small app-take-home">
      {contract
        ? <><span>Take-home, a month:</span>{" "}<span>inside IR35</span>{" "}{range((r) => r.inside.take_home)}{" · "}<span>outside</span>{" "}{range((r) => r.outside.take_home)}{" · "}{work}</>
        : <><span>Take-home, a month:</span>{" "}{range((r) => r.take_home)}{" · "}{work}</>}
    </p>
  );
}

/**
 * An application's pay, beside its page: the figure (an offer's, or the
 * posting's), what it leaves a month where take-home pay is on, set against
 * what you want to take home (Settings), and how it's worked out.
 * `onAdd()` goes to where a salary can be added, when there's none.
 */
export function PayPanel({ a, p, stages, onAdd }: { a: Row; p: Row | null; stages: Row[]; onAdd: () => void }) {
  const ends = [...new Set([a.salary_min, a.salary_max].filter((v) => v != null && v > 0))] as number[];
  const offer = p && stages.length && p.stage_id === stages[stages.length - 1].id;
  const period = a.pay_period || "year";
  const contract = a.employment === "contract" || ["day", "hour"].includes(period);
  const currency = (a.currency || HOME()).toUpperCase();
  const saved = takeHomeSaved();
  const worked = ends.length && takeHomeOn() && !contract;
  const rs = useWorkedOut(() => {
    if (!worked) return null;
    const you = { ...takeHomeYou(saved), year: undefined, currency };
    return Promise.all(ends.map((v) => askTakeHome("take-home/salary", { ...you, salary: v * employeePeriods(period, saved) })));
  }, [a.salary_min, a.salary_max, a.pay_period, a.employment, currency]);
  const box = (...body: ReactNode[]) => (
    <section className="al-panel app-panel app-pay-panel" data-section="pay" aria-labelledby="panel-pay">
      <div className="app-panel-head"><h2 id="panel-pay">Pay</h2><div className="app-panel-tools"><span className="al-badge al-badge--outline">{offer ? "Offer" : a.url ? "From the posting" : "As noted"}</span></div></div>
      {body}
    </section>
  );
  if (!ends.length) {
    return box(<p key="none" className="muted small">No salary yet. Add it when they share a figure, and hunt will set it against what you want to take home.</p>,
      <button key="add" className="al-button al-button--sm app-panel-add" type="button" onClick={onAdd}><Icon name="plus" /><span>Add salary</span></button>);
  }
  const home = homePay(a);
  const shown = home && (a.currency || "").toUpperCase() !== HOME()
    ? fmtMoney(home[0] == null ? null : Math.round(home[0]), home[1] == null ? null : Math.round(home[1]), HOME(), period)
    : fmtMoney(a.salary_min, a.salary_max, a.currency, period);
  const figure = <div key="figure" className="pay-figure">{shown}</div>;
  if (!takeHomeOn()) return box(figure);
  if (contract) return box(figure, <TakeHomeLine key="line" a={a} />);
  if (rs === "failed") return box(figure);
  if (!rs) return box(figure, <div key="month" className="muted small pay-month">Working out take-home…</div>);
  const lo = rs[0], hi = rs[rs.length - 1];
  const m = (r: Row, k: string) => inHome(r[k]) / 12;
  const span = (x: number, y: number) => (Math.round(x) === Math.round(y) ? money(x, HOME()) : ltr(`${money(x, HOME())}–${money(y, HOME())}`));
  // Against what you want to take home, a month.
  const want = S.PREFS.desired_take_home;
  let versus: ReactNode;
  if (want != null) {
    const wantMonth = want * (({ week: 52, month: 12, year: 1 } as Record<string, number>)[S.PREFS.desired_take_home_per || "month"] || 12) / 12;
    const [x, y] = [m(lo, "take_home"), m(hi, "take_home")];
    const min = Math.min(x, wantMonth) * 0.85, max = Math.max(y, wantMonth) * 1.1;
    const pos = (v: number) => `${((v - min) / (max - min)) * 100}%`;
    const verdict = x >= wantMonth
      ? { cls: "is-above", text: x === y ? `${money(x - wantMonth, HOME())} a month more than you want` : `More than you want across the range, by ${money(x - wantMonth, HOME())}+ a month` }
      : y < wantMonth
        ? { cls: "is-below", text: `${money(wantMonth - y, HOME())} a month short of what you want${x === y ? "" : ", even at the top"}` }
        : { cls: "", text: "What you want to take home sits inside this range" };
    versus = <>
      <div className="pay-track" aria-hidden="true">
        <span className="pay-range" style={{ insetInlineStart: pos(x), inlineSize: `max(0.5rem, calc(${pos(y)} - ${pos(x)}))` }} />
        <span className="pay-target" style={{ insetInlineStart: pos(wantMonth) }} />
      </div>
      <span className={`pay-verdict${verdict.cls ? ` ${verdict.cls}` : ""}`}>{verdict.text}</span>
    </>;
  } else {
    versus = <p className="muted small"><span>Say what you want to take home, to see how this compares.</span>{" "}<a href="/settings?tab=pay">Settings</a></p>;
  }
  const same = rs.length === 1;
  const row = (label: string, k: string, sign = -1, cls = "") => (
    <tr key={label} className={cls || undefined}><th scope="row">{label}</th>
      {rs.map((r, i) => <td key={i} className="al-table__num">{ltr(`${sign < 0 && r[k] ? "−" : ""}${money(m(r, k), HOME())}`)}</td>)}</tr>
  );
  const loans = (saved.student_loans || []).length;
  return box(figure,
    <div key="month" className="muted small pay-month"><span>Take-home</span>{" "}<b>{span(m(lo, "take_home"), m(hi, "take_home"))}</b>{" "}<span>a month</span></div>,
    <div key="versus" className="pay-versus">{versus}</div>,
    <details key="how" className="al-disclosure pay-how"><summary>How it's worked out</summary>
      <div className="al-disclosure__body">
        <table className="al-table pay-table">
          <thead><tr><th>A month</th>{rs.map((r, i) => <th key={i} className="al-table__num">{same ? homeK(inHome(r.gross)) : `At ${homeK(inHome(r.gross))}`}</th>)}</tr></thead>
          <tbody>
            {row("Salary", "gross", 1)}{row("Pension", "pension")}{row("Income tax", "income_tax")}{row("National Insurance", "ni")}
            {loans ? row("Student loan", "student_loan") : null}
            {row("Take-home", "take_home", 1, "al-table__row--total")}
          </tbody>
        </table>
        <p className="muted small">{`Uses your settings: ${savedNumber(saved, "pension", 0)}% pension, ${loans ? `${loans} student loan${loans === 1 ? "" : "s"}` : "no student loan"}. `}
          <a href="/take-home">Change in Take-home pay</a></p>
      </div>
    </details>);
}

/**
 * The applications on the running boards with a yearly salary: what each
 * leaves a month, against what you want to take home (Settings).
 */
function ApplicationsAgainstWant() {
  const want = S.PREFS.desired_take_home;
  const wantMonth = want == null ? null : want * (({ week: 52, month: 12, year: 1 } as Record<string, number>)[S.PREFS.desired_take_home_per || "month"] || 12) / 12;
  const data = useWorkedOut(async () => {
    const b = await get("board");
    const cards: Row[] = b.stages.flatMap((st: Row) => st.cards);
    const yearly = cards.filter((c) => (c.pay_period || "year") === "year" && c.employment !== "contract" && (c.salary_min || c.salary_max));
    const saved = takeHomeSaved();
    const rows = await Promise.all(yearly.map(async (c) => {
      const ends = [...new Set([c.salary_min, c.salary_max].filter((v) => v > 0))] as number[];
      const you = { ...takeHomeYou(saved), year: undefined, currency: (c.currency || HOME()).toUpperCase() };
      try {
        const rs = await Promise.all(ends.map((v) => askTakeHome("take-home/salary", { ...you, salary: v })));
        return { c, lo: inHome(rs[0].take_home) / 12, hi: inHome(rs[rs.length - 1].take_home) / 12 };
      } catch { return null; }
    }));
    const ok = rows.filter(Boolean).sort((a, b) => b!.hi - a!.hi) as { c: Row; lo: number; hi: number }[];
    return { ok, left: cards.length - ok.length };
  }, []);
  if (data === "failed" || (data && !data.ok.length)) return null;
  return (
    <section className="th-apps" aria-labelledby="th-apps">
      <div className="th-apps-head"><h2 id="th-apps">{want == null ? "Your applications" : `Your applications against ${money(want, HOME())} ${perPay(S.PREFS.desired_take_home_per || "month")}`}</h2>
        <span className="al-hint">Salary as posted or offered, after your settings. Bonuses are rarely posted, so they're left out.</span></div>
      <div className="al-table-wrap"><table className="al-table">
        <thead><tr><th>Application</th><th className="al-table__num">Salary</th><th className="al-table__num">Take-home a month</th>{want == null ? null : <th>Against what you want</th>}</tr></thead>
        <tbody>{(data?.ok || []).map(({ c, lo, hi }) => {
          const verdict = wantMonth == null ? null
            : lo >= wantMonth ? <span className="al-badge al-badge--success">{ltr(`+${money(lo - wantMonth, HOME())}`)}</span>
              : hi < wantMonth ? <span className="al-badge al-badge--warning">{ltr(`−${money(wantMonth - hi, HOME())}`)}</span>
                : <span className="al-badge al-badge--outline">Within range</span>;
          return (
            <tr key={c.id}>
              <td><div className="th-app"><a href={`/applications/${c.application_id}?process=${c.id}`} translate="no">{c.company}</a>
                <span className="muted small"><span translate="no">{c.title || ""}</span>{c.title ? " · " : ""}{c.stage}</span></div></td>
              <td className="al-table__num">{fmtMoney(c.salary_min, c.salary_max, c.currency, c.pay_period)}</td>
              <td className="al-table__num">{Math.round(lo) === Math.round(hi) ? money(lo, HOME()) : ltr(`${money(lo, HOME())}–${money(hi, HOME())}`)}</td>
              {verdict ? <td>{verdict}</td> : null}
            </tr>
          );
        })}</tbody>
      </table></div>
      <p className="al-hint">{data && data.left ? `${data.left} more without a yearly salary yet.` : ""}</p>
    </section>
  );
}
