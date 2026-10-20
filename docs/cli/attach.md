# hunt attach

Record that a document went with a process: which CV, cover letter or portfolio you sent. Its latest version, unless you say.

## Examples

```sh
hunt attach acme resume
hunt attach acme "cover letter" --version 3
```

## Good to know

- Name a process by its id (`12`, or `#12`), or by a word that picks it out: a search, such as `acme`, that matches it alone. If the word matches several, hunt lists them, so you can use an id.

## Help

<!-- help: hunt attach -->
```text
Record that a document went with a process

Usage: hunt attach [OPTIONS] <PROCESS> <DOCUMENT>

Arguments:
  <PROCESS>
  <DOCUMENT>  The document: an id, or a name

Options:
      --url <URL>          Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
      --version <VERSION>  Which version [default: the latest]
  -h, --help               Print help
```
