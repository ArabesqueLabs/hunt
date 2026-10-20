# Design

## Shape

```
hunt serve ─┬─ /api/*      JSON API  (src/api.rs)
            └─ /, app.js   web UI    (src/web/), a client of /api
hunt <cmd>  ─── HTTP ──►   /api/*    (src/cli.rs via src/client.rs)
```

One process owns the database. The web UI and the CLI are both API
clients, so a rule lives in one place: the service.

```
src/
  schema.sql      tables (version 3); comments say what each is for
  migrate_v2.sql  version 1 to 2
  migrate_v3.sql  version 2 to 3: more about companies
  resource.rs     each resource's fields: name, label, kind, required, fixed
  db.rs           open, version and upgrade the file; generic
                  list/get/create/update/delete; the change log
  service.rs      the board, moving cards, adding a process with its
                  application and company, people on a process, stages
  files.rs        uploading versions, reading files, files sent with a process
  lookup.rs       reading a company's website or LinkedIn page; fetching pages
  posting.rs      reading a job posting from its link
  api.rs          routes; errors as {"error": "..."} with 404/409/422
  client.rs       the API client the CLI uses
  cli.rs          the `hunt` command
  time.rs         stored date forms; friendly dates for the CLI
  web/            index.html, app.js, style.css, compiled into the binary
tests/            api.rs (through the router), cli.rs (the binary against a live
                  service), fixtures/schema_v1.sql (for the upgrade test)
```

## Model

| Resource | What it is |
|---|---|
| **swimlane** | A row of the board, ordered by position, with stages in it; `folded`: it starts folded to its heading. Managed in Settings. |
| **stage** | A stage, ordered by position, in a swimlane (none: the first); active, or not (`active` 0: a terminal stage, where closed processes are). `folded`: its cards start as packs. Managed in Settings. |
| **lane** | A stage divided, top to bottom: a sub stage, as the UI says. A terminal stage's lanes are the reasons for closing; `value` is hunt's code for one (rejected, accepted …). `folded`: its cards start as a pack (1) or not (0); none, as its stage's. `is_default`: the stage's default, one at most: a process going into the stage with no lane said goes there (a move with `top` stays at the column's top). |
| **company** | An employer or a recruitment agency, with its website, LinkedIn page, industry, size, headquarters, year founded and description. Names are unique, case aside. |
| **person** | A recruiter, hiring manager, interviewer or referrer, optionally at a company. |
| **application** | An opening I'm applying to, or might: a role at a company, with its posting. `via` points at the application it came through (a recruiter's may bring several). |
| **cycle** | A job search: Autumn 2026, or Remote, Europe. Several can run at once. One that has ended (`ended_on`, with how: an offer, a break, stopped) keeps its board as it was. |
| **process** | Pursuing an application: the card. It has a cycle, a stage (and lane) and a position, the last active stage it reached, and when I applied. Its status (active or archived, i.e. closed) and reason follow from its stage and lane. Usually one per application; another if I apply again later, or bring it back into a new cycle. |
| **reminder** | Something to do for a process, by a date: chase, send references. Done once `done_at` is set. (It was the process's next action.) |
| **link** | A link kept with an application: its candidate portal, prep material, an interview's invite. |
| **prep_item** | Something to read, practise or rehearse: for a process (one of its steps, even), or in general. A daily one keeps a streak. |
| **story** | A story from work for behavioural questions: situation, task, action and result. |
| **process_person** | Who is involved in a process, and as what. |
| **step** | An interview step: title, when, how long, where (a joining link or an address), what to prepare, status (scheduled, done and waiting, done, passed, failed, cancelled). |
| **note** | Free text on a process. |
| **document** | A resume, cover letter, portfolio or reference. |
| **version** | An uploaded file of a document: numbered, tagged, with a note. The file itself never changes. |
| **process_file** | Which versions went with which process. |
| **activity** | The change log. |

The application's posting fields follow schema.org
[`JobPosting`](https://schema.org/JobPosting) where it has one: employment
type, a salary range with currency and pay period, and the posted and
closing dates. A free-text comp note sits alongside for "£150k + equity".
The process plays the part of an ATS `Application`, with a status and
timestamps. No standard exists for candidate-side tracking, so nothing here
is meant to interoperate.

Cycles are the waves of looking. The board shows the running cycles (all,
or one), and an ended one's board can be looked at, read-only. Companies,
people, stories, tags and settings are shared by every cycle.

## Editing and the change log

Every resource is an ordinary, editable record. The service writes each
create, update, move and delete to `activity`:

- `summary`: a sentence ("Moved Acme — SRE from Applied to Interviewing")
- `changes`: JSON `{field: [old, new]}`; on delete, the whole record
- `process_id`: which process timeline the change belongs on

`activity` has no foreign keys, so it outlives what it describes. A
process's timeline also includes changes to its application and company.
Reordering cards within a column isn't logged; moving between columns is.

This replaces an earlier design with an append-only event log and derived
status. Being able to set and correct things directly turned out to matter
more. The change log keeps the history that the event log was for.

## Rules the service keeps

- **Closing is a move.** A process in an inactive stage is closed
  (`status` archived), its lane's code being why (`archive_reason`: the
  lane's `value`, or `lane-` and its id); `reached_stage_id` keeps the last
  active stage it was in, so Closed, Stats and Cycles can say how far it
  got. Closing the older way, `status` archived with an `archive_reason`
  (a code or a name), moves it to that lane; `status` active moves it back
  to the stage it reached. A stage made inactive closes what's in it; made
  active, opens it. The board keeps one active stage.
- **Moving** (`POST /processes/{id}/move {stage_id, lane_id, index}`)
  renumbers that column; to an active stage it opens the process, to an
  inactive one it closes it. Changing `stage_id` with a `PATCH`
  puts the card at the bottom of its new column.
- **What a record belongs to is fixed** once it's made: a process's
  application, a step's or note's process, a version's document. Sending the
  same value back is fine; changing it is refused.
- **Deleting:**
  - A stage that still holds processes needs `move_to`, and the board keeps
    at least one stage.
  - A company with applications can't be deleted.
  - Deleting an application deletes its processes (and their steps, notes,
    people and file links).
  - A version that was sent with a process can't be deleted until it's
    taken off. A file's contents go once no version uses them.
- **Input is checked against the field descriptions:**
  - Enums take their value or label, case aside.
  - References must exist.
  - Numbers take `150k`.
  - Dates are `YYYY-MM-DD`; datetimes are local `YYYY-MM-DDTHH:MM`.
  - `""` or `null` clears a field; a required field can't be cleared.
  - An unknown field is an error.
- **Cycles:** a process goes into the running cycle started last unless it
  names one (with none running, one is started). A process in an ended
  cycle can't be moved, archived or changed, and none can be added to one.
  Ending a cycle (`POST /cycles/{id}/end`) with an offer moves that process
  to the last stage (its Accepted lane, if it has one), marks the cycle's
  open reminders done and closes their prep. Starting one
  (`POST /cycles/start`) can bring back processes of ended cycles, as new
  processes of the same applications.
- **Adding a process** takes either `application_id`, or the application's
  fields with `company` (a name: reused case-insensitively, or created) or
  `company_id`.

## Files

- **Uploading:** `POST /api/documents/{id}/versions?filename=&tag=&note=`
  takes the file as the request body, up to 25 MB. The content type comes
  from the request header, or else from the file's extension.
- **Storage:** contents live in the database, in `blob`, keyed by SHA-256,
  so the same file uploaded twice is stored once and a backup is still one
  file.
- **Reading:** `GET /api/versions/{id}/file` serves it inline, so the UI can
  preview it; `?download=1` makes it an attachment. Files are served from
  the app's own origin, so anything that could run script (HTML, SVG, and
  every type other than PDF and PNG/JPEG/GIF/WebP) gets
  `Content-Security-Policy: sandbox`: no scripts, and an origin of its own.
- **Previews:** PDFs use the browser's viewer in a frame, images an `<img>`,
  and text a `<pre>`. Word files and the like can't be previewed without a
  converter, so they offer a download.
- **Taking files in:** files dropped on the Files page each become the next
  version of the document with the same name (case aside), or a new
  document whose kind is guessed from the file name.

## Importing a company's details

`POST /api/companies/lookup {url}` fetches a company's website or LinkedIn
page and reads it in this order:

1. schema.org `Organization` data (JSON-LD, which many sites embed for
   search engines), including inside `@graph`
2. Open Graph and meta tags
3. the page title, minus "Home", "| LinkedIn" and the like
4. on LinkedIn, the public company page's "About" details (`about-us__…`)

A company's own site usually links its LinkedIn page, and LinkedIn names
the company's site, so either one often yields both.

- **Nothing is saved.** The UI shows what was found beside what's there, and
  saves what's ticked. `hunt lookup --save` adds the company, or fills in
  only an existing company's empty fields.
- **The fetch** runs on a worker thread, not holding the database. It has a
  15-second limit and reads at most 5 MB. It sends a browser's user agent,
  as some sites turn others away. Redirects are followed one by one, so a
  redirect's own body (malformed on some servers) is never read.
- **When it can't:** a page that isn't HTML, an error status, or a page with
  nothing about a company comes back as 502 with the reason. LinkedIn
  sometimes refuses pages without a sign-in (status 999, or a redirect to
  its sign-in wall). That's reported as such, suggesting the company's own
  site. Some sites block automated requests outright (Cloudflare and
  similar).

## Importing a job posting

`POST /api/applications/lookup {url}` reads a posting and answers in the
shape of an application. The company comes as `company` (a name),
`company_website` and `company_linkedin`. `POST /api/applications` and
`POST /api/processes` take those keys as they are: the company is matched
by name or made, and its website and LinkedIn page are filled in if it has
none.

| Link | Read from |
|---|---|
| `boards.greenhouse.io/{board}/jobs/{id}`, `job-boards.greenhouse.io/…`, the `embed/job_app?for=&token=` form | Greenhouse's job board API, with `pay_transparency=true` for pay ranges; the work mode from its "Location Type" field |
| `jobs.lever.co/{company}/{id}` (and `jobs.eu.lever.co`) | the page's `JobPosting` data, then Lever's postings API for the workplace type and any salary range |
| `apply.workable.com/{account}/j/{code}` | Workable's job and account APIs: the company's name and website come from the account |
| `linkedin.com/jobs/view/{id}`, a slug ending in the id, or `?currentJobId=` | LinkedIn's public job view (`jobs-guest`), as shown to people not signed in |
| `jobs.apple.com/{locale}/details/{id}/…` | the job data Apple's page hands its scripts (`window.__staticRouterHydrationData`): summary, description, qualifications, locations, and the pay range from its "Pay & Benefits" footer |
| anything else: Ashby, SmartRecruiters, Workday, careers pages | the page's `JobPosting` JSON-LD; failing that, its title, site name and description |

Then, from the text:
- **Work mode:** from the title or location ("Remote - EU",
  "London (Hybrid)"), or from plain phrases in the description ("hybrid, 2
  days in the office", "fully remote"). Not from words like "hybrid cloud".
- **Pay:** a range in the description ("$180,000 - $220,000 USD per year",
  "£85k–£100k", "€60.000 – €75.000"), when the posting gave none as data.

Descriptions become plain text, keeping paragraphs and bullets, up to 20,000
characters.

**The same posting twice.** `GET /api/applications/same-posting?url=`
lists the applications whose posting link is that one, each with its
processes. The UI warns when a link is pasted or set, and `hunt add --link`
warns too. Nothing is refused: applying again is legitimate. Links are
compared in a canonical form (`posting::canonical`):
- the platform's own id where there is one (Greenhouse board and job,
  Lever, Workable, LinkedIn job id, Apple job number);
- otherwise the address lowercased, without scheme, `www.`, fragment,
  trailing slash, and tracking parameters (`utm_*`, `gh_src`, `trk`, `ref`,
  …).

## The database file

- **Location:** default `~/.hunt/hunt.db` (`--db`, `$HUNT_DB`).
- **A new file** starts with the stages Considering, Applied, Screening,
  Interviewing, Offer.
- **Ownership:** the file is marked with `PRAGMA application_id` and a
  schema version. `hunt serve` refuses any file it didn't make rather than
  touch it.
- **Upgrades:** an older hunt database is brought up to date when opened,
  each version all or nothing. Foreign keys are checked before each
  version's upgrade commits.
- **The version 2 to 3 upgrade** adds the new company fields.
- **The version 1 to 2 upgrade:**
  - leads become applications; hunts go, and cards from different hunts in
    the same column are renumbered;
  - paused and stopped become archived, with paused as "on hold";
  - the old "resume sent" text moves into the process's note.

## The web UI

- Plain JavaScript, with no build step and no dependencies.
- A sidebar holds the sections, with Settings at its foot. On narrow
  screens it becomes a scrolling bar across the top.
- Drag and drop uses the browser's own (HTML5) drag events. That works with
  a mouse; on touch screens, change the stage from the process dialog.
  Files can also be dropped onto a document to upload them.
- Date pickers are the native `date` and `datetime-local` inputs.
- Autocomplete queries `GET /api/{resource}?q=` and
  `/api/suggest/{resource}/{field}` (earlier values of fields like source
  and location).
- Edit forms are built from `/api/meta`, so a new field in `resource.rs`
  shows up in the UI with no other change.
- Activity sections in dialogs start collapsed, and so does the Archived
  box, which shows its count. Whether Archived is open, and its period, are
  remembered in the browser.

## Not yet

- Tasks, preferences and fit, offers, funnel statistics.
- Touch drag and drop.
- Importing the earlier prototype's data.
