# Roadmap

What's next for hunt, and how each piece would fit in. Done items are kept
at the end, with the version they shipped in.

## Features

### Total Compensation centre

A page for offers: what each is worth, now and over time, side by side.

- **Offers as records**: an `offer` table, linked to a process (one at the
  Offer stage, or an accepted one): base, bonus (target % or amount),
  equity (RSUs or options: grant value or count and price, vesting
  schedule, cliff, refreshers), sign-on and relocation, benefits (pension
  or 401(k) match, holiday, healthcare), location, currency, start date,
  and an expiry date to decide by. Pay is kept in GBP and shown in the home
  currency, as applications' pay is now.
- **Over time**: total compensation year by year (four years, say), as
  vesting, cliffs, sign-on clawbacks, expected raises and refreshers fall.
  Optional scenarios for the stock (flat, grows, halves), and a present
  value with a chosen discount rate, so a large grant that vests late and a
  higher base can be compared fairly.
- **A calculator**: change any figure (a counter-offer, a different
  vesting, an exchange rate) and see the effect at once. Counter-offers are
  saved as versions of an offer, so a negotiation's history stays.
- **Compare and slice**: offers side by side in a table and a chart (year
  by year, single hue per offer, a table twin as on Stats). Filter and
  group by company, stage, location, work mode, currency or tag; sort by
  first-year or four-year value.
- **With the rest of hunt**: an application at Offer links its offer;
  accepting an offer shows its numbers on the celebration; levels.fyi pay
  bands (see Research) set the offer against the market.

### Take-home pay

For everyone who lives in the UK (marked Experimental): what a UK salary, or a contractor's rate inside and outside
IR35, leaves after tax, and the other way round. Next:

- Offers in the Total Compensation centre shown after tax.
- Your pension and student loans kept with your settings, rather than in
  the browser, so applications' take-home pay is the same everywhere.
- Other countries' rules, as hunt's pay is in many currencies.

### Referrals centre

Referrals asked for, made and owed, in one place.

- Builds on what's there: people, and the `referrer` role on a process.
- A page listing each referral: who, at which company, for which role and
  application; asked on, status (to ask, asked, submitted, declined, hired),
  next follow-up, and whether you've thanked them.
- From a company's page: the people you know there, to ask. From an
  application: "Ask for a referral" adds the person, the step and a
  reminder.
- Referrals you give (for friends) tracked the same way, if wanted.
- Stats: how referred applications fare against the rest (Stats already
  splits by source).

### Research from levels.fyi, Glassdoor, Blind and layoffs.fyi

Pull what these say about a company (and a job) into hunt automatically
where possible, and keep it as summarised notes.

**Where hunt is now.** It already reads levels.fyi company pages
(`src/lookup.rs`) and its job listings (`src/posting.rs`), from the JSON
the pages carry for their scripts (`__NEXT_DATA__`). It doesn't read pay
data, Glassdoor, Blind or layoffs.fyi.

**Getting the data.**

| Source | How | Why |
|---|---|---|
| **levels.fyi** | The server, as now | Company and salary pages carry their numbers as JSON in the page: pay by level (median total comp, base/stock/bonus), job families and locations. |
| **layoffs.fyi** | The server | Its tracker is public data: layoffs by company and date ("Laid off 10% in March"). |
| **Glassdoor** | The browser, by bookmarklet | Behind bot protection and a sign-in; its public API closed years ago, so a server's requests mostly fail. |
| **Blind** | The browser, by bookmarklet | Behind a sign-in, as Glassdoor. |

For Glassdoor and Blind, the LinkedIn "Send to hunt" bookmarklet already
solves the same problem: generalise it so that on a page you're viewing
(signed in), it sends the page's text to hunt. It's your own access, a page
at a time, which also keeps it within what those sites allow: automated
access is against their terms. levels.fyi also restricts automated use, so
server reads stay small: one company, when asked, cached, never crawling.

**Summarising.**

1. Structured facts first, without AI: Glassdoor's rating, number of
   reviews, "recommend to a friend" %, CEO approval, interview difficulty;
   levels.fyi's pay by level for the role and location; layoffs.fyi's
   recent layoffs. Reliable, no model needed, shown as compact facts.
2. An optional written summary: the text extracted, sent to Claude with a
   short prompt (themes from reviews and Blind threads, what interviews are
   like, how the posting's pay compares with levels.fyi). Needs an API key
   (Settings, or `HUNT_ANTHROPIC_API_KEY`), off until one is set; marked as
   generated, with its sources and date.

**Where it lands.**

- The company's page gets a **Research** section: one entry per source,
  what was found, when, its link, and Refresh. Company-wide facts belong
  to the company, so every application to it shows them.
- The application's page gets a short comparison note ("Offer £105k vs
  levels.fyi median £118k for L5 in London"), a timeline note like any
  other; the Total Compensation centre uses the same bands.
- A `research` table (company, optional application, source, URL, fetched
  at, extracted data as JSON, summary), in backups like everything else.

**Automatically.** When an application is added (or its posting imported),
hunt looks the company up on levels.fyi and layoffs.fyi in the background,
by name or website domain, and offers a search link when it can't match.
Refreshed at most weekly per company, and on demand. Glassdoor and Blind
can't be automatic: the company's page links to them, with "Read it with
the bookmarklet".

**In steps.**

1. levels.fyi pay and layoffs.fyi into a Research section, with no AI.
2. The bookmarklet reading Glassdoor and Blind pages.
3. The optional Claude summary, and the offer-against-market note.

## Bigger projects

### A hosted version

Built on multi-user hunt (done: see below):

- Account deletion by the person themselves (now by asking an admin), and
  backups. (Sign-up, export, the privacy notice and terms: done.)
- Gmail: reading mail through Google's API for others needs Google's
  verification of the app (restricted scopes, a security assessment);
  until then, mail by forwarding (an address per person) or .eml uploads.
- Running costs: files in object storage rather than the database; outside
  lookups rate-limited per person.
- Billing, if it isn't free.

### Hiring platforms

What a candidate can get from them is limited, so this is honest about it:

- Job boards (Ashby, Greenhouse, Lever, Workable) publish postings through
  public APIs, which hunt already reads. Their candidate data (application
  status, interview schedules) is only in their employer-side APIs, which
  need the employer's key, not yours.
- What's possible: reading their emails (status changes, interview
  invitations, offers), as hunt's Gmail matching starts to; calendar
  invitations into steps; watching a saved posting for being closed or
  changed; and applying-link shortcuts. LinkedIn has no candidate API.

## Done

- **0.3.0**
  - The Stats tooltip goes when the pointer leaves the mark, and on a new
    page.
  - A refresh action in the listings, for records with a LinkedIn link.
  - A company's Applications show each one's stage and tags.
  - LinkedIn and GitHub sign-in, through Cloudflare Access.
- **0.4.0**
  - Columns hide: the board's stages, and the table's and listings'
    columns, each with an eye, and shown again from a list above.
  - Lanes: a stage's column divided by outcome (Offer: Accepted,
    Shortlisted, Rejected).
  - Several posting links per application, with their differences resolved
    side by side.
- **0.5.0**
  - Right to left, and Arabic; language, time zone and numerals in
    Settings.
  - Accepting an offer: wrap up the other processes (archive, or a step to
    tell the recruiter), and the home page celebrates the offer.
  - Lanes listed under their stages in Settings.
- **0.6.0**
  - Bulk changes: select in the table or on the board, then move, archive,
    resume, tag, set the next action or delete, all or nothing, with Undo;
    tag and delete in the listings; several processes at once from the
    CLI.
- **0.7.0**
  - Several people in one hunt: accounts through Cloudflare Access
    (GitHub, LinkedIn), sign-up requests, an admin centre to approve,
    reject and manage them; each person's rows kept to them in the one
    shared database.
  - The logo as PNGs for other apps and profiles (`docs/logo/`).
- **0.7.1**
  - Health checks answer without sign-in; a footer crediting Arabesque Labs.
- **0.8.0**
  - Open source, under the GNU AGPL v3 (as Karakeep): LICENSE,
    CONTRIBUTING.md, SECURITY.md; every page's footer links the source.
  - Run for others (`HUNT_LEGAL_*`): a privacy notice, terms of use (agreed
    to when asking for an account) and the company's registered details.
  - The website: a home page (what hunt is, its features, how to run it),
    Docs (the README, with its contents alongside) and Screenshots.
  - The dashboard under `/app`: the rest of the site is public, so only
    `/app` and `/api` need signing in.
  - Data deletion: delete your own account in Settings, and a page saying
    how (as Facebook's sign-in asks).
  - More kinds of file: NDA, job description, take-home assignment,
    certificate or transcript, background check, right to work or ID.
  - A step can be "Done" with nothing to wait for, as well as "Done,
    waiting".
  - Asking for an account is joining the early access list, on the home
    page and in the app, with no dates or promises (the terms say so).
- **0.9.0**
  - Take-home pay (an experiment), reworked around Pay information: start
    from the gross pay offered or the take-home pay wanted; as an employee
    (PAYE), a contractor inside or outside IR35, or all three side by side;
    the amount, its currency and pay period (hourly to annually), then only
    what that choice needs. Figures in your currency, with the one typed
    beside them. Student loans and pension folded away; and what an
    application's pay range would leave, on its page.
  - Settings → Location: whether you live in the UK, and where; take-home
    pay is only for UK residents.
  - Take-home pay, more of what affects it, each folded away: a tax code
    and the Marriage Allowance, Child Benefit and the High Income Child
    Benefit Charge, other salary sacrifice, Gift Aid and payroll giving,
    and an employer's pension contribution.
  - Take-home pay recommends the tax code its figures would give (L, T,
    0T, M, N, S, as HMRC's rules on gov.uk), and says when yours differs.
  - Settings → Desired net take-home pay: results show how far above or
    below it each way of being paid is, and working back starts from it.
  - The sidebar collapses to its icons, and back (remembered in the
    browser).
  - Take-home pay is out of the experiments (still marked Experimental):
    in the sidebar for everyone, asking those not in the UK to say so; a
    disclaimer; shares (RSUs and options, as gov.uk taxes them), benefits
    in kind, bonus multipliers, and an offer year by year.
