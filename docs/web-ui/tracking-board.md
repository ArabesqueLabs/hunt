# Applications

Every application, as a board of stages or as a table: the switch at the
top changes the view, and it opens as you left it.

## The top bar

Along the top of every page:

- **Search**, and filter the page you're on: one field, scoped to the
  page (its chip, "Applications"), or, with that chip off, everything at
  once. `/` or ⌘K (Ctrl+K) gets to it from anywhere. On a phone, it's the
  magnifying glass in the bar. See [Searching and filtering](search.md).
- **The bell:** what's coming up today and tomorrow (see
  [Calendar](calendar.md#coming-up)), with how many on its corner, in
  amber when something's overdue.
- **You**: your photo (or initials). Your menu has Settings, Admin (for
  admins) and Log out.

The **theme** (light, dark, or matching the system; a click moves to the
next) and the **language** (a click switches to the other one) are at the
foot of the sidebar, under "Hide sidebar". Below them is hunt's version,
linked to its release notes, and a note when a newer release is out.

## Two views

- **Board** (`/`): a column per stage, a card per process (below).
- **Table** (`/applications`): every application, with its stage and
  whether it's active, archived or not on the board; pay in GBP, location,
  mode, source, when applied and last changed, and tags. Sort by any
  column; open one by its row.

![Applications as a table: each one's stage, pay, location, work mode, source, dates and tags, sortable by any column](../screenshots/table-light.png#gh-light-mode-only)
![Applications as a table: each one's stage, pay, location, work mode, source, dates and tags, sortable by any column](../screenshots/table-dark.png#gh-dark-mode-only)

## Filters

Both views share their filters, which carry over between them. They're in
the search at the top: on this page it starts with the Applications scope,
so typing narrows the board or the table as you go, and the list under it
suggests the filters your words could mean (see
[Searching and filtering](search.md) for how it works, and every keyword).

- **What needs doing:** `is:due` (Due next) and `is:overdue`.
- **Which cycle** the board shows, when more than one is running:
  `cycle:"Autumn 2026"`. Without it, the board shows them all. Picking a
  cycle in the sidebar does the same.
- **The rest:** stage, sub stage, tag, company, person, work mode,
  location, pay, source, attention (an interview within 7 days, or
  unchanged for 14+), added or applied in the last 7/30/90 days, closing
  soon, employment, status, has emails/files/people (or nothing), and why
  it was closed.
- **Pay** is a GBP-a-year minimum: other currencies are converted, and
  other periods annualised. "Known pay only" drops those without.
- **They're in the address** (`/?mode=remote&pay=120000`), so a filtered
  view can be bookmarked, and Back undoes a change. They're remembered too.

## The board

- One column per stage; columns grow with their cards.
- Cards are compact (role and company) or detailed. The three icons by
  "Add application" switch between a compact board, a detailed board
  and the table. A detailed card shows its first three
  tags, and how many more (named when you point at it).
- Drag cards between columns or within one.
- "+ Add a process" at the foot of a column adds one straight into it:
  see [Adding applications](adding-applications.md).
- The board's rows are swimlanes, and its columns can be divided into sub
  stages: see [Swimlanes and sub stages](swimlanes-and-sub-stages.md).

![The board, detailed: a column per stage and a card per process, with what's next on each](../screenshots/board-light.png#gh-light-mode-only)
![The board, detailed: a column per stage and a card per process, with what's next on each](../screenshots/board-dark.png#gh-dark-mode-only)

On a phone, a swimlane shows one stage at a time, its stages as tabs above it:

![On a phone: Active Processes, its stages as tabs, and Backlog's cards in its sub stages](../screenshots/phone-board-light.png#gh-light-mode-only)
![On a phone: Active Processes, its stages as tabs, and Backlog's cards in its sub stages](../screenshots/phone-board-dark.png#gh-dark-mode-only)

## Getting started

A new board starts with a short list above it: adding the first
application, and the settings that make hunt fit (the board's stages,
interviews in your calendar app, LinkedIn in one click). Each says whether
it's done, where hunt can tell. It goes once there are three applications,
or when you hide it.

## Hiding a stage

The eye on a column's header hides that stage from the board. Hidden
stages are listed above the columns, with their counts, to show again (one
by one, or all). It's remembered in this browser; their cards still count,
and still show in the table.

## Folding

- A column's cards, or a sub stage's, fold into a pile with the chevron on
  its header: blank cards saying how many ("3 cards"), or a dashed "Empty".
- A column folded all through is one pile, its sub stages in it. Clicking
  a pile unfolds it.
- A stage's Folded switch (Settings → Board) says how its cards start:
  unfolded, but folded for the terminal stages a hunt starts with. A sub
  stage's starts as its stage's, until its own Folded switch is set.
