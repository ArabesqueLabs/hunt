# Your data

Everything hunt tracks is in one database you run, and it keeps a record
of every change made to it.

## The database

SQLite, a single file, unless you say otherwise; or PostgreSQL or MySQL.
hunt makes its tables when it starts, and a newer hunt upgrades a SQLite
database in place. See [The database](../../README.md#the-database).

## The change log

Every change is logged: what was created, changed, moved or deleted, when,
and from what to what. A process's timeline shows its own changes, and
those to its application and company; the Audit Log (Settings → Data) has
them all, newest first. The log outlives what it describes, so a deleted
record's history stays.

## Backups

A backup is one JSON file with everything: processes, applications,
companies, people, files, tags, settings and the change log. It works with
any database hunt can use, so it's also how to move from one to another.
Importing one replaces everything, all or nothing.

Some things stay with the machine and aren't backed up: the Gmail
connection, the password, the calendar's private link, and whether hunt
has been set up. See [Backups](../../README.md#backups).
