//! Several people sharing one hunt: each sees and changes only their own.

use std::sync::{Arc, Mutex};

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use hunt::Db;
use hunt::tenants::{IdentitySource, Tenants};
use serde_json::{Value, json};
use tower::ServiceExt;

const ADMIN: &str = "admin@example.test";
const BOB: &str = "bob@example.test";

/// A new, empty database, as in tests/api.rs: SQLite in memory, or a
/// database on the server `HUNT_TEST_DB` names.
fn test_db() -> Db {
    match std::env::var("HUNT_TEST_DB") {
        Ok(server) if !server.is_empty() => {
            static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
            let name = format!(
                "hunt_tenants_{}_{}",
                std::process::id(),
                N.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
            );
            Db::open(hunt::store::create_database(&server, &name).unwrap()).unwrap()
        }
        _ => Db::open_in_memory().unwrap(),
    }
}

/// hunt for several people, telling who's asking by a header (as `--identity-header`).
fn shared_hunt() -> Router {
    let db = Arc::new(Mutex::new(test_db()));
    let tenants = Tenants::open(
        db.clone(),
        &[ADMIN.to_string()],
        IdentitySource::Header("x-hunt-user".into()),
    )
    .unwrap();
    // A new hunt starts closed to anyone new: opened, as its admin would.
    tenants.set_signups_open(true).unwrap();
    hunt::api::router_tenants(db, tenants)
}

/// A shared hunt run for others by Arabesque Labs: with careerhunt.app's
/// terms to agree to, and its legal pages linked.
fn hosted_hunt() -> Router {
    let db = Arc::new(Mutex::new(test_db()));
    let tenants = Tenants::open(
        db.clone(),
        &[ADMIN.to_string()],
        IdentitySource::Header("x-hunt-user".into()),
    )
    .unwrap();
    tenants.set_signups_open(true).unwrap();
    let site = hunt::site::Site {
        url: Some("https://careerhunt.app".into()),
        operator: Some("Arabesque Labs Ltd".into()),
        ..Default::default()
    };
    hunt::api::router_run_by(db, tenants, site)
}

/// A request as `who` (None: signed out).
async fn as_(
    app: &Router,
    who: Option<&str>,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut req = Request::builder().method(method).uri(path);
    if let Some(w) = who {
        req = req.header("x-hunt-user", w);
    }
    let req = match body {
        Some(b) => req
            .header("content-type", "application/json")
            .body(Body::from(b.to_string())),
        None => req.body(Body::empty()),
    }
    .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn ok(app: &Router, who: &str, method: &str, path: &str, body: Option<Value>) -> Value {
    let (status, v) = as_(app, Some(who), method, path, body).await;
    assert!(status.is_success(), "{who}: {method} {path}: {status} {v}");
    v
}

fn ids(v: &Value) -> Vec<i64> {
    v.as_array()
        .unwrap()
        .iter()
        .filter_map(|r| r["id"].as_i64())
        .collect()
}

/// What each person makes: a process (its application and company), a
/// person on it, a step, a note, a memo, a tag, a stage, a document with a
/// version, a posting. Their ids, by resource.
async fn make_things(app: &Router, who: &str) -> std::collections::HashMap<&'static str, i64> {
    let mut made = std::collections::HashMap::new();
    let card = ok(
        app,
        who,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Acme", "title": "SRE" })),
    )
    .await;
    let p = card["id"].as_i64().unwrap();
    made.insert("processes", p);
    made.insert("applications", card["application_id"].as_i64().unwrap());
    made.insert("companies", card["company_id"].as_i64().unwrap());
    let person = ok(
        app,
        who,
        "POST",
        &format!("/api/processes/{p}/people"),
        Some(json!({ "name": "Sam Lee", "role": "recruiter" })),
    )
    .await;
    made.insert("people", person[0]["id"].as_i64().unwrap());
    let step = ok(
        app,
        who,
        "POST",
        "/api/steps",
        Some(json!({ "process_id": p, "title": "Onsite", "at": "2026-10-20T10:00" })),
    )
    .await;
    made.insert("steps", step["id"].as_i64().unwrap());
    let note = ok(
        app,
        who,
        "POST",
        "/api/notes",
        Some(json!({ "process_id": p, "body": format!("{who}'s note") })),
    )
    .await;
    made.insert("notes", note["id"].as_i64().unwrap());
    let memo = ok(
        app,
        who,
        "POST",
        "/api/memos",
        Some(json!({ "body": format!("{who}'s memo") })),
    )
    .await;
    made.insert("memos", memo["id"].as_i64().unwrap());
    ok(
        app,
        who,
        "PUT",
        &format!("/api/applications/{}/tags", made["applications"]),
        Some(json!({ "tags": ["dream"] })),
    )
    .await;
    let stage = ok(
        app,
        who,
        "POST",
        "/api/stages",
        Some(json!({ "name": "Take-home" })),
    )
    .await;
    made.insert("stages", stage["id"].as_i64().unwrap());
    let doc = ok(
        app,
        who,
        "POST",
        "/api/documents",
        Some(json!({ "name": "Resume", "kind": "resume" })),
    )
    .await;
    made.insert("documents", doc["id"].as_i64().unwrap());
    let req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/documents/{}/versions?filename=cv.txt",
            made["documents"]
        ))
        .header("x-hunt-user", who)
        .header("content-type", "text/plain")
        .body(Body::from(format!("{who}'s resume")))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert!(res.status().is_success(), "upload: {}", res.status());
    let v: Value =
        serde_json::from_slice(&res.into_body().collect().await.unwrap().to_bytes()).unwrap();
    made.insert("versions", v["id"].as_i64().unwrap());
    let posting = ok(app, who, "POST", "/api/postings", Some(json!({ "application_id": made["applications"], "url": "https://jobs.example/acme/sre" }))).await;
    made.insert("postings", posting["id"].as_i64().unwrap());
    made
}

#[tokio::test]
async fn people_ask_for_accounts_and_admins_decide() {
    let app = shared_hunt();
    // Signed out: nothing. Signed in without an account: told to ask.
    let (status, v) = as_(&app, None, "GET", "/api/board", None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "{v}");
    let (status, v) = as_(&app, Some(BOB), "GET", "/api/board", None).await;
    assert_eq!(
        (status, v["account"].as_str()),
        (StatusCode::FORBIDDEN, Some("none"))
    );
    let meta = ok(&app, BOB, "GET", "/api/meta", None).await;
    assert_eq!(meta["tenancy"]["email"], BOB);
    assert!(meta["tenancy"]["account"].is_null());
    // The admin is one from the start, and the page knows.
    let meta = ok(&app, ADMIN, "GET", "/api/meta", None).await;
    assert_eq!(
        (
            meta["tenancy"]["account"]["role"].as_str(),
            meta["tenancy"]["account"]["id"].as_i64()
        ),
        (Some("admin"), Some(1))
    );
    // Bob asks; it waits.
    let asked = ok(
        &app,
        BOB,
        "POST",
        "/api/account/request",
        Some(
            json!({ "agrees": true, "name": "Bob", "reason": "job hunting", "provider": "github" }),
        ),
    )
    .await;
    assert_eq!(asked["status"], "pending");
    let (status, v) = as_(&app, Some(BOB), "GET", "/api/board", None).await;
    assert_eq!(
        (status, v["account"].as_str()),
        (StatusCode::FORBIDDEN, Some("pending"))
    );
    let (status, _) = as_(&app, Some(BOB), "GET", "/api/admin/overview", None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    // The admin sees the request first, and rejects it; Bob asks again.
    let overview = ok(&app, ADMIN, "GET", "/api/admin/overview", None).await;
    assert_eq!(overview["accounts"][0]["email"], BOB);
    assert_eq!(overview["totals"]["pending"], 1);
    let bob = overview["accounts"][0]["id"].as_i64().unwrap();
    let rejected = ok(
        &app,
        ADMIN,
        "POST",
        &format!("/api/admin/accounts/{bob}/decide"),
        Some(json!({ "status": "rejected", "note": "not yet" })),
    )
    .await;
    assert_eq!(rejected["status"], "rejected");
    let (_, v) = as_(&app, Some(BOB), "GET", "/api/board", None).await;
    assert_eq!(v["account"], "rejected");
    ok(
        &app,
        BOB,
        "POST",
        "/api/account/request",
        Some(json!({ "agrees": true, "reason": "please" })),
    )
    .await;
    // Approved: Bob's hunt starts with the usual stages, and nothing else.
    ok(
        &app,
        ADMIN,
        "POST",
        &format!("/api/admin/accounts/{bob}/decide"),
        Some(json!({ "status": "active" })),
    )
    .await;
    let board = ok(&app, BOB, "GET", "/api/board", None).await;
    assert_eq!(board["stages"].as_array().unwrap().len(), 5);
    assert!(
        board["stages"]
            .as_array()
            .unwrap()
            .iter()
            .all(|s| s["cards"].as_array().unwrap().is_empty())
    );
    // A user isn't an admin; an admin can make them one, and can't unmake themself.
    let (status, _) = as_(
        &app,
        Some(BOB),
        "PATCH",
        "/api/admin/accounts/1",
        Some(json!({ "role": "user" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = as_(
        &app,
        Some(ADMIN),
        "PATCH",
        "/api/admin/accounts/1",
        Some(json!({ "role": "user" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let (status, _) = as_(
        &app,
        Some(ADMIN),
        "POST",
        "/api/admin/accounts/1/decide",
        Some(json!({ "status": "disabled" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    // The machine's resources: admins only.
    let (status, _) = as_(&app, Some(BOB), "GET", "/api/system", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    ok(&app, ADMIN, "GET", "/api/system", None).await;
    // Disabled: out.
    ok(
        &app,
        ADMIN,
        "POST",
        &format!("/api/admin/accounts/{bob}/decide"),
        Some(json!({ "status": "disabled" })),
    )
    .await;
    let (_, v) = as_(&app, Some(BOB), "GET", "/api/board", None).await;
    assert_eq!(v["account"], "disabled");
}

#[tokio::test]
async fn two_people_never_see_each_others_rows() {
    let app = shared_hunt();
    ok(
        &app,
        BOB,
        "POST",
        "/api/account/request",
        Some(json!({ "agrees": true, "name": "Bob" })),
    )
    .await;
    let bob_id = ok(&app, ADMIN, "GET", "/api/admin/overview", None).await["accounts"][0]["id"]
        .as_i64()
        .unwrap();
    ok(
        &app,
        ADMIN,
        "POST",
        &format!("/api/admin/accounts/{bob_id}/decide"),
        Some(json!({ "status": "active" })),
    )
    .await;
    // Both make the same things, with the same names.
    let admins = make_things(&app, ADMIN).await;
    let bobs = make_things(&app, BOB).await;
    // Each list: only one's own.
    for resource in [
        "companies",
        "people",
        "applications",
        "processes",
        "steps",
        "notes",
        "memos",
        "stages",
        "documents",
        "versions",
        "postings",
        "tags",
        "lanes",
        "swimlanes",
    ] {
        for (who, mine, theirs) in [(ADMIN, &admins, &bobs), (BOB, &bobs, &admins)] {
            let listed = ids(&ok(&app, who, "GET", &format!("/api/{resource}"), None).await);
            if let Some(id) = theirs.get(resource) {
                assert!(
                    !listed.contains(id),
                    "{who} sees the other's {resource} #{id}"
                );
            }
            if let Some(id) = mine.get(resource) {
                assert!(
                    listed.contains(id),
                    "{who} doesn't see their own {resource} #{id}"
                );
            }
        }
        // And the other's record, by id: not there, to read, change or delete.
        if let Some(id) = admins.get(resource) {
            for (method, body) in [
                ("GET", None),
                ("PATCH", Some(json!({ "note": "mine now" }))),
                ("DELETE", None),
            ] {
                let (status, v) = as_(
                    &app,
                    Some(BOB),
                    method,
                    &format!("/api/{resource}/{id}"),
                    body,
                )
                .await;
                assert!(
                    !status.is_success(),
                    "Bob could {method} the admin's {resource} #{id}: {v}"
                );
            }
        }
    }
    let p = admins["processes"];
    for (method, path, body) in [
        ("GET", format!("/api/processes/{p}/detail"), None),
        (
            "POST",
            format!("/api/processes/{p}/move"),
            Some(json!({ "stage_id": bobs["stages"] })),
        ),
        (
            "POST",
            format!("/api/processes/{p}/people"),
            Some(json!({ "name": "Mallory" })),
        ),
        (
            "GET",
            format!("/api/versions/{}/file", admins["versions"]),
            None,
        ),
        (
            "PUT",
            format!("/api/applications/{}/tags", admins["applications"]),
            Some(json!({ "tags": ["mine"] })),
        ),
        (
            "POST",
            "/api/processes/bulk".to_string(),
            Some(json!({ "ids": [p], "action": "archive", "reason": "withdrew" })),
        ),
    ] {
        let (status, v) = as_(&app, Some(BOB), method, &path, body).await;
        assert!(!status.is_success(), "Bob could {method} {path}: {v}");
    }
    // Pointing at the other's records from one's own: refused.
    for (path, body) in [
        (
            "/api/applications",
            json!({ "company_id": admins["companies"], "title": "Spy" }),
        ),
        (
            "/api/notes",
            json!({ "process_id": admins["processes"], "body": "spy" }),
        ),
        (
            "/api/steps",
            json!({ "process_id": admins["processes"], "title": "spy" }),
        ),
        (
            "/api/processes",
            json!({ "application_id": admins["applications"] }),
        ),
    ] {
        let (status, v) = as_(&app, Some(BOB), "POST", path, Some(body)).await;
        assert!(
            !status.is_success(),
            "Bob could point {path} at the admin's: {v}"
        );
    }
    // The admin's process is as it was.
    let mine = ok(&app, ADMIN, "GET", &format!("/api/processes/{p}"), None).await;
    assert_eq!(mine["status"], "active");
    // The board, stats, calendar and log: one's own.
    let board = ok(&app, BOB, "GET", "/api/board", None).await;
    let cards: Vec<i64> = board["stages"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|s| ids(&s["cards"]))
        .collect();
    assert_eq!(cards, vec![bobs["processes"]]);
    let stats = ok(&app, BOB, "GET", "/api/stats", None).await;
    assert_eq!(
        (
            stats["totals"]["applications"].as_i64(),
            stats["totals"]["people"].as_i64()
        ),
        (Some(1), Some(1))
    );
    let calendar = ok(&app, BOB, "GET", "/api/calendar?kinds=step", None).await;
    assert_eq!(calendar.as_array().unwrap().len(), 1);
    let log = ok(&app, BOB, "GET", "/api/activity", None).await;
    assert!(log.as_array().unwrap().iter().all(|e| {
        !e["summary"]
            .as_str()
            .unwrap_or("")
            .contains(&format!("{ADMIN}'s"))
    }));
    assert!(!log.as_array().unwrap().is_empty());
    // Settings are each one's own.
    ok(
        &app,
        ADMIN,
        "PATCH",
        "/api/settings",
        Some(json!({ "language": "ar" })),
    )
    .await;
    assert_eq!(
        ok(&app, BOB, "GET", "/api/settings", None).await["language"],
        "en"
    );
    assert_eq!(
        ok(&app, ADMIN, "GET", "/api/settings", None).await["language"],
        "ar"
    );
    // A backup is one's own; importing it into another's hunt copies it in,
    // with ids of their own, and leaves the first as it was.
    let backup = ok(&app, BOB, "GET", "/api/backup", None).await;
    assert_eq!(backup["tables"]["application"].as_array().unwrap().len(), 1);
    assert!(backup["tables"]["application"][0].get("owner_id").is_none());
    assert_eq!(
        backup["tables"]["stored_file"].as_array().unwrap().len(),
        1,
        "only Bob's files"
    );
    let (status, v) = as_(
        &app,
        Some(BOB),
        "POST",
        "/api/backup?confirm=replace",
        Some(backup.clone()),
    )
    .await;
    assert!(status.is_success(), "{v}");
    let admin_before = ok(&app, ADMIN, "GET", "/api/applications", None).await;
    let req = Request::builder()
        .method("POST")
        .uri("/api/backup?confirm=replace")
        .header("x-hunt-user", ADMIN)
        .header("content-type", "application/json")
        .body(Body::from(backup.to_string()))
        .unwrap();
    assert!(
        app.clone()
            .oneshot(req)
            .await
            .unwrap()
            .status()
            .is_success()
    );
    let admin_after = ok(&app, ADMIN, "GET", "/api/applications", None).await;
    assert_eq!(
        admin_after.as_array().unwrap().len(),
        1,
        "the admin's hunt is now Bob's backup"
    );
    assert_ne!(ids(&admin_after), ids(&admin_before));
    let bob_after = ok(&app, BOB, "GET", "/api/applications", None).await;
    assert_eq!(ids(&bob_after).len(), 1, "Bob's are still Bob's");
    assert!(!ids(&bob_after).contains(&ids(&admin_after)[0]));
    let tags = ok(
        &app,
        ADMIN,
        "GET",
        &format!("/api/applications/{}", ids(&admin_after)[0]),
        None,
    )
    .await;
    assert_eq!(tags["tags"], json!(["dream"]), "tags follow the new ids");
    // Removing Bob with his data leaves the admin's.
    ok(
        &app,
        ADMIN,
        "DELETE",
        &format!("/api/admin/accounts/{bob_id}?data=1"),
        None,
    )
    .await;
    let (_, v) = as_(&app, Some(BOB), "GET", "/api/board", None).await;
    assert_eq!(v["account"], "none");
    assert_eq!(
        ok(&app, ADMIN, "GET", "/api/applications", None)
            .await
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn trying_it_out_a_browser_says_who_it_is_by_cookie() {
    let app = shared_hunt();
    // /dev/as sets who's asking, for a browser (which can't send the header).
    let req = Request::builder()
        .uri("/dev/as?email=admin@example.test")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::SEE_OTHER);
    let cookie = res.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    assert_eq!(cookie, "hunt_dev_user=admin@example.test");
    let req = Request::builder()
        .uri("/api/meta")
        .header("cookie", cookie)
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let meta: Value =
        serde_json::from_slice(&res.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(meta["tenancy"]["account"]["role"], "admin");
    // Not there when one person's hunt, or behind Access.
    let single = hunt::api::router(test_db());
    let res = single
        .oneshot(
            Request::builder()
                .uri("/dev/as?email=x@y.z")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    let db = Arc::new(Mutex::new(test_db()));
    let access = hunt::api::router_tenants(
        db.clone(),
        Tenants::open(db, &[ADMIN.into()], IdentitySource::access("team", "aud")).unwrap(),
    );
    let res = access
        .oneshot(
            Request::builder()
                .uri("/dev/as?email=x@y.z")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn health_checks_need_no_sign_in() {
    // Kubernetes' probes don't sign in.
    let app = shared_hunt();
    let res = app
        .oneshot(
            Request::builder()
                .uri("/healthz")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(&body[..], b"ok");
}

#[tokio::test]
async fn asking_needs_agreeing_to_the_terms() {
    let app = hosted_hunt();
    let (status, v) = as_(
        &app,
        Some(BOB),
        "POST",
        "/api/account/request",
        Some(json!({ "name": "Bob" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert!(v["error"].as_str().unwrap().contains("terms of use"), "{v}");
    // Agreed: asked, and which terms (and when) is kept with their settings.
    ok(
        &app,
        BOB,
        "POST",
        "/api/account/request",
        Some(json!({ "name": "Bob", "agrees": true })),
    )
    .await;
    let overview = ok(&app, ADMIN, "GET", "/api/admin/overview", None).await;
    let bob = overview["accounts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["email"] == BOB)
        .unwrap();
    let agreed = bob["agreed_terms"]
        .as_str()
        .unwrap_or_else(|| panic!("{bob}"));
    assert!(agreed.starts_with(hunt::site::UPDATED), "{agreed}");
}

#[tokio::test]
async fn the_website_has_the_legal_pages_and_the_app_links_them() {
    let app = hosted_hunt();
    // The pages hunt once served, at the website now, Arabic and all.
    for (path, to) in [
        ("/privacy", "https://careerhunt.app/privacy/"),
        ("/terms", "https://careerhunt.app/terms/"),
        ("/data-deletion", "https://careerhunt.app/data-deletion/"),
        ("/docs", "https://careerhunt.app/docs/"),
        ("/ar/", "https://careerhunt.app/ar/"),
        ("/ar/privacy", "https://careerhunt.app/ar/privacy/"),
    ] {
        let res = app
            .clone()
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::PERMANENT_REDIRECT, "{path}");
        assert_eq!(res.headers()["location"], to, "{path}");
    }
    let meta = ok(&app, BOB, "GET", "/api/meta", None).await;
    assert_eq!(meta["terms"], true);
    assert_eq!(meta["site"], "https://careerhunt.app");
    assert_eq!(meta["operator"], "Arabesque Labs Ltd");
    // The app's page carries the footer, linking the website's pages.
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/")
                .header("x-hunt-user", ADMIN)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let page = String::from_utf8_lossy(&body);
    assert!(page.contains(r#"href="https://careerhunt.app/privacy/" target="_blank" rel="noopener">Privacy notice</a>"#));
    assert!(page.contains("Made with"));
    // The front page is the app's.
    let res = app
        .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn someones_own_hunt_has_no_terms_but_links_its_source() {
    // Not run for others: nothing to agree to, and no legal pages.
    let app = shared_hunt();
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/privacy")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        ok(&app, BOB, "GET", "/api/meta", None).await["terms"],
        false
    );
    ok(
        &app,
        BOB,
        "POST",
        "/api/account/request",
        Some(json!({ "name": "Bob" })),
    )
    .await;
    let res = app
        .oneshot(
            Request::builder()
                .uri("/")
                .header("x-hunt-user", ADMIN)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let page = String::from_utf8_lossy(&body);
    assert!(page.contains("Made with"), "the footer says who made hunt");
    assert!(
        page.contains(hunt::site::SOURCE),
        "the footer links the source"
    );
    assert!(!page.contains("/privacy"));
}

#[tokio::test]
async fn people_can_delete_their_own_account_and_everything_in_it() {
    let app = shared_hunt();
    ok(
        &app,
        BOB,
        "POST",
        "/api/account/request",
        Some(json!({ "name": "Bob" })),
    )
    .await;
    let overview = ok(&app, ADMIN, "GET", "/api/admin/overview", None).await;
    let bob = overview["accounts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["email"] == BOB)
        .unwrap()["id"]
        .as_i64()
        .unwrap();
    ok(
        &app,
        ADMIN,
        "POST",
        &format!("/api/admin/accounts/{bob}/decide"),
        Some(json!({ "status": "active" })),
    )
    .await;
    make_things(&app, ADMIN).await;
    make_things(&app, BOB).await;
    let admins_before = ok(&app, ADMIN, "GET", "/api/applications", None).await;
    // Not without typing their address.
    let (status, v) = as_(
        &app,
        Some(BOB),
        "DELETE",
        "/api/account",
        Some(json!({ "confirm": "nope" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    // With it: gone, and all of theirs; the admin's untouched.
    let gone = ok(
        &app,
        BOB,
        "DELETE",
        "/api/account",
        Some(json!({ "confirm": BOB.to_uppercase() })),
    )
    .await;
    assert!(gone["rows_removed"].as_i64().unwrap() > 0, "{gone}");
    let overview = ok(&app, ADMIN, "GET", "/api/admin/overview", None).await;
    assert!(
        overview["accounts"]
            .as_array()
            .unwrap()
            .iter()
            .all(|a| a["email"] != BOB)
    );
    assert_eq!(
        ok(&app, ADMIN, "GET", "/api/applications", None).await,
        admins_before
    );
    assert_eq!(
        ok(&app, BOB, "GET", "/api/account", None).await["account"],
        Value::Null
    );
    // The only admin can't: hunt would have nobody to run it.
    let (status, v) = as_(
        &app,
        Some(ADMIN),
        "DELETE",
        "/api/account",
        Some(json!({ "confirm": ADMIN })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert!(v["error"].as_str().unwrap().contains("only admin"), "{v}");
}

#[tokio::test]
async fn admins_can_close_sign_ups() {
    // A new hunt starts closed to anyone new.
    let db = Arc::new(Mutex::new(test_db()));
    let closed = Tenants::open(db, &[ADMIN.to_string()], IdentitySource::BuiltIn).unwrap();
    assert!(!closed.signups_open().unwrap());
    let app = shared_hunt();
    let overview = ok(&app, ADMIN, "GET", "/api/admin/overview", None).await;
    assert_eq!(overview["signups_open"], true);
    // Closed: someone new is told, and can't ask.
    let closed = ok(
        &app,
        ADMIN,
        "PATCH",
        "/api/admin/settings",
        Some(json!({ "signups_open": false })),
    )
    .await;
    assert_eq!(closed["signups_open"], false);
    assert_eq!(
        ok(&app, BOB, "GET", "/api/meta", None).await["tenancy"]["signups_open"],
        false
    );
    let (status, v) = as_(
        &app,
        Some(BOB),
        "POST",
        "/api/account/request",
        Some(json!({ "agrees": true, "name": "Bob" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    // Only admins decide; the admin's own hunt carries on.
    let (status, _) = as_(
        &app,
        Some(BOB),
        "PATCH",
        "/api/admin/settings",
        Some(json!({ "signups_open": true })),
    )
    .await;
    assert!(!status.is_success());
    ok(&app, ADMIN, "GET", "/api/board", None).await;
    // Open again: Bob can ask.
    ok(
        &app,
        ADMIN,
        "PATCH",
        "/api/admin/settings",
        Some(json!({ "signups_open": true })),
    )
    .await;
    ok(
        &app,
        BOB,
        "POST",
        "/api/account/request",
        Some(json!({ "agrees": true, "name": "Bob" })),
    )
    .await;
}

/// A backup as an older hunt made it (schema 12: no postings, lanes or
/// owners; stages and reasons by id and code, as then).
fn old_backup() -> Value {
    json!({
        "hunt_backup": 1, "schema_version": 12, "made_at": "2026-09-01T10:00:00", "made_by": "hunt 0.2.0",
        "tables": {
            "stage": [
                { "id": 1, "name": "Considering", "position": 0, "created_at": "x", "updated_at": "x" },
                { "id": 2, "name": "Interviewing", "position": 1, "created_at": "x", "updated_at": "x" }
            ],
            "archive_reason": [
                { "id": 1, "value": "rejected", "name": "They rejected me", "position": 0, "created_at": "x", "updated_at": "x" }
            ],
            "company": [{ "id": 1, "name": "Initech", "kind": "employer", "created_at": "x", "updated_at": "x" }],
            "application": [
                { "id": 1, "company_id": 1, "title": "SRE", "created_at": "x", "updated_at": "x" },
                { "id": 2, "company_id": 1, "title": "Platform", "via_id": 1, "created_at": "x", "updated_at": "x" }
            ],
            "process": [
                { "id": 1, "application_id": 1, "stage_id": 2, "position": 0, "status": "active", "created_at": "x", "updated_at": "x" },
                { "id": 2, "application_id": 2, "stage_id": 1, "position": 0, "status": "archived",
                  "archive_reason": "rejected", "created_at": "x", "updated_at": "x" }
            ],
            "step": [{ "id": 1, "process_id": 1, "title": "Onsite", "status": "scheduled", "created_at": "x", "updated_at": "x" }],
            "tag": [{ "id": 1, "name": "old", "created_at": "x", "updated_at": "x" }],
            "tagging": [{ "tag_id": 1, "entity": "application", "entity_id": 1 }],
            "setting": [{ "name": "locale.currency", "value": "GBP" }],
            "activity": [{ "id": 1, "at": "x", "entity": "application", "entity_id": 1, "action": "created", "summary": "Added application Initech — SRE" }]
        }
    })
}

#[tokio::test]
async fn an_old_backup_imports() {
    // Into one person's hunt: as it was, ids and all.
    let single = hunt::api::router(test_db());
    let req = Request::builder()
        .method("POST")
        .uri("/api/backup?confirm=replace")
        .header("content-type", "application/json")
        .body(Body::from(old_backup().to_string()))
        .unwrap();
    let res = single.clone().oneshot(req).await.unwrap();
    assert!(res.status().is_success(), "{}", res.status());
    let res = single
        .oneshot(
            Request::builder()
                .uri("/api/board?archived_since=")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let board: Value =
        serde_json::from_slice(&res.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(board["stages"][1]["cards"][0]["title"], "SRE");
    // And the board's swimlanes, its stages in them.
    assert_eq!(board["swimlanes"][1]["name"], "Terminated Processes");
    assert_eq!(
        board["closed_stages"][0]["swimlane_id"],
        board["swimlanes"][1]["id"]
    );
    // Its reasons became the lanes of inactive stages (each with the one
    // it belongs with), and what it had closed went there, keeping the
    // stage it got to.
    assert_eq!(board["archived"][0]["archive_reason"], "rejected");
    assert_eq!(
        (
            board["archived"][0]["stage"].clone(),
            board["archived"][0]["archive_label"].clone(),
            board["archived"][0]["reached_stage"].clone()
        ),
        (
            json!("Their Decision"),
            json!("They rejected me"),
            json!("Considering")
        )
    );

    // Into one account of a shared hunt, alongside the admin's: new ids,
    // everything pointing where it did.
    let app = shared_hunt();
    ok(
        &app,
        BOB,
        "POST",
        "/api/account/request",
        Some(json!({ "agrees": true, "name": "Bob" })),
    )
    .await;
    let bob = ok(&app, ADMIN, "GET", "/api/admin/overview", None).await["accounts"][0]["id"]
        .as_i64()
        .unwrap();
    ok(
        &app,
        ADMIN,
        "POST",
        &format!("/api/admin/accounts/{bob}/decide"),
        Some(json!({ "status": "active" })),
    )
    .await;
    ok(
        &app,
        ADMIN,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Initech", "title": "Admin's" })),
    )
    .await;
    ok(
        &app,
        BOB,
        "POST",
        "/api/backup?confirm=replace",
        Some(old_backup()),
    )
    .await;
    let board = ok(&app, BOB, "GET", "/api/board?archived_since=", None).await;
    let interviewing = board["stages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["name"] == "Interviewing")
        .unwrap();
    assert_eq!(interviewing["cards"][0]["title"], "SRE");
    assert_eq!(interviewing["cards"][0]["tags"], "old");
    assert_eq!(board["archived"][0]["archive_reason"], "rejected");
    let apps = ok(&app, BOB, "GET", "/api/applications", None).await;
    let platform = apps
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["title"] == "Platform")
        .unwrap();
    let sre = apps
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["title"] == "SRE")
        .unwrap();
    assert_eq!(
        platform["via_id"], sre["id"],
        "\"came through\" follows the new ids"
    );
    let steps = ok(&app, BOB, "GET", "/api/steps", None).await;
    assert_eq!(steps[0]["title"], "Onsite");
    // The admin's hunt is as it was.
    let theirs = ok(&app, ADMIN, "GET", "/api/applications", None).await;
    assert_eq!(theirs.as_array().unwrap().len(), 1);
    assert_eq!(theirs[0]["title"], "Admin's");
}

// ---- Cloudflare Access's tokens --------------------------------------------------------

/// A throwaway RSA key, made for these tests only, to sign test tokens
/// with: not a secret, and trusted by nothing.
const TEST_KEY: &str = "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCW0YcaXZZk/ZA3\n7ZQfDqE5te82/7IctkF3c9rxZz7P/WdIKJBjwaGbP34Cbdhm0/1b+vJcRAC4upq9\n5V+eipr6sOPNWx/IBaueeN3q+ofc2WneW/0mTyCvVR4v34KFdy1HeYBK753E4FXF\nvj2GnqxHl9BOsL7mU77/l/MCxrRnqKq08koYOP9SMTq6Z9KfcIdUhVqSwkoIVpDf\n9F0BnL1Z5TISbSJEr0lxH4t1GHgw4ki/uc8UMcbXumEc5Fmafa+8LNAj4hgiEvMq\n5qryq5hMkjx8oVazI08oIsYDbIOsL3gCIu72JNYfpZnXVZBJIrnWFAYHrGjLPNNr\nppkUvi3pAgMBAAECggEAGqeMP5IjttSDbQb9gyGkR91KGkfFdEKXvmNI4hozpTGt\nU7jrj93UUGo/vHEqaj30DJIEzF6uW/eKyp3jsNLhQgYKNKxyqPirlJXa7qD5awQ3\nrDdIvcEFT0d1TtOrLyhZZcTo8hV4JifZsNmG6ShY3UxM4eNl0bIiUuzJY4e3sYv9\nryLjnRhll47cGZp2wukaW6skou2C6n61rb7tOooZ/WZOFEIO7M6UUlxPb7mxelO6\n6WPqefXF7qNSbvcMFKqYJ2qmiUoAzWAAN7xuFMDEcn077o02ZPJnEvS1E7rKjtIz\nJxt0UedisGAgKH30lRj4tFjR6z9z5aYeeg9NQCveAwKBgQDE4zmDQunbUbfhG0Vi\niNgHTIRCx2kDo7M35/ZgWKhaVTHhbqK8tYHYTSjQ24EG6/pXMP+U2QWgyzm3sgSk\n9Fp6u4dBTv3jxHpb5q6X+vHl8XONNIw0XQYTdH+FxafH1TsrYewBmFuXHmwcrrP3\nxbZ+U1EOTRovJmBJyIEDrVogBwKBgQDEGW5dHkTFQBA9Mui+JTVVCUlC5GuoECYz\nTq+lWHY3EWFy0dOhpbuZ5gISZo3x7R9CqMdhm/EgdXuhxlg9VgNF7sJbuKp4p0R0\n1j7oYi87e+pqGygLOZLT/WA2wsLQx3Ry93BfatrnX9lBNB82bBIMYbIs0/3fC1xO\n7fqknGDmjwKBgExgVPwtZeiVX75sRNM/gIX8UcZR8tPdmfVS/4lKeyxnpizsLScF\nRjRxYib7L6dOvVM7h7nnIj7I9z/iR9jxjXPU8VgNW4ISwuCJsSr1xwbLTmb1fnoF\nqAi+BYYQMdDcT9K5bsMDpmwN+iR6RQgV44BHs8bXdBPcUDfvFtUlVzPbAoGBAIRr\nY+JPkULdmtmoqg/UkmoE5krccnI/zXvyE5wE23ceLn7ZgB51CvTGo/mG9S074VMj\nI9ge9Lnle4HnrShmD7nGm8pSLhNhaFG5ZyuHObviVo4mHmlODH9IZxMze1h+h30m\n5+QXBREe4VctejJG0f04b5fj41gdlMzb2NgVnT2zAoGBAKJlX+IRnT1f0ZJSGe7p\nC6eijwDLGib+3xwbysmSyRybjwzoeXAMlSSmJb4z+6rsqrJ06ANgYBoCz9+T3cmA\nHf/4XO0d1q/qjkOHIlA67eF/y916AxjV07zkxNJCPhl9DiaHQTs213oZHW3351SB\nQOWoO98xbOj1yxLrHClssuiB\n-----END PRIVATE KEY-----";
const TEST_N: &str = "ltGHGl2WZP2QN-2UHw6hObXvNv-yHLZBd3Pa8Wc-z_1nSCiQY8Ghmz9-Am3YZtP9W_ryXEQAuLqaveVfnoqa-rDjzVsfyAWrnnjd6vqH3Nlp3lv9Jk8gr1UeL9-ChXctR3mASu-dxOBVxb49hp6sR5fQTrC-5lO-_5fzAsa0Z6iqtPJKGDj_UjE6umfSn3CHVIVaksJKCFaQ3_RdAZy9WeUyEm0iRK9JcR-LdRh4MOJIv7nPFDHG17phHORZmn2vvCzQI-IYIhLzKuaq8quYTJI8fKFWsyNPKCLGA2yDrC94AiLu9iTWH6WZ11WQSSK51hQGB6xoyzzTa6aZFL4t6Q";

fn token(claims: Value, key: &str) -> String {
    let mut header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256);
    header.kid = Some("k1".into());
    jsonwebtoken::encode(
        &header,
        &claims,
        &jsonwebtoken::EncodingKey::from_rsa_pem(key.as_bytes()).unwrap(),
    )
    .unwrap()
}

fn keys() -> jsonwebtoken::jwk::JwkSet {
    serde_json::from_value(json!({ "keys": [{ "kid": "k1", "kty": "RSA", "alg": "RS256", "use": "sig", "n": TEST_N, "e": "AQAB" }] })).unwrap()
}

#[test]
fn access_tokens_are_checked() {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let good = json!({ "aud": ["app-aud"], "iss": "https://team.cloudflareaccess.com", "email": "Bob@Example.test",
                       "exp": now + 600, "iat": now });
    let claims =
        hunt::tenants::verify_with_keys(&token(good.clone(), TEST_KEY), "team", "app-aud", keys())
            .unwrap();
    assert_eq!(claims["email"], "Bob@Example.test");
    // For another application, from another team, or out of date: refused.
    assert!(
        hunt::tenants::verify_with_keys(
            &token(good.clone(), TEST_KEY),
            "team",
            "other-aud",
            keys()
        )
        .is_err()
    );
    assert!(
        hunt::tenants::verify_with_keys(
            &token(good.clone(), TEST_KEY),
            "elsewhere",
            "app-aud",
            keys()
        )
        .is_err()
    );
    let mut old = good.clone();
    old["exp"] = json!(now - 3600);
    assert!(
        hunt::tenants::verify_with_keys(&token(old, TEST_KEY), "team", "app-aud", keys()).is_err()
    );
    // Tampered with: refused.
    let t = token(good, TEST_KEY);
    let mut parts: Vec<String> = t.split('.').map(String::from).collect();
    parts[1] = parts[1].chars().rev().collect();
    assert!(hunt::tenants::verify_with_keys(&parts.join("."), "team", "app-aud", keys()).is_err());
    // The team's address, however it's given.
    assert_eq!(
        hunt::tenants::team_url("team"),
        "https://team.cloudflareaccess.com"
    );
    assert_eq!(
        hunt::tenants::team_url("https://team.cloudflareaccess.com/"),
        "https://team.cloudflareaccess.com"
    );
}

/// Take-home pay is for everyone who may use hunt and lives in the UK, as
/// each account says in its settings; it isn't for anyone signed out. The
/// experiment it was is still taken when hunt starts, and does nothing.
#[tokio::test]
async fn take_home_pay_is_for_each_account_in_the_uk() {
    let db = Arc::new(Mutex::new(test_db()));
    let tenants = Tenants::open(
        db.clone(),
        &[ADMIN.to_string()],
        IdentitySource::Header("x-hunt-user".into()),
    )
    .unwrap();
    tenants.set_signups_open(true).unwrap();
    let experiments =
        hunt::experiments::Experiments::parse(&[format!("take-home={}", ADMIN.to_uppercase())])
            .unwrap();
    let app = hunt::api::router_tenants_trying(db, tenants, experiments);
    // Bob is let in, as an ordinary account.
    ok(
        &app,
        BOB,
        "POST",
        "/api/account/request",
        Some(json!({ "agrees": true, "name": "Bob" })),
    )
    .await;
    let bob = ok(&app, ADMIN, "GET", "/api/admin/overview", None).await["accounts"][0]["id"]
        .as_i64()
        .unwrap();
    ok(
        &app,
        ADMIN,
        "POST",
        &format!("/api/admin/accounts/{bob}/decide"),
        Some(json!({ "status": "active" })),
    )
    .await;

    let salary = json!({ "salary": 50000, "year": "2026-27" });
    // No longer an experiment, even named as one: nothing in meta.
    let meta = ok(&app, ADMIN, "GET", "/api/meta", None).await;
    assert_eq!(meta["experiments"], json!([]));
    // There once they say they live in the UK; each account for itself.
    for who in [ADMIN, BOB] {
        let (status, _) = as_(&app, Some(who), "GET", "/api/take-home", None).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{who}");
    }
    ok(
        &app,
        ADMIN,
        "PATCH",
        "/api/settings",
        Some(json!({ "uk_resident": true })),
    )
    .await;
    let options = ok(&app, ADMIN, "GET", "/api/take-home", None).await;
    assert!(options["years"].as_array().unwrap().len() >= 2);
    let pay = ok(
        &app,
        ADMIN,
        "POST",
        "/api/take-home/salary",
        Some(salary.clone()),
    )
    .await;
    assert_eq!(pay["take_home"], 39519.6);

    // Bob hasn't said where he lives: not for him, yet; then it is.
    let (status, _) = as_(&app, Some(BOB), "GET", "/api/take-home", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    ok(
        &app,
        BOB,
        "PATCH",
        "/api/settings",
        Some(json!({ "uk_resident": true })),
    )
    .await;
    ok(&app, BOB, "GET", "/api/take-home", None).await;

    // Signed out: not there, even for a bad body.
    for (method, path, body) in [
        ("GET", "/api/take-home", None),
        ("POST", "/api/take-home/salary", Some(salary.clone())),
        (
            "POST",
            "/api/take-home/contract",
            Some(json!({ "day_rate": "lots" })),
        ),
    ] {
        let (status, _) = as_(&app, None, method, path, body).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "signed out: {method} {path}");
    }
}

#[tokio::test]
async fn admins_invite_people_set_new_accounts_defaults_and_see_usage_without_names() {
    let app = shared_hunt();
    // New accounts start in Arabic, in euros.
    ok(
        &app,
        ADMIN,
        "PATCH",
        "/api/admin/settings",
        Some(json!({ "signups_open": false, "defaults": { "language": "ar", "currency": "EUR" } })),
    )
    .await;
    let (status, _) = as_(
        &app,
        Some(ADMIN),
        "PATCH",
        "/api/admin/settings",
        Some(json!({ "defaults": { "language": "xx" } })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    // Closed for sign-ups, Bob can't ask; invited, he's in.
    let (status, _) = as_(
        &app,
        Some(BOB),
        "POST",
        "/api/account/request",
        Some(json!({ "agrees": true })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let invited = ok(
        &app,
        ADMIN,
        "POST",
        "/api/admin/invites",
        Some(json!({ "email": BOB, "name": "Bob" })),
    )
    .await;
    assert_eq!(
        (invited["status"].as_str(), invited["provider"].as_str()),
        (Some("active"), Some("invite"))
    );
    let (status, _) = as_(
        &app,
        Some(ADMIN),
        "POST",
        "/api/admin/invites",
        Some(json!({ "email": BOB })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "already has an account"
    );
    let settings = ok(&app, BOB, "GET", "/api/settings", None).await;
    assert_eq!(
        (settings["language"].as_str(), settings["currency"].as_str()),
        (Some("ar"), Some("EUR"))
    );
    ok(
        &app,
        BOB,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Acme" })),
    )
    .await;
    // Usage: counts by account number, and nothing about who.
    let usage = ok(&app, ADMIN, "GET", "/api/admin/usage", None).await;
    let bob = usage["accounts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["id"] == invited["id"])
        .unwrap();
    assert_eq!(
        (
            bob["applications"].as_i64(),
            bob["active"].as_i64(),
            bob["cycles"].as_i64()
        ),
        (Some(1), Some(1), Some(1))
    );
    assert!(bob["rows"].as_i64().unwrap() > 0);
    let text = usage.to_string();
    assert!(!text.contains(BOB) && !text.contains("Bob"), "{text}");
    let (status, _) = as_(&app, Some(BOB), "GET", "/api/admin/usage", None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn a_shared_calendar_shows_only_its_own_accounts_events() {
    let app = shared_hunt();
    ok(
        &app,
        ADMIN,
        "POST",
        "/api/admin/invites",
        Some(json!({ "email": BOB })),
    )
    .await;
    for (who, title) in [(ADMIN, "Admin's interview"), (BOB, "Bob's interview")] {
        let card = ok(
            &app,
            who,
            "POST",
            "/api/processes",
            Some(json!({ "company": "Acme" })),
        )
        .await;
        ok(
            &app,
            who,
            "POST",
            "/api/steps",
            Some(json!({ "process_id": card["id"], "title": title, "at": "2999-01-01T10:00" })),
        )
        .await;
    }
    let token = ok(
        &app,
        BOB,
        "PATCH",
        "/api/settings",
        Some(json!({ "calendar_feed": true })),
    )
    .await["calendar_feed"]
        .as_str()
        .unwrap()
        .to_string();
    // Signed out, by the link alone.
    let (status, _) = as_(
        &app,
        None,
        "GET",
        &format!("/api/calendar/{token}.ics"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let res = app
        .clone()
        .oneshot(
            Request::get(format!("/api/calendar/{token}.ics"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let ics =
        String::from_utf8_lossy(&res.into_body().collect().await.unwrap().to_bytes()).to_string();
    assert!(
        ics.contains("Bob's interview") && !ics.contains("Admin's interview"),
        "{ics}"
    );
    // The admin hasn't shared theirs.
    assert!(ok(&app, ADMIN, "GET", "/api/settings", None).await["calendar_feed"].is_null());
}

#[tokio::test]
async fn each_new_account_gets_its_own_lanes() {
    let app = shared_hunt();
    ok(
        &app,
        ADMIN,
        "POST",
        "/api/admin/invites",
        Some(json!({ "email": BOB })),
    )
    .await;
    for who in [ADMIN, BOB] {
        let lanes = ok(&app, who, "GET", "/api/lanes", None).await;
        // The board's lanes: the inactive Closed stage's are its endings.
        let names: Vec<&str> = lanes
            .as_array()
            .unwrap()
            .iter()
            .filter(|l| l["value"].is_null())
            .map(|l| l["name"].as_str().unwrap())
            .collect();
        assert_eq!(
            names,
            ["Preparing", "Waiting on a decision", "Accepted"],
            "{who}"
        );
    }
}

/// A shared hunt behind a sign-in proxy, which names people in
/// `Remote-Email`, from `trusted` addresses.
fn proxied_hunt(trusted: &[&str]) -> Router {
    let db = Arc::new(Mutex::new(test_db()));
    let identity = IdentitySource::Proxy {
        header: "Remote-Email".into(),
        trusted: trusted
            .iter()
            .map(|t| hunt::auth::Cidr::parse(t).unwrap())
            .collect(),
    };
    let tenants = Tenants::open(db.clone(), &[ADMIN.to_string()], identity).unwrap();
    tenants.set_signups_open(true).unwrap();
    hunt::api::router_tenants(db, tenants)
}

/// A request for `/api/meta` from `peer`, naming `who` in the proxy's header.
async fn meta_from(app: &Router, peer: Option<&str>, who: &str) -> Value {
    let mut req = Request::builder()
        .uri("/api/meta")
        .header("remote-email", who)
        .body(Body::empty())
        .unwrap();
    if let Some(peer) = peer {
        req.extensions_mut()
            .insert(axum::extract::ConnectInfo::<std::net::SocketAddr>(
                peer.parse().unwrap(),
            ));
    }
    let res = app.clone().oneshot(req).await.unwrap();
    let body = res.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&body).unwrap()
}

#[tokio::test]
async fn a_sign_in_proxys_header_counts_only_from_the_proxy() {
    let app = proxied_hunt(&["10.0.0.0/8"]);
    // From the proxy: who it says.
    let meta = meta_from(&app, Some("10.1.2.3:5000"), ADMIN).await;
    assert_eq!(meta["tenancy"]["signed_in"], true, "{meta}");
    assert_eq!(meta["tenancy"]["account"]["email"], ADMIN);
    // From anywhere else, or not knowing where: nobody, whatever it says.
    for peer in [Some("192.168.1.9:5000"), None] {
        let meta = meta_from(&app, peer, ADMIN).await;
        assert_eq!(meta["tenancy"]["signed_in"], false, "{peer:?}: {meta}");
    }
    // Unless told otherwise, only this machine is the proxy.
    let local = proxied_hunt(&["127.0.0.1", "::1"]);
    let meta = meta_from(&local, Some("[::1]:5000"), ADMIN).await;
    assert_eq!(meta["tenancy"]["signed_in"], true, "{meta}");
}

#[tokio::test]
async fn admins_name_the_hunt_and_everyone_sees_what_it_says() {
    let app = shared_hunt();
    let about = ok(&app, BOB, "GET", "/api/meta", None).await["about"].clone();
    assert_eq!(
        about,
        json!({ "name": null, "announcement": null, "contact": null })
    );
    let set = ok(
        &app,
        ADMIN,
        "PATCH",
        "/api/admin/settings",
        Some(json!({ "site": { "name": "  Acme careers ", "announcement": "Down for upkeep at 10pm", "contact": "help@acme.test" } })),
    )
    .await;
    assert_eq!(set["site"]["name"], "Acme careers");
    // Everyone sees it, an account or not yet.
    let about = ok(&app, BOB, "GET", "/api/meta", None).await["about"].clone();
    assert_eq!(
        (
            about["name"].as_str(),
            about["announcement"].as_str(),
            about["contact"].as_str()
        ),
        (
            Some("Acme careers"),
            Some("Down for upkeep at 10pm"),
            Some("help@acme.test")
        )
    );
    for bad in [
        json!({ "site": { "contact": "not an address" } }),
        json!({ "site": { "name": "x".repeat(41) } }),
    ] {
        let (status, _) = as_(
            &app,
            Some(ADMIN),
            "PATCH",
            "/api/admin/settings",
            Some(bad.clone()),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{bad}");
    }
    // Only admins say it; emptied, it's gone, the rest as it was.
    let (status, _) = as_(
        &app,
        Some(BOB),
        "PATCH",
        "/api/admin/settings",
        Some(json!({ "site": { "name": "Bob's" } })),
    )
    .await;
    assert!(!status.is_success());
    let set = ok(
        &app,
        ADMIN,
        "PATCH",
        "/api/admin/settings",
        Some(json!({ "site": { "announcement": "" } })),
    )
    .await;
    assert!(set["site"]["announcement"].is_null());
    assert_eq!(set["site"]["name"], "Acme careers");
}
