mod avatars;
mod error;
mod fsattr;
mod gate;
mod lfs;
mod proc;
mod repo;
mod messages;
mod settings;
mod swrefs;
mod thumbs;
mod workflow;

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, State};

use error::{AppError, AppResult};
use lfs::LocksResult;
use repo::{AppState, FileEntry, RepoInfo};

const KEY_REPO_PATH: &str = "repo_path";
const KEY_USERNAME: &str = "lfs_username";
const KEY_GH_USERNAME: &str = "github_username";

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
async fn get_app_state(app: AppHandle) -> AppResult<AppState> {
    let cwd = std::env::temp_dir();
    let (git_ok, lfs_ok, lfs_version) = repo::preflight(&cwd).await;

    let mut repo_info: Option<RepoInfo> = None;
    if let Some(saved) = settings::get_string(&app, KEY_REPO_PATH)? {
        if PathBuf::from(&saved).is_dir() {
            match repo::validate_repo(&saved).await {
                Ok(info) => repo_info = Some(info),
                Err(_) => {
                    settings::delete_key(&app, KEY_REPO_PATH)?;
                }
            }
        } else {
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

/// Brings an earlier version of a file into the working tree as the next
/// change. History moves forward; nothing is rewritten.
#[tauri::command]
async fn restore_version(
    app: AppHandle,
    gate: State<'_, gate::RepoGate>,
    path: String,
    sha: String,
) -> AppResult<()> {
    let root = current_repo(&app)?;

    // Editing a file you do not hold is exactly what the app exists to
    // prevent, and it would be read-only on disk anyway.
    let username_hint = settings::get_string(&app, KEY_USERNAME)?;
    let locks = lfs::get_locks(&root, username_hint.as_deref()).await?;
    let wanted = path.to_lowercase();
    if !locks.ours.iter().any(|l| l.path.to_lowercase() == wanted) {
        return Err(AppError::new("RESTORE", messages::RESTORE_NEEDS_LOCK));
    }

    #[cfg(windows)]
    {
        let abs = root
            .join(&path)
            .to_string_lossy()
            .replace('\\', "/")
            .to_lowercase();
        if swrefs::solidworks_open_documents()
            .await
            .iter()
            .any(|p| p.replace('\\', "/").to_lowercase() == abs)
        {
            return Err(AppError::new("RESTORE", messages::RESTORE_FILE_OPEN));
        }
    }

    let _tree = gate.exclusive().await;
    repo::restore_version(&root, &path, &sha).await
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
    let info = repo::validate_repo(&path).await?;
    settings::set_string(&app, KEY_REPO_PATH, &info.repo_path)?;
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
    paths: Vec<String>,
) -> AppResult<workflow::ClaimResult> {
    let root = current_repo(&app)?;
    let _tree = gate.exclusive().await;
    workflow::claim_files(&root, paths).await
}

#[tauri::command]
async fn release_files(
    app: AppHandle,
    gate: State<'_, gate::RepoGate>,
    paths: Vec<String>,
) -> AppResult<Vec<workflow::ReleaseOutcome>> {
    let root = current_repo(&app)?;
    let _tree = gate.exclusive().await;
    workflow::release_files(&root, paths).await
}

#[tauri::command]
async fn force_unlock(
    app: AppHandle,
    gate: State<'_, gate::RepoGate>,
    path: String,
) -> AppResult<()> {
    let root = current_repo(&app)?;
    let _tree = gate.exclusive().await;
    lfs::unlock_file(&root, &path, true).await?;
    let _ = fsattr::set_readonly(&root.join(&path), true);
    Ok(())
}

#[tauri::command]
async fn get_avatar(
    cache: State<'_, avatars::AvatarCache>,
    url: String,
) -> AppResult<String> {
    avatars::get_avatar(&cache, url).await
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
    }

    builder
        .setup(|app| {
            // Tray icon: closing the window can hide it instead of quitting,
            // so protection keeps running in the background.
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
            Ok(())
        })
        // Remembers window size and position between runs.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(avatars::AvatarCache::default())
        .manage(thumbs::ThumbCache::default())
        .manage(gate::RepoGate::default())
        .invoke_handler(tauri::generate_handler![
            get_app_state,
            select_existing_repo,
            clone_repo,
            get_commit_identities,
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
            force_unlock,
            resolve_references,
            sync_attributes,
            get_repo_status,
            get_avatar,
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
            switch_branch,
            is_switching,
            restore_files,
            set_aside_files,
            locate_lock_paths,
            hide_to_tray,
            quit_app
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            // With no window left the app would normally quit. Closing to the
            // tray destroys the window on purpose, so keep the process alive.
            // An explicit exit (tray Quit) carries a code and is honoured.
            if let tauri::RunEvent::ExitRequested { code, api, .. } = &event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
