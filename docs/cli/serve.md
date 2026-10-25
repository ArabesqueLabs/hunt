# hunt serve

Run the service: hunt's JSON API and its web UI, on one address. Every other command talks to a running `hunt serve`.

## Examples

```sh
hunt serve                                   # http://127.0.0.1:4848, database ~/.hunt/hunt.db
hunt serve --addr 0.0.0.0:4848 --db /data/hunt.db
hunt serve --db postgres://hunt:secret@localhost/hunt
hunt serve --tenants --admins you@example.com --access-team yourteam --access-aud <AUD tag>
```

## Good to know

- `--addr` says where it listens: `127.0.0.1` keeps it to this computer. Anywhere else, give it a sign-in: its owner's account for one person (made in the launcher, or with `--admin-email` and `--admin-password`); for several, Cloudflare Access, or a sign-in proxy's header (`--auth-header`, from `--trusted-proxies`). See [What's public, and what needs signing in](../../README.md#whats-public-and-what-needs-signing-in).
- `--db` is a SQLite file (made if new), or a PostgreSQL or MySQL address: see [The database](../../README.md#the-database).
- `--tenants` serves several people, each with their own search, signing in through Cloudflare Access: see [Several people](../../README.md#several-people-multi-user).
- Every option can be set in the environment instead (`HUNT_ADDR`, `HUNT_DB`, …), as containers do.

## Help

<!-- help: hunt serve -->
```text
Run the service: the API and the web UI

Usage: hunt serve [OPTIONS]

Options:
      --addr <ADDR>
          [env: HUNT_ADDR=] [default: 127.0.0.1:4848]
      --url <URL>
          Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
      --db <DB>
          The database: a SQLite file, or a postgres://user:pass@host/db or mysql://user:pass@host/db address [default: ~/.hunt/hunt.db] [env: HUNT_DB=]
      --admins <ADMINS>
          Admins, by email, comma-separated, made when hunt starts (the first is account 1, if there's none). Others are made admins in Admin [env: HUNT_ADMINS=]
      --access-team <ACCESS_TEAM>
          People sign in through Cloudflare Access, as well as hunt's own sign-in: your Zero Trust team (its name, or name.cloudflareaccess.com) [env: HUNT_ACCESS_TEAM=]
      --access-aud <ACCESS_AUD>
          With --access-team: the Access application's audience (AUD) tag [env: HUNT_ACCESS_AUD=]
      --admin-email <ADMIN_EMAIL>
          The hunt's owner, made when hunt starts (instead of in its launcher): their email address, with --admin-password. They sign in at /login, and run the hunt (an admin) [env: HUNT_ADMIN_EMAIL=]
      --admin-password <ADMIN_PASSWORD>
          With --admin-email: the owner's password, 8 characters or more. Given again, it replaces theirs: the way back in when it's forgotten [env: HUNT_ADMIN_PASSWORD]
      --auth-header <AUTH_HEADER>
          Instead of Access: a sign-in proxy (Authelia, Authentik, oauth2-proxy, Tailscale) names who's asking in this header (e.g. Remote-Email), taken only from --trusted-proxies [env: HUNT_AUTH_HEADER=]
      --trusted-proxies <TRUSTED_PROXIES>
          With --auth-header: the addresses the sign-in proxy's requests come from, or ranges (10.0.0.0/8), comma-separated [default: this machine, 127.0.0.1 and ::1] [env: HUNT_TRUSTED_PROXIES=]
      --experiment <EXPERIMENTS>
          Turn on an experiment, a feature still being tried out: `name` for everyone, or `name=you@example.com,…` for those accounts. Repeat it for several (in HUNT_EXPERIMENTS, separate them with `;`). There are none now (take-home has become a feature, and is still taken) [env: HUNT_EXPERIMENTS=]
  -h, --help
          Print help
```
