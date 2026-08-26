//! Watcher keeps an eye on the project folder.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager};


pub const FOLDER_CHANGED: &str = "repo-folder-changed";
#[derive(Default)]
pub struct FolderWatch {
    current: Mutex<Option<(PathBuf, RecommendedWatcher)>>,
}

fn ignored(path: &Path) -> bool {
    let text = path.to_string_lossy().replace('\\', "/").to_lowercase();
    // Git rewrites its own innards constantly.
    if text.contains("/.git/") || text.ends_with("/.git") {
        return true;
    }
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|name| {
            let lower = name.to_lowercase();
            // SolidWorks' ~$ companions and the half-written pieces git and
            // LFS leave behind mid-command.
            name.starts_with("~$") || lower.ends_with(".tmp") || lower.ends_with(".lock")
        })
        .unwrap_or(false)
}

/// Start watching `root`, replacing whatever was being watched before.
pub fn watch_repo(app: &AppHandle, root: &Path) {
    let state = app.state::<FolderWatch>();
    let Ok(mut current) = state.current.lock() else {
        return;
    };
    if current
        .as_ref()
        .map(|(watched, _)| watched == root)
        .unwrap_or(false)
    {
        return;
    }
    *current = None;

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    let mut watcher = match notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else {
            return;
        };
        if event.paths.iter().all(|p| ignored(p)) {
            return;
        }
        let _ = tx.send(());
    }) {
        Ok(w) => w,
        Err(e) => {
            crate::logger::info(format!("could not watch the project folder: {e}"));
            return;
        }
    };

    if let Err(e) = watcher.watch(root, RecursiveMode::Recursive) {
        crate::logger::info(format!("could not watch the project folder: {e}"));
        return;
    }

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while rx.recv().await.is_some() {
            // Saving one document writes a burst of events and a branch switch
            // writes thousands. Wait for the folder to settle, then say so once.
            loop {
                match tokio::time::timeout(Duration::from_millis(700), rx.recv()).await {
                    Ok(Some(())) => continue,
                    _ => break,
                }
            }
            let _ = handle.emit(FOLDER_CHANGED, ());
        }
    });

    *current = Some((root.to_path_buf(), watcher));
    crate::logger::info(format!("watching {} for changes", root.display()));
}
