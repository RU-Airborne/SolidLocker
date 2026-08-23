use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::Duration;

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::messages;
use crate::proc::run_git;

#[derive(Debug, Serialize)]
pub struct PullSummary {
    pub number: u64,
    pub title: String,
    pub author: String,
    pub author_avatar: String,
    pub head: String,
    pub base: String,
    pub draft: bool,
    pub created_at: String,
    pub updated_at: String,
    /// "open" | "merged" | "closed"
    pub state: String,
    pub merged_at: String,
    /// "approved" | "changes_requested" | "review_required" | "" when unknown.
    pub review_state: String,
    pub comments: u64,
}

#[derive(Debug, Serialize)]
pub struct PullFile {
    pub path: String,
    /// "added" | "modified" | "removed" | "renamed"
    pub status: String,
    pub additions: u64,
    pub deletions: u64,
    pub is_cad: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct PullComment {
    pub author: String,
    pub author_avatar: String,
    pub body: String,
    pub created_at: String,
    /// "comment" | "approved" | "changes_requested" | "reviewed" | "note" | "proposal"
    pub kind: String,
    pub path: String,
    pub pick: String,
    pub picks: Vec<Pick>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Pick {
    pub path: String,
    pub branch: String,
}

/// Hidden marker on a proposal comment
const PICK_MARK: &str = "<!-- solidlocker:pick branch=\"";

fn pick_of(body: &str) -> String {
    body.find(PICK_MARK)
        .and_then(|at| {
            let rest = &body[at + PICK_MARK.len()..];
            rest.find('"').map(|end| rest[..end].to_string())
        })
        .unwrap_or_default()
}

#[derive(Debug, Serialize)]
pub struct PullDetail {
    pub number: u64,
    pub title: String,
    pub body: String,
    pub author: String,
    pub author_avatar: String,
    pub head: String,
    pub base: String,
    pub head_sha: String,
    pub state: String,
    pub merged: bool,
    pub merged_at: String,
    pub merged_by: String,
    pub merged_by_avatar: String,
    pub merge_commit_sha: String,
    pub draft: bool,
    pub created_at: String,
    pub updated_at: String,
    /// None while GitHub is still computing it.
    pub mergeable: Option<bool>,
    pub mergeable_state: String,
    pub files: Vec<PullFile>,
    pub comments: Vec<PullComment>,
    pub url: String,
}

fn is_cad(path: &str) -> bool {
    let l = path.to_lowercase();
    l.ends_with(".sldprt") || l.ends_with(".sldasm") || l.ends_with(".slddrw")
}

/// owner/repo from the origin remote.
async fn slug(root: &Path) -> AppResult<String> {
    let out = run_git(root, &["remote", "get-url", "origin"], 15).await?;
    if !out.ok() {
        return Err(AppError::new("REPO", messages::NO_ORIGIN_REMOTE));
    }
    crate::repo::parse_slug_from_remote(out.stdout.trim())
        .ok_or_else(|| AppError::new("REPO", messages::not_a_github_remote(out.stdout.trim())))
}

async fn client(root: &Path) -> AppResult<(reqwest::Client, String, String)> {
    let slug = slug(root).await?;
    let token = crate::people::github_token(root)
        .await
        .ok_or_else(|| AppError::new("AUTH", messages::PR_NEEDS_SIGN_IN))?;
    let client = reqwest::Client::builder()
        .user_agent("SolidLocker")
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| AppError::new("PR", e.to_string()))?;
    Ok((client, slug, token))
}

async fn read_json(resp: reqwest::Response) -> AppResult<serde_json::Value> {
    read_json_with(resp, false).await
}

async fn read_json_with(resp: reqwest::Response, quiet: bool) -> AppResult<serde_json::Value> {
    let status = resp.status();
    if status.is_success() {
        return resp
            .json()
            .await
            .map_err(|e| AppError::new("PR", format!("GitHub sent something unreadable: {e}")));
    }
    let detail = resp.text().await.unwrap_or_default();
    // "message" is often just the status name; the useful part is in "errors".
    let message = serde_json::from_str::<serde_json::Value>(&detail)
        .ok()
        .map(|v| {
            let mut parts = Vec::new();
            if let Some(m) = v.get("message").and_then(|m| m.as_str()) {
                parts.push(m.to_string());
            }
            for e in v.get("errors").and_then(|e| e.as_array()).into_iter().flatten() {
                if let Some(s) = e.as_str() {
                    parts.push(s.to_string());
                } else if let Some(m) = e.get("message").and_then(|m| m.as_str()) {
                    parts.push(m.to_string());
                }
            }
            parts.join(": ")
        })
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| detail.chars().take(200).collect());
    let make = if quiet { AppError::quiet } else { AppError::new };
    Err(match status.as_u16() {
        401 | 403 => make("AUTH", messages::pr_not_allowed(&message)),
        404 => make("PR", messages::PR_NOT_FOUND.to_string()),
        _ => make("PR", messages::pr_failed(status.as_u16(), &message)),
    })
}

fn text(v: &serde_json::Value, key: &str) -> String {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

fn person(v: &serde_json::Value) -> (String, String) {
    let user = v.get("user");
    (
        user.map(|u| text(u, "login")).unwrap_or_default(),
        user.map(|u| text(u, "avatar_url")).unwrap_or_default(),
    )
}

pub async fn list(root: &Path) -> AppResult<Vec<PullSummary>> {
    let (client, slug, token) = client(root).await?;
    let resp = client
        .get(format!(
            "https://api.github.com/repos/{slug}/pulls?state=all&sort=updated&direction=desc&per_page=50"
        ))
        .header("Accept", "application/vnd.github+json")
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| AppError::offline(e.to_string()))?;
    let body = read_json(resp).await?;

    let mut found = Vec::new();
    for pr in body.as_array().unwrap_or(&Vec::new()) {
        let (author, avatar) = person(pr);
        found.push(PullSummary {
            number: pr.get("number").and_then(|n| n.as_u64()).unwrap_or(0),
            title: text(pr, "title"),
            author,
            author_avatar: avatar,
            head: pr
                .get("head")
                .map(|h| text(h, "ref"))
                .unwrap_or_default(),
            base: pr
                .get("base")
                .map(|b| text(b, "ref"))
                .unwrap_or_default(),
            draft: pr.get("draft").and_then(|d| d.as_bool()).unwrap_or(false),
            created_at: text(pr, "created_at"),
            updated_at: text(pr, "updated_at"),
            // merged PRs come back as "closed"
            state: if !text(pr, "merged_at").is_empty() {
                "merged".into()
            } else {
                text(pr, "state")
            },
            merged_at: text(pr, "merged_at"),
            // not in the list endpoint
            review_state: String::new(),
            comments: 0,
        });
    }
    Ok(found)
}

pub async fn detail(root: &Path, number: u64) -> AppResult<PullDetail> {
    let (client, slug, token) = client(root).await?;
    let get = |url: String| {
        let client = client.clone();
        let token = token.clone();
        async move {
            let resp = client
                .get(url)
                .header("Accept", "application/vnd.github+json")
                .bearer_auth(&token)
                .send()
                .await
                .map_err(|e| AppError::offline(e.to_string()))?;
            read_json(resp).await
        }
    };

    let pr = get(format!("https://api.github.com/repos/{slug}/pulls/{number}")).await?;
    let files = get(format!(
        "https://api.github.com/repos/{slug}/pulls/{number}/files?per_page=100"
    ))
    .await?;
    // issue comments, reviews and file comments are three endpoints
    let comments = get(format!(
        "https://api.github.com/repos/{slug}/issues/{number}/comments?per_page=100"
    ))
    .await?;
    let reviews = get(format!(
        "https://api.github.com/repos/{slug}/pulls/{number}/reviews?per_page=100"
    ))
    .await?;
    let notes = get(format!(
        "https://api.github.com/repos/{slug}/pulls/{number}/comments?per_page=100"
    ))
    .await?;

    let (author, avatar) = person(&pr);
    Ok(PullDetail {
        number,
        title: text(&pr, "title"),
        body: text(&pr, "body"),
        author,
        author_avatar: avatar,
        head: pr.get("head").map(|h| text(h, "ref")).unwrap_or_default(),
        base: pr.get("base").map(|b| text(b, "ref")).unwrap_or_default(),
        head_sha: pr.get("head").map(|h| text(h, "sha")).unwrap_or_default(),
        state: text(&pr, "state"),
        merged: pr.get("merged").and_then(|m| m.as_bool()).unwrap_or(false),
        merged_at: text(&pr, "merged_at"),
        merged_by: pr.get("merged_by").map(|u| text(u, "login")).unwrap_or_default(),
        merged_by_avatar: pr
            .get("merged_by")
            .map(|u| text(u, "avatar_url"))
            .unwrap_or_default(),
        merge_commit_sha: text(&pr, "merge_commit_sha"),
        draft: pr.get("draft").and_then(|d| d.as_bool()).unwrap_or(false),
        created_at: text(&pr, "created_at"),
        updated_at: text(&pr, "updated_at"),
        mergeable: pr.get("mergeable").and_then(|m| m.as_bool()),
        mergeable_state: text(&pr, "mergeable_state"),
        files: files
            .as_array()
            .unwrap_or(&Vec::new())
            .iter()
            .map(|f| {
                let path = text(f, "filename");
                PullFile {
                    status: text(f, "status"),
                    additions: f.get("additions").and_then(|a| a.as_u64()).unwrap_or(0),
                    deletions: f.get("deletions").and_then(|a| a.as_u64()).unwrap_or(0),
                    is_cad: is_cad(&path),
                    path,
                }
            })
            .collect(),
        comments: conversation(&comments, &reviews, &notes),
        url: text(&pr, "html_url"),
    })
}

/// All three comment sources merged into one thread, oldest first.
fn conversation(
    comments: &serde_json::Value,
    reviews: &serde_json::Value,
    notes: &serde_json::Value,
) -> Vec<PullComment> {
    let mut all = Vec::new();
    for c in comments.as_array().unwrap_or(&Vec::new()) {
        let (author, avatar) = person(c);
        all.push(PullComment {
            author,
            author_avatar: avatar,
            body: text(c, "body"),
            created_at: text(c, "created_at"),
            kind: "comment".into(),
            path: String::new(),
            pick: String::new(),
            picks: Vec::new(),
        });
    }
    // file comments carry pull_request_review_id; group picks by it
    let mut picks_by_review: HashMap<u64, Vec<Pick>> = HashMap::new();
    for n in notes.as_array().unwrap_or(&Vec::new()) {
        let pick = pick_of(&text(n, "body"));
        if pick.is_empty() {
            continue;
        }
        if let Some(id) = n.get("pull_request_review_id").and_then(|v| v.as_u64()) {
            picks_by_review.entry(id).or_default().push(Pick {
                path: text(n, "path"),
                branch: pick,
            });
        }
    }
    let mut carried: HashSet<u64> = HashSet::new();
    for r in reviews.as_array().unwrap_or(&Vec::new()) {
        let kind = match text(r, "state").as_str() {
            "APPROVED" => "approved",
            "CHANGES_REQUESTED" => "changes_requested",
            "COMMENTED" => "reviewed",
            "DISMISSED" => "reviewed",
            _ => continue,
        };
        let body = text(r, "body");
        let id = r.get("id").and_then(|v| v.as_u64());
        let mut picks = id.and_then(|i| picks_by_review.get(&i).cloned()).unwrap_or_default();
        picks.sort_by(|a, b| a.path.cmp(&b.path));
        if let Some(i) = id {
            if !picks.is_empty() {
                carried.insert(i);
            }
        }
        // empty "commented" review = GitHub's wrapper around file comments
        if kind == "reviewed" && body.trim().is_empty() && picks.is_empty() {
            continue;
        }
        let (author, avatar) = person(r);
        all.push(PullComment {
            author,
            author_avatar: avatar,
            body,
            created_at: text(r, "submitted_at"),
            kind: if kind == "reviewed" && !picks.is_empty() {
                "proposal".into()
            } else {
                kind.into()
            },
            path: String::new(),
            pick: String::new(),
            picks,
        });
    }
    for n in notes.as_array().unwrap_or(&Vec::new()) {
        let (author, avatar) = person(n);
        let body = text(n, "body");
        let pick = pick_of(&body);
        let review = n.get("pull_request_review_id").and_then(|v| v.as_u64());
        if !pick.is_empty() && review.is_some_and(|i| carried.contains(&i)) {
            continue;
        }
        let path = text(n, "path");
        all.push(PullComment {
            author,
            author_avatar: avatar,
            body: body.split(PICK_MARK).next().unwrap_or("").trim().to_string(),
            created_at: text(n, "created_at"),
            kind: if pick.is_empty() { "note".into() } else { "proposal".into() },
            picks: if pick.is_empty() {
                Vec::new()
            } else {
                vec![Pick { path: path.clone(), branch: pick.clone() }]
            },
            path,
            pick,
        });
    }
    all.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    fold_proposals(all)
}

/// Picks go up as file comments (GitHub wraps those in an empty review) and
/// the words as a second review right after. Merge the pair back into one.
fn fold_proposals(all: Vec<PullComment>) -> Vec<PullComment> {
    let mut out: Vec<PullComment> = Vec::new();
    let mut i = 0;
    while i < all.len() {
        let c = &all[i];
        let bare_picks = c.kind == "proposal" && c.body.trim().is_empty() && !c.picks.is_empty();
        if bare_picks {
            let next = all[i + 1..].iter().position(|n| {
                n.author == c.author
                    && matches!(n.kind.as_str(), "reviewed" | "changes_requested" | "comment")
                    && n.picks.is_empty()
                    && within_minutes(&c.created_at, &n.created_at, 2)
            });
            if let Some(off) = next {
                let j = i + 1 + off;
                let mut merged = all[j].clone();
                merged.picks = c.picks.clone();
                merged.picks.sort_by(|a, b| a.path.cmp(&b.path));
                if merged.kind == "comment" {
                    merged.kind = "reviewed".into();
                }
                out.extend(all[i + 1..j].iter().cloned());
                out.push(merged);
                i = j + 1;
                continue;
            }
        }
        out.push(c.clone());
        i += 1;
    }
    out
}

fn within_minutes(a: &str, b: &str, minutes: i64) -> bool {
    fn secs(t: &str) -> Option<i64> {
        let (date, time) = t.split_once('T')?;
        let mut d = date.split('-').map(|x| x.parse::<i64>().ok());
        let (y, mo, da) = (d.next()??, d.next()??, d.next()??);
        let time = time.trim_end_matches('Z');
        let mut tt = time.split(':').map(|x| x.parse::<i64>().ok());
        let (h, mi, se) = (tt.next()??, tt.next()??, tt.next()??);
        // days from civil (Hinnant)
        let (y2, m2) = if mo <= 2 { (y - 1, mo + 9) } else { (y, mo - 3) };
        let era = y2.div_euclid(400);
        let yoe = y2 - era * 400;
        let doy = (153 * m2 + 2) / 5 + da - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        let days = era * 146_097 + doe - 719_468;
        Some(days * 86_400 + h * 3600 + mi * 60 + se)
    }
    match (secs(a), secs(b)) {
        (Some(x), Some(y)) => y >= x && y - x <= minutes * 60,
        _ => false,
    }
}

pub async fn create(
    root: &Path,
    title: &str,
    body: &str,
    head: &str,
    base: &str,
) -> AppResult<u64> {
    if title.trim().is_empty() {
        return Err(AppError::new("PR", messages::PR_NEEDS_TITLE));
    }
    let (client, slug, token) = client(root).await?;
    let resp = client
        .post(format!("https://api.github.com/repos/{slug}/pulls"))
        .header("Accept", "application/vnd.github+json")
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "title": title.trim(),
            "body": body,
            "head": head,
            "base": base,
        }))
        .send()
        .await
        .map_err(|e| AppError::offline(e.to_string()))?;
    let made = read_json(resp).await?;
    let number = made.get("number").and_then(|n| n.as_u64()).unwrap_or(0);
    crate::logger::info(format!("opened pull request #{number} ({head} -> {base})"));
    Ok(number)
}

/// `event` is APPROVE, REQUEST_CHANGES or COMMENT. Returns whether it went
/// out as asked (GitHub downgrades an author's own verdict to a comment).
pub async fn review(root: &Path, number: u64, event: &str, body: &str) -> AppResult<bool> {
    let event = match event {
        "APPROVE" | "REQUEST_CHANGES" | "COMMENT" => event,
        _ => return Err(AppError::new("PR", messages::PR_UNKNOWN_REVIEW)),
    };
    if event != "APPROVE" && body.trim().is_empty() {
        return Err(AppError::new("PR", messages::PR_REVIEW_NEEDS_WORDS));
    }

    let (client, slug, token) = client(root).await?;
    let sent = post_review(&client, &slug, &token, number, event, body).await?;
    crate::logger::info(format!("reviewed pull request #{number}: {sent}"));
    Ok(sent == event)
}

async fn post_review(
    client: &reqwest::Client,
    slug: &str,
    token: &str,
    number: u64,
    event: &str,
    body: &str,
) -> AppResult<&'static str> {
    let send = |event: &'static str| {
        let client = client.clone();
        let token = token.to_string();
        let url = format!("https://api.github.com/repos/{slug}/pulls/{number}/reviews");
        let body = body.to_string();
        async move {
            let resp = client
                .post(url)
                .header("Accept", "application/vnd.github+json")
                .bearer_auth(&token)
                .json(&serde_json::json!({ "event": event, "body": body }))
                .send()
                .await
                .map_err(|e| AppError::offline(e.to_string()))?;
            read_json(resp).await.map(|_| event)
        }
    };
    let event: &'static str = match event {
        "APPROVE" => "APPROVE",
        "REQUEST_CHANGES" => "REQUEST_CHANGES",
        _ => "COMMENT",
    };
    match send(event).await {
        Ok(e) => Ok(e),
        Err(e) if event != "COMMENT" && e.message.contains("own pull request") => {
            // GitHub rejects an empty comment
            if body.trim().is_empty() {
                crate::logger::info(format!(
                    "pull request #{number}: GitHub refused {event} from its author; nothing else to say"
                ));
                return Ok("COMMENT");
            }
            crate::logger::info(format!(
                "pull request #{number}: GitHub refused {event} from its author; sent as a comment"
            ));
            send("COMMENT").await
        }
        Err(e) => Err(e),
    }
}

#[derive(Debug, serde::Deserialize)]
pub struct Proposal {
    pub path: String,
    pub branch: String,
}

/// One file comment per pick, then a review with the words. Merges nothing.
pub async fn propose(
    root: &Path,
    number: u64,
    commit_id: &str,
    picks: &[Proposal],
    event: &str,
    body: &str,
) -> AppResult<bool> {
    let event = match event {
        "REQUEST_CHANGES" | "COMMENT" => event,
        _ => return Err(AppError::new("PR", messages::PR_UNKNOWN_REVIEW)),
    };
    if picks.is_empty() && body.trim().is_empty() {
        return Err(AppError::new("PR", messages::PR_REVIEW_NEEDS_WORDS));
    }
    let (client, slug, token) = client(root).await?;
    for p in picks {
        let note = format!(
            "Proposed: keep the version from **{}** for `{}`.\n\n{PICK_MARK}{}\" -->",
            p.branch, p.path, p.branch
        );
        let resp = client
            .post(format!(
                "https://api.github.com/repos/{slug}/pulls/{number}/comments"
            ))
            .header("Accept", "application/vnd.github+json")
            .bearer_auth(&token)
            .json(&serde_json::json!({
                "body": note,
                "commit_id": commit_id,
                "path": p.path,
                "subject_type": "file",
            }))
            .send()
            .await
            .map_err(|e| AppError::offline(e.to_string()))?;
        read_json(resp).await?;
    }
    // REQUEST_CHANGES needs a body
    let words = if body.trim().is_empty() {
        format!(
            "Proposed which version to keep for {} file{}.",
            picks.len(),
            if picks.len() == 1 { "" } else { "s" }
        )
    } else {
        body.to_string()
    };
    let sent = post_review(&client, &slug, &token, number, event, &words).await?;
    crate::logger::info(format!(
        "proposed picks for {} file(s) on pull request #{number}: {sent}",
        picks.len()
    ));
    Ok(sent == event)
}

#[derive(Debug, Serialize, Default)]
pub struct Protection {
    pub protected: bool,
    /// Changes must come through a pull request.
    pub requires_review: bool,
    pub approvals: u64,
}

/// Rulesets are readable by anyone; classic branch protection needs admin,
/// so that lookup is allowed to fail.
pub async fn protection(root: &Path, branch: &str) -> AppResult<Protection> {
    let (client, slug, token) = client(root).await?;
    let get = |url: String| {
        let client = client.clone();
        let token = token.clone();
        async move {
            let resp = client
                .get(url)
                .header("Accept", "application/vnd.github+json")
                .bearer_auth(&token)
                .send()
                .await
                .map_err(|e| AppError::offline(e.to_string()))?;
            read_json_with(resp, true).await
        }
    };
    let name = urlencoding(branch);
    let mut found = Protection::default();

    let info = get(format!("https://api.github.com/repos/{slug}/branches/{name}")).await?;
    found.protected = info.get("protected").and_then(|p| p.as_bool()).unwrap_or(false);

    if let Ok(rules) = get(format!(
        "https://api.github.com/repos/{slug}/rules/branches/{name}"
    ))
    .await
    {
        for rule in rules.as_array().unwrap_or(&Vec::new()) {
            if text(rule, "type") == "pull_request" {
                found.requires_review = true;
                found.protected = true;
                found.approvals = found.approvals.max(
                    rule.get("parameters")
                        .and_then(|p| p.get("required_approving_review_count"))
                        .and_then(|n| n.as_u64())
                        .unwrap_or(0),
                );
            }
        }
    }
    if found.protected && !found.requires_review {
        if let Ok(classic) = get(format!(
            "https://api.github.com/repos/{slug}/branches/{name}/protection"
        ))
        .await
        {
            if let Some(reviews) = classic.get("required_pull_request_reviews") {
                found.requires_review = true;
                found.approvals = reviews
                    .get("required_approving_review_count")
                    .and_then(|n| n.as_u64())
                    .unwrap_or(0);
            }
        }
    }
    Ok(found)
}

/// Percent-encode a branch name for a URL path, keeping slashes.
fn urlencoding(name: &str) -> String {
    let mut out = String::new();
    for b in name.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'/' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Merge on GitHub; GitHub enforces who may.
pub async fn merge(root: &Path, number: u64, method: &str) -> AppResult<()> {
    let method = match method {
        "merge" | "squash" | "rebase" => method,
        _ => "merge",
    };
    let (client, slug, token) = client(root).await?;
    let resp = client
        .put(format!(
            "https://api.github.com/repos/{slug}/pulls/{number}/merge"
        ))
        .header("Accept", "application/vnd.github+json")
        .bearer_auth(&token)
        .json(&serde_json::json!({ "merge_method": method }))
        .send()
        .await
        .map_err(|e| AppError::offline(e.to_string()))?;
    read_json(resp).await?;
    crate::logger::info(format!("merged pull request #{number} ({method})"));
    Ok(())
}

pub async fn close(root: &Path, number: u64) -> AppResult<()> {
    let (client, slug, token) = client(root).await?;
    let resp = client
        .patch(format!("https://api.github.com/repos/{slug}/pulls/{number}"))
        .header("Accept", "application/vnd.github+json")
        .bearer_auth(&token)
        .json(&serde_json::json!({ "state": "closed" }))
        .send()
        .await
        .map_err(|e| AppError::offline(e.to_string()))?;
    read_json(resp).await?;
    crate::logger::info(format!("closed pull request #{number} without merging"));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::is_cad;

    #[test]
    fn knows_which_changes_have_no_text_diff() {
        assert!(is_cad("Wings/Rib.SLDPRT"));
        assert!(is_cad("Full Assembly/SA26.sldasm"));
        assert!(!is_cad("README.md"));
    }
}

#[cfg(test)]
mod fold_tests {
    use super::*;

    fn entry(kind: &str, body: &str, at: &str, picks: Vec<Pick>) -> PullComment {
        PullComment {
            author: "kim".into(),
            author_avatar: String::new(),
            body: body.into(),
            created_at: at.into(),
            kind: kind.into(),
            path: String::new(),
            pick: String::new(),
            picks,
        }
    }

    #[test]
    fn wrapper_and_words_become_one_entry() {
        let pick = Pick { path: "NOTES.md".into(), branch: "main".into() };
        let all = vec![
            entry("proposal", "", "2026-08-23T02:48:10Z", vec![pick.clone()]),
            entry("reviewed", "not", "2026-08-23T02:48:12Z", vec![]),
        ];
        let out = fold_proposals(all);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].kind, "reviewed");
        assert_eq!(out[0].body, "not");
        assert_eq!(out[0].picks.len(), 1);
    }

    #[test]
    fn far_apart_stay_separate() {
        let pick = Pick { path: "NOTES.md".into(), branch: "main".into() };
        let all = vec![
            entry("proposal", "", "2026-08-23T02:48:10Z", vec![pick]),
            entry("reviewed", "later", "2026-08-23T03:10:00Z", vec![]),
        ];
        assert_eq!(fold_proposals(all).len(), 2);
    }

    #[test]
    fn minutes_across_midnight() {
        assert!(within_minutes("2026-08-23T23:59:30Z", "2026-08-24T00:00:40Z", 2));
        assert!(!within_minutes("2026-08-23T23:59:30Z", "2026-08-24T00:02:40Z", 2));
    }
}
