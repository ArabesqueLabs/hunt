# hunt move

Move a process to another stage. Moving it to a column of the board reopens it if it was closed; moving it to an inactive stage closes it.

## Examples

```sh
hunt move acme interviewing
hunt move acme offer --lane accepted
hunt move acme screening --top
hunt move tag:agency applied
```

## Good to know

- `--lane` puts it in one of the stage's lanes (by name or id), and `--top` at the top of its column, not the bottom.
- Name a process by its id (`12`, or `#12`), or by a word that picks it out: a search, such as `acme`, that matches it alone. If the word matches several, hunt lists them, so you can use an id.
- Several at once: a comma-separated list (`globex,initech`), `tag:NAME` (the active processes of applications with that tag), or `stage:NAME` (the active processes in that stage).

## Help

<!-- help: hunt move -->
```text
Move a process to another stage: a column of the board (reopening it if it was closed), or an inactive stage (closing it). Several at once: a comma-separated list (`globex,initech`), `tag:NAME` (the active processes of applications with that tag) or `stage:NAME`

Usage: hunt move [OPTIONS] <PROCESS> <STAGE>

Arguments:
  <PROCESS>
  <STAGE>

Options:
      --lane <LANE>  Into one of the stage's lanes (e.g. accepted), by name or id
      --url <URL>    Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
      --top          Put it at the top of the column (or lane), not the bottom
  -h, --help         Print help
```
