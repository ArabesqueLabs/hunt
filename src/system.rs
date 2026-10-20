//! What hunt uses of the machine it runs on, for the Stats page: its
//! memory and CPU, the container's limits (on Linux, from cgroups), the
//! database's size and the disk it's on. Anything that can't be read here
//! (another OS, no cgroup, a database elsewhere) is left out.
//!
//! How long the service has been up counts across restarts and rollouts:
//! the database keeps when it came up, and a heartbeat each minute. A start
//! that finds a heartbeat less than [`ROLLOUT_GAP`] old carries on from it
//! (a new version rolled out, or the pod moved); after a longer gap, it was
//! down, and the count starts again.

use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use serde_json::{Value, json};

use crate::Db;
use crate::error::Result;
use crate::store::Dialect;

static STARTED: OnceLock<Instant> = OnceLock::new();
/// The longest a restart can take and still count as the service staying up.
pub const ROLLOUT_GAP: u64 = 15 * 60;
const UP_SINCE: &str = "system.up_since";
const SEEN_AT: &str = "system.seen_at";
const STARTS: &str = "system.starts";
/// The last CPU reading (when, and CPU seconds used by then), for CPU in
/// use since then.
static LAST_CPU: Mutex<Option<(Instant, f64)>> = Mutex::new(None);

/// Note when hunt started, for its uptime.
pub fn mark_started() {
    STARTED.get_or_init(Instant::now);
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

impl Db {
    /// At start: carry on the service's uptime from before a restart or
    /// rollout, or start it again after it was down.
    pub fn note_start(&self) -> Result<()> {
        let now = unix_now();
        let read =
            |key| -> Result<Option<u64>> { Ok(self.setting(key)?.and_then(|v| v.parse().ok())) };
        let recent = read(SEEN_AT)?.is_some_and(|seen| now.saturating_sub(seen) <= ROLLOUT_GAP);
        match read(UP_SINCE)? {
            Some(_) if recent => {
                let starts = read(STARTS)?.unwrap_or(1) + 1;
                self.set_setting(STARTS, Some(&starts.to_string()))?;
            }
            _ => {
                self.set_setting(UP_SINCE, Some(&now.to_string()))?;
                self.set_setting(STARTS, Some("1"))?;
            }
        }
        self.note_alive()
    }

    /// The heartbeat: still up now.
    pub fn note_alive(&self) -> Result<()> {
        self.set_setting(SEEN_AT, Some(&unix_now().to_string()))
    }

    /// How long the service has been up (across rollouts), and how many
    /// times it has started in that time.
    fn service_uptime(&self, process: f64) -> Result<(f64, u64)> {
        let since: Option<u64> = self.setting(UP_SINCE)?.and_then(|v| v.parse().ok());
        let starts = self
            .setting(STARTS)?
            .and_then(|v| v.parse().ok())
            .unwrap_or(1);
        Ok(match since {
            Some(s) => ((unix_now().saturating_sub(s) as f64).max(process), starts),
            None => (process, 1),
        })
    }

    pub fn system(&self) -> Result<Value> {
        let uptime = STARTED.get_or_init(Instant::now).elapsed().as_secs_f64();
        let (service_uptime, starts) = self.service_uptime(uptime)?;
        let usage = rusage();
        let cpu_seconds = usage.map(|u| u.0);
        // CPU in use: since the last reading, or on average since it started.
        let now = Instant::now();
        let cpu_recent = cpu_seconds.and_then(|used| {
            let mut last = LAST_CPU.lock().unwrap_or_else(|e| e.into_inner());
            let recent = last
                .filter(|(at, _)| now.duration_since(*at).as_secs_f64() >= 1.0)
                .map(|(at, before)| (used - before) / now.duration_since(at).as_secs_f64());
            if recent.is_some() || last.is_none() {
                *last = Some((now, used));
            }
            recent
        });
        Ok(json!({
            "hunt": {
                "version": env!("CARGO_PKG_VERSION"),
                "pid": std::process::id(),
                "uptime_seconds": uptime,
                "service_uptime_seconds": service_uptime,
                "starts": starts,
                "os": std::env::consts::OS,
                "arch": std::env::consts::ARCH,
            },
            "memory": {
                "rss": current_rss(),
                "peak": usage.map(|u| u.1),
                "limit": cgroup_bytes("memory.max"),
                "container": cgroup_bytes("memory.current"),
            },
            "cpu": {
                "seconds": cpu_seconds,
                "average": cpu_seconds.filter(|_| uptime > 0.0).map(|s| s / uptime),
                "recent": cpu_recent,
                "limit": cgroup_cpus(),
                "cpus": std::thread::available_parallelism().ok().map(|n| n.get()),
                "load": load_average(),
            },
            "database": self.storage()?,
        }))
    }

    /// The database: its kind, size, stored files, rows, and (for a SQLite
    /// file) the disk it's on.
    fn storage(&self) -> Result<Value> {
        let dialect = self.dialect();
        let (path, size) = match dialect {
            Dialect::Sqlite => {
                let conn = self
                    .store
                    .sqlite()
                    .expect("a SQLite store has a connection");
                let path = conn.path().filter(|p| !p.is_empty()).map(String::from);
                let pages = self.int("PRAGMA page_count", &[])?;
                let page = self.int("PRAGMA page_size", &[])?;
                // The write-ahead log is part of it too, until it's checkpointed.
                let wal = path
                    .as_ref()
                    .and_then(|p| std::fs::metadata(format!("{p}-wal")).ok())
                    .map_or(0, |m| m.len() as i64);
                (path, Some(pages * page + wal))
            }
            Dialect::Postgres => (
                None,
                Some(self.int("SELECT pg_database_size(current_database())", &[])?),
            ),
            Dialect::Mysql => (
                None,
                Some(self.int(
                    "SELECT coalesce(sum(data_length + index_length), 0) \
                     FROM information_schema.tables WHERE table_schema = database()",
                    &[],
                )?),
            ),
        };
        let files = self.int("SELECT count(*) FROM stored_file", &[])?;
        let file_bytes = self.int(
            "SELECT coalesce(sum(length(data)), 0) FROM stored_file",
            &[],
        )?;
        let mut rows = serde_json::Map::new();
        for table in crate::backup::TABLES {
            rows.insert(
                table.to_string(),
                json!(self.int(&format!("SELECT count(*) FROM {table}"), &[])?),
            );
        }
        let disk = path
            .as_deref()
            .and_then(|p| std::path::Path::new(p).parent())
            .and_then(disk_space);
        Ok(json!({
            "kind": match dialect { Dialect::Sqlite => "SQLite", Dialect::Postgres => "PostgreSQL", Dialect::Mysql => "MySQL" },
            "path": path,
            "size": size,
            "files": files,
            "file_bytes": file_bytes,
            "rows": rows,
            "disk": disk,
        }))
    }
}

/// CPU seconds used (user and system), and the most memory hunt has held.
fn rusage() -> Option<(f64, u64)> {
    #[cfg(unix)]
    {
        // SAFETY: getrusage only writes into the struct it's given.
        let mut u: libc::rusage = unsafe { std::mem::zeroed() };
        if unsafe { libc::getrusage(libc::RUSAGE_SELF, &mut u) } != 0 {
            return None;
        }
        let secs = |t: libc::timeval| t.tv_sec as f64 + t.tv_usec as f64 / 1e6;
        // ru_maxrss is in kilobytes on Linux, bytes on macOS.
        let peak = if cfg!(target_os = "macos") {
            u.ru_maxrss as u64
        } else {
            u.ru_maxrss as u64 * 1024
        };
        Some((secs(u.ru_utime) + secs(u.ru_stime), peak))
    }
    #[cfg(not(unix))]
    None
}

/// The memory hunt holds now (Linux only).
fn current_rss() -> Option<u64> {
    let statm = std::fs::read_to_string("/proc/self/statm").ok()?;
    let pages: u64 = statm.split_whitespace().nth(1)?.parse().ok()?;
    #[cfg(unix)]
    {
        // SAFETY: sysconf has no side effects.
        let page = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
        (page > 0).then(|| pages * page as u64)
    }
    #[cfg(not(unix))]
    None
}

/// A number of bytes from a cgroup (v2) file; none when it says "max".
fn cgroup_bytes(file: &str) -> Option<u64> {
    std::fs::read_to_string(format!("/sys/fs/cgroup/{file}"))
        .ok()?
        .trim()
        .parse()
        .ok()
}

/// The CPUs the container may use, from cgroup's cpu.max ("quota period").
fn cgroup_cpus() -> Option<f64> {
    let max = std::fs::read_to_string("/sys/fs/cgroup/cpu.max").ok()?;
    let mut parts = max.split_whitespace();
    let quota: f64 = parts.next()?.parse().ok()?;
    let period: f64 = parts.next()?.parse().ok()?;
    (period > 0.0).then(|| quota / period)
}

/// The machine's load over 1, 5 and 15 minutes.
fn load_average() -> Option<[f64; 3]> {
    #[cfg(unix)]
    {
        let mut l = [0.0f64; 3];
        // SAFETY: getloadavg writes at most 3 numbers into l.
        (unsafe { libc::getloadavg(l.as_mut_ptr(), 3) } == 3).then_some(l)
    }
    #[cfg(not(unix))]
    None
}

/// The size of the filesystem holding `dir`, and how much is free.
fn disk_space(dir: &std::path::Path) -> Option<Value> {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        let dir = if dir.as_os_str().is_empty() {
            std::path::Path::new(".")
        } else {
            dir
        };
        let c = std::ffi::CString::new(dir.as_os_str().as_bytes()).ok()?;
        // SAFETY: statvfs only writes into the struct it's given.
        let mut s: libc::statvfs = unsafe { std::mem::zeroed() };
        if unsafe { libc::statvfs(c.as_ptr(), &mut s) } != 0 {
            return None;
        }
        let unit = s.f_frsize as u64;
        Some(json!({
            "total": s.f_blocks as u64 * unit,
            "free": s.f_bavail as u64 * unit,
        }))
    }
    #[cfg(not(unix))]
    None
}
