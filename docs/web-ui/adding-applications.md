# Adding applications

Give hunt a job posting's link, and it fills in the rest; or add an
application by hand.

## Adding one

"+ Add a process" at the foot of a column on the board adds one straight
into it:

- paste the job posting's link, and what it says fills in the role,
  company, location, work mode, pay, dates and posting text;
- or give just the company (it autocompletes, and offers to create one it
  doesn't know), the role and the source.

An existing application can import its posting too ("Import from link…"),
choosing what to take.

## Where postings are read from

- Ashby, Greenhouse, Lever, Workable, LinkedIn, Apple Careers and
  levels.fyi (`levels.fyi/jobs?jobId=…`; its `/jobs/view/…` pages are
  LinkedIn's jobs, read from LinkedIn).
- Any careers page that describes its jobs in schema.org `JobPosting`
  data, as most job boards do.
- A pay range written in the text ("$180,000 – $220,000") counts when the
  posting gives none as data.

## More than one posting

The same job is often posted in several places: the careers page,
LinkedIn, an agency.

- An application's own link is its main posting; "+ Add a posting link"
  adds others, each kept with its own text and when it was last read.
- A link is read as soon as it's added, as is a posting link changed in
  Edit. "Import from link…" (or "Refresh all") reads every link at once,
  and each one's Refresh just that one.
- What they say is shown side by side, one choice per field: what's there
  now, or one link's, with ≠ where the links disagree. What's there is
  kept unless it's empty, until you choose otherwise; each link's text is
  kept for that link.

## A posting already tracked

- It's flagged when you paste its link, or set it on an application: the
  warning names the application and where its processes are. A link
  another application has, as either kind of posting, is warned about too.
- Links match however they were copied (tracking parameters, `www.`,
  LinkedIn's `?currentJobId=`).
- It's a warning only: you can still add it, as when applying again.

## From the command line

```sh
hunt list postings
```
