//! Git LFS file locking over HTTPS.
//!
//! `git lfs lock` is a POST and nothing more. The desktop goes through the
//! binary because it also flips the file read-only on disk. With no working
//! tree there is nothing to flip, so the network call is the whole job.
//!
//! Spec: https://github.com/git-lfs/git-lfs/blob/main/docs/api/locking.md

use base64::Engine;
use serde::Deserialize;
use serde_json::json;

use crate::error::{AppError, AppResult};
use crate::lfs::{Lock, LockOwner, LocksResult};

use super::{net, Api};

const LFS_JSON: &str = "application/vnd.git-lfs+json";
/// One project is not going to hold more locks than this, and if it does the
/// list stopped being readable long before.
const MAX_LOCKS: usize = 2000;

fn base(api: &Api) -> String {
    format!("https://github.com/{}.git/info/lfs", api.slug)
}

/// LFS authenticates with Basic, not Bearer.
fn basic(api: &Api) -> String {
    let login = if api.login.is_empty() {
        "x-access-token"
    } else {
        api.login.as_str()
    };
    let raw = format!("{login}:{}", api.token);
    format!(
        "Basic {}",
        base64::engine::general_purpose::STANDARD.encode(raw)
    )
}

fn refspec(branch: &str) -> serde_json::Value {
    json!({ "name": format!("refs/heads/{branch}") })
}

async fn read(resp: reqwest::Response) -> AppResult<serde_json::Value> {
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if status.is_success() {
        return serde_json::from_str(&body).map_err(|e| {
            AppError::new("PARSE", format!("unexpected lock JSON from GitHub: {e}"))
        });
    }
    Err(lock_error(status, &body))
}

/// The LFS server words refusals differently from the REST API, and the
/// difference matters: a held file is ordinary, not a fault.
fn lock_error(status: reqwest::StatusCode, body: &str) -> AppError {
    let said = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| {
            v.get("message")
                .and_then(|m| m.as_str())
                .map(str::to_string)
        })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| status.to_string());

    match status.as_u16() {
        401 => AppError::new(
            "AUTH",
            "GitHub would not accept the sign in for locking. Sign in again.",
        ),
        403 => AppError::new(
            "PERMISSION",
            format!("Your account cannot lock files in this project ({said}). It needs write access."),
        ),
        404 => AppError::new(
            "LFS",
            "This project has no Git LFS locking set up, so there is nothing to lock.",
        ),
        409 => AppError::new("HELD", said),
        _ => AppError::new("LFS", said),
    }
}

#[derive(Deserialize)]
struct ListShape {
    #[serde(default)]
    locks: Vec<Lock>,
    #[serde(default)]
    next_cursor: Option<String>,
}

#[derive(Deserialize)]
struct VerifyShape {
    #[serde(default)]
    ours: Vec<Lock>,
    #[serde(default)]
    theirs: Vec<Lock>,
    #[serde(default)]
    next_cursor: Option<String>,
}

/// Every lock, split into yours and everyone else's.
///
/// `verify` lets the server do the splitting, but it needs push access, so a
/// read-only member falls back to the plain list sorted by owner name.
pub async fn all(api: &Api, branch: &str) -> AppResult<LocksResult> {
    match verified(api, branch).await {
        Ok(result) => Ok(result),
        Err(e) if e.code == "PERMISSION" => {
            let locks = listed(api).await?;
            let (ours, theirs) = bucket(locks, &api.login);
            Ok(LocksResult {
                ours,
                theirs,
                fresh: true,
            })
        }
        Err(e) => Err(e),
    }
}

async fn verified(api: &Api, branch: &str) -> AppResult<LocksResult> {
    let mut ours = Vec::new();
    let mut theirs = Vec::new();
    let mut cursor: Option<String> = None;

    loop {
        let mut body = json!({ "limit": 100, "ref": refspec(branch) });
        if let Some(c) = &cursor {
            body["cursor"] = json!(c);
        }
        let resp = api
            .http
            .post(format!("{}/locks/verify", base(api)))
            .header("Authorization", basic(api))
            .header("Accept", LFS_JSON)
            .header("Content-Type", LFS_JSON)
            .json(&body)
            .send()
            .await
            .map_err(net)?;

        let page: VerifyShape = serde_json::from_value(read(resp).await?)
            .map_err(|e| AppError::new("PARSE", format!("unexpected verify JSON: {e}")))?;
        ours.extend(page.ours);
        theirs.extend(page.theirs);

        if ours.len() + theirs.len() >= MAX_LOCKS {
            break;
        }
        match page.next_cursor.filter(|c| !c.is_empty()) {
            Some(next) => cursor = Some(next),
            None => break,
        }
    }

    Ok(LocksResult {
        ours,
        theirs,
        fresh: true,
    })
}

async fn listed(api: &Api) -> AppResult<Vec<Lock>> {
    let mut out = Vec::new();
    let mut cursor: Option<String> = None;

    loop {
        let mut url = format!("{}/locks?limit=100", base(api));
        if let Some(c) = &cursor {
            url.push_str(&format!("&cursor={}", urlencode(c)));
        }
        let resp = api
            .http
            .get(url)
            .header("Authorization", basic(api))
            .header("Accept", LFS_JSON)
            .send()
            .await
            .map_err(net)?;

        let page: ListShape = serde_json::from_value(read(resp).await?)
            .map_err(|e| AppError::new("PARSE", format!("unexpected lock list JSON: {e}")))?;
        out.extend(page.locks);

        if out.len() >= MAX_LOCKS {
            break;
        }
        match page.next_cursor.filter(|c| !c.is_empty()) {
            Some(next) => cursor = Some(next),
            None => break,
        }
    }
    Ok(out)
}

fn bucket(locks: Vec<Lock>, me: &str) -> (Vec<Lock>, Vec<Lock>) {
    let me = me.to_lowercase();
    let mut ours = Vec::new();
    let mut theirs = Vec::new();
    for lock in locks {
        let owner = lock.owner.as_ref().map(|o| o.name.to_lowercase());
        if !me.is_empty() && owner.as_deref() == Some(me.as_str()) {
            ours.push(lock);
        } else {
            theirs.push(lock);
        }
    }
    (ours, theirs)
}

/// A 409 carries the lock that beat us to it, which is worth showing.
pub async fn take(api: &Api, path: &str, branch: &str) -> AppResult<Lock> {
    let resp = api
        .http
        .post(format!("{}/locks", base(api)))
        .header("Authorization", basic(api))
        .header("Accept", LFS_JSON)
        .header("Content-Type", LFS_JSON)
        .json(&json!({ "path": path, "ref": refspec(branch) }))
        .send()
        .await
        .map_err(net)?;

    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();

    if status.is_success() {
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| AppError::new("PARSE", format!("unexpected lock JSON: {e}")))?;
        return serde_json::from_value(v.get("lock").cloned().unwrap_or(v))
            .map_err(|e| AppError::new("PARSE", format!("unexpected lock JSON: {e}")));
    }

    if status == reqwest::StatusCode::CONFLICT {
        let v: serde_json::Value = serde_json::from_str(&body).unwrap_or(json!({}));
        let holder = v
            .get("lock")
            .and_then(|l| l.get("owner"))
            .and_then(|o| o.get("name"))
            .and_then(|n| n.as_str())
            .unwrap_or("someone else");
        return Err(AppError::with_detail(
            "HELD",
            format!("{holder} is already holding this file."),
            v.get("lock").cloned().unwrap_or(json!(null)),
        ));
    }
    Err(lock_error(status, &body))
}

/// `force` takes a lock off somebody else and needs push access.
pub async fn give_back(api: &Api, id: &str, force: bool, branch: &str) -> AppResult<()> {
    let resp = api
        .http
        .post(format!("{}/locks/{}/unlock", base(api), urlencode(id)))
        .header("Authorization", basic(api))
        .header("Accept", LFS_JSON)
        .header("Content-Type", LFS_JSON)
        .json(&json!({ "force": force, "ref": refspec(branch) }))
        .send()
        .await
        .map_err(net)?;
    read(resp).await.map(|_| ())
}

/// Turns a path into the lock id needed to unlock it.
pub async fn on_path(api: &Api, path: &str, branch: &str) -> AppResult<Option<Lock>> {
    let url = format!(
        "{}/locks?path={}&refspec={}",
        base(api),
        urlencode(path),
        urlencode(&format!("refs/heads/{branch}"))
    );
    let resp = api
        .http
        .get(url)
        .header("Authorization", basic(api))
        .header("Accept", LFS_JSON)
        .send()
        .await
        .map_err(net)?;
    let page: ListShape = serde_json::from_value(read(resp).await?)
        .map_err(|e| AppError::new("PARSE", format!("unexpected lock list JSON: {e}")))?;
    Ok(page.locks.into_iter().next())
}

/// For a name in a URL path. Branch names may contain slashes, and those are
/// part of the path GitHub expects rather than something to escape.
pub fn encode_ref(s: &str) -> String {
    urlencode(s).replace("%2F", "/")
}

pub fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Lock owners are GitHub logins.
pub fn owner_of(lock: &Lock) -> Option<&str> {
    lock.owner.as_ref().map(|o: &LockOwner| o.name.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lock(path: &str, owner: &str) -> Lock {
        Lock {
            id: "1".into(),
            path: path.into(),
            owner: Some(LockOwner {
                name: owner.into(),
            }),
            locked_at: None,
        }
    }

    #[test]
    fn buckets_ignore_letter_case() {
        let (ours, theirs) = bucket(
            vec![lock("a.sldprt", "Alice"), lock("b.sldprt", "bob")],
            "ALICE",
        );
        assert_eq!(ours.len(), 1);
        assert_eq!(theirs.len(), 1);
        assert_eq!(owner_of(&ours[0]), Some("Alice"));
    }

    #[test]
    fn with_no_login_everything_is_someone_elses() {
        let (ours, theirs) = bucket(vec![lock("a.sldprt", "Alice")], "");
        assert!(ours.is_empty());
        assert_eq!(theirs.len(), 1);
    }

    #[test]
    fn a_branch_with_a_slash_keeps_it() {
        assert_eq!(encode_ref("wing/rib revision"), "wing/rib%20revision");
        assert_eq!(urlencode("wing/rib"), "wing%2Frib");
    }

    #[test]
    fn paths_with_spaces_survive_the_query_string() {
        assert_eq!(
            urlencode("01 Wing/left spar.SLDPRT"),
            "01%20Wing%2Fleft%20spar.SLDPRT"
        );
    }

    #[test]
    fn a_held_file_is_not_reported_as_a_fault() {
        let e = lock_error(
            reqwest::StatusCode::CONFLICT,
            r#"{"message":"already created lock"}"#,
        );
        assert_eq!(e.code, "HELD");
    }
}
