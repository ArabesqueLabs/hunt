# hunt archive

Close a process, and say why: the reason is a lane of an inactive stage, such as `rejected`, `role-filled` or `withdrew`, and the process moves to it. `hunt list reasons` lists them. `close` does the same.

## Examples

```sh
hunt archive tiktok role-closed -n "hiring freeze till November"
hunt archive acme role-filled -n "went with an internal candidate"
hunt close tag:agency rejected
```

## Good to know

- `--note` (`-n`) keeps a note of what happened, on its timeline.
- Name a process by its id (`12`, or `#12`), or by a word that picks it out: a search, such as `acme`, that matches it alone. If the word matches several, hunt lists them, so you can use an id.
- Several at once: a comma-separated list (`globex,initech`), `tag:NAME` (the active processes of applications with that tag), or `stage:NAME` (the active processes in that stage).

## Help

<!-- help: hunt archive -->
```text
Close a process, and say why: a reason's code or name, a lane of an inactive stage (`hunt list reasons`; e.g. rejected, role-filled, withdrew). It moves to that lane. Several at once, as for move: `globex,initech`, `tag:agency`, `stage:Applied`

Usage: hunt archive [OPTIONS] <PROCESS> <REASON>

Arguments:
  <PROCESS>
  <REASON>

Options:
  -n, --note <NOTE>
      --url <URL>    Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
  -h, --help         Print help
```
