# hunt note

Add a note to a process, on its timeline.

## Examples

```sh
hunt note acme "asked about the team's on-call"
```

## Good to know

- Name a process by its id (`12`, or `#12`), or by a word that picks it out: a search, such as `acme`, that matches it alone. If the word matches several, hunt lists them, so you can use an id.

## Help

<!-- help: hunt note -->
```text
Add a note to a process

Usage: hunt note [OPTIONS] <PROCESS> <TEXT>

Arguments:
  <PROCESS>
  <TEXT>

Options:
      --url <URL>  Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
  -h, --help       Print help
```
