# hunt backup

Save everything you keep in hunt, files included, to one JSON file.

## Examples

```sh
hunt backup
hunt backup -o ~/backups/hunt.json
```

## Good to know

- Without `--out` (`-o`), it's `hunt-backup-<date>.json`, here. A backup works with any database, so it also moves your data from one to another.

## Help

<!-- help: hunt backup -->
```text
Save everything tracked, files included, to a backup file

Usage: hunt backup [OPTIONS]

Options:
  -o, --out <OUT>  Where [default: hunt-backup-<date>.json, here]
      --url <URL>  Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
  -h, --help       Print help
```
