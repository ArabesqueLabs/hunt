# Many at once

Select several processes, and move, archive, tag or delete them together.

## Selecting

- **In the table:** a checkbox per row, one in the header for every row
  shown, and shift-click for a run.
- **On the board:** Ctrl/⌘-click a card, or press x on it. Escape lets go.
- Companies, People and Files take the same checkboxes, to tag, untag or
  delete together.

## What you can do

A bar then offers:

- Move to (a stage, or a lane of it);
- Archive… (one reason and note for all);
- Resume;
- Add tag… and Remove tag…;
- Next action…;
- Delete….

Dragging a selected card on the board brings the others along (into a
column, a lane, or the archive). Each change is all or nothing, logged on
each process, and a toast offers Undo.

## From the command line

`POST /api/processes/bulk` does it for the API, and the CLI takes several
processes at once:

```sh
hunt move globex,initech screening
hunt archive tag:agency role-filled
hunt move stage:Applied interviewing
```
