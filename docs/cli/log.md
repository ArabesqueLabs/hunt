# hunt log

The change log: what changed, and when, for everything or for one record.

## Examples

```sh
hunt log
hunt log processes 12
hunt log -n 100
```

## Good to know

- The last 30 changes, unless `--limit` (`-n`) says otherwise.

## Help

<!-- help: hunt log -->
```text
The change log, for everything or one record

Usage: hunt log [OPTIONS] [RESOURCE] [ID]

Arguments:
  [RESOURCE]
  [ID]

Options:
  -n, --limit <LIMIT>  [default: 30]
      --url <URL>      Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
  -h, --help           Print help
```
