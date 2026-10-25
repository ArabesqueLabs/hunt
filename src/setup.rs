//! A new hunt's launcher, and one person's hunt's owner.
//!
//! On a database hunt has just made, the web UI opens on the launcher: the
//! owner's account (an email address and a password), the settings, the
//! first job search (a cycle: a new database has none until then); or a
//! backup restored. The database says it's new (`setup.pending`) from when
//! it's made until the launcher's done (`POST /api/setup/done`).
//!
//! The owner is the hunt's first account (account 1, an admin: see
//! [`crate::tenants`]), who signs in to it and runs it. Until there's one,
//! the web UI shows only the launcher's account step, a hunt from before
//! accounts included; or `HUNT_ADMIN_EMAIL` and `HUNT_ADMIN_PASSWORD` make
//! one when hunt starts. A new hunt's closed to anyone else (sign-ups,
//! closed) until its owner opens it, or invites someone.

use crate::db::Db;
use crate::error::Result;

/// Set while a new hunt is being set up.
pub const PENDING: &str = "setup.pending";
/// Where hunts kept their owner before they had accounts (an address, and a
/// password's hash): moved into account 1 when hunt starts.
pub const EMAIL: &str = "auth.email";
pub const PASSWORD: &str = "auth.password";

impl Db {
    /// A new database: the launcher, once it's opened; and sign-ups closed,
    /// so it's its owner's alone until they say otherwise (Admin → Access
    /// and accounts). A hunt-wide setting: nobody's (owner 0).
    pub(crate) fn mark_new(&self) -> Result<()> {
        self.set_setting(PENDING, Some("1"))?;
        self.exec(
            "INSERT INTO setting (owner_id, name, value) /* all owners */ VALUES (0, 'tenancy.signups', 'closed')",
            &[],
        )?;
        Ok(())
    }

    /// Whether the launcher hasn't been through yet.
    pub fn needs_setup(&self) -> Result<bool> {
        Ok(self.setting(PENDING)?.is_some())
    }

    /// The launcher's done (or skipped): the board from now on.
    pub fn finish_setup(&self) -> Result<()> {
        self.set_setting(PENDING, None)
    }
}
