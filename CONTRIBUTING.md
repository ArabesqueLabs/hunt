# Contributing to hunt

Thank you for thinking of helping. Here's how it works.

## Questions and ideas

- **A question, or not sure it's a bug?** Open an issue saying so, with what
  you tried and what you expected.
- **A bug?** Open an issue with the steps to reproduce it, what happened,
  and what you expected. A screenshot helps for anything on screen.
- **An idea for a feature?** Look first for an issue that has it, and add
  to that one. [`roadmap.md`](roadmap.md) has what's planned.

Please report security problems privately instead: see
[SECURITY.md](SECURITY.md).

## Changing hunt

hunt is a Rust service (`src/`) with a web UI in plain JavaScript
(`src/web/`) and a CLI, sharing one JSON API. [`README.md`](README.md) and
[`docs/design.md`](docs/design.md) explain how it fits together.

```sh
make demo     # a throwaway database in target/, with made-up data
make watch    # serve it for several people, rebuilding on every change (needs cargo-watch)
make ci       # what CI runs: format check, clippy, every test
```

`make test-all` also runs the tests on PostgreSQL and MySQL (needs Docker).

Before you start on something big, say so on its issue, so work isn't
done twice. Then:

- Keep a pull request to one change, with tests for it, and `make ci`
  passing.
- Changed a command of the CLI? Run `make cli-docs`, and say what's new
  on its page, `docs/cli/<command>.md`.
- Match the code around yours: its naming, its comments, and its plain
  wording in what people read (no jargon on screen).
- Anything people see works in light and dark, on a phone, and right to
  left (Arabic): add new phrases to `src/web/i18n-ar.js`.
- Describe what changed and how you checked it, with a screenshot for
  anything visible.

We review pull requests as time allows: usually within a week or two.

## The license

hunt is under the [GNU AGPL v3](LICENSE). By contributing, you agree that
your contribution is licensed under it too. The names "hunt" and
"Arabesque Labs", and their logos, aren't part of the license: see the end
of the README.
