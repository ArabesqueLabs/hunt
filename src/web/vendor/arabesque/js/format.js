// Numbers, money and percentages in the page's language, with the digits
// people chose. Arabic can be written with Western digits (123, the
// default, as on most Arabic sites and in finance) or Arabic-Indic (١٢٣);
// it's a preference, kept with the person's other settings, never inferred.
//
//   formatNumber(108000, { lang: "ar", numerals: "arab" })  → "١٠٨٬٠٠٠"
//   formatMoney(6010, "GBP", { lang: "ar" })                → "£6,010"
//   formatMoney(6010, "GBP", { lang: "ar", numerals: "arab" }) → "£٦٬٠١٠"
//
// Put the result in <bdi> (or .al-ltr) inside running text, so it stays
// whole in right-to-left; where it goes into a string (an aria-label, a
// tooltip), wrap it in U+2066 … U+2069. With Arabic-Indic digits this
// matters more: they don't carry "£" with them as Western digits do.

/** The Intl locale for a language ("en", "ar", "ar-SA"…) and a numeral system ("latn" | "arab"). */
export function numberLocale(lang = globalThis.document?.documentElement.lang || "en", numerals = "latn") {
  const primary = String(lang).toLowerCase().split("-")[0];
  // English is British unless a region is given; other languages keep theirs.
  const base = primary === "en" && !lang.includes("-") ? "en-GB" : lang;
  return `${base}-u-nu-${numerals === "arab" ? "arab" : "latn"}`;
}

export function formatNumber(value, { lang, numerals, ...options } = {}) {
  return new Intl.NumberFormat(numberLocale(lang, numerals), options).format(value);
}

const symbols = new Map();
/** The short symbol for a currency: £, $, €; or its code where there's none. */
export function currencySymbol(currency) {
  if (!symbols.has(currency)) {
    symbols.set(currency, new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: "narrowSymbol" })
      .formatToParts(0).find((p) => p.type === "currency").value);
  }
  return symbols.get(currency);
}

// Arabic locales spell some symbols out ("UK£") and move them after the
// number; the system writes the short symbol first in both languages, so
// money reads the same and stays one isolated run. A code with no symbol
// ("SAR") is followed by a space. Amounts with fractions show all their
// digits (£12.50). signDisplay works as in Intl ("auto", "always",
// "exceptZero", "never"); other options pass through to the number.
export function formatMoney(value, currency = "GBP", { lang, numerals, maximumFractionDigits = 0, minimumFractionDigits = maximumFractionDigits, signDisplay = "auto", ...options } = {}) {
  const amount = formatNumber(Math.abs(value), { ...options, lang, numerals, maximumFractionDigits, minimumFractionDigits: Math.min(minimumFractionDigits, maximumFractionDigits) });
  // What's shown, rounded: −£0 is just £0.
  const shown = Number(Math.abs(value).toFixed(maximumFractionDigits));
  const sign = value < 0 && shown !== 0
    ? (signDisplay === "never" ? "" : "−")
    : (signDisplay === "always" || (signDisplay === "exceptZero" && shown !== 0)) ? "+" : "";
  const symbol = currencySymbol(currency);
  return `${sign}${symbol}${/^\p{L}+$/u.test(symbol) ? " " : ""}${amount}`;
}

export function formatPercent(fraction, { lang, numerals, ...options } = {}) {
  return formatNumber(fraction, { lang, numerals, style: "percent", maximumFractionDigits: 0, ...options });
}

/** Read typed numbers in either digit set, and this module's own output:
 *  "١٠٨٬٠٠٠", "108,000", "108k", "−£6,010", "SAR 100", "‎-5". */
export function parseNumber(text) {
  const western = String(text)
    .replace(/[\u200e\u200f\u061c\u2066-\u2069]/g, "") // bidi marks and isolates
    .replace(/[\u2212\u2013]/g, "-") // the minus sign, and an en dash used as one
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\p{Sc}|^[+-]?[A-Z]{3}(?=[\s\d])/gu, (m) => m.replace(/[A-Z]{3}|\p{Sc}/u, "")) // £, $, "SAR"
    .replace(/[٬,\s]/g, "")
    .replace(/٫/g, ".")
    .replace(/^\+/, "");
  const m = western.match(/^(-?\d*\.?\d+)([km])?$/i);
  if (!m) return NaN;
  return Number(m[1]) * ({ k: 1e3, m: 1e6 }[m[2]?.toLowerCase()] ?? 1);
}
