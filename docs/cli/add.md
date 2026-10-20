# hunt add

Add a job to the board: a process, with its application, and its company if it's new. Give it a job posting's link, and hunt reads the role, the company, the pay and the description from it.

## Examples

```sh
hunt add --link https://jobs.ashbyhq.com/acme/1234 -s applied
hunt add Acme -r "Staff Engineer" -s applied --source referral --applied -3d
hunt add TikTok --next "reply to recruiter" --due "fri 10:00"
```

## Good to know

- `--stage` (`-s`) is the column it starts in: the first, unless you say.
- `--next` and `--due` give it a reminder, as `hunt next` does.
- Dates can be friendly: `tomorrow`, `+3d`, `-1w`, `fri 15:00`, `10-30`, or `2026-10-30`.

## Help

<!-- help: hunt add -->
```text
Add a process, and its application and company if they're new

Usage: hunt add [OPTIONS] [COMPANY]

Arguments:
  [COMPANY]  The company [default: the posting's, with --link]

Options:
  -r, --role <ROLE>
      --url <URL>          Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
  -s, --stage <STAGE>      The column to put it in [default: the first]
      --source <SOURCE>
      --link <LINK>        The job posting's link: what it says is filled in (Ashby, Greenhouse, Lever, Workable, LinkedIn, or a careers page)
      --next <NEXT>        Something to do next, as a reminder
      --due <DUE>          When it's due: tomorrow, +3d, fri 15:00, 2026-10-09
      --applied <APPLIED>  When you applied
      --via <VIA>          The application this came through (an id, or a search)
  -h, --help               Print help
```
