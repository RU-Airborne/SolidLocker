//! Merge conflicts on CAD files.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::messages;
use crate::proc::{run_git, run_git_probe};

#[derive(Debug, Serialize, Default, Clone)]
pub struct SideInfo {
    pub sha: String,
    pub author: String,
    pub author_email: String,
    pub date: String,
    pub subject: String,
    pub present: bool,
    pub git_ref: String,
    pub full_sha: String,
}

#[derive(Debug, Serialize)]
pub struct Conflict {
    pub path: String,
    pub is_cad: bool,
    pub resolved: Option<String>,
    pub mine: SideInfo,
    pub theirs: SideInfo,
}

const SEP: char = '\u{1f}';

async fn last_change(root: &Path, git_ref: &str, path: &str) -> SideInfo {
    let format = format!(
        "--format=%H{s}%an{s}%ae{s}%aI{s}%s",
        s = SEP,
    );
    let Ok(out) = run_git(root, &["log", "-1", &format, git_ref, "--", path], 30).await
    else {
        return SideInfo::default();
    };
    if !out.ok() {
        return SideInfo::default();
    }
    let mut parts = out.stdout.trim().split(SEP);
    let full = parts.next().unwrap_or("").to_string();
    SideInfo {
        full_sha: full.clone(),
        sha: full.chars().take(8).collect(),
        author: parts.next().unwrap_or("").to_string(),
        author_email: parts.next().unwrap_or("").to_string(),
        date: parts.next().unwrap_or("").to_string(),
        subject: parts.next().unwrap_or("").to_string(),
        present: true,
        git_ref: git_ref.to_string(),
    }
}

async fn ref_has(root: &Path, git_ref: &str, path: &str) -> bool {
    run_git_probe(root, &["cat-file", "-e", &format!("{git_ref}:{path}")], 15).await
}

/// Stage 2 is ours, 3 is theirs; a deleted side has no entry.
async fn side_has(root: &Path, stage: u8, path: &str) -> bool {
    run_git_probe(root, &["cat-file", "-e", &format!(":{stage}:{path}")], 15).await
}

fn is_cad(path: &str) -> bool {
    let l = path.to_lowercase();
    l.ends_with(".sldprt") || l.ends_with(".sldasm") || l.ends_with(".slddrw")
}

/// Branch names of the two sides of the open merge.
pub async fn sides(root: &Path) -> AppResult<(String, String)> {
    let ours = run_git(root, &["rev-parse", "--abbrev-ref", "HEAD"], 15)
        .await
        .map(|o| o.stdout.trim().to_string())
        .unwrap_or_default();

    // MERGE_HEAD is only a hash; the name is in MERGE_MSG
    let theirs = std::fs::read_to_string(root.join(".git/MERGE_MSG"))
        .ok()
        .and_then(|msg| {
            // Merge branch 'wings' into full-assembly
            let first = msg.lines().next()?.to_string();
            let quote = '\'';
            let from = first.find(quote)? + 1;
            let to = first[from..].find(quote)? + from;
            let name = &first[from..to];
            Some(name.strip_prefix("origin/").unwrap_or(name).to_string())
        })
        .unwrap_or_else(|| "the other branch".to_string());

    Ok((ours, theirs))
}

pub async fn merge_in_progress(root: &Path) -> bool {
    root.join(".git/MERGE_HEAD").is_file()
}

/// Conflicted files in the open merge. Still at stages 2/3 = unresolved;
/// staged back to stage 0 = picked.
pub async fn list(root: &Path) -> AppResult<Vec<Conflict>> {
    if !merge_in_progress(root).await {
        return Ok(Vec::new());
    }
    let out = run_git(root, &["diff", "--name-only", "--diff-filter=U", "-z"], 60).await?;
    if !out.ok() {
        return Ok(Vec::new());
    }
    let unresolved: Vec<String> = out
        .stdout
        .split('\0')
        .filter(|p| !p.is_empty())
        .map(|p| p.to_string())
        .collect();

    // keep already-picked files in the list too
    let all = run_git(root, &["diff", "--name-only", "-z", "--diff-filter=UAM", "HEAD"], 60).await?;
    let mut seen: Vec<String> = unresolved.clone();
    if all.ok() {
        for p in all.stdout.split('\0').filter(|p| !p.is_empty()) {
            if !seen.iter().any(|s| s == p) && was_conflicted(root, p).await {
                seen.push(p.to_string());
            }
        }
    }
    seen.sort_by_key(|p| p.to_lowercase());

    let mut out = Vec::new();
    for path in seen {
        let mut mine = last_change(root, "HEAD", &path).await;
        let mut theirs = last_change(root, "MERGE_HEAD", &path).await;
        mine.present = side_has(root, 2, &path).await;
        theirs.present = side_has(root, 3, &path).await;
        mine.git_ref = ":2".to_string();
        theirs.git_ref = ":3".to_string();
        out.push(Conflict {
            is_cad: is_cad(&path),
            resolved: if unresolved.contains(&path) {
                None
            } else {
                Some("picked".to_string())
            },
            path,
            mine,
            theirs,
        });
    }
    Ok(out)
}

async fn was_conflicted(root: &Path, path: &str) -> bool {
    run_git(root, &["log", "--merge", "--oneline", "-1", "--", path], 30)
        .await
        .map(|o| o.ok() && !o.stdout.trim().is_empty())
        .unwrap_or(false)
}

/// Write one side of a conflicted file to a temp file.
pub async fn extract_side(root: &Path, path: &str, side: &str) -> AppResult<PathBuf> {
    let stage = match side {
        "mine" => "2",
        "theirs" => "3",
        _ => return Err(AppError::new("CONFLICT", messages::UNKNOWN_SIDE)),
    };
    let (ok, bytes, err) =
        crate::proc::run_git_bytes(root, &["show", &format!(":{stage}:{path}")], None, 120)
            .await?;
    if !ok {
        return Err(AppError::git(err.trim().to_string()));
    }

    // the index holds the LFS pointer, not the part
    let bytes = if bytes.starts_with(b"version https://git-lfs.github.com/spec/v1") {
        let (ok, real, err) =
            crate::proc::run_git_bytes(root, &["lfs", "smudge"], Some(&bytes), 300).await?;
        if !ok {
            return Err(AppError::git(err.trim().to_string()));
        }
        real
    } else {
        bytes
    };

    let name = path.rsplit('/').next().unwrap_or(path);
    let scratch = std::env::temp_dir().join(format!(
        "solidlocker-{side}-{}-{}",
        std::process::id(),
        name.replace(' ', "_")
    ));
    std::fs::write(&scratch, bytes).map_err(AppError::from)?;
    Ok(scratch)
}

/// Files that would clash merging `branch` into HEAD. Touches nothing.
pub async fn plan(root: &Path, branch: &str) -> AppResult<Vec<Conflict>> {
    let preview = crate::workflow::merge_preview(root, branch).await?;
    let theirs_ref = crate::workflow::merge_ref_for(root, branch).await;

    let mut out = Vec::new();
    for path in preview.conflicts {
        let mut mine = last_change(root, "HEAD", &path).await;
        let mut theirs = last_change(root, &theirs_ref, &path).await;
        mine.present = ref_has(root, "HEAD", &path).await;
        theirs.present = ref_has(root, &theirs_ref, &path).await;
        out.push(Conflict {
            is_cad: is_cad(&path),
            resolved: None,
            path,
            mine,
            theirs,
        });
    }
    out.sort_by_key(|c| c.path.to_lowercase());
    Ok(out)
}

/// Same as `plan`, between any two refs; independent of the working copy.
pub async fn plan_between(root: &Path, base_ref: &str, head_ref: &str) -> AppResult<Vec<Conflict>> {
    let mt = run_git(
        root,
        &[
            "merge-tree",
            "--write-tree",
            "--no-messages",
            "--name-only",
            base_ref,
            head_ref,
        ],
        60,
    )
    .await?;
    let mut paths: Vec<String> = Vec::new();
    if mt.status == 1 {
        for line in mt.stdout.lines().skip(1).map(str::trim) {
            if !line.is_empty() && line != ".gitattributes" && !paths.iter().any(|p| p == line) {
                paths.push(line.to_string());
            }
        }
    }

    let mut out = Vec::new();
    for path in paths {
        let mut mine = last_change(root, base_ref, &path).await;
        let mut theirs = last_change(root, head_ref, &path).await;
        mine.present = ref_has(root, base_ref, &path).await;
        theirs.present = ref_has(root, head_ref, &path).await;
        out.push(Conflict {
            is_cad: is_cad(&path),
            resolved: None,
            path,
            mine,
            theirs,
        });
    }
    out.sort_by_key(|c| c.path.to_lowercase());
    Ok(out)
}

/// A past merge read back from its commit: the two parents and how each
/// clash was settled.
#[derive(Debug, Serialize)]
pub struct MergedPlan {
    pub base_sha: String,
    pub head_sha: String,
    pub files: Vec<Conflict>,
}

/// Empty plan for anything that isn't a two-parent merge (squash, rebase).
pub async fn merged_picks(root: &Path, merge_sha: &str) -> AppResult<MergedPlan> {
    let out = run_git(root, &["rev-list", "--parents", "-n", "1", merge_sha], 30).await?;
    let mut ids = out.stdout.split_whitespace().map(str::to_string);
    let (Some(_merge), Some(base_sha), Some(head_sha)) = (ids.next(), ids.next(), ids.next())
    else {
        return Ok(MergedPlan {
            base_sha: String::new(),
            head_sha: String::new(),
            files: Vec::new(),
        });
    };
    let mut files = plan_between(root, &base_sha, &head_sha).await?;
    for c in &mut files {
        let kept = blob_id(root, merge_sha, &c.path).await;
        let mine = blob_id(root, &base_sha, &c.path).await;
        let theirs = blob_id(root, &head_sha, &c.path).await;
        c.resolved = Some(
            if kept == mine {
                "mine"
            } else if kept == theirs {
                "theirs"
            } else {
                "other"
            }
            .to_string(),
        );
    }
    Ok(MergedPlan {
        base_sha,
        head_sha,
        files,
    })
}

/// "" when the path isn't in the commit.
async fn blob_id(root: &Path, commit: &str, path: &str) -> String {
    match run_git(root, &["rev-parse", "--verify", "--quiet", &format!("{commit}:{path}")], 15).await {
        Ok(o) if o.ok() => o.stdout.trim().to_string(),
        _ => String::new(),
    }
}

/// Merge `branch`, apply the picks, commit, push.
pub async fn combine_with_picks(root: &Path, branch: &str, picks: &[Pick]) -> AppResult<()> {
    match crate::workflow::merge_branch(root, branch).await {
        Ok(_) => {
            crate::logger::info(format!("merged {branch}: nothing clashed after all"));
        }
        Err(e) if e.code == "CONFLICT" => {
            // merge_branch aborts on conflict; redo it and leave it open
            let merge_ref = crate::workflow::merge_ref_for(root, branch).await;
            let again = run_git(root, &["merge", "--no-edit", &merge_ref], 300).await?;
            if again.ok() || !merge_in_progress(root).await {
                return Err(e);
            }
            for pick in picks {
                resolve(root, &pick.path, &pick.side).await?;
            }
            let left = list(root).await?;
            let unresolved = left.iter().filter(|c| c.resolved.is_none()).count();
            if unresolved > 0 {
                // branch moved since the picks were made
                let _ = run_git(root, &["merge", "--abort"], 60).await;
                return Err(AppError::new(
                    "CONFLICT",
                    messages::conflicts_changed_underneath(unresolved),
                ));
            }
            let out = run_git(root, &["commit", "--no-edit"], 120).await?;
            if !out.ok() {
                return Err(AppError::git(out.stderr.trim().to_string()));
            }
            crate::logger::info(format!(
                "merged {branch}: {} clash(es) settled",
                picks.len()
            ));
        }
        Err(e) => return Err(e),
    }

    let status = crate::repo::get_repo_status(root).await?;
    let args = crate::repo::push_args(&status);
    let pushed = run_git(root, &args, 600).await?;
    if !pushed.ok() {
        return Err(AppError::offline(messages::CONFLICTS_SETTLED_NOT_SHARED));
    }
    crate::logger::info("merged result shared with GitHub");
    Ok(())
}

/// Check out one side of a conflicted file and stage it.
pub async fn resolve(root: &Path, path: &str, side: &str) -> AppResult<()> {
    let flag = match side {
        "mine" => "--ours",
        "theirs" => "--theirs",
        _ => return Err(AppError::new("CONFLICT", messages::UNKNOWN_SIDE)),
    };
    let co = run_git(root, &["checkout", flag, "--", path], 120).await?;
    if !co.ok() {
        // delete/modify conflict: keeping the deleting side means git rm
        let stage = if side == "mine" { ":2:" } else { ":3:" };
        let has = run_git(root, &["cat-file", "-e", &format!("{stage}{path}")], 15).await?;
        if has.ok() {
            return Err(AppError::git(co.stderr.trim().to_string()));
        }
        let rm = run_git(root, &["rm", "-q", "--", path], 60).await?;
        if !rm.ok() {
            return Err(AppError::git(rm.stderr.trim().to_string()));
        }
        crate::logger::info(format!("conflict: {path} removed, as the {side} side had it"));
        return Ok(());
    }
    let add = run_git(root, &["add", "--", path], 60).await?;
    if !add.ok() {
        return Err(AppError::git(add.stderr.trim().to_string()));
    }
    crate::logger::info(format!("conflict: kept the {side} version of {path}"));
    Ok(())
}

#[derive(Debug, serde::Deserialize)]
pub struct Pick {
    pub path: String,
    /// "mine" | "theirs"
    pub side: String,
}

/// Apply all picks to the open merge, commit, push.
pub async fn finish(root: &Path, picks: &[Pick]) -> AppResult<()> {
    for pick in picks {
        resolve(root, &pick.path, &pick.side).await?;
    }
    let left = list(root).await?;
    let unresolved: Vec<&Conflict> = left.iter().filter(|c| c.resolved.is_none()).collect();
    if !unresolved.is_empty() {
        return Err(AppError::new(
            "CONFLICT",
            messages::conflicts_still_open(unresolved.len()),
        ));
    }
    let out = run_git(root, &["commit", "--no-edit"], 120).await?;
    if !out.ok() {
        return Err(AppError::git(out.stderr.trim().to_string()));
    }
    crate::logger::info("conflicts settled, merge committed");

    // push now so the user isn't left with a merge commit to share by hand
    let status = crate::repo::get_repo_status(root).await?;
    let args = crate::repo::push_args(&status);
    let pushed = run_git(root, &args, 600).await?;
    if !pushed.ok() {
        return Err(AppError::offline(messages::CONFLICTS_SETTLED_NOT_SHARED));
    }
    crate::logger::info("settled merge shared with GitHub");
    Ok(())
}

pub async fn abandon(root: &Path) -> AppResult<()> {
    let out = run_git(root, &["merge", "--abort"], 60).await?;
    if !out.ok() {
        return Err(AppError::git(out.stderr.trim().to_string()));
    }
    crate::logger::info("merge abandoned, nothing merged");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::is_cad;

    #[test]
    fn knows_which_files_cannot_be_merged() {
        assert!(is_cad("Wings/Rib.SLDPRT"));
        assert!(is_cad("Full Assembly/SA26.sldasm"));
        assert!(!is_cad(".gitattributes"));
    }
}
