-- Schema 3 to 4: company logos, and pay in GBP.
--
-- A logo is a file like any other, kept in `blob` by hash. An application's
-- pay is also kept in GBP, converted once when the pay or its currency is
-- set, at the day's rate; the rate and its date are kept with it. Rates
-- are cached per currency in `fx_rate`.

ALTER TABLE company ADD COLUMN logo TEXT REFERENCES blob(sha256);
ALTER TABLE company ADD COLUMN logo_type TEXT;

ALTER TABLE application ADD COLUMN salary_min_gbp INTEGER;
ALTER TABLE application ADD COLUMN salary_max_gbp INTEGER;
ALTER TABLE application ADD COLUMN gbp_rate REAL;
ALTER TABLE application ADD COLUMN gbp_rate_on TEXT;

CREATE TABLE fx_rate (
    currency   TEXT PRIMARY KEY,
    rate       REAL NOT NULL,
    rate_on    TEXT NOT NULL,
    fetched_at TEXT NOT NULL
);
