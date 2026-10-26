# Settings, tags and listings

How hunt looks and works, the tags on everything, and the lists' columns.

## Settings

Settings are yours: kept with your account, so they're the same on every
device you sign in on. General, Calendar, and Pay and tax are changed
where they are: each setting is saved as it's changed (a field, once it's
left or on Enter; Escape puts it back), and says so, with Undo.

Undo is offered for a change, a move or a removal, for 5 seconds (or as
long as Admin → General says); adding something is said, without Undo.

- **Appearance:** the theme (light, dark, or matching the system; also in
  the sidebar's foot), and language and region:
  the language (English or Arabic; see
  [Languages](../../README.md#languages)), the region dates and numbers are
  written for, which digits numbers use, 24- or 12-hour times, and the home
  currency. Pay is still converted to GBP and kept that way; it's shown in
  the home currency through today's rate from GBP (fetched when it's
  chosen, and when hunt starts).
- **Board:** Swimlanes, and Stages and sub stages, each stage with its sub
  stages indented under it, its swimlane, and its Terminal stage and
  Folded switches: add, rename, reorder and remove. The terminal ones' sub
  stages are the reasons for closing. A stage in use asks where its
  processes go; a sub stage removed leaves its cards in the stage (closed
  for no reason given, in a terminal one).
- **Tags:** add, rename, colour and remove.
- **Calendar:** your time zone, the day weeks start on, working hours
  (from, to, and which days), up to three other time zones, and Calendar
  sharing (a private link for calendar apps).
- **Pay and tax:** whether you live in the UK, and which part (for
  take-home pay), and the take-home pay you want, a week, month or year.
- **Backup and import.**
- **LinkedIn bookmarklet** (folded at first): the bookmark, the address it
  opens, and what to do about a name already here.
- **Account:** your account: change your email address or password (with
  the one now; a new password ends your other sessions), Log out, and
  delete it, with everything in it. Behind Cloudflare Access or a sign-in
  proxy, you sign in there instead.

A new hunt asks for the first of these in its launcher, before the board
(unless it's restored from a backup, which brings them): its owner, the
region, time zone, currency and the rest of Language and region, whether
you live in the UK, and the theme.

## Admin

This hunt's admins have **Admin** in the sidebar, under Settings: its
owner (who set it up: account 1) to begin with, and whoever they make
admins.

- **General:** this hunt's name (in the sidebar and the browser's tab), a
  notice above every page, an address people can write to for help, how
  long Undo is offered after a change (5 seconds unless changed, at most
  60; 0 keeps it until it's used or closed), and what new accounts start
  with.
- **Access and accounts:** whether new people may sign up (closed, on a new
  hunt), inviting someone, those waiting to be let in, and every account:
  its status and role, disabling or removing it.
- **User stats:** how each account uses hunt (by number, not name).
- **System resources:** what hunt uses of its machine, refreshed every 5
  seconds while the page is open (`GET /api/system`): memory (against the
  container's limit, on Linux), CPU now and on average, and load; the
  database's size and stored files, and the free space on its disk
  (SQLite); the records it keeps, table by table; and what each account
  takes of it. "Up for" counts across restarts and rollouts: hunt keeps a
  heartbeat each minute in its database, and a start less than 15 minutes
  after the last one carries the uptime on.
- **Debugging info:** this hunt's version, how people sign in, and its
  accounts; then the health check, the calendar feed, a backup, the API,
  and the source and image builds.

More in [Several people](../../README.md#several-people-multi-user).

## Tags

Tags go on applications, companies, people and documents: "+ Add tag" at
the bottom of each page, choosing an existing tag or typing a new one.
Cards show their application's tags when detailed; the board and the
lists filter by tag.

## Listings

Companies, people, files, and the Applications table:

- Each row ends with edit (its page, opened in Edit mode: `?edit=1`) and
  remove; a company or person with a LinkedIn link also has refresh.
- Every column but the first has an eye in its header that hides it.
  Hidden ones are listed above the table, to show again (one by one, or
  all), and each table remembers its own.

## Activity

Every change, newest first.
