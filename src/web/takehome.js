"use strict";

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
// (takeHomeLine). Built on app.js.

const TAKE_HOME_KEY = "takeHome";

/** Pay periods: gross pay offered is per one of these, and a rate is worked out per one. */
const PAY_PERIODS = [["hour", "Hourly"], ["day", "Daily"], ["week", "Weekly"], ["month", "Monthly"], ["year", "Annually"]];

/** Rates to work out, from the take-home pay wanted. */
const RATE_UNITS = [["hour", "Hourly rate"], ["day", "Daily rate"], ["week", "Weekly rate"], ["month", "Monthly rate"], ["year", "Annual rate"]];

/** Desired net take-home pay: its period, and how many make a year. */
const WANT_PER = [["week", "Weekly", 52], ["month", "Monthly", 12], ["year", "Annually", 1]];

/** How the pay is paid: as an employee, or as a contractor either side of IR35. */
const EMPLOYMENT_TYPES = [
  ["paye", "Employee (PAYE)"],
  ["inside", "Contractor inside IR35 (umbrella company)"],
  ["outside", "Contractor outside IR35 (your limited company)"],
  ["all", "Compare all three"],
];

/** "85,000", "£85k", "1.5m", "٨٥٬٠٠٠": a number, or null when there's none. */
function takeHomeNumber(v) {
  const s = String(v ?? "")
    .replace(/[٠-٩]/g, (d) => ARABIC_DIGITS.indexOf(d)).replace(/٫/g, ".")
    .replace(/[£,٬\s]/g, "").toLowerCase();
  if (!s) return null;
  const m = /^(\d*\.?\d+)([km]?)$/.exec(s);
  if (!m) return NaN;
  return Number(m[1]) * (m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : 1);
}

/** Money in a currency (pounds unless said): whole, or with pence. */
function money(v, currency = "GBP", pence = false) {
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
const pounds = (v, pence = false) => money(v, "GBP", pence);

/** What the page remembers, in this browser. */
function takeHomeSaved() {
  try { return JSON.parse(stored(TAKE_HOME_KEY) || "{}") || {}; } catch { return {}; }
}

/** A figure the page remembers, as a number; `fallback` when there's none. */
const savedNumber = (s, key, fallback = null) => {
  const v = takeHomeNumber(s[key]);
  return v == null ? fallback : v;
};

/** Who's paid, as the page has it, in the part of the UK Settings says. */
const takeHomeYou = (s) => ({
  year: s.year || undefined, scotland: PREFS.uk_region === "scotland", student_loans: s.student_loans || [],
  pension: savedNumber(s, "pension", 0), pension_kind: s.pension_kind || "net_pay", no_ni: !!s.no_ni,
  tax_code: String(s.tax_code || "").trim() || undefined, marriage: s.marriage || "none",
  children: Math.floor(savedNumber(s, "children", 0)), partner_higher: !!s.partner_higher,
  sacrifice: savedNumber(s, "sacrifice", 0), payroll_giving: savedNumber(s, "payroll_giving", 0), gift_aid: savedNumber(s, "gift_aid", 0),
});

/** Marriage Allowance choices. */
const MARRIAGE = [["none", "None"], ["give", "You give £1,260 of yours to your partner"], ["receive", "Your partner gives you £1,260 of theirs"]];

/** A contract's terms, as the page has them; the service's defaults for what isn't. */
const contractTerms = (s) => Object.fromEntries(
  ["hours_per_day", "days_per_week", "weeks", "umbrella_margin", "umbrella_pension", "director_salary", "expenses", "company_pension", "dividends"]
    .map((k) => [k, savedNumber(s, k) ?? undefined]));

/** Words joined with commas, each its own phrase (for translating). */
const listed = (words) => words.flatMap((w, i) => (i ? [", ", h("span", {}, w)] : [h("span", {}, w)]));

/** A rate: 0.1075 → 10.75%. */
const ratePct = (r) => ltr(new Intl.NumberFormat(LOC(), { style: "percent", maximumFractionDigits: 2 }).format(r));

/** An employee's pay periods in a year: paid for all 52 weeks, holidays included. */
function employeePeriods(per, s) {
  const days = savedNumber(s, "days_per_week", 5);
  const hours = savedNumber(s, "hours_per_day", 7.5);
  return { hour: hours * days * 52, day: days * 52, week: 52, month: 12, year: 1 }[per] ?? 1;
}

/**
 * The disclaimer under the calculator: experimental, estimates only, not
 * advice, and no liability for relying on it, as far as the law allows. In
 * the name of whoever runs this hunt, or of hunt's authors.
 */
function takeHomeDisclaimer() {
  const who = META.operator || "the authors and contributors of hunt";
  return h("aside.th-disclaimer", { "aria-label": "Disclaimer" },
    h("p", {}, h("b", {}, "Experimental."), " ", h("span", {}, "Take-home pay is an experimental tool, still being tried out, and is for general information only. It isn't tax, financial, legal or employment advice, and mustn't be relied on as such.")),
    h("p", {}, h("span", {}, "Its figures are estimates. They may be incomplete, out of date or wrong, and they leave out much that affects what you pay: other income, how and when you're actually paid, how HMRC and your employer operate your tax code, and the terms of any share plan. Check anything you rely on with HMRC (gov.uk) or a qualified adviser before you decide anything: accepting an offer, setting a rate, or filing a tax return.")),
    h("p", {}, h("span", {}, "The tool is provided “as is”, without warranty of any kind. To the fullest extent the law allows,"), " ",
      h("span", { translate: "no" }, who), ", ",
      h("span", {}, "and its directors, staff and contributors, accept no liability for any loss or damage, direct or indirect, arising from using it or relying on what it shows. Nothing here limits any liability that the law doesn't allow to be limited.")),
    META.terms ? h("p", {}, h("span", {}, "Your use of it is also covered by the"), " ", h("a", { href: "/terms", "data-reload": "" }, "terms of use"), ".") : null);
}

// ---- an offer's extras: a bonus as a %, shares, benefits in kind ------------------------

/** Share grants' vesting: how often. */
const GRANT_EVERY = [["1", "Monthly"], ["3", "Quarterly"], ["6", "Every 6 months"], ["12", "Yearly"]];

/** Bonus multipliers, yours and the company's: 0% to 200%, in 5% steps. */
const MULTIPLIERS = Array.from({ length: 41 }, (_, i) => [String(i * 5), `${i * 5}%`]);

/**
 * A bonus: an amount, or a % of salary ("15%"), as targeted; times your
 * performance multiplier and the company's (100% each, unless said).
 */
function bonusOut(s) {
  const t = String(s.bonus ?? "").trim();
  const times = (Number(s.bonus_you ?? 100) / 100) * (Number(s.bonus_company ?? 100) / 100);
  if (t.endsWith("%")) return { bonus: 0, bonus_percent: (takeHomeNumber(t.slice(0, -1)) ?? 0) * times };
  return { bonus: (takeHomeNumber(t) ?? 0) * times, bonus_percent: 0 };
}

/** Share grants, as the page has them, for the service: those filled in enough to work out. */
function grantsOut(s) {
  return (s.grants || []).map((g) => {
    const num = (k) => savedNumber(g, k);
    const option = (g.kind || "rsu") !== "rsu";
    return {
      label: g.label || "", kind: g.kind || "rsu", currency: g.currency || s.currency || "GBP",
      ...(option
        ? { shares: num("shares"), price: num("price"), strike: num("strike") ?? 0, grant_price: num("grant_price") ?? undefined }
        : { value: num("value") }),
      years: num("years") ?? 4, every_months: Number(g.every || 3), cliff_months: num("cliff") ?? 0, listed: g.listed !== false,
    };
  }).filter((g) => (g.kind === "rsu" ? g.value != null : g.shares != null && g.price != null));
}

/** Benefits in kind, as the page has them, for the service. */
function benefitsOut(s) {
  const b = s.benefits || {};
  const num = (k) => savedNumber(b, k, 0);
  return {
    car: b.car ? {
      list_price: num("list_price"), contribution: num("contribution"), co2: num("co2"), electric_range: num("electric_range"),
      diesel: !!b.diesel, fuel: !!b.fuel, payments: num("payments"),
    } : null,
    van: !!b.van, van_fuel: !!b.van && !!b.van_fuel, medical: num("medical"), loan: num("loan"), loan_rate: num("loan_rate"), other: num("other"),
  };
}

/** Whether anything in what's asked isn't a number. */
const hasNaN = (v) => (typeof v === "number" ? Number.isNaN(v)
  : v && typeof v === "object" ? Object.values(v).some(hasNaN) : false);

/**
 * Take-home pay works out UK tax: for anyone whose settings don't say they
 * live in the UK, say so, and let them say they do, here; then open it.
 */
function takeHomeGate() {
  const uk = h("input", { type: "checkbox", id: "th-gate-uk" });
  const region = h("select", { id: "th-gate-region" },
    META.uk_regions.map((o) => h("option", { value: o.value, selected: o.value === PREFS.uk_region }, o.label)));
  const regionField = h("div.field", { hidden: true }, h("label", { for: "th-gate-region" }, "Part of the UK"), region,
    h("span.al-hint", {}, "Scotland has its own income tax bands."));
  const save = h("button.al-button.al-button--primary", { type: "button", disabled: true, onclick: async () => {
    const saved = await attempt(() => patch("settings", { uk_resident: true, uk_region: region.value }));
    if (!saved) return;
    PREFS = saved;
    toast("Saved: you live in the UK");
    await showTakeHome();
  } }, "Save, and open the calculator");
  uk.addEventListener("change", () => { save.disabled = !uk.checked; regionField.hidden = !uk.checked; });
  view.replaceChildren(h("div.page.take-home", {},
    h("div.al-page-head.page-head", {}, h("h1", {}, "Take-home pay"), h("span.al-badge.al-badge--warning", {}, "Experimental")),
    h("section.al-panel.panel.th-gate", {},
      h("h2", {}, "Only for UK residents"),
      h("p", {}, "Take-home pay works out what you'd keep after UK income tax, National Insurance, student loans and pension, so it's for those who live in the UK. Your settings don't say you do."),
      h("div.location-fields", {},
        h("label.check", {}, uk, h("span", {}, "I live in the UK (a UK resident, for tax)")),
        regionField),
      h("div.actions", {}, save),
      h("p.muted.small", {}, h("span", {}, "You can change it later in"), " ", h("a", { href: "/settings" }, "Settings → Location"), ".")),
    takeHomeDisclaimer()));
}

async function showTakeHome() {
  if (!PREFS.uk_resident) { takeHomeGate(); return; }
  const options = await get("take-home");
  const c = options.contract;
  const defaults = {
    from: "pay", type: "paye", amount: "", currency: "GBP", period: "year", rate_unit: "day", bonus: "",
    sign_on: "", bonus_you: "100", bonus_company: "100", grants: [], benefits: {}, raise: "", share_growth: "", refresher: "", years: "",
    hours_per_day: c.hours_per_day, days_per_week: c.days_per_week, weeks: c.weeks,
    umbrella_margin: c.umbrella_margin, umbrella_pension: c.umbrella_pension,
    director_salary: "", expenses: "", company_pension: "", dividends: c.dividends,
    year: options.year, student_loans: [], pension: "", pension_kind: "net_pay", no_ni: false,
  };
  const saved = takeHomeSaved();
  // What an earlier page remembered: a salary, or a contract's rate.
  if (saved.type == null && saved.mode) {
    saved.type = saved.mode === "contract" ? "all" : "paye";
    if (saved.from === "take_home") Object.assign(saved, { amount: saved.want, period: saved.want_per, rate_unit: saved.rate_per });
    else if (saved.mode === "contract") Object.assign(saved, { amount: saved.rate ?? saved.day_rate, period: saved.rate_per || "day" });
    else Object.assign(saved, { amount: saved.salary, period: saved.per });
  }
  const s = { ...defaults, ...saved };
  // A year that's gone from the list: this one instead.
  if (!options.years.some((y) => y.id === s.year)) s.year = options.year;
  const query = new URLSearchParams(location.search);
  const typed = { salary: "paye", contract: "all" }[query.get("mode")] || query.get("type");
  if (EMPLOYMENT_TYPES.some(([t]) => t === typed)) s.type = typed;
  // From an application's pay: its figure, what it's per, and its currency.
  if (query.get("amount")) {
    Object.assign(s, { from: "pay", amount: query.get("amount") });
    if (PAY_PERIODS.some(([p]) => p === query.get("per"))) s.period = query.get("per");
    if (query.get("currency")) s.currency = query.get("currency").toUpperCase();
  }
  if (query.toString()) history.replaceState(null, "", appPath("/take-home"));

  const results = h("div.th-results", { "aria-live": "polite" });
  const form = h("form.th-form", { onsubmit: (e) => e.preventDefault() });

  // ---- asking ----
  let asked = 0;
  let timer = null;
  const changed = () => {
    store(TAKE_HOME_KEY, JSON.stringify(s));
    clearTimeout(timer);
    timer = setTimeout(work, 150);
  };
  const n = (key, fallback = null) => savedNumber(s, key, fallback);
  const backwards = () => s.from === "take_home";
  const employee = () => s.type === "paye" || s.type === "all";
  const contractor = () => s.type !== "paye";
  /** What a rate or salary is shown per: the pay period, or the rate to work out. */
  const unit = () => (!backwards() ? s.period : s.type === "paye" ? "year" : s.rate_unit);

  async function work() {
    const mine = ++asked;
    const amount = n("amount");
    if (amount == null) {
      fill(results, h("p.empty", {}, backwards()
        ? "Type the take-home pay you want, to see the pay that leaves it."
        : "Type the gross pay offered, to see what you'd take home."));
      return;
    }
    const yearly = backwards() ? amount * (WANT_PER.find(([p]) => p === s.period)?.[2] ?? 1) : null;
    const terms = contractTerms(s);
    const you = takeHomeYou(s);
    // An employee's offer: bonus, sign-on, shares, benefits, the years ahead.
    const offer = {
      ...bonusOut(s), employer_pension: n("employer_pension", 0), sign_on: n("sign_on", 0),
      grants: grantsOut(s), benefits: benefitsOut(s),
      raise: n("raise", 0), share_growth: n("share_growth", 0), refresher: n("refresher", 0),
      years: n("years") == null ? undefined : Math.round(n("years")),
    };
    const numbers = [amount, yearly, employeePeriods(s.period, s), ...Object.values(terms),
      you.pension, you.children, you.sacrifice, you.payroll_giving, you.gift_aid];
    if (numbers.some((v) => Number.isNaN(v)) || hasNaN(offer)) {
      problem("That isn't a number hunt can read: try 85000 or 85k.");
      return;
    }
    const base = { ...you, year: s.year, currency: s.currency };
    try {
      const [paye, contract] = await Promise.all([
        employee() ? post("take-home/salary", { ...base, ...offer,
          ...(backwards() ? { take_home: yearly } : { salary: amount * employeePeriods(s.period, s) }) }) : null,
        contractor() ? post("take-home/contract", { ...base, ...terms, per: unit(),
          ...(backwards() ? { take_home: yearly } : { rate: amount }) }) : null,
      ]);
      if (mine !== asked) return;
      results.classList.remove("th-stale");
      fill(results, takeHomeResults({ paye, contract }, {
        type: s.type, backwards: backwards(), unit: unit(), perYear: (per) => employeePeriods(per, s),
        hours: n("hours_per_day", defaults.hours_per_day), daysPerWeek: n("days_per_week", defaults.days_per_week),
        code: s.tax_code,
      }));
      // The code these figures would give, to use: the employee's, or the contractor's.
      const first = paye || (s.type === "outside" ? contract.outside : contract.inside);
      advised = first?.tax_code_advice?.code || null;
      drawAdvice();
    } catch (e) {
      if (mine !== asked) return;
      problem(e.message);
    }
  }

  // Something half typed: say what, above the last figures, faded, until
  // it can be worked out again (or in place of nothing, the first time).
  function problem(message) {
    results.querySelector(":scope > .th-problem")?.remove();
    const note = notice("danger", { role: "status", class: "th-problem" }, message);
    if (results.querySelector(".viz-card")) {
      results.classList.add("th-stale");
      results.prepend(note);
    } else {
      fill(results, note);
    }
  }

  // Back to this page from elsewhere (Settings in another tab, say): the
  // settings again, and the figures with them.
  const refresh = async () => {
    if (document.visibilityState !== "visible" || !results.isConnected) return;
    try { PREFS = await get("settings"); } catch { return; }
    if (results.isConnected) work();
  };
  document.addEventListener("visibilitychange", refresh);
  const stop = new MutationObserver(() => {
    if (!results.isConnected) { document.removeEventListener("visibilitychange", refresh); stop.disconnect(); }
  });
  stop.observe(view, { childList: true });

  // ---- the form ----
  const field = (id, label, input, hint) => h("div.field", {}, h("label", { for: id }, label), input, hint ? h("span.al-hint", {}, hint) : null);
  const numberBox = (key, placeholder) => h("input", {
    id: `th-${key}`, type: "text", inputmode: "decimal", autocomplete: "off", value: s[key] ?? "", placeholder,
    oninput: (e) => { s[key] = e.target.value; changed(); },
  });
  const choose = (key, choices, after) => h("select", { id: `th-${key}`, onchange: (e) => { s[key] = e.target.value; changed(); after?.(); } },
    choices.map(([v, l]) => h("option", { value: v, selected: String(s[key]) === String(v) }, l)));
  const tick = (key, label, after) => h("label.th-check", {},
    h("input", { type: "checkbox", checked: !!s[key], onchange: (e) => { s[key] = e.target.checked; changed(); after?.(); } }), label);
  const currencies = [...new Set([s.currency, ...CURRENCIES])];

  // Folded: what's chosen beside the name.
  // A fold that shows what's chosen inside it: the design system's disclosure.
  const fold = (title, summary, ...body) => {
    summary?.classList?.add("al-disclosure__value");
    return h("details.al-disclosure.th-fold", {},
      h("summary", {}, h("span", {}, title), summary), h("div.al-disclosure__body.th-fields", {}, body));
  };

  // Student loans and pension, about you.
  const loansChosen = h("span.th-chosen");
  const drawLoans = () => {
    const chosen = options.student_loans.filter((p) => s.student_loans.includes(p.value)).map((p) => p.label);
    fill(loansChosen, chosen.length ? listed(chosen) : h("span", {}, "None"));
  };
  const loans = fold("Student loans", loansChosen,
    h("div.th-checks", { role: "group", "aria-label": "Student loans" }, options.student_loans.map((p) => h("label.th-check", {},
      h("input", { type: "checkbox", checked: s.student_loans.includes(p.value), onchange: (e) => {
        s.student_loans = e.target.checked ? [...new Set([...s.student_loans, p.value])] : s.student_loans.filter((x) => x !== p.value);
        drawLoans();
        changed();
      } }), p.label))));
  const pensionChosen = h("span.th-chosen");
  const drawPension = () => {
    const pct = n("pension", 0);
    fill(pensionChosen, pct && !Number.isNaN(pct)
      ? [ratePct(pct / 100), ", ", h("span", {}, choiceLabel(options.pension_kinds, s.pension_kind))]
      : h("span", {}, "None"));
  };
  const pensionBox = numberBox("pension", "0");
  pensionBox.addEventListener("input", drawPension);
  const pension = fold("Workplace pension", pensionChosen,
    h("div.th-pair", {},
      field("th-pension", "Your contribution (% of pay)", pensionBox),
      field("th-pension_kind", "How it's paid", choose("pension_kind", options.pension_kinds.map((k) => [k.value, k.label]), drawPension))),
    h("p.th-hint", {}, "As an employee or inside IR35. Outside IR35, your company pays in instead."),
    field("th-employer_pension", "Employer's contribution (% of salary)", numberBox("employer_pension", "0"),
      "As an employee: on top of your pay, so your take-home pay is the same."));

  // A section whose summary says what's in it, redrawn as it changes.
  const summed = (draw) => {
    const el = h("span.th-chosen");
    const redraw = () => fill(el, draw());
    redraw();
    return [el, redraw];
  };
  const none = () => h("span", {}, "None");
  const watched = (box, redraw) => { box.addEventListener("input", redraw); return box; };

  const [codeChosen, drawCode] = summed(() => [
    s.tax_code ? h("span", { translate: "no" }, String(s.tax_code).toUpperCase()) : h("span", {}, "Usual (1257L)"),
    s.marriage && s.marriage !== "none" ? [", ", h("span", {}, "Marriage Allowance")] : null]);
  // The code: typed, or chosen from common ones (the recommended first).
  const codeBox = watched(numberBox("tax_code", "1257L, or choose one"), () => { drawCode(); drawAdvice(); });
  Object.assign(codeBox, { inputMode: "text", autocapitalize: "characters", spellcheck: false });
  codeBox.setAttribute("list", "th-codes");
  const codeList = h("datalist", { id: "th-codes" });
  const taxCode = fold("Tax code", codeChosen,
    field("th-tax_code", "Tax code", [codeBox, codeList],
      "On your payslip or P60: type it, or choose a common one. Empty is the usual one, which tapers away from £100,000."),
    field("th-marriage", "Marriage Allowance", choose("marriage", MARRIAGE, drawCode),
      "Between spouses or civil partners, when one pays no more than the basic rate. With the usual tax code only: a code already includes it."));
  // The code the figures would give, once they're worked out, to use.
  let advised = null;
  const adviceLine = h("p.th-hint.th-advice");
  const setCode = (code) => {
    s.tax_code = code;
    codeBox.value = code;
    drawCode();
    drawAdvice();
    changed();
  };
  const drawAdvice = () => {
    fill(adviceLine, [
      advised ? [h("span", {}, "Recommended for these figures:"), " ", h("b", { translate: "no" }, advised),
        codeKey(s.tax_code) === codeKey(advised) ? [" ", h("span", {}, "(the one you have)")]
          : [" · ", h("button.al-button.al-button--sm.al-button--quiet", { type: "button", onclick: () => setCode(advised) }, "Use it")]] : null,
      s.tax_code ? [advised ? " · " : null, h("button.al-button.al-button--sm.al-button--quiet", { type: "button", onclick: () => setCode("") }, "Clear")] : null]);
    // Common codes to choose from, described; Scotland's with its S.
    const sc = PREFS.uk_region === "scotland" ? "S" : "";
    const common = [
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
    ].filter(Boolean).filter(([c], i, all) => all.findIndex(([d]) => codeKey(d) === codeKey(c)) === i);
    fill(codeList, common.map(([code, about]) => h("option", { value: code }, about)));
  };
  drawAdvice();
  taxCode.querySelector(".th-fields").prepend(adviceLine);

  const [childrenChosen, drawChildren] = summed(() => {
    const kids = Math.floor(n("children", 0));
    return kids > 0 ? h("span", {}, kids === 1 ? "1 child" : `${kids} children`) : none();
  });
  const childBenefit = fold("Child Benefit", childrenChosen,
    field("th-children", "Children you get Child Benefit for", watched(numberBox("children", "0"), drawChildren)),
    tick("partner_higher", "Your partner's income is higher (they pay the charge, not you)"),
    h("p.th-hint", {}, "The High Income Child Benefit Charge takes back 1% of Child Benefit for every £200 of adjusted net income over £60,000, and all of it from £80,000. It's paid through Self Assessment."));

  const [sacrificeChosen, drawSacrifice] = summed(() => (n("sacrifice", 0) > 0 ? money(n("sacrifice", 0)) : none()));
  const sacrifice = fold("Other salary sacrifice", sacrificeChosen,
    field("th-sacrifice", "Salary sacrifice, a year", watched(numberBox("sacrifice", "0"), drawSacrifice),
      "Cycle to Work, an electric car or other schemes: taken off your pay before tax and National Insurance. As an employee or inside IR35. A pension paid by salary sacrifice goes under Workplace pension."));

  const [givingChosen, drawGiving] = summed(() => {
    const total = n("gift_aid", 0) + n("payroll_giving", 0);
    return total > 0 ? money(total) : none();
  });
  const giving = fold("Gift Aid and payroll giving", givingChosen,
    h("div.th-pair", {},
      field("th-gift_aid", "Gift Aid donations, a year", watched(numberBox("gift_aid", "0"), drawGiving)),
      field("th-payroll_giving", "Payroll giving, a year", watched(numberBox("payroll_giving", "0"), drawGiving))),
    h("p.th-hint", {}, "Gift Aid: what you give; the charity claims the basic rate on top, and your basic rate band grows by the total, so higher-rate taxpayers pay less tax. Payroll giving comes off your pay before tax."));
  const statePensionChosen = h("span.th-chosen");
  const drawStatePension = () => fill(statePensionChosen, h("span", {}, s.no_ni ? "Over State Pension age" : "Under State Pension age"));
  const statePension = fold("State Pension", statePensionChosen,
    tick("no_ni", "Over the State Pension age (no National Insurance)", drawStatePension),
    h("p.th-hint", {}, "From State Pension age you stop paying National Insurance on your pay; income tax is the same. Employers still pay theirs."));
  drawLoans();
  drawPension();
  drawStatePension();

  const aboutYou = h("section.al-panel.panel", {}, h("h2", {}, "About you"),
    h("div.th-fields", {},
      taxCode,
      loans,
      pension,
      statePension,
      childBenefit,
      sacrifice,
      giving));

  // ---- shares, benefits in kind and the years ahead (employees) ----
  function offerSections() {
    // Shares: each grant, its kind, how much, and how it vests.
    const grantsList = h("div.th-grants");
    const [sharesChosen, drawSharesChosen] = summed(() => (s.grants.length
      ? h("span", {}, s.grants.length === 1 ? "1 grant" : `${s.grants.length} grants`) : none()));
    const grantRow = (g, i) => {
      const set = (k, redraw) => (e) => {
        g[k] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
        changed();
        if (redraw) drawGrants();
      };
      const box = (k, label, placeholder, hint) => field(`th-g${i}-${k}`, label, h("input", {
        id: `th-g${i}-${k}`, type: "text", inputmode: "decimal", autocomplete: "off", value: g[k] ?? "", placeholder, oninput: set(k),
      }), hint);
      const sel = (k, label, choices, redraw) => field(`th-g${i}-${k}`, label, h("select", { id: `th-g${i}-${k}`, onchange: set(k, redraw) },
        choices.map(([v, l]) => h("option", { value: v, selected: String(g[k]) === String(v) }, l))));
      const option = (g.kind || "rsu") !== "rsu";
      return h("div.th-grant", {},
        h("div.th-grant-head", {},
          h("input.th-grant-name", { type: "text", value: g.label || "", placeholder: "e.g. New hire grant", "aria-label": "Grant name", oninput: set("label") }),
          h("button.al-button.al-button--sm.al-button--quiet.al-button--danger", { type: "button", onclick: () => { s.grants.splice(i, 1); drawGrants(); changed(); } }, "Remove")),
        h("div.th-pair", {},
          sel("kind", "Type", options.grant_kinds.map((k) => [k.value, k.label]), true),
          sel("currency", "Currency", currencies.map((cur) => [cur, cur]))),
        option
          ? h("div.th-pair", {}, box("shares", "Options", "e.g. 1,000"), box("price", "Share price now", "e.g. 10"), box("strike", "Exercise price", "e.g. 4"))
          : box("value", "Grant value", "e.g. 300,000", "What it's worth at grant, as the offer says."),
        g.kind === "emi" ? box("grant_price", "Market value at grant", "The share price now", "EMI is taxed only on any discount below it.") : null,
        h("div.th-pair", {},
          box("years", "Vests over (years)", "4"),
          sel("every", "Vests", GRANT_EVERY),
          box("cliff", "Cliff (months)", "0")),
        h("label.th-check", {}, h("input", { type: "checkbox", checked: g.listed !== false, onchange: set("listed") }),
          h("span", {}, "Listed (readily convertible): tax and NI through payroll")));
    };
    function drawGrants() {
      fill(grantsList, s.grants.map(grantRow),
        h("button.al-button.al-button--quiet.app-add", { type: "button", onclick: () => {
          s.grants.push({ label: "", kind: "rsu", currency: s.currency, years: "4", every: "3", cliff: "0", listed: true });
          drawGrants();
          changed();
        } }, "+ Add a grant"));
      drawSharesChosen();
    }
    drawGrants();
    const shares = fold("Shares: RSUs and options", sharesChosen, grantsList,
      h("p.th-hint", {}, "Taxed as they vest: RSUs on their value; unapproved options on the gain; EMI only on a discount at grant; CSOP options free of tax from 3 years after grant; Sharesave free. Options are taken as bought, and shares sold, as they vest."));

    // Benefits in kind.
    const b = s.benefits;
    const bset = (k, redraw) => (e) => {
      b[k] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
      changed();
      drawBenefitsChosen();
      if (redraw) drawBenefits();
    };
    const bbox = (k, label, placeholder, hint) => field(`th-b-${k}`, label, h("input", {
      id: `th-b-${k}`, type: "text", inputmode: "decimal", autocomplete: "off", value: b[k] ?? "", placeholder, oninput: bset(k),
    }), hint);
    const btick = (k, label, redraw) => h("label.th-check", {}, h("input", { type: "checkbox", checked: !!b[k], onchange: bset(k, redraw) }), h("span", {}, label));
    const benefitsBody = h("div.th-fields");
    const [benefitsChosen, drawBenefitsChosen] = summed(() => {
      const names = [b.car && "Car", b.van && "Van", savedNumber(b, "medical", 0) > 0 && "Medical",
        savedNumber(b, "loan", 0) > 0 && "Loan", savedNumber(b, "other", 0) > 0 && "Other"].filter(Boolean);
      return names.length ? listed(names) : none();
    });
    function drawBenefits() {
      fill(benefitsBody,
        btick("car", "A company car", true),
        b.car ? h("div.th-group", {},
          h("div.th-pair", {}, bbox("list_price", "List price", "e.g. 40,000"), bbox("co2", "CO2 (g/km)", "0 for electric")),
          h("div.th-pair", {}, bbox("electric_range", "Electric range (miles)", "For 1 to 50 g/km"), bbox("contribution", "You paid towards it", "0")),
          bbox("payments", "You pay for private use, a year", "0"),
          btick("diesel", "Diesel, not to the RDE2 standard (4% more)"),
          btick("fuel", "Fuel for private journeys paid for")) : null,
        btick("van", "A company van", true),
        b.van ? btick("van_fuel", "And fuel for it") : null,
        bbox("medical", "Private medical insurance, a year", "0", "What it costs your employer."),
        h("div.th-pair", {}, bbox("loan", "A loan from your employer", "0"), bbox("loan_rate", "Interest you pay (%)", "0")),
        bbox("other", "Other benefits, a year", "0", "Their taxable value, as on a P11D."),
        h("p.th-hint", {}, "Taxed as pay, though not paid: no employee's National Insurance, and your employer pays Class 1A on them. HMRC usually takes the tax through your tax code. Loans of £10,000 or less are free of tax."));
    }
    drawBenefits();
    const benefits = fold("Benefits in kind", benefitsChosen, benefitsBody);

    // The years ahead.
    const [yearsChosen, drawYearsChosen] = summed(() => {
      const yrs = n("years");
      return yrs ? h("span", {}, `${Math.round(yrs)} years`) : h("span", {}, "As the shares vest");
    });
    const years = fold("Over the years", yearsChosen,
      h("div.th-pair", {},
        field("th-raise", "Pay rise a year (%)", numberBox("raise", "0")),
        field("th-share_growth", "Share price growth a year (%)", numberBox("share_growth", "0"))),
      h("div.th-pair", {},
        field("th-refresher", "Refresher RSUs a year", numberBox("refresher", "0"), "Granted each year from the second, vesting as the first RSU grant."),
        field("th-years", "Years", watched(numberBox("years", "4"), drawYearsChosen), "As long as the longest grant, at least 4, unless said.")));
    return [shares, benefits, years];
  }

  const payInfo = h("section.al-panel.panel.th-pay-info");

  function drawPayInfo() {
    // Desired take-home pay is weekly, monthly or annual.
    const periods = backwards() ? WANT_PER.map(([v, l]) => [v, l]) : PAY_PERIODS;
    if (!periods.some(([v]) => v === s.period)) s.period = backwards() ? "month" : "year";
    const start = h("div.al-segmented.al-segmented--fill.th-from", { role: "group", "aria-labelledby": "th-start-label" },
      [["pay", "Gross pay offered"], ["take_home", "Desired net take-home pay"]].map(([v, l]) => h("button", {
        type: "button", "aria-pressed": String(s.from === v), onclick: () => {
          // Switching to take-home pay: start from what Settings says you want.
          if (v === "take_home" && s.from !== v && PREFS.desired_take_home != null) {
            Object.assign(s, { amount: String(PREFS.desired_take_home), period: PREFS.desired_take_home_per || "month", currency: HOME() });
          }
          s.from = v; drawPayInfo(); changed();
        },
      }, l)));
    const amountLabel = backwards() ? "Take-home pay (after tax)"
      : { paye: "Gross salary (before tax)", inside: "Contract rate (before tax)", outside: "Contract rate (before tax)", all: "Gross pay or rate (before tax)" }[s.type];
    const per = unit();
    const hours = per === "hour";
    const days = contractor() || ["hour", "day"].includes(per);
    const pattern = hours || days
      ? h("div.th-group", {}, h("h3", {}, "Working pattern"),
        h("div.th-pair", {},
          hours ? field("th-hours_per_day", "Hours a day", numberBox("hours_per_day", "7.5")) : null,
          days ? field("th-days_per_week", "Days a week", numberBox("days_per_week", "5")) : null,
          contractor() ? field("th-weeks", "Weeks worked a year", numberBox("weeks", "46")) : null),
        h("p.th-hint", {}, contractor()
          ? "Contractors are paid only for weeks worked: 52, less holidays, bank holidays and time between contracts."
          : "Employees are paid for all 52 weeks, holidays included."))
      : null;
    const umbrella = ["inside", "all"].includes(s.type)
      ? h("details.al-disclosure.th-more", {},
        h("summary", {}, "Umbrella company (inside IR35)"),
        h("div.th-fields", {},
          h("div.th-pair", {},
            field("th-umbrella_margin", "Umbrella margin, a week", numberBox("umbrella_margin", "20")),
            field("th-umbrella_pension", "Employer pension contribution (%)", numberBox("umbrella_pension", "0"))),
          h("p.th-hint", {}, "Umbrella companies pay their costs out of your rate: their margin, employer's National Insurance, the Apprenticeship Levy and any employer pension contribution (3% of qualifying earnings, if you're enrolled).")))
      : null;
    const company = ["outside", "all"].includes(s.type)
      ? h("details.al-disclosure.th-more", {},
        h("summary", {}, "Your limited company (outside IR35)"),
        h("div.th-fields", {},
          field("th-director_salary", "Director's salary, a year", numberBox("director_salary", "12,570"), "The Personal Allowance, unless you say otherwise."),
          h("div.th-pair", {},
            field("th-expenses", "Business expenses, a year", numberBox("expenses", "0")),
            field("th-company_pension", "Employer pension contribution, a year", numberBox("company_pension", "0"))),
          field("th-dividends", "Profit taken as dividends (%)", numberBox("dividends", "100"), "What isn't taken stays in the company, to take later."),
          h("p.th-hint", {}, "In pounds: the company is in the UK.")))
      : null;
    fill(payInfo, h("h2", {}, "Pay information"),
      h("div.th-fields", {},
        h("div.field", {}, h("span.th-label", { id: "th-start-label" }, "Start from"), start),
        field("th-type", "Employment type", choose("type", EMPLOYMENT_TYPES, drawPayInfo)),
        h("div.th-money", {},
          field("th-amount", amountLabel, numberBox("amount", backwards() ? "e.g. 4,000" : "e.g. 85,000")),
          field("th-currency", "Currency", choose("currency", currencies.map((cur) => [cur, cur]))),
          field("th-period", "Pay period", choose("period", periods, drawPayInfo))),
        backwards() && contractor() ? field("th-rate_unit", "Rate to work out", choose("rate_unit", RATE_UNITS, drawPayInfo)) : null,
        employee() ? h("div.th-pair.th-top", {},
          field("th-bonus", "Bonus, a year (before tax)", numberBox("bonus", "0, or 15%"),
            backwards() ? "On top of the salary worked out: an amount, or a % of salary." : "An amount, or a % of salary (a target bonus)."),
          field("th-sign_on", "Sign-on bonus", numberBox("sign_on", "0"), "Paid in the first year.")) : null,
        employee() ? h("div.th-pair", {},
          field("th-bonus_you", "Your performance", choose("bonus_you", MULTIPLIERS)),
          field("th-bonus_company", "The company's performance", choose("bonus_company", MULTIPLIERS))) : null,
        employee() ? h("p.th-hint", {}, "Multipliers on the target bonus, as your company pays it: 100% each is the target.") : null,
        employee() && s.type === "all" ? h("p.th-hint", {}, "Bonuses, shares and benefits are for the employee only.") : null,
        pattern,
        employee() ? offerSections() : null,
        umbrella,
        company));
  }

  drawPayInfo();
  form.append(payInfo, aboutYou);
  view.replaceChildren(h("div.page.take-home", {},
    h("div.al-page-head.page-head", {}, h("h1", {}, "Take-home pay"), h("span.al-badge.al-badge--warning", {}, "Experimental"),
      // Where you live (Settings → Location) and the tax year: what the rates are.
      h("div.th-meta", {},
        h("div.th-where", {}, h("span.th-head-label", {}, "Where you live"),
          h("a", { href: "/settings", title: t("Change in Settings") }, choiceLabel(META.uk_regions, PREFS.uk_region))),
        h("div.th-year", {}, h("label.th-head-label", { for: "th-year" }, "Tax year"), choose("year", options.years.map((y) => [y.id, y.label]))))),
    h("p.muted.th-intro", {}, "What you'd keep in the UK after income tax, National Insurance, student loans and pension: as an employee, or as a contractor inside or outside IR35. Or the other way round: the pay that leaves what you want."),
    h("div.th-layout", {}, form, results),
    applicationsAgainstWant(),
    h("p.muted.small.th-small-print", {}, "Estimates for a whole tax year, as if paid evenly through it, at HMRC's rates for the year chosen; other currencies at the day's rate. Other income and VAT aren't included."),
    takeHomeDisclaimer()));
  await work();
}

// ---- results --------------------------------------------------------------------------

/** A table of money: rows of [label, value, {kind}], in columns that divide a year. */
function moneyTable(caption, periods, rows) {
  return h("div.al-table-wrap", {}, h("table.th-table", {},
    h("caption.al-visually-hidden", {}, caption),
    h("thead", {}, h("tr", {}, h("th", {}, h("span.al-visually-hidden", {}, "What")), periods.map(([l]) => h("th.al-table__num", { scope: "col" }, l)))),
    h("tbody", {}, rows.filter(Boolean).map(([label, v, kind]) => h("tr", { class: kind ? `al-table__row--${kind}` : "" },
      h("th", { scope: "row" }, label),
      periods.map(([, by]) => h("td.al-table__num", {}, pounds(v / by))))))));
}

/** How a figure was reached: bands, rates, and how much of the income is in each. */
function bandsTable(title, slices) {
  if (!slices?.length) return null;
  return h("div.th-bands", {}, h("h3", {}, title),
    h("table.th-table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Band"), h("th.al-table__num", {}, "Rate"), h("th.al-table__num", {}, "On"), h("th.al-table__num", {}, "Comes to"))),
      h("tbody", {}, slices.map((b) => h("tr", {}, h("th", { scope: "row" }, b.name), h("td.al-table__num", {}, ratePct(b.rate)), h("td.al-table__num", {}, pounds(b.on)), h("td.al-table__num", {}, pounds(b.tax, true)))))));
}

/** The workings of a payslip, folded. */
function workings(p) {
  return h("details.al-disclosure.th-workings", {}, h("summary", {}, "How it's worked out"),
    h("p.small", {}, h("span", {}, "Personal allowance (tax-free)"), " ", h("b", {}, pounds(p.personal_allowance))),
    bandsTable("Income tax", p.tax_bands),
    bandsTable("Dividend tax", p.dividend_bands),
    bandsTable("National Insurance", p.ni_bands),
    bandsTable("Student loans", p.loans),
    p.tax_code_advice ? h("div.th-bands", {}, h("h3", {}, h("span", {}, "Tax code for these figures:"), " ", h("span", { translate: "no" }, p.tax_code_advice.code)),
      h("ul.th-reasons", {}, p.tax_code_advice.reasons.map((x) => h("li", {}, x))),
      h("p.muted.small", {}, "Worked out as HMRC does, from these figures alone: other income, benefits in kind or tax owed would change it.")) : null);
}

/** A tax code, for comparing: capitals, no spaces. */
const codeKey = (c) => String(c || "").replace(/\s+/g, "").toUpperCase();

const thTile = (label, value, note) => h("div.al-stat.viz-tile", {}, h("span.al-stat__label", {}, label), h("span.al-stat__value", {}, value), note ? h("span.al-stat__note", {}, note) : null);

/** Pounds back in the currency pay was typed in. */
const inCurrency = (r, gbp) => (gbp == null ? null : gbp / (r.gbp_rate || 1));

/** Pounds in your currency (Settings → Language and region). */
const inHome = (gbp) => (HOME() === "GBP" ? gbp : fromGbp(gbp));

/** A day's rate to pounds: "1 EUR = 0.8448 GBP, the rate on 12 Oct 2026". */
const rateOf = (currency, rate, on) => [ltr(`1 ${currency} = ${rate.toFixed(4)} GBP`),
  on ? [", ", h("span", {}, "the rate on"), " ", new Date(`${on}T12:00`).toLocaleDateString(LOC(), { day: "numeric", month: "short", year: "numeric" })] : null];

/** The rates amounts were turned at: from the currency typed, and to yours, where they aren't pounds. */
function rateNote(r) {
  const typed = r.currency || "GBP";
  const rates = [
    typed !== "GBP" ? rateOf(typed, r.gbp_rate, r.gbp_rate_on) : null,
    HOME() !== "GBP" && HOME() !== typed ? rateOf(HOME(), PREFS.currency_rate, PREFS.currency_rate_on) : null,
  ].filter(Boolean);
  if (!rates.length) return null;
  return h("p.muted.small.th-rate-note", {}, h("span", {}, "Exchange rates"), ": ", rates.map((x, i) => [i ? "; " : "", x]), ".");
}

/**
 * An amount worked out in pounds, in your currency (Settings → Language
 * and region); with the currency pay was typed in beside it, smaller, when
 * that's another.
 */
function both(r, gbp, pence = false) {
  const home = HOME();
  const typed = r.currency || "GBP";
  const mine = money(inHome(gbp), home, pence);
  if (typed === home) return mine;
  return [mine, h("span.th-also", {}, " (", money(inCurrency(r, gbp), typed, pence), ")")];
}

/** Pay per a period, as words: "a day". */
const perPay = (per) => ({ hour: "an hour", day: "a day", week: "a week", month: "a month", year: "a year" })[per] || per;

/** What's needed per a period: "Daily rate needed"; an employee's, a year. */
const neededLabel = (per, employee) => (employee ? "Gross salary needed, a year"
  : { hour: "Hourly rate needed", day: "Daily rate needed", week: "Weekly rate needed", month: "Monthly rate needed", year: "Annual rate needed" }[per]);

/** Pay needed per a period, whoever's paid it: "Daily pay needed". */
const payNeeded = (per) => ({ hour: "Hourly pay needed", day: "Daily pay needed", week: "Weekly pay needed", month: "Monthly pay needed", year: "Annual pay needed" })[per];

/** A payslip's other deductions: before tax (sacrifice, giving), after it (Gift Aid, the Child Benefit charge), and beside it. */
const extras = (p) => ({
  before: [
    p.sacrifice ? ["Salary sacrifice", p.sacrifice] : null,
    p.payroll_giving ? ["Payroll giving", p.payroll_giving] : null,
  ],
  after: [
    p.gift_aid ? ["Gift Aid donations", p.gift_aid] : null,
    p.child_benefit_charge ? ["High Income Child Benefit Charge", p.child_benefit_charge] : null,
  ],
  aside: [p.child_benefit ? ["Child Benefit (paid separately)", p.child_benefit, "aside"] : null],
});

/**
 * Each way of being paid that was asked about: its name, what it takes
 * home, what it needs (from take-home pay wanted), its breakdown, and the
 * figures it's compared by.
 */
function takeHomeSides({ paye, contract }, ctx) {
  const out = [];
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
const sideCard = (side, ctx) => h("section.al-card.viz-card.th-side", {},
  h("header", {}, h("h2", {}, side.title), h("p.muted.small", {}, side.about)),
  codeLine(side.p, ctx),
  moneyTable(side.title, side.periods, side.rows),
  workings(side.p));

/** The tax code these figures would give; and, where another was typed, that they differ. */
function codeLine(p, ctx) {
  const advice = p.tax_code_advice;
  if (!advice) return null;
  const mine = codeKey(ctx.code);
  return h("p.small.th-code-advice", {},
    h("span.muted", {}, "Tax code for these figures:"), " ", h("b", { translate: "no" }, advice.code),
    mine && mine !== codeKey(advice.code)
      ? [" · ", h("span.th-code-differs", {}, h("span", {}, "yours,"), " ", h("span", { translate: "no" }, mine), h("span", {}, ", is different: the tax taken through the year won't be right, and the difference is settled afterwards."))]
      : null);
}

/**
 * Take-home pay against what you want (Settings → Desired net take-home
 * pay), in your currency: an hour, a day, a month and a year, each way of
 * being paid, with how much more or short it is.
 */
function desiredDelta(sides, ctx) {
  const want = PREFS.desired_take_home;
  if (want == null) {
    return h("p.muted.small.th-desired-none", {},
      h("span", {}, "Say what you want to take home in Settings, to see how these figures compare."), " ",
      h("a", { href: "/settings" }, "Settings"));
  }
  const per = PREFS.desired_take_home_per || "month";
  const wantYear = want * ({ week: 52, month: 12, year: 1 }[per] || 12);
  const home = HOME();
  // How many of each a year: an employee is paid for all 52 weeks, a
  // contractor for the days worked.
  const units = (side, unit) => {
    if (unit === "month") return 12;
    if (unit === "year") return 1;
    const days = side.key === "paye" ? ctx.perYear("day") : side.r.days;
    return unit === "day" ? days : days * (side.key === "paye" ? ctx.perYear("hour") / ctx.perYear("day") : ctx.hours);
  };
  const periods = [["hour", "An hour"], ["day", "A day"], ["month", "A month"], ["year", "A year"]];
  const cell = (side, unit) => {
    const count = units(side, unit);
    if (!count) return h("td.al-table__num", {}, "—");
    const pence = unit === "hour" || unit === "day";
    const got = inHome(side.p.take_home) / count;
    // What you want is in your currency already.
    const diff = got - wantYear / count;
    const even = Math.abs(diff) < (pence ? 0.005 : 0.5);
    return h("td.al-table__num", {},
      h("span.th-cell-main", {}, money(got, home, pence)),
      h("span.th-cell-diff", { class: even ? "" : diff > 0 ? "th-more-pay" : "th-less-pay" },
        even ? h("span", {}, "As you want")
          : [ltr(`${diff > 0 ? "+" : "−"}${money(Math.abs(diff), home, pence)}`), " ", h("span", {}, diff > 0 ? "more" : "short")]));
  };
  return h("section.al-card.viz-card.th-desired", {},
    h("header", {}, h("h2", {}, "Against what you want"),
      h("p.muted.small", {}, h("span", {}, "You want to take home"), " ", h("b", {}, money(want, home)), " ", h("span", {}, perPay(per)), " · ",
        h("a", { href: "/settings" }, "Change in Settings"))),
    h("div.al-table-wrap", {}, h("table.th-table.th-desired-table", {},
      h("caption.al-visually-hidden", {}, "Take-home pay, and the difference from what you want"),
      h("thead", {}, h("tr", {}, h("th", {}, h("span.al-visually-hidden", {}, "What")),
        periods.map(([, label]) => h("th.al-table__num", { scope: "col" }, label)))),
      h("tbody", {}, sides.map((side) => h("tr", {},
        h("th", { scope: "row" }, side.title),
        periods.map(([unit]) => cell(side, unit))))))),
    h("p.muted.small", {}, "Take-home pay in each period, and below it how much more or less than you want. Hours and days as paid: an employee for all 52 weeks, a contractor for the days worked."));
}

/** What's odd about the grants: over a scheme's limit, say. */
const offerNotes = (r) => (r?.notes?.length
  ? notice("warning", { class: "th-notes" }, r.notes.map((x) => h("p", {}, x))) : null);

/**
 * An employee's offer year by year, from the start: pay, shares, what's
 * taken and what's left; and each grant's vesting.
 */
function projection(r, fx) {
  const years = r?.projection || [];
  if (!years.length) return null;
  const head = h("tr", {}, h("th", {}, h("span.al-visually-hidden", {}, "What")), years.map((y) => h("th.al-table__num", { scope: "col" }, h("span", {}, "Year"), " ", String(y.year))));
  const row = (label, pick, kind) => (years.some((y) => pick(y)) || kind === "total" || kind === "sub"
    ? h("tr", { class: kind ? `al-table__row--${kind}` : "" }, h("th", { scope: "row" }, label), years.map((y) => h("td.al-table__num", {}, pounds(pick(y))))) : null);
  const grants = r.grants || [];
  return h("section.al-card.viz-card.th-projection", {},
    h("header", {}, h("h2", {}, "Year by year"),
      h("p.muted.small", {}, "From the start: pay rising and shares vesting as set under Over the years, each year taxed at this tax year's rates.")),
    h("div.al-table-wrap", {}, h("table.th-table", {},
      h("caption.al-visually-hidden", {}, "Year by year"),
      h("thead", {}, head),
      h("tbody", {},
        row("Salary", (y) => y.salary),
        row("Bonus", (y) => y.bonus),
        row("Sign-on bonus", (y) => y.sign_on),
        row("Shares vesting", (y) => y.shares),
        row("Total compensation", (y) => y.total, "sub"),
        row("Benefits in kind (taxed, not paid)", (y) => y.benefits_in_kind, "aside"),
        row("Income tax", (y) => y.income_tax),
        row("National Insurance", (y) => y.ni),
        row("Student loan", (y) => y.student_loan),
        row("High Income Child Benefit Charge", (y) => y.child_benefit_charge),
        row("Your pension", (y) => y.pension),
        row("Take-home pay", (y) => y.take_home, "total"),
        row("Take-home pay, a month", (y) => y.take_home / 12, "total"),
        row("Of which from shares, after tax", (y) => y.shares_after_tax, "aside"),
        row("Employer pension contribution", (y) => y.employer_pension, "aside"),
        h("tr.al-table__row--aside", {}, h("th", { scope: "row" }, "Tax code for the year"), years.map((y) => h("td.al-table__num", { translate: "no" }, y.tax_code)))))),
    grants.length ? h("details.al-disclosure.th-workings", {}, h("summary", {}, "Each grant's vesting"),
      h("div.al-table-wrap", {}, h("table.th-table", {},
        h("thead", {}, h("tr", {}, h("th", {}, h("span.al-visually-hidden", {}, "Grant")), years.map((y) => h("th.al-table__num", { scope: "col" }, h("span", {}, "Year"), " ", String(y.year))))),
        h("tbody", {}, grants.map((g) => h("tr", {}, h("th", { scope: "row" }, g.label || h("span", {}, "A grant")),
          g.years.map((v) => h("td.al-table__num", {}, pounds(v))))))))) : null);
}

function takeHomeResults(answers, ctx) {
  const sides = takeHomeSides(answers, ctx);
  const fx = answers.paye || answers.contract;
  const taken = (side) => (side.paid ? ratePct(side.taxes / side.paid) : "—");

  // One way of being paid: its headline figures, then its breakdown.
  if (sides.length === 1) {
    const [side] = sides;
    const r = side.p;
    return [
      h("div.th-tiles", {},
        ctx.backwards
          ? thTile(neededLabel(ctx.unit, side.key === "paye"), both(fx, side.needed, side.pence),
            side.key === "paye" ? h("span", {}, h("span", {}, "a month:"), " ", both(fx, side.needed / 12)) : null)
          : null,
        thTile("Take-home, a month", both(fx, r.take_home / 12, true), h("span", {}, h("span", {}, "a year:"), " ", both(fx, r.take_home))),
        thTile("Taken in tax, NI and loans", taken(side), h("span", {}, both(fx, side.taxes), " ", h("span", {}, "a year"))),
        side.key === "paye"
          ? (ctx.backwards ? null : thTile("Of your next £100", pounds(answers.paye.next_100, true), "is yours to keep"))
          : thTile("Like a salary of", both(fx, side.salaryLike), "as an employee, for the same take-home pay"),
        side.key === "paye" && r.shares ? thTile("From shares, after tax", both(fx, answers.paye.shares_after_tax),
          h("span", {}, h("span", {}, "of"), " ", both(fx, r.shares), " ", h("span", {}, "vesting"))) : null),
      rateNote(fx),
      offerNotes(answers.paye),
      desiredDelta(sides, ctx),
      sideCard(side, ctx),
      projection(answers.paye, fx),
    ];
  }

  // All three: side by side, then each in full, folded.
  const best = sides.reduce((a, b) => (ctx.backwards ? (b.needed < a.needed ? b : a) : (b.p.take_home > a.p.take_home ? b : a)));
  const paye = sides.find((x) => x.key === "paye");
  const cell = (v, pence) => h("td.al-table__num", {}, pounds(v, pence));
  const row = (label, pick, kind, pence = false) => h("tr", { class: kind ? `al-table__row--${kind}` : "" },
    h("th", { scope: "row" }, label), sides.map((x) => cell(pick(x), pence)));
  const anyLoan = sides.some((x) => x.p.student_loan);
  return [
    h("div.th-tiles", {}, sides.map((x) => thTile(x.title,
      ctx.backwards ? both(fx, x.needed, x.pence) : both(fx, x.p.take_home / 12, true),
      ctx.backwards
        ? h("span", {}, h("span", {}, perPay(ctx.unit)), x.key === "paye" ? [" · ", h("span", {}, "a year:"), " ", both(fx, x.p.gross)] : null)
        : h("span", {}, h("span", {}, "take-home, a month")),
    ))),
    best && paye && best !== paye
      ? h("p.th-verdict", {}, ctx.backwards
        ? [h("span", {}, best.title), " ", h("span", {}, "needs the least pay for what you want")]
        : [h("span", {}, best.title), " ", h("span", {}, "leaves you"), " ", h("b", {}, both(fx, (best.p.take_home - paye.p.take_home) / 12)), " ", h("span", {}, "a month more than as an employee")])
      : null,
    rateNote(fx),
    desiredDelta(sides, ctx),
    h("section.al-card.viz-card", {}, h("header", {}, h("h2", {}, "Side by side")),
      h("div.al-table-wrap", {}, h("table.th-table.th-side-by-side", {},
        h("caption.al-visually-hidden", {}, "Side by side, a year"),
        h("thead", {}, h("tr", {}, h("th", {}, h("span.al-visually-hidden", {}, "What")), sides.map((x) => h("th.al-table__num", { scope: "col" }, x.title)))),
        h("tbody", {},
          ctx.backwards ? row(payNeeded(ctx.unit), (x) => x.needed, "sub", ctx.unit !== "year") : null,
          row("Paid before tax", (x) => x.paid, "sub"),
          row("Taken in tax, NI and loans", (x) => x.taxes),
          anyLoan ? row("Student loan", (x) => x.p.student_loan) : null,
          row("Take-home pay, a year", (x) => x.p.take_home, "total"),
          row("Take-home pay, a month", (x) => x.p.take_home / 12, "total"),
          row("Like a salary of", (x) => x.salaryLike, "aside")))),
      h("p.muted.small", {}, "Taken in tax, NI and loans: income tax, National Insurance and student loans, and, for contractors, the employer's National Insurance, Apprenticeship Levy and Corporation Tax paid out of the rate.")),
    sides.map((x) => h("details.al-disclosure.th-full", {}, h("summary", {}, h("span", {}, h("span", {}, x.title), ": ", h("span", {}, "the full breakdown"))), sideCard(x, ctx))),
    offerNotes(answers.paye),
    projection(answers.paye, fx),
  ];
}

// ---- an application's pay, taken home -------------------------------------------------

/** What's been worked out already, by what was asked: the page draws often. */
const takeHomeAsked = new Map();
function askTakeHome(path, body) {
  const key = `${path} ${JSON.stringify(body)}`;
  if (!takeHomeAsked.has(key)) takeHomeAsked.set(key, post(path, body).catch((e) => { takeHomeAsked.delete(key); throw e; }));
  return takeHomeAsked.get(key);
}

/**
 * What an application's pay would leave, a month: from its range (or its one
 * figure), in its currency, with your pension and loans as the Take-home
 * page has them. A salary's; or, for a contract (or pay by the day or hour),
 * inside and outside IR35. A line that fills in once it's worked out, and
 * goes if it can't be.
 */
function takeHomeLine(a) {
  const line = h("p.muted.small.app-take-home");
  const ends = [...new Set([a.salary_min, a.salary_max].filter((v) => v != null && v > 0))];
  if (!ends.length) return null;
  const period = a.pay_period || "year";
  const contract = a.employment === "contract" || ["day", "hour"].includes(period);
  const saved = takeHomeSaved();
  const currency = (a.currency || HOME()).toUpperCase();
  const you = { ...takeHomeYou(saved), year: undefined, currency };
  Promise.all(ends.map((v) => (contract
    ? askTakeHome("take-home/contract", { ...you, ...contractTerms(saved), rate: v, per: period })
    : askTakeHome("take-home/salary", { ...you, salary: v * employeePeriods(period, saved) }))))
    .then((rs) => {
      // A month's take-home, from the low end to the high: in your
      // currency, and the posting's beside it when that's another.
      const span = (lo, hi, currency) => (Math.round(lo) === Math.round(hi)
        ? money(lo, currency) : ltr(`${money(lo, currency)}–${money(hi, currency)}`));
      const range = (pick) => {
        const [lo, hi] = [pick(rs[0]) / 12, pick(rs[rs.length - 1]) / 12];
        const mine = h("b", {}, span(inHome(lo), inHome(hi), HOME()));
        return currency === HOME() ? mine
          : [mine, " (", span(inCurrency(rs[0], lo), inCurrency(rs[0], hi), currency), ")"];
      };
      const work = h("a", { href: `/take-home?type=${contract ? "all" : "paye"}&amount=${ends[0]}&per=${period}&currency=${currency}` }, "Work it out");
      fill(line, contract
        ? [h("span", {}, "Take-home, a month:"), " ", h("span", {}, "inside IR35"), " ", range((r) => r.inside.take_home),
          " · ", h("span", {}, "outside"), " ", range((r) => r.outside.take_home), " · ", work]
        : [h("span", {}, "Take-home, a month:"), " ", range((r) => r.take_home), " · ", work]);
    })
    .catch(() => line.remove());
  return line;
}

/**
 * An application's pay, beside its page: the figure (an offer's, or the
 * posting's), what it leaves a month where take-home pay is on, set against
 * what you want to take home (Settings), and how it's worked out.
 * `onAdd()` goes to where a salary can be added, when there's none.
 */
function payPanel(a, p, stages, onAdd) {
  const ends = [...new Set([a.salary_min, a.salary_max].filter((v) => v != null && v > 0))];
  const offer = p && stages.length && p.stage_id === stages[stages.length - 1].id;
  const badge = h("span.al-badge.al-badge--outline", {}, offer ? "Offer" : a.url ? "From the posting" : "As noted");
  const box = (...body) => h("section.al-panel.app-panel.app-pay-panel", { dataset: { section: "pay" }, "aria-labelledby": "panel-pay" },
    h("div.app-panel-head", {}, h("h2", { id: "panel-pay" }, "Pay"), h("div.app-panel-tools", {}, badge)), body);
  if (!ends.length) {
    return box(h("p.muted.small", {}, "No salary yet. Add it when they share a figure, and hunt will set it against what you want to take home."),
      h("button.al-button.al-button--sm.app-panel-add", { type: "button", onclick: onAdd }, icon("plus"), h("span", {}, "Add salary")));
  }
  const period = a.pay_period || "year";
  const home = homePay(a);
  const shown = home && (a.currency || "").toUpperCase() !== HOME()
    ? fmtMoney(home[0] == null ? null : Math.round(home[0]), home[1] == null ? null : Math.round(home[1]), HOME(), period)
    : fmtMoney(a.salary_min, a.salary_max, a.currency, period);
  const figure = h("div.pay-figure", {}, shown);
  if (!takeHomeOn()) return box(figure);
  const contract = a.employment === "contract" || ["day", "hour"].includes(period);
  if (contract) return box(figure, takeHomeLine(a));
  const month = h("div.muted.small.pay-month", {}, "Working out take-home…");
  const versus = h("div.pay-versus");
  const how = h("details.al-disclosure.pay-how", {}, h("summary", {}, "How it's worked out"), h("div.al-disclosure__body"));
  const saved = takeHomeSaved();
  const currency = (a.currency || HOME()).toUpperCase();
  const you = { ...takeHomeYou(saved), year: undefined, currency };
  Promise.all(ends.map((v) => askTakeHome("take-home/salary", { ...you, salary: v * employeePeriods(period, saved) })))
    .then((rs) => {
      const lo = rs[0], hi = rs[rs.length - 1];
      const m = (r, k) => inHome(r[k]) / 12;
      const span = (x, y) => (Math.round(x) === Math.round(y) ? money(x, HOME()) : ltr(`${money(x, HOME())}–${money(y, HOME())}`));
      fill(month, h("span", {}, "Take-home"), " ", h("b", {}, span(m(lo, "take_home"), m(hi, "take_home"))), " ", h("span", {}, "a month"));
      // Against what you want to take home, a month.
      const want = PREFS.desired_take_home;
      if (want != null) {
        const wantMonth = want * ({ week: 52, month: 12, year: 1 }[PREFS.desired_take_home_per || "month"] || 12) / 12;
        const [x, y] = [m(lo, "take_home"), m(hi, "take_home")];
        const min = Math.min(x, wantMonth) * 0.85, max = Math.max(y, wantMonth) * 1.1;
        const pos = (v) => `${((v - min) / (max - min)) * 100}%`;
        const verdict = x >= wantMonth
          ? { cls: "is-above", text: x === y ? `${money(x - wantMonth, HOME())} a month more than you want` : `More than you want across the range, by ${money(x - wantMonth, HOME())}+ a month` }
          : y < wantMonth
            ? { cls: "is-below", text: `${money(wantMonth - y, HOME())} a month short of what you want${x === y ? "" : ", even at the top"}` }
            : { cls: "", text: "What you want to take home sits inside this range" };
        fill(versus,
          h("div.pay-track", { "aria-hidden": "true" },
            h("span.pay-range", { style: `inset-inline-start: ${pos(x)}; inline-size: max(0.5rem, calc(${pos(y)} - ${pos(x)}))` }),
            h("span.pay-target", { style: `inset-inline-start: ${pos(wantMonth)}` })),
          h("span.pay-verdict", { class: verdict.cls }, verdict.text));
      } else {
        fill(versus, h("p.muted.small", {}, h("span", {}, "Say what you want to take home, to see how this compares."), " ", h("a", { href: "/settings?tab=pay" }, "Settings")));
      }
      const same = rs.length === 1;
      const row = (label, k, sign = -1, cls = "") => h("tr", { class: cls }, h("th", { scope: "row" }, label),
        rs.map((r) => h("td.al-table__num", {}, ltr(`${sign < 0 && r[k] ? "−" : ""}${money(m(r, k), HOME())}`))));
      const loans = (saved.student_loans || []).length;
      fill(how.querySelector(".al-disclosure__body"),
        h("table.al-table.pay-table", {},
          h("thead", {}, h("tr", {}, h("th", {}, "A month"), rs.map((r, i) => h("th.al-table__num", {}, same ? homeK(inHome(r.gross)) : `At ${homeK(inHome(r.gross))}`)))),
          h("tbody", {},
            row("Salary", "gross", 1), row("Pension", "pension"), row("Income tax", "income_tax"), row("National Insurance", "ni"),
            loans ? row("Student loan", "student_loan") : null,
            row("Take-home", "take_home", 1, "al-table__row--total"))),
        h("p.muted.small", {}, `Uses your settings: ${savedNumber(saved, "pension", 0)}% pension, ${loans ? `${loans} student loan${loans === 1 ? "" : "s"}` : "no student loan"}. `,
          h("a", { href: "/take-home" }, "Change in Take-home pay")));
    })
    .catch(() => { month.remove(); versus.remove(); how.remove(); });
  return box(figure, month, versus, how);
}

/**
 * The applications on the running boards with a yearly salary: what each
 * leaves a month, against what you want to take home (Settings).
 */
function applicationsAgainstWant() {
  const want = PREFS.desired_take_home;
  const wantMonth = want == null ? null : want * ({ week: 52, month: 12, year: 1 }[PREFS.desired_take_home_per || "month"] || 12) / 12;
  const body = h("tbody");
  const rest = h("p.al-hint");
  const section = h("section.th-apps", { "aria-labelledby": "th-apps" },
    h("div.th-apps-head", {}, h("h2", { id: "th-apps" }, want == null ? "Your applications" : `Your applications against ${money(want, HOME())} ${perPay(PREFS.desired_take_home_per || "month")}`),
      h("span.al-hint", {}, "Salary as posted or offered, after your settings. Bonuses are rarely posted, so they're left out.")),
    h("div.al-table-wrap", {}, h("table.al-table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Application"), h("th.al-table__num", {}, "Salary"), h("th.al-table__num", {}, "Take-home a month"), want == null ? null : h("th", {}, "Against what you want"))),
      body)),
    rest);
  get("board").then(async (b) => {
    const cards = b.stages.flatMap((st) => st.cards);
    const yearly = cards.filter((c) => (c.pay_period || "year") === "year" && c.employment !== "contract" && (c.salary_min || c.salary_max));
    const saved = takeHomeSaved();
    const rows = await Promise.all(yearly.map(async (c) => {
      const ends = [...new Set([c.salary_min, c.salary_max].filter((v) => v > 0))];
      const you = { ...takeHomeYou(saved), year: undefined, currency: (c.currency || HOME()).toUpperCase() };
      try {
        const rs = await Promise.all(ends.map((v) => askTakeHome("take-home/salary", { ...you, salary: v })));
        return { c, lo: inHome(rs[0].take_home) / 12, hi: inHome(rs[rs.length - 1].take_home) / 12 };
      } catch { return null; }
    }));
    const ok = rows.filter(Boolean).sort((a, b) => b.hi - a.hi);
    if (!ok.length) { section.remove(); return; }
    fill(body, ok.map(({ c, lo, hi }) => {
      const verdict = wantMonth == null ? null
        : lo >= wantMonth ? h("span.al-badge.al-badge--success", {}, ltr(`+${money(lo - wantMonth, HOME())}`))
          : hi < wantMonth ? h("span.al-badge.al-badge--warning", {}, ltr(`−${money(wantMonth - hi, HOME())}`))
            : h("span.al-badge.al-badge--outline", {}, "Within range");
      return h("tr", {},
        h("td", {}, h("div.th-app", {}, h("a", { href: `/applications/${c.application_id}?process=${c.id}`, translate: "no" }, c.company),
          h("span.muted.small", {}, h("span", { translate: "no" }, c.title || ""), c.title ? " · " : "", c.stage))),
        h("td.al-table__num", {}, fmtMoney(c.salary_min, c.salary_max, c.currency, c.pay_period)),
        h("td.al-table__num", {}, Math.round(lo) === Math.round(hi) ? money(lo, HOME()) : ltr(`${money(lo, HOME())}–${money(hi, HOME())}`)),
        verdict ? h("td", {}, verdict) : null);
    }));
    const left = cards.length - ok.length;
    rest.textContent = left ? `${left} more without a yearly salary yet.` : "";
  }).catch(() => section.remove());
  return section;
}
