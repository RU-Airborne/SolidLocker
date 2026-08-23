//! Conflict radar: other branches changing the same files as this one.

use std::collections::HashSet;
use std::path::Path;

use serde::Serialize;

use crate::error::AppResult;
use crate::proc::run_git;

#[derive(Debug, Serialize)]
pub struct Collision {
    pub branch: String,
    pub author: String,
    pub last_commit_at: i64,
    pub files: Vec<String>,
    pub is_mine: bool,
    pub cad_files: Vec<String>,
}

fn is_cad(path: &str) -> bool {
    let l = path.to_lowercase();
    l.ends_with(".sldprt") || l.ends_with(".sldasm") || l.ends_with(".slddrw")
}

async fn changed_since(root: &Path, base: &str, tip: &str) -> HashSet<String> {
    let Ok(out) = run_git(
        root,
        &["diff", "--name-only", "-z", &format!("{base}..{tip}")],
        60,
    )
    .await
    else {
        return HashSet::new();
    };
    if !out.ok() {
        return HashSet::new();
    }
    out.stdout
        .split('\0')
        .filter(|p| !p.is_empty())
        .map(|p| p.to_string())
        .collect()
}

pub async fn collisions(root: &Path) -> AppResult<Vec<Collision>> {
    let status = crate::repo::get_repo_status(root).await?;
    if status.branch.is_empty() || status.branch == "(detached)" {
        return Ok(Vec::new());
    }

    let refs = run_git(
        root,
        &[
            "for-each-ref",
            "--format=%(refname)%09%(refname:short)%09%(authorname)%09%(committerdate:unix)",
            "refs/remotes/origin",
        ],
        60,
    )
    .await?;
    if !refs.ok() {
        return Ok(Vec::new());
    }

    let mine_ref = format!("origin/{}", status.branch);
    let me = run_git(root, &["config", "user.name"], 15)
        .await
        .map(|o| o.stdout.trim().to_string())
        .unwrap_or_default();
    let mut found = Vec::new();

    for line in refs.stdout.lines() {
        let mut cols = line.split('\t');
        let (Some(full), Some(name), Some(author), Some(when)) =
            (cols.next(), cols.next(), cols.next(), cols.next())
        else {
            continue;
        };
        let (full, name) = (full.trim(), name.trim());
        // skip ourselves and origin/HEAD (whose short name is a bare "origin")
        if name == mine_ref || full == "refs/remotes/origin/HEAD" || name.is_empty() {
            continue;
        }

        let base = run_git(root, &["merge-base", "HEAD", name], 30).await;
        let Ok(base) = base else { continue };
        if !base.ok() {
            // unrelated histories
            continue;
        }
        let base = base.stdout.trim().to_string();

        let theirs = changed_since(root, &base, name).await;
        if theirs.is_empty() {
            continue;
        }
        let mine = changed_since(root, &base, "HEAD").await;
        if mine.is_empty() {
            continue;
        }

        let mut files: Vec<String> = mine.intersection(&theirs).cloned().collect();
        if files.is_empty() {
            continue;
        }
        files.sort_by_key(|p| p.to_lowercase());
        let cad_files: Vec<String> = files.iter().filter(|p| is_cad(p)).cloned().collect();

        let author = author.trim().to_string();
        found.push(Collision {
            is_mine: !me.is_empty() && author == me,
            branch: name.strip_prefix("origin/").unwrap_or(name).to_string(),
            author,
            last_commit_at: when.trim().parse().unwrap_or(0),
            files,
            cad_files,
        });
    }

    // unmergeable ones first
    found.sort_by(|a, b| {
        b.cad_files
            .len()
            .cmp(&a.cad_files.len())
            .then(b.last_commit_at.cmp(&a.last_commit_at))
    });

    if !found.is_empty() {
        crate::logger::info(format!(
            "conflict radar: {} branch(es) editing files this branch also changed",
            found.len()
        ));
    }
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::is_cad;

    #[test]
    fn knows_what_cannot_be_merged() {
        assert!(is_cad("Wings/Rib.SLDPRT"));
        assert!(is_cad("Full Assembly/SA26.sldasm"));
        assert!(is_cad("Sheets/Layout.SLDDRW"));
        assert!(!is_cad(".gitattributes"));
        assert!(!is_cad("README.md"));
    }
}
