# Maintaining hunt

Releasing hunt, and publishing its docs. The targets are `make`'s
"Maintain hunt" section (`mk/maintain.mk`). None of them commits or pushes
a branch: that stays yours, with jj.

## A release

1. **Start from an empty change** on main's newest: `jj new main`.
2. **Ready it:** `make release VERSION=0.17.0`. It refuses a version that
   isn't after Cargo.toml's, or a working copy that isn't empty. Then it:
   - sets the version in `Cargo.toml` and `Cargo.lock`;
   - writes the CLI's pages again (`make cli-docs`), and runs `make ci`;
   - drafts the release notes, in `target/release-notes-v0.17.0.md`, from
     the log since the last release (`v*` tag).
3. **Edit the notes:** what people will notice first; anything they must
   do (a setting, a backup before updating).
4. **Commit and push it:** `jj commit -m 'hunt 0.17.0'`, then push main.
   Wait for the image workflow to go green.
5. **Publish it:** `make publish` (`DRY_RUN=1` says what it would do). It
   checks that main on GitHub is at that version and the notes are there,
   then:
   - tags main's commit `v0.17.0`, and pushes the tag: the image workflow
     builds `:v0.17.0`, `:v0.17` and `:release`, for amd64 and arm64;
   - makes the GitHub release, with the notes (the app's sidebar links to
     it, as "hunt 0.17.0");
   - rebuilds careerhunt.app (`make site-deploy`).

Self-hosters' compose files and Kustomize folders run `:release`, so a
release reaches them when they update. Main's pushes reach only `:latest`
and `:demo`.

## The docs

hunt's docs are its README (a page per section), and `docs/start`,
`docs/concepts`, `docs/web-ui` and `docs/cli`. careerhunt.app builds them
with Docusaurus, fetching them from hunt's main (its `scripts/sync.py`).

- `make docs-preview`: the docs from this clone, on
  http://localhost:3000/docs/, as the site will show them (careerhunt.app
  beside hunt, or `SITE=…`).
- `make site-deploy`: rebuild the site from hunt's main, without a release
  (a docs fix). It needs `gh`, signed in with access to careerhunt.app.

## Pictures and pages made from hunt

- `make screenshots`: the demo's pages, for `docs/screenshots` and the site.
- `make cli-docs`: each CLI command's help, into `docs/cli/<command>.md`
  (`make release` does it too).
- `make logo`: the logo's PNGs, into `docs/logo`.

## Dependencies

- `make audit`: known vulnerabilities, in Rust's (with `cargo-audit`) and
  the web UI's.
- `make deps`: update both within their versions, then `make ci`.
