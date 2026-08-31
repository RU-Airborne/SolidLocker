//! The project as GitHub can describe it: files, branches, commits, people.
//!
//! Everything here is a read of a remote that already exists. There is no
//! working tree to compare against, so "modified" and "not shared yet" have
//! no meaning on a phone: a file is whatever the branch says it is.

use std::collections::{HashMap, HashSet};

use serde::Serialize;

use crate::error::{AppError, AppResult};

use super::{is_cad, net, paged, Api};

// ---- The project ----

#[derive(Debug, Serialize, Clone)]
pub struct CloudRepo {
    pub slug: String,
    pub default_branch: String,
    pub private: bool,
    /// Write access. Without it there is no locking and no merging, only
    /// looking, and the app should say so rather than fail on the first tap.
    pub can_push: bool,
    pub can_admin: bool,
    pub description: String,
    /// Whether .gitattributes marks anything `lockable`. Same check the
    /// desktop app makes, just read over the network.
    pub lockable_ok: bool,
}

pub async fn repo(api: &Api) -> AppResult<CloudRepo> {
    let v = api.get_json(&api.repo_url("")).await?;
    let default_branch = v
        .get("default_branch")
        .and_then(|b| b.as_str())
        .unwrap_or("main")
        .to_string();
    let perms = v.get("permissions");
    let flag = |key: &str| {
        perms
            .and_then(|p| p.get(key))
            .and_then(|b| b.as_bool())
            .unwrap_or(false)
    };
    let attrs = attributes(api, &default_branch).await.unwrap_or_default();
    Ok(CloudRepo {
        slug: api.slug.clone(),
        private: v.get("private").and_then(|p| p.as_bool()).unwrap_or(false),
        can_push: flag("push") || flag("maintain") || flag("admin"),
        can_admin: flag("admin"),
        description: v
            .get("description")
            .and_then(|d| d.as_str())
            .unwrap_or_default()
            .to_string(),
        lockable_ok: attrs.iter().any(|r| r.lockable),
        default_branch,
    })
}

#[derive(Debug, Serialize)]
pub struct RepoChoice {
    pub slug: String,
    pub name: String,
    pub owner: String,
    pub owner_avatar: String,
    pub private: bool,
    pub updated_at: String,
    pub description: String,
}

/// Every project the account can write to, newest activity first. A member
/// picking their project on a phone should not have to type owner/repo.
pub async fn my_repos(api: &Api) -> AppResult<Vec<RepoChoice>> {
    let url = api.url("/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member");
    let items = paged(api, &url, 300).await?;
    Ok(items
        .into_iter()
        .filter_map(|v| {
            let slug = v.get("full_name")?.as_str()?.to_string();
            let (owner, owner_avatar) = match v.get("owner") {
                Some(o) => (
                    o.get("login").and_then(|l| l.as_str()).unwrap_or_default().to_string(),
                    o.get("avatar_url").and_then(|a| a.as_str()).unwrap_or_default().to_string(),
                ),
                None => (String::new(), String::new()),
            };
            Some(RepoChoice {
                name: v.get("name")?.as_str()?.to_string(),
                private: v.get("private").and_then(|p| p.as_bool()).unwrap_or(false),
                updated_at: v
                    .get("updated_at")
                    .and_then(|u| u.as_str())
                    .unwrap_or_default()
                    .to_string(),
                description: v
                    .get("description")
                    .and_then(|d| d.as_str())
                    .unwrap_or_default()
                    .to_string(),
                slug,
                owner,
                owner_avatar,
            })
        })
        .collect())
}

// ---- .gitattributes ----

#[derive(Debug, Clone)]
pub struct AttrRule {
    pattern: String,
    pub lockable: bool,
    pub lfs: bool,
}

/// The locking rules, read straight off the branch. The desktop app asks
/// `git check-attr`; with no git we parse the file ourselves, which is honest
/// enough for the handful of `*.SLDPRT` lines these projects actually carry.
pub async fn attributes(api: &Api, branch: &str) -> AppResult<Vec<AttrRule>> {
    let text = match raw_file(api, ".gitattributes", branch).await {
        Ok(t) => t,
        // A project without the file simply has no rules yet.
        Err(e) if e.code == "MISSING" => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    Ok(parse_attributes(&text))
}

pub fn parse_attributes(text: &str) -> Vec<AttrRule> {
    let mut rules = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut parts = line.split_whitespace();
        let Some(pattern) = parts.next() else {
            continue;
        };
        let attrs: Vec<&str> = parts.collect();
        rules.push(AttrRule {
            pattern: pattern.to_string(),
            lockable: attrs.iter().any(|a| *a == "lockable"),
            lfs: attrs.iter().any(|a| *a == "filter=lfs"),
        });
    }
    rules
}

/// gitignore-style matching, cut down to what .gitattributes files really
/// contain. Last matching rule wins, as git does it.
pub fn matches(pattern: &str, path: &str) -> bool {
    let pattern = pattern.trim_start_matches('/');
    let subject = if pattern.contains('/') {
        path
    } else {
        path.rsplit('/').next().unwrap_or(path)
    };
    glob(&pattern.to_lowercase(), &subject.to_lowercase())
}

/// `*` spans anything, `?` one character. No character classes: no
/// .gitattributes in a CAD project has ever needed them.
fn glob(pattern: &str, subject: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let s: Vec<char> = subject.chars().collect();
    let (mut pi, mut si) = (0usize, 0usize);
    let (mut star, mut resume) = (usize::MAX, 0usize);

    while si < s.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == s[si]) {
            pi += 1;
            si += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = pi;
            resume = si;
            pi += 1;
        } else if star != usize::MAX {
            pi = star + 1;
            resume += 1;
            si = resume;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

fn rule_for<'a>(rules: &'a [AttrRule], path: &str) -> Option<&'a AttrRule> {
    rules.iter().rev().find(|r| matches(&r.pattern, path))
}

// ---- Files ----

#[derive(Debug, Serialize)]
pub struct CloudFile {
    pub rel_path: String,
    pub name: String,
    pub dir: String,
    /// Bytes. For an LFS file this is the pointer's size, not the CAD file's,
    /// so it is left at zero rather than shown as a misleading 130 bytes.
    pub size: u64,
    pub sha: String,
    pub is_cad: bool,
    pub lockable: bool,
    pub lfs: bool,
}

#[derive(Debug, Serialize)]
pub struct FileListing {
    pub files: Vec<CloudFile>,
    /// GitHub caps a recursive tree. When it trims one, the list is not the
    /// whole project and the app has to say so instead of quietly lying.
    pub truncated: bool,
}

pub async fn files(api: &Api, branch: &str) -> AppResult<FileListing> {
    let rules = attributes(api, branch).await.unwrap_or_default();
    let url = api.repo_url(&format!(
        "/git/trees/{}?recursive=1",
        super::locks::encode_ref(branch)
    ));
    let v = api.get_json(&url).await?;
    let truncated = v
        .get("truncated")
        .and_then(|t| t.as_bool())
        .unwrap_or(false);

    let mut files = Vec::new();
    for entry in v.get("tree").and_then(|t| t.as_array()).unwrap_or(&vec![]) {
        if entry.get("type").and_then(|t| t.as_str()) != Some("blob") {
            continue;
        }
        let Some(path) = entry.get("path").and_then(|p| p.as_str()) else {
            continue;
        };
        if path.starts_with(".git") {
            continue;
        }
        let rule = rule_for(&rules, path);
        let lfs = rule.map(|r| r.lfs).unwrap_or(false);
        let (dir, name) = match path.rsplit_once('/') {
            Some((d, n)) => (d.to_string(), n.to_string()),
            None => (String::new(), path.to_string()),
        };
        files.push(CloudFile {
            size: if lfs {
                0
            } else {
                entry.get("size").and_then(|s| s.as_u64()).unwrap_or(0)
            },
            sha: entry
                .get("sha")
                .and_then(|s| s.as_str())
                .unwrap_or_default()
                .to_string(),
            is_cad: is_cad(path),
            lockable: rule.map(|r| r.lockable).unwrap_or(false),
            lfs,
            rel_path: path.to_string(),
            dir,
            name,
        });
    }
    files.sort_by(|a, b| a.rel_path.to_lowercase().cmp(&b.rel_path.to_lowercase()));
    Ok(FileListing { files, truncated })
}

/// A file's bytes as text. Used for .gitattributes; for an LFS file this is
/// the pointer, which is exactly what the preview downloader wants.
pub async fn raw_file(api: &Api, path: &str, git_ref: &str) -> AppResult<String> {
    let url = api.repo_url(&format!(
        "/contents/{}?ref={}",
        super::locks::encode_ref(path),
        super::locks::urlencode(git_ref)
    ));
    let resp = api
        .get(&url)
        .header("Accept", "application/vnd.github.raw")
        .send()
        .await
        .map_err(net)?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if status.is_success() {
        return Ok(body);
    }
    Err(super::github_error(status, &body))
}

// ---- Branches ----

#[derive(Debug, Serialize)]
pub struct CloudBranch {
    pub name: String,
    pub sha: String,
    pub is_default: bool,
    pub protected: bool,
    /// Seconds since the epoch, to match what the desktop branch list shows.
    pub last_commit_at: i64,
    pub author: String,
    pub author_avatar: String,
    pub subject: String,
    /// Against the default branch. Both are -1 while unknown, because zero
    /// would read as "level with main" and that is a different claim.
    pub ahead: i64,
    pub behind: i64,
}

pub async fn branches(api: &Api, default_branch: &str) -> AppResult<Vec<CloudBranch>> {
    let items = paged(api, &api.repo_url("/branches?per_page=100"), 300).await?;
    let mut out = Vec::new();
    for v in items {
        let Some(name) = v.get("name").and_then(|n| n.as_str()) else {
            continue;
        };
        out.push(CloudBranch {
            sha: v
                .get("commit")
                .and_then(|c| c.get("sha"))
                .and_then(|s| s.as_str())
                .unwrap_or_default()
                .to_string(),
            is_default: name == default_branch,
            protected: v
                .get("protected")
                .and_then(|p| p.as_bool())
                .unwrap_or(false),
            last_commit_at: 0,
            author: String::new(),
            author_avatar: String::new(),
            subject: String::new(),
            ahead: -1,
            behind: -1,
            name: name.to_string(),
        });
    }
    // Default first, then the rest as GitHub ordered them.
    out.sort_by_key(|b| !b.is_default);
    Ok(out)
}

#[derive(Debug, Serialize)]
pub struct BranchStanding {
    pub ahead: i64,
    pub behind: i64,
    pub last_commit_at: i64,
    pub author: String,
    pub author_avatar: String,
    pub subject: String,
}

/// Where one branch sits against another. One call per branch, so the app
/// asks for these lazily rather than up front for every branch at once.
pub async fn standing(api: &Api, base: &str, head: &str) -> AppResult<BranchStanding> {
    let url = api.repo_url(&format!(
        "/compare/{}...{}",
        super::locks::encode_ref(base),
        super::locks::encode_ref(head)
    ));
    let v = api.get_json(&url).await?;
    let tip = v
        .get("commits")
        .and_then(|c| c.as_array())
        .and_then(|a| a.last())
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    let (author, avatar, when, subject) = commit_bits(&tip);
    Ok(BranchStanding {
        ahead: v.get("ahead_by").and_then(|a| a.as_i64()).unwrap_or(0),
        behind: v.get("behind_by").and_then(|b| b.as_i64()).unwrap_or(0),
        last_commit_at: when,
        author,
        author_avatar: avatar,
        subject,
    })
}

fn commit_bits(v: &serde_json::Value) -> (String, String, i64, String) {
    let commit = v.get("commit");
    let message = commit
        .and_then(|c| c.get("message"))
        .and_then(|m| m.as_str())
        .unwrap_or_default();
    let subject = message.lines().next().unwrap_or_default().to_string();
    let date = commit
        .and_then(|c| c.get("author"))
        .and_then(|a| a.get("date"))
        .and_then(|d| d.as_str())
        .unwrap_or_default();
    let author = v
        .get("author")
        .and_then(|a| a.get("login"))
        .and_then(|l| l.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| {
            commit
                .and_then(|c| c.get("author"))
                .and_then(|a| a.get("name"))
                .and_then(|n| n.as_str())
                .unwrap_or_default()
                .to_string()
        });
    let avatar = v
        .get("author")
        .and_then(|a| a.get("avatar_url"))
        .and_then(|u| u.as_str())
        .unwrap_or_default()
        .to_string();
    (author, avatar, epoch_seconds(date), subject)
}

/// ISO 8601 as GitHub writes it ("2026-08-26T09:41:12Z") to epoch seconds,
/// without dragging in a date library for one format we control.
pub fn epoch_seconds(iso: &str) -> i64 {
    let bytes = iso.as_bytes();
    if bytes.len() < 19 {
        return 0;
    }
    let num = |from: usize, to: usize| -> i64 { iso[from..to].parse().unwrap_or(0) };
    let (y, mo, d) = (num(0, 4), num(5, 7), num(8, 10));
    let (h, mi, s) = (num(11, 13), num(14, 16), num(17, 19));
    if y == 0 {
        return 0;
    }
    days_from_civil(y, mo, d) * 86_400 + h * 3_600 + mi * 60 + s
}

/// Howard Hinnant's civil-date algorithm: days since 1970-01-01.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

// ---- Commits ----

#[derive(Debug, Serialize)]
pub struct CloudCommit {
    pub sha: String,
    pub author_name: String,
    /// The GitHub account behind the commit, when GitHub could match one.
    pub author_login: String,
    pub author_avatar: String,
    pub author_email: String,
    pub date: String,
    pub message: String,
    pub body: String,
}

pub async fn commits(
    api: &Api,
    branch: &str,
    path: Option<&str>,
    limit: usize,
) -> AppResult<Vec<CloudCommit>> {
    let mut url = api.repo_url(&format!(
        "/commits?sha={}&per_page=100",
        super::locks::urlencode(branch)
    ));
    if let Some(p) = path {
        url.push_str(&format!("&path={}", super::locks::urlencode(p)));
    }
    let items = paged(api, &url, limit).await?;
    Ok(items.iter().map(as_commit).collect())
}

fn as_commit(v: &serde_json::Value) -> CloudCommit {
    let commit = v.get("commit");
    let message = commit
        .and_then(|c| c.get("message"))
        .and_then(|m| m.as_str())
        .unwrap_or_default()
        .to_string();
    let (subject, body) = match message.split_once('\n') {
        Some((s, b)) => (s.to_string(), b.trim().to_string()),
        None => (message.clone(), String::new()),
    };
    CloudCommit {
        sha: v
            .get("sha")
            .and_then(|s| s.as_str())
            .unwrap_or_default()
            .to_string(),
        author_name: commit
            .and_then(|c| c.get("author"))
            .and_then(|a| a.get("name"))
            .and_then(|n| n.as_str())
            .unwrap_or_default()
            .to_string(),
        author_login: v
            .get("author")
            .and_then(|a| a.get("login"))
            .and_then(|l| l.as_str())
            .unwrap_or_default()
            .to_string(),
        author_avatar: v
            .get("author")
            .and_then(|a| a.get("avatar_url"))
            .and_then(|u| u.as_str())
            .unwrap_or_default()
            .to_string(),
        author_email: commit
            .and_then(|c| c.get("author"))
            .and_then(|a| a.get("email"))
            .and_then(|e| e.as_str())
            .unwrap_or_default()
            .to_string(),
        date: commit
            .and_then(|c| c.get("author"))
            .and_then(|a| a.get("date"))
            .and_then(|d| d.as_str())
            .unwrap_or_default()
            .to_string(),
        message: subject,
        body,
    }
}

#[derive(Debug, Serialize)]
pub struct ChangedFile {
    pub status: String,
    pub path: String,
    pub additions: u64,
    pub deletions: u64,
    pub is_cad: bool,
}

#[derive(Debug, Serialize)]
pub struct CommitDetail {
    #[serde(flatten)]
    pub commit: CloudCommit,
    pub files: Vec<ChangedFile>,
}

pub async fn commit(api: &Api, sha: &str) -> AppResult<CommitDetail> {
    let v = api
        .get_json(&api.repo_url(&format!("/commits/{}", super::locks::urlencode(sha))))
        .await?;
    let files = v
        .get("files")
        .and_then(|f| f.as_array())
        .map(|arr| arr.iter().map(as_changed).collect())
        .unwrap_or_default();
    Ok(CommitDetail {
        commit: as_commit(&v),
        files,
    })
}

fn as_changed(v: &serde_json::Value) -> ChangedFile {
    let path = v
        .get("filename")
        .and_then(|f| f.as_str())
        .unwrap_or_default()
        .to_string();
    ChangedFile {
        status: v
            .get("status")
            .and_then(|s| s.as_str())
            .unwrap_or_default()
            .to_string(),
        additions: v.get("additions").and_then(|a| a.as_u64()).unwrap_or(0),
        deletions: v.get("deletions").and_then(|d| d.as_u64()).unwrap_or(0),
        is_cad: is_cad(&path),
        path,
    }
}

// ---- People ----

#[derive(Debug, Serialize)]
pub struct TeamMember {
    pub login: String,
    pub name: String,
    pub avatar_url: String,
    pub commits: u64,
    /// Files this person is holding right now.
    pub holding: u64,
}

pub async fn contributors(api: &Api) -> AppResult<Vec<TeamMember>> {
    let items = paged(api, &api.repo_url("/contributors?per_page=100"), 200).await?;
    Ok(items
        .into_iter()
        .filter_map(|v| {
            let login = v.get("login")?.as_str()?.to_string();
            Some(TeamMember {
                avatar_url: v
                    .get("avatar_url")
                    .and_then(|a| a.as_str())
                    .unwrap_or_default()
                    .to_string(),
                commits: v.get("contributions").and_then(|c| c.as_u64()).unwrap_or(0),
                name: login.clone(),
                holding: 0,
                login,
            })
        })
        .collect())
}

/// Real names for a handful of logins, the same job the desktop app does, so
/// a lock reads "Anastasia Moreno" rather than "amoreno-cad".
pub async fn display_names(api: &Api, logins: Vec<String>) -> AppResult<HashMap<String, String>> {
    let mut seen = HashSet::new();
    let mut out = HashMap::new();
    for login in logins.into_iter().take(30) {
        let key = login.to_lowercase();
        if key.is_empty() || !seen.insert(key.clone()) {
            continue;
        }
        let url = api.url(&format!("/users/{}", super::locks::urlencode(&login)));
        // One unknown account must not cost the whole list.
        if let Ok(v) = api.get_json(&url).await {
            if let Some(name) = v
                .get("name")
                .and_then(|n| n.as_str())
                .map(str::trim)
                .filter(|n| !n.is_empty())
            {
                out.insert(key, name.to_string());
            }
        }
    }
    Ok(out)
}

// ---- Insights ----

#[derive(Debug, Serialize)]
pub struct CommitStat {
    pub date: String,
    pub author_name: String,
    pub author_email: String,
    pub file_count: u64,
}

/// The shape the Insights charts want: one row per commit, across the whole
/// project rather than one branch of it.
///
/// "How much happened this week" is a question about the project. Answering
/// it from the branch you happen to be reading would show a quiet week on a
/// branch nobody has touched while three other people were busy, which is the
/// opposite of what the chart is for.
pub async fn commit_stats(
    api: &Api,
    branch: &str,
    branch_cap: usize,
    per_branch: usize,
) -> AppResult<Vec<CommitStat>> {
    let (log, _, _) = across_branches(api, branch, branch_cap, per_branch).await?;
    Ok(log
        .into_iter()
        .map(|c| CommitStat {
            date: c.date,
            author_name: if c.author_login.is_empty() {
                c.author_name
            } else {
                c.author_login
            },
            author_email: c.author_email,
            // The list endpoint does not carry file counts, and asking per
            // commit would be hundreds of calls. Charts that count commits
            // work; the one that counts files is not offered on a phone.
            file_count: 0,
        })
        .collect())
}

// ---- The graph ----

#[derive(Debug, Serialize, Clone)]
pub struct GraphCommit {
    pub sha: String,
    pub parents: Vec<String>,
    pub author_name: String,
    pub author_login: String,
    pub author_avatar: String,
    pub author_email: String,
    pub date: String,
    /// Seconds since the epoch, so the phone can sort without parsing.
    pub at: i64,
    pub subject: String,
    /// Branch names whose tip is this commit.
    pub refs: Vec<String>,
    pub is_head: bool,
}

/// Enough of the history to draw the railway with.
///
/// The desktop reads this out of one `git log --graph` over the whole
/// repository. There is no such call over HTTP, so it is one request per
/// branch, merged on the way back. That is the reason for the caps: a project
/// with sixty branches would otherwise be sixty round trips before anything
/// appeared, and the map stopped being readable long before the sixtieth line.
pub async fn graph(
    api: &Api,
    head_branch: &str,
    branch_cap: usize,
    per_branch: usize,
) -> AppResult<Vec<GraphCommit>> {
    let (mut ordered, seen, wanted) =
        across_branches(api, head_branch, branch_cap, per_branch).await?;

    // Tips carry the branch names; everything else is just history.
    for branch in &wanted {
        if let Some(index) = seen.get(&branch.sha) {
            let entry = &mut ordered[*index];
            entry.refs.push(branch.name.clone());
            if branch.name == head_branch {
                entry.is_head = true;
            }
        }
    }

    ordered.sort_by(|a, b| b.at.cmp(&a.at));
    Ok(ordered)
}

/// Every commit on every branch worth asking about, each one once.
///
/// One request per branch, and the same commit turns up in most of them: a
/// change on the default branch is in the history of everything cut from it.
/// Deduplicating by sha is the whole point, and it is why counting "how much
/// happened this week" cannot just add up per-branch logs.
async fn across_branches(
    api: &Api,
    head_branch: &str,
    branch_cap: usize,
    per_branch: usize,
) -> AppResult<(
    Vec<GraphCommit>,
    HashMap<String, usize>,
    Vec<CloudBranch>,
)> {
    let repo = repo(api).await?;
    let mut wanted = branches(api, &repo.default_branch).await?;

    // The default branch and the one being read always count; after that,
    // most recently moved wins.
    wanted.sort_by_key(|b| !(b.is_default || b.name == head_branch));
    wanted.truncate(branch_cap);

    let mut set = tokio::task::JoinSet::new();
    for branch in &wanted {
        let api = api.clone();
        let name = branch.name.clone();
        set.spawn(async move { commits_raw(&api, &name, per_branch).await });
    }

    let mut ordered: Vec<GraphCommit> = Vec::new();
    let mut seen: HashMap<String, usize> = HashMap::new();

    while let Some(joined) = set.join_next().await {
        let Ok(Ok(log)) = joined else { continue };
        for commit in log {
            if seen.contains_key(&commit.sha) {
                continue;
            }
            seen.insert(commit.sha.clone(), ordered.len());
            ordered.push(commit);
        }
    }
    Ok((ordered, seen, wanted))
}

async fn commits_raw(api: &Api, branch: &str, limit: usize) -> AppResult<Vec<GraphCommit>> {
    let url = api.repo_url(&format!(
        "/commits?sha={}&per_page=100",
        super::locks::urlencode(branch)
    ));
    let items = paged(api, &url, limit).await?;
    Ok(items
        .iter()
        .map(|v| {
            let base = as_commit(v);
            GraphCommit {
                parents: v
                    .get("parents")
                    .and_then(|p| p.as_array())
                    .map(|a| {
                        a.iter()
                            .filter_map(|p| p.get("sha").and_then(|s| s.as_str()))
                            .map(str::to_string)
                            .collect()
                    })
                    .unwrap_or_default(),
                at: epoch_seconds(&base.date),
                subject: base.message.clone(),
                refs: Vec::new(),
                is_head: false,
                sha: base.sha,
                author_name: base.author_name,
                author_login: base.author_login,
                author_avatar: base.author_avatar,
                author_email: base.author_email,
                date: base.date,
            }
        })
        .collect())
}

/// How often each file has been changed, and by how many different people.
/// The desktop calls this "most reworked files"; a file that keeps coming back
/// is either the hard part of the design or the one nobody agrees on.
#[derive(Debug, Serialize)]
pub struct ReworkedFile {
    pub path: String,
    pub changes: u64,
    pub people: u64,
    pub last_at: i64,
    pub is_cad: bool,
}

pub async fn reworked(api: &Api, branch: &str, over: usize) -> AppResult<Vec<ReworkedFile>> {
    let log = commits(api, branch, None, over).await?;

    let mut set = tokio::task::JoinSet::new();
    // Each commit's file list is its own request, so this is capped hard and
    // run a few at a time. Beyond a few dozen commits the answer stops
    // changing shape anyway.
    for chunk in log.chunks(4) {
        for c in chunk {
            let api = api.clone();
            let sha = c.sha.clone();
            let who = if c.author_login.is_empty() {
                c.author_name.clone()
            } else {
                c.author_login.clone()
            };
            let at = epoch_seconds(&c.date);
            set.spawn(async move { (who, at, commit(&api, &sha).await) });
        }
    }

    let mut tally: HashMap<String, (u64, HashSet<String>, i64)> = HashMap::new();
    while let Some(joined) = set.join_next().await {
        let Ok((who, at, Ok(detail))) = joined else {
            continue;
        };
        for file in detail.files {
            let entry = tally
                .entry(file.path)
                .or_insert_with(|| (0, HashSet::new(), 0));
            entry.0 += 1;
            entry.1.insert(who.clone());
            entry.2 = entry.2.max(at);
        }
    }

    let mut out: Vec<ReworkedFile> = tally
        .into_iter()
        .map(|(path, (changes, people, last_at))| ReworkedFile {
            is_cad: is_cad(&path),
            path,
            changes,
            people: people.len() as u64,
            last_at,
        })
        .collect();
    out.sort_by(|a, b| b.changes.cmp(&a.changes).then(b.last_at.cmp(&a.last_at)));
    out.truncate(25);
    Ok(out)
}

// ---- Branch protection ----

/// Make a branch from a commit. About the only write to the repository itself
/// a phone can honestly make: it moves a ref, it does not need a working tree.
pub async fn create_branch(api: &Api, name: &str, from_sha: &str) -> AppResult<()> {
    let resp = api
        .post(&api.repo_url("/git/refs"))
        .json(&serde_json::json!({
            "ref": format!("refs/heads/{name}"),
            "sha": from_sha,
        }))
        .send()
        .await
        .map_err(net)?;
    let status = resp.status();
    if status.is_success() {
        return Ok(());
    }
    let body = resp.text().await.unwrap_or_default();
    if status == reqwest::StatusCode::UNPROCESSABLE_ENTITY && body.contains("already exists") {
        return Err(AppError::new(
            "EXISTS",
            format!("There is already a branch called {name}."),
        ));
    }
    Err(super::github_error(status, &body))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extension_rules_match_by_file_name_anywhere() {
        assert!(matches("*.SLDPRT", "01-Wing/spar.sldprt"));
        assert!(matches("*.sldprt", "spar.SLDPRT"));
        assert!(!matches("*.sldasm", "spar.sldprt"));
    }

    #[test]
    fn a_rule_with_a_slash_matches_the_whole_path() {
        assert!(matches("Library/*.sldprt", "library/bolt.sldprt"));
        assert!(!matches("Library/*.sldprt", "01-Wing/bolt.sldprt"));
    }

    #[test]
    fn the_last_matching_rule_wins() {
        let rules = parse_attributes(
            "*.sldprt filter=lfs diff=lfs merge=lfs -text lockable\n\
             Scratch/*.sldprt filter=lfs -text\n",
        );
        assert!(rule_for(&rules, "01-Wing/spar.sldprt").unwrap().lockable);
        assert!(!rule_for(&rules, "Scratch/spar.sldprt").unwrap().lockable);
    }

    #[test]
    fn comments_and_blank_lines_are_not_rules() {
        let rules = parse_attributes("# CAD files\n\n*.sldasm filter=lfs lockable\n");
        assert_eq!(rules.len(), 1);
        assert!(rules[0].lfs);
    }

    #[test]
    fn github_timestamps_become_epoch_seconds() {
        assert_eq!(epoch_seconds("1970-01-01T00:00:00Z"), 0);
        assert_eq!(epoch_seconds("2000-01-01T00:00:00Z"), 946_684_800);
        assert_eq!(epoch_seconds("2026-01-01T00:00:00Z"), 1_767_225_600);
        assert_eq!(epoch_seconds("2026-08-26T09:41:12Z"), 1_787_737_272);
    }

    #[test]
    fn a_malformed_timestamp_is_zero_not_a_panic() {
        assert_eq!(epoch_seconds(""), 0);
        assert_eq!(epoch_seconds("not a date"), 0);
    }
}
