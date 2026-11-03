-- Schema 4 to 5: more about people, as their LinkedIn profile says, and a
-- photo kept like a company's logo.

ALTER TABLE person ADD COLUMN linkedin TEXT;
ALTER TABLE person ADD COLUMN location TEXT;
ALTER TABLE person ADD COLUMN about TEXT;
ALTER TABLE person ADD COLUMN photo TEXT REFERENCES blob(sha256);
ALTER TABLE person ADD COLUMN photo_type TEXT;
