//! Local dates and times, as the text the database stores.
//!
//! - a date is `YYYY-MM-DD`
//! - a datetime is `YYYY-MM-DDTHH:MM`, what `<input type="datetime-local">` sends
//! - a stamp is `YYYY-MM-DDTHH:MM:SS`, for created/updated/activity times
//!
//! The API takes only those forms. The CLI also takes friendlier ones
//! (`tomorrow`, `+3d`, `fri 15:00`) and turns them into those with [`parse_when`].

use jiff::civil::{Date, DateTime, Time, Weekday};

use crate::error::{Result, invalid};

pub fn now() -> DateTime {
    jiff::Zoned::now().datetime()
}

pub fn stamp(t: DateTime) -> String {
    t.strftime("%Y-%m-%dT%H:%M:%S").to_string()
}

pub fn date(d: Date) -> String {
    d.strftime("%Y-%m-%d").to_string()
}

pub fn datetime(t: DateTime) -> String {
    t.strftime("%Y-%m-%dT%H:%M").to_string()
}

/// Check and normalise a date sent to the API.
pub fn check_date(s: &str) -> Result<String> {
    s.parse::<Date>()
        .map(date)
        .map_err(|_| invalid(format!("not a date (YYYY-MM-DD): {s:?}")))
}

/// Check and normalise a datetime sent to the API. A bare date means
/// midnight; seconds are dropped; a space may stand in for the `T`.
pub fn check_datetime(s: &str) -> Result<String> {
    let s = s.trim().replacen(' ', "T", 1);
    if let Ok(t) = s.parse::<DateTime>() {
        return Ok(datetime(t));
    }
    if let Ok(d) = s.parse::<Date>() {
        return Ok(datetime(d.to_datetime(Time::midnight())));
    }
    Err(invalid(format!(
        "not a date and time (YYYY-MM-DDTHH:MM): {s:?}"
    )))
}

/// Read a friendly date or time, relative to `now`:
/// `now`, `today`, `tomorrow`, `yesterday`, `+3d`, `-2w`, `fri`, `10-09`,
/// `2026-10-09`, each optionally followed by `HH:MM`; or a full
/// `2026-10-09T15:00`. Without a time, the result is a date only.
pub fn parse_when(s: &str, now: DateTime) -> Result<When> {
    let s = s.trim().to_lowercase();
    let bad = || {
        invalid(format!(
            "can't read {s:?} as a date; try tomorrow, +3d, fri 15:00, 2026-10-09"
        ))
    };
    if s == "now" {
        return Ok(When::At(now));
    }
    if let Ok(t) = s.replacen(' ', "T", 1).parse::<DateTime>() {
        return Ok(When::At(t));
    }
    let (day, time) = match s.rsplit_once(' ') {
        Some((d, t)) if t.contains(':') => (d.trim(), Some(t)),
        _ if s.contains(':') && !s.contains('-') => ("today", Some(s.as_str())),
        _ => (s.as_str(), None),
    };
    let today = now.date();
    let d = match day {
        "today" => today,
        "tomorrow" => today.tomorrow().map_err(|_| bad())?,
        "yesterday" => today.yesterday().map_err(|_| bad())?,
        _ if day.starts_with('+') || day.starts_with('-') => {
            let sign: i64 = if day.starts_with('-') { -1 } else { 1 };
            let body = &day[1..];
            let (n, unit) = body.split_at(body.len().saturating_sub(1));
            let n: i64 = n.parse().map_err(|_| bad())?;
            let days = match unit {
                "d" => n,
                "w" => n * 7,
                _ => return Err(bad()),
            };
            today
                .checked_add(jiff::Span::new().days(sign * days))
                .map_err(|_| bad())?
        }
        _ => {
            if let Some(w) = weekday(day) {
                // The next such day, a week ahead if it's today.
                let mut d = today.tomorrow().map_err(|_| bad())?;
                while d.weekday() != w {
                    d = d.tomorrow().map_err(|_| bad())?;
                }
                d
            } else if let Ok(d) = day.parse::<Date>() {
                d
            } else if let Ok(d) = format!("{}-{day}", today.year()).parse::<Date>() {
                d
            } else {
                return Err(bad());
            }
        }
    };
    match time {
        None => Ok(When::Day(d)),
        Some(t) => {
            let t = format!("{t}:00")
                .parse::<Time>()
                .or_else(|_| t.parse::<Time>())
                .map_err(|_| bad())?;
            Ok(When::At(d.to_datetime(t)))
        }
    }
}

/// A friendly date, read: a whole day, or a moment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum When {
    Day(Date),
    At(DateTime),
}

impl When {
    pub fn as_date(self) -> String {
        match self {
            When::Day(d) => date(d),
            When::At(t) => date(t.date()),
        }
    }

    /// A day alone means the start of it.
    pub fn as_datetime(self) -> String {
        match self {
            When::Day(d) => datetime(d.to_datetime(Time::midnight())),
            When::At(t) => datetime(t),
        }
    }
}

fn weekday(s: &str) -> Option<Weekday> {
    Some(match s.get(..3)? {
        "mon" => Weekday::Monday,
        "tue" => Weekday::Tuesday,
        "wed" => Weekday::Wednesday,
        "thu" => Weekday::Thursday,
        "fri" => Weekday::Friday,
        "sat" => Weekday::Saturday,
        "sun" => Weekday::Sunday,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use jiff::civil::date as d;

    #[test]
    fn friendly_dates() {
        // A Tuesday.
        let now = d(2026, 10, 6).at(14, 30, 0, 0);
        let day = |s: &str| parse_when(s, now).unwrap().as_date();
        let at = |s: &str| parse_when(s, now).unwrap().as_datetime();
        assert_eq!(day("tomorrow"), "2026-10-07");
        assert_eq!(day("+3d"), "2026-10-09");
        assert_eq!(day("-1w"), "2026-09-29");
        assert_eq!(day("fri"), "2026-10-09");
        assert_eq!(day("tue"), "2026-10-13", "a week ahead, not today");
        assert_eq!(day("10-30"), "2026-10-30");
        assert_eq!(at("fri 15:00"), "2026-10-09T15:00");
        assert_eq!(at("2026-11-02 09:30"), "2026-11-02T09:30");
        assert_eq!(at("16:00"), "2026-10-06T16:00");
        assert_eq!(at("now"), "2026-10-06T14:30");
        assert!(parse_when("someday", now).is_err());
    }

    #[test]
    fn api_forms() {
        assert_eq!(
            check_datetime("2026-10-09 15:00:12").unwrap(),
            "2026-10-09T15:00"
        );
        assert_eq!(check_datetime("2026-10-09").unwrap(), "2026-10-09T00:00");
        assert!(check_datetime("fri").is_err());
        assert_eq!(check_date("2026-10-09").unwrap(), "2026-10-09");
        assert!(check_date("10/09/2026").is_err());
    }
}
