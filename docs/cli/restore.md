# hunt restore

Replace everything in hunt with a backup file's contents.

## Examples

```sh
hunt restore hunt-backup-2026-10-06.json
```

## Good to know

- It says what the file holds, and asks first; `--yes` doesn't ask. It's all or nothing: a backup that doesn't fit leaves things as they were.

## Help

<!-- help: hunt restore -->
```text
Replace everything with a backup file's contents

Usage: hunt restore [OPTIONS] <FILE>

Arguments:
  <FILE>

Options:
      --url <URL>  Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
      --yes        Don't ask first
  -h, --help       Print help
```
