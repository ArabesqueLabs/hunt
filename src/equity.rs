//! Shares and benefits in kind, for take-home pay (see [`crate::takehome`]):
//! what share grants vest each year and how much of it is taxed, and what
//! benefits in kind are worth to HMRC. Rules from gov.uk:
//!
//! - **RSUs**: taxed as employment income on the market value of the
//!   shares at vesting (HMRC's Employment Related Securities Manual,
//!   ERSM20194).
//! - **Options outside the tax-advantaged schemes**: taxed on the market
//!   value at exercise less what's paid (HS305).
//! - **EMI**: no Income Tax or NI if bought for at least the market value
//!   at grant; tax on the discount if not.
//! - **CSOP**: no Income Tax or NI if bought between 3 and 10 years after
//!   grant; up to £60,000 of options.
//! - **Sharesave (SAYE)**: no Income Tax or NI on the discount.
//! - Shares that are readily convertible (listed, say) go through PAYE,
//!   with employee's and employer's NI; others pay Income Tax through Self
//!   Assessment, and no NI ("How employment related securities work if
//!   you're an employer").
//!
//! Options are taken as exercised, and shares sold, as they vest: so no
//! Capital Gains Tax, and the value is what selling them would bring.
//!
//! Benefits in kind (HMRC's 480): a company car is its list price (with
//! accessories, less up to £5,000 paid towards it) times the appropriate
//! percentage for its CO2 and electric range, less what's paid for private
//! use; car fuel is a set amount times the same percentage; a van and its
//! fuel are set amounts; a loan over £10,000 is the interest not paid at
//! HMRC's official rate. Income Tax, no employee's NI, and the employer
//! pays Class 1A NI.

use serde::{Deserialize, Serialize};

use crate::error::{Result, invalid};
use crate::takehome::TaxYear;

/// A kind of share award.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    /// Restricted stock units: shares given as they vest.
    #[default]
    Rsu,
    /// Options outside the tax-advantaged schemes.
    Unapproved,
    /// Enterprise Management Incentives.
    Emi,
    /// A Company Share Option Plan.
    Csop,
    /// Save As You Earn (Sharesave).
    Saye,
}

/// Kinds of share award: (value, label).
pub const KINDS: &[(&str, &str)] = &[
    ("rsu", "RSUs (restricted stock units)"),
    ("unapproved", "Share options (unapproved)"),
    ("emi", "EMI options"),
    ("csop", "CSOP options"),
    ("saye", "Sharesave (SAYE)"),
];

/// A share grant: what it is, how much, and when it vests. Money in GBP.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct Grant {
    pub label: String,
    pub kind: Kind,
    /// What the grant is worth at grant, or…
    pub value: Option<f64>,
    /// …how many shares (or options), at `price` each.
    pub shares: Option<f64>,
    /// The share price now (at grant).
    pub price: Option<f64>,
    /// What's paid for each share, for options.
    pub strike: f64,
    /// The market value of a share when the option was granted (EMI's
    /// discount is on it): `price`, unless said.
    pub grant_price: Option<f64>,
    /// Years it vests over.
    pub years: f64,
    /// Months from the start before the first shares vest: what's vested
    /// till then comes at once.
    pub cliff_months: f64,
    /// Months between vests (1 monthly, 3 quarterly, 12 yearly).
    pub every_months: f64,
    /// Readily convertible (listed, or soon to be): through PAYE, with NI.
    pub listed: bool,
    /// Months after the start it was granted (a refresher, say).
    pub starts_months: f64,
}

impl Default for Grant {
    fn default() -> Self {
        Grant {
            label: String::new(),
            kind: Kind::Rsu,
            value: None,
            shares: None,
            price: None,
            strike: 0.0,
            grant_price: None,
            years: 4.0,
            cliff_months: 0.0,
            every_months: 3.0,
            listed: true,
            starts_months: 0.0,
        }
    }
}

/// What vests in a year, and how it's taxed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
pub struct Vested {
    /// What the shares bring, sold (options: less what's paid for them).
    pub value: f64,
    /// Taxed through PAYE, with NI.
    pub taxed_ni: f64,
    /// Taxed, with no NI (not readily convertible: Self Assessment).
    pub taxed: f64,
}

impl Vested {
    fn add(&mut self, o: Vested) {
        self.value += o.value;
        self.taxed_ni += o.taxed_ni;
        self.taxed += o.taxed;
    }
}

fn positive(what: &str, v: f64) -> Result<f64> {
    if !v.is_finite() || !(0.0..=1_000_000_000.0).contains(&v) {
        return Err(invalid(format!("{what} should be from 0, not {v}")));
    }
    Ok(v)
}

impl Grant {
    /// Checks the grant can be worked out, and says what's odd about it.
    pub fn check(&self) -> Result<Vec<String>> {
        let name = if self.label.trim().is_empty() {
            "a grant".to_string()
        } else {
            format!("{:?}", self.label.trim())
        };
        if !(self.years > 0.0 && self.years <= 10.0) {
            return Err(invalid(format!("{name} should vest over 0 to 10 years")));
        }
        if !(self.every_months >= 1.0 && self.every_months <= 12.0) {
            return Err(invalid(format!("{name} should vest every 1 to 12 months")));
        }
        if !(0.0..=self.years * 12.0).contains(&self.cliff_months) {
            return Err(invalid(format!(
                "{name}'s cliff should be within its vesting"
            )));
        }
        for (what, v) in [
            ("value", self.value),
            ("shares", self.shares),
            ("share price", self.price),
            ("market value at grant", self.grant_price),
            ("strike price", Some(self.strike)),
        ] {
            if let Some(v) = v {
                positive(&format!("{name}'s {what}"), v)?;
            }
        }
        let option = self.kind != Kind::Rsu;
        if option && (self.shares.is_none() || self.price.is_none()) {
            return Err(invalid(format!(
                "{name} needs the number of options and the share price"
            )));
        }
        if !option && self.value.is_none() && (self.shares.is_none() || self.price.is_none()) {
            return Err(invalid(format!(
                "{name} needs its value, or its shares and their price"
            )));
        }
        let mut notes = Vec::new();
        let at_grant = self.shares.unwrap_or(0.0) * self.grant_price.or(self.price).unwrap_or(0.0);
        match self.kind {
            Kind::Csop if at_grant > 60_000.0 => notes.push(format!(
                "{name}: CSOP options are for up to £60,000 of shares, valued at grant"
            )),
            Kind::Emi if at_grant > 250_000.0 => notes.push(format!(
                "{name}: EMI options are for up to £250,000 of shares, valued at grant, in 3 years"
            )),
            Kind::Csop if self.years * 12.0 < 36.0 => notes.push(format!(
                "{name}: CSOP options bought less than 3 years after grant are taxed as unapproved ones"
            )),
            _ => {}
        }
        Ok(notes)
    }

    /// Shares (or options), and the price of one, at grant.
    fn count_and_price(&self) -> (f64, f64) {
        match (self.value, self.shares, self.price) {
            (_, Some(n), Some(p)) => (n, p),
            // By value alone: a share a pound, so its value moves with the price.
            (Some(v), _, _) => (v, 1.0),
            _ => (0.0, 0.0),
        }
    }

    /// When it vests, months from the start, and the share of it each time.
    pub fn tranches(&self) -> Vec<(f64, f64)> {
        let months = (self.years * 12.0).round();
        let every = self.every_months.round().max(1.0);
        let steps = (months / every).ceil() as usize;
        if steps == 0 {
            return Vec::new();
        }
        let part = 1.0 / steps as f64;
        let mut out: Vec<(f64, f64)> = Vec::new();
        let mut held = 0.0;
        for i in 1..=steps {
            let at = (i as f64 * every).min(months);
            if at < self.cliff_months {
                held += part;
                continue;
            }
            let at = if held > 0.0 {
                self.cliff_months.max(at)
            } else {
                at
            };
            out.push((at, part + held));
            held = 0.0;
        }
        out
    }

    /// What vests between `from` and `to` months after the start (from not
    /// included), with the share price growing by `growth` a year.
    pub fn vests(&self, from: f64, to: f64, growth: f64) -> Vested {
        let (count, price) = self.count_and_price();
        let grant_price = self.grant_price.unwrap_or(price);
        let mut out = Vested::default();
        for (at, part) in self.tranches() {
            // Months since the start, for the year it falls in; since the
            // grant, for its price and the CSOP's 3 years.
            let since_start = at + self.starts_months;
            if since_start <= from || since_start > to {
                continue;
            }
            let n = count * part;
            let now = price * (1.0 + growth).powf(at / 12.0);
            let spread = (now - self.strike).max(0.0);
            let (value, taxed) = match self.kind {
                Kind::Rsu => (n * now, n * now),
                Kind::Unapproved => (n * spread, n * spread),
                // Taxed only on a discount on the market value at grant.
                Kind::Emi => (n * spread, n * (grant_price - self.strike).max(0.0)),
                // Free of tax from 3 years after grant.
                Kind::Csop => (n * spread, if at >= 36.0 { 0.0 } else { n * spread }),
                Kind::Saye => (n * spread, 0.0),
            };
            out.add(if self.listed {
                Vested {
                    value,
                    taxed_ni: taxed,
                    taxed: 0.0,
                }
            } else {
                Vested {
                    value,
                    taxed_ni: 0.0,
                    taxed,
                }
            });
        }
        out
    }
}

/// What vests in year `year` (1 is the first 12 months from the start),
/// of all the grants, with the share price growing by `growth` a year.
pub fn year_vests(grants: &[Grant], year: u32, growth: f64) -> Vested {
    let mut out = Vested::default();
    for g in grants {
        out.add(g.vests(12.0 * f64::from(year - 1), 12.0 * f64::from(year), growth));
    }
    out
}

// ---- benefits in kind -----------------------------------------------------------------------

/// A company car available for private use.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct Car {
    /// Its list price, with options and VAT.
    pub list_price: f64,
    /// Accessories added after.
    pub accessories: f64,
    /// What you paid towards it (up to £5,000 counts).
    pub contribution: f64,
    /// CO2 emissions, g/km (0 for electric).
    pub co2: f64,
    /// Electric range, miles (for 1 to 50 g/km).
    pub electric_range: f64,
    /// Diesel, not to the RDE2 standard: 4% more.
    pub diesel: bool,
    /// Fuel for private journeys paid for by the employer.
    pub fuel: bool,
    /// What you pay a year for using it privately.
    pub payments: f64,
}

/// Benefits in kind, a year (money in GBP).
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct Benefits {
    pub car: Option<Car>,
    /// A company van available for private use, and fuel for it.
    pub van: bool,
    pub van_fuel: bool,
    /// Private medical insurance: what it costs the employer.
    pub medical: f64,
    /// A loan from your employer: how much, and the interest you pay (%).
    pub loan: f64,
    pub loan_rate: f64,
    /// Anything else, at its taxable value.
    pub other: f64,
}

/// What each benefit is worth to HMRC (its cash equivalent), a year.
#[derive(Debug, Clone, Default, Serialize)]
pub struct BenefitValues {
    pub car: f64,
    /// The car's appropriate percentage.
    pub car_percent: f64,
    pub car_fuel: f64,
    pub van: f64,
    pub van_fuel: f64,
    pub medical: f64,
    pub loan: f64,
    pub other: f64,
    pub total: f64,
}

/// A car's appropriate percentage, for its CO2 (g/km) and electric range
/// (miles), in a tax year (gov.uk's tables for 2025 to 2026, and 2026 to
/// 2027, when cars under 75g/km go up a point).
pub fn car_percent(y: &TaxYear, co2: f64, range: f64, diesel: bool) -> f64 {
    let co2 = co2.max(0.0).floor();
    let base = match co2 {
        0.0 => 3.0,
        c if c <= 50.0 => match range {
            r if r >= 130.0 => 3.0,
            r if r >= 70.0 => 6.0,
            r if r >= 40.0 => 9.0,
            r if r >= 30.0 => 13.0,
            _ => 15.0,
        },
        // 51-54 16%, a point more each 5g/km: 70-74 20%, 75-79 21%, …
        c => 16.0 + ((c - 50.0) / 5.0).floor(),
    };
    // From 2026 to 2027, a point more under 75g/km.
    let base = if co2 < 75.0 {
        base + y.car_low_extra
    } else {
        base
    };
    let diesel = if diesel { 4.0 } else { 0.0 };
    (base + diesel).min(37.0)
}

/// Benefits' cash equivalents for a tax year.
pub fn benefit_values(y: &TaxYear, b: &Benefits) -> Result<BenefitValues> {
    for (what, v) in [
        ("medical insurance", b.medical),
        ("the loan", b.loan),
        ("other benefits", b.other),
    ] {
        positive(what, v)?;
    }
    if !(0.0..=100.0).contains(&b.loan_rate) {
        return Err(invalid("the loan's interest should be a % from 0 to 100"));
    }
    let mut v = BenefitValues {
        medical: b.medical,
        other: b.other,
        ..Default::default()
    };
    if let Some(car) = &b.car {
        for (what, x) in [
            ("the car's list price", car.list_price),
            ("its accessories", car.accessories),
            ("what you paid towards it", car.contribution),
            ("its CO2", car.co2),
            ("its electric range", car.electric_range),
            ("what you pay for private use", car.payments),
        ] {
            positive(what, x)?;
        }
        let pct = car_percent(y, car.co2, car.electric_range, car.diesel) / 100.0;
        let price = car.list_price + car.accessories - car.contribution.min(5_000.0);
        v.car_percent = pct * 100.0;
        v.car = (price.max(0.0) * pct - car.payments).max(0.0);
        if car.fuel {
            v.car_fuel = y.fuel_multiplier * pct;
        }
    }
    if b.van {
        v.van = y.van_benefit;
        if b.van_fuel {
            v.van_fuel = y.van_fuel;
        }
    }
    // Loans of £10,000 or less are exempt.
    if b.loan > 10_000.0 {
        v.loan = b.loan * (y.official_rate - b.loan_rate / 100.0).max(0.0);
    }
    v.total = v.car + v.car_fuel + v.van + v.van_fuel + v.medical + v.loan + v.other;
    Ok(v)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::takehome::YEARS;

    fn year(id: &str) -> &'static TaxYear {
        YEARS.iter().find(|y| y.id == id).unwrap()
    }

    #[test]
    fn rsus_vest_quarterly_from_the_start() {
        // $300,000 over 4 years, quarterly, the first 3 months in: as an
        // offer at $1 = £0.748, £56,100 a year.
        let g = Grant {
            value: Some(300_000.0 * 0.748),
            ..Grant::default()
        };
        assert_eq!(g.tranches().len(), 16);
        assert_eq!(g.tranches()[0], (3.0, 1.0 / 16.0));
        for year in 1..=4 {
            let v = year_vests(std::slice::from_ref(&g), year, 0.0);
            assert!((v.value - 56_100.0).abs() < 0.01, "{year}: {v:?}");
            assert_eq!(v.taxed_ni, v.value);
        }
        assert_eq!(year_vests(std::slice::from_ref(&g), 5, 0.0).value, 0.0);
    }

    #[test]
    fn a_cliff_holds_back_what_vests_before_it() {
        // Monthly over 4 years, with a year's cliff: a quarter at 12 months.
        let g = Grant {
            value: Some(48_000.0),
            every_months: 1.0,
            cliff_months: 12.0,
            ..Grant::default()
        };
        let t = g.tranches();
        assert_eq!(t[0], (12.0, 12.0 / 48.0));
        assert_eq!(t.len(), 37);
        let first = g.vests(0.0, 12.0, 0.0);
        assert!((first.value - 12_000.0).abs() < 1e-6);
        // Growth: a year's 10% on the shares vesting at 12 months.
        let grown = g.vests(0.0, 12.0, 0.10);
        assert!((grown.value - 13_200.0).abs() < 1e-6);
    }

    #[test]
    fn options_are_taxed_by_scheme() {
        let opt = |kind, years, strike| Grant {
            kind,
            shares: Some(1_000.0),
            price: Some(10.0),
            strike,
            years,
            every_months: 12.0,
            ..Grant::default()
        };
        // Unapproved: the gain is taxed.
        let v = opt(Kind::Unapproved, 1.0, 4.0).vests(0.0, 12.0, 0.0);
        assert_eq!(v.value, 6_000.0);
        assert_eq!(v.taxed_ni, 6_000.0);
        // EMI at market value: nothing taxed; at a discount, the discount.
        let v = opt(Kind::Emi, 1.0, 10.0).vests(0.0, 12.0, 0.5);
        assert_eq!(v.value, 5_000.0);
        assert_eq!(v.taxed_ni, 0.0);
        let v = opt(Kind::Emi, 1.0, 8.0).vests(0.0, 12.0, 0.0);
        assert_eq!(v.taxed_ni, 2_000.0);
        // CSOP: taxed within 3 years, not from 3.
        let g = opt(Kind::Csop, 4.0, 4.0);
        assert_eq!(g.vests(0.0, 24.0, 0.0).taxed_ni, 3_000.0);
        assert_eq!(g.vests(24.0, 48.0, 0.0).taxed_ni, 0.0);
        assert_eq!(g.vests(24.0, 48.0, 0.0).value, 3_000.0);
        // Sharesave: never.
        assert_eq!(
            opt(Kind::Saye, 3.0, 4.0).vests(0.0, 36.0, 0.0).taxed_ni,
            0.0
        );
        // Not readily convertible: taxed, with no NI.
        let unlisted = Grant {
            listed: false,
            ..opt(Kind::Unapproved, 1.0, 4.0)
        };
        let v = unlisted.vests(0.0, 12.0, 0.0);
        assert_eq!((v.taxed_ni, v.taxed), (0.0, 6_000.0));
    }

    #[test]
    fn grants_are_checked() {
        assert!(Grant::default().check().is_err());
        assert!(
            Grant {
                kind: Kind::Emi,
                value: Some(1.0),
                ..Grant::default()
            }
            .check()
            .is_err()
        );
        let big = Grant {
            kind: Kind::Csop,
            shares: Some(10_000.0),
            price: Some(10.0),
            ..Grant::default()
        };
        assert_eq!(big.check().unwrap().len(), 1);
    }

    #[test]
    fn a_cars_appropriate_percentage() {
        let y25 = year("2025-26");
        let y26 = year("2026-27");
        assert_eq!(car_percent(y25, 0.0, 0.0, false), 3.0);
        assert_eq!(car_percent(y26, 0.0, 0.0, false), 4.0);
        assert_eq!(car_percent(y25, 30.0, 135.0, false), 3.0);
        assert_eq!(car_percent(y25, 30.0, 50.0, false), 9.0);
        assert_eq!(car_percent(y26, 30.0, 20.0, false), 16.0);
        assert_eq!(car_percent(y25, 52.0, 0.0, false), 16.0);
        assert_eq!(car_percent(y25, 72.0, 0.0, false), 20.0);
        assert_eq!(car_percent(y26, 72.0, 0.0, false), 21.0);
        // From 75g/km, the same both years.
        assert_eq!(car_percent(y25, 77.0, 0.0, false), 21.0);
        assert_eq!(car_percent(y26, 77.0, 0.0, false), 21.0);
        assert_eq!(car_percent(y25, 120.0, 0.0, false), 30.0);
        assert_eq!(car_percent(y25, 155.0, 0.0, false), 37.0);
        assert_eq!(car_percent(y25, 220.0, 0.0, false), 37.0);
        // Diesel: 4% more, to 37%.
        assert_eq!(car_percent(y25, 120.0, 0.0, true), 34.0);
        assert_eq!(car_percent(y25, 150.0, 0.0, true), 37.0);
    }

    #[test]
    fn benefits_cash_equivalents() {
        let y = year("2026-27");
        let b = Benefits {
            car: Some(Car {
                list_price: 40_000.0,
                contribution: 7_000.0,
                co2: 120.0,
                fuel: true,
                ..Car::default()
            }),
            van: true,
            van_fuel: true,
            medical: 1_200.0,
            loan: 20_000.0,
            loan_rate: 1.0,
            ..Benefits::default()
        };
        let v = benefit_values(y, &b).unwrap();
        // (£40,000 less £5,000) at 30%; fuel £29,200 at 30%.
        assert_eq!(v.car_percent, 30.0);
        assert!((v.car - 10_500.0).abs() < 1e-6);
        assert!((v.car_fuel - 8_760.0).abs() < 1e-6);
        assert_eq!((v.van, v.van_fuel), (4_170.0, 798.0));
        // 2.75% of £20,000 not paid.
        assert!((v.loan - 550.0).abs() < 1e-6);
        assert!((v.total - (10_500.0 + 8_760.0 + 4_170.0 + 798.0 + 1_200.0 + 550.0)).abs() < 1e-6);
        // A loan of £10,000 or less is exempt.
        let small = Benefits {
            loan: 10_000.0,
            ..Benefits::default()
        };
        assert_eq!(benefit_values(y, &small).unwrap().loan, 0.0);
    }
}
