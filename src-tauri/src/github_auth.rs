//! Complete Git's fill -> validate -> approve credential lifecycle.
use std::{future::Future, path::Path, time::Duration};

use crate::{error::{AppError, AppResult}, proc};

const REQUEST: &[u8] = b"protocol=https\nhost=github.com\n\n";

fn token(credentials: &str) -> Option<&str> {
    credentials.lines().find_map(|line| line.strip_prefix("password="))
        .filter(|value| !value.is_empty())
}

pub async fn sign_in() -> AppResult<String> {
    // Match the global context used by the repository picker, even when a
    // checkout is selected. A public remote can succeed without any login.
    let dir = std::env::temp_dir();
    crate::logger::info("GitHub sign-in: requesting credentials");
    let out = proc::run_git_interactive(&dir, &["credential", "fill"], Some(REQUEST), 300).await?;
    if !out.ok() {
        // Credential output and helper stderr may contain secrets.
        crate::logger::warn(format!("GitHub sign-in: credential fill exited {}", out.status));
        return Err(AppError::new("AUTH", "GitHub sign-in did not finish. Check that Git Credential Manager is installed and configured, then try again."));
    }
    finish_sign_in(&dir, &out.stdout, validate).await
}

async fn validate(token: &str) -> AppResult<String> {
    let response = reqwest::Client::builder()
        .user_agent("SolidLocker")
        .timeout(Duration::from_secs(20))
        .build().map_err(|e| AppError::new("NET", e.to_string()))?
        .get("https://api.github.com/user")
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .send().await.map_err(|e| AppError::offline(e.to_string()))?;
    if !response.status().is_success() {
        return Err(AppError::new("AUTH", format!("GitHub could not verify the sign-in (HTTP {}). Please try again.", response.status().as_u16())));
    }
    let body: serde_json::Value = response.json().await
        .map_err(|_| AppError::new("AUTH", "GitHub returned an unreadable account response."))?;
    body.get("login").and_then(|v| v.as_str()).filter(|v| !v.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| AppError::new("AUTH", "GitHub did not return an account name."))
}

async fn finish_sign_in<'a, F, Fut>(dir: &Path, credentials: &'a str, validate: F) -> AppResult<String>
where F: FnOnce(&'a str) -> Fut, Fut: Future<Output = AppResult<String>> {
    let password = token(credentials)
        .ok_or_else(|| AppError::new("AUTH", "GitHub sign-in returned no access token. Please try again."))?;
    let login = validate(password).await?;
    // Pass the complete description back, including any refresh/expiry fields.
    let out = proc::run_git_stdin(dir, &["credential", "approve"], credentials.as_bytes(), 15).await?;
    if !out.ok() {
        crate::logger::warn(format!("GitHub sign-in: credential approve exited {}", out.status));
        return Err(AppError::new("AUTH", "GitHub accepted the sign-in, but Git could not save it. Check your Git credential helper and try again."));
    }
    let saved = proc::run_git_stdin(dir, &["credential", "fill"], REQUEST, 15).await?;
    if !saved.ok() || token(&saved.stdout) != Some(password) {
        return Err(AppError::new("AUTH", "GitHub accepted the sign-in, but SolidLocker could not read it back from Git. Check your Git credential helper and try again."));
    }
    crate::logger::info("GitHub sign-in: account verified and credentials saved");
    Ok(login)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::{path::PathBuf, process::Command, sync::atomic::{AtomicUsize, Ordering}};
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("solidlocker-auth-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
            std::fs::create_dir_all(&dir).unwrap();
            let fixture = Self(dir);
            fixture.git(&["init", "-q"]);
            fixture.git(&["config", "core.askPass", ""]);
            // Reset inherited helpers: tests must never touch real credentials.
            fixture.git(&["config", "credential.helper", ""]);
            let helper = format!("store --file '{}'", fixture.0.join("credentials").display());
            fixture.git(&["config", "--add", "credential.helper", &helper]);
            fixture
        }
        fn git(&self, args: &[&str]) {
            assert!(Command::new("git").current_dir(&self.0).args(args).output().unwrap().status.success());
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
    }
    const CREDENTIALS: &str = "protocol=https\nhost=github.com\nusername=test-user\npassword=fake-test-token\n\n";

    #[tokio::test]
    async fn browser_credentials_are_saved_for_the_next_lookup() {
        let fixture = Fixture::new();
        let login = finish_sign_in(&fixture.0, CREDENTIALS, |value| async move {
            assert_eq!(value, "fake-test-token");
            Ok("test-user".into())
        }).await.unwrap();
        assert_eq!(login, "test-user");
        let saved = proc::run_git_stdin(&fixture.0, &["credential", "fill"], REQUEST, 15).await.unwrap();
        assert!(saved.ok());
        assert_eq!(token(&saved.stdout), Some("fake-test-token"));
    }

    #[tokio::test]
    async fn missing_token_cannot_report_success() {
        let fixture = Fixture::new();
        let result = finish_sign_in(&fixture.0, "protocol=https\nhost=github.com\n\n", |_| async {
            panic!("a missing token must not reach validation");
            #[allow(unreachable_code)]
            Ok(String::new())
        }).await;
        assert!(result.unwrap_err().message.contains("no access token"));
        assert!(!fixture.0.join("credentials").exists());
    }

    #[tokio::test]
    async fn rejected_credentials_are_not_saved() {
        let fixture = Fixture::new();
        let result = finish_sign_in(&fixture.0, CREDENTIALS, |_| async {
            Err(AppError::quiet("AUTH", "Rejected by GitHub"))
        }).await;
        assert!(result.is_err());
        assert!(!fixture.0.join("credentials").exists());
    }

    #[tokio::test]
    async fn a_helper_that_does_not_save_cannot_report_success() {
        let fixture = Fixture::new();
        fixture.git(&["config", "--unset-all", "credential.helper"]);
        fixture.git(&["config", "credential.helper", ""]);
        let result = finish_sign_in(&fixture.0, CREDENTIALS, |_| async { Ok("test-user".into()) }).await;
        assert!(result.unwrap_err().message.contains("read it back"));
    }
}
