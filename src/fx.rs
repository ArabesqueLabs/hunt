//! Pay in GBP.
//!
//! An application's pay is converted to GBP once, when its amounts or
//! currency are set, at that day's rate; the result is stored with the rate
//! and its date, so views never convert and figures don't drift. Rates come
//! from the European Central Bank's daily reference rates, through
//! frankfurter.dev (no key needed), and are cached per currency for the day.
//!
//! Fetching a rate never happens while the database is held: callers make
//! sure today's rate is cached ([`ensure_rate`]) before they write.

use std::sync::Mutex;

use serde_json::Value;

use crate::args;
use crate::db::Db;
use crate::error::{Error, Result};
use crate::time;

const RATES: &str = "https://api.frankfurter.dev/v1/latest";

/// A currency as stored: a three-letter code, from what people type.
pub fn normalize_currency(s: &str) -> Option<String> {
    let t = s.trim();
    let code = match t {
        "£" | "GB£" => "GBP",
        "$" | "US$" | "USD$" => "USD",
        "€" => "EUR",
        "C$" | "CA$" => "CAD",
        "A$" | "AU$" => "AUD",
        "CHF" | "Fr." => "CHF",
        "¥" => "JPY",
        "₹" => "INR",
        _ => "",
    };
    if !code.is_empty() {
        return Some(code.into());
    }
    let up = t.to_uppercase();
    (up.len() == 3 && up.bytes().all(|b| b.is_ascii_alphabetic())).then_some(up)
}

/// Today's rate from `currency` to GBP, and the date it's for.
pub fn fetch_rate(currency: &str) -> Result<(f64, String)> {
    let j: Value = crate::lookup::get_json(&format!("{RATES}?base={currency}&symbols=GBP"))
        .map_err(|e| Error::Fetch(format!("no exchange rate for {currency}: {e}")))?;
    let rate = j["rates"]["GBP"]
        .as_f64()
        .ok_or_else(|| Error::Fetch(format!("no exchange rate for {currency}")))?;
    let on = j["date"].as_str().unwrap_or_default().to_string();
    Ok((rate, on))
}

/// Make sure today's rate for `currency` is cached, fetching it if not (or
/// if `force`). The database is only held to read and store the rate.
pub fn ensure_rate(db: &Mutex<Db>, currency: &str, force: bool) -> Result<()> {
    let Some(cur) = normalize_currency(currency).filter(|c| c != "GBP") else {
        return Ok(());
    };
    let fresh = {
        let db = db.lock().unwrap_or_else(|e| e.into_inner());
        db.rate_is_fresh(&cur)?
    };
    if fresh && !force {
        return Ok(());
    }
    let (rate, on) = fetch_rate(&cur)?;
    let db = db.lock().unwrap_or_else(|e| e.into_inner());
    db.store_rate(&cur, rate, &on)
}

/// Fill in GBP for applications that have pay but no conversion yet, e.g.
/// after an upgrade, or when a rate couldn't be had at the time.
pub fn backfill(db: &Mutex<Db>) -> Result<usize> {
    let currencies = {
        let db = db.lock().unwrap_or_else(|e| e.into_inner());
        db.currencies_unconverted()?
    };
    let mut done = 0;
    for cur in currencies {
        if ensure_rate(db, &cur, false).is_err() {
            continue;
        }
        let db = db.lock().unwrap_or_else(|e| e.into_inner());
        done += db.convert_unconverted(&cur)?;
    }
    Ok(done)
}

impl Db {
    fn rate_is_fresh(&self, currency: &str) -> Result<bool> {
        let today = time::date(self.clock().date());
        let fetched = self.text(
            "SELECT fetched_at FROM fx_rate WHERE currency = ?1",
            args![currency],
        )?;
        Ok(fetched.is_some_and(|f| f.starts_with(&today)))
    }

    /// Keep a rate to GBP for today: what [`ensure_rate`] fetched (or a test chose).
    pub fn store_rate(&self, currency: &str, rate: f64, on: &str) -> Result<()> {
        self.exec(
            "INSERT INTO fx_rate (currency, rate, rate_on, fetched_at) VALUES (?1, ?2, ?3, ?4) \
             ON CONFLICT (currency) DO UPDATE SET rate = ?2, rate_on = ?3, fetched_at = ?4",
            args![currency, rate, on, self.stamp()],
        )?;
        Ok(())
    }

    /// The cached rate to GBP for a currency, and the date it's for.
    pub fn cached_rate(&self, currency: &str) -> Result<Option<(f64, String)>> {
        Ok(self
            .query(
                "SELECT rate, rate_on FROM fx_rate WHERE currency = ?1",
                args![currency],
            )?
            .pop()
            .and_then(|r| Some((r["rate"].as_f64()?, r["rate_on"].as_str()?.to_string()))))
    }

    /// Work out an application's pay in GBP from its amounts and currency,
    /// at the cached rate. No pay, an unknown currency, or no rate: no GBP.
    pub fn convert_gbp(&self, application_id: i64) -> Result<()> {
        let row = self
            .query(
                "SELECT salary_min, salary_max, currency FROM application WHERE id = ?1",
                args![application_id],
            )?
            .pop()
            .unwrap_or_default();
        let (min, max, currency) = (
            row.get("salary_min").and_then(serde_json::Value::as_i64),
            row.get("salary_max").and_then(serde_json::Value::as_i64),
            row.get("currency")
                .and_then(serde_json::Value::as_str)
                .map(String::from),
        );
        let today = time::date(self.clock().date());
        let rate = match currency.as_deref().and_then(normalize_currency) {
            _ if min.is_none() && max.is_none() => None,
            Some(c) if c == "GBP" => Some((1.0, today)),
            Some(c) => self.cached_rate(&c)?,
            None => None,
        };
        let gbp = |v: Option<i64>| {
            rate.as_ref()
                .and_then(|(r, _)| v.map(|v| (v as f64 * r).round() as i64))
        };
        self.exec(
            "UPDATE application SET salary_min_gbp = ?1, salary_max_gbp = ?2, gbp_rate = ?3, gbp_rate_on = ?4 \
             WHERE id = ?5",
            args![
                gbp(min),
                gbp(max),
                rate.as_ref().map(|(r, _)| *r),
                rate.as_ref().map(|(_, on)| on.clone()),
                application_id
            ],
        )?;
        Ok(())
    }

    /// Currencies of applications with pay but no GBP figure.
    fn currencies_unconverted(&self) -> Result<Vec<String>> {
        Ok(self
            .query(
                "SELECT DISTINCT currency FROM application WHERE currency IS NOT NULL \
                 AND (salary_min IS NOT NULL OR salary_max IS NOT NULL) AND gbp_rate IS NULL",
                &[],
            )?
            .into_iter()
            .filter_map(|r| r["currency"].as_str().and_then(normalize_currency))
            .collect())
    }

    fn convert_unconverted(&self, currency: &str) -> Result<usize> {
        let ids: Vec<i64> = self
            .query(
                "SELECT id, currency FROM application WHERE gbp_rate IS NULL \
                 AND (salary_min IS NOT NULL OR salary_max IS NOT NULL)",
                &[],
            )?
            .into_iter()
            .filter(|r| {
                r["currency"]
                    .as_str()
                    .and_then(normalize_currency)
                    .as_deref()
                    == Some(currency)
            })
            .filter_map(|r| r["id"].as_i64())
            .collect();
        for id in &ids {
            self.convert_gbp(*id)?;
        }
        Ok(ids.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn currencies() {
        assert_eq!(normalize_currency("£").as_deref(), Some("GBP"));
        assert_eq!(normalize_currency(" usd ").as_deref(), Some("USD"));
        assert_eq!(normalize_currency("€").as_deref(), Some("EUR"));
        assert_eq!(normalize_currency("dollars"), None);
    }
}
