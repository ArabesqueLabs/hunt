# hunt step

Add an interview step to a process: a screen, an interview, a take-home. Give it a time, and it's on the calendar.

## Examples

```sh
hunt step acme "system design" --at "fri 15:00"
hunt step acme "phone screen" --at -2d --status passed
```

## Good to know

- `--status` says where it stands: `scheduled`, `done` (waiting to hear), `completed` (nothing to hear), `passed`, `failed` or `cancelled`.
- Name a process by its id (`12`, or `#12`), or by a word that picks it out: a search, such as `acme`, that matches it alone. If the word matches several, hunt lists them, so you can use an id.
- Dates can be friendly: `tomorrow`, `+3d`, `-1w`, `fri 15:00`, `10-30`, or `2026-10-30`.

## Help

<!-- help: hunt step -->
```text
Add an interview step to a process

Usage: hunt step [OPTIONS] <PROCESS> <TITLE>

Arguments:
  <PROCESS>
  <TITLE>

Options:
      --at <AT>
      --url <URL>        Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
      --status <STATUS>  scheduled, done (waiting to hear), completed (nothing to hear), passed, failed, cancelled
  -h, --help             Print help
```
