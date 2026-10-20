# hunt detach

Take a document's version off a process, when it didn't go with it after all.

## Examples

```sh
hunt detach acme 7
```

## Good to know

- The version is its id, as `hunt show` lists it.
- Name a process by its id (`12`, or `#12`), or by a word that picks it out: a search, such as `acme`, that matches it alone. If the word matches several, hunt lists them, so you can use an id.

## Help

<!-- help: hunt detach -->
```text
Take a document version off a process

Usage: hunt detach [OPTIONS] <PROCESS> <VERSION_ID>

Arguments:
  <PROCESS>
  <VERSION_ID>

Options:
      --url <URL>  Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
  -h, --help       Print help
```
