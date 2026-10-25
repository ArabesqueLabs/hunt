# Introduction

hunt tracks a job search as a board of hiring processes: every application
you're making, how far each has got, and what's next for it, in one place
that's yours.

## What it does

- **A board of your applications.** A card for each hiring process, in a
  column for its stage (Considering, Applied, Screening, Interviewing,
  Offer), dragged along as it moves. Or the same applications as a table,
  with the same filters.
- **Everything about each one.** Its posting (read from the link: LinkedIn,
  Greenhouse, Lever, Ashby, Workable and others), its pay, the interview
  steps, the people involved, your notes, the emails, and which version of
  your CV you sent.
- **What's next, on time.** Reminders with a date, interviews on a
  calendar (and in your own calendar app, through a private link), and
  prep for each interview: what to read, practise and rehearse.
- **How it's going.** Stats on how far your applications get, where they
  come from, the pay on offer and what's gone quiet; and, when you accept
  an offer, a look back at the whole search.
- **One search at a time, or several.** Each job search is a cycle, from
  its first application to its end; past ones keep their boards.

## How it's built

- **One service.** `hunt serve` owns the database and serves a web UI and
  a JSON API. The `hunt` command line uses the same API, so the browser and
  the terminal always agree.
- **Your database.** SQLite, a single file, unless you say otherwise; or
  PostgreSQL or MySQL, if you already run one. A backup is one JSON file,
  files and all, which moves between any of them.
- **Self-hosted, and free.** It runs on your computer, a home server, a
  VPS or a Kubernetes cluster, from one small Docker image. It's free
  software, under the GNU AGPL v3.
- **For one person, or several.** A hunt has an owner, who signs in with
  an email address and a password, and runs it. It's theirs alone until
  they open sign-ups or invite someone: then each person sees only their
  own search. People can also sign in through Cloudflare Access or a
  sign-in proxy (Authelia, Authentik, oauth2-proxy, Tailscale).
- **In English and Arabic,** right to left, with Arabic-Indic digits if
  you'd like them.

## Where next

- [Quick start](quick-start.md): run it, set it up, and add your first
  application, in a few minutes.
- [Core concepts](../concepts/cycles.md): cycles, applications and
  processes, stages, closing, and the rest of what hunt is made of.
- [The web UI](../web-ui/tracking-board.md): every page, in detail.
