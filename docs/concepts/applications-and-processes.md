# Applications and processes

hunt keeps apart the job you're applying for and your attempt at getting
it. Most of the time they go together, one for one; the difference matters
when you apply again.

## An application

An application is an opening: a role at a company, with its posting. It
holds what the posting says:

- the role, the company, the location, work mode (remote, hybrid, on
  site) and employment type;
- pay: a range, its currency and period, with any bonus and equity, and
  a free-text note for "£150k + equity" (see [Pay and currencies](pay-and-currencies.md));
- the posting's link, description, and the dates it was posted and closes;
- where you heard of it, and, for a recruiter's role, the application it
  came through.

Adding an application from a posting's link fills most of this in.
hunt warns when a link is one you've already added, however it was copied,
but doesn't refuse it: applying again is allowed.

## A process

A process is pursuing an application: the card on the board. It has:

- its **cycle** (see [Cycles](cycles.md));
- its **stage**, and sub stage, where it is now (see
  [Stages, swimlanes and sub stages](stages.md));
- when you applied, and the furthest active stage it reached;
- its **interview steps**, **reminders**, **notes**, the **people**
  involved, the **files** you sent, and its **emails**.

Usually an application has one process. It gets another when you apply
again later, or bring it back into a new cycle: the old process stays as
it ended, and the new one starts fresh, sharing the application.

## One page for both

The web UI shows an application and its processes on one page
(`/applications/ID`), and the board and the table both open it; the
command line names either by company. The API keeps them apart:
`/api/applications` and `/api/processes`.
