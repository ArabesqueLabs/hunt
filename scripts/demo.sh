#!/bin/sh
# Fill a database with demo data: companies, applications at every stage
# (some archived), people, interview steps, notes, emails, files and tags,
# spread over the last few months so Stats has weeks to draw. Every company,
# person and address in it is made up (web and email on .example domains).
#
#   scripts/demo.sh [DB]     (default: target/dev.db, what `make watch` serves)
#
# It's built in a fresh file through a hunt of its own on DEMO_ADDR, using the
# CLI, then moved into place. Anything already in DB is replaced. Dates are
# relative to today, so the board looks current whenever it's made. Needs
# sqlite3, to backdate when things were added.
set -eu

DB=${1:-target/dev.db}
DEMO_ADDR=${DEMO_ADDR:-127.0.0.1:4849}
HUNT=${HUNT:-target/debug/hunt}

command -v sqlite3 >/dev/null || { echo "demo: needs sqlite3" >&2; exit 1; }
[ -x "$HUNT" ] || { echo "demo: no $HUNT; run \`cargo build\` first" >&2; exit 1; }

WORK=$(mktemp -d "${TMPDIR:-/tmp}/hunt-demo.XXXXXX")
NEW="$WORK/demo.db"
"$HUNT" serve --addr "$DEMO_ADDR" --db "$NEW" >"$WORK/serve.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true; rm -rf "$WORK"' EXIT INT TERM

export HUNT_URL="http://$DEMO_ADDR"
i=0
until curl -fs -o /dev/null "$HUNT_URL/api/meta"; do
  i=$((i + 1))
  [ $i -lt 50 ] || { echo "demo: hunt didn't start:" >&2; cat "$WORK/serve.log" >&2; exit 1; }
  sleep 0.2
done

h() { "$HUNT" "$@" >/dev/null; }
# The id of the first record matching a search: `id companies Lumenbank`.
id() { "$HUNT" list "$1" -q "$2" | head -1 | sed -E 's/^#([0-9]+).*/\1/'; }
# The API, for what the CLI doesn't do: `api POST cycles/start '{…}'`, and
# the id in what it gives back.
api() { curl -fs -X "$1" -H "Content-Type: application/json" -d "$3" "$HUNT_URL/api/$2"; }
num() { sed -E 's/.*"id":([0-9]+).*/\1/'; }
# Backdating, applied once everything is in (see the end).
AGES=""
added() { AGES="$AGES$1|$2|${3:-}
"; }

# ---- the board: its swimlanes, stages and sub stages ---------------------------------------
# Active Processes (Backlog, Applied, Screening, Interviewing), Offers
# (Shortlisted, Negotiating, Accepted, Declined / Rescinded) and Terminated
# Processes, folded (My Decision, Their Decision, Paused / Stopped). Sub
# stages: Backlog's (Shortlisted, and Other, folded) and Interviewing's
# (Technical Phone Screening, then Virtual/Onsite Loop).

echo "demo: the board…"
for l in $("$HUNT" list lanes | sed -E 's/^#([0-9]+).*/\1/'); do api DELETE "lanes/$l" "" >/dev/null; done
h edit stages "$(id stages Considering)" name=Backlog
h edit stages "$(id stages Offer)" name=Shortlisted
offers=$(api POST swimlanes '{"name": "Offers"}' | num)
api POST swimlanes/order "{\"ids\": [$(id swimlanes Active), $offers, $(id swimlanes Terminated)]}" >/dev/null
h edit swimlanes "$(id swimlanes Terminated)" folded=1
h edit stages "$(id stages Shortlisted)" "swimlane_id=$offers"
for s in Negotiating Accepted "Declined / Rescinded"; do h new stages "name=$s" "swimlane_id=$offers"; done
backlog=$(id stages Backlog)
h new lanes "stage_id=$backlog" "name=Shortlisted"
h new lanes "stage_id=$backlog" "name=Other" folded=1
interviewing=$(id stages Interviewing)
h new lanes "stage_id=$interviewing" "name=Technical Phone Screening"
h new lanes "stage_id=$interviewing" "name=Virtual/Onsite Loop"

echo "demo: companies and applications…"

# ---- on the board --------------------------------------------------------------------

h add Lumenbank -r "Senior Backend Engineer" -s backlog --source linkedin --next "read the engineering blog" --due +2d
added Lumenbank 3

h add "Kestrel Networks" -r "Systems Engineer, Rust" -s backlog --source site --next "tailor the resume" --due "+4d"
added "Kestrel Networks" 2

h add Brightforge -r "Staff Platform Engineer" -s backlog --source site --next apply --due +5d
added Brightforge 6

h add "Tidepool AI" -r "Infrastructure Engineer" -s applied --source referral --applied -18d --next "chase the referrer" --due tomorrow
added "Tidepool AI" 19

h add "Cobalt Mail" -r "Senior Rust Engineer" -s applied --source linkedin --applied -9d
added "Cobalt Mail" 10

h add "Wavelength Audio" -r "Backend Engineer, Platform" -s applied --source site --applied -6d
added "Wavelength Audio" 7

h add Fernwise -r "Platform Engineer" -s screening --source referral --applied -25d --next "send availability" --due today
added Fernwise 26

h add "Meridian Talent" -r "Platform Engineer" -s screening --source agency --applied -14d --next "call the recruiter back" --due "-1d"
added "Meridian Talent" 15

h add Quillnote -r "Software Engineer (Rust)" -s interviewing --source site --applied -32d --next "prep system design" --due +1d
added Quillnote 33

h add "Orbit Metrics" -r "Senior Software Engineer, Storage" -s interviewing --source inbound --applied -40d --next "take-home due" --due "+3d 18:00"
added "Orbit Metrics" 41

h add Openfield -r "Staff Backend Engineer" -s interviewing --source linkedin --applied -29d
added Openfield 30

h add "Northwind Labs" -r "Staff Engineer" -s negotiating --source referral --applied -55d --next "decide on the offer" --due +6d
added "Northwind Labs" 56

h add "Skylark Deploy" -r "Software Engineer, Infrastructure" -s shortlisted --source inbound --applied -47d --next "negotiate equity" --due +2d
added "Skylark Deploy" 48

# ---- closed ----------------------------------------------------------------------------

h add "Granite Systems" -r SRE -s interviewing --source site --applied -70d
added "Granite Systems" 71 20
h add "Pinecrest Robotics" -r "Backend Engineer" -s applied --source linkedin --applied -64d
added "Pinecrest Robotics" 65 30
h add "Bluejay Video" -s backlog --source inbound
added "Bluejay Video" 50 12
h add Copperline -r "Senior SRE" -s screening --source agency --applied -80d
added Copperline 82 25
h add "Silverleaf Health" -r "Platform Engineer" -s applied --source site --applied -45d
added "Silverleaf Health" 46 9
h add "Foxglove Studio" -r "Principal Engineer" -s shortlisted --source referral --applied -90d
added "Foxglove Studio" 92 40
h add "Lattice Works" -r "Rust Developer" -s screening --source linkedin --applied -35d
added "Lattice Works" 36 6
h add "Wrenfield Labs" -r "Data Platform Engineer" -s interviewing --source linkedin --applied -40d
added "Wrenfield Labs" 41 14

# Closed: moved to a terminal stage, with a note on why.
close() { h move "$1" "$2"; h edit processes "$(id processes "$1")" "archive_note=$3"; }
close granite "their decision" "rejected after the onsite: wanted more Kubernetes"
close pinecrest paused "nothing after a month"
close bluejay "their decision" "hiring freeze till the new year"
close copperline "my decision" "withdrew: the team's on-call was too heavy"
close silverleaf "their decision" "filled internally"
close lattice "their decision" "rejected after the online assessment"
close wrenfield paused "hiring paused till the new budget"

# Declined, by me: below market, and no remote.
h move foxglove declined

# ---- sub stages: where Backlog's and Interviewing's are -------------------------------------

h move kestrel backlog --lane shortlisted
h move brightforge backlog --lane other
h move lumenbank backlog --lane other
h move orbit interviewing --lane technical
h move openfield interviewing --lane virtual

# ---- applications' details ----------------------------------------------------------

app() { id applications "$1"; }
h edit applications "$(app Quillnote)" location=London work_mode=remote employment=full-time salary_min=85k salary_max=100k currency=GBP pay_period=year url=https://jobs.example/quillnote/rust-engineer posted_on=-40d
h edit applications "$(app Lumenbank)" location=London work_mode=hybrid employment=full-time salary_min=75k salary_max=90k currency=GBP pay_period=year url=https://lumenbank.example/careers
h edit applications "$(app "Kestrel Networks")" location=Lisbon work_mode=hybrid employment=full-time salary_min=80k salary_max=95k currency=EUR pay_period=year url=https://kestrel.example/careers closes_on=+20d
h edit applications "$(app Brightforge)" location="Remote (Europe)" work_mode=remote employment=full-time salary_min=100k salary_max=115k currency=USD pay_period=year equity="0.05%"
h edit applications "$(app "Tidepool AI")" location="San Francisco" work_mode=onsite employment=full-time salary_min=105k salary_max=115k currency=USD pay_period=year equity="RSUs, 4 years"
h edit applications "$(app "Cobalt Mail")" location=Geneva work_mode=hybrid employment=full-time salary_min=95k salary_max=110k currency=CHF pay_period=year
h edit applications "$(app "Wavelength Audio")" location=Stockholm work_mode=hybrid employment=full-time
h edit applications "$(app Fernwise)" location=London work_mode=hybrid employment=full-time salary_min=70k salary_max=85k currency=GBP pay_period=year bonus="up to 10%"
h edit applications "$(app "Meridian Talent")" location=London work_mode=remote employment=contract salary_min=90k salary_max=100k currency=GBP pay_period=year
h edit applications "$(app "Orbit Metrics")" location=Paris work_mode=hybrid employment=full-time salary_min=80k salary_max=95k currency=EUR pay_period=year
h edit applications "$(app Openfield)" location="Remote (anywhere)" work_mode=remote employment=full-time salary_min=95k salary_max=110k currency=USD pay_period=year
h edit applications "$(app "Northwind Labs")" location=London work_mode=hybrid employment=full-time salary_min=105k salary_max=105k currency=GBP pay_period=year bonus="15% target" equity="£40k over 4 years"
h edit applications "$(app "Skylark Deploy")" location="Remote (Europe)" work_mode=remote employment=full-time salary_min=100k salary_max=115k currency=USD pay_period=year equity="options, 4 years with a 1-year cliff"
h edit applications "$(app "Granite Systems")" location=Manchester work_mode=onsite employment=full-time salary_min=60k salary_max=70k currency=GBP pay_period=year
h edit applications "$(app "Foxglove Studio")" location="New York" work_mode=onsite employment=full-time salary_min=110k salary_max=115k currency=USD pay_period=year

cat >"$WORK/quillnote.txt" <<'EOF'
About the role
Quillnote records, transcribes and summarises meetings, so people can be present instead of taking notes. We're hiring a Software Engineer to work on the Rust services behind it. See https://quillnote.example/careers for the rest of the team.

What you'll do:
- Build and run the services that turn recordings into notes
- Work with product and design on new features, from idea to launch
- Keep things fast and reliable as usage grows
- Take part in a light on-call rotation

REQUIREMENTS
1. 5+ years writing production software
2. Rust in production, or a strong wish to learn it
3. Comfortable with PostgreSQL and a cloud provider

Nice to have:
- Audio or video processing
- Experience with LLM-backed products

Benefits
Remote-first, with a London office. 30 days' holiday, a learning budget, and a home office allowance.
EOF
cat >"$WORK/orbit.txt" <<'EOF'
Senior Software Engineer, Storage

Orbit Metrics' storage team builds the systems that hold trillions of data points a day. You'll design and run distributed storage written in Go and Rust.

Responsibilities:
- Design storage engines for metrics and logs
- Profile and tune hot paths
- Mentor engineers across the team

Requirements:
- Experience with distributed systems in production
- Deep knowledge of one systems language
- Clear written communication

We offer a hybrid setup in Paris, equity, and a generous parental leave policy.
EOF
cat >"$WORK/northwind.txt" <<'EOF'
Staff Engineer, Developer Platform

ABOUT THE TEAM
The developer platform team owns CI, build tooling and the paths to production for 400 engineers.

WHAT YOU'LL DO
• Set the technical direction for the build and deploy systems
• Lead projects across several teams
• Coach senior engineers

WHAT WE'RE LOOKING FOR
• Years of building developer tooling at scale
• Kubernetes, Bazel or similar build systems
• A track record of leading without authority
EOF
"$HUNT" edit applications "$(app Quillnote)" "description=$(cat "$WORK/quillnote.txt")" >/dev/null
"$HUNT" edit applications "$(app "Orbit Metrics")" "description=$(cat "$WORK/orbit.txt")" >/dev/null
"$HUNT" edit applications "$(app "Northwind Labs")" "description=$(cat "$WORK/northwind.txt")" >/dev/null
# The same Quillnote job, also posted on LinkedIn: a second posting.
"$HUNT" new postings "application_id=$(app Quillnote)" url=https://www.linkedin.com/jobs/view/quillnote-demo-4100000000 \
  platform=LinkedIn read_at=-2d "description=Quillnote is hiring a Software Engineer (Rust), remote in the UK. Help build the services behind meeting notes.

Requirements:
- Rust or another systems language
- PostgreSQL" >/dev/null

# ---- companies ------------------------------------------------------------------------

co() { id companies "$1"; }
h edit companies "$(co Lumenbank)" website=https://lumenbank.example linkedin=https://www.linkedin.com/company/lumenbank-demo industry=Banking size=3000-5000 headquarters=London founded=2015 "description=A UK bank that lives on your phone."
h edit companies "$(co "Kestrel Networks")" website=https://kestrel.example linkedin=https://www.linkedin.com/company/kestrel-networks-demo industry="Internet infrastructure" size=4000+ headquarters="San Francisco" founded=2009
h edit companies "$(co Quillnote)" website=https://quillnote.example linkedin=https://www.linkedin.com/company/quillnote-demo industry=Software size=50-200 headquarters="San Francisco" "description=An AI notetaker for meetings."
h edit companies "$(co "Orbit Metrics")" website=https://orbitmetrics.example industry=Observability size=5000+ headquarters="New York" founded=2010
h edit companies "$(co Fernwise)" website=https://fernwise.example linkedin=https://www.linkedin.com/company/fernwise-demo industry=Fintech size=5000+ headquarters=London founded=2011
h edit companies "$(co Openfield)" website=https://openfield.example industry="Developer tools" size=2000+ headquarters="All remote"
h edit companies "$(co "Northwind Labs")" website=https://northwind.example industry=Manufacturing size=10000+ headquarters=London
h edit companies "$(co "Skylark Deploy")" website=https://skylark.example industry="Developer tools" size=500-1000 headquarters="San Francisco"
h edit companies "$(co "Meridian Talent")" kind=agency website=https://meridiantalent.example industry="Recruitment and consulting" headquarters=London
h edit companies "$(co "Cobalt Mail")" website=https://cobaltmail.example industry=Privacy headquarters=Geneva founded=2014

# ---- people ------------------------------------------------------------------------------

h person quillnote "Sam Lee" --role hiring-manager
h person quillnote "Dana Kim" --role recruiter
h person quillnote "Alex Romero" --role interviewer
h person orbit "Léa Martin" --role recruiter
h person orbit "Tom Becker" --role interviewer
h person openfield "Nia Okafor" --role hiring-manager
h person fernwise "Priya Shah" --role recruiter
h person meridian "Jordan Hale" --role recruiter
h person northwind "Chris Park" --role hiring-manager
h person northwind "Maya Singh" --role recruiter
h person skylark "Ben Ortiz" --role recruiter
h person tidepool "Omar Haddad" --role referrer
h person granite "Kate Morrow" --role interviewer

pe() { id people "$1"; }
h edit people "$(pe 'Dana Kim')" title="Senior Technical Recruiter" email=dana.kim@quillnote.example phone="+44 20 7946 0123" linkedin=https://www.linkedin.com/in/dana-kim-demo location=London
h edit people "$(pe 'Sam Lee')" title="Engineering Manager, Core" linkedin=https://www.linkedin.com/in/sam-lee-demo location="San Francisco" "about=Runs the team behind transcription and summaries."
h edit people "$(pe 'Priya Shah')" title="Talent Partner" email=priya@fernwise.example
h edit people "$(pe 'Chris Park')" title="Director of Engineering" linkedin=https://www.linkedin.com/in/chris-park-demo
h edit people "$(pe 'Omar Haddad')" title="Staff Engineer" "note=Old colleague from the payments team; owes me a coffee."
h edit people "$(pe 'Jordan Hale')" title="Principal Consultant" phone="+44 20 7946 0000"

# ---- interview steps ----------------------------------------------------------------------

h step quillnote "Intro call with Dana" --at "-26d 11:00" --status passed
h step quillnote "Technical screen" --at "-19d 15:00" --status passed
h step quillnote "Pairing session" --at "-8d 14:00" --status passed
h step quillnote "System design" --at "+1d 15:00"
h step orbit "Recruiter call" --at "-33d 10:00" --status passed
h step orbit "Coding interview" --at "-21d 16:00" --status passed
h step orbit "Take-home" --at "+3d 18:00"
h step openfield "Hiring manager chat" --at "-15d 17:00" --status passed
h step openfield "Technical deep dive" --at "+6d 16:30"
h step fernwise "Recruiter call" --at "+2d 12:00"
h step meridian "Agency intro" --at "-10d 09:30" --status done
h step northwind "Final round" --at "-12d 10:00" --status passed
h step northwind "Offer call" --at "-3d 17:00" --status done
h step skylark "Onsite (virtual)" --at "-9d 14:00" --status passed
h step granite "Onsite" --at "-25d 10:00" --status failed
h step copperline "Phone screen" --at "-60d 13:00" --status cancelled

# ---- notes -----------------------------------------------------------------------------

# A note on a process, on a day: `note quillnote -8d "…"`.
note() { h new notes "process_id=$(id processes "$1")" "happened_on=$2" "body=$3"; }
note quillnote -19d "Dana says the team is 8 engineers, mostly Rust; the system design round is about the transcription pipeline."
note quillnote -8d "Pairing went well: we refactored a retry loop together."
note orbit -20d "Take-home is a small storage engine; 4 hours suggested."
note northwind -3d "Offer: £105k base, 15% bonus, £40k RSUs. Asked for a week to decide."
note skylark -5d "They can move on equity, not on base."
note tidepool -16d "Omar passed my CV to the infra lead."
note granite -50d "Feedback: strong coding, wanted more Kubernetes operations."

h new memos "title=Questions to ask every team" "body=- What does on-call look like?
- How are decisions written down?
- What did the last person in this role move on to?" >/dev/null 2>&1 || true
h new memos "title=Salary floor" "body=Not below £75k base for a permanent role, or £90k a year for a contract." >/dev/null 2>&1 || true

# ---- emails ------------------------------------------------------------------------------

day() { # a day, n days back, as an email Date header's
  if date -v-1d >/dev/null 2>&1; then date -v-"$1"d "+%a, %d %b %Y 10:15:00 +0100"
  else date -d "-$1 days" "+%a, %d %b %Y 10:15:00 +0100"; fi
}
cat >"$WORK/m1.eml" <<EOF
From: Dana Kim <dana.kim@quillnote.example>
To: me@example.com
Subject: Next steps with Quillnote
Date: $(day 20)
Message-ID: <demo-1@quillnote.example>

Hi,

Thanks for your time on the technical screen: the team enjoyed it. The next step is a pairing session with Alex. Could you send your availability for next week?

Best,
Dana
EOF
cat >"$WORK/m2.eml" <<EOF
From: Me <me@example.com>
To: Dana Kim <dana.kim@quillnote.example>
Subject: Re: Next steps with Quillnote
Date: $(day 19)
Message-ID: <demo-2@example.com>
In-Reply-To: <demo-1@quillnote.example>

Hi Dana,

Great to hear. Tuesday or Wednesday afternoon works best.

Thanks!

> Could you send your availability for next week?
EOF
cat >"$WORK/m3.eml" <<EOF
From: Maya Singh <maya.singh@northwind.example>
To: me@example.com
Subject: Your offer from Northwind Labs
Date: $(day 3)
Message-ID: <demo-3@northwind.example>

Hello,

We're delighted to offer you the Staff Engineer role. The details are attached in the offer letter: £105,000 base, a 15% target bonus, and £40,000 in RSUs over four years.

Please let us know by the end of next week.

Kind regards,
Maya
EOF
h mail import quillnote "$WORK/m1.eml"
h mail import quillnote "$WORK/m2.eml"
h mail import northwind "$WORK/m3.eml"

# ---- files ---------------------------------------------------------------------------------

pdf() { # a one-page PDF saying $2, at $1
  printf '%%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 60>>stream\nBT /F1 24 Tf 72 760 Td (%s) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%%%EOF\n' "$2" >"$1"
}
pdf "$WORK/Resume.pdf" "Resume - general"
h upload Resume "$WORK/Resume.pdf" --kind resume --tag general -n "the one to start from"
pdf "$WORK/Resume.pdf" "Resume - Rust focused"
h upload Resume "$WORK/Resume.pdf" --tag rust-focused
pdf "$WORK/Resume.pdf" "Resume - platform focused"
h upload Resume "$WORK/Resume.pdf" --tag platform
printf 'Dear hiring team,\n\nI would love to join Quillnote to work on the Rust services behind your notes.\n' >"$WORK/Cover letter - Quillnote.txt"
h upload "Cover letter - Quillnote" "$WORK/Cover letter - Quillnote.txt" --kind cover-letter
pdf "$WORK/Offer letter.pdf" "Northwind Labs - offer letter"
h upload "Northwind Labs offer letter" "$WORK/Offer letter.pdf" --kind offer
pdf "$WORK/Contract.pdf" "Meridian Talent - contract terms"
h upload "Meridian Talent contract" "$WORK/Contract.pdf" --kind contract
printf 'Granite Systems onsite feedback\n\n- Strong coding\n- Wanted more Kubernetes operations\n' >"$WORK/feedback.txt"
h upload "Granite Systems feedback" "$WORK/feedback.txt" --kind feedback
printf 'System design checklist\n\n1. Requirements and numbers\n2. API\n3. Data model\n4. Scaling and failure\n' >"$WORK/checklist.md"
h upload "System design checklist" "$WORK/checklist.md" --kind candidate-resource
# A small picture: a green square.
printf 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR42u3NMQEAAAgDoK1/aIeQCwQgr+QCAQKBQCAQCAQCgUAgEOgCrSgCIRKRxGsAAAAASUVORK5CYII=' |
  openssl base64 -d -A >"$WORK/offer-portal.png"
h upload "Skylark Deploy offer portal" "$WORK/offer-portal.png" --kind screenshot
pdf "$WORK/portfolio.pdf" "Selected projects"
h upload Portfolio "$WORK/portfolio.pdf" --kind portfolio

h attach quillnote Resume
h attach quillnote "Cover letter - Quillnote"
h attach northwind Resume

# ---- tags ------------------------------------------------------------------------------------

h tag applications "$(app Quillnote)" +rust +dream
h tag applications "$(app "Kestrel Networks")" +rust
h tag applications "$(app "Cobalt Mail")" +rust
h tag applications "$(app "Orbit Metrics")" +take-home
h tag applications "$(app Openfield)" +remote-first
h tag applications "$(app Brightforge)" +remote-first
h tag applications "$(app "Northwind Labs")" +offer-in-hand
h tag applications "$(app "Skylark Deploy")" +offer-in-hand +remote-first
h tag companies "$(co Quillnote)" +ai
h tag companies "$(co "Tidepool AI")" +ai
h tag companies "$(co Fernwise)" +fintech
h tag companies "$(co Lumenbank)" +fintech
h tag people "$(pe 'Omar Haddad')" +friend
tg() { id tags "$1"; }
h edit tags "$(tg rust)" color=amber
h edit tags "$(tg dream)" color=violet
h edit tags "$(tg remote-first)" color=blue
h edit tags "$(tg offer-in-hand)" color=green
h edit tags "$(tg take-home)" color=red
h edit tags "$(tg fintech)" color=grey

# ---- cycles: this autumn's search, a remote one beside it, and one that ended ----------------

autumn=$("$HUNT" list cycles | head -1 | sed -E 's/^#([0-9]+).*/\1/')
h edit cycles "$autumn" name="Autumn 2026" started_on=-95d description="Senior backend roles in London, fintech first."
remote=$(api POST cycles/start '{"name": "Remote, Europe", "description": "Fully remote roles with EU companies. Flexibility over pay."}' | num)
h edit cycles "$remote" started_on=-50d
for c in Brightforge Openfield "Skylark Deploy"; do
  h edit processes "$(id processes "$c")" "cycle_id=$remote"
done
# Spring 2025: ended with an offer accepted, its board kept.
spring=$(api POST cycles/start '{"name": "Spring 2025", "started_on": "2025-01-13"}' | num)
for c in "Cobalt Systems|Senior Engineer|4" "Larkspur|Backend Engineer|4" "Halden Bank|Platform Engineer|3" "Pinewood|Rust Engineer|2" "Moorfield|Software Engineer|1"; do
  name=${c%%|*}; rest=${c#*|}; role=${rest%%|*}; at=${rest#*|}
  stage=$("$HUNT" list stages | sed -n "${at}p" | sed -E 's/^#([0-9]+).*/\1/')
  api POST processes "{\"company\": \"$name\", \"title\": \"$role\", \"cycle_id\": $spring, \"stage_id\": $stage}" >/dev/null
done
accepted=$(id processes "Cobalt Systems")
api POST "cycles/$spring/end" "{\"outcome\": \"offer\", \"process_id\": $accepted}" >/dev/null
h edit cycles "$spring" ended_on=2025-04-03

# ---- interviews' details, reminders, links, prep and stories ---------------------------------

h edit steps "$(id steps "System design")" minutes=60 format="Video call" place=meet.example/qn-sysdesign \
  prep_note="Transcription pipeline: queueing, retries, how to scale speaker diarisation."
h edit steps "$(id steps "Technical deep dive")" minutes=90 format="Video call"
qn=$(id processes Quillnote)
qnapp=$(app Quillnote)
h next quillnote "Send Dana two references" --due +1d
h new links "application_id=$qnapp" url=https://careers.quillnote.example/portal/8841 kind=portal "label=Candidate portal"
h new links "application_id=$qnapp" url=https://quillnote.example/blog/how-we-interview kind=prep "label=How we interview engineers"
sd=$(id steps "System design")
h new prep "title=Design a transcription pipeline end to end, on paper, in 45 minutes" kind=exercise "step_id=$sd" priority=high minutes=60
h new prep "title=Re-read stream processing: exactly-once, backpressure, windowing" kind=read "step_id=$sd" priority=high minutes=120 status=doing url=https://notes.example/stream-processing
h new prep "title=Questions for Sam about on-call and the team's roadmap" kind=questions "step_id=$sd" minutes=15
h new prep "title=Quillnote engineering talk on speaker diarisation" kind=watch "step_id=$sd" minutes=30 status=done confidence=solid
h new prep "title=Mock system design with Lina" kind=mock "step_id=$sd" priority=high minutes=60 status=done confidence=shaky
h new prep "title=Take-home: compaction for the storage engine" kind=exercise "step_id=$(id steps Take-home)" priority=high minutes=240 status=doing
h new prep "title=Write up the Postgres migration for the deep dive" kind=practise "step_id=$(id steps "Technical deep dive")" priority=high minutes=60
h new prep "title=Two graph problems" kind=practise repeats=daily minutes=60
h new prep "title=Async Rust: pinning and cancellation" kind=read priority=low minutes=60 url=https://rust.example/async-book/pinning
h new prep "title=Notes on negotiating an offer: anchors, competing offers, total pay" kind=read minutes=30 status=done confidence=ok
h new stories "title=Cut p99 latency of the billing API by 60%" themes="Impact, Ownership" "told=Quillnote, Fernwise" \
  "situation=Billing calls timed out at month end, and finance closed the books a day late." \
  "task=Find the cause and fix it without a rewrite, before the next close." \
  "action=Profiled the hot path, found an N+1 query and a lock held across a network call, fixed both, and added a load test to CI." \
  "result=p99 went from 2.4 s to 0.9 s; the next close finished on time."
h new stories "title=Moved Postgres 12 to 16 with no downtime" themes="Leadership, Planning" \
  "situation=Our main database was two versions behind and out of support." \
  "task=Lead a three-person upgrade without a maintenance window." \
  "action=Planned logical replication to a new cluster, rehearsed the cutover twice, and wrote the rollback first." \
  "result=Cut over in eleven seconds of read-only time; no incidents."
h new stories "title=Disagreed with a staff engineer about the queue design" themes="Conflict, Influence" told=Openfield \
  "situation=A staff engineer wanted Kafka for a workload of a few hundred messages a minute." \
  "task=Push back without stalling the project." \
  "action=Wrote a one-page comparison with costs, ran both for a week, and brought numbers to the design review." \
  "result=We went with Postgres-backed queues; the staff engineer co-wrote the follow-up."

# ---- settings ---------------------------------------------------------------------------------
# Living in the UK (England), so Take-home pay opens on its calculator.
curl -fs -o /dev/null -X PATCH -H "Content-Type: application/json" \
  -d '{"uk_resident": true, "uk_region": "rest", "desired_take_home": 5000, "desired_take_home_per": "month"}' "$HUNT_URL/api/settings"
# Set up already: the board, not a new hunt's launcher.
curl -fs -o /dev/null -X POST "$HUNT_URL/api/setup/done"

# ---- into place -----------------------------------------------------------------------------

kill $SERVER 2>/dev/null; wait $SERVER 2>/dev/null || true

# When things were added: weeks back, so Stats has history. Each line is
# company|days ago|days it ran before being archived.
echo "$AGES" | while IFS='|' read -r company ago ran; do
  [ -n "$company" ] || continue
  when="strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime', '-$ago days', '-$((ago * 37 % 600)) minutes')"
  apps="(SELECT a.id FROM application a JOIN company c ON c.id = a.company_id WHERE c.name = '$company')"
  ended=""
  [ -z "$ran" ] || ended=", updated_at = strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime', '-$((ago - ran)) days')"
  sqlite3 "$NEW" "UPDATE company SET created_at = $when WHERE name = '$company';
    UPDATE application SET created_at = $when WHERE id IN $apps;
    UPDATE process SET created_at = $when$ended WHERE application_id IN $apps;"
done

# Spring 2025's processes, added when it ran; and a streak on the daily drill.
sqlite3 "$NEW" "UPDATE process SET created_at = '2025-02-03T10:00:00', updated_at = '2025-04-03T09:00:00',
    applied_on = '2025-02-03' WHERE cycle_id = $spring;
  UPDATE application SET created_at = '2025-02-03T10:00:00' WHERE id IN (SELECT application_id FROM process WHERE cycle_id = $spring);
  UPDATE prep_item SET streak = 6, last_done_on = date('now', 'localtime', '-1 day') WHERE repeats = 'daily';"

mkdir -p "$(dirname "$DB")"
rm -f "$DB" "$DB-wal" "$DB-shm"
mv "$NEW" "$DB"
for x in wal shm; do [ ! -f "$NEW-$x" ] || mv "$NEW-$x" "$DB-$x"; done
echo "demo: done, in $DB"
