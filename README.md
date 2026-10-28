# hunt

Track a job search as a board of hiring processes.

hunt is free software, under the [GNU AGPL v3](LICENSE): run it yourself,
for yourself or for others. It's a product of
[Arabesque Labs](https://arabesquelabs.com), who also run it for people who'd
rather not host it themselves. Its website, [careerhunt.app](https://careerhunt.app),
has these docs, screenshots (also in [`docs/screenshots.md`](docs/screenshots.md))
and the hosted hunt's legal pages; it's kept apart from hunt, with Arabesque
Labs' other websites.

To look around first, with made-up data on every page (nothing is kept
once you stop it):

```sh
docker run --rm -p 127.0.0.1:4848:4848 ghcr.io/arabesquelabs/hunt:demo
```

To run your own, with Docker (see "Docker", below), Kubernetes
("Kubernetes") or built from source with Rust and Node, then open
http://localhost:4848. In a clone of hunt, `make help` lists a target for each:

```sh
git clone https://github.com/ArabesqueLabs/hunt && cd hunt
make doctor                     # what you have, and which way it can run
make docker-up                  # with Docker (deploy/docker): or…
make k8s-up                     # …on Kubernetes (deploy/kubernetes): or…
make install && make serve      # …built from source, database ~/.hunt/hunt.db
make backup                     # save everything in the running hunt to backups/
```

A new hunt opens on its launcher: a few steps to make its owner's account
(an email address and a password) and set it up (its region, currency
and theme), or to restore a backup, then the board. New
to it? Start with the [Introduction](docs/start/introduction.md) and the
[Quick start](docs/start/quick-start.md), then the
[Core concepts](docs/concepts/cycles.md).

Every hunt has an owner, who signs in and runs it: made in the launcher,
or from `HUNT_ADMIN_EMAIL` and `HUNT_ADMIN_PASSWORD`. Others join only as
the owner says (sign-ups are closed on a new hunt): see "What's public,
and what needs signing in" and "Several people", below. To work on hunt
itself:

`hunt serve` runs one service. It owns the database (SQLite, PostgreSQL or
MySQL) and serves a JSON API, plus a web UI that uses that API. The rest of the `hunt` commands use
the same API, so the CLI and the browser always agree.

```sh
make                            # make dev: http://127.0.0.1:4848, on an empty database each start (the launcher)
make dev-demo                   # the same, with made-up data in it
make help                       # every target, by who it's for
make watch                      # serve it for several people, rebuilding and restarting on every change
make image && make image-try    # the container image, built and run here, keeping nothing
make ci                         # what CI runs: format check, lint, every test
```

[CONTRIBUTING.md](CONTRIBUTING.md) has more, and
[docs/maintaining.md](docs/maintaining.md) how hunt is released.

## Docker

hunt's image, [`ghcr.io/arabesquelabs/hunt`](https://github.com/ArabesqueLabs/hunt/pkgs/container/hunt), is small: no shell, and it runs
as a non-root user, on Intel and AMD (`linux/amd64`) and ARM (`linux/arm64`:
a Raspberry Pi, a Mac with Apple silicon). It listens on :4848, keeps its
SQLite database in `/data` (a volume), and answers `/healthz` once its
database does.

### Requirements

- Docker, with Docker Compose

### 1. Get the compose file and its settings

In a folder of its own (`mkdir hunt && cd hunt`):

```sh
curl -fsSLO https://raw.githubusercontent.com/ArabesqueLabs/hunt/main/deploy/docker/compose.yaml
curl -fsSL https://raw.githubusercontent.com/ArabesqueLabs/hunt/main/deploy/docker/.env.example -o .env
```

`.env` is its settings, each explained there: which hunt (`HUNT_VERSION`),
its owner (`HUNT_ADMIN_EMAIL` and `HUNT_ADMIN_PASSWORD`, or make them in
the launcher), where it listens (`HUNT_BIND`, `HUNT_PORT`), and a
PostgreSQL or MySQL database instead of SQLite (`HUNT_DB`).

### 2. Run it

```sh
docker compose up -d
```

In a clone of hunt, `make docker-up` does both steps, with the files in
[`deploy/docker`](deploy/docker). Your data is in the `hunt-data` volume,
and stays when the container is replaced. Without Compose, the same is:

```sh
docker run -d --name hunt --restart unless-stopped \
  -p 127.0.0.1:4848:4848 -v hunt-data:/data \
  ghcr.io/arabesquelabs/hunt:release
```

### 3. Open it

Visit http://localhost:4848: a new hunt opens on its launcher, to make its
owner's account and set it up. Until there's an owner, nothing needs
signing in, and `127.0.0.1` keeps hunt to this computer: make them before
opening it to a network (`HUNT_BIND=0.0.0.0`). See "What's public, and
what needs signing in".

### Versions

| Tag | What it is |
|---|---|
| `release` | the newest release: the default |
| `v0.17.0`, `v0.17` | a release, to stay on until you choose to move |
| `latest`, `sha-…` | main's newest build, ahead of any release |
| `demo` | main's, with made-up data, for looking around |

Choose one with `HUNT_VERSION` in `.env`. Each release's notes are on
[GitHub](https://github.com/ArabesqueLabs/hunt/releases).

### Updating

Back up first (`make backup`, or Settings → Backup and import): a backup
imports only into the hunt that made it, or a newer one, so it's the way
back. Then:

```sh
docker compose pull && docker compose up -d
```

`make docker-update` does all three. A newer hunt upgrades a SQLite
database in place.

### Building the image yourself

```sh
make image                      # hunt:dev, for this machine (TARGET=demo: the demo's)
make image-try                  # run it, keeping nothing
```

The `image` workflow (`.github/workflows/image.yml`) runs `make ci`, then
builds each platform on a runner of its own and publishes the tags above,
so you needn't build it yourself.

Builds reuse what they can. The Dockerfile builds hunt's dependencies in a
layer of their own, from [cargo-chef](https://github.com/LukeMathWalker/cargo-chef)'s
recipe (what hunt depends on, without its own version), and the workflow
keeps layers in GitHub's Actions cache. A code change or a release (a new
version) only compiles hunt itself; changing the dependencies compiles
them again. The cache holds 10 GB per repository, so an occasional full
build after old entries are evicted is expected.

## Kubernetes

hunt is one pod with one volume. Only one copy can run at a time, since
SQLite is a file on that volume, so updates replace the pod rather than
rolling. [`deploy/kubernetes`](deploy/kubernetes) has it, for Kustomize
(built into kubectl).

### Requirements

- A Kubernetes cluster, with a storage class for the volume
- kubectl

### 1. Get the manifests, and fill in their settings

From a clone of hunt, or a copy of its `deploy/kubernetes` folder:

```sh
cd deploy/kubernetes
cp .env.example .env            # settings (none needed for one person on SQLite)
cp .secrets.example .secrets    # HUNT_ADMIN_EMAIL and _PASSWORD, HUNT_DB: each optional
```

Which hunt runs is `newTag` in `kustomization.yaml` (`release`, a version
to stay on, or `latest`).

### 2. Deploy it

```sh
kubectl apply -k .
kubectl -n hunt rollout status deployment/hunt
```

Or `make k8s-up`, from the clone, which copies the examples if needed.

- **One replica, recreated:** never two pods on one SQLite file.
- **`fsGroup: 65532`:** the image runs as that user, so this gives it the
  volume.
- **The probes:** `/healthz` answers "ok" once hunt and its database do,
  and needs no sign-in.

### 3. Open it

Through a port-forward, from your own computer:

```sh
kubectl -n hunt port-forward svc/hunt 4848
```

Then visit http://localhost:4848. The CLI and `make backup` work through
it too (`HUNT_URL=http://127.0.0.1:4848`).

To reach it from elsewhere, fill in
[`ingress.example.yaml`](deploy/kubernetes/ingress.example.yaml) and apply
it, or point a load balancer or a Cloudflare Tunnel at the `hunt`
service's port 4848, with a sign-in in front of it: see "What's public,
and what needs signing in".

### Updating

Back up first (`make backup`, through the port-forward). Then, on a moving
tag (`release`, `latest`), restart it to pull the newest:

```sh
kubectl -n hunt rollout restart deployment/hunt     # or make k8s-update
```

On a version, change `newTag` and `kubectl apply -k .` again.
`make k8s-down` takes hunt down and keeps its volume.

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

## Backups

Settings → **Backup and import**, or `hunt backup` and `hunt restore`. In a
clone of hunt, `make backup` saves one from the running hunt (Docker's
too) into `backups/`, signed in as the owner with `HUNT_EMAIL` and
`HUNT_PASSWORD`.

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

hunt's web UI is where your job search lives: a board of every application,
and pages for the companies, people, files and dates around them. It's built
with the [Arabesque Design System](https://design.arabesquelabs.com/).

Each part has a page of its own:

- [Applications](docs/web-ui/tracking-board.md): the board and the
  table, filters, hiding and folding.
- [Swimlanes and sub stages](docs/web-ui/swimlanes-and-sub-stages.md): the
  board's rows, and the parts of a column.
- [Adding applications](docs/web-ui/adding-applications.md): from a
  posting's link or by hand, and a job posted in several places.
- [An application's page](docs/web-ui/an-application.md): what it shows,
  and editing it.
- [Many at once](docs/web-ui/many-at-once.md): selecting several, and
  changing them together.
- [Closing, and an accepted offer](docs/web-ui/closing-and-offers.md):
  terminal stages and their reasons, and accepting an offer.
- [Companies and people](docs/web-ui/companies-and-people.md): their lists
  and pages, and reading them in, from LinkedIn too.
- [Files, email and notes](docs/web-ui/files-email-and-notes.md): documents
  and their versions, emails, and notes about the search.
- [The calendar](docs/web-ui/calendar.md): interviews and deadlines, by
  month, week or day.
- [Stats](docs/web-ui/stats.md): the search in charts, and what hunt uses
  of its machine.
- [Settings, tags and listings](docs/web-ui/settings.md): how hunt looks
  and works, tags, and the lists' columns.

## What's public, and what needs signing in

The app is at `/`, each of its pages at its own address (`/stats`,
`/applications/2`), and its data under `/api`: those need signing in. The
rest needs nobody: signing in and up (`/login`, `/signup`), the health
check (`/healthz`), the scripts, styles, fonts and logo, and a shared
calendar's link. Addresses from when the app lived under `/app`
(`/app/companies/3`) lead to the same page without it, and the website's
pages hunt once served (`/docs`, `/privacy`, `/terms`, `/data-deletion`,
`/screenshots`, and `/ar/…`) lead to them on the website (`HUNT_SITE_URL`,
below).

Every hunt has accounts, and signs them in itself: an email address and a
password. In front of it, a sign-in proxy or Cloudflare Access can sign
people in instead.

### hunt's own: an email address and a password

A hunt's first account is its owner's: made in a new hunt's launcher (it
can't be skipped), or when hunt starts. The owner is account 1, an admin:
they run the hunt (Admin, in the sidebar). Anyone else joins only as an
admin says: see "Several people", below.

```sh
HUNT_ADMIN_EMAIL=you@example.com HUNT_ADMIN_PASSWORD='a long passphrase' hunt serve
docker run -e HUNT_ADMIN_EMAIL=you@example.com -e HUNT_ADMIN_PASSWORD='a long passphrase' \
  -p 4848:4848 -v hunt-data:/data ghcr.io/arabesquelabs/hunt:release
```

- **The app and its data** ask for them, at `/login`, and remember you for
  30 days. The sidebar has **Log out**; Settings → General changes your
  email address and password. Until there's an owner, nothing needs
  signing in: make them before hunt can be reached from elsewhere.
- **Passwords** are kept as Argon2 hashes, with the accounts: never in a
  backup. A new one ends that account's other sessions. They need 8
  characters or more; a wrong one costs a second.
- **The CLI** signs in as an account: set `HUNT_EMAIL` and `HUNT_PASSWORD`
  where you run `hunt`, or `HUNT_TOKEN` to an access token.
- **Access tokens** (Settings → Connected apps) let apps act as you: the
  [browser extension](extension/README.md), an iOS Shortcut, a script.
  They're sent as `Authorization: Bearer hunt_…`. Each one either only adds
  to your stash, or has full access to what you can do, except tokens, your
  sign-in and the admin centre. Only a token's SHA-256 is kept, so it's
  shown once. Revoking one stops it at once, and a disabled account's
  tokens stop with it.
- **Forgotten it?** Start hunt with `HUNT_ADMIN_EMAIL` and
  `HUNT_ADMIN_PASSWORD` again: the password replaces that admin's.
- **`HUNT_PASSWORD`**, which once kept a hunt to whoever knew it, is now
  the CLI's alone: `hunt serve` won't start with it and no owner, rather
  than start open.
- **Over the internet**, put hunt behind HTTPS (a reverse proxy such as
  Caddy, which does it on its own): the cookie is marked secure when the
  proxy says the visit was over HTTPS (`X-Forwarded-Proto`).

### A sign-in proxy

If you already sign people in at a proxy (Authelia, Authentik,
oauth2-proxy, Tailscale), it can tell hunt who's asking, in a header:

```sh
hunt serve --admins you@example.com \
  --auth-header Remote-Email --trusted-proxies 172.18.0.0/16
# or HUNT_ADMINS=… HUNT_AUTH_HEADER=… HUNT_TRUSTED_PROXIES=…
```

| Proxy | Its header |
|---|---|
| Authelia | `Remote-Email` |
| Authentik | `X-authentik-email` |
| oauth2-proxy | `X-Auth-Request-Email` (with `--set-xauthrequest`) |
| Tailscale (`tailscale serve`) | `Tailscale-User-Login` |

- **`--trusted-proxies`** (or `HUNT_TRUSTED_PROXIES`) lists the addresses,
  or ranges, the proxy's requests come from: this machine (`127.0.0.1`,
  `::1`) unless said, and in Docker, the proxy's network (`172.18.0.0/16`,
  say). The header counts from those alone, so nobody reaching hunt another
  way can claim to be anyone. Keep hunt's own port off the internet all the
  same.
- **The proxy** has to set the header itself, replacing any a visitor sent:
  Authelia's and oauth2-proxy's usual setups do.
- **The admins** are named with `HUNT_ADMINS` (the first is account 1, if
  there's none yet); others join and are let in as with Cloudflare Access:
  see "Several people", below.
- **The CLI**, from a trusted address (on hunt's own machine, say), says
  who's asking itself: set `HUNT_AUTH_HEADER` (the same header) and
  `HUNT_USER` (your email) where you run it.

With Caddy and Authelia, for instance:

```
hunt.example.com {
  forward_auth authelia:9091 {
    uri /api/authz/forward-auth
    copy_headers Remote-User Remote-Groups Remote-Email Remote-Name
  }
  reverse_proxy hunt:4848
}
```

### Cloudflare Access

```sh
hunt serve --admins you@example.com,other-admin@example.com \
  --access-team yourteam --access-aud <the Access application's AUD tag>
# or HUNT_ADMINS=… HUNT_ACCESS_TEAM=… HUNT_ACCESS_AUD=…
```

Protect the whole hostname (`hunt.example.com`). Access signs people in
with GitHub, LinkedIn (or any login method set up there) and hands hunt a
signed token, which hunt checks against the team's keys and the
application's audience tag on every request for data, so a request that
didn't come through Access can't pass for anyone, and a mistake in
Access's setup doesn't open anyone's data. For others to ask for an
account, the Access application's policy has to let them in: Include →
Login Methods → GitHub and LinkedIn (anyone signed in with one), rather
than your email. Kubernetes' probes reach `/healthz` inside the cluster,
not through Access; a calendar app subscribing to a shared calendar's link
needs a bypass for `/api/calendar/`.

Behind Cloudflare Access, the sidebar has **Log out** (ending the Access
session), and the admin centre's Debugging info has the identity Access
holds for you and the Zero Trust dashboard, with hunt's own health check,
calendar feed, backup, source and image builds. The CLI uses a service
token: set `HUNT_ACCESS_CLIENT_ID` and `HUNT_ACCESS_CLIENT_SECRET` to its
id and secret, and `HUNT_URL` to the public address, and set its Client ID
as the account's CLI token in the admin centre. Bringing someone in from
LinkedIn, the extension opens hunt in a tab, so it signs in like any other
visit.

Apps that send to your stash with an access token have to get past Access
first:

- **The browser extension** sends your browser's Access cookie, so it gets
  in when you're signed in to hunt in that browser. When the sign-in has
  expired, it says so and opens hunt for you to sign in again.
- **Anything without a browser** (an iOS Shortcut, `curl`) needs an Access
  service token with a Service Auth policy. It sends
  `CF-Access-Client-Id` and `CF-Access-Client-Secret` alongside the hunt
  token. The extension's settings take a service token too.
- **Or** add a Bypass policy for just `/api/stash` (as for the calendar's
  `/api/calendar/`), so hunt's token is the only check there. This is
  simpler but weaker: anyone can reach that path, though they can't do
  anything there without a token.

## Several people (multi-user)

Every hunt can serve several people, each seeing and changing only their
own applications, companies, people, files, notes, tags and settings. They
share one database: every row carries its owner, and every request runs as
the account it comes from (`src/scope.rs` scopes each statement to the
account's rows, so nothing has to remember to). A hunt from before it had
accounts keeps what's there: it's the owner's, account 1.

A new hunt is its owner's alone: **sign-ups are closed** until an admin
opens them (Admin → Access and accounts), or invites someone.

- **Joining**, with hunt's own sign-in: at `/signup`, an email address, a
  name, a password and, optionally, what brings them to hunt (and the terms
  of use, where the hunt has some: `HUNT_SITE_URL`). Someone invited signs
  up with the address the invite went to, and is in at once, sign-ups open
  or not; anyone else waits for an admin's say, signed in, seeing where
  they stand. Behind Access or a proxy, they sign in there, then join "the
  early access list": their name and what brings them.
- **The admin centre** (/admin, for admins; under Settings in the sidebar):
  - Access and accounts: whether new people may sign up at all, inviting
    someone, those waiting (let them in or turn them down, with a note),
    and every account: its status, role (make another admin),
    applications, when last seen, and its CLI token; disable, enable, or
    remove it (with everything of theirs, if chosen).
  - General: this hunt's name (in the sidebar and the browser's tab), a
    notice above every page (until each person closes it), an address
    people can write to for help, hunt's own address (for the links it
    gives and connecting apps), and what new accounts start with.
  - Info: its version, how people sign in, who runs it, and how many
    accounts it has. User stats and System resources: how each account
    uses hunt (by number, not name), and the machine. Debugging info:
    links to hand (the health check, calendar feed, backup and API, the
    source and image builds, and behind Access, your identity there).
- **Admins** named in `HUNT_ADMINS` are admins whenever hunt starts; the
  first is account 1, when there's none yet.
- **Backups** are each account's own: a backup holds its rows (and only
  the files they use), and importing one replaces only that account's,
  with new ids so they can't collide with anyone else's. Backups from older
  versions of hunt (schema 8 on) import too.
- **Gmail sync** is the owner's (account 1) only, for now.
- **`--tenants`** (`HUNT_TENANTS`), which once turned several people on, is
  no longer needed: it's still taken, and changes nothing.
- **Trying it out locally**: `make dev-tenants` (or `make watch`) serves
  `target/dev.db` with `ADMINS` (by default admin@example.test) as admins,
  and who's asking taken on trust (`--identity-header X-Hunt-User`): in a
  browser, open `/dev/as?email=admin@example.test` to be the admin, or any
  other email to be someone new asking for an account; `/dev/as` alone
  signs out. Never run it like this where others can reach hunt.

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

Every page ends with a footer saying who made hunt, and linking to the docs
and its source (`HUNT_SOURCE_URL`, if you've changed hunt: the AGPL asks a
service people use over a network to offer them its source).

Running hunt for other people, you're responsible for their data, and the
law (in the UK and EU, at least) asks for a privacy notice, terms and your
company's details. Those are your website's to publish; hunt links to them,
and has people agree to the terms:

| Setting | |
|---|---|
| `HUNT_SITE_URL` | your website (e.g. `https://careerhunt.app`), with `/privacy/`, `/terms/`, `/data-deletion/` and `/docs/` (and their Arabic versions under `/ar/`): setting it says hunt is run for others |
| `HUNT_OPERATOR` | who runs it, by name (e.g. `Arabesque Labs Ltd`), for the account page and Take-home pay's disclaimer |

Then:

- **The footer** links to the website's docs, privacy notice, terms and
  cookies (`/privacy/#cookies`).
- **Asking for an account** needs agreeing to the terms, linked. Which
  version (`UPDATED` in `src/site.rs`: the date on the website's terms), and
  when, is kept with the account, and shown to admins (`agreed_terms`).
- **Deleting an account** (Settings → Your account) links to the website's
  data deletion page, and Take-home pay to its terms.
- **The pages hunt once served** (`/privacy`, `/terms`, `/data-deletion`,
  `/docs`, `/ar/…`) lead to the website's, so links to them from elsewhere
  (Facebook's sign-in asks for the privacy notice and the data deletion
  page by address) keep working.

Arabesque Labs' own legal pages, in English and Arabic, are careerhunt.app's,
in its repository: have yours checked for your service before relying on
them. Earlier versions of hunt served them itself, with `HUNT_LEGAL_*`:
hunt now refuses to start with `HUNT_LEGAL_COMPANY` but no `HUNT_SITE_URL`,
rather than drop them unnoticed.

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

These docs in Arabic are `README.ar.md`, which the website shows under
`/ar/docs/`: keep it up to date with `README.md` (a test checks they have
the same sections).

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

1. Copy `src/web/src/lib/i18n-ar.ts` to `src/web/src/lib/i18n-<code>.ts`,
   change its name, direction (`ltr` or `rtl`) and digits, and translate
   each phrase. Patterns fill `{names}` with the parts that vary; `{n}`,
   `{m}`, `{n1}` … match numbers only. A phrase left out shows in English.
2. Add it to `CATALOGS` in `src/web/src/lib/i18n.ts`, by its code, and to
   `LANGUAGES` in `src/service.rs`.

The page is translated as it's drawn (`src/web/src/lib/i18n.ts`): the code writes
English, and each text, placeholder, title, aria-label and alt found in
the catalog is swapped for its translation. Anything inside
`translate="no"`, or in the user-content list there, is left alone.

## The CLI

Every command but `serve` talks to the service (`--url`, or `$HUNT_URL`;
default `http://127.0.0.1:4848`). A process can be named by id or by a word
that picks it out (`acme`). Dates can be friendly: `tomorrow`, `+3d`, `-1w`,
`fri 15:00`, `10-30`, `2026-10-30`.

Each command has a page of its own in [`docs/cli/`](docs/cli/), with what
it does, examples, and its help (on the website, under The CLI). `make
cli-docs` writes each page's help from the program, and a test checks it's
current: change a command, and run it.

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
`src/web/fonts/` (see its README). The rich text editor, Lexical, is
bundled under the MIT License.

---

hunt is a product of [Arabesque Labs](https://arabesquelabs.com).
