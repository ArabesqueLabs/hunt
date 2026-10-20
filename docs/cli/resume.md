# hunt resume

Put a closed process back on the board. `reopen` does the same.

## Examples

```sh
hunt resume acme
hunt resume acme screening
```

## Good to know

- Without a stage, it goes back to the one it had reached before it closed.
- Name a process by its id (`12`, or `#12`), or by a word that picks it out: a search, such as `acme`, that matches it alone. If the word matches several, hunt lists them, so you can use an id.

## Help

<!-- help: hunt resume -->
```text
Put a closed process back on the board

Usage: hunt resume [OPTIONS] <PROCESS> [STAGE]

Arguments:
  <PROCESS>
  [STAGE]    The column [default: the one it reached]

Options:
      --url <URL>  Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
  -h, --help       Print help
```
