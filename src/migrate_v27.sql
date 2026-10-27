-- Schema 26 to 27 (SQLite): a role's own reference (a requisition or job
-- ID, as the employer names it), on an application and on each of its
-- other postings, so roles with the same title can be told apart.
ALTER TABLE application ADD COLUMN reference TEXT;
ALTER TABLE posting ADD COLUMN reference TEXT;
