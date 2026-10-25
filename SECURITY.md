# Security

## Reporting a vulnerability

Please don't open a public issue for a security problem. Report it
privately, with GitHub's private vulnerability reporting for this
repository (Security → Report a vulnerability), or by email to
hello@arabesquelabs.com.

Say what you found, how to reproduce it, and what it lets someone do. We'll
acknowledge it within a few days, keep you posted, and credit you when it's
fixed, if you'd like.

## What's in scope

The latest release of hunt, and Arabesque Labs' hosted hunt. Of most
interest: anything that lets one person see or change another's data in a
shared hunt, getting past sign-in, or reading the server's files.

Please test against your own copy of hunt, not other people's data, and
don't degrade the hosted service while testing.

## Running hunt safely

- **Several people in one hunt** relies on Cloudflare Access to say who's
  asking: run it only behind Access, with `--access-team` and
  `--access-aud` set, so hunt checks Access's signed tokens.
- **`--identity-header`** trusts a request header to say who someone is.
  It's for trying hunt out on your own machine, never for a hunt others can
  reach.
- **Every hunt** has accounts, signing in with an email address and a
  password (Argon2 hashes in the database, never in a backup). The first,
  its owner and admin, is made in the launcher or from `HUNT_ADMIN_EMAIL`
  and `HUNT_ADMIN_PASSWORD`; until then, nothing needs signing in: make
  them before hunt can be reached from elsewhere, and put it behind HTTPS.
  A new hunt's sign-ups are closed until an admin opens them.
- **`--auth-header`** takes a sign-in proxy's word for who someone is, only
  from `--trusted-proxies`: keep that list to the proxy, and hunt's own port
  off the internet.
