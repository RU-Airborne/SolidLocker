use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use base64::Engine;

use crate::error::{AppError, AppResult};

#[derive(Default)]
pub struct AvatarCache(pub Mutex<HashMap<String, String>>);

const ALLOWED_HOSTS: &[&str] = &["github.com", "avatars.githubusercontent.com"];

pub async fn get_avatar(cache: &AvatarCache, url: String) -> AppResult<String> {
    if let Some(hit) = cache.0.lock().unwrap().get(&url) {
        return Ok(hit.clone());
    }

    let parsed = reqwest::Url::parse(&url)
        .map_err(|e| AppError::new("AVATAR", format!("bad url: {e}")))?;
    let host_ok = parsed.scheme() == "https"
        && parsed
            .host_str()
            .is_some_and(|h| ALLOWED_HOSTS.contains(&h));
    if !host_ok {
        return Err(AppError::new("AVATAR", "url not allowed"));
    }

    let resp = reqwest::Client::builder()
        .user_agent("SolidLocker")
        .timeout(Duration::from_secs(15))
        .build()
        .expect("reqwest client")
        .get(parsed)
        .send()
        .await
        .map_err(|e| AppError::offline(e.to_string()))?
        .error_for_status()
        .map_err(|e| AppError::new("AVATAR", e.to_string()))?;

    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/png")
        .to_string();
    if !content_type.starts_with("image/") {
        return Err(AppError::new("AVATAR", "not an image"));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::new("AVATAR", e.to_string()))?;
    if bytes.len() > 1_000_000 {
        return Err(AppError::new("AVATAR", "image too large"));
    }

    let data_url = format!(
        "data:{content_type};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    );
    cache
        .0
        .lock()
        .unwrap()
        .insert(url, data_url.clone());
    Ok(data_url)
}
