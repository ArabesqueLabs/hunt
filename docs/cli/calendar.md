# hunt calendar

What's coming up: interview steps, reminders, and the deadlines of the jobs you're after, day by day.

## Examples

```sh
hunt calendar
hunt calendar --from tomorrow --to +2w
hunt calendar --kinds step,next -q acme
```

## Good to know

- It starts today and runs 30 days, unless `--from` and `--to` say otherwise.
- `--kinds` picks what to show: `step`, `next`, `closes`, `applied` and `posted`; `--query` (`-q`) finds words; `--all` takes in closed processes too.
- Dates can be friendly: `tomorrow`, `+3d`, `-1w`, `fri 15:00`, `10-30`, or `2026-10-30`.

## Help

<!-- help: hunt calendar -->
```text
What's coming up: interview steps, next actions, deadlines

Usage: hunt calendar [OPTIONS]

Options:
      --from <FROM>    The first day [default: today]
      --url <URL>      Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
      --to <TO>        The last day [default: 30 days on]
  -q, --query <QUERY>  Words to find
      --kinds <KINDS>  step, next, closes, applied, posted (comma-separated)
      --all            Archived processes too
  -h, --help           Print help
```
