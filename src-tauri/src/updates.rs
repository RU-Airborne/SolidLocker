//! Checks GitHub for a newer SolidLocker release.
use serde::Serialize;

use crate::error::{AppError, AppResult};

const RELEASES_API: &str = "https://api.github.com/repos/RU-Airborne/SolidLocker/releases/latest";
const RELEASES_PAGE: &str = "https://github.com/RU-Airborne/SolidLocker/releases";

#[derive(Debug, Serialize)]
pub struct UpdateCheck {
    pub current: String,
    pub latest: String,
    /// The release page to open when the user wants it.
    pub url: String,
    pub newer: bool,
}

fn numbers(version: &str) -> Vec<u64> {
    version
        .trim_start_matches('v')
        .split('.')
        .filter_map(|p| p.parse().ok())
        .collect()
}

pub async fn check() -> AppResult<UpdateCheck> {
    let client = reqwest::Client::builder()
        .user_agent("SolidLocker")
        .build()
        .map_err(|e| AppError::new("UPDATE", e.to_string()))?;
    let resp = client
        .get(RELEASES_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| AppError::offline(e.to_string()))?;
    if !resp.status().is_success() {
        // no releases yet, or rate limited; nothing to report
        return Err(AppError::quiet(
            "UPDATE",
            format!("release check got {}", resp.status()),
        ));
    }
    let v: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::quiet("UPDATE", e.to_string()))?;
    let latest = v
        .get("tag_name")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .trim_start_matches('v')
        .to_string();
    let url = v
        .get("html_url")
        .and_then(|u| u.as_str())
        .unwrap_or(RELEASES_PAGE)
        .to_string();
    let current = env!("CARGO_PKG_VERSION").to_string();
    let newer = !latest.is_empty() && numbers(&latest) > numbers(&current);
    if newer {
        crate::logger::info(format!(
            "a newer SolidLocker is out: {latest} (this is {current})"
        ));
    }
    Ok(UpdateCheck {
        current,
        latest,
        url,
        newer,
    })
}

#[cfg(test)]
mod tests {
    use super::numbers;

    #[test]
    fn version_order_is_numeric_not_alphabetical() {
        assert!(numbers("0.10.0") > numbers("0.9.1"));
        assert!(numbers("v1.0.0") > numbers("0.6.1"));
        assert!(numbers("0.6.1") == numbers("v0.6.1"));
    }
}
