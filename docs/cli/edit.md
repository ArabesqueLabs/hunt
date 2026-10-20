# hunt edit

Change a record of any kind: `field=value` pairs, and `field=` to clear one.

## Examples

```sh
hunt edit applications 4 location=London salary_min=150k currency=GBP work_mode=remote
hunt edit stages 3 active=0
hunt edit people 7 phone=
```

## Good to know

- Making a stage inactive (`active=0`) makes it a closing stage: what's in it closes.

## Help

<!-- help: hunt edit -->
```text
Change a record: field=value pairs; field= clears

Usage: hunt edit [OPTIONS] <RESOURCE> <ID> [FIELDS]...

Arguments:
  <RESOURCE>
  <ID>
  [FIELDS]...

Options:
      --url <URL>  Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
  -h, --help       Print help
```
