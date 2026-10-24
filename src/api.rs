//! The HTTP service: a JSON API under `/api`, and the web UI, which is a
//! client of that API like the CLI is.
//!
//! Every resource in [`crate::resource`] gets:
//!
//! | | |
//! |---|---|
//! | `GET /api/{resource}?q=&limit=&{field}=` | list, searched and filtered |
//! | `POST /api/{resource}` | create |
//! | `GET /api/{resource}/{id}` | read |
//! | `PATCH /api/{resource}/{id}` | update the fields given (`null` or `""` clears) |
//! | `DELETE /api/{resource}/{id}` | delete |
//!
//! And beyond those:
//!
//! | | |
//! |---|---|
//! | `GET /api/meta` | the resources and their fields |
//! | `GET /api/board?archived_since=` | stages with their active cards, and the archived ones |
//! | `POST /api/processes` | also takes a new application's fields and `company` by name |
//! | `POST /api/processes/bulk` | `{ids, action, …}`: several at once, all or nothing: `move` (`stage_id`, `lane_id`), `archive` (`reason`, `note`), `resume`, `tag`/`untag` (`tags`), `set` (`fields`), `delete`; `restore` (`states`, a change's `before`) undoes one |
//! | `POST /api/{resource}/bulk-tags`, `POST /api/{resource}/bulk-delete` | `{ids, add, remove}`, `{ids}`: tag, untag or delete several records, all or nothing |
//! | `POST /api/processes/{id}/move` | `{stage_id, lane_id?, index?}`: drag and drop, into a lane of the stage or not; resumes an archived one |
//! | `GET /api/processes/{id}/detail` | a process with its application, company, people, files, steps, notes, activity |
//! | `GET, POST /api/processes/{id}/files` | versions sent with it; add by `version_id`, or `document_id` for the latest |
//! | `DELETE /api/processes/{id}/files/{version_id}` | take one off |
//! | `POST /api/documents/{id}/versions?filename=&tag=&note=` | upload a new version: the body is the file |
//! | `GET /api/versions/{id}/file?download=` | a version's file |
//! | `GET /api/versions/{id}/uses` | the processes a version was sent with |
//! | `GET, POST /api/processes/{id}/people` | who's involved; add by `person_id` or `name`, with `role` |
//! | `PATCH, DELETE /api/processes/{id}/people/{person_id}` | change someone's role, or take them off |
//! | `POST /api/stages/order` | `{ids: [...]}`: reorder the columns |
//! | `POST /api/stages/{id}/lanes/order` | `{ids}`: a stage's lanes, top to bottom |
//! | `POST /api/swimlanes/order` | `{ids}`: the board's swimlanes, top to bottom |
//! | `GET /docs`, `/screenshots`, `/privacy`, `/terms`, `/data-deletion`, `/ar/…` | the website's pages, which hunt once served: redirected there (`HUNT_SITE_URL`); without a website, the docs on GitHub |
//! | `DELETE /api/account` | delete your own account and everything in it (`{confirm: your email}`) |
//! | `GET /api/account`, `POST /api/account/request` | with several people (`--tenants`): who's asking and their account; ask for one (`{name, reason, provider, agrees}`: agreeing to the terms of use) |
//! | `PATCH /api/admin/settings` | admins: `{site}`, this hunt's `name`, an `announcement` on every page and a `contact` address for help; `{signups_open}`, whether new people may ask for an account; `{defaults}`, the language, region, time zone and currency new accounts start with |
//! | `POST /api/admin/invites` | admins: `{email, name?}`, an account for someone, open for sign-ups or not |
//! | `GET /api/admin/usage` | admins: each account's use of hunt (counts and sizes; no names or addresses) |
//! | `GET /api/admin/overview`, `POST /api/admin/accounts/{id}/decide`, `PATCH, DELETE /api/admin/accounts/{id}?data=` | admins: every account; approve, reject, disable or enable (`{status, note}`); change role, name or CLI token; remove (with `data=1`, everything of theirs) |
//! | `GET /api/system` | what hunt uses: memory, CPU, the database's size and its disk |
//! | `GET /api/stats` | numbers for the Stats page: totals, how far processes got, the weeks, outcomes, sources, pay, time, what's gone quiet |
//! | `GET /api/backup` | everything tracked, files included, as a JSON download (the Gmail connection left out) |
//! | `POST /api/backup?confirm=replace` | a backup as the body: replaces everything with it; how many rows each table now has |
//! | `GET/PATCH /api/settings` | one account's: `{theme: light\|dark\|auto, language, locale, numerals, clock, currency, timezone, week_start, work_hours, calendar_zones, uk_resident, uk_region, desired_take_home, desired_take_home_per, calendar_feed, bookmarklet_url, same_name: ask\|merge\|new}` |
//! | `GET/PUT/DELETE /api/mail` | the Gmail account (`{address, password, interval}`; signs in to check), the last sync, how much waits in triage |
//! | `PUT/DELETE /api/mail/google/client` | your Google OAuth client (the JSON file from Google Cloud), for signing in with Google |
//! | `GET /api/mail/google/start` | where to sign in with Google: `{url, redirect}`; Google returns to `/api/mail/google/callback` |
//! | `POST /api/mail/sync` | fetch new mail and match it to processes |
//! | `GET /api/emails?status=triage`, `GET /api/emails/{id}` | emails, with suggested processes; one with its text |
//! | `POST /api/emails/{id}/link` `{process_id}`, `…/unlink`, `…/ignore` `{rule?: sender\|domain}` | triage |
//! | `GET/POST /api/processes/{id}/emails` | a process's emails; POST an .eml file to add one |
//! | `GET /api/processes/{id}/mail` | its Gmail search (built, and its own), label, domains and people |
//! | `GET/DELETE /api/mail/ignores[/{id}]` | senders and domains ignored |
//! | `PUT /api/steps/{id}/people` | `{person_ids: [...]}`: who an interview step is with (steps list them as `people`) |
//! | `PUT /api/{resource}/{id}/tags` | `{tags: [names]}`: set what a record is tagged (applications, companies, people, documents); lists take `?tag=` |
//! | `DELETE /api/stages/{id}?move_to=` | delete a stage, moving its processes |
//! | `POST /api/applications` | also takes `company` by name, with `company_website` and `company_linkedin` |
//! | `GET /api/applications/same-posting?url=` | applications already tracking that posting link, however it was copied |
//! | `POST /api/applications/lookup` | `{url}`: what a job posting says, shaped as an application; saves nothing |
//! | `GET, PUT, DELETE /api/companies/{id}/logo` | a company's logo: the image; set it (the body is the image); remove it |
//! | `POST /api/companies/{id}/logo/fetch` | `{url}`: set the logo from an image's address, as an import found it |
//! | `POST /api/people/lookup` | `{url}`: what someone's LinkedIn profile says; saves nothing |
//! | `POST /api/people/from-page` | what the “Send to hunt” bookmark collected from a profile: who it's about; saves nothing |
//! | `GET, PUT, DELETE /api/people/{id}/photo`, `POST …/photo/fetch` | a person's photo, as for a company's logo |
//! | `POST /api/companies/lookup` | `{url}`: what a company's website or LinkedIn page says about it; saves nothing |
//! | `GET /api/calendar?from=&to=&q=&kinds=&status=` | dated things in time order: interview steps, next actions, deadlines, applied and posted dates |
//! | `GET /api/calendar.ics?kinds=` | the same as iCalendar, for calendar apps to subscribe to |
//! | `GET /api/activity?entity=&entity_id=&limit=` | the change log |
//! | `GET /api/take-home`, `POST /api/take-home/salary`, `POST /api/take-home/contract` | the take-home pay experiment (see [`crate::experiments`], [`crate::takehome`]): the tax years and choices; a salary's year, or the salary that leaves a take-home pay (`take_home`); a rate (`per` hour, day, week, month or year) inside and outside IR35, or the rate either side that leaves a take-home pay. Amounts in `currency` are turned to GBP at the day's rate. For anyone who may use hunt and lives in the UK (`uk_resident` in settings); a salary can bring a sign-on bonus, share `grants` (RSUs and options, vesting over the years, in their own `currency`), `benefits` in kind and a projection year by year (`raise`, `share_growth`, `refresher`, `years`) |
//! | `GET /api/suggest/{resource}/{field}?q=` | earlier values of a field |

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, FromRequestParts, Path, Query, State};
use axum::http::request::Parts;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::auth;
use crate::db::{Db, Record};
use crate::error::Error;
use crate::experiments::{self, Experiments};
use crate::files::{MAX_FILE, Picture, Upload};
use crate::resource::{self, RESOURCES, Resource};
use crate::service::{self, Move};
use crate::site;
use crate::takehome;
use crate::tenants::{Account, Denied, Identity, Tenants};

type Shared = Arc<Mutex<Db>>;

/// The service's state: the database, and, with several people, their
/// accounts.
#[derive(Clone)]
pub struct AppState {
    db: Shared,
    tenants: Option<Arc<Tenants>>,
    /// Its website (the docs and legal pages), who runs it, and its source.
    site: Arc<site::Site>,
    /// Features being tried out, and whom they're on for.
    experiments: Arc<Experiments>,
    /// One person's hunt's password, if it has one: the app and the API
    /// need signing in (see [`crate::auth`]).
    password: Option<Arc<auth::Password>>,
}

/// The database, as the request's account sees it: its own rows only (see
/// [`crate::scope`]). With one person's hunt, everything.
#[derive(Clone)]
pub struct Scoped {
    db: Shared,
    owner: Option<i64>,
}

/// A request turned away: not signed in (401), or without an account that
/// may use hunt (403, saying the account's status, for the page to explain).
fn denied(d: Denied) -> Response {
    match d {
        Denied::NotSignedIn(why) => (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": why, "account": "signed-out" })),
        )
            .into_response(),
        Denied::NoAccess { status, identity } => {
            let why = match status.as_str() {
                "pending" => "you're on the early access list, and not in yet",
                "rejected" => "your request for an account was turned down",
                "disabled" => "your account is disabled",
                _ => "you don't have an account here yet: ask for one",
            };
            (
                StatusCode::FORBIDDEN,
                Json(json!({ "error": why, "account": status, "email": identity.email })),
            )
                .into_response()
        }
    }
}

/// The address a request came from, as the server saw it: for a sign-in
/// proxy's header, which counts only from the proxy.
fn peer(parts: &Parts) -> Option<std::net::IpAddr> {
    parts
        .extensions
        .get::<axum::extract::ConnectInfo<std::net::SocketAddr>>()
        .map(|c| c.0.ip())
}

impl FromRequestParts<AppState> for Scoped {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let Some(t) = state.tenants.clone() else {
            return Ok(Scoped {
                db: state.db.clone(),
                owner: None,
            });
        };
        let headers = parts.headers.clone();
        let peer = peer(parts);
        match tokio::task::spawn_blocking(move || t.active(&headers, peer)).await {
            Ok(Ok((_, a))) => Ok(Scoped {
                db: state.db.clone(),
                owner: Some(a.id),
            }),
            Ok(Err(d)) => Err(denied(d)),
            Err(e) => Err(ApiError(Error::Db(e.to_string())).into_response()),
        }
    }
}

/// Whoever is asking, signed in or not, with an account or not: for the
/// page, `meta`, and asking for an account.
pub struct Viewer {
    app: AppState,
    identity: Option<Identity>,
    account: Option<Account>,
}

impl Viewer {
    /// Their database, if their account may use hunt (always, with one
    /// person's hunt).
    fn scoped(&self) -> Option<Scoped> {
        match (&self.app.tenants, &self.account) {
            (None, _) => Some(Scoped {
                db: self.app.db.clone(),
                owner: None,
            }),
            (Some(_), Some(a)) if a.status == "active" => Some(Scoped {
                db: self.app.db.clone(),
                owner: Some(a.id),
            }),
            _ => None,
        }
    }

    /// Whether an experiment is on for them: for someone whose account
    /// may use hunt, and is one it's on for (with one person's hunt, on if
    /// it's on at all).
    fn trying(&self, name: &str) -> bool {
        self.scoped().is_some()
            && self
                .app
                .experiments
                .on(name, self.account.as_ref().map(|a| a.email.as_str()))
    }

    /// The experiments on for them, by name.
    fn experiments(&self) -> Vec<&'static str> {
        experiments::KNOWN
            .iter()
            .map(|(n, _)| *n)
            .filter(|n| self.trying(n))
            .collect()
    }
}

impl FromRequestParts<AppState> for Viewer {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let Some(t) = state.tenants.clone() else {
            return Ok(Viewer {
                app: state.clone(),
                identity: None,
                account: None,
            });
        };
        let headers = parts.headers.clone();
        let peer = peer(parts);
        let (identity, account) =
            tokio::task::spawn_blocking(move || match t.identify(&headers, peer) {
                Ok(who) => {
                    let account = t.account_of(&who).ok().flatten();
                    (Some(who), account)
                }
                Err(_) => (None, None),
            })
            .await
            .unwrap_or((None, None));
        Ok(Viewer {
            app: state.clone(),
            identity,
            account,
        })
    }
}

/// An admin, signed in: for the admin centre.
pub struct Admin {
    tenants: Arc<Tenants>,
    account: Account,
}

impl FromRequestParts<AppState> for Admin {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let Some(t) = state.tenants.clone() else {
            return Err(ApiError(Error::NotFound(
                "this hunt is one person's: there's no admin centre (start it with --tenants)"
                    .into(),
            ))
            .into_response());
        };
        let headers = parts.headers.clone();
        let peer = peer(parts);
        let check = t.clone();
        match tokio::task::spawn_blocking(move || check.active(&headers, peer)).await {
            Ok(Ok((_, a))) if a.is_admin() => Ok(Admin {
                tenants: t,
                account: a,
            }),
            Ok(Ok(_)) => Err((
                StatusCode::FORBIDDEN,
                Json(json!({ "error": "only admins can do that" })),
            )
                .into_response()),
            Ok(Err(d)) => Err(denied(d)),
            Err(e) => Err(ApiError(Error::Db(e.to_string())).into_response()),
        }
    }
}

pub struct ApiError(Error);

impl From<Error> for ApiError {
    fn from(e: Error) -> Self {
        ApiError(e)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match &self.0 {
            Error::NotFound(_) => StatusCode::NOT_FOUND,
            Error::Invalid(_) => StatusCode::UNPROCESSABLE_ENTITY,
            Error::Conflict(_) => StatusCode::CONFLICT,
            Error::Fetch(_) => StatusCode::BAD_GATEWAY,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, Json(json!({ "error": self.0.to_string() }))).into_response()
    }
}

type ApiResult = Result<Json<Value>, ApiError>;

fn ok(v: impl serde::Serialize) -> ApiResult {
    Ok(Json(serde_json::to_value(v).expect("serialisable")))
}

fn find(name: &str) -> Result<&'static Resource, ApiError> {
    resource::resource(name)
        .filter(|r| r.name == name)
        .ok_or_else(|| ApiError(Error::NotFound(format!("no such resource: {name}"))))
}

/// The whole service, ready to serve or to test: one person's hunt.
pub fn router(db: Db) -> Router {
    router_trying(db, Experiments::default())
}

/// One person's hunt, with experiments on (see [`crate::experiments`]).
pub fn router_trying(db: Db, experiments: Experiments) -> Router {
    routes(AppState {
        db: Arc::new(Mutex::new(db)),
        tenants: None,
        site: Arc::new(site::Site::default()),
        experiments: Arc::new(experiments),
        password: None,
    })
}

/// One person's hunt with a password: the app and the API need signing in.
pub fn router_with_password(db: Db, password: auth::Password) -> Router {
    routes(AppState {
        db: Arc::new(Mutex::new(db)),
        tenants: None,
        site: Arc::new(site::Site::default()),
        experiments: Arc::new(Experiments::default()),
        password: Some(Arc::new(password)),
    })
}

/// The whole service for several people sharing one database, each with an
/// account (see [`crate::tenants`]).
pub fn router_tenants(db: Arc<Mutex<Db>>, tenants: Tenants) -> Router {
    router_run_by(db, tenants, site::Site::default())
}

/// Several people's hunt, run by whoever `site` names: with its website's
/// terms of use, agreed to when asking for an account.
pub fn router_run_by(db: Arc<Mutex<Db>>, tenants: Tenants, site: site::Site) -> Router {
    routes(AppState {
        db,
        tenants: Some(Arc::new(tenants)),
        site: Arc::new(site),
        experiments: Arc::new(Experiments::default()),
        password: None,
    })
}

/// Several people's hunt, with experiments on for some of them.
pub fn router_tenants_trying(
    db: Arc<Mutex<Db>>,
    tenants: Tenants,
    experiments: Experiments,
) -> Router {
    routes(AppState {
        db,
        tenants: Some(Arc::new(tenants)),
        site: Arc::new(site::Site::default()),
        experiments: Arc::new(experiments),
        password: None,
    })
}

fn routes(state: AppState) -> Router {
    Router::new()
        // The app: its board at /, and each of its pages at its own path
        // (the fallback, below).
        .route("/", get(page))
        .route(
            "/about",
            get(|| async { axum::response::Redirect::permanent("/") }),
        )
        // Signing in with the password, for one person's hunt that has one.
        .route("/login", get(login_page).post(login))
        .route("/logout", get(logout).post(logout))
        .route("/docs", get(to_site))
        .route("/screenshots", get(to_site))
        .route("/privacy", get(to_site))
        .route("/terms", get(to_site))
        .route("/data-deletion", get(to_site))
        .route("/ar", get(to_site))
        .route("/ar/", get(to_site))
        .route("/ar/{*rest}", get(to_site))
        // Where the app was, under /app: there now, without it.
        .route("/app", get(drop_app))
        .route("/app/", get(drop_app))
        .route("/app/{*rest}", get(drop_app))
        .route("/app.js", get(script))
        .route("/editor.js", get(editor_script))
        .route("/style.css", get(style))
        .route("/logo.svg", get(icon))
        .route("/fonts/{name}", get(font))
        .route("/vendor/arabesque/{*path}", get(vendored))
        .route("/healthz", get(healthz))
        .route("/api/meta", get(meta))
        .route("/api/stats", get(stats))
        .route("/api/system", get(system))
        .route("/dev/as", get(dev_as))
        .route("/api/account", get(account).delete(delete_account))
        .route("/api/account/request", post(request_account))
        .route("/api/admin/overview", get(admin_overview))
        .route("/api/admin/settings", axum::routing::patch(admin_settings))
        .route("/api/admin/invites", post(admin_invite))
        .route("/api/admin/usage", get(admin_usage))
        .route("/api/admin/accounts/{id}/decide", post(admin_decide))
        .route(
            "/api/admin/accounts/{id}",
            axum::routing::patch(admin_change).delete(admin_remove),
        )
        .route("/api/board", get(board))
        .route("/api/activity", get(activity))
        .route("/api/calendar", get(calendar))
        .route("/api/calendar.ics", get(calendar_ics))
        .route("/api/calendar/{file}", get(shared_calendar))
        .route("/api/suggest/{resource}/{field}", get(suggest))
        .route("/api/take-home", get(take_home_options))
        .route("/api/take-home/salary", post(take_home_salary))
        .route("/api/take-home/contract", post(take_home_contract))
        .route("/api/cycles/overview", get(cycles_overview))
        .route("/api/cycles/start", post(start_cycle))
        .route("/api/cycles/{id}/end", post(end_cycle))
        .route("/api/cycles/{id}/resume", post(resume_cycle))
        .route("/api/prep/ready", get(prep_ready))
        .route("/api/prep/{id}/tick", post(tick_prep))
        .route("/api/stages/order", post(order_stages))
        .route("/api/swimlanes/order", post(order_swimlanes))
        .route("/api/stages/{id}/lanes/order", post(order_lanes))
        .route(
            "/api/steps/{id}/people",
            axum::routing::put(set_step_people),
        )
        .route("/api/{resource}/{id}/tags", axum::routing::put(set_tags))
        .route("/api/companies/lookup", post(lookup_company))
        .route(
            "/api/companies/{id}/logo",
            get(company_logo)
                .put(upload_logo)
                .delete(remove_logo)
                .layer(DefaultBodyLimit::max(crate::lookup::MAX_IMAGE + 64 * 1024)),
        )
        .route("/api/companies/{id}/logo/fetch", post(fetch_logo))
        .route("/api/people/lookup", post(lookup_person))
        .route("/api/people/from-page", post(person_from_page))
        .route(
            "/api/people/{id}/photo",
            get(person_photo)
                .put(upload_photo)
                .delete(remove_photo)
                .layer(DefaultBodyLimit::max(crate::lookup::MAX_IMAGE + 64 * 1024)),
        )
        .route("/api/people/{id}/photo/fetch", post(fetch_photo))
        .route("/api/applications/lookup", post(lookup_posting))
        .route("/api/applications/same-posting", get(same_posting))
        .route("/api/applications/{id}/gbp", post(refresh_gbp))
        .route("/api/processes/{id}/move", post(move_process))
        .route("/api/processes/{id}/detail", get(detail))
        .route("/api/processes/{id}/people", get(people).post(add_person))
        .route(
            "/api/processes/{id}/people/{person}",
            axum::routing::patch(set_role).delete(remove_person),
        )
        .route("/api/processes/{id}/files", get(process_files).post(attach))
        .route(
            "/api/processes/{id}/emails",
            get(process_emails).post(import_email),
        )
        .route("/api/processes/{id}/mail", get(process_mail))
        .route(
            "/api/mail",
            get(mail_status).put(connect_mail).delete(disconnect_mail),
        )
        .route("/api/mail/sync", post(sync_mail))
        .route(
            "/api/mail/google/client",
            axum::routing::put(set_google_client).delete(remove_google_client),
        )
        .route("/api/mail/google/start", get(google_start))
        .route(crate::google::CALLBACK, get(google_callback))
        .route("/api/settings", get(settings).patch(update_settings))
        .route(
            "/api/backup",
            get(backup)
                .post(restore)
                .layer(DefaultBodyLimit::max(1024 * 1024 * 1024)),
        )
        .route("/api/mail/ignores", get(mail_ignores))
        .route(
            "/api/mail/ignores/{id}",
            axum::routing::delete(remove_mail_ignore),
        )
        .route("/api/emails", get(list_emails))
        .route("/api/emails/{id}", get(get_email).delete(delete_email))
        .route("/api/emails/{id}/link", post(link_email))
        .route("/api/emails/{id}/unlink", post(unlink_email))
        .route("/api/emails/{id}/ignore", post(ignore_email))
        .route(
            "/api/processes/{id}/files/{version}",
            axum::routing::delete(detach),
        )
        .route(
            "/api/documents/{id}/versions",
            post(upload).layer(DefaultBodyLimit::max(MAX_FILE + 64 * 1024)),
        )
        .route("/api/versions/{id}/file", get(download))
        .route("/api/versions/{id}/uses", get(uses))
        .route("/api/processes/bulk", post(bulk_processes))
        .route("/api/{resource}/bulk-tags", post(bulk_tags))
        .route("/api/{resource}/bulk-delete", post(bulk_delete))
        .route("/api/{resource}", get(list).post(create))
        .route(
            "/api/{resource}/{id}",
            get(read).patch(update).delete(delete),
        )
        .fallback(not_routed)
        .layer(axum::middleware::map_response_with_state((), caching))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            signed_in,
        ))
        .with_state(state)
}

/// Several people sharing hunt: who its admins are, and how to tell who's
/// asking.
pub struct TenancyConfig {
    pub admins: Vec<String>,
    pub identity: crate::tenants::IdentitySource,
}

/// Serve on `addr` until ctrl-c: one person's hunt (behind `password`, if
/// it has one), or (with `tenancy`) several people's; with `experiments` on
/// for whom they name.
pub fn serve(
    db: Db,
    addr: &str,
    tenancy: Option<TenancyConfig>,
    experiments: Experiments,
    password: Option<auth::Password>,
) -> crate::error::Result<()> {
    crate::system::mark_started();
    // Uptime carries on across a rollout; then a heartbeat every minute.
    let _ = db.note_start();
    let runtime = tokio::runtime::Runtime::new()?;
    let site = Arc::new(site::Site::from_env()?);
    let state: Shared = Arc::new(Mutex::new(db));
    let tenants = match tenancy {
        Some(t) => Some(Arc::new(Tenants::open(
            state.clone(),
            &t.admins,
            t.identity,
        )?)),
        None => None,
    };
    let shared_hunt = tenants.is_some();
    let app = AppState {
        db: state.clone(),
        tenants,
        site,
        experiments: Arc::new(experiments),
        password: password.map(Arc::new),
    };
    runtime.block_on(async {
        let listener = tokio::net::TcpListener::bind(addr).await?;
        // Pay without a GBP figure yet (older data, or no rate at the time)
        // gets one, in the background.
        let pending = state.clone();
        tokio::task::spawn_blocking(move || {
            let _ = crate::fx::backfill(&pending);
            // Today's rate for the home currency, for showing pay in it.
            let home = {
                let db = pending.lock().unwrap_or_else(|e| e.into_inner());
                db.settings()
                    .ok()
                    .and_then(|s| s["currency"].as_str().map(String::from))
            };
            if let Some(home) = home {
                let _ = crate::fx::ensure_rate(&pending, &home, false);
            }
        });
        let alive = state.clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(std::time::Duration::from_secs(60));
            tick.tick().await;
            loop {
                tick.tick().await;
                let db = alive.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    db.lock().unwrap_or_else(|e| e.into_inner()).note_alive()
                })
                .await;
            }
        });
        // Mail syncs on its own, every so often, when Settings say so (one
        // person's hunt only, for now).
        let mail = state.clone();
        tokio::spawn(async move {
            if shared_hunt {
                return;
            }
            let mut tick = tokio::time::interval(std::time::Duration::from_secs(60));
            loop {
                tick.tick().await;
                let due = {
                    let db = mail.lock().unwrap_or_else(|e| e.into_inner());
                    mail_due(&db).unwrap_or(false)
                };
                if due {
                    let m = mail.clone();
                    let _ = tokio::task::spawn_blocking(move || crate::mail::sync(&m)).await;
                }
            }
        });
        // Each request's address, for a sign-in proxy's header, which counts
        // only from the proxy.
        axum::serve(
            listener,
            routes(app).into_make_service_with_connect_info::<std::net::SocketAddr>(),
        )
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
        Ok(())
    })
}

fn with_db<T>(
    state: &Scoped,
    f: impl FnOnce(&Db) -> crate::error::Result<T>,
) -> Result<T, ApiError> {
    let db = state.db.lock().unwrap_or_else(|e| e.into_inner());
    // As the request's account, until done.
    db.set_owner(state.owner);
    let out = f(&db).map_err(ApiError);
    db.set_owner(None);
    out
}

// --- the web UI ----------------------------------------------------------------

/// Anything else: a page of the web UI (its addresses are real paths, like
/// /applications/2), or, under /api/ or for a file, not found.
async fn not_routed(method: axum::http::Method, uri: axum::http::Uri, v: Viewer) -> Response {
    if method == axum::http::Method::GET && is_page(uri.path()) {
        return page(v).await.into_response();
    }
    ApiError(Error::NotFound(format!("nothing at {}", uri.path()))).into_response()
}

/// An address of the app's from when it lived under /app (a bookmark, the
/// "Send to hunt" bookmarklet): the same page, without it, with its query.
async fn drop_app(uri: axum::http::Uri) -> Response {
    let path = uri.path().strip_prefix("/app").unwrap_or("/");
    let path = if path.is_empty() { "/" } else { path };
    let query = uri.query().map(|q| format!("?{q}")).unwrap_or_default();
    axum::response::Redirect::permanent(&format!("{path}{query}")).into_response()
}

/// Whether an address is one of the app's pages: anything but a file, the
/// API, and the few addresses that need nobody (signing in, the health
/// check, and the website's old ones, which lead there).
fn is_page(path: &str) -> bool {
    let a_file = path
        .rsplit('/')
        .next()
        .is_some_and(|last| last.contains('.'));
    let open = matches!(
        path,
        "/login"
            | "/logout"
            | "/healthz"
            | "/about"
            | "/docs"
            | "/screenshots"
            | "/privacy"
            | "/terms"
            | "/data-deletion"
            | "/ar"
            | "/app"
            | "/dev/as"
    ) || ["/api/", "/ar/", "/app/"]
        .iter()
        .any(|p| path.starts_with(p));
    !a_file && !open
}

/// With a password: the app and the API only for whoever has signed in (the
/// cookie /login sets, or the CLI's `Authorization: Bearer` password). The
/// rest (the sign-in page, scripts, styles, fonts, the health check and
/// shared calendar links) needs nothing.
async fn signed_in(
    State(app): State<AppState>,
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    let Some(password) = app.password.clone() else {
        return next.run(req).await;
    };
    let path = req.uri().path();
    let guarded =
        is_page(path) || (path.starts_with("/api/") && !path.starts_with("/api/calendar/"));
    if !guarded || has_signed_in(&password, req.headers()) {
        return next.run(req).await;
    }
    if path.starts_with("/api/") {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "sign in first: this hunt has a password (the CLI sends HUNT_PASSWORD)" })),
        )
            .into_response();
    }
    let here = req
        .uri()
        .path_and_query()
        .map(|p| p.as_str())
        .unwrap_or("/");
    axum::response::Redirect::to(&format!("/login?next={}", percent(here))).into_response()
}

fn has_signed_in(password: &auth::Password, headers: &HeaderMap) -> bool {
    let bearer = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    if bearer.is_some_and(|b| password.matches(b)) {
        return true;
    }
    crate::tenants::cookie(headers, auth::COOKIE)
        .is_some_and(|s| password.valid(&s, jiff::Timestamp::now().as_second()))
}

/// A query string's value, made safe to put in an address.
fn percent(text: &str) -> String {
    text.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[derive(Deserialize)]
struct LoginQuery {
    next: Option<String>,
}

/// The sign-in page (only with a password: else, to the app).
async fn login_page(State(app): State<AppState>, Query(q): Query<LoginQuery>) -> Response {
    if app.password.is_none() {
        return axum::response::Redirect::to("/").into_response();
    }
    (
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        auth::login_page(&auth::safe_next(q.next.as_deref()), false),
    )
        .into_response()
}

#[derive(Deserialize)]
struct LoginForm {
    password: String,
    next: Option<String>,
}

/// Signing in: the right password sets the cookie and goes where they were
/// going; a wrong one waits a second, and asks again.
async fn login(
    State(app): State<AppState>,
    headers: HeaderMap,
    axum::Form(form): axum::Form<LoginForm>,
) -> Response {
    let Some(password) = app.password.clone() else {
        return axum::response::Redirect::to("/").into_response();
    };
    let next = auth::safe_next(form.next.as_deref());
    if !password.matches(&form.password) {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        return (
            StatusCode::UNAUTHORIZED,
            [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
            auth::login_page(&next, true),
        )
            .into_response();
    }
    let age = auth::SESSION_DAYS * 24 * 60 * 60;
    let until = jiff::Timestamp::now().as_second() + age;
    // Secure where hunt is reached over HTTPS (through a proxy that says so).
    let https = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|p| p.eq_ignore_ascii_case("https"));
    let cookie = format!(
        "{}={}; Path=/; Max-Age={age}; HttpOnly; SameSite=Lax{}",
        auth::COOKIE,
        password.session(until),
        if https { "; Secure" } else { "" }
    );
    (
        [(header::SET_COOKIE, cookie)],
        axum::response::Redirect::to(&next),
    )
        .into_response()
}

/// Signing out: the cookie, gone.
async fn logout() -> Response {
    (
        [(
            header::SET_COOKIE,
            format!(
                "{}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
                auth::COOKIE
            ),
        )],
        axum::response::Redirect::to("/login"),
    )
        .into_response()
}

/// A page that was hunt's and is now its website's (the docs, screenshots
/// and legal pages, in English and Arabic): there, at its address on the
/// website; without one, the docs on GitHub, and nothing else.
async fn to_site(State(app): State<AppState>, uri: axum::http::Uri) -> Response {
    let path = uri.path().trim_end_matches('/');
    let to = match (app.site.page(&format!("{path}/")), path) {
        (Some(page), _) => page,
        (None, "/docs") => app.site.docs(),
        _ => return StatusCode::NOT_FOUND.into_response(),
    };
    axum::response::Redirect::permanent(&to).into_response()
}

const LOGO: &str = include_str!("web/img/logo.svg");

/// The page, in the language chosen in Settings: its `lang` and direction
/// are set here, so it's drawn the right way round from the start (English,
/// left to right, unless another is chosen). The app draws the rest (the
/// web UI, built into web/dist: see web/vite.config.ts).
async fn page(v: Viewer) -> impl IntoResponse {
    static PAGE: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
        // Each build's script and styles at addresses of their own, so no
        // cache (the browser's, or Cloudflare's) serves an older one.
        let v = format!("?v={}", asset_fingerprint());
        let mut page = include_str!("web/index.html").to_string();
        for name in ASSET_NAMES {
            page = page.replace(&format!("\"{name}\""), &format!("\"{name}{v}\""));
        }
        page
    });
    // Someone without an account yet sees it in English.
    let chosen = v.scoped().and_then(|s| {
        with_db(&s, |db| db.setting("locale.language"))
            .ok()
            .flatten()
    });
    let (lang, _, dir) = service::LANGUAGES
        .iter()
        .find(|(code, _, _)| Some(*code) == chosen.as_deref())
        .copied()
        .unwrap_or(service::LANGUAGES[0]);
    (
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        PAGE.replacen(
            r#"<html lang="en" dir="ltr">"#,
            &format!(r#"<html lang="{lang}" dir="{dir}">"#),
            1,
        )
        .replace(
            "<!-- footer: legal/footer.html, put in when served -->",
            &v.app.site.footer(),
        ),
    )
}

/// The logo as the tab's icon, in the accent colour.
async fn icon() -> impl IntoResponse {
    static ICON: std::sync::LazyLock<String> =
        std::sync::LazyLock::new(|| LOGO.replace("currentColor", "oklch(45.5% .079 176)"));
    (
        [
            (header::CONTENT_TYPE, "image/svg+xml"),
            (header::CACHE_CONTROL, "public, max-age=86400"),
        ],
        ICON.as_str(),
    )
}

/// The web UI, built (`npm run build` in web/): React, in one script.
async fn script() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/javascript; charset=utf-8")],
        include_str!("web/dist/app.js"),
    )
}

/// The rich text editor (TinyMCE), a script of its own: app.js loads it,
/// at its own fingerprint, the first time an editor opens.
async fn editor_script() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/javascript; charset=utf-8")],
        include_str!("web/dist/editor.js"),
    )
}

/// The page's own script and styles, as it names them.
const ASSET_NAMES: &[&str] = &["/style.css", "/app.js"];

/// A fingerprint of the page's scripts and styles: the same while they
/// are, different once any changes.
fn asset_fingerprint() -> &'static str {
    static PRINT: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
        use std::hash::{Hash, Hasher};
        let mut h = std::hash::DefaultHasher::new();
        for part in [
            include_str!("web/dist/app.css"),
            include_str!("web/dist/app.js"),
            include_str!("web/dist/editor.js"),
        ] {
            part.hash(&mut h);
        }
        format!("{:012x}", h.finish() & 0xffff_ffff_ffff)
    });
    &PRINT
}

/// How long what's served may be kept, unless it says itself. Scripts and
/// styles: a year at an address with the fingerprint (`?v=`, which changes
/// when they do); otherwise not without asking again, so a new release is
/// never hidden behind an old copy. Pages: not without asking again either,
/// as they name this build's assets; the app's, in the person's language,
/// only by their own browser. The API: someone's own data, never kept at all.
async fn caching(uri: axum::http::Uri, mut res: Response) -> Response {
    if res.headers().contains_key(header::CACHE_CONTROL) {
        return res;
    }
    let path = uri.path();
    let html = res
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("text/html"));
    let value = if path.starts_with("/api/") {
        "private, no-store"
    } else if !res.status().is_success() {
        return res;
    } else if path.ends_with(".js") || path.ends_with(".css") || path.ends_with(".svg") {
        let fingerprinted = uri
            .query()
            .is_some_and(|q| q.split('&').any(|p| p.starts_with("v=")));
        if fingerprinted {
            "public, max-age=31536000, immutable"
        } else {
            "no-cache"
        }
    } else if html && is_page(path) {
        "private, no-cache"
    } else if html {
        "no-cache"
    } else {
        return res;
    };
    res.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static(value),
    );
    res
}

/// The styles: the design system's, then hunt's own, built with the web UI.
async fn style() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/css; charset=utf-8")],
        include_str!("web/dist/app.css"),
    )
}

/// The design system's icon sprite (the date picker's chevrons, the
/// sidebar's toggle, search, notices, the menu), as vendored: see
/// web/vendor/arabesque/README.md. Its scripts are built into the app.
async fn vendored(Path(path): Path<String>) -> Response {
    match path.as_str() {
        "dist/icons.svg" => (
            [(header::CONTENT_TYPE, "image/svg+xml")],
            include_str!("web/vendor/arabesque/dist/icons.svg"),
        )
            .into_response(),
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

/// The UI's typefaces, compiled in, so the app makes no outside requests.
async fn font(Path(name): Path<String>) -> Response {
    let data: &'static [u8] = match name.as_str() {
        "jost.woff2" => include_bytes!("web/fonts/jost.woff2"),
        "newsreader.woff2" => include_bytes!("web/fonts/newsreader.woff2"),
        "newsreader-italic.woff2" => include_bytes!("web/fonts/newsreader-italic.woff2"),
        "plex-arabic-400.woff2" => include_bytes!("web/fonts/plex-arabic-400.woff2"),
        "plex-arabic-500.woff2" => include_bytes!("web/fonts/plex-arabic-500.woff2"),
        "plex-arabic-600.woff2" => include_bytes!("web/fonts/plex-arabic-600.woff2"),
        "amiri.woff2" => include_bytes!("web/fonts/amiri.woff2"),
        _ => return StatusCode::NOT_FOUND.into_response(),
    };
    (
        [
            (header::CONTENT_TYPE, "font/woff2"),
            (header::CACHE_CONTROL, "public, max-age=31536000, immutable"),
        ],
        data,
    )
        .into_response()
}

// --- generic resources ---------------------------------------------------------

async fn meta(v: Viewer, headers: HeaderMap) -> ApiResult {
    // Someone without an account yet gets what's needed to ask for one.
    let (reasons, closed_stages) = match v.scoped() {
        Some(s) => with_db(&s, |db| Ok((db.archive_reasons()?, db.closed_stages()?)))?,
        None => (json!([]), json!([])),
    };
    // Behind Cloudflare Access, every request carries its signed assertion
    // (and, for a person, their email): the page offers to log out.
    let access = headers.contains_key("cf-access-jwt-assertion").then(|| {
        json!({ "email": headers.get("cf-access-authenticated-user-email").and_then(|v| v.to_str().ok()) })
    });
    // With several people: who's asking, and their account.
    let tenancy = v.app.tenants.is_some().then(|| {
        json!({
            // Trying it out (a trusted header): be someone at /dev/as.
            "trying_out": v.app.tenants.as_ref().is_some_and(|t| t.trusts_header()),
            "signed_in": v.identity.is_some(),
            "signups_open": v.app.tenants.as_ref().map(|t| t.signups_open().unwrap_or(true)),
            "email": v.identity.as_ref().and_then(|i| i.email.clone()),
            "account": v.account.as_ref().map(|a| json!({
                "id": a.id, "email": a.email, "name": a.name, "status": a.status, "role": a.role,
            })),
        })
    });
    // What the admins say of this hunt, to everyone (signed in or not).
    let about = match &v.app.tenants {
        Some(t) => t.site()?,
        None => json!({ "name": null, "announcement": null, "contact": null }),
    };
    ok(json!({
        "access": access,
        "tenancy": tenancy,
        "about": about,
        // Run for others, with a website whose terms of use people agree
        // to when asking for an account, and whose docs and legal pages the
        // app links to.
        "terms": v.app.site.url.is_some(),
        // Signed in with the password: the sidebar offers to log out.
        "password": v.app.password.is_some(),
        "site": v.app.site.url,
        // Who runs it, by name: for disclaimers.
        "operator": v.app.site.operator,
        // Features being tried out, on for them.
        "experiments": v.experiments(),
        "resources": RESOURCES,
        "archive_reasons": reasons,
        // The inactive stages, where closed processes are: `{id, name}`.
        "closed_stages": closed_stages,
        "same_name": service::SAME_NAME.iter().map(|(v, l)| json!({"value": v, "label": l})).collect::<Vec<_>>(),
        "tag_colors": resource::TAG_COLORS.iter().map(|(v, l)| json!({"value": v, "label": l})).collect::<Vec<_>>(),
        "calendar_kinds": service::CALENDAR_KINDS.iter().map(|(v, l)| json!({"value": v, "label": l})).collect::<Vec<_>>(),
        "version": env!("CARGO_PKG_VERSION"),
        "clocks": service::CLOCKS.iter().map(|(v, l)| json!({"value": v, "label": l})).collect::<Vec<_>>(),
        "week_starts": service::WEEK_STARTS.iter().map(|(v, l)| json!({"value": v, "label": l})).collect::<Vec<_>>(),
        "weekdays": service::WEEKDAYS.iter().map(|(v, l)| json!({"value": v, "label": l})).collect::<Vec<_>>(),
        "max_calendar_zones": service::MAX_CALENDAR_ZONES,
        "languages": service::LANGUAGES.iter().map(|(v, l, d)| json!({"value": v, "label": l, "dir": d})).collect::<Vec<_>>(),
        "numerals": service::NUMERALS.iter().map(|(v, l)| json!({"value": v, "label": l})).collect::<Vec<_>>(),
        "uk_regions": service::UK_REGIONS.iter().map(|(v, l)| json!({"value": v, "label": l})).collect::<Vec<_>>(),
        "person_roles": resource::PERSON_ROLES.iter().map(|(v, l)| json!({"value": v, "label": l})).collect::<Vec<_>>(),
    }))
}

async fn list(
    s: Scoped,
    Path(name): Path<String>,
    Query(mut q): Query<HashMap<String, String>>,
) -> ApiResult {
    let r = find(&name)?;
    let search = q.remove("q");
    let limit = q
        .remove("limit")
        .map(|l| l.parse::<usize>())
        .transpose()
        .map_err(|_| ApiError(Error::Invalid("limit: not a number".into())))?;
    let filters: Vec<(String, String)> = q.into_iter().collect();
    ok(with_db(&s, |db| {
        db.list(r, search.as_deref(), &filters, limit)
    })?)
}

async fn create(s: Scoped, Path(name): Path<String>, Json(body): Json<Record>) -> ApiResult {
    let r = find(&name)?;
    if matches!(r.entity, "process" | "application")
        && let Some(currency) = body.get("currency").and_then(Value::as_str)
    {
        rate_for(&s.db, currency, false).await;
    }
    if r.entity == "process" {
        return ok(with_db(&s, |db| db.add_process(&body))?);
    }
    if r.entity == "application" {
        return ok(with_db(&s, |db| db.add_application(&body))?);
    }
    ok(with_db(&s, |db| db.create(r, &body))?)
}

async fn read(s: Scoped, Path((name, id)): Path<(String, i64)>) -> ApiResult {
    let r = find(&name)?;
    ok(with_db(&s, |db| db.get(r, id))?)
}

async fn update(
    s: Scoped,
    Path((name, id)): Path<(String, i64)>,
    Json(body): Json<Record>,
) -> ApiResult {
    let r = find(&name)?;
    // Pay that's changing is converted to GBP at today's rate: have it ready.
    if r.entity == "application"
        && ["salary_min", "salary_max", "currency"]
            .iter()
            .any(|k| body.contains_key(*k))
    {
        let currency = match body.get("currency") {
            Some(c) => c.as_str().map(String::from),
            None => with_db(&s, |db| db.get(r, id))?
                .get("currency")
                .and_then(Value::as_str)
                .map(String::from),
        };
        if let Some(c) = currency {
            rate_for(&s.db, &c, false).await;
        }
    }
    ok(with_db(&s, |db| db.update(r, id, &body))?)
}

/// Make sure a currency's rate to GBP is cached, off the async workers and
/// without holding the database while fetching. A rate that can't be had
/// just leaves the GBP figures empty.
async fn rate_for(s: &Shared, currency: &str, force: bool) -> Option<Error> {
    let (s, currency) = (s.clone(), currency.to_string());
    tokio::task::spawn_blocking(move || crate::fx::ensure_rate(&s, &currency, force))
        .await
        .ok()
        .and_then(|r| r.err())
}

/// Convert an application's pay to GBP again, at today's rate.
async fn refresh_gbp(s: Scoped, Path(id): Path<i64>) -> ApiResult {
    let apps = resource::resource("applications").expect("known");
    let currency = with_db(&s, |db| db.get(apps, id))?
        .get("currency")
        .and_then(Value::as_str)
        .map(String::from)
        .ok_or_else(|| {
            ApiError(Error::Invalid(
                "this application's pay has no currency".into(),
            ))
        })?;
    if let Some(e) = rate_for(&s.db, &currency, true).await {
        return Err(ApiError(e));
    }
    ok(with_db(&s, |db| {
        db.convert_gbp(id)?;
        db.get(apps, id)
    })?)
}

#[derive(Deserialize)]
struct DeleteQuery {
    move_to: Option<i64>,
}

async fn delete(
    s: Scoped,
    Path((name, id)): Path<(String, i64)>,
    Query(q): Query<DeleteQuery>,
) -> ApiResult {
    let r = find(&name)?;
    if r.entity == "stage" {
        return ok(with_db(&s, |db| db.delete_stage(id, q.move_to))?);
    }
    ok(with_db(&s, |db| db.delete(r, id))?)
}

// --- the board -------------------------------------------------------------------

#[derive(Deserialize)]
struct BoardQuery {
    archived_since: Option<String>,
    /// One cycle's board, running or ended; without, every running one's.
    cycle: Option<i64>,
}

// --- cycles and prep ---------------------------------------------------------------

async fn cycles_overview(s: Scoped) -> ApiResult {
    ok(with_db(&s, |db| db.cycles_overview())?)
}

async fn start_cycle(s: Scoped, Json(body): Json<crate::cycles::Start>) -> ApiResult {
    ok(with_db(&s, |db| db.start_cycle(&body))?)
}

async fn end_cycle(
    s: Scoped,
    Path(id): Path<i64>,
    Json(body): Json<crate::cycles::End>,
) -> ApiResult {
    ok(with_db(&s, |db| db.end_cycle(id, &body))?)
}

async fn resume_cycle(s: Scoped, Path(id): Path<i64>) -> ApiResult {
    ok(with_db(&s, |db| db.resume_cycle(id))?)
}

async fn prep_ready(s: Scoped) -> ApiResult {
    ok(with_db(&s, |db| db.prep_ready())?)
}

#[derive(Deserialize)]
struct Tick {
    done: bool,
}

async fn tick_prep(s: Scoped, Path(id): Path<i64>, Json(t): Json<Tick>) -> ApiResult {
    ok(with_db(&s, |db| db.tick_prep(id, t.done))?)
}

async fn board(s: Scoped, Query(q): Query<BoardQuery>) -> ApiResult {
    ok(with_db(&s, |db| {
        db.board(
            q.archived_since.as_deref().filter(|d| !d.is_empty()),
            q.cycle,
        )
    })?)
}

async fn move_process(s: Scoped, Path(id): Path<i64>, Json(m): Json<Move>) -> ApiResult {
    ok(with_db(&s, |db| db.move_process(id, &m))?)
}

async fn detail(s: Scoped, Path(id): Path<i64>) -> ApiResult {
    ok(with_db(&s, |db| db.process_detail(id))?)
}

async fn people(s: Scoped, Path(id): Path<i64>) -> ApiResult {
    ok(with_db(&s, |db| db.process_people(id))?)
}

async fn add_person(s: Scoped, Path(id): Path<i64>, Json(body): Json<Record>) -> ApiResult {
    ok(with_db(&s, |db| db.add_person(id, &body))?)
}

async fn set_role(
    s: Scoped,
    Path((id, person)): Path<(i64, i64)>,
    Json(body): Json<Record>,
) -> ApiResult {
    ok(with_db(&s, |db| db.set_person_role(id, person, &body))?)
}

async fn remove_person(s: Scoped, Path((id, person)): Path<(i64, i64)>) -> ApiResult {
    ok(with_db(&s, |db| db.remove_person(id, person))?)
}

#[derive(Deserialize)]
struct Order {
    ids: Vec<i64>,
}

async fn order_stages(s: Scoped, Json(o): Json<Order>) -> ApiResult {
    ok(with_db(&s, |db| db.reorder_stages(&o.ids))?)
}

async fn order_swimlanes(s: Scoped, Json(o): Json<Order>) -> ApiResult {
    ok(with_db(&s, |db| db.reorder_swimlanes(&o.ids))?)
}

async fn bulk_processes(s: Scoped, Json(b): Json<service::Bulk>) -> ApiResult {
    ok(with_db(&s, |db| db.bulk_processes(&b))?)
}

#[derive(Deserialize)]
struct BulkTags {
    ids: Vec<i64>,
    #[serde(default)]
    add: Vec<String>,
    #[serde(default)]
    remove: Vec<String>,
}

async fn bulk_tags(s: Scoped, Path(resource): Path<String>, Json(b): Json<BulkTags>) -> ApiResult {
    ok(with_db(&s, |db| {
        db.bulk_tags(&resource, &b.ids, &b.add, &b.remove)
    })?)
}

#[derive(Deserialize)]
struct BulkDelete {
    ids: Vec<i64>,
}

async fn bulk_delete(
    s: Scoped,
    Path(resource): Path<String>,
    Json(b): Json<BulkDelete>,
) -> ApiResult {
    ok(with_db(&s, |db| db.bulk_delete(&resource, &b.ids))?)
}

async fn order_lanes(s: Scoped, Path(id): Path<i64>, Json(o): Json<Order>) -> ApiResult {
    ok(with_db(&s, |db| db.reorder_lanes(id, &o.ids))?)
}

#[derive(Deserialize)]
struct ActivityQuery {
    entity: Option<String>,
    entity_id: Option<i64>,
    limit: Option<usize>,
}

async fn activity(s: Scoped, Query(q): Query<ActivityQuery>) -> ApiResult {
    ok(with_db(&s, |db| {
        db.activity(q.entity.as_deref(), q.entity_id, q.limit.unwrap_or(100))
    })?)
}

#[derive(Deserialize)]
struct SuggestQuery {
    q: Option<String>,
}

async fn suggest(
    s: Scoped,
    Path((name, field)): Path<(String, String)>,
    Query(q): Query<SuggestQuery>,
) -> ApiResult {
    let r = find(&name)?;
    ok(with_db(&s, |db| {
        db.suggestions(r, &field, q.q.as_deref().unwrap_or(""))
    })?)
}

// --- files -----------------------------------------------------------------------

async fn process_files(s: Scoped, Path(id): Path<i64>) -> ApiResult {
    ok(with_db(&s, |db| db.process_files(id))?)
}

async fn attach(s: Scoped, Path(id): Path<i64>, Json(body): Json<Record>) -> ApiResult {
    ok(with_db(&s, |db| db.attach(id, &body))?)
}

async fn detach(s: Scoped, Path((id, version)): Path<(i64, i64)>) -> ApiResult {
    ok(with_db(&s, |db| db.detach(id, version))?)
}

#[derive(Deserialize)]
struct UploadQuery {
    filename: String,
    tag: Option<String>,
    note: Option<String>,
}

async fn upload(
    s: Scoped,
    Path(id): Path<i64>,
    Query(q): Query<UploadQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult {
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok());
    let up = Upload {
        filename: &q.filename,
        content_type,
        tag: q.tag.as_deref(),
        note: q.note.as_deref(),
        data: &body,
    };
    ok(with_db(&s, |db| db.upload(id, &up))?)
}

#[derive(Deserialize)]
struct DownloadQuery {
    download: Option<String>,
}

async fn download(
    s: Scoped,
    Path(id): Path<i64>,
    Query(q): Query<DownloadQuery>,
) -> Result<Response, ApiError> {
    let file = with_db(&s, |db| db.file(id))?;
    let disposition = if q.download.is_some() {
        "attachment"
    } else {
        "inline"
    };
    // A plain ASCII name for old clients, and the real one for the rest.
    let ascii: String = file
        .filename
        .chars()
        .map(|c| {
            if c.is_ascii_graphic() && c != '"' && c != '\\' || c == ' ' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let encoded: String = file
        .filename
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'.' | b'-' | b'_' => (b as char).to_string(),
            b => format!("%{b:02X}"),
        })
        .collect();
    // Files are served from the app's own origin so they can be previewed.
    // Anything that could run script (HTML, SVG, ...) is sandboxed: no
    // scripts, and an origin of its own. PDFs and plain images aren't, as
    // the browser's viewers need to run.
    let sandbox = !(file.content_type == "application/pdf"
        || matches!(
            file.content_type.as_str(),
            "image/png" | "image/jpeg" | "image/gif" | "image/webp"
        ));
    let mut res = (
        [
            (header::CONTENT_TYPE, file.content_type),
            (
                header::CONTENT_DISPOSITION,
                format!("{disposition}; filename=\"{ascii}\"; filename*=UTF-8''{encoded}"),
            ),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_string()),
        ],
        file.data,
    )
        .into_response();
    if sandbox {
        res.headers_mut().insert(
            header::CONTENT_SECURITY_POLICY,
            header::HeaderValue::from_static("sandbox"),
        );
    }
    Ok(res)
}

async fn uses(s: Scoped, Path(id): Path<i64>) -> ApiResult {
    ok(with_db(&s, |db| db.version_uses(id))?)
}

// --- importing company details ---------------------------------------------------

#[derive(Deserialize)]
struct Lookup {
    url: String,
}

/// Fetching another site takes a while; it runs off the async workers, and
/// without holding the database.
async fn lookup_company(Json(l): Json<Lookup>) -> ApiResult {
    let found = tokio::task::spawn_blocking(move || crate::lookup::fetch(&l.url))
        .await
        .map_err(|e| ApiError(Error::Fetch(format!("the lookup failed: {e}"))))??;
    ok(found)
}

/// A job posting, read from its link.
async fn lookup_posting(Json(l): Json<Lookup>) -> ApiResult {
    let found = tokio::task::spawn_blocking(move || crate::posting::fetch(&l.url))
        .await
        .map_err(|e| ApiError(Error::Fetch(format!("the lookup failed: {e}"))))??;
    ok(found)
}

#[derive(Deserialize)]
struct SamePosting {
    url: String,
}

async fn same_posting(s: Scoped, Query(q): Query<SamePosting>) -> ApiResult {
    ok(with_db(&s, |db| db.same_posting(&q.url))?)
}

// --- company logos -----------------------------------------------------------------

async fn company_logo(s: Scoped, Path(id): Path<i64>) -> Result<Response, ApiError> {
    let logo = with_db(&s, |db| db.logo(id))?;
    let mut res = (
        [
            (header::CONTENT_TYPE, logo.content_type.clone()),
            (header::CACHE_CONTROL, "private, max-age=86400".to_string()),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_string()),
        ],
        logo.data,
    )
        .into_response();
    if logo.content_type.contains("svg") {
        res.headers_mut().insert(
            header::CONTENT_SECURITY_POLICY,
            header::HeaderValue::from_static("sandbox"),
        );
    }
    Ok(res)
}

async fn upload_logo(s: Scoped, Path(id): Path<i64>, headers: HeaderMap, body: Bytes) -> ApiResult {
    let declared = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    ok(with_db(&s, |db| db.set_logo(id, &body, &declared))?)
}

async fn remove_logo(s: Scoped, Path(id): Path<i64>) -> ApiResult {
    ok(with_db(&s, |db| db.remove_logo(id))?)
}

/// Fetch an image from where an import found it, without holding the
/// database, then keep it as the company's logo.
async fn fetch_logo(s: Scoped, Path(id): Path<i64>, Json(l): Json<Lookup>) -> ApiResult {
    with_db(&s, |db| {
        db.get(resource::resource("companies").expect("known"), id)
    })?;
    let (data, kind) = tokio::task::spawn_blocking(move || crate::lookup::get_image(&l.url))
        .await
        .map_err(|e| ApiError(Error::Fetch(format!("the fetch failed: {e}"))))??;
    ok(with_db(&s, |db| db.set_logo(id, &data, kind))?)
}

// --- the calendar --------------------------------------------------------------------

async fn calendar(s: Scoped, Query(q): Query<service::CalendarQuery>) -> ApiResult {
    ok(with_db(&s, |db| db.calendar(&q))?)
}

#[derive(Deserialize)]
struct IcsQuery {
    kinds: Option<String>,
}

async fn calendar_ics(s: Scoped, Query(q): Query<IcsQuery>) -> Result<Response, ApiError> {
    let body = with_db(&s, |db| db.calendar_ics(q.kinds.as_deref()))?;
    Ok((
        [
            (header::CONTENT_TYPE, "text/calendar; charset=utf-8"),
            (header::CONTENT_DISPOSITION, "inline; filename=\"hunt.ics\""),
        ],
        body,
    )
        .into_response())
}

/// The calendar, shared by its private link (Settings → Connections), for a
/// calendar app to subscribe to without signing in: `/api/calendar/<secret>.ics`.
/// Not found unless that link is on.
async fn shared_calendar(
    State(app): State<AppState>,
    Path(file): Path<String>,
    Query(q): Query<IcsQuery>,
) -> Result<Response, ApiError> {
    let token = file.strip_suffix(".ics").unwrap_or(&file).to_string();
    let anyone = Scoped {
        db: app.db.clone(),
        owner: None,
    };
    let sharer = with_db(&anyone, |db| db.calendar_sharer(&token))?;
    let Some(owner) = sharer else {
        return Err(ApiError(Error::NotFound(
            "no calendar is shared at this link".into(),
        )));
    };
    // With several people, the account whose link it is; else the one hunt.
    let owner = if app.tenants.is_some() { owner } else { None };
    let s = Scoped {
        db: app.db.clone(),
        owner,
    };
    let body = with_db(&s, |db| db.calendar_ics(q.kinds.as_deref()))?;
    Ok((
        [
            (header::CONTENT_TYPE, "text/calendar; charset=utf-8"),
            (header::CONTENT_DISPOSITION, "inline; filename=\"hunt.ics\""),
            (header::CACHE_CONTROL, "private, no-cache"),
        ],
        body,
    )
        .into_response())
}

// --- people from LinkedIn, and their photos -----------------------------------------

async fn lookup_person(Json(l): Json<Lookup>) -> ApiResult {
    let found = tokio::task::spawn_blocking(move || crate::lookup::fetch_person(&l.url))
        .await
        .map_err(|e| ApiError(Error::Fetch(format!("the lookup failed: {e}"))))??;
    ok(found)
}

/// A profile as the bookmark sent it, from a browser signed in to LinkedIn.
async fn person_from_page(Json(p): Json<crate::lookup::ProfilePage>) -> ApiResult {
    ok(crate::lookup::person_from_page(&p)?)
}

async fn person_photo(s: Scoped, Path(id): Path<i64>) -> Result<Response, ApiError> {
    let file = with_db(&s, |db| db.picture(Picture::Photo, id))?;
    let mut res = (
        [
            (header::CONTENT_TYPE, file.content_type.clone()),
            (header::CACHE_CONTROL, "private, max-age=86400".to_string()),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_string()),
        ],
        file.data,
    )
        .into_response();
    if file.content_type.contains("svg") {
        res.headers_mut().insert(
            header::CONTENT_SECURITY_POLICY,
            header::HeaderValue::from_static("sandbox"),
        );
    }
    Ok(res)
}

async fn upload_photo(
    s: Scoped,
    Path(id): Path<i64>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult {
    let declared = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    ok(with_db(&s, |db| {
        db.set_picture(Picture::Photo, id, &body, &declared)
    })?)
}

async fn remove_photo(s: Scoped, Path(id): Path<i64>) -> ApiResult {
    ok(with_db(&s, |db| db.remove_picture(Picture::Photo, id))?)
}

/// Fetch a photo from where a profile said, without holding the database.
async fn fetch_photo(s: Scoped, Path(id): Path<i64>, Json(l): Json<Lookup>) -> ApiResult {
    with_db(&s, |db| {
        db.get(resource::resource("people").expect("known"), id)
    })?;
    let (data, kind) = tokio::task::spawn_blocking(move || crate::lookup::get_image(&l.url))
        .await
        .map_err(|e| ApiError(Error::Fetch(format!("the fetch failed: {e}"))))??;
    ok(with_db(&s, |db| {
        db.set_picture(Picture::Photo, id, &data, kind)
    })?)
}

#[derive(Deserialize)]
struct Tags {
    tags: Vec<String>,
}

async fn set_tags(
    s: Scoped,
    Path((name, id)): Path<(String, i64)>,
    Json(t): Json<Tags>,
) -> ApiResult {
    find(&name)?;
    ok(with_db(&s, |db| db.set_tags(&name, id, &t.tags))?)
}

// --- email -----------------------------------------------------------------------

/// Settings ask for syncs every so many minutes, and it's been that long.
fn mail_due(db: &Db) -> crate::error::Result<bool> {
    let status = db.mail_status()?;
    let every = status["interval"].as_i64().unwrap_or(0);
    if every <= 0 || !status["connected"].as_bool().unwrap_or(false) {
        return Ok(false);
    }
    let Some(last) = status["last_sync"].as_str() else {
        return Ok(true);
    };
    let last: jiff::civil::DateTime = match last.parse() {
        Ok(t) => t,
        Err(_) => return Ok(true),
    };
    Ok(db.clock() >= last + jiff::Span::new().minutes(every))
}

async fn mail_status(s: Scoped) -> ApiResult {
    ok(with_db(&s, |db| db.mail_status())?)
}

#[derive(Deserialize)]
struct Connect {
    address: Option<String>,
    password: Option<String>,
    /// Minutes between syncs; 0 for none.
    interval: Option<i64>,
}

/// Connect Gmail (signing in first, to check), or change how often it syncs.
async fn connect_mail(s: Scoped, Json(c): Json<Connect>) -> ApiResult {
    let (stored, connect) = with_db(&s, |db| Ok((db.mail_account()?, db.mailbox.clone())))?;
    let address = c
        .address
        .map(|a| a.trim().to_lowercase())
        .filter(|a| !a.is_empty());
    let password = c
        .password
        .map(|p| p.split_whitespace().collect::<String>())
        .filter(|p| !p.is_empty());
    let account = match (address, password) {
        (Some(address), Some(password)) => Some(crate::mail::Account {
            address,
            password,
            google: None,
        }),
        (Some(address), None) => match &stored {
            Some(a) if a.address == address => None,
            _ => return Err(ApiError(Error::Invalid("give the app password too".into()))),
        },
        (None, Some(_)) => {
            return Err(ApiError(Error::Invalid(
                "give the Gmail address too".into(),
            )));
        }
        (None, None) => None,
    };
    if let Some(account) = account {
        if !account.address.contains('@') {
            return Err(ApiError(Error::Invalid(format!(
                "{:?} isn't an email address",
                account.address
            ))));
        }
        let check = account.clone();
        tokio::task::spawn_blocking(move || connect(&check).map(drop))
            .await
            .map_err(|e| ApiError(Error::Fetch(format!("signing in failed: {e}"))))??;
        with_db(&s, |db| db.set_mail_account(Some(&account)))?;
    }
    if let Some(minutes) = c.interval {
        if !(0..=1440).contains(&minutes) {
            return Err(ApiError(Error::Invalid(
                "sync every 0 to 1440 minutes".into(),
            )));
        }
        with_db(&s, |db| {
            db.set_setting("mail.interval", Some(&minutes.to_string()))
        })?;
    }
    mail_status(s).await
}

/// Forget the account (withdrawing a Google sign-in). What was fetched stays.
async fn disconnect_mail(s: Scoped) -> ApiResult {
    if let Some(signin) = with_db(&s, |db| db.mail_account())?.and_then(|a| a.google) {
        let _ =
            tokio::task::spawn_blocking(move || signin.client.revoke(&signin.refresh_token)).await;
    }
    with_db(&s, |db| db.set_mail_account(None))?;
    mail_status(s).await
}

/// The OAuth client's JSON file from Google Cloud, as the body.
async fn set_google_client(s: Scoped, body: Bytes) -> ApiResult {
    let client = crate::google::Client::from_json(&String::from_utf8_lossy(&body))?;
    with_db(&s, |db| db.set_google_client(Some(&client)))?;
    mail_status(s).await
}

async fn remove_google_client(s: Scoped) -> ApiResult {
    with_db(&s, |db| db.set_google_client(None))?;
    mail_status(s).await
}

/// Where Google sends you back: this hunt, as the browser reached it.
fn google_redirect(headers: &HeaderMap) -> String {
    let host = headers
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("127.0.0.1:4848");
    let scheme = headers
        .get("x-forwarded-proto")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("http");
    format!("{scheme}://{host}{}", crate::google::CALLBACK)
}

/// Start signing in with Google: where to send the browser.
async fn google_start(s: Scoped, headers: HeaderMap) -> ApiResult {
    let client = with_db(&s, |db| db.google_client())?.ok_or_else(|| {
        ApiError(Error::Invalid(
            "give hunt your Google OAuth client first".into(),
        ))
    })?;
    let redirect = google_redirect(&headers);
    let (state, verifier) = (crate::google::random_token(), crate::google::random_token());
    let pending = json!({ "state": state, "verifier": verifier, "redirect": redirect }).to_string();
    with_db(&s, |db| {
        db.set_setting("mail.google.pending", Some(&pending))
    })?;
    ok(json!({ "url": client.auth_url(&redirect, &state, &verifier), "redirect": redirect }))
}

#[derive(Deserialize)]
struct Callback {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

/// Google sends you back here: finish signing in, then back to Settings,
/// saying how it went.
async fn google_callback(s: Scoped, Query(q): Query<Callback>) -> Response {
    let back = |outcome: Result<String, String>| {
        let to = match outcome {
            Ok(address) => format!("/settings?gmail=connected&address={}", urlencode(&address)),
            Err(e) => format!("/settings?gmail_error={}", urlencode(&e)),
        };
        (StatusCode::SEE_OTHER, [(header::LOCATION, to)]).into_response()
    };
    if let Some(e) = q.error {
        return back(Err(if e == "access_denied" {
            "you didn't allow hunt to read Gmail".into()
        } else {
            format!("Google said {e}")
        }));
    }
    let pending = with_db(&s, |db| {
        let p = db.setting("mail.google.pending")?;
        db.set_setting("mail.google.pending", None)?;
        Ok((p, db.google_client()?))
    });
    let (Ok((Some(pending), Some(client))), Some(code), Some(state)) = (pending, q.code, q.state)
    else {
        return back(Err("that sign-in had expired; try again".into()));
    };
    let pending: Value = serde_json::from_str(&pending).unwrap_or_default();
    if pending["state"].as_str() != Some(state.as_str()) {
        return back(Err(
            "that sign-in wasn't the one hunt started; try again".into()
        ));
    }
    let redirect = pending["redirect"].as_str().unwrap_or_default().to_string();
    let verifier = pending["verifier"].as_str().unwrap_or_default().to_string();
    let signed = tokio::task::spawn_blocking(move || {
        let tokens = client.exchange(&code, &redirect, &verifier)?;
        let refresh = tokens.refresh.ok_or_else(|| {
            Error::Invalid(
                "Google didn't let hunt stay signed in; remove hunt at myaccount.google.com/permissions and try again"
                    .into(),
            )
        })?;
        let address = crate::google::GmailApi::with_token(&tokens.access).address()?;
        Ok::<_, Error>((address, refresh))
    })
    .await;
    match signed {
        Ok(Ok((address, refresh))) => {
            match with_db(&s, |db| db.set_google_signin(&address, &refresh)) {
                Ok(()) => back(Ok(address)),
                Err(ApiError(e)) => back(Err(e.to_string())),
            }
        }
        Ok(Err(e)) => back(Err(e.to_string())),
        Err(e) => back(Err(e.to_string())),
    }
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'@' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

async fn sync_mail(s: Scoped) -> ApiResult {
    // Mail is read for one person's hunt only, for now.
    if s.owner.is_some() {
        return Err(ApiError(Error::NotFound(
            "mail sync isn't available when several people share hunt".into(),
        )));
    }
    let shared = s.db.clone();
    let report = tokio::task::spawn_blocking(move || crate::mail::sync(&shared))
        .await
        .map_err(|e| ApiError(Error::Fetch(format!("the sync failed: {e}"))))??;
    ok(report)
}

#[derive(Deserialize)]
struct EmailQuery {
    status: Option<String>,
    process_id: Option<i64>,
}

async fn list_emails(s: Scoped, Query(q): Query<EmailQuery>) -> ApiResult {
    ok(with_db(&s, |db| {
        db.emails(q.status.as_deref(), q.process_id)
    })?)
}

async fn get_email(s: Scoped, Path(id): Path<i64>) -> ApiResult {
    ok(with_db(&s, |db| db.email(id))?)
}

async fn delete_email(s: Scoped, Path(id): Path<i64>) -> ApiResult {
    ok(with_db(&s, |db| db.delete_email(id))?)
}

async fn process_emails(s: Scoped, Path(id): Path<i64>) -> ApiResult {
    ok(with_db(&s, |db| db.emails(Some("linked"), Some(id)))?)
}

/// An .eml file, as the request body, kept with the process.
async fn import_email(s: Scoped, Path(id): Path<i64>, body: Bytes) -> ApiResult {
    ok(with_db(&s, |db| db.import_email(id, &body))?)
}

async fn process_mail(s: Scoped, Path(id): Path<i64>) -> ApiResult {
    ok(with_db(&s, |db| db.process_mail(id))?)
}

#[derive(Deserialize)]
struct LinkTo {
    process_id: i64,
}

async fn link_email(s: Scoped, Path(id): Path<i64>, Json(l): Json<LinkTo>) -> ApiResult {
    ok(with_db(&s, |db| db.link_email(id, l.process_id))?)
}

async fn unlink_email(s: Scoped, Path(id): Path<i64>) -> ApiResult {
    ok(with_db(&s, |db| db.unlink_email(id))?)
}

#[derive(Deserialize)]
struct IgnoreRule {
    /// "sender" or "domain": everything from them, from now on.
    rule: Option<String>,
}

async fn ignore_email(s: Scoped, Path(id): Path<i64>, body: Option<Json<IgnoreRule>>) -> ApiResult {
    let rule = body.and_then(|Json(r)| r.rule);
    let n = with_db(&s, |db| db.ignore_email(id, rule.as_deref()))?;
    ok(json!({ "ignored": n }))
}

async fn mail_ignores(s: Scoped) -> ApiResult {
    ok(with_db(&s, |db| db.mail_ignores())?)
}

async fn remove_mail_ignore(s: Scoped, Path(id): Path<i64>) -> ApiResult {
    with_db(&s, |db| db.remove_mail_ignore(id))?;
    ok(json!({ "removed": id }))
}

async fn settings(s: Scoped) -> ApiResult {
    ok(with_db(&s, |db| db.settings())?)
}

async fn update_settings(s: Scoped, Json(v): Json<Value>) -> ApiResult {
    // A new home currency needs a rate to GBP: fetched first, without
    // holding the database.
    if let Some(cur) = v
        .get("currency")
        .and_then(Value::as_str)
        .and_then(crate::fx::normalize_currency)
    {
        let shared = s.db.clone();
        tokio::task::spawn_blocking(move || crate::fx::ensure_rate(&shared, &cur, false))
            .await
            .map_err(|e| ApiError(Error::Db(e.to_string())))??;
    }
    ok(with_db(&s, |db| db.update_settings(&v))?)
}

/// Everything, as a file to save.
async fn backup(s: Scoped) -> Result<Response, ApiError> {
    let shared = s.clone();
    let (backup, day) = tokio::task::spawn_blocking(move || {
        with_db(&shared, |db| {
            Ok((db.backup()?, db.stamp()[..10].to_string()))
        })
    })
    .await
    .map_err(|e| ApiError(Error::Db(format!("the backup failed: {e}"))))??;
    let body = serde_json::to_vec(&backup).expect("serialisable");
    Ok((
        [
            (header::CONTENT_TYPE, "application/json".to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"hunt-backup-{day}.json\""),
            ),
        ],
        body,
    )
        .into_response())
}

#[derive(Deserialize)]
struct Replace {
    confirm: Option<String>,
}

/// Replace everything with a backup. `?confirm=replace` says it's meant.
async fn restore(s: Scoped, Query(q): Query<Replace>, body: Bytes) -> ApiResult {
    if q.confirm.as_deref() != Some("replace") {
        return Err(ApiError(Error::Invalid(
            "importing a backup replaces everything here; add ?confirm=replace to mean it".into(),
        )));
    }
    let backup: Value = serde_json::from_slice(&body).map_err(|_| {
        ApiError(Error::Invalid(
            "that isn't a hunt backup (it isn't JSON)".into(),
        ))
    })?;
    let shared = s.clone();
    let counts = tokio::task::spawn_blocking(move || with_db(&shared, |db| db.restore(&backup)))
        .await
        .map_err(|e| ApiError(Error::Db(format!("the import failed: {e}"))))??;
    ok(counts)
}

/// For health checks (Kubernetes' probes): ok when the database answers.
/// Kubernetes' probes don't sign in: this asks nobody who they are, and
/// says only whether the database answers.
async fn healthz(State(app): State<AppState>) -> Response {
    let s = Scoped {
        db: app.db.clone(),
        owner: None,
    };
    match with_db(&s, |db| db.ping()) {
        Ok(()) => (StatusCode::OK, "ok").into_response(),
        Err(ApiError(e)) => (StatusCode::SERVICE_UNAVAILABLE, e.to_string()).into_response(),
    }
}

#[derive(Deserialize)]
struct StepPeople {
    person_ids: Vec<i64>,
}

async fn set_step_people(s: Scoped, Path(id): Path<i64>, Json(b): Json<StepPeople>) -> ApiResult {
    ok(with_db(&s, |db| db.set_step_people(id, &b.person_ids))?)
}

#[derive(Deserialize)]
struct StatsQuery {
    /// A cycle's id, or `all`; without, the running cycles.
    cycle: Option<String>,
}

async fn stats(s: Scoped, Query(q): Query<StatsQuery>) -> ApiResult {
    ok(with_db(&s, |db| db.stats(q.cycle.as_deref()))?)
}

/// What hunt uses of the machine: with several people, for admins only,
/// and read for everyone (it's the machine's, not an account's).
async fn system(v: Viewer) -> ApiResult {
    if v.app.tenants.is_some() && !v.account.as_ref().is_some_and(Account::is_admin) {
        return Err(ApiError(Error::NotFound(
            "only admins see what hunt uses of the machine".into(),
        )));
    }
    let s = Scoped {
        db: v.app.db.clone(),
        owner: None,
    };
    ok(with_db(&s, |db| db.system())?)
}

// --- take-home pay ----------------------------------------------------------------

/// A JSON body, read into what a handler takes.
fn body_as<T: serde::de::DeserializeOwned>(body: Value) -> Result<T, ApiError> {
    serde_json::from_value(body).map_err(|e| ApiError(Error::Invalid(e.to_string())))
}

/// Take-home pay is for anyone who may use hunt and lives in the UK
/// (Settings → Location); for anyone else, it isn't there.
fn take_home_for(v: &Viewer) -> Result<Scoped, ApiError> {
    let s = v
        .scoped()
        .ok_or_else(|| ApiError(Error::NotFound("nothing at /api/take-home".into())))?;
    if with_db(&s, |db| db.settings())?["uk_resident"] != json!(true) {
        return Err(ApiError(Error::NotFound(
            "take-home pay is for UK residents: say you live in the UK in Settings → Location"
                .into(),
        )));
    }
    Ok(s)
}

/// Amounts typed in another currency (`currency`, GBP unless said), in
/// GBP: `fields` of `body`, at today's rate (fetched if need be). With the
/// rate used, to say so, and to turn what's worked out back.
async fn take_home_gbp(
    s: &Scoped,
    mut body: Value,
    fields: &[&str],
) -> Result<(Value, Value), ApiError> {
    let given = body
        .get("currency")
        .and_then(Value::as_str)
        .unwrap_or("GBP")
        .to_string();
    let cur = crate::fx::normalize_currency(&given).ok_or_else(|| {
        ApiError(Error::Invalid(format!(
            "a currency is a code like GBP or EUR, not {given:?}"
        )))
    })?;
    if cur == "GBP" {
        gbp_grants(s, &mut body).await?;
        return Ok((
            body,
            json!({ "currency": "GBP", "gbp_rate": 1.0, "gbp_rate_on": null }),
        ));
    }
    if let Some(e) = rate_for(&s.db, &cur, false).await {
        return Err(ApiError(e));
    }
    let (rate, on) = with_db(s, |db| db.cached_rate(&cur))?
        .ok_or_else(|| ApiError(Error::Fetch(format!("no exchange rate for {cur}"))))?;
    for field in fields {
        if let Some(n) = body.get(*field).and_then(Value::as_f64) {
            body[*field] = json!(n * rate);
        }
    }
    gbp_grants(s, &mut body).await?;
    Ok((
        body,
        json!({ "currency": cur, "gbp_rate": rate, "gbp_rate_on": on }),
    ))
}

/// Share grants in their own currencies (`currency` on each), in GBP.
async fn gbp_grants(s: &Scoped, body: &mut Value) -> Result<(), ApiError> {
    let Some(grants) = body.get_mut("grants").and_then(Value::as_array_mut) else {
        return Ok(());
    };
    for g in grants {
        let given = g
            .get("currency")
            .and_then(Value::as_str)
            .unwrap_or("GBP")
            .to_string();
        let cur = crate::fx::normalize_currency(&given).ok_or_else(|| {
            ApiError(Error::Invalid(format!(
                "a grant's currency is a code like USD, not {given:?}"
            )))
        })?;
        if cur == "GBP" {
            continue;
        }
        if let Some(e) = rate_for(&s.db, &cur, false).await {
            return Err(ApiError(e));
        }
        let (rate, _) = with_db(s, |db| db.cached_rate(&cur))?
            .ok_or_else(|| ApiError(Error::Fetch(format!("no exchange rate for {cur}"))))?;
        for field in ["value", "price", "strike", "grant_price"] {
            if let Some(n) = g.get(field).and_then(Value::as_f64) {
                g[field] = json!(n * rate);
            }
        }
    }
    Ok(())
}

/// What's worked out, with the rate its amounts were turned to GBP at.
fn with_rate(result: impl serde::Serialize, fx: Value) -> ApiResult {
    let mut v = serde_json::to_value(result).expect("serialisable");
    if let (Some(o), Value::Object(fx)) = (v.as_object_mut(), fx) {
        o.extend(fx);
    }
    ok(v)
}

async fn take_home_options(v: Viewer) -> ApiResult {
    take_home_for(&v)?;
    ok(takehome::options())
}

async fn take_home_salary(v: Viewer, Json(body): Json<Value>) -> ApiResult {
    let s = take_home_for(&v)?;
    let (body, fx) = take_home_gbp(
        &s,
        body,
        &["salary", "bonus", "take_home", "sign_on", "refresher"],
    )
    .await?;
    with_rate(takehome::salary(&body_as(body)?)?, fx)
}

async fn take_home_contract(v: Viewer, Json(body): Json<Value>) -> ApiResult {
    let s = take_home_for(&v)?;
    let (body, fx) = take_home_gbp(&s, body, &["rate", "day_rate", "take_home"]).await?;
    with_rate(takehome::contract(&body_as(body)?)?, fx)
}

// --- accounts (several people) ----------------------------------------------------

#[derive(Deserialize)]
struct DevAs {
    email: Option<String>,
}

/// Trying several people's hunt out (`--identity-header`): be someone, in
/// this browser (`?email=`; none to sign out). Not there behind Access.
async fn dev_as(v: Viewer, Query(q): Query<DevAs>) -> Response {
    if !v.app.tenants.as_ref().is_some_and(|t| t.trusts_header()) {
        return ApiError(Error::NotFound("nothing at /dev/as".into())).into_response();
    }
    let email = q.email.unwrap_or_default();
    let cookie = if email.trim().is_empty() {
        format!(
            "{}=; Path=/; Max-Age=0; SameSite=Lax",
            crate::tenants::DEV_COOKIE
        )
    } else {
        format!(
            "{}={}; Path=/; SameSite=Lax",
            crate::tenants::DEV_COOKIE,
            email.trim()
        )
    };
    (
        StatusCode::SEE_OTHER,
        [
            (header::SET_COOKIE, cookie),
            (header::LOCATION, "/".to_string()),
        ],
    )
        .into_response()
}

/// Who's asking, and their account, if any.
async fn account(v: Viewer) -> ApiResult {
    if v.app.tenants.is_none() {
        return Err(ApiError(Error::NotFound(
            "this hunt is one person's: it has no accounts".into(),
        )));
    }
    ok(json!({ "identity": v.identity, "account": v.account }))
}

#[derive(Deserialize)]
struct AskFor {
    name: Option<String>,
    reason: Option<String>,
    provider: Option<String>,
    /// That they agree to the terms of use (and have read the privacy notice).
    #[serde(default)]
    agrees: bool,
}

#[derive(Deserialize)]
struct DeleteOwn {
    /// Their email address, typed again, to be sure.
    confirm: Option<String>,
}

/// Delete your own account, and everything in it, for good.
async fn delete_account(v: Viewer, Json(b): Json<DeleteOwn>) -> ApiResult {
    let (Some(t), Some(me)) = (v.app.tenants.clone(), v.account.clone()) else {
        return Err(ApiError(Error::Invalid(
            "only a shared hunt has accounts to delete".into(),
        )));
    };
    let typed = b.confirm.as_deref().unwrap_or("").trim();
    if !typed.eq_ignore_ascii_case(&me.email) {
        return Err(ApiError(Error::Invalid(
            "type your email address to confirm deleting your account".into(),
        )));
    }
    ok(tokio::task::spawn_blocking(move || t.delete_own(&me))
        .await
        .map_err(|e| ApiError(Error::Db(e.to_string())))??)
}

/// Ask for an account: pending until an admin approves it.
async fn request_account(v: Viewer, Json(b): Json<AskFor>) -> ApiResult {
    let (Some(t), Some(who)) = (v.app.tenants.clone(), v.identity.clone()) else {
        return Err(ApiError(Error::Invalid(
            "sign in first, then ask for an account".into(),
        )));
    };
    // A hunt run for others has terms of use: agreed to, and which, kept.
    let terms = v.app.site.url.is_some().then_some(site::UPDATED);
    if terms.is_some() && !b.agrees {
        return Err(ApiError(Error::Invalid(
            "agree to the terms of use (and read the privacy notice) to ask for an account".into(),
        )));
    }
    let a = tokio::task::spawn_blocking(move || {
        t.request(
            &who,
            b.name.as_deref(),
            b.reason.as_deref(),
            b.provider.as_deref(),
            terms,
        )
    })
    .await
    .map_err(|e| ApiError(Error::Db(e.to_string())))??;
    ok(a)
}

/// The admin centre: every account, with what each holds.
async fn admin_overview(a: Admin) -> ApiResult {
    ok(tokio::task::spawn_blocking(move || a.tenants.overview())
        .await
        .map_err(|e| ApiError(Error::Db(e.to_string())))??)
}

#[derive(Deserialize)]
struct Decision {
    status: String,
    note: Option<String>,
}

/// Approve (active), reject, disable or enable an account.
async fn admin_decide(a: Admin, Path(id): Path<i64>, Json(d): Json<Decision>) -> ApiResult {
    ok(tokio::task::spawn_blocking(move || {
        a.tenants
            .decide(id, &d.status, &a.account, d.note.as_deref())
    })
    .await
    .map_err(|e| ApiError(Error::Db(e.to_string())))??)
}

/// Change an account's role, name or CLI service token.
async fn admin_change(a: Admin, Path(id): Path<i64>, Json(v): Json<Value>) -> ApiResult {
    ok(
        tokio::task::spawn_blocking(move || a.tenants.change(id, &v, &a.account))
            .await
            .map_err(|e| ApiError(Error::Db(e.to_string())))??,
    )
}

#[derive(Deserialize)]
struct AdminSettings {
    signups_open: Option<bool>,
    /// What new accounts start with: `{language, region, timezone, currency}`.
    defaults: Option<Value>,
    /// What it says of itself, to everyone: `{name, announcement, contact}`.
    site: Option<Value>,
}

/// Hunt-wide settings: its name, notice and address for help; whether new
/// people may ask for an account; and what new accounts start with.
async fn admin_settings(a: Admin, Json(s): Json<AdminSettings>) -> ApiResult {
    ok(tokio::task::spawn_blocking(move || {
        if let Some(site) = &s.site {
            a.tenants.set_site(site)?;
        }
        if let Some(open) = s.signups_open {
            a.tenants.set_signups_open(open)?;
        }
        if let Some(d) = &s.defaults {
            a.tenants.set_defaults(d)?;
        }
        Ok::<_, Error>(json!({
            "signups_open": a.tenants.signups_open()?,
            "defaults": a.tenants.defaults()?,
            "site": a.tenants.site()?,
        }))
    })
    .await
    .map_err(|e| ApiError(Error::Db(e.to_string())))??)
}

#[derive(Deserialize)]
struct Invite {
    email: String,
    name: Option<String>,
}

/// Invite someone: an account, open or closed for sign-ups.
async fn admin_invite(a: Admin, Json(i): Json<Invite>) -> ApiResult {
    ok(tokio::task::spawn_blocking(move || {
        a.tenants.invite(&i.email, i.name.as_deref(), &a.account)
    })
    .await
    .map_err(|e| ApiError(Error::Db(e.to_string())))??)
}

/// How each account uses hunt, without who they are.
async fn admin_usage(a: Admin) -> ApiResult {
    ok(tokio::task::spawn_blocking(move || a.tenants.usage())
        .await
        .map_err(|e| ApiError(Error::Db(e.to_string())))??)
}

#[derive(Deserialize)]
struct RemoveQuery {
    data: Option<String>,
}

/// Remove an account; `?data=1` removes everything of theirs too.
async fn admin_remove(a: Admin, Path(id): Path<i64>, Query(q): Query<RemoveQuery>) -> ApiResult {
    let data = matches!(q.data.as_deref(), Some("1" | "true" | "yes"));
    ok(
        tokio::task::spawn_blocking(move || a.tenants.remove(id, &a.account, data))
            .await
            .map_err(|e| ApiError(Error::Db(e.to_string())))??,
    )
}
