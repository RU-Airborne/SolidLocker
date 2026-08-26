//! The commands the phone app calls.
//!
//! Deliberately a separate surface from the desktop commands rather than a
//! shim underneath them. A desktop command like `claim_files` means "take the
//! lock, then make the file writable on disk, then tell SolidWorks"; only the
//! first third of that exists here. Pretending otherwise by reusing the name
//! would leave the app quietly not doing two of the three things.

use std::collections::HashMap;
use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::lfs::LocksResult;
use crate::settings;

use super::auth::{self, DevicePoll, DeviceStart, Me};
use super::{gh, locks, objects, Api};

const KEY_TOKEN: &str = "cloud_token";
const KEY_LOGIN: &str = "cloud_login";
const KEY_NAME: &str = "cloud_name";
const KEY_AVATAR: &str = "cloud_avatar";
const KEY_REPO: &str = "cloud_repo";
const KEY_BRANCH: &str = "cloud_branch";
const KEY_CLIENT_ID: &str = "cloud_client_id";
const KEY_PREVIEWS: &str = "cloud_previews";

// ---- Where we are ----

#[derive(Debug, Serialize)]
pub struct CloudState {
    pub signed_in: bool,
    pub me: Option<Me>,
    pub slug: Option<String>,
    pub branch: Option<String>,
    /// Whether a device sign in can even be started. False means the build
    /// carries no GitHub client ID and nobody has typed one in yet.
    pub can_device_sign_in: bool,
    pub platform: String,
}

fn token(app: &AppHandle) -> AppResult<String> {
    settings::get_string(app, KEY_TOKEN)?
        .filter(|t| !t.is_empty())
        .ok_or_else(|| AppError::quiet("SIGNED_OUT", "Sign in to GitHub first."))
}

fn client_id(app: &AppHandle) -> String {
    settings::get_string(app, KEY_CLIENT_ID)
        .ok()
        .flatten()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| auth::BUILT_IN_CLIENT_ID.map(str::to_string))
        .unwrap_or_default()
}

/// A client aimed at the chosen project. Everything past sign-in needs one.
fn api(app: &AppHandle) -> AppResult<Api> {
    let slug = settings::get_string(app, KEY_REPO)?
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::quiet("NO_REPO", "Pick a project first."))?;
    let login = settings::get_string(app, KEY_LOGIN)?.unwrap_or_default();
    Api::new(slug, token(app)?, login)
}

/// The branch everything is read against. Not a checkout: nothing is on this
/// device, it is only which line of the project the screens are showing.
fn branch(app: &AppHandle) -> AppResult<String> {
    Ok(settings::get_string(app, KEY_BRANCH)?
        .filter(|b| !b.is_empty())
        .unwrap_or_else(|| "main".to_string()))
}

fn cache_dir(app: &AppHandle) -> AppResult<PathBuf> {
    app.path()
        .app_cache_dir()
        .map_err(|e| AppError::new("STORE", e.to_string()))
}

fn preview_budget(app: &AppHandle) -> u64 {
    match settings::get_string(app, KEY_PREVIEWS).ok().flatten().as_deref() {
        Some("never") => 0,
        _ => objects::DEFAULT_MAX_BYTES,
    }
}

#[tauri::command]
pub async fn cloud_state(app: AppHandle) -> AppResult<CloudState> {
    let token = settings::get_string(&app, KEY_TOKEN)?.filter(|t| !t.is_empty());
    let mut login = settings::get_string(&app, KEY_LOGIN)?.filter(|l| !l.is_empty());

    // A sign in that got its token but never learned whose it was. Finish it
    // quietly rather than making somebody sign in twice for one bad moment of
    // signal. Costs nothing once the login is known.
    if login.is_none() {
        if let Some(token) = &token {
            if let Ok(me) = auth::whoami(token).await {
                settings::set_string(&app, KEY_LOGIN, &me.login)?;
                settings::set_string(&app, KEY_AVATAR, &me.avatar_url)?;
                if let Some(name) = &me.name {
                    settings::set_string(&app, KEY_NAME, name)?;
                }
                crate::logger::info(format!("cloud: finished signing in as {}", me.login));
                login = Some(me.login);
            }
        }
    }

    Ok(CloudState {
        // Both halves, or the app would let someone in with no identity to
        // stamp on a lock.
        signed_in: token.is_some() && login.is_some(),
        me: login.map(|login| Me {
            name: settings::get_string(&app, KEY_NAME).ok().flatten(),
            avatar_url: settings::get_string(&app, KEY_AVATAR)
                .ok()
                .flatten()
                .unwrap_or_default(),
            login,
        }),
        slug: settings::get_string(&app, KEY_REPO)?.filter(|s| !s.is_empty()),
        branch: settings::get_string(&app, KEY_BRANCH)?.filter(|b| !b.is_empty()),
        can_device_sign_in: !client_id(&app).is_empty(),
        platform: std::env::consts::OS.to_string(),
    })
}

// ---- Signing in ----

#[tauri::command]
pub async fn cloud_device_start(app: AppHandle) -> AppResult<DeviceStart> {
    auth::start(&client_id(&app)).await
}

#[tauri::command]
pub async fn cloud_device_poll(app: AppHandle, device_code: String) -> AppResult<DevicePoll> {
    let answer = auth::poll(&client_id(&app), &device_code).await?;
    if let DevicePoll::Done { token } = &answer {
        remember_sign_in(&app, token).await?;
    }
    Ok(answer)
}

/// The way in for anyone who has not registered an OAuth app yet: a
/// fine-grained token, pasted once. Same token, same scopes, less ceremony.
#[tauri::command]
pub async fn cloud_sign_in_token(app: AppHandle, token: String) -> AppResult<Me> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err(AppError::new("AUTH", "Paste a token first."));
    }
    remember_sign_in(&app, &token).await
}

async fn remember_sign_in(app: &AppHandle, token: &str) -> AppResult<Me> {
    // The token is written down before we ask who it belongs to. A device code
    // can be exchanged exactly once, so if the identity lookup failed on a
    // weak signal and the token had not been kept, that sign in would be gone
    // for good and the member would have to start the whole dance again.
    // Saved first, `cloud_state` can finish the job on the next call.
    settings::set_string(app, KEY_TOKEN, token)?;
    let me = auth::whoami(token).await?;
    settings::set_string(app, KEY_LOGIN, &me.login)?;
    settings::set_string(app, KEY_AVATAR, &me.avatar_url)?;
    if let Some(name) = &me.name {
        settings::set_string(app, KEY_NAME, name)?;
    }
    crate::logger::info(format!("cloud: signed in as {}", me.login));
    Ok(me)
}

#[tauri::command]
pub async fn cloud_sign_out(app: AppHandle) -> AppResult<()> {
    for key in [KEY_TOKEN, KEY_LOGIN, KEY_NAME, KEY_AVATAR] {
        settings::delete_key(&app, key)?;
    }
    // The previews came from a project this account may no longer be able to
    // see, so they do not outlive the sign in.
    if let Ok(dir) = cache_dir(&app) {
        objects::clear_cache(&dir);
    }
    crate::logger::info("cloud: signed out");
    Ok(())
}

#[tauri::command]
pub async fn cloud_set_client_id(app: AppHandle, id: String) -> AppResult<()> {
    settings::set_string(&app, KEY_CLIENT_ID, id.trim())
}

#[tauri::command]
pub async fn cloud_get_client_id(app: AppHandle) -> AppResult<String> {
    Ok(client_id(&app))
}

// ---- Picking a project ----

#[tauri::command]
pub async fn cloud_my_repos(app: AppHandle) -> AppResult<Vec<gh::RepoChoice>> {
    let login = settings::get_string(&app, KEY_LOGIN)?.unwrap_or_default();
    let api = Api::new(String::new(), token(&app)?, login)?;
    gh::my_repos(&api).await
}

#[tauri::command]
pub async fn cloud_choose_repo(app: AppHandle, slug: String) -> AppResult<gh::CloudRepo> {
    let slug = slug.trim().trim_end_matches('/').to_string();
    if slug.split('/').count() != 2 {
        return Err(AppError::new(
            "REPO",
            "A project is written owner/name, like acme-engineering/airframe.",
        ));
    }
    let login = settings::get_string(&app, KEY_LOGIN)?.unwrap_or_default();
    let api = Api::new(&slug, token(&app)?, login)?;
    let info = gh::repo(&api).await?;
    settings::set_string(&app, KEY_REPO, &slug)?;
    settings::set_string(&app, KEY_BRANCH, &info.default_branch)?;
    crate::logger::info(format!("cloud: opened {slug} on {}", info.default_branch));
    Ok(info)
}

#[tauri::command]
pub async fn cloud_repo(app: AppHandle) -> AppResult<gh::CloudRepo> {
    gh::repo(&api(&app)?).await
}

#[tauri::command]
pub async fn cloud_forget_repo(app: AppHandle) -> AppResult<()> {
    settings::delete_key(&app, KEY_REPO)?;
    settings::delete_key(&app, KEY_BRANCH)
}

#[tauri::command]
pub async fn cloud_set_branch(app: AppHandle, name: String) -> AppResult<()> {
    settings::set_string(&app, KEY_BRANCH, &name)
}

// ---- Files ----

#[tauri::command]
pub async fn cloud_files(app: AppHandle) -> AppResult<gh::FileListing> {
    gh::files(&api(&app)?, &branch(&app)?).await
}

// ---- Locks ----

#[tauri::command]
pub async fn cloud_locks(app: AppHandle) -> AppResult<LocksResult> {
    locks::all(&api(&app)?, &branch(&app)?).await
}

#[derive(Debug, Serialize)]
pub struct FailedClaim {
    pub path: String,
    pub owner: Option<String>,
    pub locked_at: Option<String>,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct CloudClaimResult {
    pub claimed: Vec<String>,
    pub failed: Vec<FailedClaim>,
    /// A part of the set was lost to a teammate mid-claim, so the locks this
    /// claim had already taken were given straight back. Half an assembly is
    /// worse than none of it: it blocks the person who got the other half.
    pub rolled_back: bool,
}

#[tauri::command]
pub async fn cloud_claim(app: AppHandle, paths: Vec<String>) -> AppResult<CloudClaimResult> {
    let api = api(&app)?;
    let branch = branch(&app)?;
    let mut claimed = Vec::new();
    let mut failed = Vec::new();

    for path in &paths {
        match locks::take(&api, path, &branch).await {
            Ok(_) => claimed.push(path.clone()),
            Err(e) => {
                let held = e.detail.as_ref();
                failed.push(FailedClaim {
                    path: path.clone(),
                    owner: held
                        .and_then(|d| d.get("owner"))
                        .and_then(|o| o.get("name"))
                        .and_then(|n| n.as_str())
                        .map(str::to_string),
                    locked_at: held
                        .and_then(|d| d.get("locked_at"))
                        .and_then(|l| l.as_str())
                        .map(str::to_string),
                    message: e.message,
                });
            }
        }
    }

    let rolled_back = !failed.is_empty() && !claimed.is_empty() && paths.len() > 1;
    if rolled_back {
        crate::logger::warn(format!(
            "cloud: claim of {} file(s) lost {} to someone else; giving back the {} taken",
            paths.len(),
            failed.len(),
            claimed.len()
        ));
        for path in &claimed {
            if let Ok(Some(lock)) = locks::on_path(&api, path, &branch).await {
                let _ = locks::give_back(&api, &lock.id, false, &branch).await;
            }
        }
        claimed.clear();
    }

    Ok(CloudClaimResult {
        claimed,
        failed,
        rolled_back,
    })
}

#[derive(Debug, Serialize)]
pub struct ReleaseOutcome {
    pub path: String,
    pub ok: bool,
    pub code: Option<String>,
    pub message: Option<String>,
}

#[tauri::command]
pub async fn cloud_release(app: AppHandle, paths: Vec<String>) -> AppResult<Vec<ReleaseOutcome>> {
    let api = api(&app)?;
    let branch = branch(&app)?;
    let mut out = Vec::new();

    for path in paths {
        let found = locks::on_path(&api, &path, &branch).await;
        let outcome = match found {
            // Nothing holding it is the state the member wanted, so it is not
            // a failure to report.
            Ok(None) => ReleaseOutcome {
                path,
                ok: true,
                code: None,
                message: None,
            },
            Ok(Some(lock)) => match locks::give_back(&api, &lock.id, false, &branch).await {
                Ok(()) => ReleaseOutcome {
                    path,
                    ok: true,
                    code: None,
                    message: None,
                },
                Err(e) => ReleaseOutcome {
                    path,
                    ok: false,
                    code: Some(e.code),
                    message: Some(e.message),
                },
            },
            Err(e) => ReleaseOutcome {
                path,
                ok: false,
                code: Some(e.code),
                message: Some(e.message),
            },
        };
        out.push(outcome);
    }
    Ok(out)
}

/// Take a lock off somebody else. Needs write access, and is the one action
/// here that can lose a teammate's work, so the app asks twice before it.
#[tauri::command]
pub async fn cloud_force_unlock(app: AppHandle, path: String) -> AppResult<()> {
    let api = api(&app)?;
    let branch = branch(&app)?;
    let lock = locks::on_path(&api, &path, &branch)
        .await?
        .ok_or_else(|| AppError::new("MISSING", "Nobody is holding that file any more."))?;
    crate::logger::warn(format!(
        "cloud: force unlocking {path}, held by {}",
        locks::owner_of(&lock).unwrap_or("someone")
    ));
    locks::give_back(&api, &lock.id, true, &branch).await
}

// ---- Branches ----

#[tauri::command]
pub async fn cloud_branches(app: AppHandle) -> AppResult<Vec<gh::CloudBranch>> {
    let api = api(&app)?;
    let repo = gh::repo(&api).await?;
    gh::branches(&api, &repo.default_branch).await
}

#[tauri::command]
pub async fn cloud_branch_standing(
    app: AppHandle,
    base: String,
    head: String,
) -> AppResult<gh::BranchStanding> {
    gh::standing(&api(&app)?, &base, &head).await
}

#[tauri::command]
pub async fn cloud_create_branch(app: AppHandle, name: String, from_sha: String) -> AppResult<()> {
    gh::create_branch(&api(&app)?, name.trim(), &from_sha).await
}

// ---- History ----

#[tauri::command]
pub async fn cloud_activity(app: AppHandle, limit: Option<usize>) -> AppResult<Vec<gh::CloudCommit>> {
    gh::commits(&api(&app)?, &branch(&app)?, None, limit.unwrap_or(50)).await
}

#[tauri::command]
pub async fn cloud_file_history(app: AppHandle, path: String) -> AppResult<Vec<gh::CloudCommit>> {
    gh::commits(&api(&app)?, &branch(&app)?, Some(&path), 50).await
}

#[tauri::command]
pub async fn cloud_commit(app: AppHandle, sha: String) -> AppResult<gh::CommitDetail> {
    gh::commit(&api(&app)?, &sha).await
}

#[tauri::command]
pub async fn cloud_commit_stats(app: AppHandle) -> AppResult<Vec<gh::CommitStat>> {
    gh::commit_stats(&api(&app)?, &branch(&app)?, 300).await
}

// ---- The graph ----

/// Caps chosen so the map stays readable and the wait stays short: it is one
/// request per branch, and a railway with forty lines is not a railway.
const GRAPH_BRANCHES: usize = 10;
const GRAPH_PER_BRANCH: usize = 80;

#[tauri::command]
pub async fn cloud_graph(app: AppHandle) -> AppResult<Vec<gh::GraphCommit>> {
    gh::graph(
        &api(&app)?,
        &branch(&app)?,
        GRAPH_BRANCHES,
        GRAPH_PER_BRANCH,
    )
    .await
}

#[tauri::command]
pub async fn cloud_reworked(app: AppHandle) -> AppResult<Vec<gh::ReworkedFile>> {
    gh::reworked(&api(&app)?, &branch(&app)?, 60).await
}

// ---- People ----

#[tauri::command]
pub async fn cloud_team(app: AppHandle) -> AppResult<Vec<gh::TeamMember>> {
    let api = api(&app)?;
    let branch = branch(&app)?;
    let mut team = gh::contributors(&api).await?;

    // Who is holding what is the thing worth knowing about a teammate here,
    // so the two lists are joined before they reach the screen.
    if let Ok(held) = locks::all(&api, &branch).await {
        let mut count: HashMap<String, u64> = HashMap::new();
        for lock in held.ours.iter().chain(held.theirs.iter()) {
            if let Some(owner) = locks::owner_of(lock) {
                *count.entry(owner.to_lowercase()).or_default() += 1;
            }
        }
        for member in &mut team {
            member.holding = count.get(&member.login.to_lowercase()).copied().unwrap_or(0);
        }
    }

    let logins: Vec<String> = team.iter().map(|m| m.login.clone()).collect();
    if let Ok(names) = gh::display_names(&api, logins).await {
        for member in &mut team {
            if let Some(name) = names.get(&member.login.to_lowercase()) {
                member.name = name.clone();
            }
        }
    }
    Ok(team)
}

#[tauri::command]
pub async fn cloud_display_names(
    app: AppHandle,
    logins: Vec<String>,
) -> AppResult<HashMap<String, String>> {
    gh::display_names(&api(&app)?, logins).await
}

// ---- Previews ----

#[tauri::command]
pub async fn cloud_preview(app: AppHandle, path: String) -> AppResult<Option<String>> {
    let budget = preview_budget(&app);
    if budget == 0 {
        return Ok(None);
    }
    objects::preview(
        &api(&app)?,
        &cache_dir(&app)?,
        &path,
        &branch(&app)?,
        budget,
    )
    .await
}

#[tauri::command]
pub async fn cloud_previews(
    app: AppHandle,
    paths: Vec<String>,
) -> AppResult<HashMap<String, String>> {
    let budget = preview_budget(&app);
    if budget == 0 {
        return Ok(HashMap::new());
    }
    objects::previews(
        &api(&app)?,
        &cache_dir(&app)?,
        paths,
        &branch(&app)?,
        budget,
    )
    .await
}

#[tauri::command]
pub async fn cloud_preview_cache(app: AppHandle) -> AppResult<u64> {
    Ok(objects::cache_size(&cache_dir(&app)?))
}

#[tauri::command]
pub async fn cloud_clear_previews(app: AppHandle) -> AppResult<()> {
    objects::clear_cache(&cache_dir(&app)?);
    Ok(())
}

#[tauri::command]
pub async fn cloud_set_preview_mode(app: AppHandle, mode: String) -> AppResult<()> {
    settings::set_string(&app, KEY_PREVIEWS, &mode)
}

#[tauri::command]
pub async fn cloud_preview_mode(app: AppHandle) -> AppResult<String> {
    Ok(settings::get_string(&app, KEY_PREVIEWS)?.unwrap_or_else(|| "wifi".to_string()))
}

// ---- Merge requests ----

#[tauri::command]
pub async fn cloud_pulls(app: AppHandle) -> AppResult<Vec<crate::pulls::PullSummary>> {
    crate::pulls::list(&api(&app)?).await
}

#[tauri::command]
pub async fn cloud_pull(app: AppHandle, number: u64) -> AppResult<crate::pulls::PullDetail> {
    crate::pulls::detail(&api(&app)?, number).await
}

#[tauri::command]
pub async fn cloud_review_pull(
    app: AppHandle,
    number: u64,
    event: String,
    body: String,
) -> AppResult<bool> {
    crate::pulls::review(&api(&app)?, number, &event, &body).await
}

#[tauri::command]
pub async fn cloud_merge_pull(app: AppHandle, number: u64, method: String) -> AppResult<()> {
    crate::pulls::merge(&api(&app)?, number, &method).await
}

#[tauri::command]
pub async fn cloud_close_pull(app: AppHandle, number: u64) -> AppResult<()> {
    crate::pulls::close(&api(&app)?, number).await
}

#[tauri::command]
pub async fn cloud_create_pull(
    app: AppHandle,
    title: String,
    body: String,
    head: String,
    base: String,
) -> AppResult<u64> {
    crate::pulls::create(&api(&app)?, &title, &body, &head, &base).await
}

#[tauri::command]
pub async fn cloud_branch_protection(
    app: AppHandle,
    branch: String,
) -> AppResult<crate::pulls::Protection> {
    crate::pulls::protection(&api(&app)?, &branch).await
}

// ---- Which app is running ----

#[derive(Debug, Serialize)]
pub struct Platform {
    pub os: String,
    pub mobile: bool,
}

/// The frontend is one bundle for both builds, so it has to ask which one it
/// is in before deciding whether to show a desktop dashboard or a phone.
#[tauri::command]
pub fn get_platform() -> Platform {
    let os = std::env::consts::OS.to_string();
    Platform {
        mobile: matches!(os.as_str(), "ios" | "android"),
        os,
    }
}
