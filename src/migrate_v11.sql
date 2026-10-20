-- Schema 10 to 11 (SQLite): general notes, about the search rather than one
-- application. migrate_v11_postgres.sql and migrate_v11_mysql.sql do the
-- same for those databases.
CREATE TABLE memo (
    id         INTEGER PRIMARY KEY,
    title      TEXT,
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
