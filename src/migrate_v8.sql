-- Schema 7 to 8: names every database accepts. MySQL reserves BLOB and KEY,
-- so the table of file contents and the settings' key column are renamed;
-- the references to the table follow it.
ALTER TABLE blob RENAME TO stored_file;
ALTER TABLE setting RENAME COLUMN key TO name;
