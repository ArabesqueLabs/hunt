//! A client for the API, as the CLI uses it.

use anyhow::{Context, Result, anyhow, bail};
use serde_json::Value;
use ureq::Agent;

pub const DEFAULT_URL: &str = "http://127.0.0.1:4848";

/// A Cloudflare Access service token, for a hunt behind Access: its client
/// id and secret, from these variables.
const ACCESS_ID_VAR: &str = "HUNT_ACCESS_CLIENT_ID";
const ACCESS_SECRET_VAR: &str = "HUNT_ACCESS_CLIENT_SECRET";

pub struct Client {
    base: String,
    agent: Agent,
    access: Option<(String, String)>,
}

impl Client {
    pub fn new(base: &str) -> Client {
        let agent: Agent = Agent::config_builder()
            .http_status_as_error(false)
            .build()
            .into();
        let access = match (
            std::env::var(ACCESS_ID_VAR),
            std::env::var(ACCESS_SECRET_VAR),
        ) {
            (Ok(id), Ok(secret)) if !id.is_empty() && !secret.is_empty() => Some((id, secret)),
            _ => None,
        };
        Client {
            base: base.trim_end_matches('/').to_string(),
            agent,
            access,
        }
    }

    /// A request to the API, with the service token if there is one.
    fn with_access<B>(&self, req: ureq::RequestBuilder<B>) -> ureq::RequestBuilder<B> {
        match &self.access {
            Some((id, secret)) => req
                .header("CF-Access-Client-Id", id.as_str())
                .header("CF-Access-Client-Secret", secret.as_str()),
            None => req,
        }
    }

    pub fn get(&self, path: &str, query: &[(&str, &str)]) -> Result<Value> {
        let mut req = self.with_access(self.agent.get(&self.url(path)));
        for (k, v) in query {
            req = req.query(*k, *v);
        }
        self.finish(path, req.call())
    }

    pub fn post(&self, path: &str, body: &Value) -> Result<Value> {
        let req = self.with_access(self.agent.post(&self.url(path)));
        self.finish(path, req.send_json(body))
    }

    pub fn patch(&self, path: &str, body: &Value) -> Result<Value> {
        let req = self.with_access(self.agent.patch(&self.url(path)));
        self.finish(path, req.send_json(body))
    }

    pub fn put(&self, path: &str, body: &Value) -> Result<Value> {
        let req = self.with_access(self.agent.put(&self.url(path)));
        self.finish(path, req.send_json(body))
    }

    pub fn delete(&self, path: &str, query: &[(&str, &str)]) -> Result<Value> {
        let mut req = self.with_access(self.agent.delete(&self.url(path)));
        for (k, v) in query {
            req = req.query(*k, *v);
        }
        self.finish(path, req.call())
    }

    /// Send a file as the request body.
    pub fn post_bytes(
        &self,
        path: &str,
        query: &[(&str, &str)],
        content_type: &str,
        data: &[u8],
    ) -> Result<Value> {
        let mut req = self
            .with_access(self.agent.post(&self.url(path)))
            .header("Content-Type", content_type);
        for (k, v) in query {
            req = req.query(*k, *v);
        }
        self.finish(path, req.send(data))
    }

    /// Fetch a file: its bytes, and the name the service gives it.
    pub fn get_bytes(&self, path: &str) -> Result<(Vec<u8>, Option<String>)> {
        let mut res = self
            .with_access(self.agent.get(&self.url(path)))
            .call()
            .map_err(|e| self.unreachable(e))?;
        self.not_a_login_page(&res)?;
        if !res.status().is_success() {
            let body: Value = res.body_mut().read_json().unwrap_or(Value::Null);
            match body.get("error").and_then(Value::as_str) {
                Some(msg) => bail!("{msg}"),
                None => bail!("{path}: {}", res.status()),
            }
        }
        let name = res
            .headers()
            .get("content-disposition")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split("filename=\"").nth(1))
            .and_then(|v| v.split('"').next())
            .map(String::from);
        let data = res
            .body_mut()
            .with_config()
            .limit(crate::files::MAX_FILE as u64 + 1)
            .read_to_vec()?;
        Ok((data, name))
    }

    fn unreachable(&self, e: ureq::Error) -> anyhow::Error {
        match e {
            ureq::Error::Io(_) | ureq::Error::ConnectionFailed | ureq::Error::HostNotFound => {
                anyhow!(
                    "can't reach hunt at {}. Start it with `hunt serve`, or point --url at it.",
                    self.base
                )
            }
            e => anyhow!(e),
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}/api/{}", self.base, path.trim_start_matches('/'))
    }

    /// hunt's API answers in JSON (or a file); a web page instead comes from
    /// something in front of it: a sign-in page, such as Cloudflare Access's,
    /// or an error page when hunt can't be reached behind it.
    fn not_a_login_page(&self, res: &ureq::http::Response<ureq::Body>) -> Result<()> {
        let html = res
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.starts_with("text/html"));
        if !html {
            return Ok(());
        }
        let status = res.status();
        if status.is_server_error() {
            bail!(
                "{} answered {status} with a web page, not hunt: whatever is in front of it \
                 (such as a Cloudflare Tunnel) couldn't reach hunt",
                self.base
            );
        }
        if self.access.is_some() {
            bail!(
                "{} asked for a sign-in: the service token in {ACCESS_ID_VAR} and \
                 {ACCESS_SECRET_VAR} wasn't accepted",
                self.base
            );
        }
        bail!(
            "{} asked for a sign-in. Behind Cloudflare Access, set {ACCESS_ID_VAR} and \
             {ACCESS_SECRET_VAR} to a service token's id and secret.",
            self.base
        )
    }

    fn finish(
        &self,
        path: &str,
        res: Result<ureq::http::Response<ureq::Body>, ureq::Error>,
    ) -> Result<Value> {
        let mut res = res.map_err(|e| self.unreachable(e))?;
        self.not_a_login_page(&res)?;
        let status = res.status();
        let body: Value = res
            .body_mut()
            .read_json()
            .with_context(|| format!("reading the answer to {path}"))?;
        if !status.is_success() {
            match body.get("error").and_then(Value::as_str) {
                Some(msg) => bail!("{msg}"),
                None => bail!("{path}: {status}"),
            }
        }
        Ok(body)
    }
}
