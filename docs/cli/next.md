# hunt next

Give a process a reminder: something to do next, with a date if you like. It shows on its card, and on the calendar.

## Examples

```sh
hunt next acme "send availability" --due tomorrow
hunt next globex "chase the recruiter" --due "fri 10:00"
```

## Good to know

- Name a process by its id (`12`, or `#12`), or by a word that picks it out: a search, such as `acme`, that matches it alone. If the word matches several, hunt lists them, so you can use an id.
- Dates can be friendly: `tomorrow`, `+3d`, `-1w`, `fri 15:00`, `10-30`, or `2026-10-30`.

## Help

<!-- help: hunt next -->
```text
Add a reminder to a process: something to do next

Usage: hunt next [OPTIONS] <PROCESS> <WHAT>

Arguments:
  <PROCESS>
  <WHAT>

Options:
      --due <DUE>
      --url <URL>  Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
  -h, --help       Print help
```
