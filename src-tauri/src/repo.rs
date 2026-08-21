use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::fsattr;
use crate::messages;
use crate::proc::{run_git, run_git_ok, run_git_stdin};

#[derive(Debug, Serialize, Clone)]
pub struct RepoInfo {
    pub repo_path: String,
    pub repo_slug: String,
    pub branch: String,
    pub lockable_ok: bool,
}

#[derive(Debug, Serialize)]
pub struct AppState {
    pub repo: Option<RepoInfo>,
    pub signed_in: bool,
    pub username: Option<String>,
    pub git_ok: bool,
    pub lfs_ok: bool,
    pub lfs_version: Option<String>,
}

pub fn parse_slug_from_remote(url: &str) -> Option<String> {
    let url = url.trim();
    let rest = url
        .strip_prefix("git@github.com:")
        .or_else(|| url.split("github.com/").nth(1))?;
    let slug = rest.trim_end_matches('/').trim_end_matches(".git");
    let mut parts = slug.split('/');
    let owner = parts.next()?;
    let repo = parts.next()?;
    if owner.is_empty() || repo.is_empty() {
        return None;
    }
    Some(format!("{owner}/{repo}"))
}

const PROBE_TIMEOUT_SECS: u64 = 30;
const PROBE_ATTEMPTS: usize = 3;
const PROBE_BACKOFF_MS: u64 = 400;

async fn probe_version(cwd: &Path, args: &[&str]) -> Option<String> {
    for attempt in 0..PROBE_ATTEMPTS {
        match run_git(cwd, args, PROBE_TIMEOUT_SECS).await {
            Ok(out) if out.ok() => return Some(out.stdout.trim().to_string()),
            Ok(_) => return None,
            Err(_) if attempt + 1 < PROBE_ATTEMPTS => {
                tokio::time::sleep(std::time::Duration::from_millis(PROBE_BACKOFF_MS)).await;
            }
            Err(_) => return None,
        }
    }
    None
}

// pub async fn preflight(cwd: &Path) -> (bool, bool, Option<String>) {
//     let git_ok = run_git(cwd, &["--version"], 10)
//         .await
//         .map(|o| o.ok())
//         .unwrap_or(false);
//     let lfs = run_git(cwd, &["lfs", "version"], 10).await;
//     match lfs {
//         Ok(o) if o.ok() => {
//             ensure_lfs_filters(cwd).await;
//             (git_ok, true, Some(o.stdout.trim().to_string()))
//         }
//         _ => (git_ok, false, None),
//     }
// }
pub async fn preflight(cwd: &Path) -> (bool, bool, Option<String>) {
    let git_ok = probe_version(cwd, &["--version"]).await.is_some();
    match probe_version(cwd, &["lfs", "version"]).await {
        Some(version) => {
            // Having the git-lfs binary is not enough: without the global
            // filters, clones produce 130 byte pointer files instead of CAD
            // data. Idempotent, so it is safe on every launch.
            ensure_lfs_filters(cwd).await;
            (git_ok, true, Some(version))
        }
        None => (git_ok, false, None),
    }
}

pub async fn ensure_lfs_filters(cwd: &Path) {
    let configured = run_git(cwd, &["config", "--get", "filter.lfs.process"], 10)
        .await
        .map(|o| o.ok() && !o.stdout.trim().is_empty())
        .unwrap_or(false);
    if !configured {
        let _ = run_git(cwd, &["lfs", "install", "--skip-repo"], 30).await;
    }
}

pub async fn validate_repo(path: &str) -> AppResult<RepoInfo> {
    let p = PathBuf::from(path);
    if !p.is_dir() {
        return Err(AppError::new("REPO", messages::folder_not_found(path)));
    }

    let toplevel = run_git(&p, &["rev-parse", "--show-toplevel"], 15).await?;
    if !toplevel.ok() {
        return Err(AppError::new("REPO", messages::NOT_A_REPO));
    }
    let root = PathBuf::from(toplevel.stdout.trim());

    // `lockable` may be missing on branches created before the LFS locking
    // setup. That's a warning for the UI, not a reason to reject the repo.
    let attrs = root.join(".gitattributes");
    let lockable_ok = std::fs::read_to_string(&attrs)
        .map(|s| s.contains("lockable"))
        .unwrap_or(false);

    let remote = run_git(&root, &["remote", "get-url", "origin"], 15).await?;
    if !remote.ok() {
        return Err(AppError::new("REPO", messages::NO_ORIGIN_REMOTE));
    }
    let remote_url = remote.stdout.trim().to_string();
    let slug = parse_slug_from_remote(&remote_url).ok_or_else(|| {
        AppError::new("REPO", messages::not_a_github_remote(&remote_url))
    })?;

    run_git_ok(
        &root,
        &["config", "--local", "lfs.setlockablereadonly", "true"],
        15,
    )
    .await?;

    // A repo cloned before the filters existed holds pointer files; checkout
    // rebuilds them from the local cache without touching the network.
    ensure_lfs_filters(&root).await;
    let _ = run_git(&root, &["lfs", "checkout"], 120).await;

    // Best effort. A repo without origin/<branch> just stays untracked until
    // its first push (push_now uses `push -u`).
    let _ = heal_upstream(&root).await;

    let branch = run_git(&root, &["branch", "--show-current"], 15).await?;
    let branch = branch.stdout.trim().to_string();
    let branch = if branch.is_empty() {
        "(detached)".to_string()
    } else {
        branch
    };

    Ok(RepoInfo {
        repo_path: root.to_string_lossy().into_owned(),
        repo_slug: slug,
        branch,
        lockable_ok,
    })
}

#[derive(Debug, Serialize, Clone)]
pub struct RepoStatus {
    pub branch: String,
    pub upstream: Option<String>,
    pub ahead: i64,
    pub behind: i64,
    /// Tracked files with uncommitted modifications.
    pub dirty: Vec<String>,
    /// New files git doesn't know about yet. Never block switching/pulling.
    pub untracked: Vec<String>,
    pub conflicted: Vec<String>,
}

/// SolidWorks writes `~$Foo.SLDPRT` companion files while a document is open.
/// They are transient junk, never to be treated as work worth saving or guarding
/// on. (Some got committed by hand before SolidLocker; they still show as dirty
/// until removed from the branch, but must not block switching or syncing.)
pub fn is_sw_temp(path: &str) -> bool {
    path.rsplit('/').next().unwrap_or(path).starts_with("~$")
}

pub fn parse_status_v2(stdout: &str) -> RepoStatus {
    let mut status = RepoStatus {
        branch: String::new(),
        upstream: None,
        ahead: 0,
        behind: 0,
        dirty: Vec::new(),
        untracked: Vec::new(),
        conflicted: Vec::new(),
    };

    let mut fields = stdout.split('\0').filter(|s| !s.is_empty());
    while let Some(entry) = fields.next() {
        if let Some(rest) = entry.strip_prefix("# branch.head ") {
            status.branch = rest.to_string();
        } else if let Some(rest) = entry.strip_prefix("# branch.upstream ") {
            status.upstream = Some(rest.to_string());
        } else if let Some(rest) = entry.strip_prefix("# branch.ab ") {
            for part in rest.split(' ') {
                if let Some(n) = part.strip_prefix('+') {
                    status.ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = part.strip_prefix('-') {
                    status.behind = n.parse().unwrap_or(0);
                }
            }
        } else if entry.starts_with("1 ") {
            if let Some(path) = entry.splitn(9, ' ').nth(8) {
                status.dirty.push(path.to_string());
            }
        } else if entry.starts_with("2 ") {
            if let Some(path) = entry.splitn(10, ' ').nth(9) {
                status.dirty.push(path.to_string());
            }
            fields.next();
        } else if entry.starts_with("u ") {
            if let Some(path) = entry.splitn(11, ' ').nth(10) {
                status.conflicted.push(path.to_string());
            }
        } else if let Some(path) = entry.strip_prefix("? ") {
            status.untracked.push(path.to_string());
        }
    }
    status
}

pub async fn get_repo_status(root: &Path) -> AppResult<RepoStatus> {
    let out = run_git_ok(
        root,
        &[
            "status",
            "--porcelain=v2",
            "--branch",
            "-z",
            "--untracked-files=all",
        ],
        30,
    )
    .await?;
    Ok(parse_status_v2(&out.stdout))
}

/// Heal a branch created without tracking info: if origin has a branch of the
/// same name, adopt it as upstream so the release guard and auto-sync can
/// reason about what's on GitHub. Runs at targeted moments (repo select,
/// branch switch) rather than on the status poll, because it writes repo config and
/// polling it spawned a doomed extra git process forever on local-only
/// branches. The branch is named explicitly so a racing switch can never
/// attach the upstream to the wrong branch.
pub async fn heal_upstream(root: &Path) -> AppResult<()> {
    let out = run_git_ok(
        root,
        &["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=no"],
        30,
    )
    .await?;
    let status = parse_status_v2(&out.stdout);
    if status.upstream.is_some() || status.branch.is_empty() || status.branch == "(detached)" {
        return Ok(());
    }
    let remote_ref = format!("origin/{}", status.branch);
    let exists = run_git(root, &["rev-parse", "--verify", "--quiet", &remote_ref], 15).await?;
    if exists.ok() {
        let _ = run_git(
            root,
            &[
                "branch",
                &format!("--set-upstream-to={remote_ref}"),
                &status.branch,
            ],
            15,
        )
        .await?;
    }
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct CommitFileChange {
    pub status: String,
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct CommitInfo {
    pub sha: String,
    pub author_name: String,
    pub author_email: String,
    pub date: String,
    pub message: String,
    pub body: String,
    pub files: Vec<CommitFileChange>,
}

pub fn parse_activity_log(stdout: &str) -> Vec<CommitInfo> {
    let mut commits = Vec::new();
    for record in stdout.split('\u{1e}') {
        let record = record.trim_matches(['\n', '\r']);
        if record.is_empty() {
            continue;
        }
        // Format: sha \x1f author \x1f email \x1f date \x1f full-message \x1f
        // followed by --name-status lines. The full message may span lines.
        let fields: Vec<&str> = record.splitn(6, '\u{1f}').collect();
        let [sha, author_name, author_email, date, full_message, rest] = fields[..] else {
            continue;
        };
        let full_message = full_message.trim();
        let (message, body) = match full_message.split_once('\n') {
            Some((subject, body)) => (subject.trim(), body.trim()),
            None => (full_message, ""),
        };

        let mut files = Vec::new();
        for line in rest.lines() {
            let line = line.trim_end();
            if line.is_empty() {
                continue;
            }
            let Some((status, rest)) = line.split_once('\t') else {
                continue;
            };
            // Renames/copies list "old<TAB>new". Show the new name.
            let path = if status.starts_with('R') || status.starts_with('C') {
                rest.rsplit('\t').next().unwrap_or(rest)
            } else {
                rest
            };
            files.push(CommitFileChange {
                status: status.chars().next().unwrap_or('M').to_string(),
                path: path.to_string(),
            });
        }

        commits.push(CommitInfo {
            sha: sha.to_string(),
            author_name: author_name.to_string(),
            author_email: author_email.to_string(),
            date: date.to_string(),
            message: message.to_string(),
            body: body.to_string(),
            files,
        });
    }
    commits
}

#[derive(Debug, Serialize)]
pub struct CommitIdentity {
    pub name: String,
    pub email: String,
}

/// every branch, not just the checked-out one
pub async fn list_commit_identities(root: &Path) -> AppResult<Vec<CommitIdentity>> {
    let out = run_git(
        root,
        &["log", "--all", "-n", "2000", "--format=%an\u{1f}%ae"],
        30,
    )
    .await?;
    if !out.ok() {
        return Ok(Vec::new());
    }
    let mut seen = HashSet::new();
    let mut identities = Vec::new();
    for line in out.stdout.lines() {
        let Some((name, email)) = line.split_once('\u{1f}') else {
            continue;
        };
        if seen.insert((name.to_string(), email.to_string())) {
            identities.push(CommitIdentity {
                name: name.to_string(),
                email: email.to_string(),
            });
        }
    }
    Ok(identities)
}

#[derive(Debug, Serialize)]
pub struct FileCommit {
    pub sha: String,
    pub message: String,
    pub author_name: String,
    pub author_email: String,
    pub date: String,
}

/// Newest first.
pub async fn file_history(root: &Path, rel: &str) -> AppResult<Vec<FileCommit>> {
    let out = run_git(
        root,
        &[
            "-c",
            "core.quotepath=false",
            "log",
            "-n",
            "50",
            "--pretty=format:%H\u{1f}%s\u{1f}%an\u{1f}%ae\u{1f}%aI",
            "--",
            rel,
        ],
        30,
    )
    .await?;
    if !out.ok() {
        return Ok(Vec::new());
    }
    let mut commits = Vec::new();
    for line in out.stdout.lines() {
        let mut parts = line.splitn(5, '\u{1f}');
        let (Some(sha), Some(message), Some(author_name), Some(author_email), Some(date)) = (
            parts.next(),
            parts.next(),
            parts.next(),
            parts.next(),
            parts.next(),
        ) else {
            continue;
        };
        commits.push(FileCommit {
            sha: sha.to_string(),
            message: message.to_string(),
            author_name: author_name.to_string(),
            author_email: author_email.to_string(),
            date: date.to_string(),
        });
    }
    Ok(commits)
}

#[derive(Debug, Serialize)]
pub struct CommitStat {
    pub date: String,
    pub author_name: String,
    pub author_email: String,
    pub file_count: usize,
}

/// Lightweight commit history for charts: when, who, how many files. Covers
/// far more commits than the Activity list without carrying every path.
pub async fn commit_stats(root: &Path, limit: u32) -> AppResult<Vec<CommitStat>> {
    let count = format!("-n{limit}");
    let out = run_git(
        root,
        &[
            "-c",
            "core.quotepath=false",
            "log",
            // Progress is about the whole project, not just the branch you
            // happen to have checked out.
            "--all",
            &count,
            "--pretty=format:\u{1e}%aI\u{1f}%an\u{1f}%ae",
            "--name-only",
        ],
        30,
    )
    .await?;
    if !out.ok() {
        return Ok(Vec::new());
    }
    let mut stats = Vec::new();
    for record in out.stdout.split('\u{1e}') {
        let record = record.trim_matches(['\n', '\r']);
        if record.is_empty() {
            continue;
        }
        let mut lines = record.lines();
        let Some(header) = lines.next() else { continue };
        let mut fields = header.splitn(3, '\u{1f}');
        let (Some(date), Some(author_name), Some(author_email)) =
            (fields.next(), fields.next(), fields.next())
        else {
            continue;
        };
        let file_count = lines.filter(|l| !l.trim().is_empty()).count();
        stats.push(CommitStat {
            date: date.to_string(),
            author_name: author_name.to_string(),
            author_email: author_email.to_string(),
            file_count,
        });
    }
    Ok(stats)
}

/// `all_branches` widens the log past the checked-out branch. The Activity
/// panel wants this branch's story; the Progress page wants the project's.
pub async fn get_activity(
    root: &Path,
    limit: u32,
    all_branches: bool,
) -> AppResult<Vec<CommitInfo>> {
    let count = format!("-n{limit}");
    let mut args = vec!["log"];
    if all_branches {
        args.push("--all");
    }
    args.extend([
        count.as_str(),
        "--pretty=format:\u{1e}%H\u{1f}%an\u{1f}%ae\u{1f}%aI\u{1f}%B\u{1f}",
        "--name-status",
    ]);
    let out = run_git(root, &args, 30).await?;
    if !out.ok() {
        // Empty repo or unborn branch. Just show nothing.
        return Ok(Vec::new());
    }
    Ok(parse_activity_log(&out.stdout))
}

/// Only what git currently calls untracked gets moved. Returns the folder.
pub async fn set_aside_untracked(root: &Path, files: Vec<String>) -> AppResult<String> {
    let status = get_repo_status(root).await?;
    let untracked: HashSet<String> = status.untracked.into_iter().collect();

    let repo_name = root
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("repo")
        .to_string();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let backup_dir = root
        .parent()
        .unwrap_or(root)
        .join(format!("{repo_name}-SetAside"))
        .join(stamp.to_string());

    for rel in &files {
        if !untracked.contains(rel) {
            return Err(AppError::new("INVALID", messages::refusing_to_move(rel)));
        }
    }

    for rel in &files {
        let from = root.join(rel);
        if !from.exists() {
            continue;
        }
        let to = backup_dir.join(rel);
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::rename(&from, &to)?;
    }

    Ok(backup_dir.to_string_lossy().into_owned())
}

/// Clears stuck cross-branch leftovers, once SolidWorks release them
pub async fn extract_version(root: &Path, path: &str, sha: &str) -> AppResult<std::path::PathBuf> {
    let ext = std::path::Path::new(path)
        .extension()
        .map(|e| e.to_string_lossy().into_owned())
        .unwrap_or_else(|| "dat".into());
    let short: String = sha.chars().take(12).collect();
    let stem: String = path
        .rsplit('/')
        .next()
        .unwrap_or("file")
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let out_path = std::env::temp_dir().join(format!("solidlocker-{short}-{stem}.{ext}"));

    let spec = format!("{sha}:{path}");
    let (ok, mut bytes, err) =
        crate::proc::run_git_bytes(root, &["show", &spec], None, 60).await?;
    if !ok {
        return Err(AppError::git(messages::could_not_read_old_version(
            err.trim(),
        )));
    }

    if bytes.starts_with(b"version https://git-lfs.github.com/spec/v1") {
        let (ok, content, err) =
            crate::proc::run_git_bytes(root, &["lfs", "smudge"], Some(&bytes), 300).await?;
        if !ok {
            return Err(AppError::git(messages::could_not_read_old_version(
                err.trim(),
            )));
        }
        bytes = content;
    }

    std::fs::write(&out_path, &bytes).map_err(|e| AppError::new("RESTORE", e.to_string()))?;
    Ok(out_path)
}


/// Restore by branching forward
pub async fn restore_version(root: &Path, path: &str, sha: &str) -> AppResult<()> {
    let out = run_git(root, &["checkout", sha, "--", path], 300).await?;
    if out.ok() {
        Ok(())
    } else {
        Err(AppError::git(messages::could_not_restore_version(
            out.stderr.trim(),
        )))
    }
}

pub async fn restore_paths(root: &Path, files: Vec<String>) -> AppResult<()> {
    if files.is_empty() {
        return Ok(());
    }
    let mut args = vec!["restore", "--staged", "--worktree", "--"];
    args.extend(files.iter().map(String::as_str));
    let out = run_git(root, &args, 60).await?;
    if out.ok() {
        Ok(())
    } else {
        Err(AppError::git(messages::could_not_fix_files(
            out.stderr.trim(),
        )))
    }
}

pub fn repo_name_from_url(url: &str) -> Option<String> {
    let trimmed = url.trim().trim_end_matches('/').trim_end_matches(".git");
    let name = trimmed.rsplit(['/', ':']).next()?;
    if name.is_empty() {
        return None;
    }
    Some(name.to_string())
}

pub async fn clone_repo(
    url: &str,
    dest_parent: &Path,
    mut on_progress: impl FnMut(String),
) -> AppResult<PathBuf> {
    let url = url.trim();
    if parse_slug_from_remote(url).is_none() {
        return Err(AppError::new("REPO", messages::NOT_A_GITHUB_URL));
    }
    let name = repo_name_from_url(url)
        .ok_or_else(|| AppError::new("REPO", messages::NO_REPO_NAME_IN_URL))?;
    let dest = dest_parent.join(&name);
    if dest.exists() {
        return Err(AppError::new("REPO", messages::clone_folder_exists(&name)));
    }

    use std::process::Stdio;
    use tokio::io::AsyncReadExt;

    // Filters must exist BEFORE cloning, or every CAD file arrives as a
    // pointer file that SolidWorks cannot open.
    ensure_lfs_filters(dest_parent).await;

    let mut cmd = tokio::process::Command::new("git");
    cmd.arg("clone")
        .arg("--progress")
        .arg(url)
        .arg(&dest)
        .current_dir(dest_parent)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::new("SPAWN", format!("could not run git: {e}")))?;

    let mut stderr = child.stderr.take().expect("stderr piped");
    let mut buf = [0u8; 4096];
    let mut line = String::new();
    let mut tail: Vec<String> = Vec::new();
    loop {
        let n = stderr.read(&mut buf).await.unwrap_or(0);
        if n == 0 {
            break;
        }
        for &b in &buf[..n] {
            if b == b'\r' || b == b'\n' {
                let msg = line.trim().to_string();
                if !msg.is_empty() {
                    tail.push(msg.clone());
                    if tail.len() > 10 {
                        tail.remove(0);
                    }
                    on_progress(msg);
                }
                line.clear();
            } else {
                line.push(b as char);
            }
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| AppError::new("SPAWN", e.to_string()))?;
    if !status.success() {
        return Err(AppError::new(
            "REPO",
            format!("Clone failed: {}", tail.join(" · ")),
        ));
    }

    run_git_ok(
        &dest,
        &["config", "--local", "lfs.setlockablereadonly", "true"],
        15,
    )
    .await?;
    // Insurance: if the filters were installed only moments ago, some files
    // may still be pointers. A no-op when everything already arrived.
    on_progress("Getting the CAD files…".to_string());
    let _ = run_git(&dest, &["lfs", "pull"], 900).await;
    Ok(dest)
}

pub async fn remote_branches(root: &Path) -> AppResult<Vec<String>> {
    let out = run_git_ok(
        root,
        &[
            "for-each-ref",
            "--format=%(refname:short)",
            "refs/remotes/origin",
        ],
        30,
    )
    .await?;
    Ok(out
        .stdout
        .lines()
        .filter_map(|l| l.trim().strip_prefix("origin/"))
        .filter(|b| *b != "HEAD" && !b.is_empty())
        .map(String::from)
        .collect())
}

/// One line per team branch
#[derive(serde::Serialize)]
pub struct BranchSummary {
    pub name: String,
    pub last_commit_at: i64,
    pub author: String,
    pub subject: String,
    pub ahead: u32,
    pub behind: u32,
    pub is_default: bool,
}

async fn default_branch(root: &Path) -> String {
    if let Ok(out) = run_git(root, &["symbolic-ref", "refs/remotes/origin/HEAD"], 15).await {
        if out.ok() {
            if let Some(name) = out.stdout.trim().strip_prefix("refs/remotes/origin/") {
                if !name.is_empty() {
                    return name.to_string();
                    
                }
            }
        }
    }
    for candidate in ["main", "master"] {
        let refname = format!("refs/remotes/origin/{candidate}");
        if run_git(root, &["show-ref", "--verify", "--quiet", &refname], 15)
            .await
            .map(|o| o.ok())
            .unwrap_or(false)
        {
            return candidate.to_string();
        }
    }
    "main".to_string()
}

pub async fn branch_overview(root: &Path) -> AppResult<Vec<BranchSummary>> {
    let default = default_branch(root).await;

    let out = run_git_ok(
        root,
        &[
            "for-each-ref",
            "--format=%(refname:short)\t%(committerdate:unix)\t%(authorname)\t%(subject)",
            "refs/remotes/origin",
        ],
        30,
    )
    .await?;

    let mut branches = Vec::new();
    for line in out.stdout.lines() {
        let mut parts = line.splitn(4, '\t');
        let (Some(refname), Some(when), Some(author)) =
            (parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        let subject = parts.next().unwrap_or("").trim().to_string();
        let Some(name) = refname.trim().strip_prefix("origin/") else {
            continue;
        };
        if name.is_empty() || name == "HEAD" {
            continue;
        }

        let is_default = name == default;
        // One rev-list per branch. Teams have a handful, not hundreds.
        let (ahead, behind) = if is_default {
            (0, 0)
        } else {
            let range = format!("origin/{default}...origin/{name}");
            match run_git(root, &["rev-list", "--left-right", "--count", &range], 20).await {
                Ok(counts) if counts.ok() => {
                    let mut it = counts.stdout.split_whitespace();
                    let behind = it.next().and_then(|n| n.parse().ok()).unwrap_or(0);
                    let ahead = it.next().and_then(|n| n.parse().ok()).unwrap_or(0);
                    (ahead, behind)
                }
                _ => (0, 0),                    // No common ancestor
            }
        };

        branches.push(BranchSummary {
            name: name.to_string(),
            last_commit_at: when.trim().parse().unwrap_or(0),
            author: author.trim().to_string(),
            subject,
            ahead,
            behind,
            is_default,
        });
    }

    branches.sort_by(|a, b| b.last_commit_at.cmp(&a.last_commit_at));
    Ok(branches)
}

/// Reads already-fetched refs, so it is only as accurate as the last fetch.
pub async fn locate_paths_in_branches(
    root: &Path,
    paths: Vec<String>,
) -> AppResult<std::collections::HashMap<String, Vec<String>>> {
    let wanted: Vec<(String, String)> = paths
        .iter()
        .map(|p| (p.clone(), p.to_lowercase()))
        .collect();
    let mut result: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();

    for branch in remote_branches(root).await? {
        let tree = run_git(
            root,
            &[
                "ls-tree",
                "-r",
                "--name-only",
                "-z",
                &format!("origin/{branch}"),
            ],
            60,
        )
        .await?;
        if !tree.ok() {
            continue;
        }
        let files: std::collections::HashSet<String> = tree
            .stdout
            .split('\0')
            .filter(|s| !s.is_empty())
            .map(|s| s.to_lowercase())
            .collect();
        for (original, lower) in &wanted {
            if files.contains(lower) {
                result.entry(original.clone()).or_default().push(branch.clone());
            }
        }
    }
    Ok(result)
}

#[derive(Debug, Default, Serialize)]
pub struct SwitchResult {
    /// Files still carrying the previous branch's content because a program
    /// (usually SolidWorks) had them open while git tried to swap them.
    /// Safe to restore: that content is committed on the branch we left.
    pub stuck_files: Vec<String>,
    /// Files that were written while the switch was running. Unsaved work,
    /// left exactly as it is. Never restore these.
    pub kept_files: Vec<String>,
}

/// Is the file on disk identical to the version in `commit`?
///
/// Compared with `git diff` rather than hashing the file, because the
/// committed blob of a CAD file is an LFS pointer: hashing the working copy
/// would compare megabytes of geometry against 130 bytes of pointer and
/// never match. `git diff` runs the clean filter and compares like for like.
async fn matches_commit(root: &Path, commit: &str, path: &str) -> bool {
    run_git(root, &["diff", "--quiet", commit, "--", path], 60)
        .await
        .map(|out| out.status == 0)
        .unwrap_or(false)
}

/// The switch guard requires a clean tree, so a dirty file right after a
/// successful switch is one of two things, and they must not be confused:
///
/// - A swap Windows blocked because SolidWorks held the file open. It still
///   holds the previous branch's committed bytes, so restoring it costs
///   nothing and puts the branch right.
/// - A file something wrote *during* the switch. That is unsaved work, and
///   restoring it would delete work with no undo and no warning.
///
/// Comparing against the commit we just left tells them apart. Anything that
/// is not a verbatim copy of the old branch is left alone and reported.
async fn finish_switch(root: &Path, prev_head: Option<&str>) -> SwitchResult {
    let _ = heal_upstream(root).await;
    let real_dirty = |s: RepoStatus| -> Vec<String> {
        s.dirty.into_iter().filter(|p| !is_sw_temp(p)).collect()
    };
    let dirty = match get_repo_status(root).await {
        Ok(s) => real_dirty(s),
        Err(_) => Vec::new(),
    };
    if dirty.is_empty() {
        return SwitchResult::default();
    }

    //     if !files.is_empty() {
    //         let mut args = vec!["restore", "--staged", "--worktree", "--"];
    //         args.extend(files.iter().map(String::as_str));
    //         let _ = run_git(root, &args, 60).await;
    //         files = match get_repo_status(root).await {
    //             Ok(s) => stuck(s),
    //             Err(_) => files,
    //         };
    //     }



    // TODO: one git diff per bad file one after another. Too slow if there are a bunch stuck, worth batching if anyone hits it
    let mut blocked = Vec::new();
    let mut kept = Vec::new();
    for path in dirty {
        // No commit to compare against means no way to prove the file is disposable, so keep it.
        match prev_head {
            Some(head) if matches_commit(root, head, &path).await => blocked.push(path),
            _ => kept.push(path),
        }
    }

    if !blocked.is_empty() {
        let mut args = vec!["restore", "--staged", "--worktree", "--"];
        args.extend(blocked.iter().map(String::as_str));
        let _ = run_git(root, &args, 60).await;
        // Whatever is still dirty is genuinely stuck: SolidWorks has not let
        // go of it yet, and the user has to close it before we can retry.
        if let Ok(s) = get_repo_status(root).await {
            let still = real_dirty(s);
            blocked.retain(|p| still.contains(p));
        }
    }

    SwitchResult {
        stuck_files: blocked,
        kept_files: kept,
    }
}

pub async fn switch_branch(root: &Path, name: &str) -> AppResult<SwitchResult> {
    let status = get_repo_status(root).await?;
    let real_dirty = status.dirty.iter().any(|p| !is_sw_temp(p));
    if !status.conflicted.is_empty() || real_dirty {
        return Err(AppError::new("NEEDS_COMMIT", messages::SWITCH_NEEDS_COMMIT));
    }

    // Tracked ~$ SolidWorks temp files (committed by hand before SolidLocker) go
    // dirty whenever SolidWorks opens/closes a document and would make git
    // refuse the switch. They are junk, so discard their local state up front.
    // Best effort: if SolidWorks holds one open the restore fails and the
    // switch error below explains itself.
    let junk_dirty: Vec<&str> = status
        .dirty
        .iter()
        .filter(|p| is_sw_temp(p))
        .map(String::as_str)
        .collect();
    if !junk_dirty.is_empty() {
        let mut args = vec!["restore", "--staged", "--worktree", "--"];
        args.extend(&junk_dirty);
        let _ = run_git(root, &args, 30).await;
    }

    // Refresh remote refs so new branches are switchable; tolerate offline.
    let _ = run_git(root, &["fetch", "origin"], 120).await;

    // Where we are standing right now. After the switch this is the only way
    // to tell a file git could not swap (still the old branch's bytes) from
    // one that was written while the switch ran (unsaved work).
    let prev_head = run_git(root, &["rev-parse", "HEAD"], 15)
        .await
        .ok()
        .filter(|out| out.ok())
        .map(|out| out.stdout.trim().to_string());

    let mut last_err = String::new();
    // Retry briefly: a background poll may hold the index lock for a moment.
    for _ in 0..3 {
        let sw = run_git(root, &["switch", name], 60).await?;
        if sw.ok() {
            return Ok(finish_switch(root, prev_head.as_deref()).await);
        }
        last_err = sw.stderr.trim().to_string();
        if last_err.contains("index.lock") {
            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
            continue;
        }
        break;
    }

    // Translate git's refusal into something a non-git user can act on.
    if last_err.contains("would be overwritten by checkout")
        || last_err.contains("would be overwritten by merge")
    {
        let files: Vec<String> = last_err
            .lines()
            .filter(|l| l.starts_with('\t') || l.starts_with("        "))
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect();
        // Only untracked files can be set aside; a tracked file in this list
        // (e.g. a ~$ temp SolidWorks still holds open) needs different advice.
        let untracked: HashSet<&str> = status.untracked.iter().map(String::as_str).collect();
        let all_untracked = !files.is_empty() && files.iter().all(|f| untracked.contains(f.as_str()));
        if all_untracked {
            return Err(AppError::with_detail(
                "UNTRACKED_COLLISION",
                messages::untracked_collision(name),
                serde_json::json!({ "files": files, "branch": name }),
            ));
        }
        return Err(AppError::with_detail(
            "GIT",
            messages::files_block_switch(name, &files.join(", ")),
            serde_json::json!({ "files": files, "branch": name }),
        ));
    }

    // Fall back to explicit tracking only when the local branch doesn't exist
    // yet. Never for other failures, whose real error we must not mask.
    let branch_missing = last_err.contains("invalid reference")
        || last_err.contains("did not match any");
    if branch_missing {
        let remote_ref = format!("origin/{name}");
        let exists =
            run_git(root, &["rev-parse", "--verify", "--quiet", &remote_ref], 15).await?;
        if exists.ok() {
            let tracked = run_git(root, &["switch", "--track", &remote_ref], 60).await?;
            if tracked.ok() {
                return Ok(finish_switch(root, prev_head.as_deref()).await);
            }
            if !tracked.stderr.trim().is_empty() {
                last_err = tracked.stderr.trim().to_string();
            }
        }
    }

    Err(AppError::git(if last_err.is_empty() {
        messages::could_not_switch(name)
    } else {
        last_err
    }))
}

#[derive(Debug, Serialize, Clone)]
pub struct FileEntry {
    pub rel_path: String,
    pub name: String,
    pub dir: String,
    pub size: u64,
    /// Newest commit touching the file, unix milliseconds; 0 when unknown.
    pub modified: u64,
    /// When the file was added to the project, unix milliseconds; 0 unknown.
    pub added: u64,
    pub writable: bool,
    /// False for a file that exists locally but has never been shared.
    pub tracked: bool,
    /// Deleted from disk, but the deletion has not been shared yet.
    pub deleted: bool,
}

pub async fn list_lockable_files(root: &Path) -> AppResult<Vec<FileEntry>> {
    // Tracked files, plus new ones that are not shared yet (respecting
    // .gitignore) so a part someone just created still shows up.
    let ls = run_git_ok(
        root,
        &["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        30,
    )
    .await?;
    let all_paths: Vec<&str> = ls
        .stdout
        .split('\0')
        .filter(|s| !s.is_empty())
        .collect();
    if all_paths.is_empty() {
        return Ok(Vec::new());
    }

    let cached = run_git_ok(root, &["ls-files", "-z", "--cached"], 30).await?;
    let tracked_paths: HashSet<&str> = cached
        .stdout
        .split('\0')
        .filter(|s| !s.is_empty())
        .collect();

    let stdin_data = all_paths.join("\0").into_bytes();
    let attr = run_git_stdin(
        root,
        &["check-attr", "--stdin", "-z", "lockable"],
        &stdin_data,
        30,
    )
    .await?;
    if attr.status != 0 {
        return Err(AppError::git(format!(
            "git check-attr failed: {}",
            attr.stderr.trim()
        )));
    }

    // "Last changed" = the newest commit touching the file. Filesystem mtimes
    // lie: every checkout, clone, or merge rewrites files and restamps them.
    let mut commit_times: HashMap<String, u64> = HashMap::new();
    let log = run_git(
        root,
        &[
            "-c",
            "core.quotepath=false",
            "log",
            "-n",
            "1000",
            "--pretty=format:>%ct",
            "--name-only",
        ],
        30,
    )
    .await;
    if let Ok(out) = log {
        if out.ok() {
            let mut current: u64 = 0;
            for line in out.stdout.lines() {
                if let Some(ts) = line.strip_prefix('>') {
                    current = ts.trim().parse().unwrap_or(0);
                } else {
                    let p = line.trim();
                    if !p.is_empty() {
                        // Newest-first log: first sighting wins.
                        commit_times.entry(p.to_lowercase()).or_insert(current);
                    }
                }
            }
        }
    }

    // When was each file ADDED (newest add wins, for delete-and-re-add).
    let mut added_times: HashMap<String, u64> = HashMap::new();
    let log_added = run_git(
        root,
        &[
            "-c",
            "core.quotepath=false",
            "log",
            "-n",
            "1000",
            "--diff-filter=A",
            "--pretty=format:>%ct",
            "--name-only",
        ],
        30,
    )
    .await;
    if let Ok(out) = log_added {
        if out.ok() {
            let mut current: u64 = 0;
            for line in out.stdout.lines() {
                if let Some(ts) = line.strip_prefix('>') {
                    current = ts.trim().parse().unwrap_or(0);
                } else {
                    let p = line.trim();
                    if !p.is_empty() {
                        added_times.entry(p.to_lowercase()).or_insert(current);
                    }
                }
            }
        }
    }

    let fields: Vec<&str> = attr.stdout.split('\0').collect();
    let mut files = Vec::new();
    for chunk in fields.chunks(3) {
        let [path, attr_name, value] = chunk else {
            continue;
        };
        if *attr_name != "lockable" || *value != "set" {
            continue;
        }
        let rel_path = path.to_string();
        let name = rel_path
            .rsplit('/')
            .next()
            .unwrap_or(&rel_path)
            .to_string();
        if is_sw_temp(&name) {
            continue;
        }
        let dir = match rel_path.rfind('/') {
            Some(i) => rel_path[..i].to_string(),
            None => String::new(),
        };
        let abs = root.join(&rel_path);
        // A tracked file missing from disk was deleted but not shared yet.
        // Keep it listed and marked, so the deletion is visible rather than
        // just making the row disappear.
        let deleted = !abs.is_file();
        let size = std::fs::metadata(&abs).map(|m| m.len()).unwrap_or(0);
        let modified = commit_times
            .get(&rel_path.to_lowercase())
            .map(|t| t * 1000)
            .unwrap_or(0);
        let added = added_times
            .get(&rel_path.to_lowercase())
            .map(|t| t * 1000)
            .unwrap_or(0);
        let writable = fsattr::is_writable(&abs);
        let tracked = tracked_paths.contains(rel_path.as_str());
        files.push(FileEntry {
            rel_path,
            name,
            dir,
            size,
            modified,
            added,
            writable,
            tracked,
            deleted,
        });
    }
    files.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::parse_activity_log;
    use super::parse_slug_from_remote;

    #[test]
    fn parses_activity_records() {
        let log = "\u{1e}abc123\u{1f}Alice\u{1f}1+alice@users.noreply.github.com\u{1f}2026-08-13T10:00:00-04:00\u{1f}Thicken spar\n\nNeeded for the new motor mount.\nAlso rechecked mates.\n\u{1f}\nM\t01-Wing/spar.sldprt\nA\t01-Wing/Ribs/rib-03.sldprt\n\n\u{1e}def456\u{1f}Bob\u{1f}bob@example.com\u{1f}2026-08-12T09:00:00-04:00\u{1f}Rename panel\n\u{1f}\nR100\told name.sldprt\tnew name.sldprt\n";
        let commits = parse_activity_log(log);
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].message, "Thicken spar");
        assert_eq!(
            commits[0].body,
            "Needed for the new motor mount.\nAlso rechecked mates."
        );
        assert_eq!(commits[0].files.len(), 2);
        assert_eq!(commits[0].files[1].status, "A");
        assert_eq!(commits[1].message, "Rename panel");
        assert_eq!(commits[1].body, "");
        assert_eq!(commits[1].files[0].path, "new name.sldprt");
        assert_eq!(commits[1].files[0].status, "R");
    }

    #[test]
    fn parses_https_and_ssh_remotes() {
        assert_eq!(
            parse_slug_from_remote("https://github.com/scavenx/solidworks-collab-test.git"),
            Some("scavenx/solidworks-collab-test".into())
        );
        assert_eq!(
            parse_slug_from_remote("git@github.com:org/repo.git"),
            Some("org/repo".into())
        );
        assert_eq!(
            parse_slug_from_remote("https://user:token@github.com/org/repo"),
            Some("org/repo".into())
        );
        assert_eq!(parse_slug_from_remote("https://gitlab.com/org/repo"), None);
    }
}
