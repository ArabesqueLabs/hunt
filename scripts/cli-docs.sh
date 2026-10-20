#!/bin/sh
# The CLI's pages, docs/cli/<command>.md: what each command does (written by
# hand), and its help (written here). Each `<!-- help: hunt … -->` marker is
# followed by a ```text block, which this fills with that command's --help.
#
#   scripts/cli-docs.sh        (or `make cli-docs`, which builds first)
#
# A command without a page gets one to write, and docs/cli/index.json lists
# the commands in `hunt --help`'s order, for the website (careerhunt.app),
# which shows a page for each. tests/cli.rs checks the help here is the
# program's. The environment is left out, so its HUNT_* don't show in the
# help as values.
set -eu
HUNT=${HUNT:-target/debug/hunt}
[ -x "$HUNT" ] || { echo "cli-docs: no $HUNT; run \`cargo build\` first" >&2; exit 1; }
OUT=docs/cli
mkdir -p "$OUT"

commands=$(env -i "$HUNT" --help | awk '/^Commands:/ { on = 1; next } /^$/ { on = 0 } on && $1 != "help" { print $1 }')

for c in $commands; do
  page="$OUT/$c.md"
  [ -f "$page" ] || printf '# hunt %s\n\nWhat it does, and why you would use it.\n\n## Help\n\n<!-- help: hunt %s -->\n```text\n```\n' "$c" "$c" > "$page"
  awk -v hunt="$HUNT" '
    /^<!-- help: hunt .* -->$/ { print; args = $0; sub(/^<!-- help: hunt /, "", args); sub(/ -->$/, "", args); want = 1; next }
    want && /^```text$/ {
      print
      run = "env -i " hunt " " args " --help | sed \"s/[[:space:]]*$//\""
      while ((run | getline line) > 0) print line
      close(run); want = 0; skip = 1; next
    }
    skip && /^```$/ { skip = 0; print; next }
    skip { next }
    { print }
  ' "$page" > "$page.new"
  mv "$page.new" "$page"
done

printf '%s\n' $commands | awk 'BEGIN { printf "[" } { printf "%s\"%s\"", (NR > 1 ? ", " : ""), $0 } END { print "]" }' > "$OUT/index.json"
echo "cli-docs: $(printf '%s\n' $commands | wc -l | tr -d ' ') commands, in $OUT"
