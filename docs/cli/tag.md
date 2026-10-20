# hunt tag

Show or change a record's tags. Applications, companies, people and documents have tags.

## Examples

```sh
hunt tag applications 4
hunt tag applications 4 +remote "dream job" -fintech
hunt list applications --where tag=remote
```

## Good to know

- `+name` adds a tag and `-name` takes it off; a name alone adds it. With no changes, it shows the tags.

## Help

<!-- help: hunt tag -->
```text
Show or change a record's tags: `+name` adds, `-name` removes, a bare name adds. Applications, companies, people and documents have tags

Usage: hunt tag [OPTIONS] <RESOURCE> <ID> [CHANGES]...

Arguments:
  <RESOURCE>
  <ID>
  [CHANGES]...

Options:
      --url <URL>  Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
  -h, --help       Print help
```
