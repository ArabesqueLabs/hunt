# hunt show

Everything about one process: its application and company, its stage, its steps, notes and reminders, its people and files, and its change log.

## Examples

```sh
hunt show acme
hunt show 12
```

## Good to know

- Name a process by its id (`12`, or `#12`), or by a word that picks it out: a search, such as `acme`, that matches it alone. If the word matches several, hunt lists them, so you can use an id.

## Help

<!-- help: hunt show -->
```text
Everything about one process

Usage: hunt show [OPTIONS] <PROCESS>

Arguments:
  <PROCESS>

Options:
      --url <URL>  Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
  -h, --help       Print help
```
