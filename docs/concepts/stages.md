# Stages, swimlanes and sub stages

The board is a grid: stages are its columns, swimlanes its rows, and sub
stages divide a column top to bottom. All three are yours to change, in
Settings → Board.

## Stages

A stage is where a process is: Considering, Applied, Screening,
Interviewing, Offer. A process is in one stage at a time, and moving it is
dragging its card.

A stage is **active** (the search is still on) or **terminal** (it's over).
A process in a terminal stage is closed: see [Closing](closing.md). A new
hunt has five active stages and three terminal ones: My Decision, Their
Decision, and Paused / Stopped.

## Swimlanes

Swimlanes group stages into rows. A new hunt has two: Active Processes, its
active stages, and Terminated Processes, its terminal ones. Add others to
keep, say, an Offers row of its own. Each folds to its heading and count.

## Sub stages

A sub stage (a lane, to the API and the command line) divides a column: a
wait worth telling apart without a column of its own. A new hunt has
Preparing (under Considering), Waiting on a decision (under Interviewing)
and Accepted (under Offer).

- A card in no sub stage stays at the column's top.
- A sub stage can be its stage's **default**: a card arriving without one
  said goes there.
- In a terminal stage, the sub stages are the **reasons** for closing:
  Their Decision's are "They rejected me", "Role filled" and so on.

## How far a process got

hunt remembers the last active stage each process reached. A process
closed at Interviewing "got to Interviewing", and that's where Stats and
Cycles count it, and where Reopen puts it back.

More in [Swimlanes and sub stages](../web-ui/swimlanes-and-sub-stages.md).
