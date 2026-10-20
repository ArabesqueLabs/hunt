# hunt rm

Delete a record of any kind.

## Examples

```sh
hunt rm notes 31
hunt rm stages 6 --move-to applied
```

## Good to know

- A stage with processes in it needs somewhere to put them: `--move-to`.

## Help

<!-- help: hunt rm -->
```text
Delete a record

Usage: hunt rm [OPTIONS] <RESOURCE> <ID>

Arguments:
  <RESOURCE>
  <ID>

Options:
      --move-to <MOVE_TO>  For a stage with processes in it: where they go
      --url <URL>          Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
  -h, --help               Print help
```
