-- Schema 28 to 29 (SQLite): a posting link's name, as kept links have, for
-- an application's own link (`url_label`) and each of its other postings.
ALTER TABLE application ADD COLUMN url_label TEXT;
ALTER TABLE posting ADD COLUMN label TEXT;
