# hunt person

Put someone on a process: a recruiter, the hiring manager, an interviewer or a referrer. Someone hunt doesn't know yet is added to your people, at the process's company.

## Examples

```sh
hunt person acme "Sam Lee" --role hiring-manager
hunt person globex "Pat Chen" --role recruiter
```

## Good to know

- `--role` is one of `recruiter`, `hiring-manager`, `interviewer`, `referrer` or `other`.
- Name a process by its id (`12`, or `#12`), or by a word that picks it out: a search, such as `acme`, that matches it alone. If the word matches several, hunt lists them, so you can use an id.

## Help

<!-- help: hunt person -->
```text
Put someone on a process (created if new)

Usage: hunt person [OPTIONS] <PROCESS> <NAME>

Arguments:
  <PROCESS>
  <NAME>

Options:
      --role <ROLE>  recruiter, hiring-manager, interviewer, referrer, other
      --url <URL>    Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
  -h, --help         Print help
```
