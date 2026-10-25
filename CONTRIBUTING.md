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

hunt is a Rust service (`src/`) with a web UI in React and TypeScript
(`src/web/`) and a CLI, sharing one JSON API. [`README.md`](README.md) and
[`docs/design.md`](docs/design.md) explain how it fits together.

The web UI is built with Node (20.19, or 22.12 and later) into
`src/web/dist`, which the binary compiles in: `make` builds it before
hunt (`make web` on its own), so building with `cargo` alone needs it built
first.

```sh
make               # make dev: hunt as it is here, on an empty database each start
make dev-demo      # the same, with made-up data in it
make watch         # serve it for several people, rebuilding on every change (needs cargo-watch)
make ci            # what CI runs: format check, clippy, every test
```

`make help` lists the rest, under "Work on hunt" and "Test". For what a
newcomer sees:

```sh
make dev-password  # signing in, as dev@example.test (dev-password), made from HUNT_ADMIN_EMAIL and _PASSWORD
make image         # the container image, as CI builds it (TARGET=demo: the demo's)
make image-try     # run it, keeping nothing: Docker and the launcher together
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
  left (Arabic): add new phrases to `src/web/src/lib/i18n-ar.ts`. Write a
  phrase as one string (`` `Add to ${name}` ``, not "Add to " beside a
  name), so the page can find it to translate.
- Describe what changed and how you checked it, with a screenshot for
  anything visible.

We review pull requests as time allows: usually within a week or two.

## The license

hunt is under the [GNU AGPL v3](LICENSE). By contributing, you agree that
your contribution is licensed under it too. The names "hunt" and
"Arabesque Labs", and their logos, aren't part of the license: see the end
of the README.
