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

fn identity_of(email: &str) -> String {
    let e = email
        .trim()
        .trim_start_matches('<')
        .trim_end_matches('>')
        .trim()
        .to_lowercase();
    if let Some(local) = e.strip_suffix("@users.noreply.github.com") {
        if let Some((id, _login)) = local.split_once('+') {
            if !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit()) {
                return format!("gh:{id}");
            }
        }
        return format!("gh-login:{local}");
    }
    e
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
            "--format=%(refname)%09%(refname:short)%09%(authorname)%09%(committerdate:unix)%09%(authoremail)",
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
    let my_email = run_git(root, &["config", "user.email"], 15)
        .await
        .map(|o| o.stdout.trim().to_string())
        .unwrap_or_default();
    let my_id = identity_of(&my_email);
    let mut found = Vec::new();

    for line in refs.stdout.lines() {
        let mut cols = line.split('\t');
        let (Some(full), Some(name), Some(author), Some(when)) =
            (cols.next(), cols.next(), cols.next(), cols.next())
        else {
            continue;
        };
        // Odd histories can leave this off, in which case fall back to the name.
        let author_email = cols.next().unwrap_or("").trim();
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
        let is_mine = if !my_email.is_empty() && !author_email.is_empty() {
            identity_of(author_email) == my_id
        } else {
            !me.is_empty() && author == me
        };
        found.push(Collision {
            is_mine,
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
    use super::{identity_of, is_cad};

    #[test]
    fn knows_what_cannot_be_merged() {
        assert!(is_cad("Wings/Rib.SLDPRT"));
        assert!(is_cad("Full Assembly/SA26.sldasm"));
        assert!(is_cad("Sheets/Layout.SLDDRW"));
        assert!(!is_cad(".gitattributes"));
        assert!(!is_cad("README.md"));
    }


    #[test]
    fn one_person_under_several_names_is_still_one_person() {
        // One account, two logins, plus the brackets for-each-ref adds.
        let a = identity_of("<37249237+scavenx@users.noreply.github.com>");
        let b = identity_of("37249237+xhd131142117@users.noreply.github.com");
        assert_eq!(a, b);
        assert_eq!(a, "gh:37249237");
    }

    #[test]
    fn different_accounts_stay_apart() {
        assert_ne!(
            identity_of("1+alice@users.noreply.github.com"),
            identity_of("2+bob@users.noreply.github.com"),
        );
    }

    #[test]
    fn ordinary_addresses_compare_on_the_address() {
        assert_eq!(identity_of("Bob@Example.com "), "bob@example.com");
        assert_ne!(
            identity_of("bob@example.com"),
            identity_of("alice@example.com"),
        );
    }

    #[test]
    fn a_noreply_without_an_id_falls_back_to_the_login() {
        assert_eq!(
            identity_of("scavenx@users.noreply.github.com"),
            "gh-login:scavenx",
        );
    }
}
