//! Append-only debug logging

use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const MAX_BYTES: u64 = 2 * 1024 * 1024;
const DEDUPE_WINDOW: Duration = Duration::from_secs(30);

struct LogState {
    last_message: String,
    last_at: Option<Instant>,
}

static STATE: Mutex<LogState> = Mutex::new(LogState {
    last_message: String::new(),
    last_at: None,
});

pub fn log_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("LOCALAPPDATA")
            .map(|d| PathBuf::from(d).join(crate::PRODUCT_DIR).join("logs"))
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME")
            .map(|d| PathBuf::from(d).join("Library").join("Logs").join(crate::PRODUCT_DIR))
    }
}

pub fn info(msg: impl AsRef<str>) {
    write_line("INFO", msg.as_ref());
}

pub fn warn(msg: impl AsRef<str>) {
    write_line("WARN", msg.as_ref());
}

pub fn error(msg: impl AsRef<str>) {
    write_line("ERROR", msg.as_ref());
}

pub fn write_line(level: &str, msg: &str) {
    let Some(dir) = log_dir() else { return };

    let mut state = match STATE.lock() {
        Ok(s) => s,
        Err(poisoned) => poisoned.into_inner(),
    };
    if state.last_message == msg {
        if let Some(at) = state.last_at {
            if at.elapsed() < DEDUPE_WINDOW {
                return;
            }
        }
    }
    state.last_message = msg.to_string();
    state.last_at = Some(Instant::now());

    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("solidlocker.log");
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > MAX_BYTES {
            let old = dir.join("solidlocker.old.log");
            let _ = std::fs::remove_file(&old);
            let _ = std::fs::rename(&path, &old);
        }
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "[{}] [{level}] {msg}", timestamp());
    }
}

pub fn one_line(text: &str, max: usize) -> String {
    let joined: String = text
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if joined.len() <= max {
        joined
    } else {
        let mut end = max;
        while !joined.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}…", &joined[..end])
    }
}

fn timestamp() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let ms = now.subsec_millis();
    let (y, m, d) = civil_from_days((secs / 86400) as i64);
    let tod = secs % 86400;
    format!(
        "{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02}.{ms:03}Z",
        tod / 3600,
        (tod % 3600) / 60,
        tod % 60
    )
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_723), (2024, 1, 1));
    }

    #[test]
    fn one_line_shortens() {
        assert_eq!(one_line("a  b\nc", 100), "a b c");
        assert_eq!(one_line("abcdef", 3), "abc…");
    }
}
