use std::collections::HashSet;
use std::path::Path;

use serde::Serialize;

use std::collections::{HashMap, VecDeque};

use crate::error::{AppError, AppResult};
use crate::fsattr;
use crate::messages;
use crate::lfs;
use crate::proc::run_git;
use crate::repo;
use crate::swrefs;

#[derive(Debug, Serialize)]
pub struct ClaimResult {
    pub claimed: Vec<String>,
    pub failed: Vec<FailedClaim>,
}

#[derive(Debug, Serialize)]
pub struct FailedClaim {
    pub path: String,
    pub owner: Option<String>,
    pub locked_at: Option<String>,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct ReleaseOutcome {
    pub path: String,
    pub ok: bool,
    pub code: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SyncResult {
    pub made_writable: Vec<String>,
    pub made_readonly: Vec<String>,
    pub anomalies: Vec<Anomaly>,
}

#[derive(Debug, Serialize)]
pub struct Anomaly {
    pub path: String,
    pub reason: String,
}

pub fn parse_porcelain_z(stdout: &str) -> HashSet<String> {
    let mut paths = HashSet::new();
    let mut fields = stdout.split('\0').filter(|s| !s.is_empty());
    while let Some(entry) = fields.next() {
        if entry.len() < 4 {
            continue;
        }
        let (xy, path) = entry.split_at(3);
        paths.insert(path.to_string());
        // Renames/copies carry the original path as an extra NUL field.
        if xy.starts_with('R') || xy.starts_with('C') {
            fields.next();
        }
    }
    paths
}

async fn dirty_paths(root: &Path) -> AppResult<HashSet<String>> {
    let out = run_git(root, &["status", "--porcelain", "-z"], 30).await?;
    if !out.ok() {
        return Err(AppError::git(out.stderr.trim().to_string()));
    }
    Ok(parse_porcelain_z(&out.stdout))
}

async fn has_upstream(root: &Path) -> AppResult<bool> {
    let out = run_git(root, &["rev-parse", "--abbrev-ref", "@{u}"], 15).await?;
    Ok(out.ok())
}

async fn unpushed_paths(root: &Path) -> AppResult<HashSet<String>> {
    let out = run_git(
        root,
        &["log", "@{u}..HEAD", "--name-only", "--pretty=format:", "-z"],
        30,
    )
    .await?;
    if !out.ok() {
        return Err(AppError::git(out.stderr.trim().to_string()));
    }
    Ok(out
        .stdout
        .split(['\0', '\n'])
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().to_string())
        .collect())
}

pub async fn claim_files(root: &Path, paths: Vec<String>) -> AppResult<ClaimResult> {
    let mut claimed = Vec::new();
    let mut failed_raw: Vec<(String, String)> = Vec::new();

    for chunk in paths.chunks(4) {
        let mut handles = Vec::new();
        for path in chunk {
            let root = root.to_path_buf();
            let path = path.clone();
            handles.push(tokio::spawn(async move {
                let result = lfs::lock_file(&root, &path).await;
                (path, result)
            }));
        }
        for handle in handles {
            let (path, result) = handle
                .await
                .map_err(|e| AppError::new("INTERNAL", e.to_string()))?;
            match result {
                Ok(()) => {
                    let _ = fsattr::set_readonly(&root.join(&path), false);
                    claimed.push(path);
                }
                Err(e) => failed_raw.push((path, e.message)),
            }
        }
    }

    let mut failed = Vec::new();
    if !failed_raw.is_empty() {
        // Offline is not "already taken": say so plainly instead of blaming
        // a teammate. Nothing can be claimed without GitHub.
        if failed_raw
            .iter()
            .any(|(_, message)| crate::error::looks_offline(message))
        {
            return Err(AppError::offline(messages::CLAIM_OFFLINE));
        }
        // Concurrent `git lfs lock` calls can trip over their shared local
        // lock cache, recheck
        // against the server before reporting failures.
        let locks = lfs::get_locks(root, None).await.ok();
        let server = locks.as_ref().filter(|l| l.fresh);
        for (path, message) in failed_raw {
            if let Some(l) = server {
                if l.ours.iter().any(|k| k.path.eq_ignore_ascii_case(&path)) {
                    let _ = fsattr::set_readonly(&root.join(&path), false);
                    claimed.push(path);
                    continue;
                }
            }
            let holder = server.and_then(|l| {
                l.theirs
                    .iter()
                    .find(|lock| lock.path.eq_ignore_ascii_case(&path))
            });
            failed.push(FailedClaim {
                owner: holder.and_then(|l| l.owner.as_ref().map(|o| o.name.clone())),
                locked_at: holder.and_then(|l| l.locked_at.clone()),
                path,
                message,
            });
        }
    }

    Ok(ClaimResult { claimed, failed })
}

pub async fn release_files(root: &Path, paths: Vec<String>) -> AppResult<Vec<ReleaseOutcome>> {
    let status = repo::get_repo_status(root).await?;
    let dirty: HashSet<String> = status.dirty.iter().cloned().collect();
    let untracked: HashSet<String> = status.untracked.iter().cloned().collect();
    let upstream = has_upstream(root).await?;
    let unpushed = if upstream {
        unpushed_paths(root).await?
    } else {
        HashSet::new()
    };

    let mut outcomes = Vec::new();
    let mut to_unlock = Vec::new();
    for path in paths {
        // A file that has never been shared is a different problem from one
        // with unsaved edits, and deserves its own explanation.
        if untracked.contains(&path) {
            outcomes.push(ReleaseOutcome {
                path,
                ok: false,
                code: Some("NEEDS_COMMIT".into()),
                message: Some(messages::RELEASE_NEVER_SHARED.into()),
            });
            continue;
        }
        if dirty.contains(&path) {
            outcomes.push(ReleaseOutcome {
                path,
                ok: false,
                code: Some("NEEDS_COMMIT".into()),
                message: Some(messages::RELEASE_NEEDS_COMMIT.into()),
            });
            continue;
        }
        if !upstream {
            outcomes.push(ReleaseOutcome {
                path,
                ok: false,
                code: Some("NEEDS_PUSH".into()),
                message: Some(messages::RELEASE_BRANCH_NEVER_SHARED.into()),
            });
            continue;
        }
        if unpushed.contains(&path) {
            outcomes.push(ReleaseOutcome {
                path,
                ok: false,
                code: Some("NEEDS_PUSH".into()),
                message: Some(messages::RELEASE_NEEDS_PUSH.into()),
            });
            continue;
        }
        to_unlock.push(path);
    }

    #[cfg(windows)]
    if !to_unlock.is_empty() {
        let open_docs: HashSet<String> = swrefs::solidworks_open_documents()
            .await
            .into_iter()
            .map(|p| p.replace('\\', "/").to_lowercase())
            .collect();
        if !open_docs.is_empty() {
            let mut still_ok = Vec::new();
            for path in to_unlock {
                let abs = root
                    .join(&path)
                    .to_string_lossy()
                    .replace('\\', "/")
                    .to_lowercase();
                if open_docs.contains(&abs) {
                    outcomes.push(ReleaseOutcome {
                        path,
                        ok: false,
                        code: Some("OPEN_IN_SW".into()),
                        message: Some(messages::RELEASE_OPEN_IN_SW.into()),
                    });
                } else {
                    still_ok.push(path);
                }
            }
            to_unlock = still_ok;
        }
    }

    let mut failed_raw: Vec<(String, AppError)> = Vec::new();
    for chunk in to_unlock.chunks(4) {
        let mut handles = Vec::new();
        for path in chunk {
            let root = root.to_path_buf();
            let path = path.clone();
            handles.push(tokio::spawn(async move {
                let result = lfs::unlock_file(&root, &path, false).await;
                (path, result)
            }));
        }
        for handle in handles {
            let (path, result) = handle
                .await
                .map_err(|e| AppError::new("INTERNAL", e.to_string()))?;
            match result {
                Ok(()) => {
                    let _ = fsattr::set_readonly(&root.join(&path), true);
                    outcomes.push(ReleaseOutcome {
                        path,
                        ok: true,
                        code: None,
                        message: None,
                    });
                }
                Err(e) => failed_raw.push((path, e)),
            }
        }
    }

    if failed_raw
        .iter()
        .any(|(_, e)| crate::error::looks_offline(&e.message))
    {
        return Err(AppError::offline(messages::RELEASE_OFFLINE));
    }

    if !failed_raw.is_empty() {
        let server = lfs::get_locks(root, None).await.ok().filter(|l| l.fresh);
        for (path, _first_err) in failed_raw {
            let still_locked = match &server {
                Some(l) => l
                    .ours
                    .iter()
                    .chain(l.theirs.iter())
                    .any(|k| k.path.eq_ignore_ascii_case(&path)),
                None => true,
            };
            if !still_locked {
                let _ = fsattr::set_readonly(&root.join(&path), true);
                outcomes.push(ReleaseOutcome {
                    path,
                    ok: true,
                    code: None,
                    message: None,
                });
                continue;
            }
            match lfs::unlock_file(root, &path, false).await {
                Ok(()) => {
                    let _ = fsattr::set_readonly(&root.join(&path), true);
                    outcomes.push(ReleaseOutcome {
                        path,
                        ok: true,
                        code: None,
                        message: None,
                    });
                }
                Err(e) => outcomes.push(ReleaseOutcome {
                    path,
                    ok: false,
                    code: Some(e.code),
                    message: Some(e.message),
                }),
            }
        }
    }
    Ok(outcomes)
}

pub async fn sync_attributes(root: &Path, username_hint: Option<&str>) -> AppResult<SyncResult> {
    let locks = lfs::get_locks(root, username_hint).await?;
    if !locks.fresh {
        return Err(AppError::offline(
            messages::LOCKS_UNVERIFIED_PERMS_UNCHANGED,
        ));
    }

    let mine: HashSet<String> = locks.ours.iter().map(|l| l.path.to_lowercase()).collect();
    let dirty = dirty_paths(root).await?;
    let files = repo::list_lockable_files(root).await?;

    let mut made_writable = Vec::new();
    let mut made_readonly = Vec::new();
    let mut anomalies = Vec::new();

    for file in files {
        let abs = root.join(&file.rel_path);
        if mine.contains(&file.rel_path.to_lowercase()) {
            match fsattr::set_readonly(&abs, false) {
                Ok(true) => made_writable.push(file.rel_path),
                Ok(false) => {}
                Err(e) => anomalies.push(Anomaly {
                    path: file.rel_path,
                    reason: e.to_string(),
                }),
            }
        } else if dirty.contains(&file.rel_path) {
            anomalies.push(Anomaly {
                path: file.rel_path,
                reason: messages::NOT_CLAIMED_BY_YOU.into(),
            });
        } else {
            match fsattr::set_readonly(&abs, true) {
                Ok(true) => made_readonly.push(file.rel_path),
                Ok(false) => {}
                Err(e) => anomalies.push(Anomaly {
                    path: file.rel_path,
                    reason: e.to_string(),
                }),
            }
        }
    }

    Ok(SyncResult {
        made_writable,
        made_readonly,
        anomalies,
    })
}

#[derive(Debug, Serialize)]
pub struct GetLatestResult {
    pub merged: bool,
    pub behind_before: i64,
}

async fn lockable_subset(root: &Path, paths: &[String]) -> AppResult<HashSet<String>> {
    if paths.is_empty() {
        return Ok(HashSet::new());
    }
    let stdin_data = paths.join("\0").into_bytes();
    let out = crate::proc::run_git_stdin(
        root,
        &["check-attr", "--stdin", "-z", "lockable"],
        &stdin_data,
        30,
    )
    .await?;
    let fields: Vec<&str> = out.stdout.split('\0').collect();
    let mut lockable = HashSet::new();
    for chunk in fields.chunks(3) {
        if let [path, attr, value] = chunk {
            if *attr == "lockable" && *value == "set" {
                lockable.insert(path.to_string());
            }
        }
    }
    Ok(lockable)
}

pub async fn get_latest(root: &Path) -> AppResult<GetLatestResult> {
    let status = repo::get_repo_status(root).await?;
    if !status.conflicted.is_empty() {
        return Err(AppError::with_detail(
            "CONFLICT",
            messages::UPDATE_UNRESOLVED,
            serde_json::json!({ "files": status.conflicted }),
        ));
    }
    let real_dirty: Vec<String> = status
        .dirty
        .iter()
        .filter(|p| !repo::is_sw_temp(p))
        .cloned()
        .collect();
    if !real_dirty.is_empty() {
        return Err(AppError::with_detail(
            "NEEDS_COMMIT",
            messages::GET_LATEST_NEEDS_COMMIT,
            serde_json::json!({ "files": real_dirty }),
        ));
    }

    // Discard local churn on tracked ~$ SolidWorks temp files so the merge
    // below can't refuse on junk. Best effort — see repo::switch_branch.
    let junk_dirty: Vec<&str> = status
        .dirty
        .iter()
        .filter(|p| repo::is_sw_temp(p))
        .map(String::as_str)
        .collect();
    if !junk_dirty.is_empty() {
        let mut args = vec!["restore", "--staged", "--worktree", "--"];
        args.extend(&junk_dirty);
        let _ = run_git(root, &args, 30).await;
    }

    let fetch = run_git(root, &["fetch", "origin"], 600).await?;
    if !fetch.ok() {
        return Err(AppError::offline(messages::could_not_reach_github(
            fetch.stderr.trim(),
        )));
    }

    let status = repo::get_repo_status(root).await?;
    if status.upstream.is_none() || status.behind == 0 {
        return Ok(GetLatestResult {
            merged: false,
            behind_before: 0,
        });
    }
    let behind_before = status.behind;

    let ff = run_git(root, &["merge", "--ff-only", "@{u}"], 300).await?;
    if ff.ok() {
        return Ok(GetLatestResult {
            merged: true,
            behind_before,
        });
    }

    let merge = run_git(root, &["merge", "@{u}"], 300).await?;
    if merge.ok() {
        return Ok(GetLatestResult {
            merged: true,
            behind_before,
        });
    }

    let after = repo::get_repo_status(root).await?;
    let conflicted = after.conflicted;
    let cad_conflicts = lockable_subset(root, &conflicted).await?;
    if !cad_conflicts.is_empty() {
        let _ = run_git(root, &["merge", "--abort"], 60).await;
        return Err(AppError::with_detail(
            "CAD_CONFLICT",
            messages::CAD_CONFLICT,
            serde_json::json!({ "files": cad_conflicts.into_iter().collect::<Vec<_>>() }),
        ));
    }
    if conflicted.is_empty() {
        // The merge refused without producing conflict entries
        return Err(AppError::git(messages::could_not_merge(
            merge.stderr.trim(),
        )));
    }
    Err(AppError::with_detail(
        "CONFLICT",
        messages::TEXT_CONFLICT,
        serde_json::json!({ "files": conflicted }),
    ))
}

pub async fn abort_merge(root: &Path) -> AppResult<()> {
    let out = run_git(root, &["merge", "--abort"], 60).await?;
    if out.ok() {
        Ok(())
    } else {
        Err(AppError::git(out.stderr.trim().to_string()))
    }
}

pub async fn resolve_keep_theirs(root: &Path, paths: Vec<String>) -> AppResult<()> {
    for path in &paths {
        let co = run_git(root, &["checkout", "--theirs", "--", path], 60).await?;
        if !co.ok() {
            return Err(AppError::git(co.stderr.trim().to_string()));
        }
        let add = run_git(root, &["add", "--", path], 60).await?;
        if !add.ok() {
            return Err(AppError::git(add.stderr.trim().to_string()));
        }
    }
    let status = repo::get_repo_status(root).await?;
    if status.conflicted.is_empty() {
        let commit = run_git(root, &["commit", "--no-edit"], 60).await?;
        if !commit.ok() {
            return Err(AppError::git(commit.stderr.trim().to_string()));
        }
    }
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct SaveResult {
    pub pushed: bool,
}

pub async fn push_now(root: &Path) -> AppResult<SaveResult> {
    let status = repo::get_repo_status(root).await?;
    let push_args: Vec<&str> = if status.upstream.is_none() {
        vec!["push", "-u", "origin", "HEAD"]
    } else {
        vec!["push"]
    };

    let push = run_git(root, &push_args, 600).await?;
    if push.ok() {
        return Ok(SaveResult { pushed: true });
    }

    if push.stderr.contains("fetch first") || push.stderr.contains("non-fast-forward") {
        get_latest(root).await?;
        let retry = run_git(root, &push_args, 600).await?;
        if retry.ok() {
            return Ok(SaveResult { pushed: true });
        }
        return Err(AppError::git(retry.stderr.trim().to_string()));
    }

    Err(AppError::offline(messages::could_not_push(
        push.stderr.trim(),
    )))
}

pub async fn save_and_share(
    root: &Path,
    message: String,
    paths: Vec<String>,
) -> AppResult<SaveResult> {
    if paths.is_empty() {
        return Err(AppError::new("INVALID", messages::NO_FILES_SELECTED));
    }
    if message.trim().is_empty() {
        return Err(AppError::new("INVALID", messages::NO_COMMIT_MESSAGE));
    }

    // Deleting a file a teammate holds would remove their work for everyone,
    // and the read-only bit cannot stop a deletion made through Explorer.
    // This is the last place to catch it.
    let deleted: Vec<&String> = paths
        .iter()
        .filter(|p| !root.join(p).exists())
        .collect();
    if !deleted.is_empty() {
        if let Ok(locks) = lfs::get_locks(root, None).await {
            if locks.fresh {
                let mut blocked = Vec::new();
                for path in &deleted {
                    if let Some(lock) = locks
                        .theirs
                        .iter()
                        .find(|l| l.path.eq_ignore_ascii_case(path))
                    {
                        let owner = lock
                            .owner
                            .as_ref()
                            .map(|o| o.name.clone())
                            .unwrap_or_else(|| "another member".to_string());
                        blocked.push(format!("{path} ({owner})"));
                    }
                }
                if !blocked.is_empty() {
                    return Err(AppError::with_detail(
                        "LOCKED_DELETE",
                        messages::delete_locked_by_other(&blocked.join(", ")),
                        serde_json::json!({ "files": blocked }),
                    ));
                }
            }
        }
    }

    let mut add_args = vec!["add", "--"];
    add_args.extend(paths.iter().map(String::as_str));
    let add = run_git(root, &add_args, 60).await?;
    if !add.ok() {
        return Err(AppError::git(add.stderr.trim().to_string()));
    }

    let commit = run_git(root, &["commit", "-m", &message], 60).await?;
    if !commit.ok() && !commit.stdout.contains("nothing to commit") {
        return Err(AppError::git(if commit.stderr.trim().is_empty() {
            commit.stdout.trim().to_string()
        } else {
            commit.stderr.trim().to_string()
        }));
    }

    push_now(root).await
}

#[derive(Debug, Serialize)]
pub struct RefResolution {
    pub resolved: Vec<String>,
    pub ambiguous: Vec<AmbiguousRef>,
    pub unresolved: Vec<String>,
    pub warning: Option<String>,
    pub suggestions: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct AmbiguousRef {
    pub name: String,
    pub candidates: Vec<String>,
}

pub async fn resolve_references(root: &Path, start_rel: String) -> AppResult<RefResolution> {
    let files = repo::list_lockable_files(root).await?;
    let mut by_basename: HashMap<String, Vec<String>> = HashMap::new();
    for f in &files {
        by_basename
            .entry(f.name.to_lowercase())
            .or_default()
            .push(f.rel_path.clone());
    }

    let mut resolved = Vec::new();
    let mut ambiguous: Vec<AmbiguousRef> = Vec::new();
    let mut unresolved = Vec::new();
    let mut visited: HashSet<String> = HashSet::new();
    let mut seen_names: HashSet<String> = HashSet::new();
    let mut queue = VecDeque::new();

    visited.insert(start_rel.to_lowercase());
    resolved.push(start_rel.clone());
    queue.push_back(start_rel);

    let mut warning: Option<String> = None;
    #[cfg(windows)]
    let root_lower = root.to_string_lossy().replace('\\', "/").to_lowercase();
    #[cfg(windows)]
    let by_relpath: HashMap<String, String> = files
        .iter()
        .map(|f| (f.rel_path.to_lowercase(), f.rel_path.clone()))
        .collect();

    while let Some(current) = queue.pop_front() {
        let abs = root.join(&current);
        let abs_for_scan = abs.clone();
        let names = match tokio::task::spawn_blocking(move || swrefs::scan_file(&abs_for_scan))
            .await
            .map_err(|e| AppError::new("INTERNAL", e.to_string()))?
        {
            Ok(names) => names,
            Err(_) => {
                #[cfg(windows)]
                match swrefs::solidworks_dependencies(&abs).await {
                    Ok(dep_paths) => {
                        for dep in dep_paths {
                            let dep_norm = dep.replace('\\', "/");
                            let dep_lower = dep_norm.to_lowercase();
                            let base = dep_norm
                                .rsplit('/')
                                .next()
                                .unwrap_or(&dep_norm)
                                .to_string();
                            if let Some(rest) = dep_lower.strip_prefix(&root_lower) {
                                let rel_lower = rest.trim_start_matches('/');
                                if let Some(rel) = by_relpath.get(rel_lower) {
                                    seen_names.insert(base.to_lowercase());
                                    if visited.insert(rel.to_lowercase()) {
                                        resolved.push(rel.clone());
                                    }
                                    continue;
                                }
                            }
                            if seen_names.insert(base.to_lowercase()) {
                                unresolved.push(base);
                            }
                        }
                        continue;
                    }
                    Err(e) => {
                        if warning.is_none() {
                            let abs_l =
                                abs.to_string_lossy().replace('\\', "/").to_lowercase();
                            let open_docs = swrefs::solidworks_open_documents().await;
                            let is_open = open_docs
                                .iter()
                                .any(|p| p.replace('\\', "/").to_lowercase() == abs_l);
                            warning = Some(if is_open {
                                messages::refs_blocked_by_open_doc(
                                    current.rsplit('/').next().unwrap_or(&current),
                                )
                            } else {
                                e.message
                            });
                        }
                        continue;
                    }
                }
                #[cfg(not(windows))]
                {
                    if warning.is_none() {
                        warning = Some(messages::refs_unreadable(
                            current.rsplit('/').next().unwrap_or(&current),
                        ));
                    }
                    continue;
                }
            }
        };

        for name in names {
            if !seen_names.insert(name.clone()) {
                continue;
            }
            match by_basename.get(&name).map(|v| v.as_slice()) {
                Some([single]) => {
                    if visited.insert(single.to_lowercase()) {
                        resolved.push(single.clone());
                        if single.to_lowercase().ends_with(".sldasm") {
                            queue.push_back(single.clone());
                        }
                    }
                }
                Some(candidates) => {
                    ambiguous.push(AmbiguousRef {
                        name,
                        candidates: candidates.to_vec(),
                    });
                }
                None => unresolved.push(name),
            }
        }
    }

    ambiguous.sort_by(|a, b| a.name.cmp(&b.name));
    unresolved.sort();

    let mut suggestions = Vec::new();
    if warning.is_some() && resolved.len() <= 1 {
        let start = &resolved[0];
        let dir = start.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
        for f in &files {
            if f.dir == dir && !f.rel_path.eq_ignore_ascii_case(start) {
                suggestions.push(f.rel_path.clone());
            }
        }
    }

    Ok(RefResolution {
        resolved,
        ambiguous,
        unresolved,
        warning,
        suggestions,
    })
}

#[cfg(test)]
mod tests {
    use super::parse_porcelain_z;

    #[test]
    fn parses_simple_and_rename_entries() {
        let s = " M 01-Wing/spar.sldprt\0R  new.sldprt\0old.sldprt\0?? notes.txt\0";
        let paths = parse_porcelain_z(s);
        assert!(paths.contains("01-Wing/spar.sldprt"));
        assert!(paths.contains("new.sldprt"));
        assert!(!paths.contains("old.sldprt"));
        assert!(paths.contains("notes.txt"));
    }
}
