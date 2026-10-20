# hunt get

Show one record's fields, of any kind.

## Examples

```sh
hunt get companies 3
hunt get applications 12
```

## Good to know

- `hunt list` finds the id.

## Help

<!-- help: hunt get -->
```text
Show one record's fields

Usage: hunt get [OPTIONS] <RESOURCE> <ID>

Arguments:
  <RESOURCE>
  <ID>

Options:
      --url <URL>  Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
  -h, --help       Print help
```
