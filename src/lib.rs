//! hunt: track a job search as a board of hiring processes.
//!
//! One service (`hunt serve`) owns the SQLite database and serves a JSON API
//! ([`api`]). The web UI and the CLI are both clients of that API.

pub mod api;
pub mod auth;
pub mod backup;
pub mod choices;
pub mod client;
pub mod cycles;
pub mod db;
pub mod equity;
pub mod error;
pub mod experiments;
pub mod files;
pub mod fx;
pub mod google;
pub mod lookup;
pub mod mail;
pub mod posting;
pub mod prep;
pub mod resource;
pub mod scope;
pub mod service;
pub mod setup;
pub mod site;
pub mod stats;
pub mod store;
pub mod system;
pub mod takehome;
pub mod tenants;
pub mod time;

pub use db::{Db, Record};
pub use error::{Error, Result};
