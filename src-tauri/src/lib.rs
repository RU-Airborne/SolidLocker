mod avatars;
// Phone only, so the desktop binary does not carry it.
#[cfg(any(mobile, test))]
#[cfg_attr(test, allow(dead_code))]
mod cloud;
mod conflicts;
mod deps;
mod doctor;
mod error;
mod fsattr;
mod gate;
mod ghapi;
mod lfs;
mod logger;
mod proc;
mod pulls;
mod radar;
mod repo;
#[cfg_attr(mobile, allow(dead_code))]
mod messages;
mod people;
mod settings;
mod swrefs;
mod thumbs;
mod updates;
#[cfg(desktop)]
mod watch;
mod workflow;

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, State};

use error::{AppError, AppResult};
use lfs::LocksResult;
use repo::{AppState, FileEntry, RepoInfo};

const KEY_REPO_PATH: &str = "repo_path";
const KEY_USERNAME: &str = "lfs_username";
const KEY_GH_USERNAME: &str = "github_username";
const KEY_PREVIEW_RETURN: &str = "preview_return_branch";

pub const PRODUCT_DIR: &str = "SolidLocker";

fn current_repo(app: &AppHandle) -> AppResult<PathBuf> {
    let path = settings::get_string(app, KEY_REPO_PATH)?
        .ok_or_else(|| AppError::new("REPO", messages::NO_REPO_SELECTED))?;
    let p = PathBuf::from(&path);
    if !p.is_dir() {
        return Err(AppError::new("REPO", messages::repo_folder_missing(&path)));
    }
    Ok(p)
}

/// Close to the tray
#[tauri::command]
async fn hide_to_tray(app: AppHandle) -> AppResult<()> {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.destroy();
    }
    Ok(())
}


#[tauri::command]
async fn quit_app(app: AppHandle) -> AppResult<()> {
    app.exit(0);
    Ok(())
}

#[tauri::command]
async fn open_logs_folder() -> AppResult<()> {
    let dir = logger::log_dir()
        .ok_or_else(|| AppError::new("LOG", messages::NO_LOG_FOLDER))?;
    std::fs::create_dir_all(&dir).map_err(AppError::from)?;
    tauri_plugin_opener::open_path(dir.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|e| AppError::new("OPEN", e.to_string()))
}

#[tauri::command]
async fn log_frontend(message: String) -> AppResult<()> {
    let trimmed: String = message.chars().take(2000).collect();
    logger::write_line("FRONTEND", &trimmed);
    Ok(())
}

#[tauri::command]
async fn get_app_state(app: AppHandle) -> AppResult<AppState> {
    let cwd = std::env::temp_dir();
    let (git_ok, lfs_ok, lfs_version) = repo::preflight(&cwd).await;
    logger::info(format!(
        "preflight: git_ok={git_ok} lfs_ok={lfs_ok} lfs={}",
        lfs_version.as_deref().unwrap_or("-")
    ));

    let mut repo_info: Option<RepoInfo> = None;
    if let Some(saved) = settings::get_string(&app, KEY_REPO_PATH)? {
        if PathBuf::from(&saved).is_dir() {
            match repo::validate_repo(&saved).await {
                Ok(info) => repo_info = Some(info),
                Err(e) if e.code == "REPO" => {
                    logger::warn(format!(
                        "saved repository at {saved} was rejected ({e}); clearing the saved path"
                    ));
                    settings::delete_key(&app, KEY_REPO_PATH)?;
                }
                Err(e) => {
                    logger::error(format!("could not validate the saved repository at {saved}: {e}"));
                    return Err(e);
                }
            }
        } else {
            logger::warn(format!("saved repository folder {saved} is gone; clearing the saved path"));
            settings::delete_key(&app, KEY_REPO_PATH)?;
        }
    }

    // Note: deliberately no keychain probe here. The OAuth token is unused
    // since the GitHub-API features were descoped, and probing triggers a
    // macOS keychain permission prompt on every (re)build.
    Ok(AppState {
        repo: repo_info,
        signed_in: false,
        // Prefer the (dormant) OAuth identity, else the LFS username learned
        // from fresh lock responses, which is the only one that exists in
        // practice.
        username: match settings::get_string(&app, KEY_GH_USERNAME)? {
            Some(u) => Some(u),
            None => settings::get_string(&app, KEY_USERNAME)?,
        },
        git_ok,
        lfs_ok,
        lfs_version,
    })
}

#[tauri::command]
async fn get_file_history(app: AppHandle, path: String) -> AppResult<Vec<repo::FileCommit>> {
    let root = current_repo(&app)?;
    repo::file_history(&root, &path).await
}

#[tauri::command]
async fn get_commit_stats(app: AppHandle) -> AppResult<Vec<repo::CommitStat>> {
    let root = current_repo(&app)?;
    repo::commit_stats(&root, 400).await
}

#[tauri::command]
async fn check_outside_refs(
    app: AppHandle,
    paths: Vec<String>,
) -> AppResult<deps::OutsideCheck> {
    let root = current_repo(&app)?;
    deps::outside_references(&root, paths).await
}

/// From origin/HEAD; the fetches keep it current.
#[tauri::command]
async fn check_for_update() -> AppResult<updates::UpdateCheck> {
    updates::check().await
}

/// Every reference between files in the project.
#[tauri::command]
async fn get_dependency_graph(app: AppHandle) -> AppResult<Vec<deps::DepEdge>> {
    let root = current_repo(&app)?;
    deps::dependency_graph(&root).await
}

#[tauri::command]
async fn get_default_branch(app: AppHandle) -> AppResult<String> {
    let root = current_repo(&app)?;
    Ok(repo::default_branch(&root).await)
}

#[tauri::command]
async fn list_pulls(app: AppHandle) -> AppResult<Vec<pulls::PullSummary>> {
    let root = current_repo(&app)?;
    pulls::list(&pulls::api_for_repo(&root).await?).await
}

#[tauri::command]
async fn pull_detail(app: AppHandle, number: u64) -> AppResult<pulls::PullDetail> {
    let root = current_repo(&app)?;
    pulls::detail(&pulls::api_for_repo(&root).await?, number).await
}

#[tauri::command]
async fn create_pull(
    app: AppHandle,
    title: String,
    body: String,
    head: String,
    base: String,
) -> AppResult<u64> {
    let root = current_repo(&app)?;
    pulls::create(&pulls::api_for_repo(&root).await?, &title, &body, &head, &base).await
}

#[tauri::command]
async fn review_pull(
    app: AppHandle,
    number: u64,
    event: String,
    body: String,
) -> AppResult<bool> {
    let root = current_repo(&app)?;
    pulls::review(&pulls::api_for_repo(&root).await?, number, &event, &body).await
}

#[tauri::command]
async fn merge_pull(
    app: AppHandle,
    gate: State<'_, gate::RepoGate>,
    number: u64,
    method: String,
) -> AppResult<()> {
    let root = current_repo(&app)?;
    let _tree = gate.exclusive().await;
    pulls::merge(&pulls::api_for_repo(&root).await?, number, &method).await
}

#[tauri::command]
async fn close_pull(app: AppHandle, number: u64) -> AppResult<()> {
    let root = current_repo(&app)?;
    pulls::close(&pulls::api_for_repo(&root).await?, number).await
}

/// Branch names for the two sides of a merge in progress.
#[tauri::command]
async fn conflict_sides(app: AppHandle) -> AppResult<(String, String)> {
    let root = current_repo(&app)?;
    conflicts::sides(&root).await
}

/// Files that would clash if `branch` were merged in. Nothing is merged.
#[tauri::command]
async fn plan_conflicts(app: AppHandle, branch: String) -> AppResult<Vec<conflicts::Conflict>> {
    let root = current_repo(&app)?;
    conflicts::plan(&root, &branch).await
}

/// Same, between two remote branches; works from any checkout.
#[tauri::command]
async fn plan_conflicts_between(
    app: AppHandle,
    base: String,
    head: String,
) -> AppResult<Vec<conflicts::Conflict>> {
    let root = current_repo(&app)?;
    conflicts::plan_between(&root, &base, &head).await
}

#[tauri::command]
async fn branch_protection(app: AppHandle, branch: String) -> AppResult<pulls::Protection> {
    let root = current_repo(&app)?;
    pulls::protection(&pulls::api_for_repo(&root).await?, &branch).await
}

/// Which side each clashing file took in a past merge, read from the merge commit.
#[tauri::command]
async fn merged_picks(app: AppHandle, sha: String) -> AppResult<conflicts::MergedPlan> {
    let root = current_repo(&app)?;
    conflicts::merged_picks(&root, &sha).await
}

/// Post picks on a review as a proposal. Nothing is merged.
#[tauri::command]
async fn propose_picks(
    app: AppHandle,
    number: u64,
    commit_id: String,
    picks: Vec<pulls::Proposal>,
    event: String,
    body: String,
) -> AppResult<bool> {
    let root = current_repo(&app)?;
    pulls::propose(&pulls::api_for_repo(&root).await?, number, &commit_id, &picks, &event, &body).await
}

/// Merge a branch, settling clashes per the picks, then push.
#[tauri::command]
async fn combine_with_picks(
    app: AppHandle,
    gate: State<'_, gate::RepoGate>,
    branch: String,
    picks: Vec<conflicts::Pick>,
) -> AppResult<()> {
    let root = current_repo(&app)?;
    let _tree = gate.exclusive().await;
    conflicts::combine_with_picks(&root, &branch, &picks).await
}

#[tauri::command]
async fn list_conflicts(app: AppHandle) -> AppResult<Vec<conflicts::Conflict>> {
    let root = current_repo(&app)?;
    conflicts::list(&root).await
}

/// Thumbnail of one side of a conflicted CAD file.
#[tauri::command]
async fn preview_conflict_side(
    app: AppHandle,
    cache: State<'_, thumbs::ThumbCache>,
    path: String,
    side: String,
) -> AppResult<Option<String>> {
    let root = current_repo(&app)?;
    let scratch = conflicts::extract_side(&root, &path, &side).await?;
    let dir = scratch.parent().unwrap_or(&root).to_path_buf();
    let name = scratch
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let drawn = thumbs::thumbnails(&dir, vec![name.clone()], 256, &cache).await?;
    let _ = std::fs::remove_file(&scratch);
    Ok(drawn.get(&name).cloned())
}

/// Open one side of a conflicted file in SolidWorks, as a read-only scratch copy.
#[tauri::command]
async fn open_conflict_side(app: AppHandle, path: String, side: String) -> AppResult<()> {
    let root = current_repo(&app)?;
    let scratch = conflicts::extract_side(&root, &path, &side).await?;
    let _ = fsattr::set_readonly(&scratch, true);
    tauri_plugin_opener::open_path(scratch.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|e| AppError::new("OPEN", e.to_string()))
}

#[tauri::command]
async fn resolve_conflict(
    app: AppHandle,
    gate: State<'_, gate::RepoGate>,
    path: String,
    side: String,
) -> AppResult<()> {
    let root = current_repo(&app)?;
    let _tree = gate.exclusive().await;
    conflicts::resolve(&root, &path, &side).await
}

#[tauri::command]
async fn finish_conflicts(
    app: AppHandle,
    gate: State<'_, gate::RepoGate>,
    picks: Vec<conflicts::Pick>,
) -> AppResult<()> {
    let root = current_repo(&app)?;
    let _tree = gate.exclusive().await;
    conflicts::finish(&root, &picks).await
}

#[tauri::command]
async fn abandon_conflicts(
    app: AppHandle,
    gate: State<'_, gate::RepoGate>,
) -> AppResult<()> {
    let root = current_repo(&app)?;
    let _tree = gate.exclusive().await;
    conflicts::abandon(&root).await
}

/// Assemblies that use this part.
#[tauri::command]
async fn get_used_by(app: AppHandle, path: String) -> AppResult<Vec<String>> {
    let root = current_repo(&app)?;
    deps::used_by(&root, &path).await
}

/// Stop a lock/unlock in progress; whatever it already did is rolled back.
#[tauri::command]
async fn cancel_lock_run(cancel: State<'_, workflow::CancelFlag>) -> AppResult<()> {
    cancel.request();
    Ok(())
}

/// Other branches changing files this branch has also changed.
#[tauri::command]
async fn get_collisions(app: AppHandle) -> AppResult<Vec<radar::Collision>> {
    let root = current_repo(&app)?;
    radar::collisions(&root).await
}

#[tauri::command]
async fn run_setup_checks(app: AppHandle) -> AppResult<Vec<doctor::Check>> {
    let root = current_repo(&app)?;
    doctor::run_checks(&root).await
}

#[tauri::command]
async fn get_commit_identities(app: AppHandle) -> AppResult<Vec<repo::CommitIdentity>> {
    let root = current_repo(&app)?;
    repo::list_commit_identities(&root).await
}

#[tauri::command]
async fn get_sw_sound(name: String) -> AppResult<Option<String>> {
    #[cfg(windows)]
    {
        Ok(swrefs::solidworks_sound(&name))
    }
    #[cfg(not(windows))]
    {
        let _ = name;
        Ok(None)
    }
}

#[tauri::command]
async fn get_sw_installed() -> AppResult<bool> {
    #[cfg(windows)]
    {
        Ok(swrefs::solidworks_install_dir().is_some())
    }
    #[cfg(not(windows))]
    {
        Ok(false)
    }
}

#[tauri::command]
async fn get_sw_icon() -> AppResult<Option<String>> {
    #[cfg(windows)]
    {
        Ok(swrefs::solidworks_icon().await)
    }
    #[cfg(not(windows))]
    {
        Ok(None)
    }
}

/// Preview pictures
#[tauri::command]
async fn get_thumbnails(
    app: AppHandle,
    cache: State<'_, thumbs::ThumbCache>,
    paths: Vec<String>,
    px: u32,
) -> AppResult<std::collections::HashMap<String, String>> {
    let root = current_repo(&app)?;
    thumbs::thumbnails(&root, paths, px, &cache).await
}

#[tauri::command]
async fn get_open_documents(app: AppHandle) -> AppResult<Vec<String>> {
    let root = current_repo(&app)?;
    #[cfg(windows)]
    {
        let root_prefix = root.to_string_lossy().replace('\\', "/").to_lowercase();
        let mut rels = Vec::new();
        for abs in swrefs::solidworks_open_documents().await {
            let norm = abs.replace('\\', "/");
            let lower = norm.to_lowercase();
            if let Some(rest) = lower.strip_prefix(&root_prefix) {
                let rel = norm[norm.len() - rest.len()..].trim_start_matches('/');
                if !rel.is_empty() {
                    rels.push(rel.to_string());
                }
            }
        }
        Ok(rels)
    }
    #[cfg(not(windows))]
    {
        let _ = root;
        Ok(Vec::new())
    }
}

#[tauri::command]
async fn open_file(app: AppHandle, path: String) -> AppResult<()> {
    let root = current_repo(&app)?;
    let abs = root.join(&path);
    if !abs.starts_with(&root) || !abs.exists() {
        return Err(AppError::new("OPEN", messages::file_not_found(&path)));
    }
    tauri_plugin_opener::open_path(abs.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|e| AppError::new("OPEN", e.to_string()))
}

#[tauri::command]
async fn open_repo_folder(app: AppHandle) -> AppResult<()> {
    let root = current_repo(&app)?;
    tauri_plugin_opener::open_path(root.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|e| AppError::new("OPEN", e.to_string()))
}

#[tauri::command]
async fn list_repo_branches(app: AppHandle) -> AppResult<Vec<String>> {
    let root = current_repo(&app)?;
    repo::remote_branches(&root).await
}

/// Every team branch with how far it has diverged, for the Progress page.
/// A picture of a file as it was at an earlier commit, so nobody has to
/// restore one to find out whether it is the right one.
#[tauri::command]
async fn preview_version(
    app: AppHandle,
    cache: State<'_, thumbs::ThumbCache>,
    path: String,
    sha: String,
) -> AppResult<Option<String>> {
    let root = current_repo(&app)?;
    let scratch = repo::extract_version(&root, &path, &sha).await?;
    let dir = scratch.parent().unwrap_or(&root).to_path_buf();
    let name = scratch
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();

    let drawn = thumbs::thumbnails(&dir, vec![name.clone()], 256, &cache).await?;
    let _ = std::fs::remove_file(&scratch);
    Ok(drawn.get(&name).cloned())
}

/// Brings an earlier version of one or more files into the working tree as
/// the next change. History moves forward; nothing is rewritten. Restoring an
/// assembly together with its referenced parts keeps the mating consistent.
// #[tauri::command]
// async fn plan_undo(app: AppHandle, sha: String) -> AppResult<repo::UndoPlan> {
//     let root = current_repo(&app)?;
//     repo::plan_undo(&root, &sha).await
// }
//
// #[tauri::command]
// async fn undo_change(
//     app: AppHandle,
//     gate: State<'_, gate::RepoGate>,
//     sha: String,
// ) -> AppResult<()> {
//     let root = current_repo(&app)?;
//     let plan = repo::plan_undo(&root, &sha).await?;
//
//     // same rule as restoring a version: only files you hold the lock on
//     let touched: Vec<String> = plan
//         .restore
//         .iter()
//         .chain(plan.remove.iter())
//         .cloned()
//         .collect();
//     let username_hint = settings::get_string(&app, KEY_USERNAME)?;
//     let locks = lfs::get_locks(&root, username_hint.as_deref()).await?;
//     let mine: std::collections::HashSet<String> =
//         locks.ours.iter().map(|l| l.path.to_lowercase()).collect();
//     let missing: Vec<&str> = touched
//         .iter()
//         .filter(|p| !mine.contains(&p.to_lowercase()))
//         .map(String::as_str)
//         .collect();
//     if !missing.is_empty() {
//         return Err(AppError::with_detail(
//             "RESTORE",
//             messages::restore_needs_locks(&missing.join(", ")),
//             serde_json::json!({ "files": missing }),
//         ));
//     }
//
//     let _tree = gate.exclusive().await;
//     repo::undo_change(&root, &plan).await
// }

#[tauri::command]
async fn restore_version(
    app: AppHandle,
    gate: State<'_, gate::RepoGate>,
    paths: Vec<String>,
    sha: String,
) -> AppResult<()> {
    let root = current_repo(&app)?;

    // Editing files you do not hold is exactly what the app exists to
    // prevent, and they would be read-only on disk anyway.
    let username_hint = settings::get_string(&app, KEY_USERNAME)?;
    let locks = lfs::get_locks(&root, username_hint.as_deref()).await?;
    let mine: std::collections::HashSet<String> =
        locks.ours.iter().map(|l| l.path.to_lowercase()).collect();
    let missing: Vec<&str> = paths
        .iter()
        .filter(|p| !mine.contains(&p.to_lowercase()))
        .map(String::as_str)
        .collect();
    if !missing.is_empty() {
        return Err(AppError::with_detail(
            "RESTORE",
            messages::restore_needs_locks(&missing.join(", ")),
            serde_json::json!({ "files": missing }),
        ));
    }

    #[cfg(windows)]
    {
        let open_docs: std::collections::HashSet<String> = swrefs::solidworks_open_documents()
            .await
            .into_iter()
            .map(|p| p.replace('\\', "/").to_lowercase())
            .collect();
        let blocked: Vec<&str> = paths
            .iter()
            .filter(|p| {
                let abs = root
                    .join(p.as_str())
                    .to_string_lossy()
                    .replace('\\', "/")
                    .to_lowercase();
                open_docs.contains(&abs)
            })
            .map(String::as_str)
            .collect();
        if !blocked.is_empty() {
            return Err(AppError::with_detail(
                "RESTORE",
                messages::restore_files_open(&blocked.join(", ")),
                serde_json::json!({ "files": blocked }),
            ));
        }
    }

    let _tree = gate.exclusive().await;
    repo::restore_version_files(&root, &paths, &sha).await
}

/// The parts an assembly referenced at a given commit, resolved against that
/// same commit's file list.
#[tauri::command]
async fn resolve_references_at(
    app: AppHandle,
    path: String,
    sha: String,
) -> AppResult<workflow::RefsAtResult> {
    let root = current_repo(&app)?;
    workflow::resolve_references_at(&root, &path, &sha).await
}

/// Opens a read-only scratch copy of a file as it was at a commit, for an
/// assembly, together with its referenced parts from that same commit.
#[tauri::command]
async fn open_version(app: AppHandle, path: String, sha: String) -> AppResult<String> {
    let root = current_repo(&app)?;
    workflow::open_version(&root, &path, &sha).await
}

/// Starts a new branch at an old commit and switches to it. The safe way to
/// explore or continue from an earlier version.
#[tauri::command]
async fn branch_from_commit(
    app: AppHandle,
    gate: State<'_, gate::RepoGate>,
    name: String,
    sha: String,
) -> AppResult<repo::SwitchResult> {
    let root = current_repo(&app)?;
    let _switching = gate.exclusive_switch().await;
    repo::branch_from_commit(&root, &name, &sha).await
}

/// Every branch's commits for the History page.
#[tauri::command]
async fn get_graph(app: AppHandle) -> AppResult<Vec<repo::GraphCommit>> {
    let root = current_repo(&app)?;
    repo::commit_graph(&root, 300).await
}

#[tauri::command]
async fn get_commit_files(app: AppHandle, sha: String) -> AppResult<Vec<repo::CommitFileChange>> {
    let root = current_repo(&app)?;
    repo::commit_files(&root, &sha).await
}

/// New branch from the switcher: either carrying an existing branch's work
/// forward, or starting completely fresh (empty, locking rules written).
#[tauri::command]
async fn create_branch(
    app: AppHandle,
    gate: State<'_, gate::RepoGate>,
    name: String,
    from: Option<String>,
) -> AppResult<()> {
    let root = current_repo(&app)?;
    let _switching = gate.exclusive_switch().await;
    match from {
        Some(src) => {
            // prefer the freshest picture of the source branch; a bare name
            // only resolves if a local branch happens to exist
            let remote_ref = format!("refs/remotes/origin/{src}");
            let has_remote =
                proc::run_git(&root, &["rev-parse", "--verify", "--quiet", &remote_ref], 15)
                    .await
                    .map(|o| o.ok())
                    .unwrap_or(false);
            let start = if has_remote {
                format!("origin/{src}")
            } else {
                src
            };
            repo::branch_from_commit(&root, &name, &start).await?;
        }
        None => {
            repo::create_fresh_branch(&root, &name).await?;
        }
    }
    Ok(())
}

/// Park the working tree on an old commit for a look around.
#[tauri::command]
async fn preview_commit(
    app: AppHandle,
    gate: State<'_, gate::RepoGate>,
    sha: String,
) -> AppResult<()> {
    let root = current_repo(&app)?;
    let _switching = gate.exclusive_switch().await;
    let from = repo::preview_commit(&root, &sha).await?;
    // Jumping between previewed commits keeps the ORIGINAL return branch.
    if settings::get_string(&app, KEY_PREVIEW_RETURN)?.is_none()
        && !from.is_empty()
        && from != "(detached)"
    {
        settings::set_string(&app, KEY_PREVIEW_RETURN, &from)?;
    }
    Ok(())
}

/// Back to the branch the user was on before the preview.
#[tauri::command]
async fn end_preview(app: AppHandle, gate: State<'_, gate::RepoGate>) -> AppResult<()> {
    let root = current_repo(&app)?;
    let Some(branch) = settings::get_string(&app, KEY_PREVIEW_RETURN)? else {
        return Err(AppError::new("GIT", messages::NOT_PREVIEWING));
    };
    let _switching = gate.exclusive_switch().await;
    repo::end_preview(&root, &branch).await?;
    settings::delete_key(&app, KEY_PREVIEW_RETURN)?;
    Ok(())
}

/// The branch a preview will return to, or null when not previewing.
#[tauri::command]
async fn get_preview_state(app: AppHandle) -> AppResult<Option<String>> {
    settings::get_string(&app, KEY_PREVIEW_RETURN)
}

/// Branch off carrying only the chosen files back to `sha`; the rest of the
/// project stays current on the new branch.
#[tauri::command]
async fn branch_from_commit_files(
    app: AppHandle,
    gate: State<'_, gate::RepoGate>,
    name: String,
    sha: String,
    paths: Vec<String>,
) -> AppResult<()> {
    let root = current_repo(&app)?;

    // SolidWorks would write its in-memory copy straight over the restored
    // version; same guard as a plain restore.
    #[cfg(windows)]
    {
        let open_docs: std::collections::HashSet<String> = swrefs::solidworks_open_documents()
            .await
            .into_iter()
            .map(|p| p.replace('\\', "/").to_lowercase())
            .collect();
        let blocked: Vec<&str> = paths
            .iter()
            .filter(|p| {
                let abs = root
                    .join(p.as_str())
                    .to_string_lossy()
                    .replace('\\', "/")
                    .to_lowercase();
                open_docs.contains(&abs)
            })
            .map(String::as_str)
            .collect();
        if !blocked.is_empty() {
            return Err(AppError::with_detail(
                "RESTORE",
                messages::restore_files_open(&blocked.join(", ")),
                serde_json::json!({ "files": blocked }),
            ));
        }
    }

    let _switching = gate.exclusive_switch().await;
    repo::branch_from_commit_files(&root, &name, &sha, &paths).await
}

#[tauri::command]
async fn undo_merge(app: AppHandle, gate: State<'_, gate::RepoGate>) -> AppResult<()> {
    let root = current_repo(&app)?;
    let _tree = gate.exclusive().await;
    workflow::undo_merge(&root).await
}

#[tauri::command]
async fn merge_preview(app: AppHandle, name: String) -> AppResult<workflow::MergePreview> {
    let root = current_repo(&app)?;
    workflow::merge_preview(&root, &name).await
}

#[tauri::command]
async fn merge_preview_between(
    app: AppHandle,
    base: String,
    name: String,
) -> AppResult<workflow::MergePreview> {
    let root = current_repo(&app)?;
    workflow::merge_preview_between(&root, &base, &name).await
}

#[tauri::command]
async fn merge_branch(
    app: AppHandle,
    gate: State<'_, gate::RepoGate>,
    name: String,
) -> AppResult<workflow::MergeOutcome> {
    let root = current_repo(&app)?;
    let _tree = gate.exclusive().await;
    workflow::merge_branch(&root, &name).await
}

#[tauri::command]
async fn init_lockable(
    app: AppHandle,
    gate: State<'_, gate::RepoGate>,
) -> AppResult<repo::InitLockableResult> {
    let root = current_repo(&app)?;
    let _tree = gate.exclusive().await;
    repo::init_lockable(&root).await
}

#[tauri::command]
async fn get_branch_overview(app: AppHandle) -> AppResult<Vec<repo::BranchSummary>> {
    let root = current_repo(&app)?;
    repo::branch_overview(&root).await
}

#[tauri::command]
async fn switch_branch(
    app: AppHandle,
    gate: State<'_, gate::RepoGate>,
    name: String,
) -> AppResult<repo::SwitchResult> {
    let root = current_repo(&app)?;
    let _switching = gate.exclusive_switch().await;
    repo::switch_branch(&root, &name).await
}

/// Delete a branch that is fully merged into the default branch.
#[tauri::command]
async fn delete_branch(
    app: AppHandle,
    gate: State<'_, gate::RepoGate>,
    name: String,
) -> AppResult<()> {
    let root = current_repo(&app)?;
    let _tree = gate.exclusive().await;
    repo::delete_branch(&root, &name).await
}

#[tauri::command]
fn is_switching(gate: State<'_, gate::RepoGate>) -> bool {
    gate.is_switching()
}

#[tauri::command]
async fn restore_files(
    app: AppHandle,
    gate: State<'_, gate::RepoGate>,
    files: Vec<String>,
) -> AppResult<()> {
    let root = current_repo(&app)?;
    let _tree = gate.exclusive().await;
    repo::restore_paths(&root, files).await
}

#[tauri::command]
async fn set_aside_files(
    app: AppHandle,
    gate: State<'_, gate::RepoGate>,
    files: Vec<String>,
) -> AppResult<String> {
    let root = current_repo(&app)?;
    let _tree = gate.exclusive().await;
    repo::set_aside_untracked(&root, files).await
}

#[tauri::command]
async fn locate_lock_paths(
    app: AppHandle,
    paths: Vec<String>,
) -> AppResult<std::collections::HashMap<String, Vec<String>>> {
    let root = current_repo(&app)?;
    repo::locate_paths_in_branches(&root, paths).await
}

#[tauri::command]
async fn select_existing_repo(
    app: AppHandle,
    gate: State<'_, gate::RepoGate>,
    path: String,
) -> AppResult<RepoInfo> {
    let _tree = gate.exclusive().await;
    logger::info(format!("selecting repository: {path}"));
    let info = repo::validate_repo(&path).await?;
    settings::set_string(&app, KEY_REPO_PATH, &info.repo_path)?;
    #[cfg(desktop)]
    watch::watch_repo(&app, Path::new(&info.repo_path));
    logger::info(format!(
        "repository selected: {} ({}) on branch {}",
        info.repo_path, info.repo_slug, info.branch
    ));
    Ok(info)
}

#[tauri::command]
async fn clone_repo(
    app: AppHandle,
    url: String,
    dest_parent: String,
    on_progress: tauri::ipc::Channel<String>,
) -> AppResult<RepoInfo> {
    let dest = repo::clone_repo(&url, std::path::Path::new(&dest_parent), |line| {
        let _ = on_progress.send(line);
    })
    .await?;
    let info = repo::validate_repo(&dest.to_string_lossy()).await?;
    settings::set_string(&app, KEY_REPO_PATH, &info.repo_path)?;
    #[cfg(desktop)]
    watch::watch_repo(&app, Path::new(&info.repo_path));
    Ok(info)
}

#[tauri::command]
async fn list_files(app: AppHandle) -> AppResult<Vec<FileEntry>> {
    let root = current_repo(&app)?;
    repo::list_lockable_files(&root).await
}

#[tauri::command]
async fn get_locks(app: AppHandle) -> AppResult<LocksResult> {
    let root = current_repo(&app)?;
    let username_hint = settings::get_string(&app, KEY_USERNAME)?;
    let result = lfs::get_locks(&root, username_hint.as_deref()).await?;

    // Remember our LFS username from a fresh response so offline
    // bucketing of cached locks stays correct.
    if result.fresh {
        if let Some(owner) = result.ours.first().and_then(|l| l.owner.as_ref()) {
            settings::set_string(&app, KEY_USERNAME, &owner.name)?;
        }
    }
    Ok(result)
}

#[tauri::command]
async fn claim_files(
    app: AppHandle,
    gate: State<'_, gate::RepoGate>,
    cancel: State<'_, workflow::CancelFlag>,
    paths: Vec<String>,
    on_progress: tauri::ipc::Channel<workflow::LockProgress>,
) -> AppResult<workflow::ClaimResult> {
    let root = current_repo(&app)?;
    let _tree = gate.exclusive().await;
    cancel.arm();
    let report = move |step: workflow::LockProgress| {
        let _ = on_progress.send(step);
    };
    workflow::claim_files(&root, paths, &report, &cancel).await
}

#[tauri::command]
async fn release_files(
    app: AppHandle,
    gate: State<'_, gate::RepoGate>,
    cancel: State<'_, workflow::CancelFlag>,
    paths: Vec<String>,
    on_progress: tauri::ipc::Channel<workflow::LockProgress>,
) -> AppResult<Vec<workflow::ReleaseOutcome>> {
    let root = current_repo(&app)?;
    let _tree = gate.exclusive().await;
    cancel.arm();
    let report = move |step: workflow::LockProgress| {
        let _ = on_progress.send(step);
    };
    workflow::release_files(&root, paths, &report, &cancel).await
}

/// Close documents in SolidWorks without saving, throwing their unsaved
/// changes away. The UI asks for confirmation before calling this.
#[tauri::command]
async fn discard_sw_changes(app: AppHandle, paths: Vec<String>) -> AppResult<()> {
    let root = current_repo(&app)?;
    #[cfg(windows)]
    {
        let abs: Vec<String> = paths
            .iter()
            .map(|p| root.join(p).to_string_lossy().replace('/', "\\"))
            .collect();
        swrefs::solidworks_close_documents(&abs).await?;
        crate::logger::info(format!(
            "discarded unsaved SolidWorks changes in {} file(s)",
            paths.len()
        ));
    }
    #[cfg(not(windows))]
    let _ = (root, paths);
    Ok(())
}

#[tauri::command]
async fn force_unlock(
    app: AppHandle,
    gate: State<'_, gate::RepoGate>,
    path: String,
    id: Option<String>,
) -> AppResult<()> {
    let root = current_repo(&app)?;
    let _tree = gate.exclusive().await;
    lfs::drop_lock(&root, &path, id.as_deref(), true).await?;
    let _ = fsattr::set_readonly(&root.join(&path), true);
    Ok(())
}

#[tauri::command]
async fn drop_own_lock(
    app: AppHandle,
    gate: State<'_, gate::RepoGate>,
    path: String,
    id: Option<String>,
) -> AppResult<()> {
    let root = current_repo(&app)?;
    let _tree = gate.exclusive().await;
    lfs::drop_lock(&root, &path, id.as_deref(), false).await?;
    // Nothing to set read-only when the lock was dangling; the file is gone.
    let abs = root.join(&path);
    if abs.exists() {
        let _ = fsattr::set_readonly(&abs, true);
    }
    crate::logger::info(format!("unlocked own file {path} from the locks list"));
    Ok(())
}

#[tauri::command]
async fn get_avatar(
    cache: State<'_, avatars::AvatarCache>,
    url: String,
) -> AppResult<String> {
    avatars::get_avatar(&cache, url).await
}

/// Real names for people the commit history has never seen, someone who
/// holds a lock but has never committed here is known only by @username.
#[tauri::command]
async fn get_profile_names(
    app: AppHandle,
    cache: State<'_, people::ProfileNames>,
    logins: Vec<String>,
) -> AppResult<std::collections::HashMap<String, String>> {
    let root = current_repo(&app)?;
    Ok(people::display_names(&cache, &root, logins).await)
}
#[tauri::command]
async fn get_activity(app: AppHandle) -> AppResult<Vec<repo::CommitInfo>> {
    let root = current_repo(&app)?;
    repo::get_activity(&root, 40, false).await
}

#[tauri::command]
async fn get_activity_all(app: AppHandle) -> AppResult<Vec<repo::CommitInfo>> {
    let root = current_repo(&app)?;
    repo::get_activity(&root, 200, true).await
}

/// Can we talk to GitHub with the credentials this computer already has?
/// False means the user has never signed in (or the sign in expired).
#[tauri::command]
async fn github_signed_in(app: AppHandle) -> AppResult<bool> {
    let root = current_repo(&app)?;
    let out = proc::run_git(&root, &["ls-remote", "--heads", "origin"], 45).await?;
    // Already signed in (e.g. via GitHub Desktop) without using our own Sign in
    // button? Learn the login now so the profile fills in without a first lock.
    if out.ok() && settings::get_string(&app, KEY_GH_USERNAME)?.is_none() {
        if let Some(login) = github_login(&root).await {
            let _ = settings::set_string(&app, KEY_GH_USERNAME, &login);
        }
    }
    Ok(out.ok())
}

/// Tell "signed out" apart from "offline" for the warning banner. The same
/// ls-remote probe as the sign in check, but we read git's own stderr:
/// "ok" (reachable and authorized), "signed_out" (reachable, auth rejected),
/// or "offline" (could not reach GitHub at all).
#[tauri::command]
async fn connection_state(app: AppHandle) -> AppResult<String> {
    let root = current_repo(&app)?;
    match proc::run_git(&root, &["ls-remote", "--heads", "origin"], 20).await {
        Ok(out) if out.ok() => Ok("ok".into()),
        // Check network first: an offline stderr never carries an auth message,
        // so this can't mistake a dropped connection for a sign in problem.
        Ok(out) if error::looks_offline(&out.stderr) => Ok("offline".into()),
        Ok(out) if error::looks_signed_out(&out.stderr) => Ok("signed_out".into()),
        Ok(_) => Ok("offline".into()),
        Err(_) => Ok("offline".into()),
    }
}

/// Straight from the credential helper, so the profile fills in at sign in
/// rather than waiting for the first lock. None on token-only auth.
async fn github_login(repo: &Path) -> Option<String> {
    let out = proc::run_git_stdin(
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
        .find_map(|line| line.strip_prefix("username="))
        .map(|u| u.trim().to_string())
        .filter(|u| {
            !u.is_empty()
                && !u.eq_ignore_ascii_case("x-access-token")
                && !u.eq_ignore_ascii_case("personalaccesstoken")
                && !u.eq_ignore_ascii_case("token")
        })
}

/// Ask GitHub for the branch list with prompting allowed, so the credential
/// manager opens its sign in window. Explicit user action only.
#[tauri::command]
async fn github_sign_in(app: AppHandle) -> AppResult<bool> {
    let root = current_repo(&app)?;
    let out = proc::run_git_interactive(&root, &["ls-remote", "--heads", "origin"], 300).await?;
    // Learn the login now so the profile fills in immediately, not at first lock.
    if out.ok() {
        if let Some(login) = github_login(&root).await {
            let _ = settings::set_string(&app, KEY_GH_USERNAME, &login);
        }
    }
    Ok(out.ok())
}

/// Forget the saved GitHub credentials so the next git operation asks again.
/// The credentials belong to Windows, not to SolidLocker, so this asks Git
/// Credential Manager to erase them and clears our cached username.
#[tauri::command]
async fn sign_out_github(app: AppHandle) -> AppResult<()> {
    let root = current_repo(&app)?;
    let _ = proc::run_git_stdin(
        &root,
        &["credential", "reject"],
        b"protocol=https\nhost=github.com\n\n",
        20,
    )
    .await;
    settings::delete_key(&app, KEY_USERNAME)?;
    settings::delete_key(&app, KEY_GH_USERNAME)?;
    Ok(())
}

#[tauri::command]
async fn fetch_remote(app: AppHandle, gate: State<'_, gate::RepoGate>) -> AppResult<bool> {
    let root = current_repo(&app)?;
    let Some(_tree) = gate.try_exclusive() else {
        return Ok(true);
    };
    // --prune so branches deleted on GitHub stop showing in the picker.
    let out = proc::run_git(&root, &["fetch", "--prune", "origin"], 120).await?;
    // fetch never updates origin/HEAD
    repo::refresh_default_branch(&root).await;
    if !out.ok() {
        // Never report a failed fetch as success: the UI would show "In sync"
        // while actually flying blind.
        return Err(AppError::offline(messages::FETCH_OFFLINE));
    }
    Ok(true)
}

#[tauri::command]
async fn get_repo_status(app: AppHandle) -> AppResult<repo::RepoStatus> {
    let root = current_repo(&app)?;
    repo::get_repo_status(&root).await
}

#[tauri::command]
async fn get_latest(
    app: AppHandle,
    gate: State<'_, gate::RepoGate>,
) -> AppResult<workflow::GetLatestResult> {
    let root = current_repo(&app)?;
    let _tree = gate.exclusive().await;
    let result = workflow::get_latest(&root).await?;
    let username_hint = settings::get_string(&app, KEY_USERNAME)?;
    let _ = workflow::sync_attributes(&root, username_hint.as_deref()).await;
    Ok(result)
}

#[tauri::command]
async fn abort_merge(app: AppHandle, gate: State<'_, gate::RepoGate>) -> AppResult<()> {
    let root = current_repo(&app)?;
    let _tree = gate.exclusive().await;
    workflow::abort_merge(&root).await
}

#[tauri::command]
async fn resolve_keep_theirs(
    app: AppHandle,
    gate: State<'_, gate::RepoGate>,
    paths: Vec<String>,
) -> AppResult<()> {
    let root = current_repo(&app)?;
    let _tree = gate.exclusive().await;
    workflow::resolve_keep_theirs(&root, paths).await
}

#[tauri::command]
async fn push_now(
    app: AppHandle,
    gate: State<'_, gate::RepoGate>,
) -> AppResult<workflow::SaveResult> {
    let root = current_repo(&app)?;
    let _tree = gate.exclusive().await;
    workflow::push_now(&root).await
}

#[tauri::command]
async fn save_and_share(
    app: AppHandle,
    gate: State<'_, gate::RepoGate>,
    message: String,
    paths: Vec<String>,
) -> AppResult<workflow::SaveResult> {
    let root = current_repo(&app)?;
    let _tree = gate.exclusive().await;
    workflow::save_and_share(&root, message, paths).await
}

#[tauri::command]
async fn resolve_references(app: AppHandle, path: String) -> AppResult<workflow::RefResolution> {
    let root = current_repo(&app)?;
    workflow::resolve_references(&root, path).await
}

#[tauri::command]
async fn sync_attributes(
    app: AppHandle,
    gate: State<'_, gate::RepoGate>,
) -> AppResult<workflow::SyncResult> {
    let root = current_repo(&app)?;
    let Some(_tree) = gate.try_exclusive() else {
        return Ok(workflow::SyncResult::default());
    };
    let username_hint = settings::get_string(&app, KEY_USERNAME)?;
    workflow::sync_attributes(&root, username_hint.as_deref()).await
}

/// Fetch, sweep files another branch left behind, fix read-only flags.
#[tauri::command]
async fn tidy_and_sync(
    app: AppHandle,
    gate: State<'_, gate::RepoGate>,
) -> AppResult<workflow::TidyResult> {
    let root = current_repo(&app)?;
    let _tree = gate.exclusive().await;
    let username_hint = settings::get_string(&app, KEY_USERNAME)?;
    workflow::tidy_and_sync(&root, username_hint.as_deref()).await
}

macro_rules! commands {
    ($($extra:path),* $(,)?) => {
        tauri::generate_handler![
            get_app_state,
            select_existing_repo,
            clone_repo,
            get_commit_identities,
            check_outside_refs,
            run_setup_checks,
            get_collisions,
            cancel_lock_run,
            get_used_by,
            get_default_branch,
            get_dependency_graph,
            check_for_update,
            list_pulls,
            pull_detail,
            create_pull,
            review_pull,
            merge_pull,
            close_pull,
            conflict_sides,
            plan_conflicts,
            plan_conflicts_between,
            propose_picks,
            merged_picks,
            branch_protection,
            delete_branch,
            combine_with_picks,
            list_conflicts,
            preview_conflict_side,
            open_conflict_side,
            resolve_conflict,
            finish_conflicts,
            abandon_conflicts,
            tidy_and_sync,
            get_commit_stats,
            get_file_history,
            get_sw_icon,
            get_sw_installed,
            get_sw_sound,
            get_thumbnails,
            get_open_documents,
            open_file,
            open_repo_folder,
            list_files,
            get_locks,
            claim_files,
            release_files,
            discard_sw_changes,
            force_unlock,
            drop_own_lock,
            resolve_references,
            sync_attributes,
            get_repo_status,
            get_avatar,
            get_profile_names,
            get_activity,
            get_activity_all,
            fetch_remote,
            github_signed_in,
            connection_state,
            github_sign_in,
            sign_out_github,
            get_latest,
            abort_merge,
            resolve_keep_theirs,
            save_and_share,
            push_now,
            list_repo_branches,
            get_branch_overview,
            preview_version,
            restore_version,
            resolve_references_at,
            open_version,
            branch_from_commit,
            branch_from_commit_files,
            create_branch,
            preview_commit,
            end_preview,
            get_preview_state,
            merge_branch,
            merge_preview,
            merge_preview_between,
            undo_merge,
            get_graph,
            get_commit_files,
            init_lockable,
            switch_branch,
            is_switching,
            restore_files,
            set_aside_files,
            locate_lock_paths,
            hide_to_tray,
            open_logs_folder,
            log_frontend,
            quit_app
            $(, $extra)*
        ]
    };
}

#[cfg(desktop)]
fn handler() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    commands![]
}

#[cfg(mobile)]
fn handler() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    commands![
        cloud::commands::get_platform,
        cloud::commands::cloud_state,
        cloud::commands::cloud_device_start,
        cloud::commands::cloud_device_poll,
        cloud::commands::cloud_sign_in_token,
        cloud::commands::cloud_sign_out,
        cloud::commands::cloud_set_client_id,
        cloud::commands::cloud_get_client_id,
        cloud::commands::cloud_my_repos,
        cloud::commands::cloud_choose_repo,
        cloud::commands::cloud_repo,
        cloud::commands::cloud_forget_repo,
        cloud::commands::cloud_set_branch,
        cloud::commands::cloud_files,
        cloud::commands::cloud_locks,
        cloud::commands::cloud_claim,
        cloud::commands::cloud_release,
        cloud::commands::cloud_force_unlock,
        cloud::commands::cloud_branches,
        cloud::commands::cloud_branch_standing,
        cloud::commands::cloud_create_branch,
        cloud::commands::cloud_activity,
        cloud::commands::cloud_file_history,
        cloud::commands::cloud_commit,
        cloud::commands::cloud_commit_stats,
        cloud::commands::cloud_graph,
        cloud::commands::cloud_reworked,
        cloud::commands::cloud_team,
        cloud::commands::cloud_display_names,
        cloud::commands::cloud_preview,
        cloud::commands::cloud_previews,
        cloud::commands::cloud_preview_cache,
        cloud::commands::cloud_clear_previews,
        cloud::commands::cloud_set_preview_mode,
        cloud::commands::cloud_preview_mode,
        cloud::commands::cloud_pulls,
        cloud::commands::cloud_pull,
        cloud::commands::cloud_review_pull,
        cloud::commands::cloud_merge_pull,
        cloud::commands::cloud_close_pull,
        cloud::commands::cloud_create_pull,
        cloud::commands::cloud_branch_protection,
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logger::info(format!(
        "SolidLocker {} starting on {} {}",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH
    ));
    // Keep the WebView2 cache in %LOCALAPPDATA%\SolidLocker\WebView2 rather than
    // the bundle-identifier folder Tauri would use. WebView2 reads this env var
    // when the webview is first created, so it must be set before the app builds.
    #[cfg(windows)]
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let dir = std::path::PathBuf::from(local)
            .join(PRODUCT_DIR)
            .join("WebView2");
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", dir);
    }

    // Apps launched from Finder don't inherit the shell PATH, so Homebrew's
    // git-lfs (and anything else outside /usr/bin) would be invisible.
    #[cfg(target_os = "macos")]
    {
        let mut path = std::env::var("PATH").unwrap_or_default();
        for extra in ["/opt/homebrew/bin", "/usr/local/bin"] {
            if !path.split(':').any(|p| p == extra) {
                path = format!("{extra}:{path}");
            }
        }
        std::env::set_var("PATH", &path);
    }

/// Bring the window back, rebuilding it when it was destroyed on the way to
/// the tray. Closing to the tray frees the whole webview (roughly 450 MB of
/// Chromium processes), so there may be no window to show.
///
/// Desktop only: on a phone the system owns the window, there is no tray to
/// have hidden it, and `unminimize` does not exist there.
#[cfg(desktop)]
fn open_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        return;
    }

    let Some(cfg) = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .cloned()
    else {
        report_window_failure(app, messages::WINDOW_CONFIG_MISSING);
        return;
    };

    if let Err(e) = tauri::WebviewWindowBuilder::from_config(app, &cfg).and_then(|b| b.build()) {
        report_window_failure(app, &e.to_string());
    }
}

#[cfg(desktop)]
fn report_window_failure(app: &tauri::AppHandle, detail: &str) {
    use tauri_plugin_notification::NotificationExt;

    eprintln!("could not open the window: {detail}");
    let _ = app
        .notification()
        .builder()
        .title(messages::WINDOW_FAILED_TITLE)
        .body(messages::window_failed_body(detail))
        .show();
}

    #[cfg_attr(mobile, allow(unused_mut))]
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let handle = app.clone();
            std::thread::spawn(move || {
                let window_handle = handle.clone();
                let _ = handle.run_on_main_thread(move || open_main_window(&window_handle));
            });
        }));
        // Remembers window size and position between runs.
        builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());
        builder = builder.manage(watch::FolderWatch::default());
    }

    builder
        .setup(|app| {
            #[cfg(desktop)]
            {
                // Tray icon: closing the window can hide it instead of
                // quitting, so protection keeps running in the background.
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::{TrayIconBuilder, TrayIconEvent};

                let show = MenuItem::with_id(app, "show", "Open SolidLocker", true, None::<&str>)?;
                let quit = MenuItem::with_id(app, "quit", "Quit SolidLocker", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show, &quit])?;

                TrayIconBuilder::with_id("main")
                    .icon(app.default_window_icon().unwrap().clone())
                    .tooltip("SolidLocker")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id().as_ref() {
                        "show" => open_main_window(app),
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click { button, .. } = event {
                            if button == tauri::tray::MouseButton::Left {
                                open_main_window(tray.app_handle());
                            }
                        }
                    })
                    .build(app)?;

                // Pick up the project that was open last time.
                if let Ok(Some(path)) = settings::get_string(app.handle(), KEY_REPO_PATH) {
                    let root = PathBuf::from(path);
                    if root.is_dir() {
                        watch::watch_repo(app.handle(), &root);
                    }
                }
            }
            #[cfg(mobile)]
            let _ = app;
            Ok(())
        })
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(avatars::AvatarCache::default())
        .manage(people::ProfileNames::default())
        .manage(thumbs::ThumbCache::default())
        .manage(gate::RepoGate::default())
        .manage(workflow::CancelFlag::default())
        .invoke_handler(handler())
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            // With no window left the app would normally quit. Closing to the
            // tray destroys the window on purpose, so keep the process alive.
            // An explicit exit (tray Quit) carries a code and is honoured.
            // There is no tray on a phone, and the system decides when an app
            // stops, so nothing is held open there.
            #[cfg(desktop)]
            if let tauri::RunEvent::ExitRequested { code, api, .. } = &event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
            #[cfg(mobile)]
            let _ = event;
        });
}
