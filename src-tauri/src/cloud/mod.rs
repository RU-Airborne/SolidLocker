//! Everything SolidLocker can do without a git binary.
//!
//! iOS forbids spawning a process, so there is no git to drive and no clone
//! to drive it against. What survives is the part that was always a network
//! call: Git LFS locking, branches, commits and merge requests are all plain
//! HTTPS.

pub mod auth;
pub mod commands;
pub mod gh;
pub mod locks;
pub mod objects;

use crate::error::{AppError, AppResult};
pub use crate::ghapi::{net, Api};

impl Api {
    /// For the sign-in and project-picking screens, before a project exists.
    pub fn tokenless_repo(token: impl Into<String>) -> AppResult<Self> {
        Self::new(String::new(), token, String::new())
    }

    pub fn url(&self, path: &str) -> String {
        format!("https://api.github.com{path}")
    }

    pub fn repo_url(&self, path: &str) -> String {
        format!("https://api.github.com/repos/{}{path}", self.slug)
    }

    fn signed(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        req.bearer_auth(&self.token)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
    }

    pub fn get(&self, url: &str) -> reqwest::RequestBuilder {
        self.signed(self.http.get(url))
    }

    pub fn post(&self, url: &str) -> reqwest::RequestBuilder {
        self.signed(self.http.post(url))
    }

    /// Turns GitHub error shapes into something a member can act on.
    pub async fn read_json(resp: reqwest::Response) -> AppResult<serde_json::Value> {
        let status = resp.status();
        if status.is_success() {
            return resp.json().await.map_err(|e| {
                AppError::new("GITHUB", format!("GitHub sent something unreadable: {e}"))
            });
        }
        let body = resp.text().await.unwrap_or_default();
        Err(github_error(status, &body))
    }

    pub async fn get_json(&self, url: &str) -> AppResult<serde_json::Value> {
        let resp = self.get(url).send().await.map_err(net)?;
        Self::read_json(resp).await
    }
}

/// The useful part of a GitHub error is usually in the errors list, not the
/// message, which is often just the status name repeated back.
pub fn github_error(status: reqwest::StatusCode, body: &str) -> AppError {
    let parsed = serde_json::from_str::<serde_json::Value>(body).ok();
    let message = parsed
        .as_ref()
        .and_then(|v| v.get("message"))
        .and_then(|m| m.as_str())
        .unwrap_or_default()
        .to_string();
    let detail = parsed
        .as_ref()
        .and_then(|v| v.get("errors"))
        .and_then(|e| e.as_array())
        .map(|errs| {
            errs.iter()
                .filter_map(|e| {
                    e.get("message")
                        .and_then(|m| m.as_str())
                        .map(str::to_string)
                        .or_else(|| e.as_str().map(str::to_string))
                })
                .collect::<Vec<_>>()
                .join("; ")
        })
        .filter(|s| !s.is_empty());

    let said = match detail {
        Some(d) if !message.is_empty() => format!("{message}: {d}"),
        Some(d) => d,
        None if !message.is_empty() => message,
        None => status.to_string(),
    };

    match status.as_u16() {
        401 => AppError::new(
            "AUTH",
            format!("GitHub would not accept the sign in ({said}). Signing in again usually fixes it."),
        ),
        403 if said.to_lowercase().contains("rate limit") => AppError::new(
            "RATE",
            "GitHub is rate limiting this account. Try again in a few minutes.",
        ),
        403 => AppError::new(
            "PERMISSION",
            format!("Your account is not allowed to do that ({said})."),
        ),
        404 => AppError::new(
            "MISSING",
            format!("GitHub could not find that ({said}). It may be private, renamed, or gone."),
        ),
        409 => AppError::new("CONFLICT", said),
        422 => AppError::new("REJECTED", said),
        _ => AppError::new("GITHUB", said),
    }
}

/// Follows the Link header so a long list is not cut off at the first page.
pub async fn paged(api: &Api, first: &str, cap: usize) -> AppResult<Vec<serde_json::Value>> {
    let mut out = Vec::new();
    let mut url = first.to_string();
    for _ in 0..20 {
        let resp = api.get(&url).send().await.map_err(net)?;
        let next = next_link(resp.headers());
        match Api::read_json(resp).await? {
            serde_json::Value::Array(items) => out.extend(items),
            other => out.push(other),
        }
        if out.len() >= cap {
            out.truncate(cap);
            break;
        }
        match next {
            Some(link) => url = link,
            None => break,
        }
    }
    Ok(out)
}

fn next_link(headers: &reqwest::header::HeaderMap) -> Option<String> {
    let link = headers.get(reqwest::header::LINK)?.to_str().ok()?;
    for part in link.split(',') {
        let Some((url, rel)) = part.split_once(';') else {
            continue;
        };
        if rel.contains("rel=\"next\"") {
            return Some(
                url.trim()
                    .trim_start_matches('<')
                    .trim_end_matches('>')
                    .to_string(),
            );
        }
    }
    None
}

pub fn is_cad(path: &str) -> bool {
    let l = path.to_lowercase();
    l.ends_with(".sldprt") || l.ends_with(".sldasm") || l.ends_with(".slddrw")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_next_page_out_of_a_link_header() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::LINK,
            "<https://api.github.com/x?page=2>; rel=\"next\", <https://api.github.com/x?page=9>; rel=\"last\""
                .parse()
                .unwrap(),
        );
        assert_eq!(
            next_link(&headers).as_deref(),
            Some("https://api.github.com/x?page=2")
        );
    }

    #[test]
    fn the_last_page_has_no_next() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::LINK,
            "<https://api.github.com/x?page=1>; rel=\"prev\""
                .parse()
                .unwrap(),
        );
        assert!(next_link(&headers).is_none());
    }

    #[test]
    fn a_permission_error_says_which_kind() {
        let e = github_error(
            reqwest::StatusCode::FORBIDDEN,
            r#"{"message":"Must have push access"}"#,
        );
        assert_eq!(e.code, "PERMISSION");
        assert!(e.message.contains("push access"));
    }

    #[test]
    fn rate_limiting_is_its_own_kind() {
        let e = github_error(
            reqwest::StatusCode::FORBIDDEN,
            r#"{"message":"API rate limit exceeded"}"#,
        );
        assert_eq!(e.code, "RATE");
    }
}
