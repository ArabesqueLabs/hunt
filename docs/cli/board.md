# hunt board

Show the board in your terminal: each stage, and the processes in it, with what's next on each. It's what `hunt` does on its own.

## Examples

```sh
hunt
hunt board --all
```

## Good to know

- Closed processes show from the last 30 days; `--all` shows every one.

## Help

<!-- help: hunt board -->
```text
Show the board (the default)

Usage: hunt board [OPTIONS]

Options:
      --all        Show every archived process, not just the last 30 days
      --url <URL>  Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
  -h, --help       Print help
```
