use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<serde_json::Value>,
}

impl AppError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            detail: None,
        }
    }

    pub fn with_detail(code: &str, message: impl Into<String>, detail: serde_json::Value) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            detail: Some(detail),
        }
    }

    pub fn git(message: impl Into<String>) -> Self {
        Self::new("GIT", message)
    }

    pub fn offline(message: impl Into<String>) -> Self {
        Self::new("OFFLINE", message)
    }
}

/// Network failures as git and git-lfs word them in stderr. Used to tell
/// "you are offline" apart from "someone else holds this file".
pub fn looks_offline(text: &str) -> bool {
    let t = text.to_lowercase();
    [
        "could not resolve host",
        "no such host",
        "failed to connect",
        "connection refused",
        "connection timed out",
        "network is unreachable",
        "temporary failure in name resolution",
        "unable to access",
        "dial tcp",
        "i/o timeout",
        "timed out",
        "could not read from remote",
    ]
    .iter()
    .any(|needle| t.contains(needle))
}

/// Auth failures as git and git-lfs word them in stderr. GIT_TERMINAL_PROMPT=0
/// and GCM_INTERACTIVE=never mean a signed out user gets one of these rather
/// than a hanging prompt.
pub fn looks_signed_out(text: &str) -> bool {
    let t = text.to_lowercase();
    [
        "authentication",
        "could not read username",
        "could not read password",
        "terminal prompts disabled",
        "invalid username or password",
        "access denied",
        "permission denied",
        "must have push access",
        "forbidden",
        "401",
        "403",
    ]
    .iter()
    .any(|needle| t.contains(needle))
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        Self::new("IO", e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        Self::new("PARSE", e.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
