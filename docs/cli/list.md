# hunt list

List records of one kind: stages, lanes, companies, people, applications, processes, postings, steps, notes, documents, versions, memos or tags. Or `reasons`: the reasons for closing a process, which are the lanes of the inactive stages.

## Examples

```sh
hunt list applications -q rust
hunt list applications --where tag=remote
hunt list people --where company_id=3
hunt list reasons
```

## Good to know

- `--query` (`-q`) searches; `--where` (`-f`) filters by a field (`field=value`), and can be given more than once.
- `hunt fields` says which fields each kind has.

## Help

<!-- help: hunt list -->
```text
List records: stages, lanes, companies, people, applications, processes, postings, steps, notes, documents, versions, memos, tags; or reasons, for closing (the lanes of the inactive stages). `--where tag=name` filters by tag

Usage: hunt list [OPTIONS] <RESOURCE>

Arguments:
  <RESOURCE>

Options:
  -q, --query <QUERY>   Words to search for
      --url <URL>       Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
  -f, --where <FILTER>  field=value filters
  -h, --help            Print help
```
