# hunt stash

What it does, and why you would use it.

## Help

<!-- help: hunt stash -->
```text
The stash: keep a link, some text or a file to sort later, and see what's waiting

Usage: hunt stash [OPTIONS] <COMMAND>

Commands:
  add      Keep something to sort later: a link, some words, or (with --file) a file; `-` reads the text from stdin (e.g. `pbpaste | hunt stash add -`)
  list     What waits to be sorted, and what each looks like it should become
  dismiss  Dismiss an item
  help     Print this message or the help of the given subcommand(s)

Options:
      --url <URL>  Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
  -h, --help       Print help
```
