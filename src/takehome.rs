//! Take-home pay in the UK: what's left of a salary, or of a contractor's
//! day rate inside and outside IR35, after income tax, National Insurance,
//! student loans and pension; shares and benefits in kind (see
//! [`crate::equity`]), and an offer year by year. For UK residents.
//!
//! Figures are for a whole tax year, as if earned evenly through it: PAYE
//! spreads tax over the year, so the year's total is what it comes to.
//! Wales and Northern Ireland pay England's income tax; Scotland has its
//! own bands for pay, but not for dividends, which are taxed the UK's way
//! everywhere.
//!
//! - **A salary**: income tax, NI and student loans, with a pension paid by
//!   salary sacrifice, from pay before tax (net pay), or with relief at
//!   source (basic-rate relief added to the pension, the rest claimed back
//!   by moving the bands up).
//! - **Inside IR35**, through an umbrella company: the day rate pays the
//!   umbrella's margin, its employer's NI and apprenticeship levy, and any
//!   pension it pays in; what's left is your gross pay, taxed as a salary.
//! - **Outside IR35**, through your own limited company: a director's
//!   salary, corporation tax on the profit, and what's left of it taken as
//!   dividends. One director, so no Employment Allowance.
//!
//! A contract's rate is by the hour, day, week, month or year. Either way
//! round: from what you're paid to what you take home, or from the
//! take-home pay you want to the salary, or the rate (inside and outside
//! IR35), that leaves it.
//!
//! Not covered: tax codes other than the usual, benefits in kind, the
//! married couple's and blind person's allowances, VAT, and being paid
//! inside IR35 through your own company.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::error::{Result, invalid};

/// A band of income tax, on taxable income (what's above the personal
/// allowance).
#[derive(Debug, Serialize)]
pub struct Band {
    pub name: &'static str,
    /// Its top, in taxable income; none for the last.
    pub upto: Option<f64>,
    pub rate: f64,
    /// Whether its top moves up with pension paid with relief at source
    /// (Scotland's starter band doesn't).
    #[serde(skip)]
    pub extends: bool,
}

/// A student loan plan: repaid at `rate` of income over `threshold`.
#[derive(Debug, Serialize)]
pub struct Loan {
    pub plan: &'static str,
    pub label: &'static str,
    pub threshold: f64,
    pub rate: f64,
}

/// A tax year's rates and thresholds.
#[derive(Debug, Serialize)]
pub struct TaxYear {
    /// "2026-27".
    pub id: &'static str,
    /// "2026/27".
    pub label: &'static str,
    /// The year it starts in, on 6 April.
    pub starts: i16,
    pub personal_allowance: f64,
    /// The personal allowance goes down £1 for every £2 of income over this.
    pub taper_from: f64,
    /// England, Wales and Northern Ireland; the UK's, for dividends.
    pub bands: &'static [Band],
    pub scottish_bands: &'static [Band],
    pub dividend_allowance: f64,
    /// Dividends' rates in the basic, higher and additional rate bands.
    pub dividend_rates: [f64; 3],
    /// Employee's NI: `ni_rate` from the threshold to the upper limit,
    /// `ni_upper_rate` above it.
    pub ni_threshold: f64,
    pub ni_upper: f64,
    pub ni_rate: f64,
    pub ni_upper_rate: f64,
    /// Employer's NI, above its own threshold.
    pub employer_threshold: f64,
    pub employer_rate: f64,
    /// The apprenticeship levy, which umbrella companies pay (their pay
    /// bills are well over £3m).
    pub levy_rate: f64,
    pub loans: &'static [Loan],
    /// Auto-enrolment's qualifying earnings: from, to.
    pub qualifying: [f64; 2],
    /// Corporation tax: the small profits rate up to `ct_lower`, the main
    /// rate from `ct_upper`, and marginal relief (`ct_fraction`) between.
    pub ct_small: f64,
    pub ct_main: f64,
    pub ct_lower: f64,
    pub ct_upper: f64,
    pub ct_fraction: f64,
    /// The Personal Allowance a spouse or civil partner can pass on.
    pub marriage_allowance: f64,
    /// Child Benefit a week: the eldest child, and each other child.
    pub child_benefit: [f64; 2],
    /// The High Income Child Benefit Charge: none to `hicbc_from` of
    /// adjusted net income, all of it from `hicbc_to`, in 1% steps between.
    pub hicbc_from: f64,
    pub hicbc_to: f64,
    /// Benefits in kind: a point more on cars under 75g/km (2026 to 2027);
    /// the car fuel multiplier; a van, and its fuel; HMRC's official rate
    /// of interest, for loans.
    pub car_low_extra: f64,
    pub fuel_multiplier: f64,
    pub van_benefit: f64,
    pub van_fuel: f64,
    pub official_rate: f64,
}

/// Basic-rate relief, added to pension paid with relief at source.
const BASIC_RELIEF: f64 = 0.2;

/// Below this, dividends needn't go on a tax return, so student loans are
/// repaid on pay alone.
const UNEARNED_FOR_LOANS: f64 = 2000.0;

const UK_BANDS: &[Band] = &[
    Band {
        name: "Basic rate",
        upto: Some(37_700.0),
        rate: 0.20,
        extends: true,
    },
    Band {
        name: "Higher rate",
        upto: Some(125_140.0),
        rate: 0.40,
        extends: true,
    },
    Band {
        name: "Additional rate",
        upto: None,
        rate: 0.45,
        extends: false,
    },
];

const UNDERGRADUATE: f64 = 0.09;
const POSTGRADUATE: f64 = 0.06;

/// The years hunt knows, oldest first.
pub const YEARS: &[TaxYear] = &[
    TaxYear {
        id: "2025-26",
        label: "2025/26",
        starts: 2025,
        personal_allowance: 12_570.0,
        taper_from: 100_000.0,
        bands: UK_BANDS,
        scottish_bands: &[
            Band {
                name: "Starter rate",
                upto: Some(2_827.0),
                rate: 0.19,
                extends: false,
            },
            Band {
                name: "Basic rate",
                upto: Some(14_921.0),
                rate: 0.20,
                extends: true,
            },
            Band {
                name: "Intermediate rate",
                upto: Some(31_092.0),
                rate: 0.21,
                extends: true,
            },
            Band {
                name: "Higher rate",
                upto: Some(62_430.0),
                rate: 0.42,
                extends: true,
            },
            Band {
                name: "Advanced rate",
                upto: Some(125_140.0),
                rate: 0.45,
                extends: true,
            },
            Band {
                name: "Top rate",
                upto: None,
                rate: 0.48,
                extends: false,
            },
        ],
        dividend_allowance: 500.0,
        dividend_rates: [0.0875, 0.3375, 0.3935],
        ni_threshold: 12_570.0,
        ni_upper: 50_270.0,
        ni_rate: 0.08,
        ni_upper_rate: 0.02,
        employer_threshold: 5_000.0,
        employer_rate: 0.15,
        levy_rate: 0.005,
        // Plan 5's repayments start in April 2026.
        loans: &[
            Loan {
                plan: "plan1",
                label: "Plan 1",
                threshold: 26_065.0,
                rate: UNDERGRADUATE,
            },
            Loan {
                plan: "plan2",
                label: "Plan 2",
                threshold: 28_470.0,
                rate: UNDERGRADUATE,
            },
            Loan {
                plan: "plan4",
                label: "Plan 4",
                threshold: 32_745.0,
                rate: UNDERGRADUATE,
            },
            Loan {
                plan: "postgrad",
                label: "Postgraduate loan",
                threshold: 21_000.0,
                rate: POSTGRADUATE,
            },
        ],
        qualifying: [6_240.0, 50_270.0],
        ct_small: 0.19,
        ct_main: 0.25,
        ct_lower: 50_000.0,
        ct_upper: 250_000.0,
        ct_fraction: 3.0 / 200.0,
        marriage_allowance: 1_260.0,
        child_benefit: [26.05, 17.25],
        hicbc_from: 60_000.0,
        hicbc_to: 80_000.0,
        car_low_extra: 0.0,
        fuel_multiplier: 28_200.0,
        van_benefit: 4_020.0,
        van_fuel: 769.0,
        official_rate: 0.0375,
    },
    TaxYear {
        id: "2026-27",
        label: "2026/27",
        starts: 2026,
        personal_allowance: 12_570.0,
        taper_from: 100_000.0,
        bands: UK_BANDS,
        scottish_bands: &[
            Band {
                name: "Starter rate",
                upto: Some(3_967.0),
                rate: 0.19,
                extends: false,
            },
            Band {
                name: "Basic rate",
                upto: Some(16_956.0),
                rate: 0.20,
                extends: true,
            },
            Band {
                name: "Intermediate rate",
                upto: Some(31_092.0),
                rate: 0.21,
                extends: true,
            },
            Band {
                name: "Higher rate",
                upto: Some(62_430.0),
                rate: 0.42,
                extends: true,
            },
            Band {
                name: "Advanced rate",
                upto: Some(125_140.0),
                rate: 0.45,
                extends: true,
            },
            Band {
                name: "Top rate",
                upto: None,
                rate: 0.48,
                extends: false,
            },
        ],
        dividend_allowance: 500.0,
        // Two points up on the basic and higher rates, from April 2026.
        dividend_rates: [0.1075, 0.3575, 0.3935],
        ni_threshold: 12_570.0,
        ni_upper: 50_270.0,
        ni_rate: 0.08,
        ni_upper_rate: 0.02,
        employer_threshold: 5_000.0,
        employer_rate: 0.15,
        levy_rate: 0.005,
        loans: &[
            Loan {
                plan: "plan1",
                label: "Plan 1",
                threshold: 26_900.0,
                rate: UNDERGRADUATE,
            },
            Loan {
                plan: "plan2",
                label: "Plan 2",
                threshold: 29_385.0,
                rate: UNDERGRADUATE,
            },
            Loan {
                plan: "plan4",
                label: "Plan 4",
                threshold: 33_795.0,
                rate: UNDERGRADUATE,
            },
            Loan {
                plan: "plan5",
                label: "Plan 5",
                threshold: 25_000.0,
                rate: UNDERGRADUATE,
            },
            Loan {
                plan: "postgrad",
                label: "Postgraduate loan",
                threshold: 21_000.0,
                rate: POSTGRADUATE,
            },
        ],
        qualifying: [6_240.0, 50_270.0],
        ct_small: 0.19,
        ct_main: 0.25,
        ct_lower: 50_000.0,
        ct_upper: 250_000.0,
        ct_fraction: 3.0 / 200.0,
        marriage_allowance: 1_260.0,
        child_benefit: [27.05, 17.90],
        hicbc_from: 60_000.0,
        hicbc_to: 80_000.0,
        car_low_extra: 1.0,
        fuel_multiplier: 29_200.0,
        van_benefit: 4_170.0,
        van_fuel: 798.0,
        official_rate: 0.0375,
    },
];

/// Every student loan plan, by any year: (value, label).
pub const PLANS: &[(&str, &str)] = &[
    ("plan1", "Plan 1"),
    ("plan2", "Plan 2"),
    ("plan4", "Plan 4 (Scotland)"),
    ("plan5", "Plan 5"),
    ("postgrad", "Postgraduate loan"),
];

/// What a contract's rate is per: (value, label).
pub const RATE_PERS: &[(&str, &str)] = &[
    ("hour", "an hour"),
    ("day", "a day"),
    ("week", "a week"),
    ("month", "a month"),
    ("year", "a year"),
];

/// How a pension is paid in: (value, label).
pub const PENSION_KINDS: &[(&str, &str)] = &[
    ("net_pay", "Before tax (net pay)"),
    ("sacrifice", "Salary sacrifice"),
    ("relief_at_source", "Relief at source"),
];

/// The tax year a day is in (they start on 6 April), or the nearest one
/// hunt knows.
pub fn year_for(day: jiff::civil::Date) -> &'static TaxYear {
    let starts = if (day.month(), day.day()) >= (4, 6) {
        day.year()
    } else {
        day.year() - 1
    };
    YEARS
        .iter()
        .find(|y| y.starts == starts)
        .unwrap_or(if starts < YEARS[0].starts {
            &YEARS[0]
        } else {
            &YEARS[YEARS.len() - 1]
        })
}

/// This tax year, in the UK.
pub fn this_year() -> &'static TaxYear {
    let today = jiff::Zoned::now()
        .in_tz("Europe/London")
        .map(|z| z.date())
        .unwrap_or_else(|_| jiff::Zoned::now().date());
    year_for(today)
}

fn year(id: Option<&str>) -> Result<&'static TaxYear> {
    match id {
        None | Some("") => Ok(this_year()),
        Some(id) => YEARS
            .iter()
            .find(|y| y.id == id || y.label == id)
            .ok_or_else(|| {
                let known: Vec<_> = YEARS.iter().map(|y| y.id).collect();
                invalid(format!("no tax year {id:?}: there's {}", known.join(", ")))
            }),
    }
}

/// What the calculator offers: the years (with their rates), this one,
/// student loan plans, pension kinds, and the contract's defaults.
pub fn options() -> Value {
    let pairs = |list: &[(&str, &str)]| -> Vec<Value> {
        list.iter()
            .map(|(v, l)| json!({"value": v, "label": l}))
            .collect()
    };
    let d = ContractInput::default();
    json!({
        "year": this_year().id,
        "years": YEARS,
        "student_loans": pairs(PLANS),
        "pension_kinds": pairs(PENSION_KINDS),
        "rate_pers": pairs(RATE_PERS),
        "grant_kinds": pairs(crate::equity::KINDS),
        "contract": {
            "per": d.per,
            "hours_per_day": d.hours_per_day,
            "days_per_week": d.days_per_week,
            "weeks": d.weeks,
            "umbrella_margin": d.umbrella_margin,
            "umbrella_pension": d.umbrella_pension,
            "director_salary": this_year().personal_allowance,
            "expenses": d.expenses,
            "company_pension": d.company_pension,
            "dividends": d.dividends,
        },
    })
}

// ---- what's asked ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PensionKind {
    #[default]
    NetPay,
    Sacrifice,
    ReliefAtSource,
}

/// Who's paid: the same wherever the money comes from.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct You {
    /// The tax year ("2026-27"): this one, unless said.
    pub year: Option<String>,
    pub scotland: bool,
    /// Plans, by value (see [`PLANS`]).
    pub student_loans: Vec<String>,
    /// Your pension contribution, a % of salary.
    pub pension: f64,
    pub pension_kind: PensionKind,
    /// Over the State Pension age: no employee's NI.
    pub no_ni: bool,
    /// A tax code, as on a payslip ("1257L", "K475", "BR"): the usual
    /// Personal Allowance, tapered, unless said.
    pub tax_code: Option<String>,
    /// Passing 10% of the Personal Allowance to a spouse or civil partner,
    /// or having theirs (with the usual code only).
    pub marriage: Marriage,
    /// Children Child Benefit is claimed for.
    pub children: u32,
    /// Whether a partner's adjusted net income is higher: then they pay
    /// the Child Benefit charge, not you.
    pub partner_higher: bool,
    /// Salary sacrifice besides pension (Cycle to Work, an electric car),
    /// a year: off pay before tax and NI.
    pub sacrifice: f64,
    /// Payroll giving, a year: off pay before tax.
    pub payroll_giving: f64,
    /// Gift Aid donations, a year, as given: the charity claims basic-rate
    /// relief, and the bands move up by what it comes to.
    pub gift_aid: f64,
}

/// The Marriage Allowance: none, yours given to a partner, or theirs had.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Marriage {
    #[default]
    None,
    Give,
    Receive,
}

/// A tax code, read.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Code {
    /// A tax-free allowance (1257L: £12,570); with K, an amount added to
    /// taxable pay instead (K475: -£4,750).
    Allowance(f64),
    /// All pay at one rate: BR the basic rate, D0, D1… the rates above it.
    Flat(usize),
    /// No tax.
    NoTax,
}

/// Reads a tax code ("1257L", "S1257L", "K475", "BR", "D0", "0T", "NT", and
/// emergency ones, "1257L W1"): the code, and whether it's Scottish (S).
/// None when there's none.
pub fn tax_code(given: &str) -> Result<Option<(Code, bool)>> {
    let mut t: String = given
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_uppercase();
    if t.is_empty() {
        return Ok(None);
    }
    for emergency in ["W1", "M1", "X"] {
        if t.len() > emergency.len() + 1 && t.ends_with(emergency) {
            t.truncate(t.len() - emergency.len());
        }
    }
    let scottish = t.len() > 2 && t.starts_with('S');
    // C: Wales, taxed as England.
    if t.len() > 2 && (t.starts_with('S') || t.starts_with('C')) {
        t.remove(0);
    }
    let digits = |d: &str| -> Option<f64> {
        (!d.is_empty() && d.len() <= 5 && d.bytes().all(|b| b.is_ascii_digit()))
            .then(|| d.parse::<f64>().ok())
            .flatten()
    };
    let code = match t.as_str() {
        "NT" => Some(Code::NoTax),
        "BR" => Some(Code::Flat(0)),
        "D0" | "D1" | "D2" | "D3" => Some(Code::Flat(1 + (t.as_bytes()[1] - b'0') as usize)),
        k if k.starts_with('K') => digits(&k[1..]).map(|n| Code::Allowance(-n * 10.0)),
        n => {
            let (num, letter) = n.split_at(n.len().saturating_sub(1));
            if matches!(letter, "L" | "M" | "N" | "T") {
                digits(num).map(|n| Code::Allowance(n * 10.0))
            } else {
                None
            }
        }
    };
    code.map(|c| Some((c, scottish))).ok_or_else(|| {
        invalid(format!(
            "a tax code is like 1257L, K475, BR, D0 or NT, not {given:?}"
        ))
    })
}

/// The tax code these figures would give, as HMRC works one out (gov.uk,
/// "Tax codes", and the PAYE Manual, PAYE11045 and PAYE11015): the
/// allowance with its last digit dropped, and a letter for how it was
/// reached. With no other income, benefits or deductions, which HMRC
/// would code too.
#[derive(Debug, Clone, Serialize)]
pub struct CodeAdvice {
    pub code: String,
    /// The tax-free pay it gives.
    pub allowance: f64,
    /// Why, in order.
    pub reasons: Vec<&'static str>,
}

/// The code for a year's adjusted net income, with the Marriage Allowance
/// where it can be had.
fn advise(y: &TaxYear, you: &You, adjusted: f64, benefits: f64) -> CodeAdvice {
    let mut reasons = Vec::new();
    let allowance = personal_allowance(y, adjusted);
    let tapered = allowance < y.personal_allowance;
    if allowance <= 0.0 {
        reasons
            .push("Your Personal Allowance is used up: adjusted net income of £125,140 or more.");
    } else if tapered {
        reasons.push("Your Personal Allowance goes down by £1 for every £2 of adjusted net income over £100,000 (T).");
    } else {
        reasons.push("The standard Personal Allowance (L).");
    }
    // Basic rate (Scotland: up to the intermediate rate) ends here.
    let bands = if you.scotland {
        y.scottish_bands
    } else {
        y.bands
    };
    let basic_top = y.personal_allowance
        + bands
            .iter()
            .filter(|b| b.rate <= 0.21)
            .filter_map(|b| b.upto)
            .fold(0.0, f64::max);
    let mut total = allowance;
    let mut letter = if tapered { "T" } else { "L" };
    match you.marriage {
        Marriage::None => {}
        Marriage::Give if adjusted <= y.personal_allowance => {
            total -= y.marriage_allowance;
            letter = "N";
            reasons.push("Marriage Allowance: £1,260 of your Personal Allowance given to your partner (N).");
        }
        Marriage::Give => reasons.push(
            "Marriage Allowance is left out: it's given by someone whose income is below the Personal Allowance.",
        ),
        Marriage::Receive if !tapered && adjusted <= basic_top => {
            total += y.marriage_allowance;
            letter = "M";
            reasons.push("Marriage Allowance: £1,260 of your partner's Personal Allowance added to yours (M).");
        }
        Marriage::Receive => reasons.push(
            "Marriage Allowance is left out: it's for those who pay no more than the basic rate (in Scotland, the intermediate rate).",
        ),
    }
    // Benefits in kind come off the allowance, so tax on them is taken
    // from pay; more than the allowance, and the code is a K code
    // (PAYE11095: -£1,550 is K154).
    if benefits > 0.0 {
        total -= benefits;
        reasons.push(
            "Benefits in kind taken off your allowance, so the tax on them comes out of your pay.",
        );
    }
    let prefix = if you.scotland { "S" } else { "" };
    if you.scotland {
        reasons.push("Scottish income tax (S).");
    }
    let tens = (total.abs() / 10.0).floor();
    let code = if total < 0.0 && tens >= 1.0 {
        reasons.push("Your benefits are more than your allowance: a K code adds the difference to your taxable pay (K).");
        format!("{prefix}K{}", (tens - 1.0).max(0.0))
    } else if tens < 1.0 {
        format!("{prefix}0T")
    } else {
        format!("{prefix}{tens}{letter}")
    };
    CodeAdvice {
        code,
        allowance: total.max(0.0),
        reasons,
    }
}

impl You {
    /// The tax code, read (checked already).
    fn code(&self) -> Option<(Code, bool)> {
        self.tax_code
            .as_deref()
            .and_then(|c| tax_code(c).ok().flatten())
    }
}

/// A salary, a year; or the take-home pay wanted, to find the salary
/// that leaves it.
#[derive(Debug, Default, Deserialize)]
pub struct SalaryInput {
    #[serde(default)]
    pub salary: Option<f64>,
    /// Instead of a salary: the take-home pay wanted, a year.
    #[serde(default)]
    pub take_home: Option<f64>,
    /// On top of the salary, either way.
    #[serde(default)]
    pub bonus: f64,
    /// A bonus as a % of salary (a target bonus), besides `bonus`.
    #[serde(default)]
    pub bonus_percent: f64,
    /// What the employer pays into your pension, a % of salary.
    #[serde(default)]
    pub employer_pension: f64,
    /// A sign-on bonus, paid in the first year.
    #[serde(default)]
    pub sign_on: f64,
    /// Share grants, vesting from the start.
    #[serde(default)]
    pub grants: Vec<crate::equity::Grant>,
    /// Benefits in kind.
    #[serde(default)]
    pub benefits: crate::equity::Benefits,
    /// Over the years: a pay rise a year, and the share price's growth a
    /// year (both %); an RSU refresher granted each year from the second,
    /// vesting as the first RSU grant does; and how many years (as long as
    /// the longest grant, at least 4, unless said).
    #[serde(default)]
    pub raise: f64,
    #[serde(default)]
    pub share_growth: f64,
    #[serde(default)]
    pub refresher: f64,
    #[serde(default)]
    pub years: Option<u32>,
    #[serde(flatten)]
    pub you: You,
}

/// What a contract's rate is per.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RatePer {
    Hour,
    #[default]
    Day,
    Week,
    Month,
    Year,
}

/// A contract: its rate (or the take-home pay wanted, to find the rate),
/// how much of the year it's worked, and how it's paid inside and
/// outside IR35.
#[derive(Debug, Deserialize)]
#[serde(default)]
pub struct ContractInput {
    /// What the client pays, by `per` (`day_rate`, as it was first called).
    #[serde(alias = "day_rate")]
    pub rate: Option<f64>,
    pub per: RatePer,
    /// Instead of a rate: the take-home pay wanted, a year.
    pub take_home: Option<f64>,
    /// For a rate by the hour.
    pub hours_per_day: f64,
    pub days_per_week: f64,
    /// Weeks worked in the year (holidays and time between contracts
    /// aren't paid).
    pub weeks: f64,
    /// Inside: the umbrella company's fee, per week worked.
    pub umbrella_margin: f64,
    /// Inside: what the umbrella pays into your pension, a % of qualifying
    /// earnings (3% is auto-enrolment's least), out of the day rate.
    pub umbrella_pension: f64,
    /// Outside: your salary from your company, a year (the personal
    /// allowance, unless said).
    pub director_salary: Option<f64>,
    /// Outside: what the company spends, a year (accountant, insurance,
    /// equipment).
    pub expenses: f64,
    /// Outside: what the company pays into your pension, a year.
    pub company_pension: f64,
    /// Outside: how much of the profit after tax you take as dividends, a %.
    pub dividends: f64,
    #[serde(flatten)]
    pub you: You,
}

impl Default for ContractInput {
    fn default() -> Self {
        ContractInput {
            rate: None,
            per: RatePer::Day,
            take_home: None,
            hours_per_day: 7.5,
            days_per_week: 5.0,
            weeks: 46.0,
            umbrella_margin: 20.0,
            umbrella_pension: 0.0,
            director_salary: None,
            expenses: 0.0,
            company_pension: 0.0,
            dividends: 100.0,
            you: You::default(),
        }
    }
}

/// Money: a number, not below nothing, and not absurd.
fn amount(what: &str, v: f64) -> Result<f64> {
    if !v.is_finite() || !(0.0..=100_000_000.0).contains(&v) {
        return Err(invalid(format!(
            "{what} should be an amount from 0, not {v}"
        )));
    }
    Ok(v)
}

fn percent(what: &str, v: f64) -> Result<f64> {
    if !v.is_finite() || !(0.0..=100.0).contains(&v) {
        return Err(invalid(format!(
            "{what} should be a % from 0 to 100, not {v}"
        )));
    }
    Ok(v / 100.0)
}

fn check(you: &You) -> Result<&'static TaxYear> {
    percent("pension", you.pension)?;
    amount("salary sacrifice", you.sacrifice)?;
    amount("payroll giving", you.payroll_giving)?;
    amount("Gift Aid donations", you.gift_aid)?;
    if you.children > 20 {
        return Err(invalid("children should be from 0 to 20"));
    }
    if let Some((Code::Flat(k), scottish)) = tax_code(you.tax_code.as_deref().unwrap_or(""))? {
        // Above the basic rate, there are as many D codes as bands.
        let above = if you.scotland || scottish { 3 } else { 1 };
        if k > above + 1 {
            return Err(invalid(format!("D{} is beyond the top rate, here", k - 1)));
        }
    }
    for plan in &you.student_loans {
        if !PLANS.iter().any(|(p, _)| p == plan) {
            let known: Vec<_> = PLANS.iter().map(|(p, _)| *p).collect();
            return Err(invalid(format!(
                "no student loan plan {plan:?}: there's {}",
                known.join(", ")
            )));
        }
    }
    year(you.year.as_deref())
}

// ---- what comes of it -----------------------------------------------------------------------

/// Part of an income, taxed at one rate.
#[derive(Debug, Clone, Serialize)]
pub struct Slice {
    pub name: String,
    pub rate: f64,
    /// How much of the income is in it.
    pub on: f64,
    pub tax: f64,
}

/// A person's year: pay and dividends in, what's taken, what's left.
#[derive(Debug, Clone, Serialize)]
pub struct Payslip {
    /// Pay before anything comes off (salary and bonus).
    pub gross: f64,
    pub dividends: f64,
    /// What your pension costs you, from your pay.
    pub pension: f64,
    /// What goes into your pension (with relief at source, basic-rate
    /// relief included).
    pub pension_in: f64,
    pub personal_allowance: f64,
    /// Income taxed, after the personal allowance: pay and dividends.
    pub taxable: f64,
    pub income_tax: f64,
    pub dividend_tax: f64,
    pub ni: f64,
    pub student_loan: f64,
    /// Salary sacrifice besides pension, payroll giving, and Gift Aid
    /// donations: out of your pay.
    pub sacrifice: f64,
    pub payroll_giving: f64,
    pub gift_aid: f64,
    /// Income for the allowance's taper and the Child Benefit charge.
    pub adjusted_income: f64,
    /// Child Benefit, a year, and the High Income Child Benefit Charge on it.
    pub child_benefit: f64,
    pub child_benefit_charge: f64,
    /// The tax code these figures would give.
    pub tax_code_advice: CodeAdvice,
    /// Shares vesting: what they'd sell for, and how much of it is taxed.
    pub shares: f64,
    pub shares_taxed: f64,
    /// Benefits in kind, and the employer's Class 1A NI on them.
    pub benefits_in_kind: f64,
    pub class_1a: f64,
    /// Cash and shares, after everything.
    pub take_home: f64,
    /// What the employer pays on top: their NI.
    pub employer_ni: f64,
    /// Pay that NI is on (after salary sacrifice).
    #[serde(skip)]
    pub ni_pay: f64,
    pub tax_bands: Vec<Slice>,
    pub dividend_bands: Vec<Slice>,
    pub ni_bands: Vec<Slice>,
    pub loans: Vec<Slice>,
}

/// A salary's year, with what it costs the employer and what the next
/// £100 of it would leave.
#[derive(Debug, Serialize)]
pub struct SalaryResult {
    pub year: &'static str,
    /// The salary, without the bonus: as asked, or as worked out.
    pub salary: f64,
    #[serde(flatten)]
    pub pay: Payslip,
    /// What the employer pays into your pension, a year.
    pub employer_pension: f64,
    pub sign_on: f64,
    /// The bonus, a year (a % of salary worked out).
    pub bonus: f64,
    /// Of the take-home pay, what's from shares (after the tax on them).
    pub shares_after_tax: f64,
    /// Benefits in kind, one by one.
    pub benefits: crate::equity::BenefitValues,
    /// Year by year, from the start.
    pub projection: Vec<YearRow>,
    /// What vests of each grant, year by year (refreshers included).
    pub grants: Vec<GrantYears>,
    /// Things to know: limits a grant is over, say.
    pub notes: Vec<String>,
    pub employer_cost: f64,
    /// Of another £100 of pay, what you'd keep.
    pub next_100: f64,
}

/// A year of an offer: what's paid, what's taken, what's left.
#[derive(Debug, Serialize)]
pub struct YearRow {
    pub year: u32,
    pub salary: f64,
    pub bonus: f64,
    pub sign_on: f64,
    pub shares: f64,
    pub benefits_in_kind: f64,
    /// Salary, bonus, sign-on and shares.
    pub total: f64,
    pub income_tax: f64,
    pub ni: f64,
    pub student_loan: f64,
    pub child_benefit_charge: f64,
    pub pension: f64,
    pub employer_pension: f64,
    pub take_home: f64,
    pub shares_after_tax: f64,
    pub tax_code: String,
}

/// A grant, and what vests of it each year.
#[derive(Debug, Serialize)]
pub struct GrantYears {
    pub label: String,
    pub kind: crate::equity::Kind,
    pub years: Vec<f64>,
}

#[derive(Debug, Serialize)]
pub struct Inside {
    /// The rate, by the contract's `per`, and what the client pays at it
    /// in a year: the same both sides, unless worked out from take-home pay.
    pub rate: f64,
    pub income: f64,
    /// What the umbrella takes before paying you.
    pub margin: f64,
    pub employer_ni: f64,
    pub levy: f64,
    pub employer_pension: f64,
    #[serde(flatten)]
    pub pay: Payslip,
    /// The salary that would leave the same take-home pay.
    pub salary_like: f64,
}

#[derive(Debug, Serialize)]
pub struct Outside {
    pub rate: f64,
    pub income: f64,
    pub expenses: f64,
    pub salary: f64,
    pub employer_ni: f64,
    pub company_pension: f64,
    pub profit: f64,
    pub corporation_tax: f64,
    /// Profit after tax left in the company.
    pub retained: f64,
    #[serde(flatten)]
    pub pay: Payslip,
    pub salary_like: f64,
}

#[derive(Debug, Serialize)]
pub struct ContractResult {
    pub year: &'static str,
    pub per: RatePer,
    /// Days worked in the year.
    pub days: f64,
    /// The rate asked about, and what the client pays at it for the year;
    /// none when worked out from take-home pay (each side has its own).
    pub rate: Option<f64>,
    pub income: Option<f64>,
    /// The take-home pay wanted, a year, when that's what was asked.
    pub take_home: Option<f64>,
    pub inside: Inside,
    pub outside: Outside,
}

fn pennies(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

/// The most hunt takes as an amount.
const MOST: f64 = 100_000_000.0;

/// The least amount, to the penny, for which `f` comes to `want`, with
/// `f` rising as the amount does: none if no amount hunt takes reaches it.
fn least(want: f64, f: impl Fn(f64) -> f64) -> Option<f64> {
    if f(0.0) >= want {
        return Some(0.0);
    }
    let mut hi = want.max(1.0);
    while f(hi) < want {
        if hi >= MOST {
            return None;
        }
        hi = (hi * 2.0).min(MOST);
    }
    // Halve the gap until it's found.
    let mut lo = 0.0;
    for _ in 0..80 {
        let mid = (lo + hi) / 2.0;
        if f(mid) < want {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    Some((hi * 100.0 - 1e-6).ceil() / 100.0)
}

impl Slice {
    fn rounded(mut self) -> Slice {
        self.on = pennies(self.on);
        self.tax = pennies(self.tax);
        self
    }
}

impl Payslip {
    fn rounded(mut self) -> Payslip {
        for v in [
            &mut self.gross,
            &mut self.dividends,
            &mut self.pension,
            &mut self.pension_in,
            &mut self.personal_allowance,
            &mut self.taxable,
            &mut self.income_tax,
            &mut self.dividend_tax,
            &mut self.ni,
            &mut self.student_loan,
            &mut self.sacrifice,
            &mut self.payroll_giving,
            &mut self.gift_aid,
            &mut self.adjusted_income,
            &mut self.child_benefit,
            &mut self.child_benefit_charge,
            &mut self.shares,
            &mut self.shares_taxed,
            &mut self.benefits_in_kind,
            &mut self.class_1a,
            &mut self.take_home,
            &mut self.employer_ni,
        ] {
            *v = pennies(*v);
        }
        for list in [
            &mut self.tax_bands,
            &mut self.dividend_bands,
            &mut self.ni_bands,
            &mut self.loans,
        ] {
            *list = list.drain(..).map(Slice::rounded).collect();
        }
        self
    }
}

/// `amount` of taxable income, `from` into the bands (what's below it
/// already used them), band by band. Tops that extend move up by `extend`.
fn slices(
    bands: &[Band],
    rate: impl Fn(usize, &Band) -> f64,
    extend: f64,
    from: f64,
    amount: f64,
) -> Vec<Slice> {
    let mut out = Vec::new();
    let end = from + amount;
    let mut bottom = 0.0_f64;
    for (i, b) in bands.iter().enumerate() {
        let top = b
            .upto
            .map(|t| t + if b.extends { extend } else { 0.0 })
            .unwrap_or(f64::INFINITY);
        let (lo, hi) = (from.max(bottom), end.min(top));
        if hi > lo {
            let r = rate(i, b);
            out.push(Slice {
                name: b.name.into(),
                rate: r,
                on: hi - lo,
                tax: (hi - lo) * r,
            });
        }
        bottom = top;
        if bottom >= end {
            break;
        }
    }
    out
}

/// The personal allowance, for an adjusted net income.
fn personal_allowance(y: &TaxYear, income: f64) -> f64 {
    let over = (income - y.taper_from).max(0.0);
    (y.personal_allowance - (over / 2.0).floor()).max(0.0)
}

fn employer_ni(y: &TaxYear, pay: f64) -> f64 {
    (pay - y.employer_threshold).max(0.0) * y.employer_rate
}

/// What an employee has besides cash pay: shares vesting, and benefits in
/// kind (their cash equivalent).
#[derive(Debug, Clone, Copy, Default)]
pub struct Extra {
    pub shares: crate::equity::Vested,
    pub benefits: f64,
}

/// A person's year: `pay` from employment, `pension` out of it (by
/// `you.pension_kind`), and `dividends`; and shares and benefits in kind.
fn payslip(
    y: &TaxYear,
    you: &You,
    pay: f64,
    pension: f64,
    dividends: f64,
    extra: Extra,
) -> Payslip {
    let pension = pension.clamp(0.0, pay);
    let sacrificed = if you.pension_kind == PensionKind::Sacrifice {
        pension
    } else {
        0.0
    };
    let sacrifice = you.sacrifice.clamp(0.0, pay - sacrificed);
    // What NI is paid on, what income tax is, and pension that moves the bands up.
    let (ni_pay, taxed_pay, at_source) = match you.pension_kind {
        PensionKind::Sacrifice => (pay - pension - sacrifice, pay - pension - sacrifice, 0.0),
        PensionKind::NetPay => (pay - sacrifice, pay - sacrifice - pension, 0.0),
        PensionKind::ReliefAtSource => (pay - sacrifice, pay - sacrifice, pension),
    };
    let giving = you.payroll_giving.clamp(0.0, taxed_pay.max(0.0));
    // Shares are pay when they vest (with NI, if readily convertible);
    // benefits are taxed, with no employee's NI.
    let shares_taxed = extra.shares.taxed_ni + extra.shares.taxed;
    let taxed_pay = taxed_pay - giving + shares_taxed + extra.benefits;
    let ni_pay = ni_pay + extra.shares.taxed_ni;
    // Gift Aid moves the bands up as pension with relief at source does.
    let extend = at_source + you.gift_aid / (1.0 - BASIC_RELIEF);
    let adjusted = taxed_pay + dividends - extend;

    let code = you.code();
    let bands = if you.scotland || code.is_some_and(|(_, s)| s) {
        y.scottish_bands
    } else {
        y.bands
    };
    // The allowance goes on pay first, then dividends: the usual one,
    // tapered, unless the tax code says otherwise.
    let allowance = match code {
        None => {
            let given = if you.marriage == Marriage::Give {
                y.marriage_allowance
            } else {
                0.0
            };
            (personal_allowance(y, adjusted) - given).max(0.0)
        }
        Some((Code::Allowance(a), _)) => a,
        Some(_) => 0.0,
    };
    let pay_taxable = (taxed_pay - allowance).max(0.0);
    let left = (allowance - taxed_pay).max(0.0);
    let div_taxable = (dividends - left).max(0.0);

    let mut tax_bands = match code {
        Some((Code::NoTax, _)) => Vec::new(),
        Some((Code::Flat(k), _)) => {
            let basic = bands
                .iter()
                .position(|b| b.name == "Basic rate")
                .unwrap_or(0);
            let b = &bands[(basic + k).min(bands.len() - 1)];
            let on = taxed_pay.max(0.0);
            vec![Slice {
                name: b.name.into(),
                rate: b.rate,
                on,
                tax: on * b.rate,
            }]
        }
        _ => slices(bands, |_, b| b.rate, extend, 0.0, pay_taxable),
    };
    // Dividends sit on top of pay, in the UK's bands; the allowance is
    // taxed at nothing, but uses up its part of them.
    let free = div_taxable.min(y.dividend_allowance);
    let mut dividend_bands = Vec::new();
    if free > 0.0 {
        dividend_bands.push(Slice {
            name: "Dividend allowance".into(),
            rate: 0.0,
            on: free,
            tax: 0.0,
        });
    }
    dividend_bands.extend(slices(
        y.bands,
        |i, _| y.dividend_rates[i.min(2)],
        extend,
        pay_taxable + free,
        div_taxable - free,
    ));

    let mut ni_bands = Vec::new();
    if !you.no_ni {
        let main = ni_pay.min(y.ni_upper) - y.ni_threshold;
        if main > 0.0 {
            ni_bands.push(Slice {
                name: "Main rate".into(),
                rate: y.ni_rate,
                on: main,
                tax: main * y.ni_rate,
            });
        }
        let upper = ni_pay - y.ni_upper;
        if upper > 0.0 {
            ni_bands.push(Slice {
                name: "Upper rate".into(),
                rate: y.ni_upper_rate,
                on: upper,
                tax: upper * y.ni_upper_rate,
            });
        }
    }

    // Student loans: on pay (as NI sees it), and on dividends too once
    // they're over £2,000. Several undergraduate plans are repaid as one,
    // from the lowest threshold; a postgraduate loan on top.
    let loan_income = ni_pay
        + if dividends > UNEARNED_FOR_LOANS {
            dividends
        } else {
            0.0
        };
    let plans: Vec<&Loan> = y
        .loans
        .iter()
        .filter(|l| you.student_loans.iter().any(|p| p == l.plan))
        .collect();
    let undergraduate = plans
        .iter()
        .filter(|l| l.plan != "postgrad")
        .min_by(|a, b| a.threshold.total_cmp(&b.threshold));
    let postgraduate = plans.iter().find(|l| l.plan == "postgrad");
    let loans: Vec<Slice> = undergraduate
        .into_iter()
        .chain(postgraduate)
        .filter(|l| loan_income > l.threshold)
        .map(|l| Slice {
            name: l.label.into(),
            rate: l.rate,
            on: loan_income - l.threshold,
            tax: (loan_income - l.threshold) * l.rate,
        })
        .collect();

    let sum = |s: &[Slice]| s.iter().map(|s| s.tax).sum::<f64>();
    // The Marriage Allowance had: 20% of it off the tax, for those who pay
    // no more than the basic rate (Scotland's intermediate rate).
    if code.is_none() && you.marriage == Marriage::Receive {
        let higher = tax_bands.iter().any(|s| s.rate > 0.21)
            || dividend_bands.iter().any(|s| s.rate > y.dividend_rates[0]);
        let off = (y.marriage_allowance * BASIC_RELIEF).min(sum(&tax_bands));
        if !higher && off > 0.0 {
            tax_bands.push(Slice {
                name: "Marriage Allowance".into(),
                rate: -BASIC_RELIEF,
                on: y.marriage_allowance,
                tax: -off,
            });
        }
    }
    // Child Benefit, and the charge on it: 1% for each step over the
    // threshold, in whole pounds; a partner with more income pays it instead.
    let child_benefit = match you.children {
        0 => 0.0,
        n => 52.0 * (y.child_benefit[0] + y.child_benefit[1] * f64::from(n - 1)),
    };
    let share = if you.partner_higher {
        0.0
    } else {
        let step = (y.hicbc_to - y.hicbc_from) / 100.0;
        (((adjusted - y.hicbc_from) / step).floor() / 100.0).clamp(0.0, 1.0)
    };
    let child_benefit_charge = (child_benefit * share).floor();
    let (income_tax, dividend_tax, ni, student_loan) = (
        sum(&tax_bands),
        sum(&dividend_bands),
        sum(&ni_bands),
        sum(&loans),
    );
    let paid = match you.pension_kind {
        PensionKind::ReliefAtSource => pension * (1.0 - BASIC_RELIEF),
        _ => pension,
    };
    Payslip {
        gross: pay,
        dividends,
        pension: paid,
        pension_in: pension,
        personal_allowance: allowance,
        taxable: pay_taxable + div_taxable,
        income_tax,
        dividend_tax,
        ni,
        student_loan,
        sacrifice,
        payroll_giving: giving,
        gift_aid: you.gift_aid,
        adjusted_income: adjusted,
        child_benefit,
        child_benefit_charge,
        tax_code_advice: advise(y, you, adjusted, extra.benefits),
        take_home: pay
            - paid
            - sacrifice
            - giving
            - you.gift_aid
            - income_tax
            - ni
            - student_loan
            - child_benefit_charge
            + dividends
            - dividend_tax
            + extra.shares.value,
        shares: extra.shares.value,
        shares_taxed,
        benefits_in_kind: extra.benefits,
        class_1a: extra.benefits * y.employer_rate,
        employer_ni: employer_ni(y, ni_pay),
        ni_pay,
        tax_bands,
        dividend_bands,
        ni_bands,
        loans,
    }
}

/// A salary's take-home pay, before rounding: for comparing.
fn salary_take_home(y: &TaxYear, you: &You, salary: f64) -> f64 {
    payslip(
        y,
        you,
        salary,
        salary * you.pension / 100.0,
        0.0,
        Extra::default(),
    )
    .take_home
}

/// The salary that leaves `take_home`, with the same pension and loans.
fn salary_like(y: &TaxYear, you: &You, take_home: f64) -> f64 {
    if take_home <= 0.0 {
        return 0.0;
    }
    least(take_home, |s| salary_take_home(y, you, s))
        .unwrap_or(f64::NAN)
        .round()
}

/// The take-home pay wanted, a year.
fn wanted(v: f64) -> Result<f64> {
    amount("the take-home pay you want", v)
}

/// A % that may be below nothing: a pay cut, or shares falling.
fn change(what: &str, v: f64, low: f64, high: f64) -> Result<f64> {
    if !v.is_finite() || !(low..=high).contains(&v) {
        return Err(invalid(format!(
            "{what} should be a % from {low} to {high}, not {v}"
        )));
    }
    Ok(v / 100.0)
}

/// A salary (and bonus), a year; or the salary that leaves the take-home
/// pay wanted, with the bonus on top. The first year of an offer: with a
/// sign-on bonus, the shares that vest in it, and benefits in kind; and
/// the years after, as pay rises and shares vest.
pub fn salary(input: &SalaryInput) -> Result<SalaryResult> {
    let y = check(&input.you)?;
    let you = &input.you;
    let fixed_bonus = amount("bonus", input.bonus)?;
    let bonus_share = percent("the bonus", input.bonus_percent)?;
    let bonus_of = |salary: f64| fixed_bonus + salary * bonus_share;
    let sign_on = amount("the sign-on bonus", input.sign_on)?;
    let refresher = amount("the refresher", input.refresher)?;
    let raise = change("the pay rise", input.raise, -50.0, 100.0)?;
    let growth = change(
        "the share price's growth",
        input.share_growth,
        -100.0,
        500.0,
    )?;
    let benefits = crate::equity::benefit_values(y, &input.benefits)?;
    if input.grants.len() > 20 {
        return Err(invalid("up to 20 grants"));
    }
    let mut notes = Vec::new();
    for g in &input.grants {
        notes.extend(g.check()?);
    }
    // How many years: as long as the longest grant, and at least 4, when
    // there's anything that changes over them.
    let longest = input
        .grants
        .iter()
        .map(|g| g.years.ceil() as u32)
        .max()
        .unwrap_or(0);
    let over_time = !input.grants.is_empty() || sign_on > 0.0 || raise != 0.0 || refresher > 0.0;
    let years = input
        .years
        .unwrap_or(if over_time { longest.max(4) } else { 0 });
    if years > 10 {
        return Err(invalid("up to 10 years"));
    }
    // Refreshers: granted at the start of each year from the second,
    // vesting as the first RSU grant does.
    let template = input
        .grants
        .iter()
        .find(|g| g.kind == crate::equity::Kind::Rsu)
        .cloned()
        .unwrap_or_default();
    let mut grants = input.grants.clone();
    if refresher > 0.0 {
        for k in 2..=years.max(2) {
            grants.push(crate::equity::Grant {
                label: format!("Refresher, year {k}"),
                kind: crate::equity::Kind::Rsu,
                value: Some(refresher),
                shares: None,
                price: None,
                strike: 0.0,
                grant_price: None,
                starts_months: 12.0 * f64::from(k - 1),
                ..template.clone()
            });
        }
    }
    let extra = |k: u32| Extra {
        shares: crate::equity::year_vests(&grants, k, growth),
        benefits: benefits.total,
    };
    let first = extra(1);

    let salary = match (input.salary, input.take_home) {
        (Some(salary), None) => amount("salary", salary)?,
        (None, Some(want)) => {
            let want = wanted(want)?;
            least(want, |s| {
                payslip(
                    y,
                    you,
                    s + bonus_of(s) + sign_on,
                    s * you.pension / 100.0,
                    0.0,
                    first,
                )
                .take_home
            })
            .ok_or_else(|| {
                invalid(format!(
                    "no salary leaves £{want:.0} a year to take home, with a pension of {}%",
                    you.pension
                ))
            })?
        }
        (Some(_), Some(_)) => {
            return Err(invalid("a salary, or the take-home pay you want: not both"));
        }
        (None, None) => {
            return Err(invalid("a salary is needed, or the take-home pay you want"));
        }
    };
    let employer_share = percent("the employer's pension", input.employer_pension)?;

    // A year: its pay, and what it leaves, with and without its shares.
    let year = |k: u32, salary: f64, bonus: f64, sign_on: f64| {
        let pension = salary * you.pension / 100.0;
        let extra = extra(k);
        let pay = payslip(y, you, salary + bonus + sign_on, pension, 0.0, extra);
        let without = payslip(
            y,
            you,
            salary + bonus + sign_on,
            pension,
            0.0,
            Extra {
                shares: Default::default(),
                ..extra
            },
        );
        (pay, without.take_home)
    };

    let bonus = bonus_of(salary);
    let (pay, without) = year(1, salary, bonus, sign_on);
    let more = payslip(
        y,
        you,
        salary + bonus + sign_on + 100.0,
        salary * you.pension / 100.0,
        0.0,
        first,
    );
    let employer_pension = salary * employer_share;
    let projection = (1..=years)
        .map(|k| {
            let grow = (1.0 + raise).powi(k as i32 - 1);
            let (s, b, o) = (
                salary * grow,
                fixed_bonus * grow + salary * grow * bonus_share,
                if k == 1 { sign_on } else { 0.0 },
            );
            let (p, without) = year(k, s, b, o);
            YearRow {
                year: k,
                salary: pennies(s),
                bonus: pennies(b),
                sign_on: pennies(o),
                shares: pennies(p.shares),
                benefits_in_kind: pennies(p.benefits_in_kind),
                total: pennies(s + b + o + p.shares),
                income_tax: pennies(p.income_tax),
                ni: pennies(p.ni),
                student_loan: pennies(p.student_loan),
                child_benefit_charge: pennies(p.child_benefit_charge),
                pension: pennies(p.pension),
                employer_pension: pennies(s * employer_share),
                take_home: pennies(p.take_home),
                shares_after_tax: pennies(p.take_home - without),
                tax_code: p.tax_code_advice.code.clone(),
            }
        })
        .collect();
    let grant_years = grants
        .iter()
        .map(|g| GrantYears {
            label: g.label.clone(),
            kind: g.kind,
            years: (1..=years.max(1))
                .map(|k| {
                    pennies(crate::equity::year_vests(std::slice::from_ref(g), k, growth).value)
                })
                .collect(),
        })
        .collect();
    let cash_ni = pay.ni_pay - first.shares.taxed_ni;
    Ok(SalaryResult {
        year: y.id,
        salary: pennies(salary),
        employer_pension: pennies(employer_pension),
        sign_on: pennies(sign_on),
        bonus: pennies(bonus),
        shares_after_tax: pennies(pay.take_home - without),
        benefits,
        projection,
        grants: grant_years,
        notes,
        employer_cost: pennies(
            cash_ni
                + first.shares.value
                + pay.benefits_in_kind
                + pay.employer_ni
                + pay.class_1a
                + employer_pension,
        ),
        next_100: pennies(more.take_home - pay.take_home),
        pay: Payslip {
            pension_in: pay.pension_in + employer_pension,
            ..pay
        }
        .rounded(),
    })
}

/// A contract's terms, checked: how much of the year it's worked, and
/// what's paid out of its rate either side of IR35.
struct Terms<'a> {
    y: &'static TaxYear,
    you: &'a You,
    weeks: f64,
    /// How many of the rate's `per` the year has: days, hours, weeks…
    per_year: f64,
    /// The umbrella's margin, a week, and its pension, a share of
    /// qualifying earnings.
    margin: f64,
    their_pension: f64,
    expenses: f64,
    company_pension: f64,
    director: f64,
    /// Of the profit after tax, the share taken as dividends.
    share: f64,
}

impl<'a> Terms<'a> {
    fn new(y: &'static TaxYear, input: &'a ContractInput) -> Result<Terms<'a>> {
        if !(0.0..=7.0).contains(&input.days_per_week) {
            return Err(invalid("days a week should be from 0 to 7"));
        }
        if !(0.0..=52.0).contains(&input.weeks) {
            return Err(invalid("weeks worked should be from 0 to 52"));
        }
        if !(0.0..=24.0).contains(&input.hours_per_day) {
            return Err(invalid("hours a day should be from 0 to 24"));
        }
        let days = input.days_per_week * input.weeks;
        Ok(Terms {
            y,
            you: &input.you,
            weeks: input.weeks,
            per_year: match input.per {
                RatePer::Hour => input.hours_per_day * days,
                RatePer::Day => days,
                RatePer::Week => input.weeks,
                // A month's rate for the months of the weeks worked.
                RatePer::Month => input.weeks * 12.0 / 52.0,
                RatePer::Year => 1.0,
            },
            margin: amount("the umbrella's margin", input.umbrella_margin)?,
            their_pension: percent("the umbrella's pension", input.umbrella_pension)?,
            expenses: amount("expenses", input.expenses)?,
            company_pension: amount("the company's pension", input.company_pension)?,
            director: amount(
                "your salary",
                input.director_salary.unwrap_or(y.personal_allowance),
            )?,
            share: percent("dividends", input.dividends)?,
        })
    }

    /// Inside IR35: the umbrella pays its costs out of what the client
    /// pays, and the rest to you as pay. Its costs rise with your pay, so
    /// find the pay they leave room for.
    fn inside(&self, rate: f64) -> Inside {
        let (y, you) = (self.y, self.you);
        let income = rate * self.per_year;
        let margin = (self.margin * self.weeks).min(income);
        let mine = you.pension / 100.0;
        let costs = |pay: f64| {
            let ni_pay = (match you.pension_kind {
                PensionKind::Sacrifice => pay * (1.0 - mine),
                _ => pay,
            } - you.sacrifice)
                .max(0.0);
            let qualifying = (pay.min(y.qualifying[1]) - y.qualifying[0]).max(0.0);
            (
                employer_ni(y, ni_pay),
                ni_pay * y.levy_rate,
                qualifying * self.their_pension,
            )
        };
        let room = income - margin;
        let (mut lo, mut hi) = (0.0, room.max(0.0));
        for _ in 0..80 {
            let mid = (lo + hi) / 2.0;
            let (ni, levy, pension) = costs(mid);
            if mid + ni + levy + pension < room {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        let gross = lo;
        let (ni, levy, pension) = costs(gross);
        let pay = payslip(y, you, gross, gross * mine, 0.0, Extra::default());
        Inside {
            rate: pennies(rate),
            income: pennies(income),
            margin: pennies(margin),
            employer_ni: pennies(ni),
            levy: pennies(levy),
            employer_pension: pennies(pension),
            salary_like: 0.0,
            pay: Payslip {
                pension_in: pay.pension_in + pension,
                ..pay
            }
            .rounded(),
        }
    }

    /// Outside IR35: your company pays you a salary, its costs and
    /// corporation tax; what's left of the profit is yours as dividends.
    fn outside(&self, rate: f64) -> Outside {
        let y = self.y;
        let income = rate * self.per_year;
        let director_ni = employer_ni(y, self.director);
        let profit = income - self.expenses - self.director - director_ni - self.company_pension;
        let ct = corporation_tax(y, profit);
        let after_tax = profit - ct;
        let dividends = after_tax.max(0.0) * self.share;
        // Your pension comes from the company here, not your salary; and a
        // director's salary is the allowance, with no sacrifice or code.
        let as_director = You {
            pension: 0.0,
            sacrifice: 0.0,
            payroll_giving: 0.0,
            tax_code: None,
            ..self.you.clone()
        };
        let pay = payslip(
            y,
            &as_director,
            self.director,
            0.0,
            dividends,
            Extra::default(),
        );
        Outside {
            rate: pennies(rate),
            income: pennies(income),
            expenses: pennies(self.expenses),
            salary: pennies(self.director),
            employer_ni: pennies(director_ni),
            company_pension: pennies(self.company_pension),
            profit: pennies(profit),
            corporation_tax: pennies(ct),
            retained: pennies(after_tax - dividends),
            salary_like: 0.0,
            pay: Payslip {
                pension_in: self.company_pension,
                ..pay
            }
            .rounded(),
        }
    }

    /// The least rate that leaves `want` to take home, one side or the other.
    fn rate_for(&self, want: f64, side: &str, take_home: impl Fn(f64) -> f64) -> Result<f64> {
        if self.per_year <= 0.0 {
            return Err(invalid(
                "no days are worked, so no rate leaves anything to take home",
            ));
        }
        least(want, take_home).ok_or_else(|| {
            invalid(format!(
                "no rate leaves £{want:.0} a year to take home {side} IR35, as it's set up"
            ))
        })
    }
}

/// A rate, inside and outside IR35, side by side; or the rate either side
/// that leaves the take-home pay wanted.
pub fn contract(input: &ContractInput) -> Result<ContractResult> {
    let you = &input.you;
    let y = check(you)?;
    let terms = Terms::new(y, input)?;
    let (mut inside, mut outside, want) = match (input.rate, input.take_home) {
        (Some(rate), None) => {
            let rate = amount("the rate", rate)?;
            if rate * terms.per_year > MOST {
                return Err(invalid("that rate comes to more than hunt works out"));
            }
            (terms.inside(rate), terms.outside(rate), None)
        }
        (None, Some(want)) => {
            let want = wanted(want)?;
            let inside = terms.rate_for(want, "inside", |r| terms.inside(r).pay.take_home)?;
            let outside = terms.rate_for(want, "outside", |r| terms.outside(r).pay.take_home)?;
            (terms.inside(inside), terms.outside(outside), Some(want))
        }
        (Some(_), Some(_)) => {
            return Err(invalid("a rate, or the take-home pay you want: not both"));
        }
        (None, None) => {
            return Err(invalid("a rate is needed, or the take-home pay you want"));
        }
    };
    inside.salary_like = salary_like(y, you, inside.pay.take_home);
    outside.salary_like = salary_like(y, you, outside.pay.take_home);
    Ok(ContractResult {
        year: y.id,
        per: input.per,
        days: pennies(input.days_per_week * input.weeks),
        rate: want.is_none().then_some(inside.rate),
        income: want.is_none().then_some(inside.income),
        take_home: want.map(pennies),
        inside,
        outside,
    })
}

/// Corporation tax on a year's profit: the small profits rate, the main
/// rate, or the main rate less marginal relief between them.
fn corporation_tax(y: &TaxYear, profit: f64) -> f64 {
    if profit <= 0.0 {
        0.0
    } else if profit <= y.ct_lower {
        profit * y.ct_small
    } else if profit >= y.ct_upper {
        profit * y.ct_main
    } else {
        profit * y.ct_main - (y.ct_upper - profit) * y.ct_fraction
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn you(year: &str) -> You {
        You {
            year: Some(year.into()),
            ..You::default()
        }
    }

    fn pay(salary: f64, you: You) -> SalaryResult {
        super::salary(&SalaryInput {
            salary: Some(salary),
            take_home: None,
            bonus: 0.0,
            employer_pension: 0.0,
            you,
            ..SalaryInput::default()
        })
        .unwrap()
    }

    #[test]
    fn a_basic_rate_salary() {
        let r = pay(50_000.0, you("2026-27"));
        assert_eq!(r.pay.income_tax, 7_486.0);
        assert_eq!(r.pay.ni, 2_994.4);
        assert_eq!(r.pay.take_home, 39_519.6);
        // 15% employer's NI over £5,000.
        assert_eq!(r.pay.employer_ni, 6_750.0);
        assert_eq!(r.employer_cost, 56_750.0);
        // 20% tax and 8% NI on the next £100.
        assert_eq!(r.next_100, 72.0);
    }

    #[test]
    fn the_allowance_tapers_away_from_100k() {
        let r = pay(100_000.0, you("2026-27"));
        assert_eq!(r.pay.personal_allowance, 12_570.0);
        assert_eq!(r.pay.income_tax, 27_432.0);
        assert_eq!(r.pay.take_home, 68_557.4);
        // In the taper, 60% tax and 2% NI.
        assert_eq!(r.next_100, 38.0);

        let r = pay(150_000.0, you("2026-27"));
        assert_eq!(r.pay.personal_allowance, 0.0);
        assert_eq!(r.pay.income_tax, 53_703.0);
        assert_eq!(r.pay.ni, 5_010.6);
        assert_eq!(r.pay.take_home, 91_286.4);
    }

    #[test]
    fn scotland_has_its_own_bands() {
        let r = pay(
            50_000.0,
            You {
                scotland: true,
                ..you("2026-27")
            },
        );
        // 19% on £3,967, 20% on £12,989, 21% on £14,136, 42% on £6,338.
        assert_eq!(r.pay.income_tax, 8_982.05);
        assert_eq!(r.pay.tax_bands.len(), 4);
        assert_eq!(r.pay.take_home, 38_023.55);
    }

    #[test]
    fn pensions_three_ways() {
        let with = |kind| {
            pay(
                60_000.0,
                You {
                    pension: 5.0,
                    pension_kind: kind,
                    ..you("2026-27")
                },
            )
        };
        // Salary sacrifice: £3,000 off before tax and NI.
        let s = with(PensionKind::Sacrifice);
        assert_eq!(s.pay.pension, 3_000.0);
        assert_eq!(s.pay.income_tax, 10_232.0);
        assert_eq!(s.pay.ni, 3_150.6);
        assert_eq!(s.employer_cost, 57_000.0 + 7_800.0);
        // Net pay: off before tax, not NI.
        let n = with(PensionKind::NetPay);
        assert_eq!(n.pay.income_tax, 10_232.0);
        assert_eq!(n.pay.ni, 3_210.6);
        // Relief at source: £2,400 from pay makes £3,000 in the pension, and
        // the higher rate band moves up by £3,000.
        let r = with(PensionKind::ReliefAtSource);
        assert_eq!(r.pay.pension, 2_400.0);
        assert_eq!(r.pay.pension_in, 3_000.0);
        assert_eq!(r.pay.income_tax, 10_832.0);
        assert_eq!(r.pay.take_home, n.pay.take_home);
    }

    #[test]
    fn student_loans() {
        let r = pay(
            40_000.0,
            You {
                student_loans: vec!["plan2".into(), "postgrad".into()],
                ..you("2026-27")
            },
        );
        // 9% over £29,385 and 6% over £21,000.
        assert_eq!(r.pay.loans.len(), 2);
        assert_eq!(r.pay.student_loan, 2_095.35);
        // Two undergraduate plans: one repayment, from the lower threshold.
        let r = pay(
            40_000.0,
            You {
                student_loans: vec!["plan1".into(), "plan2".into()],
                ..you("2026-27")
            },
        );
        assert_eq!(r.pay.loans.len(), 1);
        assert_eq!(r.pay.student_loan, 1_179.0);
    }

    #[test]
    fn inside_ir35_through_an_umbrella() {
        let r = contract(&ContractInput {
            rate: Some(500.0),
            you: you("2026-27"),
            ..ContractInput::default()
        })
        .unwrap();
        assert_eq!(r.days, 230.0);
        assert_eq!(r.income, Some(115_000.0));
        let i = &r.inside;
        assert_eq!(i.margin, 920.0);
        // What's left after the margin pays you, employer's NI and the levy.
        assert_eq!(i.pay.gross, 99_419.91);
        assert_eq!(
            pennies(i.margin + i.employer_ni + i.levy + i.pay.gross),
            115_000.0
        );
        assert_eq!(i.pay.take_home, 68_220.95);
        // As good as a salary of the same gross pay.
        assert_eq!(i.salary_like, 99_420.0);
    }

    #[test]
    fn outside_ir35_through_a_company() {
        let r = contract(&ContractInput {
            rate: Some(500.0),
            you: you("2026-27"),
            ..ContractInput::default()
        })
        .unwrap();
        let o = &r.outside;
        assert_eq!(o.salary, 12_570.0);
        assert_eq!(o.employer_ni, 1_135.5);
        assert_eq!(o.profit, 101_294.5);
        // Between £50k and £250k: 25% less marginal relief.
        assert_eq!(o.corporation_tax, 23_093.04);
        assert_eq!(o.pay.dividends, 78_201.46);
        // £500 free, then 10.75% to the higher rate, 35.75% above.
        assert_eq!(o.pay.dividend_tax, 18_478.27);
        assert_eq!(o.pay.income_tax, 0.0);
        assert_eq!(o.pay.ni, 0.0);
        assert_eq!(o.pay.take_home, 72_293.19);
        // A salary in the allowance's taper, where only 38% of each £1 is kept.
        assert_eq!(o.salary_like, 109_831.0);
    }

    #[test]
    fn dividends_were_taxed_less_in_2025_26() {
        let at = |year| {
            contract(&ContractInput {
                rate: Some(500.0),
                you: you(year),
                ..ContractInput::default()
            })
            .unwrap()
            .outside
            .pay
            .dividend_tax
        };
        assert!(at("2025-26") < at("2026-27"));
    }

    #[test]
    fn student_loans_count_dividends_over_2000() {
        let r = contract(&ContractInput {
            rate: Some(500.0),
            you: You {
                student_loans: vec!["plan2".into()],
                ..you("2026-27")
            },
            ..ContractInput::default()
        })
        .unwrap();
        let o = &r.outside.pay;
        assert_eq!(
            o.student_loan,
            pennies((12_570.0 + 78_201.457_5 - 29_385.0) * 0.09)
        );
    }

    #[test]
    fn a_rate_by_the_hour_week_month_or_year() {
        let at = |rate, per| {
            contract(&ContractInput {
                rate: Some(rate),
                per,
                you: you("2026-27"),
                ..ContractInput::default()
            })
            .unwrap()
        };
        let by_day = at(500.0, RatePer::Day);
        // 7.5 hours a day, 5 days a week, 46 weeks: the same £115,000.
        for (rate, per) in [
            (500.0 / 7.5, RatePer::Hour),
            (2_500.0, RatePer::Week),
            (2_500.0 * 52.0 / 12.0, RatePer::Month),
            (115_000.0, RatePer::Year),
        ] {
            let r = at(rate, per);
            assert!((r.income.unwrap() - 115_000.0).abs() < 0.01, "{per:?}");
            assert!(
                (r.inside.pay.take_home - by_day.inside.pay.take_home).abs() < 0.02,
                "{per:?}"
            );
        }
        // A year's rate is the year's, however many weeks are worked.
        let r = contract(&ContractInput {
            rate: Some(100_000.0),
            per: RatePer::Year,
            weeks: 40.0,
            you: you("2026-27"),
            ..ContractInput::default()
        })
        .unwrap();
        assert_eq!(r.income, Some(100_000.0));
        assert_eq!(r.inside.margin, 800.0);
    }

    #[test]
    fn a_salary_from_the_take_home_pay_wanted() {
        let from = |take_home, bonus, you| {
            salary(&SalaryInput {
                salary: None,
                take_home: Some(take_home),
                bonus,
                employer_pension: 0.0,
                you,
                ..SalaryInput::default()
            })
            .unwrap()
        };
        // £50k leaves £39,519.60, so that's what leaves it.
        let r = from(39_519.6, 0.0, you("2026-27"));
        assert_eq!(r.salary, 50_000.0);
        assert_eq!(r.pay.take_home, 39_519.6);
        // In the allowance's taper, and with a pension and a loan: the
        // salary found leaves what was wanted, to the penny.
        let with = You {
            pension: 5.0,
            pension_kind: PensionKind::Sacrifice,
            student_loans: vec!["plan2".into()],
            ..you("2026-27")
        };
        let r = from(70_000.0, 0.0, with.clone());
        assert!(
            (r.pay.take_home - 70_000.0).abs() < 0.02,
            "{}",
            r.pay.take_home
        );
        // A bonus comes on top, so less salary is needed.
        let b = from(70_000.0, 10_000.0, with);
        assert!(b.salary < r.salary);
        assert!((b.pay.take_home - 70_000.0).abs() < 0.02);
        // Nothing wanted: no salary.
        assert_eq!(from(0.0, 0.0, you("2026-27")).salary, 0.0);
        // All of it into a pension: no salary leaves anything.
        assert!(
            salary(&SalaryInput {
                salary: None,
                take_home: Some(10_000.0),
                bonus: 0.0,
                employer_pension: 0.0,
                you: You {
                    pension: 100.0,
                    ..you("2026-27")
                },
                ..SalaryInput::default()
            })
            .is_err()
        );
    }

    #[test]
    fn a_rate_from_the_take_home_pay_wanted() {
        let from = |take_home, per| {
            contract(&ContractInput {
                rate: None,
                take_home: Some(take_home),
                per,
                you: you("2026-27"),
                ..ContractInput::default()
            })
            .unwrap()
        };
        // £500 a day leaves £68,220.95 inside and £72,293.19 outside.
        let r = from(68_220.95, RatePer::Day);
        assert_eq!(r.rate, None);
        assert_eq!(r.take_home, Some(68_220.95));
        assert_eq!(r.inside.rate, 500.0);
        assert_eq!(r.inside.pay.take_home, 68_220.95);
        // Outside, less does it: the least rate, to the penny, that leaves
        // at least what's wanted (a penny a day is £2.30 a year).
        assert!(r.outside.rate < 500.0);
        let over = r.outside.pay.take_home - 68_220.95;
        assert!((0.0..2.0).contains(&over), "{over}");
        let r = from(72_293.19, RatePer::Day);
        assert_eq!(r.outside.rate, 500.0);
        // By the hour: a day's worth of hours.
        let r = from(68_220.95, RatePer::Hour);
        assert!(
            (r.inside.rate * 7.5 - 500.0).abs() < 0.08,
            "{}",
            r.inside.rate
        );
        // Neither, both, or no days worked: refused, with a reason.
        let bad = |input: ContractInput| contract(&input).is_err();
        assert!(bad(ContractInput::default()));
        assert!(bad(ContractInput {
            rate: Some(500.0),
            take_home: Some(50_000.0),
            ..ContractInput::default()
        }));
        assert!(bad(ContractInput {
            take_home: Some(50_000.0),
            weeks: 0.0,
            ..ContractInput::default()
        }));
        // Nothing taken as dividends: outside never leaves enough.
        assert!(bad(ContractInput {
            take_home: Some(50_000.0),
            dividends: 0.0,
            ..ContractInput::default()
        }));
    }

    #[test]
    fn tax_codes_are_read_as_payroll_reads_them() {
        let read = |c: &str| tax_code(c).unwrap();
        assert_eq!(read(""), None);
        assert_eq!(read("1257L"), Some((Code::Allowance(12_570.0), false)));
        assert_eq!(read("s1257l"), Some((Code::Allowance(12_570.0), true)));
        assert_eq!(read("C1257L"), Some((Code::Allowance(12_570.0), false)));
        assert_eq!(read("1257L W1"), Some((Code::Allowance(12_570.0), false)));
        assert_eq!(read("K475"), Some((Code::Allowance(-4_750.0), false)));
        assert_eq!(read("0T"), Some((Code::Allowance(0.0), false)));
        assert_eq!(read("BR"), Some((Code::Flat(0), false)));
        assert_eq!(read("SD2"), Some((Code::Flat(3), true)));
        assert_eq!(read("NT"), Some((Code::NoTax, false)));
        for bad in ["ABC", "1257", "K", "12345678L"] {
            assert!(tax_code(bad).is_err(), "{bad}");
        }
        let tax = |code: &str| {
            pay(
                50_000.0,
                You {
                    tax_code: Some(code.into()),
                    ..you("2026-27")
                },
            )
            .pay
            .income_tax
        };
        assert_eq!(tax("1257L"), 7_486.0);
        assert_eq!(tax("BR"), 10_000.0);
        assert_eq!(tax("D0"), 20_000.0);
        assert_eq!(tax("NT"), 0.0);
        // No allowance: 20% on £37,700, 40% on £12,300.
        assert_eq!(tax("0T"), 12_460.0);
        // £4,750 added to pay: 20% on £37,700, 40% on £17,050.
        assert_eq!(tax("K475"), 14_360.0);
        // D2 is beyond England's top rate, not Scotland's.
        assert!(
            salary(&SalaryInput {
                salary: Some(50_000.0),
                take_home: None,
                bonus: 0.0,
                employer_pension: 0.0,
                you: You {
                    tax_code: Some("D2".into()),
                    ..you("2026-27")
                },
                ..SalaryInput::default()
            })
            .is_err()
        );
    }

    #[test]
    fn a_tax_code_is_recommended_from_the_figures() {
        let code = |salary, you: You| pay(salary, you).pay.tax_code_advice.code;
        assert_eq!(code(50_000.0, you("2026-27")), "1257L");
        // Tapered: £12,570 less £6,000 at £112,000.
        assert_eq!(code(112_000.0, you("2026-27")), "657T");
        // Used up from £125,140.
        assert_eq!(code(130_000.0, you("2026-27")), "0T");
        let scot = You {
            scotland: true,
            ..you("2026-27")
        };
        assert_eq!(code(50_000.0, scot), "S1257L");
        // A pension by net pay lowers adjusted net income: £105k, less 10%.
        let pension = You {
            pension: 10.0,
            ..you("2026-27")
        };
        assert_eq!(code(105_000.0, pension), "1257L");
        let married = |m| You {
            marriage: m,
            ..you("2026-27")
        };
        // Received, by a basic-rate taxpayer: £13,830.
        assert_eq!(code(30_000.0, married(Marriage::Receive)), "1383M");
        // Not by a higher-rate one.
        assert_eq!(code(60_000.0, married(Marriage::Receive)), "1257L");
        // Given, from income below the Personal Allowance: £11,310.
        assert_eq!(code(10_000.0, married(Marriage::Give)), "1131N");
        assert_eq!(code(30_000.0, married(Marriage::Give)), "1257L");
        // The code recommended leaves the same tax as the usual one.
        let usual = pay(112_000.0, you("2026-27")).pay.income_tax;
        let coded = pay(
            112_000.0,
            You {
                tax_code: Some("657T".into()),
                ..you("2026-27")
            },
        )
        .pay
        .income_tax;
        assert_eq!(usual, coded);
    }

    #[test]
    fn an_offer_with_shares_over_the_years() {
        use crate::equity::Grant;
        // As an offer: £108,000, a 15% bonus, £25,000 to sign on, and
        // $300,000 of RSUs over 4 years, quarterly from 3 months in.
        let offer = |refresher| {
            salary(&SalaryInput {
                salary: Some(108_000.0),
                bonus: 16_200.0,
                sign_on: 25_000.0,
                grants: vec![Grant {
                    value: Some(300_000.0 * 0.748),
                    ..Grant::default()
                }],
                refresher,
                you: you("2026-27"),
                ..SalaryInput::default()
            })
            .unwrap()
        };
        let r = offer(0.0);
        assert_eq!(r.pay.shares, 56_100.0);
        // The shares are pay: taxed, with NI.
        assert_eq!(r.pay.shares_taxed, 56_100.0);
        assert_eq!(r.pay.gross, 108_000.0 + 16_200.0 + 25_000.0);
        // Over £125,140: no Personal Allowance, so 0T.
        assert_eq!(r.pay.personal_allowance, 0.0);
        assert_eq!(r.pay.tax_code_advice.code, "0T");
        // At 45% tax and 2% NI, 53% of the shares are left.
        assert!(
            (r.shares_after_tax - 56_100.0 * 0.53).abs() < 0.01,
            "{}",
            r.shares_after_tax
        );
        // Four years: the sign-on in the first only, shares in each.
        assert_eq!(r.projection.len(), 4);
        assert_eq!(
            r.projection[0].total,
            108_000.0 + 16_200.0 + 25_000.0 + 56_100.0
        );
        assert_eq!(r.projection[1].sign_on, 0.0);
        assert_eq!(r.projection[3].shares, 56_100.0);
        assert_eq!(r.projection[0].take_home, r.pay.take_home);
        // A £40,000 refresher a year from the second: a quarter of it vests
        // in its first year.
        let r = offer(40_000.0);
        assert_eq!(r.projection[0].shares, 56_100.0);
        assert_eq!(r.projection[1].shares, 56_100.0 + 10_000.0);
        assert_eq!(r.projection[3].shares, 56_100.0 + 30_000.0);
        assert_eq!(r.grants.len(), 4);
    }

    #[test]
    fn a_bonus_as_a_share_of_salary() {
        let r = salary(&SalaryInput {
            salary: Some(108_000.0),
            bonus_percent: 15.0,
            raise: 5.0,
            sign_on: 1.0,
            you: you("2026-27"),
            ..SalaryInput::default()
        })
        .unwrap();
        assert_eq!(r.bonus, 16_200.0);
        assert_eq!(r.projection[1].bonus, 17_010.0);
        // Back from take-home pay, the bonus follows the salary found.
        let back = salary(&SalaryInput {
            take_home: Some(r.pay.take_home),
            bonus_percent: 15.0,
            sign_on: 1.0,
            you: you("2026-27"),
            ..SalaryInput::default()
        })
        .unwrap();
        assert!((back.salary - 108_000.0).abs() < 0.05, "{}", back.salary);
    }

    #[test]
    fn a_pay_rise_and_the_share_price() {
        let r = salary(&SalaryInput {
            salary: Some(50_000.0),
            raise: 10.0,
            share_growth: 20.0,
            grants: vec![crate::equity::Grant {
                value: Some(40_000.0),
                every_months: 12.0,
                ..Default::default()
            }],
            you: you("2026-27"),
            ..SalaryInput::default()
        })
        .unwrap();
        assert_eq!(r.projection[1].salary, 55_000.0);
        assert_eq!(r.projection[2].salary, 60_500.0);
        // £10,000 a year, at the price a year on, two years on…
        assert_eq!(r.projection[0].shares, 12_000.0);
        assert_eq!(r.projection[1].shares, 14_400.0);
    }

    #[test]
    fn benefits_in_kind_are_taxed_and_coded() {
        let with = |salary, benefits| {
            super::salary(&SalaryInput {
                salary: Some(salary),
                benefits,
                you: you("2025-26"),
                ..SalaryInput::default()
            })
            .unwrap()
        };
        // £1,200 of medical insurance: taxed at 20%, no NI; 1137L.
        let medical = crate::equity::Benefits {
            medical: 1_200.0,
            ..Default::default()
        };
        let r = with(40_000.0, medical);
        let plain = with(40_000.0, Default::default());
        assert_eq!(r.pay.income_tax, plain.pay.income_tax + 240.0);
        assert_eq!(r.pay.ni, plain.pay.ni);
        assert_eq!(r.pay.take_home, plain.pay.take_home - 240.0);
        assert_eq!(r.pay.class_1a, 180.0);
        assert_eq!(r.pay.tax_code_advice.code, "1137L");
        // HMRC's example: £12,570 less a car of £14,120 is K154.
        let car = crate::equity::Benefits {
            other: 14_120.0,
            ..Default::default()
        };
        assert_eq!(with(20_000.0, car).pay.tax_code_advice.code, "K154");
    }

    #[test]
    fn the_marriage_allowance() {
        let with = |salary, marriage| {
            pay(
                salary,
                You {
                    marriage,
                    ..you("2026-27")
                },
            )
            .pay
            .income_tax
        };
        // Had: £252 off a basic-rate taxpayer's tax.
        assert_eq!(with(30_000.0, Marriage::None), 3_486.0);
        assert_eq!(with(30_000.0, Marriage::Receive), 3_234.0);
        // Not for a higher-rate taxpayer.
        assert_eq!(
            with(60_000.0, Marriage::Receive),
            with(60_000.0, Marriage::None)
        );
        // Given: £1,260 less allowance.
        assert_eq!(with(30_000.0, Marriage::Give), 3_738.0);
    }

    #[test]
    fn the_high_income_child_benefit_charge() {
        let with = |salary, partner_higher, pension| {
            pay(
                salary,
                You {
                    children: 2,
                    partner_higher,
                    pension,
                    ..you("2026-27")
                },
            )
            .pay
        };
        // £27.05 and £17.90 a week.
        let r = with(55_000.0, false, 0.0);
        assert_eq!(r.child_benefit, 2_337.4);
        assert_eq!(r.child_benefit_charge, 0.0);
        // £70k: 50% of it, in whole pounds, off take-home pay.
        let r = with(70_000.0, false, 0.0);
        assert_eq!(r.child_benefit_charge, 1_168.0);
        assert_eq!(
            r.take_home,
            pay(70_000.0, you("2026-27")).pay.take_home - 1_168.0
        );
        // From £80k, all of it.
        assert_eq!(with(85_000.0, false, 0.0).child_benefit_charge, 2_337.0);
        // A partner with more income pays it instead.
        assert_eq!(with(70_000.0, true, 0.0).child_benefit_charge, 0.0);
        // A pension lowers adjusted net income: £63k, 15%.
        assert_eq!(with(70_000.0, false, 10.0).child_benefit_charge, 350.0);
    }

    #[test]
    fn salary_sacrifice_giving_and_gift_aid() {
        // £2,000 sacrificed: off pay before tax and NI, and the employer's NI.
        let r = pay(
            50_000.0,
            You {
                sacrifice: 2_000.0,
                ..you("2026-27")
            },
        );
        assert_eq!(r.pay.income_tax, 7_086.0);
        assert_eq!(r.pay.ni, 2_834.4);
        assert_eq!(r.pay.take_home, 38_079.6);
        assert_eq!(r.employer_cost, 48_000.0 + 6_450.0);
        // Payroll giving: before tax, not NI.
        let r = pay(
            50_000.0,
            You {
                payroll_giving: 1_000.0,
                ..you("2026-27")
            },
        );
        assert_eq!(r.pay.income_tax, 7_286.0);
        assert_eq!(r.pay.ni, 2_994.4);
        assert_eq!(r.pay.take_home, 38_719.6);
        // Gift Aid: £800 given is £1,000 to the charity, and the basic rate
        // band £1,000 longer.
        let r = pay(
            60_000.0,
            You {
                gift_aid: 800.0,
                ..you("2026-27")
            },
        );
        assert_eq!(r.pay.income_tax, 11_232.0);
        assert_eq!(r.pay.take_home, 60_000.0 - 800.0 - 11_232.0 - 3_210.6);
    }

    #[test]
    fn an_employers_pension_contribution() {
        let r = salary(&SalaryInput {
            salary: Some(50_000.0),
            take_home: None,
            bonus: 0.0,
            employer_pension: 5.0,
            you: you("2026-27"),
            ..SalaryInput::default()
        })
        .unwrap();
        assert_eq!(r.employer_pension, 2_500.0);
        assert_eq!(r.pay.pension_in, 2_500.0);
        assert_eq!(r.employer_cost, 56_750.0 + 2_500.0);
        // Take-home pay is the same.
        assert_eq!(r.pay.take_home, 39_519.6);
    }

    #[test]
    fn corporation_tax_bands() {
        let y = year(Some("2026-27")).unwrap();
        assert_eq!(corporation_tax(y, 40_000.0), 7_600.0);
        assert_eq!(corporation_tax(y, 300_000.0), 75_000.0);
        // Marginal relief meets both ends.
        assert!((corporation_tax(y, 50_000.0) - 9_500.0).abs() < 1e-6);
        assert!((corporation_tax(y, 250_000.0) - 62_500.0).abs() < 1e-6);
    }

    #[test]
    fn the_year_starts_on_6_april() {
        use jiff::civil::date;
        assert_eq!(year_for(date(2026, 4, 5)).id, "2025-26");
        assert_eq!(year_for(date(2026, 4, 6)).id, "2026-27");
        assert_eq!(year_for(date(2026, 10, 12)).id, "2026-27");
        // Beyond the years known: the nearest.
        assert_eq!(year_for(date(2031, 1, 1)).id, "2026-27");
        assert_eq!(year_for(date(2020, 1, 1)).id, "2025-26");
    }

    #[test]
    fn bad_input_is_refused() {
        let bad = |you: You, salary: f64| {
            super::salary(&SalaryInput {
                salary: Some(salary),
                take_home: None,
                bonus: 0.0,
                employer_pension: 0.0,
                you,
                ..SalaryInput::default()
            })
            .is_err()
        };
        assert!(bad(you("2026-27"), -1.0));
        assert!(bad(you("1999-00"), 50_000.0));
        assert!(bad(
            You {
                pension: 120.0,
                ..you("2026-27")
            },
            50_000.0
        ));
        assert!(bad(
            You {
                student_loans: vec!["plan9".into()],
                ..you("2026-27")
            },
            50_000.0
        ));
    }
}
