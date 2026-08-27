//! Display names for people not in the commit history.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use crate::proc::run_git_stdin;

#[derive(Default)]
pub struct ProfileNames(pub Mutex<HashMap<String, Option<String>>>);

fn is_a_username(login: &str) -> bool {
    !login.is_empty()
        && login.len() <= 39
        && login
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
}

const MAX_PER_CALL: usize = 25;

pub(crate) async fn github_token_anywhere() -> Option<String> {
    github_token(&std::env::temp_dir()).await
}

pub(crate) async fn github_token(repo: &Path) -> Option<String> {
    let out = run_git_stdin(
        repo,
        &["credential", "fill"],
        b"protocol=https\nhost=github.com\n\n",
        15,
    )
    .await
    .ok()?;
    if !out.ok() {
        return None;
    }
    out.stdout
        .lines()
        .find_map(|line| line.strip_prefix("password="))
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
}

pub async fn display_names(
    cache: &ProfileNames,
    repo: &Path,
    logins: Vec<String>,
) -> HashMap<String, String> {
    let mut wanted: Vec<String> = Vec::new();
    for login in logins {
        let key = login.to_lowercase();
        if is_a_username(&key) && !wanted.contains(&key) {
            wanted.push(key);
        }
    }

    let missing: Vec<String> = {
        let known = cache.0.lock().unwrap();
        wanted
            .iter()
            .filter(|key| !known.contains_key(*key))
            .take(MAX_PER_CALL)
            .cloned()
            .collect()
    };

    if !missing.is_empty() {
        let token = github_token(repo).await;
        let client = reqwest::Client::builder()
            .user_agent("SolidLocker")
            .timeout(Duration::from_secs(15))
            .build();
        if let Ok(client) = client {
            for key in missing {
                match fetch_name(&client, token.as_deref(), &key).await {
                    Ok(answer) => {
                        cache.0.lock().unwrap().insert(key, answer);
                    }
                    Err(()) => break,
                }
            }
        }
    }

    let known = cache.0.lock().unwrap();
    wanted
        .into_iter()
        .filter_map(|key| {
            known
                .get(&key)
                .and_then(|name| name.clone())
                .map(|name| (key, name))
        })
        .collect()
}

async fn fetch_name(
    client: &reqwest::Client,
    token: Option<&str>,
    login: &str,
) -> Result<Option<String>, ()> {
    let mut req = client
        .get(format!("https://api.github.com/users/{login}"))
        .header("Accept", "application/vnd.github+json");
    if let Some(token) = token {
        req = req.bearer_auth(token);
    }
    let resp = req.send().await.map_err(|_| ())?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !resp.status().is_success() {
        return Err(());
    }
    let body: serde_json::Value = resp.json().await.map_err(|_| ())?;
    let name = body
        .get("name")
        .and_then(|n| n.as_str())
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map(str::to_string);
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::is_a_username;
    use super::{display_names, ProfileNames};

    /// `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn reads_a_name_off_a_github_profile() {
        let cache = ProfileNames::default();
        let here = std::env::current_dir().unwrap();
        let names = display_names(&cache, &here, vec!["Octocat".into()]).await;
        assert_eq!(
            names.get("octocat").map(String::as_str),
            Some("The Octocat")
        );
        assert!(cache.0.lock().unwrap().contains_key("octocat"));
    }

    #[test]
    fn only_real_usernames_reach_a_url() {
        assert!(is_a_username("anastasiamoreno"));
        assert!(is_a_username("Official-Shrek"));
        assert!(!is_a_username(""));
        assert!(!is_a_username("scavenx/repo"));
        assert!(!is_a_username("scavenx?tab=x"));
        assert!(!is_a_username("../../orgs"));
        assert!(!is_a_username(&"a".repeat(40)));
    }
}
