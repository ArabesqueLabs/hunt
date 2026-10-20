# hunt mail

The emails about a process: add them from `.eml` files or pasted messages, list them, read them, or take them off.

## Examples

```sh
hunt mail list acme
hunt mail show 12
hunt mail import acme ~/Downloads/offer.eml
pbpaste | hunt mail import acme -
hunt mail rm 12
```

## Good to know

- To import from Gmail: ⋮ → Download message gives an `.eml` file; or ⋮ → Show original → Copy to clipboard, then `-` reads what you pasted.
- Name a process by its id (`12`, or `#12`), or by a word that picks it out: a search, such as `acme`, that matches it alone. If the word matches several, hunt lists them, so you can use an id.

## Help

<!-- help: hunt mail -->
```text
Emails about a process: add .eml files or pasted messages, list, read

Usage: hunt mail [OPTIONS] <COMMAND>

Commands:
  list    A process's emails
  show    Read an email
  rm      Remove an email from its process
  import  Add an email to a process: a file (.eml), or `-` for its text on stdin (e.g. `pbpaste | hunt mail import acme -` after Gmail's ⋮ → Show original → Copy to clipboard)
  help    Print this message or the help of the given subcommand(s)

Options:
      --url <URL>  Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
  -h, --help       Print help
```

### hunt mail list

<!-- help: hunt mail list -->
```text
A process's emails

Usage: hunt mail list [OPTIONS] <PROCESS>

Arguments:
  <PROCESS>

Options:
      --url <URL>  Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
  -h, --help       Print help
```

### hunt mail show

<!-- help: hunt mail show -->
```text
Read an email

Usage: hunt mail show [OPTIONS] <EMAIL>

Arguments:
  <EMAIL>

Options:
      --url <URL>  Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
  -h, --help       Print help
```

### hunt mail rm

<!-- help: hunt mail rm -->
```text
Remove an email from its process

Usage: hunt mail rm [OPTIONS] <EMAIL>

Arguments:
  <EMAIL>

Options:
      --url <URL>  Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
  -h, --help       Print help
```

### hunt mail import

<!-- help: hunt mail import -->
```text
Add an email to a process: a file (.eml), or `-` for its text on stdin (e.g. `pbpaste | hunt mail import acme -` after Gmail's ⋮ → Show original → Copy to clipboard)

Usage: hunt mail import [OPTIONS] <PROCESS> <FILE>

Arguments:
  <PROCESS>
  <FILE>

Options:
      --url <URL>  Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
  -h, --help       Print help
```
