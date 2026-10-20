//! The API, driven through its router.

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use hunt::Db;
use serde_json::{Value, json};
use tower::ServiceExt;

/// A new, empty database: SQLite in memory, or, when `HUNT_TEST_DB` names a
/// PostgreSQL or MySQL server, a database made there for this test.
fn test_db() -> Db {
    match std::env::var("HUNT_TEST_DB") {
        Ok(server) if !server.is_empty() => {
            static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
            let name = format!(
                "hunt_test_{}_{}_{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_millis()
                    % 1_000_000,
                N.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
            );
            Db::open(hunt::store::create_database(&server, &name).unwrap()).unwrap()
        }
        _ => Db::open_in_memory().unwrap(),
    }
}

fn app() -> Router {
    hunt::api::router(test_db())
}

async fn call(app: &Router, method: &str, path: &str, body: Option<Value>) -> (StatusCode, Value) {
    let req = Request::builder().method(method).uri(path);
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
    let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, value)
}

async fn ok(app: &Router, method: &str, path: &str, body: Option<Value>) -> Value {
    let (status, v) = call(app, method, path, body).await;
    assert!(status.is_success(), "{method} {path}: {status} {v}");
    v
}

fn stage_id(board: &Value, name: &str) -> i64 {
    board["stages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["name"] == name)
        .unwrap()["id"]
        .as_i64()
        .unwrap()
}

fn column(board: &Value, name: &str) -> Vec<String> {
    board["stages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["name"] == name)
        .unwrap()["cards"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["company"].as_str().unwrap().to_string())
        .collect()
}

#[tokio::test]
async fn a_new_database_has_the_usual_stages() {
    let app = app();
    let board = ok(&app, "GET", "/api/board", None).await;
    let stages: Vec<&str> = board["stages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        stages,
        [
            "Considering",
            "Applied",
            "Screening",
            "Interviewing",
            "Offer"
        ]
    );
    let meta = ok(&app, "GET", "/api/meta", None).await;
    let names: Vec<&str> = meta["resources"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        names,
        [
            "swimlanes",
            "stages",
            "lanes",
            "companies",
            "people",
            "applications",
            "processes",
            "postings",
            "steps",
            "notes",
            "documents",
            "versions",
            "memos",
            "tags",
            "cycles",
            "reminders",
            "links",
            "prep",
            "stories"
        ]
    );
}

#[tokio::test]
async fn adding_a_process_creates_its_application_and_company() {
    let app = app();
    let board = ok(&app, "GET", "/api/board", None).await;
    let applied = stage_id(&board, "Applied");
    let card = ok(
        &app,
        "POST",
        "/api/processes",
        Some(
            json!({ "company": "Acme", "title": "Staff Engineer", "source": "referral",
                      "stage_id": applied }),
        ),
    )
    .await;
    assert_eq!(card["company"], "Acme");
    assert_eq!(card["stage"], "Applied");
    // What's next is a reminder, and the card shows the soonest.
    ok(
        &app,
        "POST",
        "/api/reminders",
        Some(json!({ "process_id": card["id"], "title": "chase", "due_at": "2026-10-09 15:00" })),
    )
    .await;
    let board = ok(&app, "GET", "/api/board", None).await;
    let c = &board["stages"][1]["cards"][0];
    assert_eq!(
        (c["reminder"].as_str(), c["reminder_at"].as_str()),
        (Some("chase"), Some("2026-10-09T15:00"))
    );
    let (status, v) = call(
        &app,
        "PATCH",
        &format!("/api/processes/{}", card["id"]),
        Some(json!({ "next_action": "chase" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{v}");

    // The same company, however it's capitalised, is reused.
    ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "ACME", "title": "SRE" })),
    )
    .await;
    let companies = ok(&app, "GET", "/api/companies", None).await;
    assert_eq!(companies.as_array().unwrap().len(), 1);
    // And it lands in the first column when none is given.
    let board = ok(&app, "GET", "/api/board", None).await;
    assert_eq!(column(&board, "Considering"), ["Acme"]);

    // Lead details and application_id don't mix.
    let (status, v) = call(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "application_id": 1, "title": "x" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
}

#[tokio::test]
async fn every_resource_is_editable_and_changes_are_logged() {
    let app = app();
    let card = ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Acme", "title": "Staff" })),
    )
    .await;
    let (pid, lid, cid) = (
        card["id"].as_i64().unwrap(),
        card["application_id"].as_i64().unwrap(),
        card["company_id"].as_i64().unwrap(),
    );
    let person = ok(
        &app,
        "POST",
        "/api/people",
        Some(json!({ "name": "Pat Chen", "company_id": cid })),
    )
    .await;
    let step = ok(
        &app,
        "POST",
        "/api/steps",
        Some(json!({ "process_id": pid, "title": "screen" })),
    )
    .await;
    let note = ok(
        &app,
        "POST",
        "/api/notes",
        Some(json!({ "process_id": pid, "body": "hi" })),
    )
    .await;

    for (path, patch) in [
        (
            format!("/api/companies/{cid}"),
            json!({ "website": "https://acme.test", "kind": "agency" }),
        ),
        (
            format!("/api/applications/{lid}"),
            json!({ "title": "Staff Engineer", "salary_min": "150k", "work_mode": "Remote" }),
        ),
        (
            format!("/api/processes/{pid}"),
            json!({ "note": "prep", "applied_on": "2026-10-01" }),
        ),
        (
            format!("/api/people/{}", person["id"]),
            json!({ "title": "Recruiter", "email": "pat@acme.test" }),
        ),
        (
            format!("/api/steps/{}", step["id"]),
            json!({ "at": "2026-10-10T10:00", "status": "passed" }),
        ),
        (
            format!("/api/notes/{}", note["id"]),
            json!({ "body": "hello" }),
        ),
        ("/api/stages/1".to_string(), json!({ "name": "Wishlist" })),
    ] {
        ok(&app, "PATCH", &path, Some(patch)).await;
    }
    let lead = ok(&app, "GET", &format!("/api/applications/{lid}"), None).await;
    assert_eq!(lead["salary_min"], 150_000);
    assert_eq!(lead["work_mode"], "remote");
    assert_eq!(lead["label"], "Acme — Staff Engineer");

    let log = ok(
        &app,
        "GET",
        &format!("/api/activity?entity=application&entity_id={lid}"),
        None,
    )
    .await;
    let latest = &log[0];
    assert_eq!(latest["action"], "updated");
    assert_eq!(
        latest["changes"]["title"],
        json!(["Staff", "Staff Engineer"])
    );
    assert!(
        latest["summary"]
            .as_str()
            .unwrap()
            .contains("role: Staff → Staff Engineer"),
        "{latest}"
    );

    // A process's timeline includes its application's and company's changes.
    let detail = ok(&app, "GET", &format!("/api/processes/{pid}/detail"), None).await;
    let summaries: Vec<&str> = detail["activity"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["summary"].as_str().unwrap())
        .collect();
    assert!(
        summaries
            .iter()
            .any(|s| s.starts_with("Updated company Acme")),
        "{summaries:?}"
    );
    assert!(
        summaries
            .iter()
            .any(|s| s.starts_with("Updated step screen")),
        "{summaries:?}"
    );

    // Clearing a field: null or "".
    ok(
        &app,
        "PATCH",
        &format!("/api/companies/{cid}"),
        Some(json!({ "website": "" })),
    )
    .await;
    assert_eq!(
        ok(&app, "GET", &format!("/api/companies/{cid}"), None).await["website"],
        Value::Null
    );
}

#[tokio::test]
async fn bad_input_is_explained() {
    let app = app();
    ok(
        &app,
        "POST",
        "/api/companies",
        Some(json!({ "name": "Acme" })),
    )
    .await;
    for (method, path, body, status, says) in [
        (
            "POST",
            "/api/companies",
            json!({ "name": "acme" }),
            StatusCode::CONFLICT,
            "already a company",
        ),
        (
            "POST",
            "/api/companies",
            json!({ "kind": "agency" }),
            StatusCode::UNPROCESSABLE_ENTITY,
            "needs a name",
        ),
        (
            "PATCH",
            "/api/companies/1",
            json!({ "kind": "cult" }),
            StatusCode::UNPROCESSABLE_ENTITY,
            "isn't one of employer, agency",
        ),
        (
            "PATCH",
            "/api/companies/1",
            json!({ "colour": "red" }),
            StatusCode::UNPROCESSABLE_ENTITY,
            "no field \"colour\"",
        ),
        (
            "PATCH",
            "/api/companies/1",
            json!({ "name": "" }),
            StatusCode::UNPROCESSABLE_ENTITY,
            "can't be empty",
        ),
        (
            "POST",
            "/api/applications",
            json!({ "company_id": 99 }),
            StatusCode::UNPROCESSABLE_ENTITY,
            "no company #99",
        ),
        (
            "POST",
            "/api/applications",
            json!({ "company_id": 1, "posted_on": "last week" }),
            StatusCode::UNPROCESSABLE_ENTITY,
            "not a date",
        ),
        (
            "POST",
            "/api/applications",
            json!({ "company_id": 1, "salary_min": "lots" }),
            StatusCode::UNPROCESSABLE_ENTITY,
            "not a number",
        ),
        (
            "GET",
            "/api/companies/42",
            Value::Null,
            StatusCode::NOT_FOUND,
            "no company #42",
        ),
        (
            "GET",
            "/api/widgets",
            Value::Null,
            StatusCode::NOT_FOUND,
            "no such resource",
        ),
    ] {
        let body = (!body.is_null()).then_some(body);
        let (got, v) = call(&app, method, path, body).await;
        assert_eq!(got, status, "{method} {path}: {v}");
        assert!(
            v["error"].as_str().unwrap().contains(says),
            "{method} {path}: {v}"
        );
    }
}

#[tokio::test]
async fn dragging_moves_cards_between_columns_and_within_them() {
    let app = app();
    let board = ok(&app, "GET", "/api/board", None).await;
    let applied = stage_id(&board, "Applied");
    let mut ids = Vec::new();
    for name in ["A", "B", "C"] {
        ids.push(
            ok(
                &app,
                "POST",
                "/api/processes",
                Some(json!({ "company": name, "stage_id": applied })),
            )
            .await["id"]
                .as_i64()
                .unwrap(),
        );
    }
    // C to the top of Applied: a reorder, not logged as a move.
    ok(
        &app,
        "POST",
        &format!("/api/processes/{}/move", ids[2]),
        Some(json!({ "stage_id": applied, "index": 0 })),
    )
    .await;
    let board = ok(&app, "GET", "/api/board", None).await;
    assert_eq!(column(&board, "Applied"), ["C", "A", "B"]);

    // A to the middle of Screening.
    let screening = stage_id(&board, "Screening");
    ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "X", "stage_id": screening })),
    )
    .await;
    ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Y", "stage_id": screening })),
    )
    .await;
    ok(
        &app,
        "POST",
        &format!("/api/processes/{}/move", ids[0]),
        Some(json!({ "stage_id": screening, "index": 1 })),
    )
    .await;
    let board = ok(&app, "GET", "/api/board", None).await;
    assert_eq!(column(&board, "Screening"), ["X", "A", "Y"]);
    assert_eq!(column(&board, "Applied"), ["C", "B"]);

    let log = ok(&app, "GET", "/api/activity?entity=process", None).await;
    let moves: Vec<&str> = log
        .as_array()
        .unwrap()
        .iter()
        .filter(|a| a["action"] == "moved")
        .map(|a| a["summary"].as_str().unwrap())
        .collect();
    assert_eq!(moves, ["Moved A from Applied to Screening"]);
}

#[tokio::test]
async fn archiving_and_resuming() {
    let app = app();
    let card = ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Acme", "title": "SRE" })),
    )
    .await;
    let id = card["id"].clone();

    // Closing needs a reason.
    let (status, v) = call(
        &app,
        "PATCH",
        &format!("/api/processes/{id}"),
        Some(json!({ "status": "archived" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(v["error"].as_str().unwrap().contains("why it's closed"));

    ok(
        &app,
        "PATCH",
        &format!("/api/processes/{id}"),
        Some(json!({ "status": "archived", "archive_reason": "Role filled", "archive_note": "internal" })),
    )
    .await;
    let board = ok(&app, "GET", "/api/board", None).await;
    assert_eq!(
        board["archived"][0]["archive_reason"], "role-filled",
        "by label or value"
    );
    // It's in the inactive stage its reason belongs with, in its lane, and keeps
    // the stage it got to.
    assert_eq!(
        (
            board["archived"][0]["stage"].clone(),
            board["archived"][0]["archive_label"].clone(),
            board["archived"][0]["reached_stage"].clone()
        ),
        (
            json!("Their Decision"),
            json!("Role filled"),
            json!("Considering")
        )
    );
    assert_eq!(board["archived_total"], 1);
    assert!(column(&board, "Considering").is_empty());
    let log = ok(&app, "GET", "/api/activity?entity=process", None).await;
    assert!(
        log[0]["summary"]
            .as_str()
            .unwrap()
            .starts_with("Closed process Acme — SRE"),
        "{}",
        log[0]
    );

    // The board can leave out what was archived before a date.
    let later = ok(&app, "GET", "/api/board?archived_since=2999-01-01", None).await;
    assert!(later["archived"].as_array().unwrap().is_empty());
    assert_eq!(later["archived_total"], 1);
    let (status, _) = call(&app, "GET", "/api/board?archived_since=soon", None).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // Moving it onto the board resumes it, and the reason goes.
    let interviewing = stage_id(&board, "Interviewing");
    ok(
        &app,
        "POST",
        &format!("/api/processes/{id}/move"),
        Some(json!({ "stage_id": interviewing })),
    )
    .await;
    let board = ok(&app, "GET", "/api/board", None).await;
    assert_eq!(column(&board, "Interviewing"), ["Acme"]);
    assert!(board["archived"].as_array().unwrap().is_empty());
    let p = ok(&app, "GET", &format!("/api/processes/{id}"), None).await;
    assert_eq!(
        (p["status"].clone(), p["archive_reason"].clone()),
        (json!("active"), Value::Null)
    );
    let log = ok(&app, "GET", "/api/activity?entity=process", None).await;
    assert_eq!(log[0]["summary"], "Reopened Acme — SRE in Interviewing");
}

#[tokio::test]
async fn stages_can_be_reordered_and_deleted() {
    let app = app();
    let board = ok(&app, "GET", "/api/board", None).await;
    let ids: Vec<i64> = board["stages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["id"].as_i64().unwrap())
        .collect();
    let mut order = ids.clone();
    order.reverse();
    let stages = ok(
        &app,
        "POST",
        "/api/stages/order",
        Some(json!({ "ids": order })),
    )
    .await;
    assert_eq!(stages[0]["name"], "Offer");
    let (status, _) = call(
        &app,
        "POST",
        "/api/stages/order",
        Some(json!({ "ids": [1, 2] })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // A stage with processes needs somewhere to send them.
    ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Acme", "stage_id": ids[1] })),
    )
    .await;
    let (status, v) = call(&app, "DELETE", &format!("/api/stages/{}", ids[1]), None).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(v["error"].as_str().unwrap().contains("choose a stage"));
    ok(
        &app,
        "DELETE",
        &format!("/api/stages/{}?move_to={}", ids[1], ids[2]),
        None,
    )
    .await;
    let board = ok(&app, "GET", "/api/board", None).await;
    assert_eq!(column(&board, "Screening"), ["Acme"]);

    // But the board keeps at least one.
    for id in [ids[0], ids[3], ids[4]] {
        ok(
            &app,
            "DELETE",
            &format!("/api/stages/{id}?move_to={}", ids[2]),
            None,
        )
        .await;
    }
    let (status, v) = call(&app, "DELETE", &format!("/api/stages/{}", ids[2]), None).await;
    assert_eq!(status, StatusCode::CONFLICT, "{v}");
}

#[tokio::test]
async fn people_on_a_process() {
    let app = app();
    let card = ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Acme" })),
    )
    .await;
    let id = card["id"].clone();
    let people = ok(
        &app,
        "POST",
        &format!("/api/processes/{id}/people"),
        Some(json!({ "name": "Sam Lee", "role": "Hiring manager" })),
    )
    .await;
    assert_eq!(people[0]["role"], "hiring-manager");
    assert_eq!(
        people[0]["company"], "Acme",
        "a new person joins the process's company"
    );
    let person = people[0]["id"].clone();
    // The same name finds the same person.
    let (status, _) = call(
        &app,
        "POST",
        &format!("/api/processes/{id}/people"),
        Some(json!({ "name": "sam lee" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let people = ok(
        &app,
        "PATCH",
        &format!("/api/processes/{id}/people/{person}"),
        Some(json!({ "role": "interviewer" })),
    )
    .await;
    assert_eq!(people[0]["role"], "interviewer");
    let people = ok(
        &app,
        "DELETE",
        &format!("/api/processes/{id}/people/{person}"),
        None,
    )
    .await;
    assert!(people.as_array().unwrap().is_empty());
    let log =
        ok(&app, "GET", &format!("/api/processes/{id}/detail"), None).await["activity"].clone();
    assert!(
        log[0]["summary"]
            .as_str()
            .unwrap()
            .starts_with("Removed Sam Lee")
    );
}

#[tokio::test]
async fn deleting_keeps_the_log_and_respects_what_depends_on_it() {
    let app = app();
    let card = ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Acme", "title": "SRE" })),
    )
    .await;
    let (status, v) = call(
        &app,
        "DELETE",
        &format!("/api/companies/{}", card["company_id"]),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(v["error"].as_str().unwrap().contains("it has applications"));

    // Deleting an application takes its processes with it; the log remembers both.
    ok(
        &app,
        "DELETE",
        &format!("/api/applications/{}", card["application_id"]),
        None,
    )
    .await;
    let (status, _) = call(&app, "GET", &format!("/api/processes/{}", card["id"]), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let log = ok(&app, "GET", "/api/activity?entity=application", None).await;
    assert_eq!(log[0]["action"], "deleted");
    assert_eq!(log[0]["changes"]["title"], "SRE");
    ok(
        &app,
        "DELETE",
        &format!("/api/companies/{}", card["company_id"]),
        None,
    )
    .await;
}

#[tokio::test]
async fn suggestions_and_search() {
    let app = app();
    for (company, source) in [("A", "referral"), ("B", "LinkedIn"), ("C", "referral")] {
        ok(
            &app,
            "POST",
            "/api/processes",
            Some(json!({ "company": company, "source": source })),
        )
        .await;
    }
    let s = ok(&app, "GET", "/api/suggest/applications/source?q=", None).await;
    assert_eq!(s, json!(["referral", "LinkedIn"]), "most used first");
    let found = ok(&app, "GET", "/api/processes?q=b", None).await;
    assert_eq!(found.as_array().unwrap().len(), 1);
    let (status, _) = call(&app, "GET", "/api/suggest/applications/title", None).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn the_web_ui_is_served() {
    let app = app();
    for path in [
        "/app",
        "/app/companies/1",
        "/",
        "/app.js",
        "/cycles.js",
        "/prep.js",
        "/style.css",
    ] {
        let res = app
            .clone()
            .oneshot(Request::get(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK, "{path}");
    }
}

#[test]
fn a_foreign_database_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("other.db");
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch("CREATE TABLE lead (id INTEGER PRIMARY KEY); PRAGMA user_version = 1;")
        .unwrap();
    drop(conn);
    let err = Db::open(&path).err().expect("refused");
    assert!(err.to_string().contains("move it aside"), "{err}");
    // Ours opens again fine.
    let ours = dir.path().join("hunt.db");
    Db::open(&ours).unwrap();
    Db::open(&ours).unwrap();
}

async fn upload(app: &Router, doc: &Value, name: &str, data: &[u8]) -> (StatusCode, Value) {
    let req = Request::post(format!(
        "/api/documents/{}/versions?filename={name}&tag=first",
        doc["id"]
    ))
    .header("content-type", "application/pdf")
    .body(Body::from(data.to_vec()))
    .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn documents_keep_their_versions_and_where_they_were_sent() {
    let app = app();
    let doc = ok(
        &app,
        "POST",
        "/api/documents",
        Some(json!({ "name": "Resume" })),
    )
    .await;
    assert_eq!(doc["kind"], "resume");

    // Versions are numbered; the same file twice is stored once.
    let (status, v1) = upload(&app, &doc, "cv.pdf", b"%PDF one").await;
    assert_eq!(status, StatusCode::OK, "{v1}");
    let (_, v2) = upload(&app, &doc, "cv-rust.pdf", b"%PDF two").await;
    let (_, v3) = upload(&app, &doc, "cv-again.pdf", b"%PDF one").await;
    assert_eq!(
        (
            v1["number"].clone(),
            v2["number"].clone(),
            v3["number"].clone()
        ),
        (json!(1), json!(2), json!(3))
    );
    assert_eq!(v2["label"], "Resume v2 (first)");
    assert_eq!(v1["content_type"], "application/pdf");
    assert_eq!(v1["sha256"], v3["sha256"]);

    // Files come back as uploaded, with their names.
    let res = app
        .clone()
        .oneshot(
            Request::get(format!("/api/versions/{}/file?download=1", v2["id"]))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let disposition = res.headers()["content-disposition"]
        .to_str()
        .unwrap()
        .to_string();
    assert!(
        disposition.starts_with("attachment; filename=\"cv-rust.pdf\""),
        "{disposition}"
    );
    assert_eq!(
        &res.into_body().collect().await.unwrap().to_bytes()[..],
        b"%PDF two"
    );

    // A version's label and note are editable; its file and document aren't.
    ok(
        &app,
        "PATCH",
        &format!("/api/versions/{}", v2["id"]),
        Some(json!({ "tag": "rust-focused" })),
    )
    .await;
    let (status, v) = call(
        &app,
        "PATCH",
        &format!("/api/versions/{}", v2["id"]),
        Some(json!({ "document_id": 99 })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        v["error"].as_str().unwrap().contains("can't be changed"),
        "{v}"
    );
    let (status, _) = call(
        &app,
        "POST",
        "/api/versions",
        Some(json!({ "document_id": doc["id"] })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "versions come from uploads"
    );
    let (status, _) = upload(&app, &doc, "empty.pdf", b"").await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // Recording what went with a process: a version, or a document's latest.
    let card = ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Acme", "title": "SRE" })),
    )
    .await;
    let pid = card["id"].clone();
    ok(
        &app,
        "POST",
        &format!("/api/processes/{pid}/files"),
        Some(json!({ "version_id": v2["id"] })),
    )
    .await;
    let files = ok(
        &app,
        "POST",
        &format!("/api/processes/{pid}/files"),
        Some(json!({ "document_id": doc["id"] })),
    )
    .await;
    let labels: Vec<&str> = files
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["label"].as_str().unwrap())
        .collect();
    assert_eq!(labels, ["Resume v2 (rust-focused)", "Resume v3 (first)"]);
    let (status, _) = call(
        &app,
        "POST",
        &format!("/api/processes/{pid}/files"),
        Some(json!({ "version_id": v2["id"] })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let uses = ok(
        &app,
        "GET",
        &format!("/api/versions/{}/uses", v2["id"]),
        None,
    )
    .await;
    assert_eq!(uses[0]["label"], "Acme — SRE");
    let board = ok(&app, "GET", "/api/board", None).await;
    assert_eq!(board["stages"][0]["cards"][0]["files"], 2);
    let detail = ok(&app, "GET", &format!("/api/processes/{pid}/detail"), None).await;
    assert!(
        detail["activity"][0]["summary"]
            .as_str()
            .unwrap()
            .starts_with("Sent Resume v3 (first) with Acme — SRE")
    );

    // A version that was sent can't be deleted until it's taken off.
    let (status, v) = call(&app, "DELETE", &format!("/api/versions/{}", v2["id"]), None).await;
    assert_eq!(status, StatusCode::CONFLICT, "{v}");
    ok(
        &app,
        "DELETE",
        &format!("/api/processes/{pid}/files/{}", v2["id"]),
        None,
    )
    .await;
    ok(&app, "DELETE", &format!("/api/versions/{}", v2["id"]), None).await;
    let (status, _) = call(
        &app,
        "GET",
        &format!("/api/versions/{}/file", v2["id"]),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // v1's file is still there: v3 shares it.
    let res = app
        .clone()
        .oneshot(
            Request::get(format!("/api/versions/{}/file", v1["id"]))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn what_a_record_belongs_to_is_fixed() {
    let app = app();
    let card = ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Acme" })),
    )
    .await;
    let other = ok(
        &app,
        "POST",
        "/api/applications",
        Some(json!({ "company_id": card["company_id"], "title": "SRE" })),
    )
    .await;
    let (status, v) = call(
        &app,
        "PATCH",
        &format!("/api/processes/{}", card["id"]),
        Some(json!({ "application_id": other["id"] })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        v["error"]
            .as_str()
            .unwrap()
            .contains("Application can't be changed")
    );
    // Sending the record back unchanged is fine.
    let p = ok(&app, "GET", &format!("/api/processes/{}", card["id"]), None).await;
    ok(
        &app,
        "PATCH",
        &format!("/api/processes/{}", card["id"]),
        Some(p),
    )
    .await;
}

#[test]
fn a_version_1_database_is_upgraded() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("hunt.db");
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch(include_str!("fixtures/schema_v1.sql"))
        .unwrap();
    conn.execute_batch(
        "PRAGMA application_id = 1752526452; PRAGMA user_version = 1;
         INSERT INTO hunt VALUES (1, 'post-fb', '2020-01-01', '2020-06-01', NULL, 'x', 'x'),
                                 (2, 'post-databricks', '2026-10-01', NULL, NULL, 'x', 'x');
         INSERT INTO stage VALUES (1, 'Applied', 0, 'x', 'x');
         INSERT INTO company (id, name, created_at, updated_at) VALUES (1, 'Acme', 'x', 'x');
         INSERT INTO lead (id, company_id, title, created_at, updated_at) VALUES (1, 1, 'SRE', 'x', 'x'),
                                                                                  (2, 1, 'Staff', 'x', 'x');
         INSERT INTO process (id, hunt_id, lead_id, stage_id, position, status, stop_reason, status_note,
                              resume, note, created_at, updated_at)
           VALUES (1, 1, 1, 1, 0, 'stopped', 'rejected', 'after onsite', 'cv-v1', NULL, '2020-02-01T00:00:00', 'x'),
                  (2, 2, 2, 1, 0, 'active', NULL, NULL, NULL, 'keen', '2026-10-02T00:00:00', 'x'),
                  (3, 2, 1, 1, 1, 'paused', NULL, 'till Nov', 'cv-v3', 'hm', '2026-10-03T00:00:00', 'x');
         INSERT INTO activity (at, entity, entity_id, action, summary) VALUES ('x', 'lead', 1, 'created', 'Added lead');",
    )
    .unwrap();
    drop(conn);

    let db = Db::open(&path).unwrap();
    let board = db.board(None, None).unwrap();
    assert_eq!(board["stages"][0]["cards"][0]["title"], "Staff");
    let archived: Vec<(String, String)> = board["archived"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| {
            (
                c["archive_reason"].as_str().unwrap().into(),
                c["archive_note"].as_str().unwrap().into(),
            )
        })
        .collect();
    assert!(archived.contains(&("rejected".into(), "after onsite".into())));
    assert!(archived.contains(&("on-hold".into(), "till Nov".into())));
    let p3 = db
        .get(hunt::resource::resource("processes").unwrap(), 3)
        .unwrap();
    assert_eq!(p3["note"], "hm\nResume sent: cv-v3");
    let log = db.activity(Some("application"), Some(1), 10).unwrap();
    assert_eq!(log.len(), 1, "old activity follows the rename");
    // What was there became one cycle, started with its first process.
    let cycles = db.cycles_overview().unwrap();
    assert_eq!(cycles.len(), 1);
    assert_eq!(
        (cycles[0]["name"].as_str(), cycles[0]["started_on"].as_str()),
        (Some("My job search"), Some("2020-02-01"))
    );
    assert_eq!(cycles[0]["counts"]["active"], 1);
    drop(db);
    // And it opens again as a current database.
    Db::open(&path).unwrap();
}

#[tokio::test]
async fn files_that_could_run_script_are_sandboxed() {
    let app = app();
    let doc = ok(
        &app,
        "POST",
        "/api/documents",
        Some(json!({ "name": "Portfolio" })),
    )
    .await;
    let mut csp = Vec::new();
    for (name, kind) in [
        ("site.html", "text/html"),
        ("cv.pdf", "application/pdf"),
        ("me.png", "image/png"),
        ("logo.svg", ""),
    ] {
        let req = Request::post(format!(
            "/api/documents/{}/versions?filename={name}",
            doc["id"]
        ))
        .header("content-type", kind)
        .body(Body::from("<script>alert(1)</script>"))
        .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        let v: Value = serde_json::from_slice(&bytes).unwrap();
        let res = app
            .clone()
            .oneshot(
                Request::get(format!("/api/versions/{}/file", v["id"]))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        csp.push((
            name,
            res.headers()
                .get("content-type")
                .unwrap()
                .to_str()
                .unwrap()
                .to_string(),
            res.headers()
                .get("content-security-policy")
                .map(|v| v.to_str().unwrap().to_string()),
        ));
    }
    let sandbox = Some("sandbox".to_string());
    assert_eq!(
        csp,
        [
            ("site.html", "text/html".into(), sandbox.clone()),
            ("cv.pdf", "application/pdf".into(), None),
            ("me.png", "image/png".into(), None),
            ("logo.svg", "image/svg+xml".into(), sandbox),
        ]
    );
}

/// A small website to import from, on a free port.
async fn company_site() -> String {
    use axum::routing::get;
    let site = Router::new()
        .route(
            "/",
            get(|| async {
                axum::response::Html(
                    r#"<html><head><title>Globex | Home</title>
                    <script type="application/ld+json">{"@type":"Organization","name":"Globex",
                      "description":"Widgets, at scale.","foundingDate":"1989",
                      "sameAs":["https://www.linkedin.com/company/globex"]}</script>
                    </head><body></body></html>"#,
                )
            }),
        )
        .route(
            "/cv.pdf",
            get(|| async { ([("content-type", "application/pdf")], "%PDF") }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, site).await.unwrap() });
    url
}

#[tokio::test(flavor = "multi_thread")]
async fn company_details_can_be_imported_from_a_page() {
    let app = app();
    let site = company_site().await;
    let found = ok(
        &app,
        "POST",
        "/api/companies/lookup",
        Some(json!({ "url": format!("{site}/") })),
    )
    .await;
    assert_eq!(found["name"], "Globex");
    assert_eq!(found["description"], "Widgets, at scale.");
    assert_eq!(found["founded"], "1989");
    assert_eq!(found["linkedin"], "https://www.linkedin.com/company/globex");
    assert_eq!(found["website"], site.as_str());

    // Nothing is saved until asked.
    assert!(
        ok(&app, "GET", "/api/companies", None)
            .await
            .as_array()
            .unwrap()
            .is_empty()
    );
    // What was found goes straight into a new company.
    let mut body = found.clone();
    body.as_object_mut().unwrap().remove("source");
    let made = ok(&app, "POST", "/api/companies", Some(body)).await;
    assert_eq!(made["founded"], "1989");

    for (url, status, says) in [
        (
            format!("{site}/cv.pdf"),
            StatusCode::BAD_GATEWAY,
            "isn't a web page",
        ),
        (
            format!("{site}/nowhere"),
            StatusCode::BAD_GATEWAY,
            "answered 404",
        ),
        (
            "not a url".to_string(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "not a web address",
        ),
    ] {
        let (got, v) = call(
            &app,
            "POST",
            "/api/companies/lookup",
            Some(json!({ "url": url })),
        )
        .await;
        assert_eq!(got, status, "{url}: {v}");
        assert!(v["error"].as_str().unwrap().contains(says), "{url}: {v}");
    }
}

/// A careers page with one posting, on a free port.
async fn careers_site() -> String {
    use axum::routing::get;
    let site = Router::new().route(
        "/jobs/rust",
        get(|| async {
            axum::response::Html(
                r#"<html><head><title>Rust Engineer</title>
                <script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting",
                  "title":"Senior Rust Engineer","datePosted":"2026-09-30","validThrough":"2026-11-01T00:00:00Z",
                  "employmentType":["FULL_TIME"],
                  "hiringOrganization":{"@type":"Organization","name":"Initech","sameAs":"https://initech.example"},
                  "jobLocation":{"@type":"Place","address":{"addressLocality":"London","addressCountry":"GB"}},
                  "description":"<p>Build things in Rust.</p><p>Pay: £95,000 – £120,000 a year, hybrid.</p>"}</script>
                </head></html>"#,
            )
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, site).await.unwrap() });
    url
}

#[tokio::test(flavor = "multi_thread")]
async fn a_job_posting_can_be_imported_from_its_link() {
    let app = app();
    let site = careers_site().await;
    let url = format!("{site}/jobs/rust");
    let p = ok(
        &app,
        "POST",
        "/api/applications/lookup",
        Some(json!({ "url": url })),
    )
    .await;
    assert_eq!(p["title"], "Senior Rust Engineer");
    assert_eq!(p["company"], "Initech");
    assert_eq!(p["company_website"], "https://initech.example");
    assert_eq!(p["location"], "London, GB");
    assert_eq!(p["employment"], "full-time");
    assert_eq!(p["posted_on"], "2026-09-30");
    assert_eq!(p["closes_on"], "2026-11-01");
    assert_eq!(p["url"], url.as_str());
    // Pay and work mode, from the text, as the data didn't say.
    assert_eq!(
        (p["salary_min"].clone(), p["salary_max"].clone()),
        (json!(95000), json!(120000))
    );
    assert_eq!(
        (p["currency"].clone(), p["pay_period"].clone()),
        (json!("GBP"), json!("year"))
    );
    assert_eq!(
        p["description"],
        "Build things in Rust.\n\nPay: £95,000 – £120,000 a year, hybrid."
    );
    assert!(
        ok(&app, "GET", "/api/applications", None)
            .await
            .as_array()
            .unwrap()
            .is_empty(),
        "nothing saved"
    );

    // What was read becomes a process, its company made with its website.
    let mut body = p.clone();
    body.as_object_mut().unwrap().remove("platform");
    let card = ok(&app, "POST", "/api/processes", Some(body)).await;
    assert_eq!(card["title"], "Senior Rust Engineer");
    let company = ok(
        &app,
        "GET",
        &format!("/api/companies/{}", card["company_id"]),
        None,
    )
    .await;
    assert_eq!(company["website"], "https://initech.example");
    let a = ok(
        &app,
        "GET",
        &format!("/api/applications/{}", card["application_id"]),
        None,
    )
    .await;
    assert_eq!(a["salary_max"], 120000);

    // An application alone takes its company by name too, and an existing
    // company's website isn't overwritten.
    let a = ok(
        &app,
        "POST",
        "/api/applications",
        Some(json!({ "company": "initech", "title": "SRE", "company_website": "https://other.example" })),
    )
    .await;
    assert_eq!(a["company_id"], card["company_id"]);
    let company = ok(
        &app,
        "GET",
        &format!("/api/companies/{}", card["company_id"]),
        None,
    )
    .await;
    assert_eq!(company["website"], "https://initech.example");

    let (status, v) = call(
        &app,
        "POST",
        "/api/applications/lookup",
        Some(json!({ "url": format!("{site}/nope") })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_GATEWAY, "{v}");
}

#[tokio::test]
async fn the_same_posting_link_is_recognised() {
    let app = app();
    let card = ok(
        &app,
        "POST",
        "/api/processes",
        Some(
            json!({ "company": "Grid Dynamics", "title": "Rust Engineer",
                     "url": "https://www.linkedin.com/jobs/view/4448884772/?trk=public_jobs" }),
        ),
    )
    .await;
    let same = |url: &str| {
        format!(
            "/api/applications/same-posting?url={}",
            url.replace('&', "%26")
                .replace('?', "%3F")
                .replace('=', "%3D")
        )
    };
    for copy in [
        "https://www.linkedin.com/jobs/view/4448884772",
        "https://uk.linkedin.com/jobs/view/rust-engineer-at-grid-dynamics-4448884772",
        "https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4448884772",
    ] {
        let found = ok(&app, "GET", &same(copy), None).await;
        assert_eq!(found.as_array().unwrap().len(), 1, "{copy}");
        assert_eq!(found[0]["label"], "Grid Dynamics — Rust Engineer");
        assert_eq!(found[0]["processes"][0]["id"], card["id"]);
        assert_eq!(found[0]["processes"][0]["stage"], "Considering");
    }
    let other = ok(
        &app,
        "GET",
        &same("https://www.linkedin.com/jobs/view/1234567890"),
        None,
    )
    .await;
    assert!(other.as_array().unwrap().is_empty());
    // A warning, not a refusal: the same link can be added again.
    ok(
        &app,
        "POST",
        "/api/applications",
        Some(json!({ "company": "Grid Dynamics", "title": "Rust Engineer (again)", "url": "https://www.linkedin.com/jobs/view/4448884772" })),
    )
    .await;
    let found = ok(
        &app,
        "GET",
        &same("https://www.linkedin.com/jobs/view/4448884772"),
        None,
    )
    .await;
    assert_eq!(found.as_array().unwrap().len(), 2);
}

fn app_with_rates(rates: &[(&str, f64)]) -> Router {
    let db = test_db();
    for (currency, rate) in rates {
        db.store_rate(currency, *rate, "2026-10-06").unwrap();
    }
    hunt::api::router(db)
}

#[tokio::test]
async fn pay_is_kept_in_gbp_too() {
    // Rates cached for today, so nothing is fetched.
    let app = app_with_rates(&[("EUR", 0.85), ("USD", 0.75)]);
    let a = ok(
        &app,
        "POST",
        "/api/applications",
        Some(json!({ "company": "Acme", "salary_min": "110k", "salary_max": "185k", "currency": "€", "pay_period": "year" })),
    )
    .await;
    assert_eq!(a["currency"], "EUR", "a symbol becomes a code");
    assert_eq!(
        (a["salary_min_gbp"].clone(), a["salary_max_gbp"].clone()),
        (json!(93500), json!(157250))
    );
    assert_eq!(a["gbp_rate"], 0.85);
    assert_eq!(a["gbp_rate_on"], "2026-10-06");

    // Changing the pay converts again; the original stays as given.
    let id = a["id"].clone();
    let a = ok(
        &app,
        "PATCH",
        &format!("/api/applications/{id}"),
        Some(json!({ "currency": "usd" })),
    )
    .await;
    assert_eq!(
        (a["salary_min"].clone(), a["salary_min_gbp"].clone()),
        (json!(110000), json!(82500))
    );

    // GBP is itself; no pay, no figures.
    let a = ok(
        &app,
        "PATCH",
        &format!("/api/applications/{id}"),
        Some(json!({ "currency": "GBP" })),
    )
    .await;
    assert_eq!(
        (a["salary_max_gbp"].clone(), a["gbp_rate"].clone()),
        (json!(185000), json!(1.0))
    );
    let a = ok(
        &app,
        "PATCH",
        &format!("/api/applications/{id}"),
        Some(json!({ "salary_min": null, "salary_max": null })),
    )
    .await;
    assert_eq!(
        (a["salary_min_gbp"].clone(), a["gbp_rate"].clone()),
        (Value::Null, Value::Null)
    );

    // The figures are derived: sending them back is ignored, not an error.
    let a = ok(
        &app,
        "PATCH",
        &format!("/api/applications/{id}"),
        Some(json!({ "salary_max_gbp": 1, "title": "SRE" })),
    )
    .await;
    assert_eq!(a["salary_max_gbp"], Value::Null);

    let (status, v) = call(
        &app,
        "PATCH",
        &format!("/api/applications/{id}"),
        Some(json!({ "currency": "dollars" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
}

#[tokio::test]
async fn companies_have_logos() {
    let app = app();
    let c = ok(
        &app,
        "POST",
        "/api/companies",
        Some(json!({ "name": "Acme" })),
    )
    .await;
    let id = c["id"].clone();
    let send = |body: &'static [u8], kind: &'static str| {
        Request::put(format!("/api/companies/{id}/logo"))
            .header("content-type", kind)
            .body(Body::from(body))
            .unwrap()
    };
    // A PNG, by its bytes; a claimed image that isn't one is refused.
    let png: &[u8] = b"\x89PNG\r\n\x1a\nrest-of-the-image";
    let res = app
        .clone()
        .oneshot(send(png, "application/octet-stream"))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let res = app
        .clone()
        .oneshot(send(b"just text", "image/png"))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let c = ok(&app, "GET", &format!("/api/companies/{id}"), None).await;
    assert_eq!(c["logo_type"], "image/png");
    let res = app
        .clone()
        .oneshot(
            Request::get(format!("/api/companies/{id}/logo"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.headers()["content-type"], "image/png");
    assert_eq!(
        &res.into_body().collect().await.unwrap().to_bytes()[..],
        png
    );

    // An SVG logo is served sandboxed: it can't run script.
    let res = app
        .clone()
        .oneshot(send(
            b"<svg xmlns='http://www.w3.org/2000/svg'/>",
            "image/svg+xml",
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let res = app
        .clone()
        .oneshot(
            Request::get(format!("/api/companies/{id}/logo"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.headers()["content-security-policy"], "sandbox");

    let log = ok(
        &app,
        "GET",
        &format!("/api/activity?entity=company&entity_id={id}"),
        None,
    )
    .await;
    assert_eq!(log[0]["summary"], "Changed the logo of company Acme");
    ok(&app, "DELETE", &format!("/api/companies/{id}/logo"), None).await;
    let (status, _) = call(&app, "GET", &format!("/api/companies/{id}/logo"), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn the_calendar_gathers_what_is_dated() {
    let app = app();
    let a = ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Acme", "title": "SRE", "applied_on": "2026-10-01", "closes_on": "2026-10-20" })),
    )
    .await;
    ok(
        &app,
        "POST",
        "/api/reminders",
        Some(
            json!({ "process_id": a["id"], "title": "send availability", "due_at": "2026-10-07" }),
        ),
    )
    .await;
    ok(&app, "POST", "/api/steps", Some(json!({ "process_id": a["id"], "title": "System design; part 1", "at": "2026-10-09T15:00" }))).await;
    let b = ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Globex" })),
    )
    .await;
    ok(
        &app,
        "POST",
        "/api/reminders",
        Some(json!({ "process_id": b["id"], "title": "chase", "due_at": "2026-10-08T00:00" })),
    )
    .await;
    ok(
        &app,
        "PATCH",
        &format!("/api/processes/{}", b["id"]),
        Some(json!({ "status": "archived", "archive_reason": "role-closed" })),
    )
    .await;

    let kinds = |v: &Value| -> Vec<(String, String)> {
        v.as_array()
            .unwrap()
            .iter()
            .map(|e| {
                (
                    e["kind"].as_str().unwrap().into(),
                    e["at"].as_str().unwrap().into(),
                )
            })
            .collect()
    };
    // By default: steps, next actions and deadlines of active processes, in
    // time order. Acme's deadline has gone: it's applied for.
    let all = ok(&app, "GET", "/api/calendar", None).await;
    assert_eq!(
        kinds(&all),
        [
            ("next".into(), "2026-10-07T00:00".into()),
            ("step".into(), "2026-10-09T15:00".into())
        ]
    );
    assert_eq!(all[1]["company"], "Acme");
    assert_eq!(all[1]["stage"], "Considering");
    // A window, kinds, archived ones, and words.
    let some = ok(
        &app,
        "GET",
        "/api/calendar?from=2026-10-08&to=2026-10-10&kinds=step,next,applied&status=all",
        None,
    )
    .await;
    assert_eq!(
        kinds(&some),
        [
            ("next".into(), "2026-10-08T00:00".into()),
            ("step".into(), "2026-10-09T15:00".into())
        ]
    );
    let found = ok(&app, "GET", "/api/calendar?q=design&kinds=step,next", None).await;
    assert_eq!(found.as_array().unwrap().len(), 1);
    let (status, _) = call(&app, "GET", "/api/calendar?kinds=birthdays", None).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // And as iCalendar, for calendar apps.
    let res = app
        .clone()
        .oneshot(
            Request::get("/api/calendar.ics")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        res.headers()["content-type"],
        "text/calendar; charset=utf-8"
    );
    let ics =
        String::from_utf8(res.into_body().collect().await.unwrap().to_bytes().to_vec()).unwrap();
    assert!(ics.starts_with("BEGIN:VCALENDAR\r\n"), "{ics}");
    assert!(
        ics.contains("DTSTART:20261009T150000\r\nDURATION:PT1H\r\n"),
        "{ics}"
    );
    assert!(
        ics.contains("SUMMARY:Interview: System design\\; part 1 — Acme\\, SRE\r\n"),
        "{ics}"
    );
    assert!(ics.lines().all(|l| l.len() <= 75), "lines are folded");

    // With a time zone chosen, times say which zone they're in.
    ok(
        &app,
        "PATCH",
        "/api/settings",
        Some(json!({"timezone": "Europe/Berlin"})),
    )
    .await;
    let res = app
        .clone()
        .oneshot(
            Request::get("/api/calendar.ics")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let ics =
        String::from_utf8(res.into_body().collect().await.unwrap().to_bytes().to_vec()).unwrap();
    assert!(ics.contains("X-WR-TIMEZONE:Europe/Berlin\r\n"), "{ics}");
    assert!(
        ics.contains("DTSTART;TZID=Europe/Berlin:20261009T150000\r\n"),
        "{ics}"
    );
}

#[tokio::test]
async fn the_calendar_filters_what_matters() {
    let app = app();
    let names = |v: &Value| -> Vec<String> {
        v.as_array()
            .unwrap()
            .iter()
            .map(|e| {
                format!(
                    "{} {}",
                    e["company"].as_str().unwrap(),
                    e["kind"].as_str().unwrap()
                )
            })
            .collect()
    };
    // A deadline shows until it's applied for: on a day, or by moving on a stage.
    let acme = ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Acme", "title": "SRE", "closes_on": "2026-10-20" })),
    )
    .await;
    let globex = ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Globex", "closes_on": "2026-10-21" })),
    )
    .await;
    let deadlines = ok(&app, "GET", "/api/calendar?kinds=closes", None).await;
    assert_eq!(names(&deadlines), ["Acme closes", "Globex closes"]);
    let board = ok(&app, "GET", "/api/board", None).await;
    let applied = board["stages"][1]["id"].clone();
    ok(
        &app,
        "PATCH",
        &format!("/api/processes/{}", globex["id"]),
        Some(json!({ "stage_id": applied })),
    )
    .await;
    let deadlines = ok(&app, "GET", "/api/calendar?kinds=closes", None).await;
    assert_eq!(names(&deadlines), ["Acme closes"]);

    // Cancelled interviews only when asked for; search reads the step's
    // title, not its outcome.
    ok(&app, "POST", "/api/steps", Some(json!({ "process_id": acme["id"], "title": "Phone screen", "at": "2026-10-09T10:00", "status": "cancelled" }))).await;
    ok(
        &app,
        "POST",
        "/api/steps",
        Some(
            json!({ "process_id": acme["id"], "title": "Phone screen", "at": "2026-10-10T10:00" }),
        ),
    )
    .await;
    let steps = ok(&app, "GET", "/api/calendar?kinds=step", None).await;
    assert_eq!(steps.as_array().unwrap().len(), 1);
    assert_eq!(steps[0]["detail"], "scheduled");
    let steps = ok(&app, "GET", "/api/calendar?kinds=step&cancelled=true", None).await;
    assert_eq!(steps.as_array().unwrap().len(), 2);
    let found = ok(
        &app,
        "GET",
        "/api/calendar?kinds=step&cancelled=true&q=cancelled",
        None,
    )
    .await;
    assert!(found.as_array().unwrap().is_empty());

    // One company's, or one tag's.
    let one = ok(
        &app,
        "GET",
        &format!(
            "/api/calendar?kinds=step,closes&company={}",
            globex["company_id"]
        ),
        None,
    )
    .await;
    assert!(one.as_array().unwrap().is_empty());
    let one = ok(
        &app,
        "GET",
        &format!(
            "/api/calendar?kinds=step,closes&company={}",
            acme["company_id"]
        ),
        None,
    )
    .await;
    assert_eq!(names(&one), ["Acme step", "Acme closes"]);
    ok(
        &app,
        "PUT",
        &format!("/api/applications/{}/tags", acme["application_id"]),
        Some(json!({ "tags": ["Dream job"] })),
    )
    .await;
    let tagged = ok(
        &app,
        "GET",
        "/api/calendar?kinds=step,closes&tag=dream%20job",
        None,
    )
    .await;
    assert_eq!(names(&tagged), ["Acme step", "Acme closes"]);

    // Closed: closed processes, and those left when their cycle ended. Every
    // event is either active or closed.
    let cycle = ok(&app, "GET", "/api/cycles", None).await[0]["id"].clone();
    ok(
        &app,
        "POST",
        &format!("/api/cycles/{cycle}/end"),
        Some(json!({ "outcome": "break" })),
    )
    .await;
    let active = ok(&app, "GET", "/api/calendar?kinds=step,closes", None).await;
    assert!(active.as_array().unwrap().is_empty());
    let closed = ok(
        &app,
        "GET",
        "/api/calendar?kinds=step,closes&status=closed",
        None,
    )
    .await;
    assert_eq!(names(&closed), ["Acme step", "Acme closes"]);
    let archived = ok(
        &app,
        "GET",
        "/api/calendar?kinds=step,closes&status=archived",
        None,
    )
    .await;
    assert_eq!(archived, closed, "archived still says closed");
}

#[tokio::test]
async fn the_calendar_has_working_hours_and_other_time_zones() {
    let app = app();
    let s = ok(&app, "GET", "/api/settings", None).await;
    assert!(s["work_hours"].is_null());
    assert_eq!(s["calendar_zones"], json!([]));
    // Working hours: the days in the week's order, once each.
    let s = ok(
        &app,
        "PATCH",
        "/api/settings",
        Some(json!({
            "work_hours": { "start": "09:00", "end": "17:30", "days": ["friday", "monday", "monday"] },
            "calendar_zones": ["Asia/Tokyo", "America/New_York", "Asia/Tokyo"],
        })),
    )
    .await;
    assert_eq!(
        s["work_hours"],
        json!({ "start": "09:00", "end": "17:30", "days": ["monday", "friday"] })
    );
    assert_eq!(
        s["calendar_zones"],
        json!(["Asia/Tokyo", "America/New_York"])
    );
    for bad in [
        json!({ "work_hours": { "start": "18:00", "end": "09:00", "days": ["monday"] } }),
        json!({ "work_hours": { "start": "9am", "end": "17:00", "days": ["monday"] } }),
        json!({ "work_hours": { "start": "09:00", "end": "17:00", "days": [] } }),
        json!({ "work_hours": { "start": "09:00", "end": "17:00", "days": ["someday"] } }),
        json!({ "calendar_zones": ["Mars/Olympus"] }),
        json!({ "calendar_zones": ["Asia/Tokyo", "Europe/Paris", "America/Denver", "Australia/Sydney"] }),
    ] {
        let (status, _) = call(&app, "PATCH", "/api/settings", Some(bad.clone())).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{bad}");
    }
    // Off again.
    let s = ok(
        &app,
        "PATCH",
        "/api/settings",
        Some(json!({ "work_hours": null, "calendar_zones": [] })),
    )
    .await;
    assert!(s["work_hours"].is_null());
    assert_eq!(s["calendar_zones"], json!([]));
}

#[tokio::test]
async fn people_have_photos_and_profiles() {
    let app = app();
    let p = ok(&app, "POST", "/api/people", Some(json!({ "name": "Pat Chen", "linkedin": "https://www.linkedin.com/in/patchen", "location": "London" }))).await;
    let id = p["id"].clone();
    // Found by their profile.
    let found = ok(
        &app,
        "GET",
        "/api/people?linkedin=https://www.linkedin.com/in/patchen",
        None,
    )
    .await;
    assert_eq!(found[0]["id"], id);
    let jpeg: &[u8] = &[0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3];
    let req = Request::put(format!("/api/people/{id}/photo"))
        .header("content-type", "image/jpeg")
        .body(Body::from(jpeg))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(req).await.unwrap().status(),
        StatusCode::OK
    );
    let p = ok(&app, "GET", &format!("/api/people/{id}"), None).await;
    assert_eq!(p["photo_type"], "image/jpeg");
    let log = ok(
        &app,
        "GET",
        &format!("/api/activity?entity=person&entity_id={id}"),
        None,
    )
    .await;
    assert_eq!(log[0]["summary"], "Added the photo of person Pat Chen");
    ok(&app, "DELETE", &format!("/api/people/{id}/photo"), None).await;
    let (status, _) = call(&app, "GET", &format!("/api/people/{id}/photo"), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, v) = call(
        &app,
        "POST",
        "/api/people/lookup",
        Some(json!({ "url": "https://www.linkedin.com/company/acme" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
}

#[tokio::test]
async fn records_carry_tags() {
    let app = app();
    let a = ok(
        &app,
        "POST",
        "/api/applications",
        Some(json!({ "company": "Acme", "title": "SRE" })),
    )
    .await;
    let c = ok(
        &app,
        "GET",
        &format!("/api/companies/{}", a["company_id"]),
        None,
    )
    .await;
    let tags = ok(
        &app,
        "PUT",
        &format!("/api/applications/{}/tags", a["id"]),
        Some(json!({ "tags": ["Dream job", " remote ", "dream JOB"] })),
    )
    .await;
    assert_eq!(
        tags,
        json!(["Dream job", "remote"]),
        "trimmed, and once each"
    );
    ok(
        &app,
        "PUT",
        &format!("/api/companies/{}/tags", c["id"]),
        Some(json!({ "tags": ["remote"] })),
    )
    .await;
    // Records show their tags; lists filter by them.
    let got = ok(&app, "GET", &format!("/api/applications/{}", a["id"]), None).await;
    assert_eq!(got["tags"], json!(["Dream job", "remote"]));
    assert_eq!(
        ok(&app, "GET", "/api/applications?tag=dream%20job", None)
            .await
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        ok(&app, "GET", "/api/applications?tag=other", None)
            .await
            .as_array()
            .unwrap()
            .len(),
        0
    );
    assert_eq!(
        ok(&app, "GET", "/api/tags", None)
            .await
            .as_array()
            .unwrap()
            .len(),
        2,
        "shared between kinds"
    );
    // The board's cards carry their application's tags.
    ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "application_id": a["id"] })),
    )
    .await;
    let board = ok(&app, "GET", "/api/board", None).await;
    assert_eq!(board["stages"][0]["cards"][0]["tags"], "Dream job|remote");
    // Changes are logged; sending tags back with a record is ignored.
    let tags = ok(
        &app,
        "PUT",
        &format!("/api/applications/{}/tags", a["id"]),
        Some(json!({ "tags": ["remote", "fintech"] })),
    )
    .await;
    assert_eq!(tags, json!(["fintech", "remote"]));
    let log = ok(
        &app,
        "GET",
        &format!("/api/activity?entity=application&entity_id={}", a["id"]),
        None,
    )
    .await;
    assert_eq!(
        log[0]["summary"],
        "Tagged application Acme — SRE: +fintech −Dream job"
    );
    ok(
        &app,
        "PATCH",
        &format!("/api/applications/{}", a["id"]),
        Some(got),
    )
    .await;
    // Renaming a tag renames it everywhere; deleting it takes it off.
    let fintech = ok(&app, "GET", "/api/tags?q=fintech", None).await[0]["id"].clone();
    ok(
        &app,
        "PATCH",
        &format!("/api/tags/{fintech}"),
        Some(json!({ "name": "Fintech", "color": "green" })),
    )
    .await;
    assert_eq!(
        ok(&app, "GET", &format!("/api/applications/{}", a["id"]), None).await["tags"],
        json!(["Fintech", "remote"])
    );
    ok(&app, "DELETE", &format!("/api/tags/{fintech}"), None).await;
    assert_eq!(
        ok(&app, "GET", &format!("/api/applications/{}", a["id"]), None).await["tags"],
        json!(["remote"])
    );
    let (status, _) = call(
        &app,
        "PUT",
        "/api/stages/1/tags",
        Some(json!({ "tags": ["x"] })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "stages can't be tagged"
    );
}

#[tokio::test]
async fn closing_is_a_move_to_an_inactive_stage() {
    let app = app();
    let meta = ok(&app, "GET", "/api/meta", None).await;
    // The reasons for closing are the inactive stages' lanes.
    assert_eq!(
        (
            meta["archive_reasons"][0]["value"].clone(),
            meta["archive_reasons"][0]["stage"].clone()
        ),
        (json!("withdrew"), json!("My Decision"))
    );
    let closed = meta["archive_reasons"][0]["stage_id"].clone();
    let board = ok(&app, "GET", "/api/board", None).await;
    let closed_names: Vec<&str> = board["closed_stages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        closed_names,
        ["My Decision", "Their Decision", "Paused / Stopped"]
    );
    assert!(
        board["stages"]
            .as_array()
            .unwrap()
            .iter()
            .all(|s| s["active"] != 0),
        "not a column"
    );
    // A lane added to it is a reason too, with a code from its id.
    let lane = ok(
        &app,
        "POST",
        "/api/lanes",
        Some(json!({ "stage_id": closed, "name": "Salary too low" })),
    )
    .await;
    let code = format!("lane-{}", lane["id"]);
    let card = ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Acme" })),
    )
    .await;
    let id = card["id"].clone();
    let applied = stage_id(&board, "Applied");
    ok(
        &app,
        "POST",
        &format!("/api/processes/{id}/move"),
        Some(json!({ "stage_id": applied })),
    )
    .await;
    // By its name, as by its code.
    ok(
        &app,
        "PATCH",
        &format!("/api/processes/{id}"),
        Some(json!({ "status": "archived", "archive_reason": "Salary too low" })),
    )
    .await;
    let p = ok(&app, "GET", &format!("/api/processes/{id}"), None).await;
    assert_eq!(
        (
            p["status"].clone(),
            p["archive_reason"].clone(),
            p["stage_id"].clone(),
            p["lane_id"].clone(),
            p["reached_stage_id"].clone()
        ),
        (
            json!("archived"),
            json!(code),
            closed.clone(),
            lane["id"].clone(),
            json!(applied)
        )
    );
    // Renamed, the code stays; the code itself can't change.
    ok(
        &app,
        "PATCH",
        &format!("/api/lanes/{}", lane["id"]),
        Some(json!({ "name": "Pay too low" })),
    )
    .await;
    let board = ok(&app, "GET", "/api/board", None).await;
    assert_eq!(board["archived"][0]["archive_label"], "Pay too low");
    let (status, _) = call(
        &app,
        "PATCH",
        &format!("/api/lanes/{}", lane["id"]),
        Some(json!({ "value": "x" })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "the code is fixed"
    );
    let (status, v) = call(
        &app,
        "PATCH",
        &format!("/api/processes/{id}"),
        Some(json!({ "archive_reason": "bored" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    // Another reason: to its lane.
    ok(
        &app,
        "PATCH",
        &format!("/api/processes/{id}"),
        Some(json!({ "archive_reason": "withdrew" })),
    )
    .await;
    let p = ok(&app, "GET", &format!("/api/processes/{id}"), None).await;
    assert_eq!(
        (p["archive_reason"].clone(), p["reached_stage_id"].clone()),
        (json!("withdrew"), json!(applied))
    );
    // A lane gone: what was closed for it stays closed, for no reason given.
    ok(
        &app,
        "PATCH",
        &format!("/api/processes/{id}"),
        Some(json!({ "archive_reason": code })),
    )
    .await;
    ok(&app, "DELETE", &format!("/api/lanes/{}", lane["id"]), None).await;
    let p = ok(&app, "GET", &format!("/api/processes/{id}"), None).await;
    assert_eq!(
        (
            p["status"].clone(),
            p["archive_reason"].clone(),
            p["stage_id"].clone()
        ),
        (json!("archived"), Value::Null, closed.clone())
    );

    // Reopened: back to the stage it reached.
    ok(
        &app,
        "PATCH",
        &format!("/api/processes/{id}"),
        Some(json!({ "status": "active" })),
    )
    .await;
    let p = ok(&app, "GET", &format!("/api/processes/{id}"), None).await;
    assert_eq!(
        (
            p["status"].clone(),
            p["stage_id"].clone(),
            p["archive_reason"].clone()
        ),
        (json!("active"), json!(applied), Value::Null)
    );
    // Dragged into an inactive stage's lane, it closes for that reason;
    // onto a column, it opens.
    let withdrew = meta["archive_reasons"][0]["id"].clone();
    ok(
        &app,
        "POST",
        &format!("/api/processes/{id}/move"),
        Some(json!({ "stage_id": closed, "lane_id": withdrew })),
    )
    .await;
    let p = ok(&app, "GET", &format!("/api/processes/{id}"), None).await;
    assert_eq!(
        (p["status"].clone(), p["archive_reason"].clone()),
        (json!("archived"), json!("withdrew"))
    );
    let log = ok(&app, "GET", "/api/activity?entity=process", None).await;
    assert_eq!(log[0]["summary"], "Closed Acme: I withdrew (My Decision)");

    // Any stage can be inactive: its processes close with it, and open again.
    let screening = stage_id(&board, "Screening");
    let other = ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Globex", "stage_id": screening })),
    )
    .await;
    ok(
        &app,
        "PATCH",
        &format!("/api/stages/{screening}"),
        Some(json!({ "active": 0 })),
    )
    .await;
    let p = ok(
        &app,
        "GET",
        &format!("/api/processes/{}", other["id"]),
        None,
    )
    .await;
    assert_eq!(p["status"], "archived");
    let board = ok(&app, "GET", "/api/board", None).await;
    let inactive: Vec<&str> = board["closed_stages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        inactive,
        [
            "Screening",
            "My Decision",
            "Their Decision",
            "Paused / Stopped"
        ]
    );
    ok(
        &app,
        "PATCH",
        &format!("/api/stages/{screening}"),
        Some(json!({ "active": 1 })),
    )
    .await;
    let p = ok(
        &app,
        "GET",
        &format!("/api/processes/{}", other["id"]),
        None,
    )
    .await;
    assert_eq!(p["status"], "active");
    // The board keeps one active stage.
    let stages = ok(&app, "GET", "/api/stages", None).await;
    let active: Vec<i64> = stages
        .as_array()
        .unwrap()
        .iter()
        .filter(|s| s["active"] == 1)
        .map(|s| s["id"].as_i64().unwrap())
        .collect();
    for (i, s) in active.iter().enumerate() {
        let (status, v) = call(
            &app,
            "PATCH",
            &format!("/api/stages/{s}"),
            Some(json!({ "active": 0 })),
        )
        .await;
        let last = i == active.len() - 1;
        assert_eq!(
            status,
            if last {
                StatusCode::UNPROCESSABLE_ENTITY
            } else {
                StatusCode::OK
            },
            "{v}"
        );
    }
}

fn mail(
    id: &str,
    thread: &str,
    from: &str,
    name: &str,
    subject: &str,
    labels: &[&str],
) -> hunt::mail::Message {
    hunt::mail::Message {
        gm_msgid: Some(id.into()),
        gm_thrid: Some(thread.into()),
        labels: labels.iter().map(|l| l.to_string()).collect(),
        message_id: Some(format!("{id}@mail")),
        from_addr: from.into(),
        from_name: name.into(),
        to: vec!["me@gmail.com".into()],
        subject: subject.into(),
        sent_at: format!("2026-10-0{}T09:00:00", id.len().min(9)),
        body: format!("About: {subject}\n\nOn Mon, someone wrote:\n> old"),
        ..Default::default()
    }
}

#[tokio::test]
async fn gmail_is_matched_to_processes() {
    let fake = hunt::mail::Fake::new("apppass");
    let mut db = test_db();
    db.mailbox = fake.connector();
    let app = hunt::api::router(db);

    let (status, _) = call(&app, "POST", "/api/mail/sync", None).await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "not connected yet"
    );
    let (status, _) = call(
        &app,
        "PUT",
        "/api/mail",
        Some(json!({ "address": "Me@gmail.com", "password": "wrong" })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "Gmail is asked first"
    );
    let st = ok(
        &app,
        "PUT",
        "/api/mail",
        Some(json!({ "address": "Me@gmail.com", "password": "app pass" })),
    )
    .await;
    assert_eq!(
        (st["connected"].clone(), st["address"].clone()),
        (json!(true), json!("me@gmail.com"))
    );
    assert!(st.get("password").is_none(), "never sent back");

    let staff = ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Acme", "title": "Staff Engineer" })),
    )
    .await;
    let platform = ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Acme", "title": "Platform Engineer" })),
    )
    .await;
    let sre = ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Globex", "title": "SRE" })),
    )
    .await;
    let (staff, platform, sre) = (
        staff["id"].as_i64().unwrap(),
        platform["id"].as_i64().unwrap(),
        sre["id"].as_i64().unwrap(),
    );
    let acme = ok(&app, "GET", "/api/companies?q=Acme", None).await[0]["id"].clone();
    ok(
        &app,
        "PATCH",
        &format!("/api/companies/{acme}"),
        Some(json!({ "website": "https://www.acme.com" })),
    )
    .await;
    let globex = ok(&app, "GET", "/api/companies?q=Globex", None).await[0]["id"].clone();
    ok(
        &app,
        "PATCH",
        &format!("/api/companies/{globex}"),
        Some(json!({ "email_domains": "globex.io" })),
    )
    .await;
    ok(
        &app,
        "POST",
        &format!("/api/processes/{staff}/people"),
        Some(json!({ "name": "Sam Lee", "role": "Recruiter" })),
    )
    .await;
    let sam = ok(&app, "GET", "/api/people?q=Sam", None).await[0]["id"].clone();
    ok(
        &app,
        "PATCH",
        &format!("/api/people/{sam}"),
        Some(json!({ "email": "sam.lee@gmail.com" })),
    )
    .await;

    let m = ok(&app, "GET", &format!("/api/processes/{staff}/mail"), None).await;
    assert_eq!(m["domains"], json!(["acme.com"]));
    assert!(
        m["auto_query"]
            .as_str()
            .unwrap()
            .starts_with("from:(sam.lee@gmail.com OR acme.com)")
    );

    fake.state.lock().unwrap().messages = vec![
        mail("1", "t1", "jo@globex.io", "Jo", "Next steps", &[]),
        mail(
            "22",
            "t2",
            "sam.lee@gmail.com",
            "Sam Lee",
            "Quick chat?",
            &[],
        ),
        mail(
            "333",
            "t3",
            "jobs@acme.com",
            "Acme Jobs",
            "Your application: Platform Engineer",
            &[],
        ),
        mail(
            "4444",
            "t4",
            "no-reply@us.greenhouse-mail.io",
            "Acme",
            "Thank you for applying",
            &[],
        ),
        mail(
            "55555",
            "t1",
            "pat@contractor.dev",
            "Pat",
            "Re: Next steps",
            &[],
        ),
        mail(
            "666666",
            "t6",
            "news@techcrunch.com",
            "TechCrunch",
            "Acme raises a Series C",
            &[],
        ),
        mail(
            "7777777",
            "t7",
            "friend@else.org",
            "Friend",
            "Fwd: a role",
            &["hunt/Globex/SRE"],
        ),
        mail("88888888", "t8", "spam@else.org", "Spam", "Unrelated", &[]),
    ];
    let report = ok(&app, "POST", "/api/mail/sync", None).await;
    assert_eq!(
        report,
        json!({ "fetched": 7, "linked": 5, "triage": 2, "labels_made": 3 }),
        "the unrelated one isn't fetched"
    );
    let labels = fake.state.lock().unwrap().labels.clone();
    assert_eq!(
        labels,
        [
            "hunt/Acme/Staff Engineer",
            "hunt/Acme/Platform Engineer",
            "hunt/Globex/SRE"
        ]
    );

    let subjects = |v: &Value| {
        v.as_array()
            .unwrap()
            .iter()
            .map(|e| e["subject"].as_str().unwrap().to_string())
            .collect::<Vec<_>>()
    };
    let by = |v: &Value| {
        v.as_array()
            .unwrap()
            .iter()
            .map(|e| e["matched_by"].as_str().unwrap().to_string())
            .collect::<Vec<_>>()
    };
    let sre_mail = ok(&app, "GET", &format!("/api/processes/{sre}/emails"), None).await;
    assert_eq!(
        subjects(&sre_mail),
        ["Fwd: a role", "Re: Next steps", "Next steps"]
    );
    assert_eq!(by(&sre_mail), ["label", "thread", "company"]);
    assert_eq!(
        sre_mail[2]["snippet"], "About: Next steps",
        "quoted text left out"
    );
    assert!(
        sre_mail[0]["gmail_url"]
            .as_str()
            .unwrap()
            .contains("rfc822msgid%3A7777777%40mail")
    );
    assert_eq!(
        subjects(&ok(&app, "GET", &format!("/api/processes/{staff}/emails"), None).await),
        ["Quick chat?"]
    );
    assert_eq!(
        subjects(
            &ok(
                &app,
                "GET",
                &format!("/api/processes/{platform}/emails"),
                None
            )
            .await
        ),
        ["Your application: Platform Engineer"]
    );
    let board = ok(&app, "GET", "/api/board", None).await;
    let card = board["stages"][0]["cards"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == sre)
        .unwrap()
        .clone();
    assert_eq!(card["emails"], 3);
    let log = ok(&app, "GET", &format!("/api/processes/{sre}/detail"), None).await;
    assert_eq!(
        log["activity"][0]["summary"],
        "Linked 3 emails from Gmail to process Globex — SRE"
    );
    assert_eq!(log["emails"].as_array().unwrap().len(), 3);

    // Triage: the hiring tool's mail fits both Acme roles; the news only names Acme.
    let triage = ok(&app, "GET", "/api/emails?status=triage", None).await;
    assert_eq!(
        subjects(&triage),
        ["Acme raises a Series C", "Thank you for applying"]
    );
    assert_eq!(triage[1]["suggested"].as_array().unwrap().len(), 2);
    assert_eq!(ok(&app, "GET", "/api/mail", None).await["triage"], 2);
    let tool = triage[1]["id"].clone();
    ok(
        &app,
        "POST",
        &format!("/api/emails/{tool}/link"),
        Some(json!({ "process_id": platform })),
    )
    .await;
    let ignored = ok(
        &app,
        "POST",
        &format!("/api/emails/{}/ignore", triage[0]["id"]),
        Some(json!({ "rule": "domain" })),
    )
    .await;
    assert_eq!(ignored["ignored"], 1);
    assert_eq!(
        ok(&app, "GET", "/api/mail/ignores", None).await[0]["value"],
        "techcrunch.com"
    );
    assert_eq!(ok(&app, "GET", "/api/mail", None).await["triage"], 0);

    // Next sync: nothing new is fetched; a reply to the linked thread follows it.
    fake.state.lock().unwrap().messages.push(mail(
        "999999999",
        "t4",
        "no-reply@us.greenhouse-mail.io",
        "Acme",
        "Interview invitation",
        &[],
    ));
    fake.state.lock().unwrap().messages.push(mail(
        "1010101010",
        "t10",
        "news@techcrunch.com",
        "TechCrunch",
        "Acme again",
        &[],
    ));
    let report = ok(&app, "POST", "/api/mail/sync", None).await;
    assert_eq!(
        report,
        json!({ "fetched": 2, "linked": 1, "triage": 0, "labels_made": 0 })
    );
    assert_eq!(
        subjects(
            &ok(
                &app,
                "GET",
                &format!("/api/processes/{platform}/emails"),
                None
            )
            .await
        )[0],
        "Interview invitation"
    );

    // Renaming the role renames its label; unlinking sends mail back to triage.
    let app_id =
        ok(&app, "GET", &format!("/api/processes/{sre}"), None).await["application_id"].clone();
    ok(
        &app,
        "PATCH",
        &format!("/api/applications/{app_id}"),
        Some(json!({ "title": "Senior SRE" })),
    )
    .await;
    ok(&app, "POST", "/api/mail/sync", None).await;
    assert!(
        fake.state
            .lock()
            .unwrap()
            .labels
            .contains(&"hunt/Globex/Senior SRE".to_string())
    );
    assert_eq!(
        ok(&app, "GET", &format!("/api/processes/{sre}/mail"), None).await["label"],
        "hunt/Globex/Senior SRE"
    );
    let first = sre_mail[2]["id"].clone();
    let back = ok(&app, "POST", &format!("/api/emails/{first}/unlink"), None).await;
    assert_eq!(
        (back["status"].clone(), back["suggested"][0]["id"].clone()),
        (json!("triage"), json!(sre))
    );

    // An .eml file dropped on a process.
    let eml = "Message-ID: <x1@acme.com>\r\nFrom: \"Dana\" <dana@acme.com>\r\nTo: me@gmail.com\r\nSubject: Offer\r\nDate: Tue, 06 Oct 2026 10:00:00 +0000\r\n\r\nWe'd love to have you.\r\n";
    let req = Request::post(format!("/api/processes/{staff}/emails"))
        .body(Body::from(eml))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let e = ok(&app, "GET", &format!("/api/processes/{staff}/emails"), None).await;
    assert_eq!(
        (
            e[0]["subject"].clone(),
            e[0]["matched_by"].clone(),
            e[0]["snippet"].clone()
        ),
        (
            json!("Offer"),
            json!("file"),
            json!("We'd love to have you.")
        )
    );
    let req = Request::post(format!("/api/processes/{staff}/emails"))
        .body(Body::from("not mail"))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(req).await.unwrap().status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
}

#[tokio::test]
async fn bookmarklet_settings() {
    let app = app();
    let s = ok(&app, "GET", "/api/settings", None).await;
    assert_eq!(
        (&s["bookmarklet_url"], &s["same_name"]),
        (&Value::Null, &json!("ask"))
    );
    let s = ok(
        &app,
        "PATCH",
        "/api/settings",
        Some(json!({ "bookmarklet_url": "http://hunt.local:4848/" })),
    )
    .await;
    assert_eq!(
        s["bookmarklet_url"], "http://hunt.local:4848",
        "no trailing slash"
    );
    for bad in ["hunt.local", "ftp://x", "http://x/some/path"] {
        let (status, _) = call(
            &app,
            "PATCH",
            "/api/settings",
            Some(json!({ "bookmarklet_url": bad })),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{bad}");
    }
    let s = ok(
        &app,
        "PATCH",
        "/api/settings",
        Some(json!({ "same_name": "merge" })),
    )
    .await;
    assert_eq!(
        (&s["bookmarklet_url"], &s["same_name"]),
        (&json!("http://hunt.local:4848"), &json!("merge")),
        "others stay"
    );
    let (status, _) = call(
        &app,
        "PATCH",
        "/api/settings",
        Some(json!({ "same_name": "sometimes" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let s = ok(
        &app,
        "PATCH",
        "/api/settings",
        Some(json!({ "bookmarklet_url": "" })),
    )
    .await;
    assert_eq!(
        s["bookmarklet_url"],
        Value::Null,
        "empty: this page's address"
    );
}

/// Google, in miniature: sign-in and the parts of the Gmail API hunt uses.
async fn mock_google() -> (String, std::sync::Arc<std::sync::Mutex<Vec<String>>>) {
    use axum::Json;
    use axum::extract::{Form, Path as P, Query as Q};
    use axum::http::HeaderMap;
    use axum::routing::{get, post};
    use base64::Engine;
    use std::collections::HashMap;
    let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let authed = |h: &HeaderMap| {
        h.get("authorization").and_then(|v| v.to_str().ok()) == Some("Bearer fresh")
    };
    let eml = "Message-ID: <a1@acme.com>\r\nFrom: Jo <jo@acme.com>\r\nTo: me@gmail.com\r\nSubject: Next steps\r\nDate: Tue, 06 Oct 2026 10:00:00 +0000\r\n\r\nCan you do Friday?\r\n";
    let raw = base64::engine::general_purpose::URL_SAFE.encode(eml);
    let (s1, s2, s3) = (seen.clone(), seen.clone(), seen.clone());
    let site = axum::Router::new()
        .route(
            "/token",
            post(|Form(f): Form<HashMap<String, String>>| async move {
                let ok = match f.get("grant_type").map(String::as_str) {
                    Some("authorization_code") => f.get("code").map(String::as_str) == Some("good") && f.contains_key("code_verifier"),
                    Some("refresh_token") => f.get("refresh_token").map(String::as_str) == Some("kept"),
                    _ => false,
                };
                if ok {
                    (StatusCode::OK, Json(json!({ "access_token": "fresh", "refresh_token": "kept",
                        "scope": "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.labels" })))
                } else {
                    (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid_grant", "error_description": "Bad code" })))
                }
            }),
        )
        .route("/revoke", post(move || async move { s1.lock().unwrap().push("revoked".into()); "" }))
        .route("/gmail/v1/users/me/profile", get(move |h: HeaderMap| async move {
            assert!(authed(&h));
            Json(json!({ "emailAddress": "Me@gmail.com" }))
        }))
        .route("/gmail/v1/users/me/labels", get({
            let seen = s2.clone();
            move || async move {
                let names: Vec<Value> = seen.lock().unwrap().iter().filter_map(|s| s.strip_prefix("label:"))
                    .map(|n| json!({ "id": format!("L-{n}"), "name": n })).collect();
                Json(json!({ "labels": names }))
            }
        }).post(move |Json(b): Json<Value>| async move {
            s2.lock().unwrap().push(format!("label:{}", b["name"].as_str().unwrap()));
            Json(json!({ "id": format!("L-{}", b["name"].as_str().unwrap()), "name": b["name"] }))
        }))
        .route("/gmail/v1/users/me/messages", get(move |Q(q): Q<HashMap<String, String>>, h: HeaderMap| async move {
            assert!(authed(&h));
            s3.lock().unwrap().push(format!("search:{}", q.get("q").cloned().unwrap_or_default()));
            let hit = q.get("q").is_some_and(|q| q.contains("acme.com"));
            Json(if hit { json!({ "messages": [{ "id": "1a", "threadId": "2b" }] }) } else { json!({}) })
        }))
        .route("/gmail/v1/users/me/messages/{id}", get(move |P(id): P<String>| {
            let raw = raw.clone();
            async move {
                assert_eq!(id, "1a");
                Json(json!({ "id": "1a", "threadId": "2b", "labelIds": ["INBOX"], "raw": raw }))
            }
        }))
        .route("/gmail/v1/users/me/threads/{id}", get(|P(id): P<String>| async move {
            Json(json!({ "id": id, "messages": [{ "id": "1a" }] }))
        }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, site).await.unwrap() });
    (url, seen)
}

#[tokio::test(flavor = "multi_thread")]
async fn signing_in_with_google_reads_gmail_through_its_api() {
    let (google, seen) = mock_google().await;
    // SAFETY: only this test reads it.
    unsafe { std::env::set_var("HUNT_GMAIL_API", &google) };
    let app = app();
    let (status, _) = call(&app, "GET", "/api/mail/google/start", None).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "no client yet");
    let client = json!({ "web": { "client_id": "1-abc.apps.googleusercontent.com", "client_secret": "s3cret",
        "auth_uri": format!("{google}/auth"), "token_uri": format!("{google}/token") } });
    let req = Request::put("/api/mail/google/client")
        .body(Body::from(client.to_string()))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let st = ok(&app, "GET", "/api/mail", None).await;
    assert_eq!(
        (st["google_client"].clone(), st["connected"].clone()),
        (json!("1-abc.apps.googleusercontent.com"), json!(false))
    );
    assert!(
        !st.to_string().contains("s3cret"),
        "the secret is never sent back"
    );

    let start = |host: &'static str| {
        let app = app.clone();
        async move {
            let req = Request::get("/api/mail/google/start")
                .header("host", host)
                .body(Body::empty())
                .unwrap();
            let res = app.oneshot(req).await.unwrap();
            let v: Value =
                serde_json::from_slice(&res.into_body().collect().await.unwrap().to_bytes())
                    .unwrap();
            v
        }
    };
    let s = start("127.0.0.1:4848").await;
    assert_eq!(
        s["redirect"],
        "http://127.0.0.1:4848/api/mail/google/callback"
    );
    let url = s["url"].as_str().unwrap().to_string();
    assert!(url.starts_with(&format!("{google}/auth?client_id=")));
    let state = url
        .split("state=")
        .nth(1)
        .unwrap()
        .split('&')
        .next()
        .unwrap()
        .to_string();
    let back = |path: String| {
        let app = app.clone();
        async move {
            let res = app
                .oneshot(Request::get(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(res.status(), StatusCode::SEE_OTHER);
            res.headers()["location"].to_str().unwrap().to_string()
        }
    };
    // Someone else's state is refused; and each sign-in is used once.
    assert!(
        back("/api/mail/google/callback?code=good&state=forged".to_string())
            .await
            .contains("gmail_error=")
    );
    assert!(
        back(format!("/api/mail/google/callback?code=good&state={state}"))
            .await
            .contains("gmail_error="),
        "used up"
    );
    let state = start("127.0.0.1:4848").await["url"]
        .as_str()
        .unwrap()
        .split("state=")
        .nth(1)
        .unwrap()
        .split('&')
        .next()
        .unwrap()
        .to_string();
    let to = back(format!("/api/mail/google/callback?code=good&state={state}")).await;
    assert_eq!(to, "/settings?gmail=connected&address=me@gmail.com");
    let st = ok(&app, "GET", "/api/mail", None).await;
    assert_eq!(
        (st["auth"].clone(), st["address"].clone()),
        (json!("google"), json!("me@gmail.com"))
    );
    assert_eq!(
        back("/api/mail/google/callback?error=access_denied".into()).await,
        "/settings?gmail_error=you%20didn%27t%20allow%20hunt%20to%20read%20Gmail"
    );

    // A sync goes through the API, and makes labels with their parents.
    let card = ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Acme", "title": "SRE" })),
    )
    .await;
    let acme = ok(&app, "GET", "/api/companies?q=Acme", None).await[0]["id"].clone();
    ok(
        &app,
        "PATCH",
        &format!("/api/companies/{acme}"),
        Some(json!({ "website": "https://acme.com" })),
    )
    .await;
    let report = ok(&app, "POST", "/api/mail/sync", None).await;
    assert_eq!(report["linked"], 1, "{report}");
    let emails = ok(
        &app,
        "GET",
        &format!("/api/processes/{}/emails", card["id"]),
        None,
    )
    .await;
    assert_eq!(
        (emails[0]["subject"].clone(), emails[0]["gm_thrid"].clone()),
        (json!("Next steps"), json!("43")),
        "ids as IMAP has them"
    );
    let labels: Vec<String> = seen
        .lock()
        .unwrap()
        .iter()
        .filter(|s| s.starts_with("label:"))
        .cloned()
        .collect();
    assert_eq!(
        labels,
        ["label:hunt", "label:hunt/Acme", "label:hunt/Acme/SRE"]
    );
    let again = ok(&app, "POST", "/api/mail/sync", None).await;
    assert_eq!(again["fetched"], 0, "nothing twice");

    // Disconnecting withdraws hunt's access.
    let st = ok(&app, "DELETE", "/api/mail", None).await;
    assert_eq!(st["connected"], false);
    assert!(seen.lock().unwrap().contains(&"revoked".to_string()));
}

#[tokio::test]
async fn emails_are_pasted_and_removed() {
    let app = app();
    let card = ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Acme", "title": "SRE" })),
    )
    .await;
    let pasted = "Original message\nMessage ID\t<z@acme.com>\nDownload original\tCopy to clipboard\nDelivered-To: me@gmail.com\n\
                  Message-ID: <z@acme.com>\nFrom: Rita <rita@acme.com>\nTo: me@gmail.com\nSubject: Offer\n\
                  Date: Tue, 06 Oct 2026 10:00:00 +0000\n\nWelcome aboard.\n";
    let req = Request::post(format!("/api/processes/{}/emails", card["id"]))
        .body(Body::from(pasted))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(req).await.unwrap().status(),
        StatusCode::OK
    );
    let emails = ok(
        &app,
        "GET",
        &format!("/api/processes/{}/emails", card["id"]),
        None,
    )
    .await;
    assert_eq!(
        (emails[0]["subject"].clone(), emails[0]["from_addr"].clone()),
        (json!("Offer"), json!("rita@acme.com"))
    );
    ok(
        &app,
        "DELETE",
        &format!("/api/emails/{}", emails[0]["id"]),
        None,
    )
    .await;
    assert_eq!(
        ok(
            &app,
            "GET",
            &format!("/api/processes/{}/emails", card["id"]),
            None
        )
        .await,
        json!([])
    );
    let log = ok(
        &app,
        "GET",
        &format!("/api/processes/{}/detail", card["id"]),
        None,
    )
    .await;
    assert_eq!(
        log["activity"][0]["summary"],
        "Removed email “Offer” from process Acme — SRE"
    );
}

async fn bytes(app: &Router, req: Request<Body>) -> (StatusCode, Vec<u8>) {
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    (
        status,
        res.into_body().collect().await.unwrap().to_bytes().to_vec(),
    )
}

#[tokio::test(flavor = "multi_thread")]
async fn a_backup_restores_everything_into_any_database() {
    // From SQLite…
    let from = hunt::api::router(Db::open_in_memory().unwrap());
    let card = ok(
        &from,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Acme", "title": "Staff Engineer" })),
    )
    .await;
    let app_id = card["application_id"].clone();
    ok(
        &from,
        "PUT",
        &format!("/api/applications/{app_id}/tags"),
        Some(json!({ "tags": ["remote"] })),
    )
    .await;
    let later = ok(
        &from,
        "POST",
        "/api/applications",
        Some(json!({ "company": "Globex", "title": "SRE" })),
    )
    .await;
    ok(
        &from,
        "PATCH",
        &format!("/api/applications/{app_id}"),
        Some(json!({ "via_id": later["id"] })),
    )
    .await;
    ok(
        &from,
        "POST",
        "/api/notes",
        Some(json!({ "process_id": card["id"], "body": "asked about on-call" })),
    )
    .await;
    let doc = ok(
        &from,
        "POST",
        "/api/documents",
        Some(json!({ "name": "Resume" })),
    )
    .await;
    let pdf: Vec<u8> = b"%PDF-1.4 \x00\xff binary".to_vec();
    let (status, _) = bytes(
        &from,
        Request::post(format!(
            "/api/documents/{}/versions?filename=cv.pdf",
            doc["id"]
        ))
        .header("content-type", "application/pdf")
        .body(Body::from(pdf.clone()))
        .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    ok(
        &from,
        "PATCH",
        "/api/settings",
        Some(json!({ "same_name": "merge" })),
    )
    .await;
    ok(&from, "PUT", "/api/mail", Some(json!({ "interval": 15 }))).await;

    let (status, body) = bytes(
        &from,
        Request::get("/api/backup").body(Body::empty()).unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let backup: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        (
            backup["hunt_backup"].clone(),
            backup["schema_version"].clone()
        ),
        (json!(1), json!(hunt::db::SCHEMA_VERSION))
    );
    assert_eq!(backup["counts"]["process"], 1);
    assert!(
        !String::from_utf8_lossy(&body).contains("mail.interval"),
        "the Gmail connection stays behind"
    );

    // …into a database (whichever HUNT_TEST_DB says) with other things in it.
    let to = app();
    ok(
        &to,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Initech" })),
    )
    .await;
    let (status, _) = bytes(
        &to,
        Request::post("/api/backup")
            .body(Body::from(body.clone()))
            .unwrap(),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "it has to be meant"
    );
    let (status, counts) = bytes(
        &to,
        Request::post("/api/backup?confirm=replace")
            .body(Body::from(body.clone()))
            .unwrap(),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&counts)
    );
    let counts: Value = serde_json::from_slice(&counts).unwrap();
    assert_eq!(
        (counts["company"].clone(), counts["stored_file"].clone()),
        (json!(2), json!(1))
    );

    let companies: Vec<String> = ok(&to, "GET", "/api/companies", None)
        .await
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["name"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(
        companies,
        ["Acme", "Globex"],
        "what was there before is gone"
    );
    let a = ok(&to, "GET", &format!("/api/applications/{app_id}"), None).await;
    assert_eq!(
        (a["tags"].clone(), a["via_id"].clone()),
        (json!(["remote"]), later["id"].clone())
    );
    let v = ok(&to, "GET", &format!("/api/documents/{}", doc["id"]), None).await;
    assert_eq!(v["name"], "Resume");
    let version = ok(&to, "GET", "/api/versions", None).await[0]["id"].clone();
    let (_, file) = bytes(
        &to,
        Request::get(format!("/api/versions/{version}/file"))
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(file, pdf, "files come back byte for byte");
    assert_eq!(
        ok(&to, "GET", "/api/settings", None).await["same_name"],
        "merge"
    );
    let log = ok(
        &to,
        "GET",
        &format!("/api/processes/{}/detail", card["id"]),
        None,
    )
    .await;
    assert!(
        !log["activity"].as_array().unwrap().is_empty(),
        "the change log comes too"
    );
    // New records carry on after the restored ones.
    let next = ok(
        &to,
        "POST",
        "/api/companies",
        Some(json!({ "name": "Hooli" })),
    )
    .await;
    assert!(next["id"].as_i64().unwrap() > later["company_id"].as_i64().unwrap());

    // What isn't a backup changes nothing.
    let mut bad = backup.clone();
    bad["schema_version"] = json!(3);
    let bads = [
        b"not json".to_vec(),
        serde_json::to_vec(&json!({ "hunt_backup": 1 })).unwrap(),
        serde_json::to_vec(&bad).unwrap(),
        {
            let mut b = backup.clone();
            b["tables"]["company"][0]["evil"] = json!("x");
            serde_json::to_vec(&b).unwrap()
        },
        {
            let mut b = backup.clone();
            b["tables"]["users"] = json!([]);
            serde_json::to_vec(&b).unwrap()
        },
        {
            let mut b = backup.clone();
            b["tables"]["process"][0]["application_id"] = json!(999);
            serde_json::to_vec(&b).unwrap()
        },
    ];
    for b in bads {
        let (status, msg) = bytes(
            &to,
            Request::post("/api/backup?confirm=replace")
                .body(Body::from(b))
                .unwrap(),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{}",
            String::from_utf8_lossy(&msg)
        );
    }
    assert_eq!(
        ok(&to, "GET", "/api/companies", None)
            .await
            .as_array()
            .unwrap()
            .len(),
        3,
        "untouched"
    );
}

/// A PostgreSQL or MySQL database made by an older hunt (schema 8) is
/// upgraded when opened. Only with HUNT_TEST_DB.
#[test]
fn a_server_database_upgrades_itself() {
    let Ok(server) = std::env::var("HUNT_TEST_DB") else {
        return;
    };
    if server.is_empty() {
        return;
    }
    let name = format!("hunt_upgrade_{}", std::process::id());
    let url = hunt::store::create_database(&server, &name).unwrap();
    // A database as hunt 0.5 made it (schema 14), with something in it.
    let mysql = url.starts_with("mysql://");
    let schema = if mysql {
        include_str!("../src/schema_mysql.sql")
    } else {
        include_str!("../src/schema_postgres.sql")
    };
    let setup = [
        "INSERT INTO hunt_meta (name, value) VALUES ('app', 'hunt'), ('schema_version', '14')",
        "INSERT INTO stage (name, position, created_at, updated_at) VALUES ('Considering', 0, 'x', 'x')",
        "INSERT INTO archive_reason (value, name, position, created_at, updated_at) VALUES ('rejected', 'They rejected me', 0, 'x', 'x')",
        "INSERT INTO company (name, created_at, updated_at) VALUES ('Acme', 'x', 'x')",
        "INSERT INTO setting (name, value) VALUES ('locale.language', 'ar')",
    ];
    if mysql {
        use mysql::prelude::Queryable;
        let mut c = mysql::Conn::new(mysql::Opts::from_url(&url).unwrap()).unwrap();
        // Comments out first: they can hold a ';'.
        let plain: String = schema
            .lines()
            .filter(|l| !l.trim_start().starts_with("--"))
            .map(|l| format!("{l}\n"))
            .collect();
        for stmt in plain.split(';').filter(|s| !s.trim().is_empty()) {
            c.query_drop(stmt).unwrap();
        }
        for sql in setup {
            c.query_drop(sql).unwrap();
        }
    } else {
        let mut c = postgres::Client::connect(&url, postgres::NoTls).unwrap();
        c.batch_execute(schema).unwrap();
        for sql in setup {
            c.batch_execute(sql).unwrap();
        }
    }
    // Opened by this hunt: upgraded to 15, everything owner 1's.
    let db = Db::open(&url).unwrap();
    let settings = db.settings().unwrap();
    assert_eq!(settings["language"], "ar", "the setting is still there");
    let mut rec = hunt::Record::new();
    rec.insert("company".into(), json!("Acme"));
    rec.insert("bonus".into(), json!("15%"));
    let made = db.add_application(&rec).unwrap();
    assert_eq!(made["bonus"], "15%");
    assert_eq!(made["company_id"], 1, "the same Acme, owner 1's");
    // Another owner can have an Acme of their own, and stages to go with it.
    db.set_owner(Some(2));
    db.seed().unwrap();
    let theirs = db.add_application(&rec).unwrap();
    assert_ne!(theirs["company_id"], made["company_id"]);
    db.set_owner(Some(1));
    assert_eq!(
        db.list(
            hunt::resource::resource("companies").unwrap(),
            None,
            &[],
            None
        )
        .unwrap()
        .len(),
        1
    );
    // Schema 16's kinds of document, the kind's check changed in place.
    let documents = hunt::resource::resource("documents").unwrap();
    let mut nda = hunt::Record::new();
    nda.insert("name".into(), json!("Acme NDA"));
    nda.insert("kind".into(), json!("nda"));
    assert_eq!(db.create(documents, &nda).unwrap()["kind"], "nda");
}

#[tokio::test]
async fn a_step_is_with_people() {
    let app = app();
    let card = ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Acme", "title": "SRE" })),
    )
    .await;
    let step = ok(
        &app,
        "POST",
        "/api/steps",
        Some(json!({ "process_id": card["id"], "title": "Onsite" })),
    )
    .await;
    assert_eq!(step["people"], json!([]));
    let sam = ok(
        &app,
        "POST",
        "/api/people",
        Some(json!({ "name": "Sam Lee" })),
    )
    .await;
    let dana = ok(
        &app,
        "POST",
        "/api/people",
        Some(json!({ "name": "Dana Kim" })),
    )
    .await;
    let id = step["id"].clone();
    let with = ok(
        &app,
        "PUT",
        &format!("/api/steps/{id}/people"),
        Some(json!({ "person_ids": [sam["id"], dana["id"], sam["id"]] })),
    )
    .await;
    let names: Vec<&str> = with["people"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["Dana Kim", "Sam Lee"], "each once, by name");
    let detail = ok(
        &app,
        "GET",
        &format!("/api/processes/{}/detail", card["id"]),
        None,
    )
    .await;
    assert_eq!(
        detail["steps"][0]["people"].as_array().unwrap().len(),
        2,
        "steps carry their people"
    );
    assert_eq!(
        detail["activity"][0]["summary"],
        "Updated step Onsite: with: — → Dana Kim, Sam Lee"
    );
    // Sending a step back with its people is fine; someone unknown isn't.
    ok(
        &app,
        "PATCH",
        &format!("/api/steps/{id}"),
        Some(with.clone()),
    )
    .await;
    let (status, _) = call(
        &app,
        "PUT",
        &format!("/api/steps/{id}/people"),
        Some(json!({ "person_ids": [999] })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Deleting a person takes them off.
    ok(&app, "DELETE", &format!("/api/people/{}", dana["id"]), None).await;
    let step = ok(&app, "GET", &format!("/api/steps/{id}"), None).await;
    assert_eq!(
        step["people"],
        json!([{ "id": sam["id"], "name": "Sam Lee", "photo": null }])
    );
    // Done, with nothing to wait for, as well as done and waiting.
    for status in ["done", "completed"] {
        let changed = ok(
            &app,
            "PATCH",
            &format!("/api/steps/{id}"),
            Some(json!({ "status": status })),
        )
        .await;
        assert_eq!(changed["status"], status);
    }
}

#[tokio::test]
async fn general_notes() {
    let app = app();
    let m = ok(
        &app,
        "POST",
        "/api/memos",
        Some(json!({ "body": "Ask every recruiter about on-call.\nAnd remote days." })),
    )
    .await;
    assert_eq!(
        m["label"],
        "Ask every recruiter about on-call.\nAnd remote days."
    );
    let titled = ok(
        &app,
        "POST",
        "/api/memos",
        Some(json!({ "title": "What I want next", "body": "Platform work, small team." })),
    )
    .await;
    assert_eq!(titled["label"], "What I want next");
    ok(
        &app,
        "PUT",
        &format!("/api/memos/{}/tags", titled["id"]),
        Some(json!({ "tags": ["goals"] })),
    )
    .await;
    let found = ok(&app, "GET", "/api/memos?q=platform", None).await;
    assert_eq!(
        (found.as_array().unwrap().len(), found[0]["tags"].clone()),
        (1, json!(["goals"]))
    );
    let (status, _) = call(
        &app,
        "POST",
        "/api/memos",
        Some(json!({ "title": "empty" })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "a note needs its text"
    );
    let (_, body) = bytes(
        &app,
        Request::get("/api/backup").body(Body::empty()).unwrap(),
    )
    .await;
    let backup: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(backup["counts"]["memo"], 2, "backed up");
}

#[tokio::test]
async fn stats_add_up() {
    let app = app();
    let board = ok(&app, "GET", "/api/board", None).await;
    let screening = stage_id(&board, "Screening");
    let a = ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Acme", "title": "SRE", "source": "LinkedIn" })),
    )
    .await;
    ok(
        &app,
        "POST",
        &format!("/api/processes/{}/move", a["id"]),
        Some(json!({ "stage_id": screening })),
    )
    .await;
    let b = ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Globex", "source": "linkedin" })),
    )
    .await;
    ok(
        &app,
        "PATCH",
        &format!("/api/processes/{}", b["id"]),
        Some(json!({ "status": "archived", "archive_reason": "rejected" })),
    )
    .await;
    ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Initech", "source": "referral" })),
    )
    .await;
    ok(&app, "POST", "/api/steps", Some(json!({ "process_id": a["id"], "title": "Screen", "at": "2026-01-05T10:00", "status": "passed" }))).await;
    let st = ok(&app, "GET", "/api/stats", None).await;
    let t = &st["totals"];
    assert_eq!(
        (
            t["processes"].clone(),
            t["active"].clone(),
            t["archived"].clone()
        ),
        (json!(3), json!(2), json!(1))
    );
    assert_eq!(t["interviews_done"], 1);
    let reached: Vec<i64> = st["funnel"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["reached"].as_i64().unwrap())
        .collect();
    assert_eq!(
        &reached[..3],
        [3, 1, 1],
        "everyone considered; one got to screening"
    );
    assert_eq!(
        st["outcomes"],
        json!([{ "reason": "rejected", "label": "They rejected me", "count": 1 }])
    );
    let linkedin = st["sources"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["source"] == "linkedin")
        .unwrap()
        .clone();
    assert_eq!(
        (linkedin["count"].clone(), linkedin["progressed"].clone()),
        (json!(2), json!(1)),
        "sources match whatever the case"
    );
    assert_eq!(st["weekly"].as_array().unwrap().len(), 16);
    assert!(
        st["activity"]
            .as_array()
            .unwrap()
            .iter()
            .any(|d| d["count"].as_i64().unwrap() > 0)
    );
}

#[tokio::test]
async fn system_says_what_hunt_uses() {
    let app = app();
    ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({"company": "Acme"})),
    )
    .await;
    let s = ok(&app, "GET", "/api/system", None).await;
    assert_eq!(s["hunt"]["version"], env!("CARGO_PKG_VERSION"));
    assert!(s["database"]["size"].as_i64().unwrap() > 0, "{s}");
    assert_eq!(s["database"]["rows"]["process"], 1);
    assert_eq!(s["database"]["rows"]["company"], 1);
    assert!(s["cpu"]["seconds"].as_f64().is_some(), "{s}");
}

#[tokio::test]
async fn meta_says_when_cloudflare_access_is_in_front() {
    let app = app();
    assert!(ok(&app, "GET", "/api/meta", None).await["access"].is_null());
    let req = Request::builder()
        .uri("/api/meta")
        .header("cf-access-jwt-assertion", "x")
        .header("cf-access-authenticated-user-email", "me@example.com")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let meta: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(meta["access"]["email"], "me@example.com");
}

#[tokio::test]
async fn localisation_settings_are_kept_and_checked() {
    let db = test_db();
    db.store_rate("EUR", 0.85, "2026-10-07").unwrap();
    let app = hunt::api::router(db);
    let s = ok(&app, "GET", "/api/settings", None).await;
    assert_eq!(
        (
            s["currency"].as_str(),
            s["clock"].as_str(),
            s["week_start"].as_str()
        ),
        (Some("GBP"), Some("auto"), Some("monday"))
    );
    assert!(s["locale"].is_null());
    let s = ok(
        &app,
        "PATCH",
        "/api/settings",
        Some(json!({"locale": "en-US", "clock": "12", "week_start": "sunday", "currency": "€"})),
    )
    .await;
    assert_eq!(s["locale"], "en-US");
    assert_eq!(s["clock"], "12");
    assert_eq!(s["week_start"], "sunday");
    assert_eq!(s["currency"], "EUR");
    assert_eq!(s["currency_rate"], 0.85);
    for bad in [
        json!({"clock": "25"}),
        json!({"week_start": "friday"}),
        json!({"locale": "en_GB!"}),
        json!({"currency": "pounds"}),
    ] {
        let (status, _) = call(&app, "PATCH", "/api/settings", Some(bad.clone())).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{bad}");
    }
    let s = ok(&app, "PATCH", "/api/settings", Some(json!({"locale": ""}))).await;
    assert!(s["locale"].is_null());

    // Language, numerals and time zone: English, the language's digits and
    // the machine's zone until chosen.
    assert_eq!(s["language"], "en");
    assert_eq!(s["numerals"], "auto");
    assert!(s["timezone"].is_null());
    assert!(s["server_timezone"].is_string());
    let s = ok(
        &app,
        "PATCH",
        "/api/settings",
        Some(json!({"language": "ar", "numerals": "latn", "timezone": "Asia/Riyadh"})),
    )
    .await;
    assert_eq!(
        (&s["language"], &s["numerals"], &s["timezone"]),
        (&json!("ar"), &json!("latn"), &json!("Asia/Riyadh"))
    );
    for bad in [
        json!({"language": "xx"}),
        json!({"numerals": "roman"}),
        json!({"timezone": "Mars/Olympus"}),
    ] {
        let (status, _) = call(&app, "PATCH", "/api/settings", Some(bad.clone())).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{bad}");
    }
    let s = ok(
        &app,
        "PATCH",
        "/api/settings",
        Some(json!({"timezone": ""})),
    )
    .await;
    assert!(s["timezone"].is_null());
    // The page's languages, each with its direction.
    let meta = ok(&app, "GET", "/api/meta", None).await;
    assert_eq!(
        meta["languages"][1],
        json!({"value": "ar", "label": "العربية", "dir": "rtl"})
    );
}

#[tokio::test]
async fn the_page_is_served_in_the_language_chosen() {
    let app = app();
    let html = |path: &'static str| {
        let app = app.clone();
        async move {
            let res = app
                .oneshot(Request::get(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            String::from_utf8(res.into_body().collect().await.unwrap().to_bytes().to_vec()).unwrap()
        }
    };
    // English, left to right, unless another is chosen.
    assert!(html("/app").await.contains(r#"<html lang="en" dir="ltr">"#));
    ok(
        &app,
        "PATCH",
        "/api/settings",
        Some(json!({"language": "ar"})),
    )
    .await;
    for path in ["/app", "/app/companies", "/app/applications/1"] {
        assert!(
            html(path).await.contains(r#"<html lang="ar" dir="rtl">"#),
            "{path}"
        );
    }
    ok(
        &app,
        "PATCH",
        "/api/settings",
        Some(json!({"language": "en"})),
    )
    .await;
    assert!(html("/app").await.contains(r#"<html lang="en" dir="ltr">"#));
}

#[tokio::test]
async fn the_dashboard_lives_under_app_and_old_addresses_lead_there() {
    let app = app();
    let get = |path: &'static str| {
        let app = app.clone();
        async move {
            app.oneshot(Request::get(path).body(Body::empty()).unwrap())
                .await
                .unwrap()
        }
    };
    // The home page is at /, for one person's own hunt too; /about, where it was, leads there.
    assert_eq!(get("/").await.status(), StatusCode::OK);
    let res = get("/about").await;
    assert_eq!(res.status(), StatusCode::PERMANENT_REDIRECT);
    assert_eq!(res.headers()["location"], "/");
    // Addresses from before: the same page, under /app, with their query.
    let res = get("/companies/3?edit=1").await;
    assert_eq!(res.status(), StatusCode::PERMANENT_REDIRECT);
    assert_eq!(res.headers()["location"], "/app/companies/3?edit=1");
    assert_eq!(
        get("/screenshots/board-light.png").await.status(),
        StatusCode::OK
    );
    // The site's other pages: public, in either kind of hunt.
    assert_eq!(get("/docs").await.status(), StatusCode::OK);
    assert_eq!(get("/screenshots").await.status(), StatusCode::OK);
    // Not pages: not found.
    assert_eq!(get("/api/nothing").await.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        get("/screenshots/secret.png").await.status(),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn processes_change_in_bulk_and_back() {
    let app = app();
    let mut ids = Vec::new();
    for company in ["Acme", "Globex", "Initech"] {
        let card = ok(
            &app,
            "POST",
            "/api/processes",
            Some(json!({ "company": company })),
        )
        .await;
        ids.push(card["id"].as_i64().unwrap());
    }
    let stages = ok(&app, "GET", "/api/stages", None).await;
    let stage = |name: &str| {
        stages
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["name"] == name)
            .unwrap()["id"]
            .clone()
    };
    let bulk = |body: Value| ok(&app, "POST", "/api/processes/bulk", Some(body));
    // Two moved at once, in their order.
    let moved = bulk(
        json!({ "ids": [ids[0], ids[1]], "action": "move", "stage_id": stage("Interviewing") }),
    )
    .await;
    assert_eq!(moved["done"], json!([ids[0], ids[1]]));
    let p = ok(&app, "GET", &format!("/api/processes/{}", ids[1]), None).await;
    assert_eq!(p["stage_id"], stage("Interviewing"));
    // Undo: back as they were.
    bulk(json!({ "action": "restore", "states": moved["before"] })).await;
    let p = ok(&app, "GET", &format!("/api/processes/{}", ids[1]), None).await;
    assert_eq!(p["stage_id"], stage("Considering"));
    // Archived, skipping one already archived; then undone, back on the board.
    ok(
        &app,
        "PATCH",
        &format!("/api/processes/{}", ids[2]),
        Some(json!({ "status": "archived", "archive_reason": "rejected" })),
    )
    .await;
    let archived = bulk(json!({ "ids": ids, "action": "archive", "reason": "withdrew", "note": "took another offer" })).await;
    assert_eq!(archived["done"], json!([ids[0], ids[1]]));
    assert_eq!(archived["skipped"][0]["id"], ids[2]);
    assert_eq!(archived["skipped"][0]["why"], "already closed");
    let p = ok(&app, "GET", &format!("/api/processes/{}", ids[0]), None).await;
    assert_eq!(
        (p["status"].as_str(), p["archive_note"].as_str()),
        (Some("archived"), Some("took another offer"))
    );
    bulk(json!({ "action": "restore", "states": archived["before"] })).await;
    let p = ok(&app, "GET", &format!("/api/processes/{}", ids[0]), None).await;
    assert_eq!(p["status"], "active");
    let p = ok(&app, "GET", &format!("/api/processes/{}", ids[2]), None).await;
    assert_eq!(
        (p["status"].as_str(), p["archive_reason"].as_str()),
        (Some("archived"), Some("rejected"))
    );
    // Tags on their applications, and fields set.
    bulk(json!({ "ids": [ids[0], ids[1]], "action": "tag", "tags": ["agency"] })).await;
    let apps = ok(&app, "GET", "/api/applications?tag=agency", None).await;
    assert_eq!(apps.as_array().unwrap().len(), 2);
    let untagged =
        bulk(json!({ "ids": [ids[0], ids[2]], "action": "untag", "tags": ["agency"] })).await;
    assert_eq!(untagged["done"], json!([ids[0]]));
    bulk(json!({ "ids": [ids[0], ids[1]], "action": "set", "fields": { "applied_on": "2026-10-02" } }))
        .await;
    let p = ok(&app, "GET", &format!("/api/processes/{}", ids[1]), None).await;
    assert_eq!(p["applied_on"], "2026-10-02");
    // All or nothing: one missing id, and nothing changes.
    let (status, body) = call(
        &app,
        "POST",
        "/api/processes/bulk",
        Some(
            json!({ "ids": [ids[0], 999], "action": "set", "fields": { "applied_on": "2026-10-03" } }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    let p = ok(&app, "GET", &format!("/api/processes/{}", ids[0]), None).await;
    assert_eq!(p["applied_on"], "2026-10-02");
    let (status, _) = call(
        &app,
        "POST",
        "/api/processes/bulk",
        Some(json!({ "ids": ids, "action": "teleport" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    // Deleted: their applications too.
    bulk(json!({ "ids": [ids[1]], "action": "delete" })).await;
    let apps = ok(&app, "GET", "/api/applications", None).await;
    assert_eq!(apps.as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn records_are_tagged_and_deleted_in_bulk() {
    let app = app();
    let a = ok(
        &app,
        "POST",
        "/api/companies",
        Some(json!({ "name": "Acme" })),
    )
    .await;
    let b = ok(
        &app,
        "POST",
        "/api/companies",
        Some(json!({ "name": "Globex" })),
    )
    .await;
    ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Globex" })),
    )
    .await;
    let ids = json!([a["id"], b["id"]]);
    let tagged = ok(
        &app,
        "POST",
        "/api/companies/bulk-tags",
        Some(json!({ "ids": ids, "add": ["fintech"] })),
    )
    .await;
    assert_eq!(tagged["changed"].as_array().unwrap().len(), 2);
    let found = ok(&app, "GET", "/api/companies?tag=fintech", None).await;
    assert_eq!(found.as_array().unwrap().len(), 2);
    ok(
        &app,
        "POST",
        "/api/companies/bulk-tags",
        Some(json!({ "ids": ids, "remove": ["fintech"] })),
    )
    .await;
    assert!(
        ok(&app, "GET", "/api/companies?tag=fintech", None)
            .await
            .as_array()
            .unwrap()
            .is_empty()
    );
    // Globex has an application: neither goes.
    let (status, _) = call(
        &app,
        "POST",
        "/api/companies/bulk-delete",
        Some(json!({ "ids": ids })),
    )
    .await;
    assert_ne!(status, StatusCode::OK);
    assert_eq!(
        ok(&app, "GET", "/api/companies", None)
            .await
            .as_array()
            .unwrap()
            .len(),
        2
    );
    ok(
        &app,
        "POST",
        "/api/companies/bulk-delete",
        Some(json!({ "ids": [a["id"]] })),
    )
    .await;
    assert_eq!(
        ok(&app, "GET", "/api/companies", None)
            .await
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let (status, _) = call(
        &app,
        "POST",
        "/api/stages/bulk-tags",
        Some(json!({ "ids": [1], "add": ["x"] })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[test]
fn the_clock_keeps_to_the_time_zone_chosen() {
    let db = Db::open_in_memory().unwrap();
    let here = db.clock();
    db.update_settings(&json!({"timezone": "Pacific/Kiritimati"}))
        .unwrap();
    let there = db.clock();
    // Kiritimati is UTC+14: the clock moves by the gap between the zones.
    let gap = jiff::tz::TimeZone::get("Pacific/Kiritimati")
        .unwrap()
        .to_offset(jiff::Timestamp::now())
        .seconds()
        - jiff::tz::TimeZone::system()
            .to_offset(jiff::Timestamp::now())
            .seconds();
    let moved = there.duration_since(here).as_secs() as i32;
    assert!(
        (moved - gap).abs() < 60,
        "moved {moved}s, the zones are {gap}s apart"
    );
}

#[test]
fn uptime_carries_on_across_a_rollout() {
    let db = test_db();
    db.note_start().unwrap();
    db.note_start().unwrap(); // a rollout, straight after
    let s = db.system().unwrap();
    assert_eq!(s["hunt"]["starts"], 2, "{s}");
    assert!(
        s["hunt"]["service_uptime_seconds"].as_f64().unwrap()
            >= s["hunt"]["uptime_seconds"].as_f64().unwrap()
    );
}

#[tokio::test]
async fn an_application_has_other_postings() {
    let app = app();
    let card = ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Initrode", "title": "Staff Engineer",
                     "url": "https://jobs.example/initrode/staff" })),
    )
    .await;
    let aid = card["application_id"].clone();
    // The same job, posted elsewhere, with what it says.
    let other = ok(
        &app,
        "POST",
        "/api/postings",
        Some(
            json!({ "application_id": aid, "url": "https://www.linkedin.com/jobs/view/1234567890",
                     "platform": "LinkedIn", "description": "Own the platform.",
                     "read_at": "2026-10-08T09:30" }),
        ),
    )
    .await;
    let listed = ok(
        &app,
        "GET",
        &format!("/api/postings?application_id={aid}"),
        None,
    )
    .await;
    assert_eq!(listed.as_array().unwrap().len(), 1);
    assert_eq!(listed[0]["platform"], "LinkedIn");
    // It counts as the application's when the link turns up again.
    let found = ok(
        &app,
        "GET",
        "/api/applications/same-posting?url=https://uk.linkedin.com/jobs/view/staff-engineer-at-initrode-1234567890",
        None,
    )
    .await;
    assert_eq!(found.as_array().unwrap().len(), 1);
    assert_eq!(found[0]["id"], aid);
    // A link is needed; and the application must exist.
    let (status, _) = call(
        &app,
        "POST",
        "/api/postings",
        Some(json!({ "application_id": aid })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    // It goes with its application, and is in backups.
    let backup = ok(&app, "GET", "/api/backup", None).await;
    assert_eq!(backup["tables"]["posting"][0]["id"], other["id"]);
    ok(&app, "DELETE", &format!("/api/applications/{aid}"), None).await;
    let gone = ok(&app, "GET", "/api/postings", None).await;
    assert!(gone.as_array().unwrap().is_empty());
}

#[tokio::test]
async fn a_stage_divides_into_lanes() {
    let app = app();
    let stages = ok(&app, "GET", "/api/stages", None).await;
    let offer = stages
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["name"] == "Offer")
        .unwrap()["id"]
        .clone();
    let interviewing = stages
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["name"] == "Interviewing")
        .unwrap()["id"]
        .clone();
    // From none: a new hunt's own lanes taken away.
    for l in ok(&app, "GET", "/api/lanes", None)
        .await
        .as_array()
        .unwrap()
    {
        ok(&app, "DELETE", &format!("/api/lanes/{}", l["id"]), None).await;
    }
    let mut lanes = Vec::new();
    for name in ["Accepted", "Shortlisted", "Rejected"] {
        lanes.push(
            ok(
                &app,
                "POST",
                "/api/lanes",
                Some(json!({ "stage_id": offer, "name": name })),
            )
            .await,
        );
    }
    assert_eq!(lanes[2]["position"], 2, "each new lane goes last");
    // Reordered top to bottom, every lane listed once.
    let order = |ids: Vec<Value>| json!({ "ids": ids });
    let reordered = ok(
        &app,
        "POST",
        &format!("/api/stages/{offer}/lanes/order"),
        Some(order(vec![
            lanes[2]["id"].clone(),
            lanes[0]["id"].clone(),
            lanes[1]["id"].clone(),
        ])),
    )
    .await;
    let names: Vec<&str> = reordered
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["Rejected", "Accepted", "Shortlisted"]);
    let (status, _) = call(
        &app,
        "POST",
        &format!("/api/stages/{offer}/lanes/order"),
        Some(order(vec![lanes[0]["id"].clone()])),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let card = ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Initrode", "title": "Staff Engineer", "stage_id": offer })),
    )
    .await;
    let id = card["id"].as_i64().unwrap();
    let moved = ok(
        &app,
        "POST",
        &format!("/api/processes/{id}/move"),
        Some(json!({ "stage_id": offer, "lane_id": lanes[1]["id"] })),
    )
    .await;
    assert_eq!(moved["lane"], "Shortlisted");
    // The board says which lanes each stage has, and where each card is.
    let board = ok(&app, "GET", "/api/board", None).await;
    let col = board["stages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == offer)
        .unwrap()
        .clone();
    assert_eq!(col["lanes"].as_array().unwrap().len(), 3);
    assert_eq!(col["cards"][0]["lane_id"], lanes[1]["id"]);
    // Another stage's lane won't do.
    let (status, _) = call(
        &app,
        "POST",
        &format!("/api/processes/{id}/move"),
        Some(json!({ "stage_id": interviewing, "lane_id": lanes[0]["id"] })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let (status, _) = call(
        &app,
        "PATCH",
        &format!("/api/processes/{id}"),
        Some(json!({ "lane_id": 999 })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    // To another stage, out of the lane: by moving, or by editing.
    let moved = ok(
        &app,
        "POST",
        &format!("/api/processes/{id}/move"),
        Some(json!({ "stage_id": interviewing })),
    )
    .await;
    assert!(moved["lane_id"].is_null());
    ok(
        &app,
        "POST",
        &format!("/api/processes/{id}/move"),
        Some(json!({ "stage_id": offer, "lane_id": lanes[0]["id"] })),
    )
    .await;
    let edited = ok(
        &app,
        "PATCH",
        &format!("/api/processes/{id}"),
        Some(json!({ "stage_id": interviewing })),
    )
    .await;
    assert!(edited["lane_id"].is_null());
    // A lane removed leaves its cards in the stage, in no lane.
    ok(
        &app,
        "POST",
        &format!("/api/processes/{id}/move"),
        Some(json!({ "stage_id": offer, "lane_id": lanes[2]["id"] })),
    )
    .await;
    ok(
        &app,
        "DELETE",
        &format!("/api/lanes/{}", lanes[2]["id"]),
        None,
    )
    .await;
    let p = ok(&app, "GET", &format!("/api/processes/{id}"), None).await;
    assert_eq!(p["stage_id"], offer);
    assert!(p["lane_id"].is_null());
}

/// A database as hunt 0.5 made it (schema 14): the base schema, seeded.
fn version_14_db(path: &std::path::Path) {
    let conn = rusqlite::Connection::open(path).unwrap();
    conn.execute_batch(&format!(
        "{} ; PRAGMA application_id = 1752526452; PRAGMA user_version = 14;
         INSERT INTO stage (name, position, created_at, updated_at) VALUES
             ('Considering', 0, 'x', 'x'), ('Applied', 1, 'x', 'x'), ('Offer', 2, 'x', 'x');
         INSERT INTO archive_reason (value, name, position, created_at, updated_at) VALUES
             ('rejected', 'They rejected me', 0, 'x', 'x');",
        include_str!("../src/schema.sql")
    ))
    .unwrap();
}

#[test]
fn an_upgraded_database_takes_the_new_kinds_of_file_and_keeps_its_own() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("hunt.db");
    version_14_db(&path);
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch(
        "INSERT INTO stored_file (sha256, data) VALUES ('abc', x'25504446');
         INSERT INTO document (name, kind, created_at, updated_at) VALUES ('CV', 'resume', 'x', 'x');
         INSERT INTO version (document_id, number, filename, content_type, size, sha256, created_at, updated_at)
             VALUES (1, 1, 'cv.pdf', 'application/pdf', 4, 'abc', 'x', 'x');",
    )
    .unwrap();
    drop(conn);
    let db = Db::open(&path).unwrap();
    // The resume is still there, owner 1's, with its version.
    assert_eq!(db.file(1).unwrap().filename, "cv.pdf");
    let documents = hunt::resource::resource("documents").unwrap();
    for kind in [
        "certificate",
        "job-description",
        "assignment",
        "nda",
        "background-check",
        "right-to-work",
    ] {
        let mut rec = hunt::Record::new();
        rec.insert("name".into(), json!(format!("A {kind}")));
        rec.insert("kind".into(), json!(kind));
        assert_eq!(db.create(documents, &rec).unwrap()["kind"], kind);
    }
    let conn = rusqlite::Connection::open(&path).unwrap();
    let (owner, kind): (i64, String) = conn
        .query_row(
            "SELECT owner_id, kind FROM document WHERE name = 'CV'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!((owner, kind.as_str()), (1, "resume"));
    // The database still checks: a kind it doesn't know is turned away.
    assert!(
        conn.execute(
            "INSERT INTO document (name, kind, created_at, updated_at) VALUES ('X', 'nonsense', 'x', 'x')",
            [],
        )
        .is_err()
    );
    let indexes: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type = 'index' AND name = 'document_by_owner'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(indexes, 1);
}

#[test]
fn an_upgraded_database_keeps_its_steps_and_who_they_were_with() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("hunt.db");
    version_14_db(&path);
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch(
        "INSERT INTO company (name, created_at, updated_at) VALUES ('Acme', 'x', 'x');
         INSERT INTO application (company_id, title, created_at, updated_at) VALUES (1, 'SRE', 'x', 'x');
         INSERT INTO process (application_id, stage_id, created_at, updated_at) VALUES (1, 1, 'x', 'x');
         INSERT INTO person (name, created_at, updated_at) VALUES ('Sam Lee', 'x', 'x');
         INSERT INTO step (process_id, title, status, format, created_at, updated_at)
             VALUES (1, 'Onsite', 'done', 'video', 'x', 'x');
         INSERT INTO step_person (step_id, person_id) VALUES (1, 1);",
    )
    .unwrap();
    drop(conn);
    drop(Db::open(&path).unwrap());
    let conn = rusqlite::Connection::open(&path).unwrap();
    let (status, format, owner): (String, String, i64) = conn
        .query_row(
            "SELECT status, format, owner_id FROM step WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(
        (status.as_str(), format.as_str(), owner),
        ("done", "video", 1)
    );
    let with: i64 = conn
        .query_row(
            "SELECT count(*) FROM step_person WHERE step_id = 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(with, 1, "still with Sam");
    conn.execute("UPDATE step SET status = 'completed' WHERE id = 1", [])
        .unwrap();
    assert!(
        conn.execute("UPDATE step SET status = 'nonsense' WHERE id = 1", [])
            .is_err()
    );
    // Deleting a step still takes who it was with.
    conn.execute_batch("PRAGMA foreign_keys = ON; DELETE FROM step WHERE id = 1;")
        .unwrap();
    let left: i64 = conn
        .query_row("SELECT count(*) FROM step_person", [], |r| r.get(0))
        .unwrap();
    assert_eq!(left, 0);
}

#[test]
fn a_version_14_database_becomes_its_first_accounts() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("hunt.db");
    version_14_db(&path);
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch(
        "INSERT INTO company (name, created_at, updated_at) VALUES ('Acme', 'x', 'x');
         INSERT INTO application (company_id, title, created_at, updated_at) VALUES (1, 'SRE', 'x', 'x');
         INSERT INTO process (application_id, stage_id, status, archive_reason, created_at, updated_at)
             VALUES (1, 1, 'archived', 'rejected', 'x', 'x');
         INSERT INTO setting (name, value) VALUES ('locale.language', 'ar');",
    )
    .unwrap();
    drop(conn);
    let db = Db::open(&path).unwrap();
    // Everything that was here is owner 1's, as it was.
    let conn = rusqlite::Connection::open(&path).unwrap();
    let owners: i64 = conn
        .query_row(
            "SELECT count(*) FROM process WHERE owner_id = 1 AND archive_reason = 'rejected'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(owners, 1);
    let lang: String = conn
        .query_row(
            "SELECT value FROM setting WHERE owner_id = 1 AND name = 'locale.language'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(lang, "ar");
    // Names are unique per owner: another owner can have an Acme too.
    conn.execute(
        "INSERT INTO company (owner_id, name, created_at, updated_at) VALUES (2, 'Acme', 'x', 'x')",
        [],
    )
    .unwrap();
    assert!(
        conn.execute(
            "INSERT INTO company (owner_id, name, created_at, updated_at) VALUES (1, 'acme', 'x', 'x')",
            [],
        )
        .is_err()
    );
    drop(db);
}

#[test]
fn a_version_12_database_gains_postings() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("hunt.db");
    version_14_db(&path);
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch(
        "ALTER TABLE process DROP COLUMN lane_id; DROP TABLE lane; DROP TABLE posting; \
         PRAGMA user_version = 12;",
    )
    .unwrap();
    drop(conn);
    let app = hunt::api::router(Db::open(&path).unwrap());
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let card = ok(
            &app,
            "POST",
            "/api/processes",
            Some(json!({ "company": "Initrode", "title": "Staff Engineer" })),
        )
        .await;
        ok(
            &app,
            "POST",
            "/api/postings",
            Some(json!({ "application_id": card["application_id"], "url": "https://jobs.example/x" })),
        )
        .await;
    });
}

#[test]
fn a_version_11_database_takes_the_new_document_kinds() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("hunt.db");
    version_14_db(&path);
    // Back to schema 11: the document table with its old CHECK, holding a
    // document with a version.
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch(
        "PRAGMA foreign_keys = OFF;
         DROP TABLE document;
         CREATE TABLE document (
             id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
             kind TEXT NOT NULL DEFAULT 'resume'
                 CHECK (kind IN ('resume', 'cover-letter', 'portfolio', 'reference', 'other')),
             description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
         INSERT INTO document VALUES (1, 'Resume', 'resume', NULL, 'x', 'x');
         INSERT INTO stored_file VALUES ('abc', x'00');
         INSERT INTO version (id, document_id, number, filename, content_type, size, sha256, created_at, updated_at)
             VALUES (1, 1, 1, 'cv.pdf', 'application/pdf', 1, 'abc', 'x', 'x');
         DROP TABLE posting;
         ALTER TABLE process DROP COLUMN lane_id;
         DROP TABLE lane;
         PRAGMA user_version = 11;",
    )
    .unwrap();
    drop(conn);
    let app = hunt::api::router(Db::open(&path).unwrap());
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let made = ok(
            &app,
            "POST",
            "/api/documents",
            Some(json!({"name": "Acme offer", "kind": "offer"})),
        )
        .await;
        assert_eq!(made["kind"], "offer");
        let versions = ok(&app, "GET", "/api/versions?document_id=1", None).await;
        assert_eq!(
            versions.as_array().unwrap().len(),
            1,
            "the version still belongs to it"
        );
        let (status, _) = call(
            &app,
            "PATCH",
            "/api/documents/1",
            Some(json!({"kind": "photo"})),
        )
        .await;
        assert!(!status.is_success());
    });
}

/// Take-home pay: no longer an experiment, but only for those who live in
/// the UK; with shares and benefits in kind, over the years.
#[tokio::test]
async fn take_home_pay_is_for_uk_residents() {
    // Rates cached for today, so nothing is fetched.
    let db = test_db();
    db.store_rate("EUR", 0.85, "2026-10-06").unwrap();
    db.store_rate("USD", 0.75, "2026-10-06").unwrap();
    // Started as it was, with the experiment named: still starts.
    let on = hunt::api::router_trying(
        db,
        hunt::experiments::Experiments::parse(&["take-home=someone@example.com".into()]).unwrap(),
    );
    assert_eq!(
        ok(&on, "GET", "/api/meta", None).await["experiments"],
        json!([])
    );
    // Only for those who live in the UK (Settings → Location).
    let (status, v) = call(&on, "GET", "/api/take-home", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(v["error"].as_str().unwrap().contains("UK"), "{v}");
    let settings = ok(
        &on,
        "PATCH",
        "/api/settings",
        Some(json!({ "uk_resident": true, "uk_region": "scotland" })),
    )
    .await;
    assert_eq!(settings["uk_resident"], true);
    assert_eq!(settings["uk_region"], "scotland");
    let (status, _) = call(
        &on,
        "PATCH",
        "/api/settings",
        Some(json!({ "uk_region": "wales" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    // The take-home pay wanted, to set results against.
    let settings = ok(
        &on,
        "PATCH",
        "/api/settings",
        Some(json!({ "desired_take_home": 4000, "desired_take_home_per": "month" })),
    )
    .await;
    assert_eq!(settings["desired_take_home"], 4000.0);
    assert_eq!(settings["desired_take_home_per"], "month");
    for bad in [
        json!({ "desired_take_home": -1 }),
        json!({ "desired_take_home": "lots" }),
        json!({ "desired_take_home_per": "fortnight" }),
    ] {
        let (status, _) = call(&on, "PATCH", "/api/settings", Some(bad.clone())).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{bad}");
    }
    let settings = ok(
        &on,
        "PATCH",
        "/api/settings",
        Some(json!({ "desired_take_home": null })),
    )
    .await;
    assert_eq!(settings["desired_take_home"], Value::Null);
    let options = ok(&on, "GET", "/api/take-home", None).await;
    assert!(
        options["years"]
            .as_array()
            .unwrap()
            .iter()
            .any(|y| y["id"] == options["year"])
    );

    // A day rate, inside and outside IR35.
    let r = ok(
        &on,
        "POST",
        "/api/take-home/contract",
        Some(json!({ "day_rate": 500, "year": "2026-27" })),
    )
    .await;
    assert_eq!(r["income"], 115000.0);
    assert_eq!(r["inside"]["take_home"], 68220.95);
    assert_eq!(r["outside"]["take_home"], 72293.19);
    assert_eq!(r["outside"]["corporation_tax"], 23093.04);
    assert_eq!(r["currency"], "GBP");

    // By the week, the same.
    let r = ok(
        &on,
        "POST",
        "/api/take-home/contract",
        Some(json!({ "rate": 2500, "per": "week", "year": "2026-27" })),
    )
    .await;
    assert_eq!(r["income"], 115000.0);
    assert_eq!(r["inside"]["take_home"], 68220.95);

    // Backwards: the rate that leaves what's wanted, either side.
    let r = ok(
        &on,
        "POST",
        "/api/take-home/contract",
        Some(json!({ "take_home": 68220.95, "year": "2026-27" })),
    )
    .await;
    assert_eq!(r["rate"], Value::Null);
    assert_eq!(r["inside"]["rate"], 500.0);
    assert!(r["outside"]["rate"].as_f64().unwrap() < 500.0);
    let r = ok(
        &on,
        "POST",
        "/api/take-home/salary",
        Some(json!({ "take_home": 39519.6, "year": "2026-27" })),
    )
    .await;
    assert_eq!(r["salary"], 50000.0);

    // An offer: $100,000 of RSUs over 4 years, and medical insurance; year
    // by year.
    let offer = ok(
        &on,
        "POST",
        "/api/take-home/salary",
        Some(json!({
            "salary": 80000, "sign_on": 10000, "year": "2026-27",
            "grants": [{ "label": "New hire", "value": 100000, "currency": "USD" }],
            "benefits": { "medical": 1200 },
        })),
    )
    .await;
    assert_eq!(offer["shares"], 18750.0);
    assert_eq!(offer["benefits_in_kind"], 1200.0);
    assert_eq!(offer["projection"].as_array().unwrap().len(), 4);
    assert_eq!(offer["projection"][1]["sign_on"], 0.0);
    assert_eq!(offer["grants"][0]["years"][3], 18750.0);
    let (status, _) = call(
        &on,
        "POST",
        "/api/take-home/salary",
        Some(json!({ "salary": 80000, "grants": [{ "kind": "emi", "value": 1000 }] })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    // With the tax code those figures would give.
    assert_eq!(r["tax_code_advice"]["code"], "1257L");

    // In euros: turned to GBP at the day's rate, which is said.
    let r = ok(
        &on,
        "POST",
        "/api/take-home/salary",
        Some(json!({ "salary": 50000, "currency": "€", "year": "2026-27" })),
    )
    .await;
    assert_eq!(r["currency"], "EUR");
    assert_eq!(r["gbp_rate"], 0.85);
    assert_eq!(r["salary"], 42500.0);
    let r = ok(
        &on,
        "POST",
        "/api/take-home/salary",
        Some(json!({ "take_home": 39519.6 / 0.85, "currency": "EUR", "year": "2026-27" })),
    )
    .await;
    assert_eq!(r["salary"], 50000.0);

    // What can't be worked out is said, as for anything else.
    for body in [
        json!({ "salary": -5 }),
        json!({ "salary": 50000, "year": "1999-00" }),
        json!({ "salary": 50000, "student_loans": ["plan9"] }),
        json!({ "salary": "lots" }),
        json!({}),
        json!({ "salary": 50000, "take_home": 40000 }),
        json!({ "salary": 50000, "currency": "pounds" }),
    ] {
        let (status, v) = call(&on, "POST", "/api/take-home/salary", Some(body.clone())).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}: {v}");
        assert!(v["error"].is_string(), "{body}: {v}");
    }
}

#[tokio::test]
async fn cycles_run_side_by_side_and_an_ended_one_keeps_its_board() {
    let app = app();
    // A new hunt starts with one cycle, running.
    let cycles = ok(&app, "GET", "/api/cycles", None).await;
    assert_eq!(cycles.as_array().unwrap().len(), 1);
    let first = cycles[0]["id"].as_i64().unwrap();
    assert!(cycles[0]["ended_on"].is_null());
    let remote = ok(
        &app,
        "POST",
        "/api/cycles/start",
        Some(json!({ "name": "Remote, Europe" })),
    )
    .await;
    let remote = remote["id"].as_i64().unwrap();

    let acme = ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Acme", "title": "SRE", "cycle_id": first })),
    )
    .await;
    let globex = ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Globex", "cycle_id": first })),
    )
    .await;
    // Without one, the cycle started last.
    let initech = ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Initech" })),
    )
    .await;
    assert_eq!(initech["cycle_id"], remote);

    let board = ok(&app, "GET", "/api/board", None).await;
    assert_eq!(column(&board, "Considering"), ["Acme", "Globex", "Initech"]);
    let board = ok(&app, "GET", &format!("/api/board?cycle={remote}"), None).await;
    assert_eq!(column(&board, "Considering"), ["Initech"]);
    assert_eq!(board["read_only"], false);

    // Reminders and prep for its processes; prep in general.
    ok(
        &app,
        "POST",
        "/api/reminders",
        Some(json!({ "process_id": globex["id"], "title": "chase" })),
    )
    .await;
    let prep = ok(
        &app,
        "POST",
        "/api/prep",
        Some(json!({ "title": "Read their blog", "process_id": globex["id"] })),
    )
    .await;
    let general = ok(
        &app,
        "POST",
        "/api/prep",
        Some(json!({ "title": "Two graph problems", "repeats": "daily" })),
    )
    .await;

    // Ending it with an offer: that process moves to the last stage, its
    // Accepted lane if there is one.
    let offer = stage_id(&board, "Offer");
    let lanes = ok(&app, "GET", &format!("/api/lanes?stage_id={offer}"), None).await;
    let lane = lanes
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["name"] == "Accepted")
        .unwrap()
        .clone();
    let ended = ok(
        &app,
        "POST",
        &format!("/api/cycles/{first}/end"),
        Some(json!({ "outcome": "offer", "process_id": acme["id"], "name": "Autumn" })),
    )
    .await;
    assert_eq!(ended["name"], "Autumn");
    assert_eq!(ended["outcome_note"], "Accepted Acme, SRE");
    assert!(ended["ended_on"].is_string());
    let card = ok(&app, "GET", &format!("/api/processes/{}", acme["id"]), None).await;
    assert_eq!(
        (card["stage_id"].as_i64(), card["lane_id"].as_i64()),
        (Some(offer), lane["id"].as_i64())
    );
    let r = ok(
        &app,
        "GET",
        &format!("/api/reminders?process_id={}", globex["id"]),
        None,
    )
    .await;
    assert!(r[0]["done_at"].is_string(), "its reminders are done");
    assert_eq!(
        ok(&app, "GET", &format!("/api/prep/{}", prep["id"]), None).await["status"],
        "closed"
    );
    assert_eq!(
        ok(&app, "GET", &format!("/api/prep/{}", general["id"]), None).await["status"],
        "todo"
    );

    // Its board is kept, read-only; the running board goes on without it.
    let board = ok(&app, "GET", "/api/board", None).await;
    assert_eq!(column(&board, "Considering"), ["Initech"]);
    let kept = ok(&app, "GET", &format!("/api/board?cycle={first}"), None).await;
    assert_eq!(kept["read_only"], true);
    assert_eq!(column(&kept, "Considering"), ["Globex"]);
    assert_eq!(column(&kept, "Offer"), ["Acme"]);
    for (method, path, body) in [
        (
            "POST",
            format!("/api/processes/{}/move", globex["id"]),
            json!({ "stage_id": offer }),
        ),
        (
            "PATCH",
            format!("/api/processes/{}", globex["id"]),
            json!({ "status": "archived", "archive_reason": "withdrew" }),
        ),
        (
            "POST",
            "/api/processes".to_string(),
            json!({ "company": "Hooli", "cycle_id": first }),
        ),
        (
            "POST",
            format!("/api/cycles/{first}/end"),
            json!({ "outcome": "break" }),
        ),
    ] {
        let (status, v) = call(&app, method, &path, Some(body)).await;
        assert_eq!(
            status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{method} {path}: {v}"
        );
    }
    let (status, v) = call(
        &app,
        "PATCH",
        &format!("/api/cycles/{first}"),
        Some(json!({ "ended_on": "2000-01-01" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert!(
        v["error"]
            .as_str()
            .unwrap()
            .contains("ends before it starts")
    );

    // A new cycle can bring back what was still open, with its application.
    let winter = ok(&app, "POST", "/api/cycles/start",
        Some(json!({ "name": "Winter", "description": "London again", "bring_back": [globex["id"]] }))).await;
    let board = ok(
        &app,
        "GET",
        &format!("/api/board?cycle={}", winter["id"]),
        None,
    )
    .await;
    let back = &board["stages"][0]["cards"][0];
    assert_eq!(back["company"], "Globex");
    assert_eq!(back["application_id"], globex["application_id"]);
    assert_ne!(back["id"], globex["id"]);

    let overview = ok(&app, "GET", "/api/cycles/overview", None).await;
    let autumn = overview
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == first)
        .unwrap();
    assert_eq!(
        autumn["counts"],
        json!({ "active": 2, "archived": 0, "applied": 1, "interviewed": 1, "offers": 1 })
    );
    // Running ones first.
    assert!(overview[0]["ended_on"].is_null());
    assert_eq!(overview.as_array().unwrap().last().unwrap()["id"], first);
}

#[tokio::test]
async fn prep_is_ticked_off_and_gathers_around_interviews() {
    let app = app();
    let p = ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Quillnote" })),
    )
    .await;
    let step = ok(&app, "POST", "/api/steps",
        Some(json!({ "process_id": p["id"], "title": "System design", "at": "2999-01-01T15:00", "minutes": 60,
                     "place": "meet.example/qn", "prep_note": "Queues", "remind": "hour" }))).await;
    assert_eq!(step["remind"], "hour");
    // A step's prep is for its process.
    let read = ok(&app, "POST", "/api/prep", Some(json!({ "title": "Stream processing", "step_id": step["id"], "kind": "read", "priority": "high" }))).await;
    assert_eq!(read["process_id"], p["id"]);
    ok(
        &app,
        "POST",
        "/api/prep",
        Some(json!({ "title": "Mock with Lina", "step_id": step["id"], "kind": "mock" })),
    )
    .await;
    let done = ok(
        &app,
        "POST",
        &format!("/api/prep/{}/tick", read["id"]),
        Some(json!({ "done": true })),
    )
    .await;
    assert_eq!(done["status"], "done");
    let ready = ok(&app, "GET", "/api/prep/ready", None).await;
    assert_eq!(
        (
            ready[0]["title"].as_str(),
            ready[0]["prep"].as_i64(),
            ready[0]["prep_done"].as_i64()
        ),
        (Some("System design"), Some(2), Some(1))
    );

    // A daily one keeps a streak: once a day, and today can be taken back.
    let daily = ok(
        &app,
        "POST",
        "/api/prep",
        Some(json!({ "title": "Two graph problems", "repeats": "daily" })),
    )
    .await;
    let t = ok(
        &app,
        "POST",
        &format!("/api/prep/{}/tick", daily["id"]),
        Some(json!({ "done": true })),
    )
    .await;
    assert_eq!(
        (t["status"].as_str(), t["streak"].as_i64()),
        (Some("todo"), Some(1))
    );
    let t = ok(
        &app,
        "POST",
        &format!("/api/prep/{}/tick", daily["id"]),
        Some(json!({ "done": true })),
    )
    .await;
    assert_eq!(t["streak"], 1);
    let t = ok(
        &app,
        "POST",
        &format!("/api/prep/{}/tick", daily["id"]),
        Some(json!({ "done": false })),
    )
    .await;
    assert_eq!(
        (t["streak"].as_i64(), t["last_done_on"].is_null()),
        (Some(0), true)
    );

    // Links and stories are plain records.
    let link = ok(&app, "POST", "/api/links", Some(json!({ "application_id": p["application_id"], "url": "https://careers.example/portal", "kind": "Candidate portal" }))).await;
    assert_eq!(
        (link["kind"].as_str(), link["label"].as_str()),
        (Some("portal"), Some("https://careers.example/portal"))
    );
    let story = ok(&app, "POST", "/api/stories", Some(json!({ "title": "Cut p99 by 60%", "situation": "Billing timed out", "themes": "Impact" }))).await;
    assert_eq!(story["label"], "Cut p99 by 60%");
}

#[tokio::test]
async fn scripts_and_styles_are_never_served_stale() {
    let app = app();
    let get = |path: &str| {
        let app = app.clone();
        let path = path.to_string();
        async move {
            let res = app
                .oneshot(Request::get(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            let cache = res
                .headers()
                .get("cache-control")
                .map(|v| v.to_str().unwrap().to_string());
            let body = res.into_body().collect().await.unwrap().to_bytes();
            (cache, String::from_utf8_lossy(&body).to_string())
        }
    };
    // The page names this build's assets by a fingerprint of them.
    let (_, page) = get("/app").await;
    let at = page.find("/app.js?v=").expect("app.js is fingerprinted");
    let print: String = page[at + 10..]
        .chars()
        .take_while(|c| c.is_ascii_hexdigit())
        .collect();
    assert_eq!(print.len(), 12, "{print}");
    assert!(page.contains(&format!("/style.css?v={print}")));
    assert!(page.contains(&format!("/vendor/arabesque/js/datepicker.js?v={print}")));
    assert!(page.contains(&format!("/vendor/arabesque/js/sidebar.js?v={print}")));
    // What the sidebar's menu, and the public pages' header, import.
    let (_, menu) = get("/vendor/arabesque/js/nav-menu.js").await;
    assert!(menu.contains("export function wireNavMenu"), "{menu}");
    // Fingerprinted, kept a year; plain, asked about each time.
    let (cache, _) = get(&format!("/app.js?v={print}")).await;
    assert_eq!(
        cache.as_deref(),
        Some("public, max-age=31536000, immutable")
    );
    for path in ["/app.js", "/style.css", "/vendor/arabesque/js/format.js"] {
        let (cache, _) = get(path).await;
        assert_eq!(cache.as_deref(), Some("no-cache"), "{path}");
    }
    // The API keeps its own.
    let (cache, _) = get("/api/meta").await;
    assert_ne!(cache.as_deref(), Some("no-cache"));
}

#[tokio::test]
async fn pages_are_never_served_stale_and_the_api_never_kept() {
    let app = app();
    let cache = |path: &str| {
        let app = app.clone();
        let path = path.to_string();
        async move {
            let res = app
                .oneshot(Request::get(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            res.headers()
                .get("cache-control")
                .map(|v| v.to_str().unwrap().to_string())
        }
    };
    // Pages are asked about each time, so they name this build's assets.
    for path in ["/", "/docs", "/screenshots"] {
        assert_eq!(cache(path).await.as_deref(), Some("no-cache"), "{path}");
    }
    // The app's, in the person's language, only by their own browser.
    for path in ["/app", "/app/", "/app/board"] {
        assert_eq!(
            cache(path).await.as_deref(),
            Some("private, no-cache"),
            "{path}"
        );
    }
    // Someone's data, never kept, not even when it isn't there.
    for path in [
        "/api/meta",
        "/api/board",
        "/api/settings",
        "/api/companies/999999",
    ] {
        assert_eq!(
            cache(path).await.as_deref(),
            Some("private, no-store"),
            "{path}"
        );
    }
    // What says for itself keeps it.
    assert_eq!(
        cache("/fonts/jost.woff2").await.as_deref(),
        Some("public, max-age=31536000, immutable")
    );
}

#[tokio::test]
async fn the_calendar_is_shared_only_while_its_link_is_on() {
    let app = app();
    let fetch = |path: String| {
        let app = app.clone();
        async move {
            let res = app
                .oneshot(Request::get(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            let status = res.status();
            let body = res.into_body().collect().await.unwrap().to_bytes();
            (status, String::from_utf8_lossy(&body).to_string())
        }
    };
    let card = ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Acme" })),
    )
    .await;
    ok(
        &app,
        "POST",
        "/api/steps",
        Some(
            json!({ "process_id": card["id"], "title": "System design", "at": "2999-01-01T10:00" }),
        ),
    )
    .await;
    // Off, until turned on.
    let settings = ok(&app, "GET", "/api/settings", None).await;
    assert!(settings["calendar_feed"].is_null());
    let (status, _) = fetch(format!("/api/calendar/{}.ics", "a".repeat(32))).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // On: a private link anyone with it can subscribe to.
    let on = ok(
        &app,
        "PATCH",
        "/api/settings",
        Some(json!({ "calendar_feed": true })),
    )
    .await;
    let token = on["calendar_feed"].as_str().unwrap().to_string();
    assert_eq!(token.len(), 32);
    let (status, ics) = fetch(format!("/api/calendar/{token}.ics")).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        ics.contains("BEGIN:VCALENDAR") && ics.contains("System design"),
        "{ics}"
    );
    // On again keeps it; a new link replaces it.
    let again = ok(
        &app,
        "PATCH",
        "/api/settings",
        Some(json!({ "calendar_feed": true })),
    )
    .await;
    assert_eq!(again["calendar_feed"], token.as_str());
    let new = ok(
        &app,
        "PATCH",
        "/api/settings",
        Some(json!({ "calendar_feed": "new" })),
    )
    .await;
    let fresh = new["calendar_feed"].as_str().unwrap().to_string();
    assert_ne!(fresh, token);
    assert_eq!(
        fetch(format!("/api/calendar/{token}.ics")).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        fetch(format!("/api/calendar/{fresh}.ics")).await.0,
        StatusCode::OK
    );
    // Off: the link stops working.
    ok(
        &app,
        "PATCH",
        "/api/settings",
        Some(json!({ "calendar_feed": false })),
    )
    .await;
    assert_eq!(
        fetch(format!("/api/calendar/{fresh}.ics")).await.0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn an_ended_cycle_can_be_resumed() {
    let app = app();
    let card = ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Acme" })),
    )
    .await;
    let cycle = card["cycle_id"].as_i64().unwrap();
    ok(
        &app,
        "POST",
        &format!("/api/cycles/{cycle}/end"),
        Some(json!({ "outcome": "break" })),
    )
    .await;
    // Ended: its board can't change.
    let (status, err) = call(
        &app,
        "PATCH",
        &format!("/api/processes/{}", card["id"]),
        Some(json!({ "note": "Engineer" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(err.to_string().contains("ended"), "{err}");
    let resumed = ok(&app, "POST", &format!("/api/cycles/{cycle}/resume"), None).await;
    assert!(
        resumed["ended_on"].is_null()
            && resumed["outcome"].is_null()
            && resumed["outcome_note"].is_null()
    );
    // Running again: it can.
    ok(
        &app,
        "PATCH",
        &format!("/api/processes/{}", card["id"]),
        Some(json!({ "note": "Engineer" })),
    )
    .await;
    // A running cycle can't be resumed.
    let (status, _) = call(&app, "POST", &format!("/api/cycles/{cycle}/resume"), None).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

/// A new hunt's inactive stages.
const CLOSED: [&str; 3] = ["My Decision", "Their Decision", "Paused / Stopped"];

#[tokio::test]
async fn a_new_hunt_starts_with_the_job_seekers_lanes_and_endings() {
    let app = app();
    let stages = ok(&app, "GET", "/api/stages", None).await;
    let lanes = ok(&app, "GET", "/api/lanes", None).await;
    let stage_of = |id: &Value| {
        stages
            .as_array()
            .unwrap()
            .iter()
            .find(|s| &s["id"] == id)
            .unwrap()["name"]
            .as_str()
            .unwrap()
            .to_string()
    };
    let got: Vec<(String, String)> = lanes
        .as_array()
        .unwrap()
        .iter()
        .map(|l| (stage_of(&l["stage_id"]), l["name"].as_str().unwrap().into()))
        .filter(|(stage, _)| !CLOSED.contains(&stage.as_str()))
        .collect();
    assert_eq!(
        got,
        [
            ("Considering".into(), "Preparing".into()),
            ("Interviewing".into(), "Waiting on a decision".into()),
            ("Offer".into(), "Accepted".into()),
        ]
    );
    // The endings are the lanes of the inactive stages, after the board's.
    let last: Vec<(Value, Value)> = stages.as_array().unwrap()[5..]
        .iter()
        .map(|s| (s["name"].clone(), s["active"].clone()))
        .collect();
    assert_eq!(last, CLOSED.map(|n| (json!(n), json!(0))));
    // Their cards start folded into packs; the board's, unfolded.
    let folded: Vec<Value> = stages
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["folded"].clone())
        .collect();
    assert_eq!(folded, [0, 0, 0, 0, 0, 1, 1, 1].map(|f| json!(f)));
    let first = &stages[0]["id"];
    let stage = ok(
        &app,
        "PATCH",
        &format!("/api/stages/{first}"),
        Some(json!({ "folded": 5 })),
    )
    .await;
    assert_eq!(stage["folded"], 1, "a yes or a no");

    // The board's swimlanes: the active stages in the first, the terminal
    // ones in the second.
    let board = ok(&app, "GET", "/api/board", None).await;
    let lanes: Vec<Value> = board["swimlanes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|w| w["name"].clone())
        .collect();
    assert_eq!(
        lanes,
        [json!("Active Processes"), json!("Terminated Processes")]
    );
    let (active, terminated) = (
        board["swimlanes"][0]["id"].clone(),
        board["swimlanes"][1]["id"].clone(),
    );
    assert!(
        board["stages"]
            .as_array()
            .unwrap()
            .iter()
            .all(|st| st["swimlane_id"] == active)
    );
    assert!(
        board["closed_stages"]
            .as_array()
            .unwrap()
            .iter()
            .all(|st| st["swimlane_id"] == terminated)
    );
    // A new stage goes in the first, unless it's said which.
    let new = ok(
        &app,
        "POST",
        "/api/stages",
        Some(json!({ "name": "Take-home" })),
    )
    .await;
    assert_eq!(new["swimlane_id"], active);
    let held = ok(
        &app,
        "POST",
        "/api/swimlanes",
        Some(json!({ "name": "On hold" })),
    )
    .await;
    assert_eq!(held["position"], 2);
    // Open on the board unless it says it's folded: a yes or a no.
    assert_eq!(held["folded"], 0);
    let folded = ok(
        &app,
        "PATCH",
        &format!("/api/swimlanes/{}", held["id"]),
        Some(json!({ "folded": 7 })),
    )
    .await;
    assert_eq!(folded["folded"], 1);
    // A sub stage's cards start as its stage's do, until it says.
    let lane = ok(
        &app,
        "POST",
        "/api/lanes",
        Some(json!({ "stage_id": new["id"], "name": "Waiting" })),
    )
    .await;
    assert_eq!(lane["folded"], Value::Null);
    let lane = ok(
        &app,
        "PATCH",
        &format!("/api/lanes/{}", lane["id"]),
        Some(json!({ "folded": 3 })),
    )
    .await;
    assert_eq!(lane["folded"], 1);
    let lane = ok(
        &app,
        "PATCH",
        &format!("/api/lanes/{}", lane["id"]),
        Some(json!({ "folded": null })),
    )
    .await;
    assert_eq!(lane["folded"], Value::Null, "as its stage again");
    let (status, _) = call(
        &app,
        "PATCH",
        &format!("/api/stages/{}", new["id"]),
        Some(json!({ "folded": null })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "a stage says");
    let moved = ok(
        &app,
        "PATCH",
        &format!("/api/stages/{}", new["id"]),
        Some(json!({ "swimlane_id": held["id"] })),
    )
    .await;
    assert_eq!(moved["swimlane_id"], held["id"]);
    let order = ok(
        &app,
        "POST",
        "/api/swimlanes/order",
        Some(json!({ "ids": [held["id"], active, terminated] })),
    )
    .await;
    assert_eq!(order[0]["name"], "On hold");
    let (status, _) = call(
        &app,
        "POST",
        "/api/swimlanes/order",
        Some(json!({ "ids": [held["id"]] })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "every one, once");
    // Gone, its stages are in none (the first, on the board).
    ok(
        &app,
        "DELETE",
        &format!("/api/swimlanes/{}", held["id"]),
        None,
    )
    .await;
    let st = ok(&app, "GET", &format!("/api/stages/{}", new["id"]), None).await;
    assert_eq!(st["swimlane_id"], Value::Null);
    let meta = ok(&app, "GET", "/api/meta", None).await;
    let reasons: Vec<&str> = meta["archive_reasons"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["value"].as_str().unwrap())
        .collect();
    // Every ending, and a pause; starting the job is the success.
    for r in [
        "paused",
        "offer-expired",
        "failed-checks",
        "rescinded",
        "reneged",
        "accepted",
    ] {
        assert!(reasons.contains(&r), "{r} in {reasons:?}");
    }
    let accepted = meta["archive_reasons"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["value"] == "accepted")
        .unwrap();
    assert_eq!(accepted["label"], "I started the job");
}

#[tokio::test]
async fn a_stage_has_a_default_sub_stage() {
    let app = app();
    let stage = ok(&app, "POST", "/api/stages", Some(json!({ "name": "Loop" }))).await;
    let lane = |name: &'static str| {
        let app = app.clone();
        let stage = stage["id"].clone();
        async move {
            ok(
                &app,
                "POST",
                "/api/lanes",
                Some(json!({ "stage_id": stage, "name": name })),
            )
            .await
        }
    };
    let (phone, onsite) = (lane("Phone").await, lane("Onsite").await);
    assert_eq!(phone["is_default"], 0);
    // One a stage: the last said.
    for l in [&onsite, &phone] {
        ok(
            &app,
            "PATCH",
            &format!("/api/lanes/{}", l["id"]),
            Some(json!({ "is_default": 1 })),
        )
        .await;
    }
    let onsite = ok(&app, "GET", &format!("/api/lanes/{}", onsite["id"]), None).await;
    assert_eq!(onsite["is_default"], 0);

    // Into the stage with no lane said: its default; to its top when said.
    let p = ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Acme", "title": "SRE", "stage_id": stage["id"] })),
    )
    .await;
    assert_eq!(p["lane_id"], phone["id"], "a new one");
    let other = ok(
        &app,
        "POST",
        "/api/processes",
        Some(json!({ "company": "Globex", "title": "SRE" })),
    )
    .await;
    let moved = ok(
        &app,
        "POST",
        &format!("/api/processes/{}/move", other["id"]),
        Some(json!({ "stage_id": stage["id"] })),
    )
    .await;
    assert_eq!(moved["lane_id"], phone["id"], "moved in");
    let first = moved["stage_id"].clone();
    ok(
        &app,
        "POST",
        &format!("/api/processes/{}/move", other["id"]),
        Some(json!({ "stage_id": 1 })),
    )
    .await;
    let top = ok(
        &app,
        "POST",
        &format!("/api/processes/{}/move", other["id"]),
        Some(json!({ "stage_id": first, "top": true })),
    )
    .await;
    assert_eq!(top["lane_id"], Value::Null, "to its top");
    let patched = ok(
        &app,
        "PATCH",
        &format!("/api/processes/{}", other["id"]),
        Some(json!({ "stage_id": 1 })),
    )
    .await;
    assert_eq!(patched["lane_id"], Value::Null, "a stage with none");
}
