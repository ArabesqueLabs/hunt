# hunt upload

Upload a file as a new version of a document: a CV, a cover letter, an offer. A document with that name is made if there isn't one yet.

## Examples

```sh
hunt upload Resume cv.pdf --tag rust-focused
hunt upload "Cover letter" acme.pdf --kind cover-letter -n "for Acme"
```

## Good to know

- `--tag` labels the version (`rust-focused`), and `--note` (`-n`) says what's different about it.
- `--kind` is for a new document: `resume` unless you say. `hunt list documents` lists them, and `hunt attach` records which version went where.

## Help

<!-- help: hunt upload -->
```text
Upload a new version of a document (made if new)

Usage: hunt upload [OPTIONS] <DOCUMENT> <FILE>

Arguments:
  <DOCUMENT>  The document: an id, or a name
  <FILE>

Options:
      --tag <TAG>    e.g. "rust-focused"
      --url <URL>    Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
  -n, --note <NOTE>
      --kind <KIND>  For a new document: resume, cover-letter, portfolio, reference, certificate, screenshot, job-description, assignment, offer, contract, nda, background-check, right-to-work, candidate-resource, feedback, other [default: resume]
  -h, --help         Print help
```
