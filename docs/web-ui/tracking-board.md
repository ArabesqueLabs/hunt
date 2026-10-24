# Applications

Every application, as a board of stages or as a table: the switch at the
top changes the view, and it opens as you left it.

## Two views

- **Board** (`/`): a column per stage, a card per process (below).
- **Table** (`/applications`): every application, with its stage and
  whether it's active, archived or not on the board; pay in GBP, location,
  mode, source, when applied and last changed, and tags. Sort by any
  column; open one by its row.

## Filters

Both views share their filters, which carry over between them.

- **In the filters' row:** words (company, role, location, source, tags,
  people), needs attention (an interview within 7 days, or unchanged for
  14+), work mode, pay and source.
- **Pay** is a GBP-a-year minimum: other currencies are converted, and
  other periods annualised. "Known pay only" drops those without.
- **Under "More filters":** company, person, added or applied in the last
  7/30/90 days, closing soon, location, employment, archive reason, has
  emails/files/people (or nothing), status and tag.
- **They're in the address** (`/?mode=remote&pay=120000`), so a filtered
  view can be bookmarked, and Back undoes a change. They're remembered too.
- "Clear filters" and the count of what's shown appear whenever any is on.

## The board

- One column per stage; columns grow with their cards.
- Cards are compact (role and company) or detailed, by the Detailed switch
  at the end of the filters' row. A detailed card shows its first three
  tags, and how many more (named when you point at it).
- Drag cards between columns or within one.
- "+ Add a process" at the foot of a column adds one straight into it:
  see [Adding applications](adding-applications.md).
- The board's rows are swimlanes, and its columns can be divided into sub
  stages: see [Swimlanes and sub stages](swimlanes-and-sub-stages.md).

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
