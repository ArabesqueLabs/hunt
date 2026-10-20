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
- **One person's hunt** has no sign-in of its own: keep it on your machine,
  or put it behind something that has one.
