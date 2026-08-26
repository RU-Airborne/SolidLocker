//! The GitHub client both apps talk through.
//!
//! Kept out of `cloud` so the desktop does not have to compile the phone
//! backend just to reach merge requests. The desktop fills this in from the
//! checkout's remote and git's credential helper, the phone from the token it
//! signed in with.

use std::time::Duration;

use crate::error::{AppError, AppResult};

const USER_AGENT: &str = "SolidLocker";
const TIMEOUT: Duration = Duration::from_secs(30);

/// One repository, one token, one HTTP client, kept together.
#[derive(Clone)]
pub struct Api {
    pub http: reqwest::Client,
    /// "owner/repo"
    pub slug: String,
    pub token: String,
    /// The login the token belongs to. Git LFS uses Basic auth, which wants a
    /// username beside the token, so only the phone reads it.
    #[cfg_attr(desktop, allow(dead_code))]
    pub login: String,
}

impl Api {
    pub fn new(
        slug: impl Into<String>,
        token: impl Into<String>,
        login: impl Into<String>,
    ) -> AppResult<Self> {
        let http = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(TIMEOUT)
            .build()
            .map_err(|e| AppError::new("NET", e.to_string()))?;
        Ok(Self {
            http,
            slug: slug.into(),
            token: token.into(),
            login: login.into(),
        })
    }
}

#[cfg(any(mobile, test))]
pub fn net(e: reqwest::Error) -> AppError {
    if e.is_timeout() {
        return AppError::offline("GitHub did not answer in time. The connection may be weak.");
    }
    if e.is_connect() || e.is_request() {
        return AppError::offline("Could not reach GitHub. Check the connection and try again.");
    }
    AppError::new("NET", e.to_string())
}
