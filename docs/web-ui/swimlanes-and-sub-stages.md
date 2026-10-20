# Swimlanes and sub stages

The board is laid out in two ways: swimlanes are its rows, and sub stages
divide a column.

## Swimlanes

- The board's rows, top to bottom, each with stages (its columns) in it. A
  new hunt has two: Active Processes and Terminated Processes.
- Add, rename, reorder or remove them in Settings → Board, and choose each
  stage's swimlane there. A stage in none is in the first.
- Each folds to its header and count. Its Folded switch says how it starts
  (open, unless switched on), and opening or folding it on the board is
  remembered in this browser.

## Sub stages

- A stage's column can be divided, top to bottom. A new hunt has three,
  each a wait worth telling apart without a column of its own: Preparing
  (under Considering), Waiting on a decision (Interviewing) and Accepted
  (Offer).
- Add, rename or remove them in Settings → Board, where each stage's sub
  stages are listed indented under it.
- Drop a card into one, or choose it on the card's page. Cards in none stay
  at the column's top, and a card moved to another stage leaves its sub
  stage.
- The table shows them after their stage: "Offer · Shortlisted".
- **A default sub stage:** a sub stage can be its stage's default (its
  Default switch). A card going into the stage without one said (Move to,
  a new application, the CLI, Reopen) goes there; one dropped on the
  column's top stays at the top.

## From the command line

The API and the CLI call sub stages lanes:

```sh
hunt move acme offer --lane shortlisted
```
