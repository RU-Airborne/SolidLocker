//! Signing in from a phone.
//!
//! The desktop app never asks for a token: it borrows whatever Git Credential
//! Manager already holds, because git is doing the talking anyway. There is
//! no credential manager on a phone and no git to borrow from, so the app has
//! to earn a token of its own.
//!
//! The device flow is the one that fits a phone: the app shows a short code,
//! the member types it into github.com (on the phone, or on the machine they
//! are stood next to), and GitHub hands the token back. No password is ever
//! typed into SolidLocker, and no browser redirect has to find its way back
//! into the app.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

use super::{net, Api};

/// A registered OAuth App is the one thing the device flow cannot do without.
/// Client IDs are public by design, so this can be baked in at build time
/// (`SOLIDLOCKER_GH_CLIENT_ID=Iv1.xxxx cargo tauri ios build`) or typed into
/// Settings once on the device.
pub const BUILT_IN_CLIENT_ID: Option<&str> = option_env!("SOLIDLOCKER_GH_CLIENT_ID");

/// `repo` covers private projects, Git LFS locking (which needs push access)
/// and merge-request review. The two reads are what turns a login into a name
/// and a face.
const SCOPES: &str = "repo read:org read:user";

#[derive(Debug, Serialize)]
pub struct DeviceStart {
    /// The short code the member types on github.com, e.g. "WDJB-MJHT".
    pub user_code: String,
    pub verification_uri: String,
    /// Kept by the frontend and handed back to every poll.
    pub device_code: String,
    /// Seconds. GitHub asks for five; polling faster earns a slow_down.
    pub interval: u64,
    pub expires_in: u64,
}

#[derive(Deserialize)]
struct DeviceCodeShape {
    device_code: String,
    user_code: String,
    verification_uri: String,
    #[serde(default = "default_interval")]
    interval: u64,
    #[serde(default = "default_expiry")]
    expires_in: u64,
}

fn default_interval() -> u64 {
    5
}

fn default_expiry() -> u64 {
    900
}

/// Where a poll has got to. The frontend keeps asking while it is `pending`.
#[derive(Debug, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum DevicePoll {
    Pending,
    /// GitHub wants a longer gap between polls than it first asked for.
    SlowDown { interval: u64 },
    Done { token: String },
}

fn client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent("SolidLocker")
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| AppError::new("NET", e.to_string()))
}

pub async fn start(client_id: &str) -> AppResult<DeviceStart> {
    if client_id.trim().is_empty() {
        return Err(AppError::new(
            "SETUP",
            "SolidLocker has no GitHub client ID, so it cannot start a sign in. \
             Add one in Settings, or paste a personal access token instead.",
        ));
    }
    let resp = client()?
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .form(&[("client_id", client_id), ("scope", SCOPES)])
        .send()
        .await
        .map_err(net)?;

    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(super::github_error(status, &body));
    }
    let shape: DeviceCodeShape = serde_json::from_str(&body).map_err(|e| {
        AppError::new(
            "GITHUB",
            format!("GitHub sent an unreadable sign-in code ({e})"),
        )
    })?;

    crate::logger::info("cloud: device sign in started");
    Ok(DeviceStart {
        user_code: shape.user_code,
        verification_uri: shape.verification_uri,
        device_code: shape.device_code,
        interval: shape.interval.max(1),
        expires_in: shape.expires_in,
    })
}

pub async fn poll(client_id: &str, device_code: &str) -> AppResult<DevicePoll> {
    let resp = client()?
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .form(&[
            ("client_id", client_id),
            ("device_code", device_code),
            (
                "grant_type",
                "urn:ietf:params:oauth:grant-type:device_code",
            ),
        ])
        .send()
        .await
        .map_err(net)?;

    let body = resp.text().await.unwrap_or_default();
    let v: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| AppError::new("GITHUB", format!("GitHub sent an unreadable answer ({e})")))?;

    if let Some(token) = v.get("access_token").and_then(|t| t.as_str()) {
        crate::logger::info("cloud: device sign in completed");
        return Ok(DevicePoll::Done {
            token: token.to_string(),
        });
    }

    match v.get("error").and_then(|e| e.as_str()).unwrap_or("") {
        // Nobody has typed the code yet. Expected, and not worth a log line.
        "authorization_pending" => Ok(DevicePoll::Pending),
        "slow_down" => Ok(DevicePoll::SlowDown {
            interval: v
                .get("interval")
                .and_then(|i| i.as_u64())
                .unwrap_or(10)
                .max(1),
        }),
        "expired_token" => Err(AppError::new(
            "EXPIRED",
            "That sign-in code ran out. Start again for a fresh one.",
        )),
        "access_denied" => Err(AppError::new(
            "DENIED",
            "The sign in was turned down on github.com.",
        )),
        "device_flow_disabled" => Err(AppError::new(
            "SETUP",
            "This GitHub app does not have device flow switched on. \
             Turn it on in the app's settings on github.com.",
        )),
        other => Err(AppError::new(
            "GITHUB",
            format!("GitHub refused the sign in ({other})"),
        )),
    }
}

/// Who a token belongs to. Doubles as the check that a pasted token is real
/// and still has the scopes we need.
#[derive(Debug, Serialize, Clone)]
pub struct Me {
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: String,
}

pub async fn whoami(token: &str) -> AppResult<Me> {
    let api = Api::tokenless_repo(token)?;
    let v = api.get_json(&api.url("/user")).await?;
    let login = v
        .get("login")
        .and_then(|l| l.as_str())
        .ok_or_else(|| AppError::new("AUTH", "GitHub did not say who this token belongs to."))?
        .to_string();
    Ok(Me {
        name: v
            .get("name")
            .and_then(|n| n.as_str())
            .map(str::trim)
            .filter(|n| !n.is_empty())
            .map(str::to_string),
        avatar_url: v
            .get("avatar_url")
            .and_then(|a| a.as_str())
            .unwrap_or_default()
            .to_string(),
        login,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_client_id_is_a_setup_problem_not_a_github_one() {
        let e = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(start("  "))
            .unwrap_err();
        assert_eq!(e.code, "SETUP");
    }

    #[test]
    fn device_codes_keep_a_sane_interval() {
        let shape: DeviceCodeShape = serde_json::from_str(
            r#"{"device_code":"d","user_code":"WDJB-MJHT","verification_uri":"https://github.com/login/device"}"#,
        )
        .unwrap();
        assert_eq!(shape.interval, 5);
        assert_eq!(shape.expires_in, 900);
    }
}
