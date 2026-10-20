//! The `hunt` binary, end to end, against a live service.

use std::process::Command;

use hunt::Db;

/// Serve a fresh in-memory database on a free port; returns its URL.
fn serve() -> String {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    listener.set_nonblocking(true).unwrap();
    std::thread::spawn(move || {
        tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(async move {
                let listener = tokio::net::TcpListener::from_std(listener).unwrap();
                axum::serve(listener, hunt::api::router(Db::open_in_memory().unwrap()))
                    .await
                    .unwrap();
            });
    });
    url
}

fn hunt(url: &str, args: &[&str]) -> (bool, String) {
    let out = Command::new(env!("CARGO_BIN_EXE_hunt"))
        .args(args)
        .env("HUNT_URL", url)
        .output()
        .unwrap();
    let text =
        String::from_utf8_lossy(&out.stdout).to_string() + &String::from_utf8_lossy(&out.stderr);
    (out.status.success(), text)
}

#[test]
fn the_cli_works_through_the_api() {
    let url = serve();
    let run = |args: &[&str]| {
        let (ok, out) = hunt(&url, args);
        assert!(ok, "hunt {args:?}: {out}");
        out
    };
    run(&[
        "add",
        "Acme",
        "-r",
        "Staff Engineer",
        "-s",
        "applied",
        "--applied",
        "-3d",
        "--next",
        "chase",
        "--due",
        "fri",
    ]);
    run(&["add", "Globex", "--source", "referral"]);
    run(&["move", "globex", "interviewing"]);
    run(&["step", "globex", "onsite", "--at", "2026-11-02 10:00"]);
    run(&["person", "globex", "Pat Chen", "--role", "recruiter"]);
    run(&["note", "acme", "they asked for references"]);
    run(&["archive", "acme", "role-filled", "-n", "internal hire"]);
    run(&[
        "edit",
        "applications",
        "2",
        "location=London",
        "salary_min=150k",
        "company_id=globex",
    ]);

    let board = run(&["board"]);
    assert!(
        board.contains("Interviewing (1)\n  #2    Globex  [onsite 2026-11-02 10:00]"),
        "{board}"
    );
    assert!(
        board.contains(
            "Closed (1)\n  #1    Acme — Staff Engineer  (Role filled, got to Applied: internal hire)"
        ),
        "{board}"
    );

    let show = run(&["show", "globex"]);
    assert!(show.contains("Pat Chen recruiter"), "{show}");
    assert!(show.contains("location  London"), "{show}");

    let log = run(&["log", "applications", "2"]);
    assert!(log.contains("location: — → London"), "{log}");

    // Mistakes come back as the service's explanation.
    let (ok, out) = hunt(&url, &["archive", "globex", "bored"]);
    assert!(!ok);
    assert!(out.contains("isn't one of withdrew, declined"), "{out}");
    let (ok, out) = hunt(&url, &["move", "nobody", "applied"]);
    assert!(!ok);
    assert!(out.contains("no processes match"), "{out}");
}

#[test]
fn without_a_service_it_says_how_to_start_one() {
    let (ok, out) = hunt("http://127.0.0.1:9", &["board"]);
    assert!(!ok);
    assert!(out.contains("hunt serve"), "{out}");
}

#[test]
fn files_go_up_and_come_back() {
    let url = serve();
    let dir = tempfile::tempdir().unwrap();
    let cv = dir.path().join("cv.pdf");
    std::fs::write(&cv, b"%PDF the first").unwrap();
    let run = |args: &[&str]| {
        let (ok, out) = hunt(&url, args);
        assert!(ok, "hunt {args:?}: {out}");
        out
    };
    let out = run(&["upload", "Resume", cv.to_str().unwrap(), "--tag", "general"]);
    assert!(out.contains("added document #1 Resume"), "{out}");
    assert!(out.contains("Resume v1 (general)"), "{out}");
    std::fs::write(&cv, b"%PDF the second").unwrap();
    run(&["upload", "resume", cv.to_str().unwrap()]);

    run(&["add", "Acme", "-r", "SRE"]);
    let out = run(&["attach", "acme", "resume", "--version", "1"]);
    assert!(out.contains("Resume v1 (general)  cv.pdf"), "{out}");
    let show = run(&["show", "acme"]);
    assert!(
        show.contains("files sent\n  #1    Resume v1 (general)  cv.pdf"),
        "{show}"
    );

    let saved = dir.path().join("back.pdf");
    run(&["download", "2", "-o", saved.to_str().unwrap()]);
    assert_eq!(std::fs::read(&saved).unwrap(), b"%PDF the second");
    let (ok, out) = hunt(&url, &["download", "2", "-o", saved.to_str().unwrap()]);
    assert!(!ok, "won't overwrite");
    assert!(out.contains("already exists"), "{out}");
}

#[test]
fn a_posting_link_fills_in_a_new_process() {
    let url = serve();
    // A careers page to read, served from a thread.
    let site = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let page = format!("http://{}/job", site.local_addr().unwrap());
    site.set_nonblocking(true).unwrap();
    std::thread::spawn(move || {
        tokio::runtime::Runtime::new().unwrap().block_on(async move {
            let app = axum::Router::new().route(
                "/job",
                axum::routing::get(|| async {
                    axum::response::Html(
                        r#"<script type="application/ld+json">{"@type":"JobPosting","title":"Platform Engineer",
                        "hiringOrganization":{"name":"Hooli"},"jobLocationType":"TELECOMMUTE"}</script>"#,
                    )
                }),
            );
            let listener = tokio::net::TcpListener::from_std(site).unwrap();
            axum::serve(listener, app).await.unwrap();
        });
    });
    let (ok, out) = hunt(&url, &["add", "--link", &page, "-s", "applied"]);
    assert!(ok, "{out}");
    assert!(out.contains("added #1 Hooli — Platform Engineer"), "{out}");
    let (_, show) = hunt(&url, &["show", "hooli"]);
    assert!(show.contains("mode      remote"), "{show}");
    assert!(show.contains(&format!("posting   {page}")), "{show}");

    // The same posting again: a warning, and it's still added.
    let (ok, out) = hunt(&url, &["add", "--link", &format!("{page}?utm_source=x")]);
    assert!(ok, "{out}");
    assert!(
        out.contains("warning: this posting is already tracked as application #1 Hooli — Platform Engineer (#1 active in Applied)"),
        "{out}"
    );

    let (ok, out) = hunt(&url, &["add"]);
    assert!(!ok);
    assert!(out.contains("which company?"), "{out}");
}
