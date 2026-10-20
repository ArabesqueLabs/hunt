# hunt

Track a job search as a board of hiring processes.

hunt is free software, under the [GNU AGPL v3](LICENSE): run it yourself,
for yourself or for others. It's a product of
[Arabesque Labs](https://arabesquelabs.com), who also run it for people who'd
rather not host it themselves.

To try it on your own machine, with Docker or with Rust, then open
http://localhost:4848:

```sh
docker run -p 4848:4848 -v hunt-data:/data ghcr.io/arabesquelabs/hunt
cargo install --git https://github.com/ArabesqueLabs/hunt && hunt serve
```

One person's hunt has no sign-in of its own: keep it on your machine, or
put it behind something that has one (see "What's public, and what needs
signing in", below). To work on hunt itself:

`hunt serve` runs one service. It owns the database (SQLite, PostgreSQL or
MySQL) and serves a JSON API, plus a web UI that uses that API. The rest of the `hunt` commands use
the same API, so the CLI and the browser always agree.

```sh
make serve                      # http://127.0.0.1:4848, database ~/.hunt/hunt.db, for several people (as dev-tenants)
make dev                        # the same, with a throwaway database in target/
make demo                       # fill that throwaway database with demo data (replacing it)
make watch                      # serve it for several people, rebuilding and restarting on every change
make                            # every target: build, release, test, lint, fmt, ci, install…
```

## The database

`--db` (or `HUNT_DB`, or `make serve DB=…`) says which:

```sh
hunt serve --db ~/.hunt/hunt.db                              # SQLite, a file (the default)
hunt serve --db postgres://hunt:secret@localhost/hunt        # PostgreSQL (12 or later)
hunt serve --db mysql://hunt:secret@localhost:3306/hunt      # MySQL (8.0.16 or later)
```

- **The database must be empty, or hunt's.** An empty one gets hunt's
  tables on first start; for PostgreSQL and MySQL, make the database first
  (`CREATE DATABASE hunt`).
- **Upgrades:** SQLite databases are upgraded in place when a newer hunt
  opens them. PostgreSQL and MySQL ones start at the current schema; to
  carry one across a schema change, back it up with the hunt that made it
  and import the backup into a new database.
- **Connections:** PostgreSQL and MySQL are reached without TLS, so use
  them on the same machine or a private network.
- **Tests:** `make db-up` starts both servers in Docker; `make test-all`
  runs the API tests on SQLite, PostgreSQL and MySQL.

## In a container, or on Kubernetes

`Dockerfile` builds a small image (no shell, runs as a non-root user). It
listens on :4848, keeps SQLite in `/data` (mount a volume there), and
answers `/healthz` once its database does. `HUNT_DB` can name PostgreSQL or
MySQL instead.

```sh
docker build --platform linux/amd64 -t hunt .
docker run -p 4848:4848 -v hunt-data:/data hunt
```

The `image` workflow (`.github/workflows/image.yml`) runs `make ci`, then
publishes `ghcr.io/arabesquelabs/hunt` (`latest` from main, `v<version>`,
and each commit's sha), so you needn't build it yourself. With Docker
Compose:

```yaml
services:
  hunt:
    image: ghcr.io/arabesquelabs/hunt:latest
    ports: ["4848:4848"]
    volumes: ["hunt-data:/data"]
    restart: unless-stopped
volumes:
  hunt-data:
```

Builds reuse what they can. The Dockerfile builds hunt's dependencies in a
layer of their own, from [cargo-chef](https://github.com/LukeMathWalker/cargo-chef)'s
recipe (what hunt depends on, without its own version), and the workflow
keeps layers in GitHub's Actions cache. A code change or a release (a new
version) only compiles hunt itself; changing the dependencies compiles
them again. The cache holds 10 GB per repository, so an occasional full
build after old entries are evicted is expected.

On Kubernetes, hunt is one pod with one volume. Only one copy can run at
a time, since SQLite is a file on that volume, so updates replace the pod
rather than rolling. Run the CLI against it through a port-forward
(`kubectl -n hunt port-forward svc/hunt 4848`, then
`HUNT_URL=http://127.0.0.1:4848`).

### What's public, and what needs signing in

The dashboard lives under **`/app`**, and its data under **`/api`**: those
are the only parts that need signing in. Everything else is public: the
home page (`/`), these docs (`/docs`), the privacy notice, terms
and data deletion page, their Arabic versions under `/ar/`,
and the fonts, scripts and logo. Old addresses (`/board`, `/companies/3`)
lead to the same page under `/app`.

So behind Cloudflare Access, protect only those two: give the Access
application two destinations, `hunt.example.com/app` and
`hunt.example.com/api`, rather than the whole hostname. In a shared hunt,
hunt also checks Access's signed token on every request for data, so a
mistake in Access's setup doesn't open anyone's data.

hunt has no sign-in of its own; put one in front of it. Behind Cloudflare
Access, the sidebar has **Log out** (ending the Access session), and
the admin centre's Debugging info has the identity Access holds for you and
the Zero Trust dashboard, with hunt's own health check, calendar feed,
backup, source and image builds. Behind Cloudflare
Access, the CLI uses a service token: set `HUNT_ACCESS_CLIENT_ID` and
`HUNT_ACCESS_CLIENT_SECRET` to its id and secret, and `HUNT_URL` to the
public address. The "Send to hunt" bookmarklet opens hunt in a tab, so it
signs in like any other visit.

## Backups

Settings → **Backup and import**, or `hunt backup` and `hunt restore`.

- **What's in one:** a single JSON file with everything (processes,
  applications, companies, people, files, tags, settings and the change
  log). The Gmail connection is left out, so no password or sign-in is
  ever in a backup.
- **Moving between databases:** a backup works with any of them, so it
  also moves data from one to another, such as SQLite to PostgreSQL.
- **Importing:**
  - replaces everything, all or nothing: a backup that doesn't fit leaves
    things as they were;
  - says what the file holds and asks first;
  - only takes backups at the current schema version.

## The web UI

- **Tracking Board**, in two views (the switch at the top; it opens as you
  left it):
  - **Board** (`/app`): see below.
  - **Table** (`/app/applications`): every application, with its stage and
    whether it's active, archived or not on the board; pay in GBP,
    location, mode, source, when applied and last changed, and tags. Sort
    by any column; open one by its row.

  **Filters**, shared by both views: words (company, role, location,
  source, tags, people), needs attention (an interview within 7 days, or
  unchanged for 14+), work mode, pay (a GBP-a-year minimum, other
  currencies converted and other periods annualised; "Known pay only" drops
  those without), and source; under "More filters", company, person,
  added or applied in the last 7/30/90 days, closing soon, location,
  employment, archive reason, has emails/files/people (or nothing), status
  and tag. They're in the address (`/app?mode=remote&pay=120000`), so a
  filtered view can be bookmarked and Back undoes a change; they carry over
  between views and are remembered. "Clear filters" and the count of what's
  shown appear whenever any is on.
- **Board.** One column per stage; columns grow with their cards. Cards are
  compact (role and company) or detailed, by the Detailed switch at the
  end of the filters' row. Drag
  cards between columns or within one.
  "+ Add a process" at the foot of a column adds one straight into it:
  - paste the job posting's link, and what it says fills in the role,
    company, location, work mode, pay, dates and posting text;
  - or give just the company (it autocompletes, and offers to create one it
    doesn't know), the role and the source.
- **A posting already tracked** is flagged when you paste its link, or set
  it on an application: the warning names the application and where its
  processes are. Links match however they were copied (tracking parameters,
  `www.`, LinkedIn's `?currentJobId=`). It's a warning only; you can still
  add it, as when applying again.
- **Job postings** are read from Ashby, Greenhouse, Lever, Workable,
  LinkedIn, Apple Careers and levels.fyi (`levels.fyi/jobs?jobId=…`; its
  `/jobs/view/…` pages are LinkedIn's jobs, read from LinkedIn), and from any careers page that describes its jobs in schema.org
  `JobPosting` data, as most job boards do. A pay range written in the text
  ("$180,000 – $220,000") counts when the posting gives none as data. An
  existing application can import its posting too ("Import from link…"),
  choosing what to take.
- **More than one posting**: the same job is often posted in several
  places (the careers page, LinkedIn, an agency). An application's own
  link is its main posting; "+ Add a posting link" adds others, each kept
  with its own text and when it was last read (`hunt list postings`). A
  link is read as soon as it's added, as is a posting link changed in
  Edit. "Import from link…" (or "Refresh all") reads every link at once,
  and each one's Refresh just that one. What they say is shown side by
  side, one choice per field: what's there now, or one link's, with ≠
  where the links disagree. What's there is kept unless it's empty, until
  you choose otherwise; each link's text is kept for that link. A link
  another application has, as either kind of posting, is warned about.
- **Many at once.** Select processes in the table (a checkbox per row,
  one in the header for every row shown, shift-click for a run), or on the
  board (Ctrl/⌘-click a card, or press x on it; Escape lets go). A bar
  then offers: Move to (a stage, or a lane of it), Archive… (one reason
  and note for all), Resume, Add tag…, Remove tag…, Next action… and
  Delete…. Dragging a selected card on the board brings the others along
  (into a column, a lane, or the archive). Each change is all or nothing,
  logged on each process, and a toast offers Undo. Companies, People and
  Files take the same checkboxes, to tag, untag or delete together.
  `POST /api/processes/bulk` does it for the API, and the CLI takes
  several processes at once: `hunt move globex,initech screening`,
  `hunt archive tag:agency role-filled`, `hunt move stage:Applied
  interviewing`.
- **An offer accepted**: on an application at its offer (the Offer stage,
  or the last), "🎉 Accept the offer…" moves it to the stage's Accepted
  lane, with a note (a start date, say). Accepting isn't an ending:
  references, checks and the start may still be ahead, so it stays on the
  board until it's closed as "I started the job" (a stage without an
  Accepted lane closes it as that straight away). Then the other open
  processes are wrapped up, each as chosen: closed (as withdrawn, noting
  the offer), kept open with a reminder for tomorrow to tell the recruiter
  (the default from Screening on), or left as they are; or all at once. From then on the
  home page celebrates the offer: the role, pay and note, and below, how
  the search went (days from the first application to a yes, applications,
  companies, interviews, people, offers), and the people on the process, to
  thank. "Back to the board" returns the board to the home page (in this
  browser); "Your offer" in the sidebar shows the celebration again.
- **Hiding a stage**: the eye on a column's header hides that stage from
  the board; hidden stages are listed above the columns, with their
  counts, to show again (one by one, or all). Remembered in this browser;
  their cards still count, and still show in the table.
- **Swimlanes**: the board's rows, top to bottom, each with stages (its
  columns) in it. A new hunt has two: Active Processes and Terminated
  Processes. Add, rename, reorder or remove them in Settings → Board, and
  choose each stage's swimlane there (a stage in none is in the first).
  Each folds to its header and count; its Folded switch says how it
  starts (open, unless switched on), and opening or folding it on the
  board is remembered in this browser.
- **Sub stages**: a stage's column can be divided, top to bottom. A new
  hunt has three, each a wait worth telling apart without a column of its
  own: Preparing (under Considering), Waiting on a decision (Interviewing)
  and Accepted (Offer). Add, rename or remove them in Settings → Board,
  where each stage's sub stages are listed indented under it. Drop a card
  into one, or choose it on the card's page; cards in none stay at the
  column's top, and a card moved to another stage leaves its sub stage.
  The table shows "Offer · Shortlisted"; `hunt move acme offer --lane
  shortlisted` from the command line (the API and the CLI call them lanes).
  A sub stage can be its stage's default (its Default switch): a card going
  into the stage without one said (Move to, a new application, the CLI,
  Reopen) goes there; one dropped on the column's top stays at the top.
- **Closing is a stage.** A stage can be a terminal stage (Settings →
  Board). A process in a terminal stage is closed, and the sub stage it's
  in says why: a new hunt has three terminal stages, in Terminated
  Processes, whose sub stages are the reasons: My Decision (I withdrew, I
  declined the offer … I started the job), Their Decision (They rejected
  me, Role filled …) and Paused / Stopped (On hold, They went silent …).
  Add a reason as a sub stage, or another terminal stage; make any stage
  terminal, and what's in it closes, not terminal again and it opens. A
  closed process keeps the last stage it reached before ("Got to
  Interviewing"), which Stats and Cycles count it at. Drop a card on a
  reason to close it for that; drag it back onto another column to reopen
  it, or Reopen it from its page: back to the stage it reached.
- **Folding**: a column's cards, or a sub stage's, fold into a pile with
  the chevron on its header: blank cards saying how many ("3 cards"), or a
  dashed "Empty". A column folded all through is one pile, its sub stages
  in it; clicking a pile unfolds it. A stage's Folded switch (Settings → Board) says how its cards
  start: unfolded, but folded for the terminal stages a hunt starts with.
  A sub stage's starts as its stage's, until its own Folded switch is set.
- **An application** has a page of its own (`/app/applications/ID`): a card
  on the board and a row in Applications both open it. It reads first, top
  to bottom:
  - its stage (a stepper), and whether it's archived;
  - the role: location, work mode and employment first, then pay (in GBP
    first, with the original currency and rate beneath; bonus and
    equity), then the posting link, source and when you applied;
  - the timeline: interview steps (when, format, with whom, notes) and
    what happened, in date order. "With whom" picks people from People, or
    takes a new name, which becomes a person (at the application's company)
    when the page is saved; reading, their names link to them;
  - your notes;
  - About the job: its postings, each laid out like an email (where it's
    from, when it was posted and closes, or last read, then headings,
    lists and links in its own box; Open ↗, Refresh, and Remove for all
    but the main one);
  - people, with their email and phone to click (to write or call);
    emails, as threads (by Gmail's thread, or by subject), folded until
    opened, each message with its time; files sent;
  - the company, folded until opened, and the change log;
  - tags, then Import from link…, Archive… and Delete at the bottom.

  Every section folds from its header, and stays as you left it. Reading,
  the page shows no forms: "+ Add a person", "+ Add an email" and
  "+ Send a file" open theirs, and "+ Add a step", "+ Add an event" or
  "+ Add a note" start editing there. **Edit** turns the page into one form: change
  anything, move the stage, add or remove steps and timeline entries, then
  **Save changes** (⌘S) or **Discard**. Leaving with unsaved changes asks
  first. People, emails and files are saved as soon as they're added or
  taken off, in either mode.
- **Applications, Companies, People**: searchable lists; every record opens
  for editing, with its own change log.
- **Importing a company or person**: "Import from link…" on a new
  company or person, on their page, or in a process's Company panel.
  - It reads the company's site or LinkedIn page for its name, website,
    LinkedIn page, industry, size, headquarters, year founded and
    description. A levels.fyi company page (`levels.fyi/companies/stripe`)
    works too.
  - It shows what it found next to what's there. Empty fields are ticked;
    filled ones are kept unless you tick them.
  - Nothing is saved until you choose.
  - LinkedIn sometimes refuses pages without a sign-in. When it does, it
    says so; use the company's own site instead.
- **People from LinkedIn**: profiles need a sign-in, so hunt reads them
  from your browser. Drag "Send to hunt" from Settings → LinkedIn to your
  bookmarks bar; on someone's profile, click it. hunt opens with their name,
  role, company, location, about and photo to choose from, and updates
  whoever already has that profile instead of adding them twice. Someone of
  the same name, added by hand or under another link, is asked about,
  merged into, or left alone, as Settings say; Settings also hold the
  address the bookmark opens hunt at, for when that isn't this page's. The
  bookmark only collects the page's text; hunt reads it, so a change to
  LinkedIn's pages needs a hunt update, not a new bookmark.
- **Files**: documents and their versions. A document is a resume, cover
  letter, portfolio, reference, certificate or transcript, screenshot, job
  description, take-home assignment, offer, contract, NDA, background
  check, right to work or ID, candidate resource, feedback or other; the list filters by kind, and a new file's
  kind is guessed from its name.
  - Drop files anywhere on the page, or choose them (the drop zone is
    under the list): a file named like a
    document becomes its next version, and anything else becomes a new
    document, its kind guessed from the name.
  - Drop on a row to add a version to that document.
  - A document shows its versions beside a preview: PDFs in the browser's
    viewer, images, and text. Other kinds offer a download.
  - Tag versions ("rust-focused"), and see which processes each was sent
    with. A process records which versions went with it, and previews them
    too.
- **Email**: each process keeps the emails about it. In its Emails panel,
  drop `.eml` files (Gmail: ⋮ → Download message), choose them, or paste
  a message (Gmail: ⋮ → Show original → Copy to clipboard; pasting the
  whole page works too). Each shows who, when, the subject and the start of
  it, opens to the whole text, and links to it in Gmail. Cards count them.
  (Gmail sign-in and sync, matching mail to processes on their own, are
  built but switched off for now: `GMAIL` in `src/web/app.js`.)
- **Notes**: general notes, about the search rather than one application
  (what you want next, questions to ask): searchable, taggable, edited in
  place.
- **Calendar** (`/app/calendar`): interviews and application deadlines of
  active processes, by month, week, day or as an agenda, searched by
  company, role or title. The week and the day run midnight to midnight,
  each event at its time; the hours outside your working hours are
  hatched, and other time zones' hours can run beside yours (both in
  Settings → Calendar, which the icon by the search opens). Interviews
  already held are quieter, and cancelled ones are left out; a deadline
  shows until you apply. "Weekends" shows or hides Saturdays and Sundays.
  A key under the calendar says what its colours mean. The view and the
  weekend choice are in the address (`/app/calendar?view=week&weekends=hide`),
  so Back undoes a change, and are remembered.
- **Stats** (Interview stats): a dashboard of the search: what's coming
  up first, then active applications, how far they got through the stages,
  what was added and how many interviews each week, why processes ended,
  which sources get furthest, how they'd work, pay on the table (in the home
  currency), how long things take, activity day by day, what's gone quiet,
  and the records kept, table by table. Every chart's numbers are also a
  table. Under **System resources**, what hunt uses of its machine,
  refreshed every 5 seconds while the page is open: memory (against the
  container's limit, on Linux), CPU now and on average, load, the
  database's size and stored files, and the free space on its disk
  (SQLite) (`GET /api/system`). "Up for" counts across restarts and
  rollouts: hunt keeps a heartbeat each minute in its database, and a start
  less than 15 minutes after the last one carries the uptime on.
- **Addresses** are real paths (`/app/applications/2`, `/app/stats`): Back and
  Forward work, and pages can be bookmarked. Old `/#/…` links still work.
- **Pages for everything**: companies (`/app/companies/3`), people and
  documents open in their own pages, made like an application's: they read
  first, and Edit turns the details into a form saved with "Save changes"
  or discarded. Related things are in folding sections (a company's
  applications and people, a document's versions), then the Audit Log. Tags
  and whole-record actions (import, logo or photo, delete) are at the
  bottom. New companies, people and documents have pages too
  (`/app/companies/new`); only a new application opens over the page. A file's
  link opens its document's page at that version.
- **Tags** go on applications, companies, people and documents: "+ Add
  tag" at the bottom of each page, choosing an existing tag or typing a new
  one. Cards show their application's tags
  when detailed; the board and the lists filter by tag.
- **Settings**, in groups that fold (remembered). Sections read first; a
  section's Edit, or a row's edit, remove or "+ Add …", opens it for
  changes.
  - Appearance: the theme (kept per browser), and language and region:
    the language (English or Arabic; see Languages below), the region
    dates and numbers are written for, which digits numbers use, 24- or
    12-hour times, and the home currency. Pay is still converted to GBP and kept that way; it's shown
    in the home currency through today's rate from GBP (fetched when it's
    chosen, and when hunt starts).
  - Board: Swimlanes, and Stages and sub stages, each stage with its sub
    stages indented under it, its swimlane, and its Terminal stage and
    Folded switches: add, rename, reorder and remove. The terminal ones'
    sub stages are the reasons for closing. A stage in use asks where its
    processes go; a sub stage removed leaves its cards in the stage (closed
    for no reason given, in a terminal one).
  - Tags: add, rename, colour and remove.
  - Calendar: your time zone, the day weeks start on, working hours (from,
    to, and which days), up to three other time zones, and Calendar
    sharing (a private link for calendar apps).
  - Backup and import.
  - LinkedIn bookmarklet (folded at first): the bookmark, the address it
    opens, and what to do about a name already here.
- **Listings** (companies, people, files, and the Tracking Board's table)
  end each row with edit (its page, opened in Edit mode: `?edit=1`) and
  remove; a company or person with a LinkedIn link also has refresh. Every
  column but the first has an eye in its header that hides it; hidden ones
  are listed above the table, to show again (one by one, or all), and each
  table remembers its own.
- **A company's page** lists its applications, each with its stage (that
  of its newest active process, or else its newest, archived, and why) and
  its tags; then the people there.
- **Refresh from LinkedIn**: a company or person with a LinkedIn link has
  it in place of "Import…" (and as refresh in the listings), reading that
  link again. LinkedIn keeps most
  profiles from anyone not signed in; then it offers to open the profile,
  for the "Send to hunt" bookmark.
- **Activity**: every change, newest first.

The sidebar holds the sections, with Settings (and Log out, behind
Cloudflare Access) and hunt's version at its foot, linked to its release on
GitHub (the `v…` tag).

## Several people (multi-user)

One hunt can serve several people, each seeing and changing only their own
applications, companies, people, files, notes, tags and settings. They
share one database: every row carries its owner, and every request runs as
the account it comes from (`src/scope.rs` scopes each statement to the
account's rows, so nothing has to remember to). Turning it on keeps what's
there: it becomes the first admin's.

```sh
hunt serve --tenants --admins you@example.com,other-admin@example.com \
  --access-team yourteam --access-aud <the Access application's AUD tag>
# or HUNT_TENANTS=1 HUNT_ADMINS=… HUNT_ACCESS_TEAM=… HUNT_ACCESS_AUD=…
```

- **Signing in** is Cloudflare Access's job: it signs people in with
  GitHub, LinkedIn (or any login method set up there) and hands hunt a
  signed token, which hunt checks against the team's keys and the
  application's audience tag. A request that didn't come through Access
  can't pass for anyone. For others to ask for an account, the Access
  application's policy has to let them in: Include → Login Methods →
  GitHub and LinkedIn (anyone signed in with one), rather than your email.
- **The early access list**: asking for an account is framed as joining
  an early access list, with no dates or promises. Someone new, signed
  in, sees only "Join the early access list": their name and, optionally,
  what brings them to hunt. Until an admin lets them in, they see that
  they're on the list; if they're turned down, they can join again.
- **The admin centre** (/admin, for admins): the early access list, to let
  people in or turn them down (with a note), and every account: its status, role (make
  another admin), applications, when last seen, and its CLI token; disable,
  enable, or remove it (with everything of theirs, if chosen); and a
  switch for whether new people may ask for an account at all (closed,
  they're told the list is closed for now; accounts already here carry
  on). Its Debugging info has links to hand: your Cloudflare Access
  identity and Log out, the health check, calendar feed, backup and API,
  and the source and image builds.
  It's under Settings in the sidebar. Admins also see System resources
  on Stats; others don't. The admins named in
  `HUNT_ADMINS` are admins whenever hunt starts; the first is account 1.
- **The CLI** signs in with an Access service token, which has no email:
  set its Client ID as the account's CLI token in the admin centre, and the
  CLI acts as that account.
- **Backups** from older versions of hunt (schema 8 on) import too, in
  either mode. **Backups** are each account's own: a backup holds its rows (and only the
  files they use), and importing one replaces only that account's, with
  new ids so they can't collide with anyone else's.
- Gmail sync is for one person's hunt only, for now.
- **Trying it out locally**: `make dev-tenants` (or `make watch`)
  serves `target/dev.db` for several people, with `ADMINS` (by default
  admin@example.test) as admins. There's no Cloudflare Access, so who's
  asking is taken on trust (`--identity-header X-Hunt-User`): in a browser,
  open `/dev/as?email=admin@example.test` to be the admin, or any other
  email to be someone new asking for an account; `/dev/as` alone signs
  out. Never run it like this where others can reach hunt.

## Take-home pay (UK)

In the sidebar, marked Experimental: for those who say they live in the UK
(Settings → Location); anyone else is asked to. A salary can also bring a
target bonus (with your and the company's multipliers), a sign-on bonus,
share grants (RSUs, unapproved, EMI, CSOP and Sharesave options, vesting
over the years, taxed as gov.uk says), benefits in kind (a company car and
fuel, a van, medical insurance, a loan) and a projection year by year
(`src/equity.rs`). Pay information first: the gross pay offered or the take-home pay wanted; as an employee (PAYE), a contractor inside or outside IR35, or all three side by side; and the amount, its currency and pay period (hourly to annually). It works out what's left of a salary after income tax, National Insurance, student loans and pension (salary sacrifice, net pay or relief at source), by year, month, week and day; and of a contractor's rate (by the hour, day, week, month or year) inside IR35 (through an umbrella company) and outside it (through your own limited company: salary, corporation tax, dividends), side by side, each with the salary it's like. Or the other way round: from the take-home pay you want, the salary, or the rate either side of IR35, that leaves it. Pay can be typed in another currency, turned to pounds at the day's rate. An application that gives its pay shows what its range would leave, a month, with a link to work it out. Collapsed sections for a tax code (1257L, K codes, BR, D0, NT…), with the code the figures would give recommended as HMRC works one out (gov.uk's tax codes guidance and PAYE Manual), and the Marriage Allowance, student loans, a workplace pension (yours and your employer's), the State Pension age, Child Benefit and its High Income charge, other salary sacrifice (Cycle to Work, an electric car), and Gift Aid and payroll giving. Results are set against the take-home pay you want (Settings → Desired net take-home pay), which working back starts from. England, Wales and Northern Ireland, or Scotland; the 2025/26 and 2026/27 tax years (`src/takehome.rs`).

## Experiments

Features still being tried out are off unless turned on when hunt starts,
and then only for the accounts named (`--experiment name=you@example.com`,
or `HUNT_EXPERIMENTS`). There are none now; `take-home` has become a
feature, and is still taken, so a server started with it keeps starting.

## Running hunt for others: privacy notice, terms and the footer

Every page ends with a footer saying who made hunt, and linking to its
source (`HUNT_SOURCE_URL`, if you've changed hunt: the AGPL asks a service
people use over a network to offer them its source).

Running hunt for other people, you're responsible for their data, and the
law (in the UK and EU, at least) asks for a privacy notice, terms and your
company's details. Say who you are, and hunt carries them:

| Setting | |
|---|---|
| `HUNT_LEGAL_COMPANY` | the registered name (e.g. `Arabesque Labs Ltd`): setting it turns the rest on |
| `HUNT_LEGAL_NUMBER` | the company number (needed) |
| `HUNT_LEGAL_OFFICE` | the registered office's address (needed) |
| `HUNT_LEGAL_EMAIL` | where people write to about their data (needed) |
| `HUNT_LEGAL_REGISTERED_IN` | `England and Wales` unless said |
| `HUNT_LEGAL_SHORT_NAME` | the name without "Ltd", unless said |
| `HUNT_LEGAL_HOSTING` | where the servers are, for the privacy notice (e.g. `the United Kingdom`) |

On the Arabic pages, the usual places (`England and Wales`, `the United
Kingdom` and others) are in Arabic, and any other as written.

Then:

- **`/privacy`**: the privacy notice (UK GDPR, EU GDPR): who's responsible,
  what hunt keeps and why, sign-in providers, cookies and storage (`#cookies`),
  who else processes data, transfers, how long it's kept, rights and the
  ICO.
- **`/terms`**: the terms of use (for consumers, under the law of England
  and Wales), covering your service, not the code.
- **`/data-deletion`**: how to delete your data: yourself, in Settings →
  Your account (anyone in a shared hunt can, except its last admin), or by
  asking. Facebook's sign-in asks for this page, and the privacy notice,
  by address.
- **The footer** links to both, and shows the company's registered name,
  number and office, as UK law asks of a company's website.
- **Asking for an account** needs agreeing to the terms. Which version, and
  when, is kept with the account, and shown to admins (`agreed_terms`).

Each has an Arabic version under `/ar/` (`/ar/privacy`, `/ar/terms`,
`/ar/data-deletion`), which says it's a translation and that the English
text governs.

The text is Arabesque Labs' own, in `src/web/legal/` (the Arabic in
`src/web/legal/ar/`): have it checked for
your service before relying on it. Both pages need no sign-in, so people can
read them before signing up: with Cloudflare Access protecting only
`/app` and `/api` (see above), they are.

## The logo

`docs/logo/` has hunt's logo as PNGs, for other apps and profiles: in the
app's colours on its light or dark background (`logo-light-SIZE.png`,
`logo-dark-SIZE.png`), on a transparent background (`logo-SIZE.png`), from
16 to 1024 pixels, and padded for profile pictures that crop to a circle
(`avatar-light-SIZE.png`, `avatar-dark-SIZE.png`). `make logo` draws them
again from `src/web/img/logo.svg`.

## Languages

The web UI speaks English and Arabic (Settings → General → Language and
region). English, the default, reads left to right; Arabic reads right to
left: the sidebar moves to the right, the board's columns run right to
left, and everything mirrors with them. The page is served already set to
the language chosen, so it's drawn the right way round from the start.

The public site (the home page, Screenshots, these docs and the legal
pages) has an Arabic version under `/ar/`, linked from the header's
"العربية", and "English" back. These docs in Arabic are `README.ar.md`:
keep it up to date with `README.md`.

- **What's translated**: hunt's own words: menus, buttons, headings, forms,
  messages and the choices the service offers (stages, reasons, kinds).
  What people wrote stays as written: names, postings, emails, notes,
  tags, and the change log's sentences (the service writes those, in
  English). The default stage names are translated where they're shown,
  and stay as they are in the database. The CLI speaks English.
- **Region**: how dates, times and numbers are written. Left on its
  default, it follows the language (Arabic month and day names, say).
- **Numbers**: the language's own digits (Arabic-Indic, ٠١٢٣, for Arabic),
  or always Western (0123) or Arabic-Indic. Addresses, emails and version
  numbers keep theirs. Amounts (£85k–100k/yr) read left to right inside
  Arabic text.
- **Time zone** (Settings → Calendar): what "today" and "now" are, for hunt and for the page:
  when things were added, what's overdue, the calendar. Left empty, it's
  the machine hunt runs on (a container is usually UTC). With one chosen,
  the calendar feed gives its times in it (`TZID`).

### Adding a language

1. Copy `src/web/i18n-ar.js` to `src/web/i18n-<code>.js`, change its
   code, name, direction (`ltr` or `rtl`) and digits, and translate each
   phrase. Patterns fill `{names}` with the parts that vary; `{n}`, `{m}`,
   `{n1}` … match numbers only. A phrase left out shows in English.
2. Add it to `LANGUAGES` in `src/service.rs`, serve it next to
   `/i18n-ar.js` in `src/api.rs`, and load it in `src/web/index.html`
   after `i18n.js`.

The page is translated as it's drawn (`src/web/i18n.js`): the code writes
English, and each text, placeholder, title, aria-label and alt found in
the catalog is swapped for its translation. Anything inside
`translate="no"`, or in the user-content list there, is left alone.

## The CLI

Every command but `serve` talks to the service (`--url`, or `$HUNT_URL`;
default `http://127.0.0.1:4848`). A process can be named by id or by a word
that picks it out (`acme`). Dates can be friendly: `tomorrow`, `+3d`, `-1w`,
`fri 15:00`, `10-30`, `2026-10-30`.

```sh
hunt                                        # the board
hunt add --link https://jobs.ashbyhq.com/acme/1234 -s applied   # read the posting
hunt add Acme -r "Staff Engineer" -s applied --source referral --applied -3d
hunt add TikTok --next "reply to recruiter" --due "fri 10:00"
hunt move acme interviewing                 # --top to put it first
hunt step acme "system design" --at "fri 15:00"
hunt person acme "Sam Lee" --role hiring-manager
hunt note acme "asked about the team's on-call"
hunt next acme "send availability" --due tomorrow
hunt archive tiktok role-closed -n "hiring freeze till November"
hunt archive acme role-filled -n "went with an internal candidate"
hunt resume acme screening
hunt show acme                              # everything, with its change log
hunt board --all                            # every archived process, not just the last 30 days

hunt upload Resume cv.pdf --tag rust-focused   # the next version (the document is made if new)
hunt attach acme resume                     # sent its latest version with acme (--version N)
hunt detach acme 7                          # take version #7 off
hunt download 7 -o ~/Desktop/cv.pdf

hunt lookup ashbyhq.com                     # what a company's site (or LinkedIn page) says
hunt lookup linkedin.com/company/ashbyhq --save   # add it, or fill in what it's missing

hunt mail list acme                         # a process's emails; `hunt mail show 12` reads one
hunt mail import acme ~/Downloads/offer.eml
pbpaste | hunt mail import acme -           # after Gmail's Show original → Copy to clipboard
hunt mail rm 12

hunt tag applications 4 +remote "dream job" -fintech   # add and remove tags; no changes shows them
hunt list applications --where tag=remote

hunt backup                                 # everything, to hunt-backup-<date>.json (-o to choose)
hunt restore hunt-backup-2026-10-06.json    # replace everything with it (asks; --yes not to)

hunt list applications -q rust              # any resource: stages, companies, people,
hunt get companies 3                        #   applications, processes, steps, notes,
                                            #   documents, versions, lanes, tags
hunt edit applications 4 location=London salary_min=150k currency=GBP work_mode=remote
hunt new people name="Pat Chen" company_id=acme title=Recruiter
hunt rm stages 6 --move-to applied
hunt list reasons                           # the reasons for closing: the terminal stages' lanes
hunt new lanes stage_id=their name="Salary too low"    # another reason
hunt edit stages 3 active=0                 # terminal: what's in it closes
hunt new swimlanes name="On hold"           # another row of the board
hunt order considering applied screening interviewing offer
hunt fields applications                    # what each resource has
hunt log processes 12                       # the change log
```

More in [`docs/design.md`](docs/design.md).

## Contributing

Issues and pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md),
and [SECURITY.md](SECURITY.md) to report a vulnerability privately.

## License

hunt is free software: you can redistribute it and/or modify it under the
terms of the [GNU Affero General Public License, version 3](LICENSE). If you
run a changed copy for others over a network, offer them its source too.

The names "hunt" and "Arabesque Labs", and their logos (`docs/logo/`,
`src/web/img/`), aren't covered by the license: please don't use them to
name or brand your copy without Arabesque Labs' written permission. The
bundled fonts (Jost, Newsreader, IBM Plex Sans Arabic and Amiri) are under
the SIL Open Font License 1.1: each one's licence and copyright are in
`src/web/fonts/` (see its README).

---

hunt is a product of [Arabesque Labs](https://arabesquelabs.com).
