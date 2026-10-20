# hunt download

Save a version of a document to a file.

## Examples

```sh
hunt download 7
hunt download 7 -o ~/Desktop/cv.pdf
```

## Good to know

- `hunt list versions` lists the versions, with their ids. Without `--out` (`-o`), the file keeps its own name, here.

## Help

<!-- help: hunt download -->
```text
Save a version's file

Usage: hunt download [OPTIONS] <VERSION>

Arguments:
  <VERSION>  The version's id (see `hunt list versions`)

Options:
  -o, --out <OUT>  Where to save it [default: its own name, here]
      --url <URL>  Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
  -h, --help       Print help
```
