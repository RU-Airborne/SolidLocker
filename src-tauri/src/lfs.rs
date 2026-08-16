use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::messages;
use crate::proc::run_git;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LockOwner {
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Lock {
    pub id: String,
    pub path: String,
    pub owner: Option<LockOwner>,
    pub locked_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LocksResult {
    pub ours: Vec<Lock>,
    pub theirs: Vec<Lock>,
    pub fresh: bool,
}

#[derive(Deserialize)]
struct VerifyShape {
    ours: Vec<Lock>,
    theirs: Vec<Lock>,
}

#[derive(Deserialize)]
struct WrappedShape {
    locks: Vec<Lock>,
}

pub fn parse_verify_json(s: &str) -> AppResult<(Vec<Lock>, Vec<Lock>)> {
    let v: VerifyShape = serde_json::from_str(s)
        .map_err(|e| AppError::new("PARSE", format!("unexpected lock JSON from git-lfs: {e}")))?;
    Ok((v.ours, v.theirs))
}

pub fn parse_flat_json(s: &str) -> AppResult<Vec<Lock>> {
    if let Ok(flat) = serde_json::from_str::<Vec<Lock>>(s) {
        return Ok(flat);
    }
    if let Ok(w) = serde_json::from_str::<WrappedShape>(s) {
        return Ok(w.locks);
    }
    Err(AppError::new(
        "PARSE",
        "unexpected cached-lock JSON from git-lfs",
    ))
}

fn bucket_by_owner(locks: Vec<Lock>, username: Option<&str>) -> (Vec<Lock>, Vec<Lock>) {
    let me = username.map(|u| u.to_lowercase());
    let mut ours = Vec::new();
    let mut theirs = Vec::new();
    for lock in locks {
        let owner = lock
            .owner
            .as_ref()
            .map(|o| o.name.to_lowercase());
        if me.is_some() && owner == me {
            ours.push(lock);
        } else {
            theirs.push(lock);
        }
    }
    (ours, theirs)
}

/// Concurrent git-lfs processes can corrupt their shared lock cache, after
/// which EVERY lock command fails ("gob: encoded unsigned integer out of
/// range"). The cache is disposable — delete it and git-lfs rebuilds it.
fn is_lockcache_corruption(stderr: &str) -> bool {
    stderr.contains("lockcache.db") || stderr.contains("lock cache initialization")
}

async fn heal_lockcache(repo: &Path) {
    if let Ok(out) = run_git(repo, &["rev-parse", "--absolute-git-dir"], 15).await {
        if out.ok() {
            let db = std::path::PathBuf::from(out.stdout.trim())
                .join("lfs")
                .join("lockcache.db");
            let _ = std::fs::remove_file(db);
        }
    }
}

pub async fn get_locks(repo: &Path, username_hint: Option<&str>) -> AppResult<LocksResult> {
    let mut verify = run_git(repo, &["lfs", "locks", "--verify", "--json"], 30).await;
    if let Ok(out) = &verify {
        if !out.ok() && is_lockcache_corruption(&out.stderr) {
            heal_lockcache(repo).await;
            verify = run_git(repo, &["lfs", "locks", "--verify", "--json"], 30).await;
        }
    }

    if let Ok(out) = &verify {
        if out.ok() && !out.stdout.trim().is_empty() {
            let (ours, theirs) = parse_verify_json(&out.stdout)?;
            return Ok(LocksResult {
                ours,
                theirs,
                fresh: true,
            });
        }
    }

    let cached = run_git(repo, &["lfs", "locks", "--cached", "--json"], 15).await;
    if let Ok(out) = cached {
        if out.ok() && !out.stdout.trim().is_empty() {
            let locks = parse_flat_json(&out.stdout)?;
            // An EMPTY cache is no answer: on a machine that never created a
            // lock (fresh clone, teammate's first run) it just mirrors that
            // nothing was cached — presenting it as "no locks" hides real
            // locks held by others. Fall through to the verify error instead.
            if !locks.is_empty() {
                let (ours, theirs) = bucket_by_owner(locks, username_hint);
                return Ok(LocksResult {
                    ours,
                    theirs,
                    fresh: false,
                });
            }
        }
    }

    match verify {
        Ok(out) => {
            let stderr = out.stderr.trim();
            let hint = if stderr.contains("credential")
                || stderr.contains("Authentication")
                || stderr.contains("401")
                || stderr.contains("403")
            {
                messages::LOCK_SIGNIN_HINT
            } else {
                messages::LOCK_VERIFY_FAILED
            };
            Err(AppError::offline(if stderr.is_empty() {
                hint.to_string()
            } else {
                format!("{hint} ({stderr})")
            }))
        }
        Err(e) => Err(e),
    }
}

pub async fn lock_file(repo: &Path, rel_path: &str) -> AppResult<()> {
    let mut out = run_git(repo, &["lfs", "lock", rel_path], 30).await?;
    if !out.ok() && is_lockcache_corruption(&out.stderr) {
        heal_lockcache(repo).await;
        out = run_git(repo, &["lfs", "lock", rel_path], 30).await?;
    }
    if out.ok() {
        return Ok(());
    }
    Err(AppError::git(if out.stderr.trim().is_empty() {
        messages::could_not_lock(rel_path)
    } else {
        out.stderr.trim().to_string()
    }))
}

pub async fn unlock_file(repo: &Path, rel_path: &str, force: bool) -> AppResult<()> {
    let mut args = vec!["lfs", "unlock"];
    if force {
        args.push("--force");
    }
    args.push(rel_path);
    let mut out = run_git(repo, &args, 30).await?;
    if !out.ok() && is_lockcache_corruption(&out.stderr) {
        heal_lockcache(repo).await;
        out = run_git(repo, &args, 30).await?;
    }
    if out.ok() {
        return Ok(());
    }
    Err(AppError::git(if out.stderr.trim().is_empty() {
        messages::could_not_unlock(rel_path)
    } else {
        out.stderr.trim().to_string()
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_verify_shape() {
        let s = r#"{"ours":[{"id":"42","path":"01-Wing/spar.sldprt","owner":{"name":"scavenx"},"locked_at":"2026-08-12T10:00:00Z"}],"theirs":[]}"#;
        let (ours, theirs) = parse_verify_json(s).unwrap();
        assert_eq!(ours.len(), 1);
        assert_eq!(ours[0].path, "01-Wing/spar.sldprt");
        assert!(theirs.is_empty());
    }

    #[test]
    fn parses_flat_shape() {
        let s = r#"[{"id":"7","path":"a.sldprt","owner":{"name":"Bob"},"locked_at":null}]"#;
        let locks = parse_flat_json(s).unwrap();
        assert_eq!(locks.len(), 1);
    }

    #[test]
    fn buckets_case_insensitively() {
        let locks = vec![
            Lock {
                id: "1".into(),
                path: "a".into(),
                owner: Some(LockOwner { name: "Alice".into() }),
                locked_at: None,
            },
            Lock {
                id: "2".into(),
                path: "b".into(),
                owner: Some(LockOwner { name: "bob".into() }),
                locked_at: None,
            },
        ];
        let (ours, theirs) = bucket_by_owner(locks, Some("ALICE"));
        assert_eq!(ours.len(), 1);
        assert_eq!(theirs.len(), 1);
    }
}
