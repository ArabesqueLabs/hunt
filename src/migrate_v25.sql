-- Schema 24 to 25 (SQLite): every hunt has accounts now, signing in with an
-- email address and a password of their own (or through Cloudflare Access,
-- or a sign-in proxy). The password's kept as its Argon2 hash; none, for an
-- account that signs in elsewhere, or was invited and hasn't yet.
ALTER TABLE account ADD COLUMN password_hash TEXT;
