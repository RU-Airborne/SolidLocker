//! CAD previews on a device that has never seen the CAD file.
//!
//! On the desktop the thumbnail is free: the file is sitting on disk and
//! Windows already knows how to draw it. A phone holds nothing, so a preview
//! costs a real download of a real CAD file over whatever signal is going.
//!
//! Two things keep that honest. Where SolidWorks stored a PNG inside the file
//! itself, no rendering is needed once the bytes are here, and that PNG is
//! cached on disk against the object id, which never changes for a given
//! revision of a file. A preview is therefore paid for once, ever.
//!
//! The catch, and it is a big one: only files saved as OLE compound files
//! carry a preview that can be read this way. SolidWorks 2015 and later use
//! their own container with no image in it that anything but SolidWorks can
//! find. For those files there is no preview on a phone, and the honest thing
//! is to find that out from eight bytes rather than from a whole download.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use base64::Engine;
use serde_json::json;

use crate::error::{AppError, AppResult};

use super::{net, Api};

const LFS_JSON: &str = "application/vnd.git-lfs+json";

/// Anything past this is an assembly nobody wants to pull down a phone line
/// for the sake of a 200 pixel picture.
pub const DEFAULT_MAX_BYTES: u64 = 25 * 1024 * 1024;

/// How many previews to fetch at once. Three keeps a folder filling in
/// steadily without holding the whole connection.
const AT_ONCE: usize = 3;

#[derive(Debug, Clone)]
pub struct Pointer {
    pub oid: String,
    pub size: u64,
}

/// A Git LFS pointer is three short lines of text. Anything else is the file
/// itself, which means it was never in LFS and there is nothing to fetch.
pub fn parse_pointer(text: &str) -> Option<Pointer> {
    if !text.starts_with("version https://git-lfs") {
        return None;
    }
    let mut oid = None;
    let mut size = None;
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("oid sha256:") {
            oid = Some(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("size ") {
            size = rest.trim().parse::<u64>().ok();
        }
    }
    Some(Pointer {
        oid: oid?,
        size: size?,
    })
}

fn cache_file(cache_dir: &Path, oid: &str) -> PathBuf {
    cache_dir.join("previews").join(format!("{oid}.png"))
}

/// A file SolidWorks saved without a preview is remembered against its path,
/// not its object id: the id costs a network call to learn, and not making
/// that call again is the whole point of remembering.
fn blank_file(cache_dir: &Path, path: &str) -> PathBuf {
    let key: String = path
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    cache_dir.join("previews").join(format!("{key}.blank"))
}

fn as_data_url(png: &[u8]) -> String {
    format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png)
    )
}

/// Ask the LFS server where an object lives. GitHub answers with a signed URL
/// that carries its own credentials, so the download itself is unauthenticated.
async fn download_url(
    api: &Api,
    pointer: &Pointer,
    branch: &str,
) -> AppResult<(String, HashMap<String, String>)> {
    let resp = api
        .http
        .post(format!(
            "https://github.com/{}.git/info/lfs/objects/batch",
            api.slug
        ))
        .header("Authorization", basic(api))
        .header("Accept", LFS_JSON)
        .header("Content-Type", LFS_JSON)
        .json(&json!({
            "operation": "download",
            "transfers": ["basic"],
            "ref": { "name": format!("refs/heads/{branch}") },
            "objects": [{ "oid": pointer.oid, "size": pointer.size }],
        }))
        .send()
        .await
        .map_err(net)?;

    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::new(
            "LFS",
            format!("Git LFS would not hand over the file ({status}) {body}"),
        ));
    }

    let v: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| AppError::new("PARSE", format!("unexpected LFS batch JSON: {e}")))?;
    let object = v
        .get("objects")
        .and_then(|o| o.as_array())
        .and_then(|a| a.first())
        .ok_or_else(|| AppError::new("LFS", "Git LFS did not answer about that file."))?;

    if let Some(err) = object.get("error") {
        let said = err
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("the object is not on the server");
        return Err(AppError::new("LFS", said.to_string()));
    }

    let action = object
        .get("actions")
        .and_then(|a| a.get("download"))
        .ok_or_else(|| {
            AppError::new(
                "LFS",
                "Git LFS gave no way to download that file. It may not have been pushed.",
            )
        })?;
    let href = action
        .get("href")
        .and_then(|h| h.as_str())
        .ok_or_else(|| AppError::new("LFS", "Git LFS gave a download with no address."))?
        .to_string();

    let mut headers = HashMap::new();
    if let Some(map) = action.get("header").and_then(|h| h.as_object()) {
        for (k, val) in map {
            if let Some(s) = val.as_str() {
                headers.insert(k.clone(), s.to_string());
            }
        }
    }
    Ok((href, headers))
}

/// The OLE compound file signature. Everything SolidWorks saved before 2015
/// starts with it; nothing it saves now does.
fn looks_like_compound_file(head: &[u8]) -> bool {
    head.starts_with(&[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])
}

async fn fetch(
    api: &Api,
    href: &str,
    headers: &HashMap<String, String>,
    range: Option<&str>,
) -> AppResult<(reqwest::StatusCode, Vec<u8>)> {
    let mut req = api.http.get(href);
    for (k, v) in headers {
        req = req.header(k, v);
    }
    if let Some(range) = range {
        req = req.header(reqwest::header::RANGE, range);
    }
    let resp = req.send().await.map_err(net)?;
    let status = resp.status();
    if !status.is_success() {
        return Err(AppError::new(
            "LFS",
            format!("The download was refused ({status})"),
        ));
    }
    Ok((status, resp.bytes().await.map_err(net)?.to_vec()))
}

fn remember_blank(cache_dir: &Path, path: &str) {
    let file = blank_file(cache_dir, path);
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(file, []);
}

fn basic(api: &Api) -> String {
    let login = if api.login.is_empty() {
        "x-access-token"
    } else {
        api.login.as_str()
    };
    format!(
        "Basic {}",
        base64::engine::general_purpose::STANDARD
            .encode(format!("{login}:{}", api.token))
    )
}

/// The preview for one file, as a data URL, or None when there is nothing to
/// show: not an LFS file, too big to be worth it, or a file SolidWorks saved
/// without a preview.
pub async fn preview(
    api: &Api,
    cache_dir: &Path,
    path: &str,
    branch: &str,
    max_bytes: u64,
) -> AppResult<Option<String>> {
    let text = match super::gh::raw_file(api, path, branch).await {
        Ok(t) => t,
        Err(e) if e.code == "MISSING" => return Ok(None),
        Err(e) => return Err(e),
    };
    let Some(pointer) = parse_pointer(&text) else {
        return Ok(None);
    };
    if known_blank(cache_dir, path) {
        return Ok(None);
    }

    let cached = cache_file(cache_dir, &pointer.oid);
    if let Ok(bytes) = std::fs::read(&cached) {
        return Ok(Some(as_data_url(&bytes)));
    }
    if pointer.size > max_bytes {
        crate::logger::info(format!(
            "cloud: skipping the preview for {path}, {} MB is over the limit",
            pointer.size / (1024 * 1024)
        ));
        return Ok(None);
    }

    let (href, headers) = download_url(api, &pointer, branch).await?;

    // Look at the first eight bytes before pulling the whole model down.
    //
    // The preview we can read lives in an OLE compound file, which starts
    // with a fixed signature. SolidWorks 2015 and later save in their own
    // container instead, and there is no image in one of those that can be
    // found without SolidWorks itself. Asking for eight bytes settles it;
    // guessing wrong costs a twenty megabyte download over somebody's mobile
    // data for a picture that was never going to arrive.
    let (status, head) = fetch(api, &href, &headers, Some("bytes=0-7")).await?;
    let whole_file_came_back = status == reqwest::StatusCode::OK;

    if !looks_like_compound_file(&head) && !whole_file_came_back {
        crate::logger::info(format!(
            "cloud: {path} is not a compound file, so it carries no preview to read"
        ));
        remember_blank(cache_dir, path);
        return Ok(None);
    }

    // A server that ignored the range handed over everything already; there is
    // nothing to gain by asking twice.
    let bytes = if whole_file_came_back {
        head
    } else {
        let (_, full) = fetch(api, &href, &headers, None).await?;
        full
    };

    if let Some(dir) = cached.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    match crate::thumbs::embedded_png_in(&bytes) {
        Some(png) => {
            let _ = std::fs::write(&cached, &png);
            Ok(Some(as_data_url(&png)))
        }
        // Remembered as a blank so the file is not downloaded again on every
        // scroll past it.
        None => {
            remember_blank(cache_dir, path);
            Ok(None)
        }
    }
}

/// Previews for a screenful of files, a few at a time. Anything already on
/// disk answers without touching the network at all.
pub async fn previews(
    api: &Api,
    cache_dir: &Path,
    paths: Vec<String>,
    branch: &str,
    max_bytes: u64,
) -> AppResult<HashMap<String, String>> {
    let mut found = HashMap::new();
    let mut wanted = Vec::new();

    for path in paths {
        // A file we already know has no preview is not asked about again.
        if known_blank(cache_dir, &path) {
            continue;
        }
        wanted.push(path);
    }

    for chunk in wanted.chunks(AT_ONCE) {
        let mut set = tokio::task::JoinSet::new();
        for path in chunk {
            let api = api.clone();
            let dir = cache_dir.to_path_buf();
            let branch = branch.to_string();
            let path = path.clone();
            set.spawn(async move {
                let got = preview(&api, &dir, &path, &branch, max_bytes).await;
                (path, got)
            });
        }
        while let Some(joined) = set.join_next().await {
            if let Ok((path, Ok(Some(uri)))) = joined {
                found.insert(path, uri);
            }
        }
    }
    Ok(found)
}

fn known_blank(cache_dir: &Path, path: &str) -> bool {
    blank_file(cache_dir, path).exists()
}

/// Bytes on disk, so Settings can show what the previews are costing and
/// offer to throw them away.
pub fn cache_size(cache_dir: &Path) -> u64 {
    let dir = cache_dir.join("previews");
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .filter_map(|e| e.metadata().ok())
        .map(|m| m.len())
        .sum()
}

pub fn clear_cache(cache_dir: &Path) {
    let _ = std::fs::remove_dir_all(cache_dir.join("previews"));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_real_pointer() {
        let p = parse_pointer(
            "version https://git-lfs.github.com/spec/v1\n\
             oid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393\n\
             size 12345\n",
        )
        .unwrap();
        assert_eq!(p.size, 12345);
        assert!(p.oid.starts_with("4d7a2146"));
    }

    #[test]
    fn a_normal_file_is_not_a_pointer() {
        assert!(parse_pointer("solid body\nfacet normal 0 0 1\n").is_none());
    }

    #[test]
    fn knows_a_compound_file_from_a_modern_one() {
        assert!(looks_like_compound_file(&[
            0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0x00
        ]));
        // SolidWorks 2015 and later; there is no preview to be had.
        assert!(!looks_like_compound_file(&[0x7F, 0xA2, 0xC4, 0xE9, 0x00, 0x00, 0x00, 0x04]));
        assert!(!looks_like_compound_file(&[0xD0, 0xCF]));
        assert!(!looks_like_compound_file(&[]));
    }

    #[test]
    fn a_truncated_pointer_is_refused_rather_than_half_read() {
        assert!(parse_pointer("version https://git-lfs.github.com/spec/v1\noid sha256:abc\n").is_none());
    }
}
