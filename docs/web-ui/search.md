# Searching and filtering

One field, in the top bar, does both. `/` or ⌘K (Ctrl+K) gets to it from
anywhere; on a phone, it's the magnifying glass in the bar.

## The page's scope, or everything

On a page that lists things (Applications, Contacts, Companies, People,
Files, Notes, the Calendar), the field starts with that page's **scope**,
a chip at its start: "Applications". What you type then narrows the page as
you go, and the list under the field suggests the filters your words could
mean, each with how many it would leave: "rem" offers Work mode: Remote,
"acme" the company.

- **Enter** picks the highlighted suggestion. "Search applications for …"
  keeps your words as a search; "Location contains …" matches them against
  locations.
- **With nothing typed**, the list has every filter of the page's, with its
  keyword. Pick one to see its choices.
- **Each filter on is a chip** after the scope's. Click one to change it,
  × to take it off, or press Backspace in the empty field to take off the
  last. × at the field's end clears them all (with Undo), and it says how
  many are shown.
- **Take the scope's chip off** (its ×, or Backspace once the filters are
  gone), or choose "Search everything for …", and the same field searches
  the whole app instead: the best few applications, companies, people,
  notes and files, each kind with "See all". "Search applications" at the
  top of that list puts the scope back.
- On pages that list nothing (Settings, Stats), it searches everything.
- **Escape** steps back: out of a filter's choices, then what's typed, then
  the list.
- **Filters are in the address** (`/?mode=remote&tag=rust`), so a filtered
  page can be bookmarked or shared, and Back undoes a change.

## Keywords

Filters can be typed, too, as `keyword:value`; values with spaces go in
quotes. Type a keyword and its colon, and the list offers its values.
Enter applies what you typed: keywords become chips, and any other words
are searched for.

```
is:overdue tag:rust
stage:Interviewing mode:remote added:7d
company:"Acme Labs" engineer
```

Keywords are in English, whichever language hunt is in; values are as the
page shows them (`stage:المقابلات`). A keyword the page doesn't have is
searched for as words.

### Applications

The board and the table share these, and carry them over between them.

| Keyword | Means | Values |
|---|---|---|
| `is:` | What needs doing, or attention | `due` (has a next action), `overdue`, `soon` (an interview within 7 days), `quiet` (unchanged for 14+ days) |
| `cycle:` | Which running cycle the board shows (with more than one running) | a cycle's name: `cycle:"Autumn 2026"` |
| `stage:` | Its stage | a stage's name |
| `substage:` | Its sub stage | a sub stage's name |
| `tag:` | Has a tag | a tag |
| `company:` | At a company | its name |
| `person:` | Someone in it | their name |
| `mode:` | Work mode | `remote`, `hybrid`, `onsite` |
| `location:` | Where | any text: `location:london` |
| `pay:` | At least, in GBP a year | `50k`, `75k`, `100k` … `250k`; `pay:known` leaves out those without pay |
| `source:` | Where you found it | a source: `linkedin` |
| `added:` | Added in the last … | `7d`, `30d`, `90d` |
| `applied:` | Applied in the last … | `7d`, `30d`, `90d` |
| `closing:` | Applications close within … | `7d`, `14d`, `30d` |
| `employment:` | Employment | `full-time`, `part-time`, `contract` … |
| `status:` | On the board or not | `active`, `closed`, `none` (not on the board) |
| `has:` | Has … | `emails`, `files`, `people`, `nothing` |
| `reason:` | Why it was closed | a reason |

Pay is a minimum in GBP a year: other currencies are converted, and other
periods annualised.

### Contacts, companies and people

| Keyword | Means |
|---|---|
| `tag:` | Has a tag |

### Files

| Keyword | Means |
|---|---|
| `kind:` | Its kind: `kind:resume`, `kind:"cover letter"` |
| `tag:` | Has a tag |
| `application:` | Sent with an application (from its page's Files) |

### Notes

| Keyword | Means |
|---|---|
| `tag:` | Has a tag |

### Anywhere

| Keyword | Means |
|---|---|
| `in:` | A scope: `in:contacts acme` searches Contacts for "acme". Type `in:` to see them all: `applications`, `contacts`, `companies`, `people`, `files`, `notes`, `calendar`. |
