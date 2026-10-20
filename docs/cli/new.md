# hunt new

Create a record of any kind, from `field=value` pairs.

## Examples

```sh
hunt new people name="Pat Chen" company_id=acme title=Recruiter
hunt new lanes stage_id=their name="Salary too low"
hunt new swimlanes name="On hold"
```

## Good to know

- `hunt fields` says which fields each kind has. A field naming another record, such as `company_id`, takes its id or its name.

## Help

<!-- help: hunt new -->
```text
Create a record from field=value pairs

Usage: hunt new [OPTIONS] <RESOURCE> [FIELDS]...

Arguments:
  <RESOURCE>
  [FIELDS]...

Options:
      --url <URL>  Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
  -h, --help       Print help
```
