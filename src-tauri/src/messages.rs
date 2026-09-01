// ---- Repository selection and validation ----

pub const NO_REPO_SELECTED: &str = "No repository selected yet.";

pub fn repo_folder_missing(path: &str) -> String {
    format!("Repository folder missing: {path}")
}

pub fn folder_not_found(path: &str) -> String {
    format!("Folder not found: {path}")
}

pub const NOT_A_REPO: &str = "That folder is not inside a Git repository.";

pub const NO_ORIGIN_REMOTE: &str = "This repository has no 'origin' remote.";

pub fn not_a_github_remote(url: &str) -> String {
    format!("The 'origin' remote is not a GitHub repository: {url}")
}

// ---- Cloning ----

pub const NOT_A_GITHUB_URL: &str =
    "That doesn't look like a GitHub repository URL. Copy it from the green 'Code' button on GitHub.";

pub const NO_REPO_NAME_IN_URL: &str = "Could not read a repository name from that URL.";

pub fn clone_folder_exists(name: &str) -> String {
    format!("A folder named '{name}' already exists there. Use 'Select existing folder' instead.")
}

pub const GIT_MISSING_FOR_CLONE: &str =
    "Git isn't available on this computer, so nothing could be downloaded. Install GitHub Desktop or Git for Windows, then restart SolidLocker and try again.";

// ---- Branch switching ----

pub const SWITCH_NEEDS_COMMIT: &str =
    "You have unsaved changes. Use Save & Share before switching branches.";

pub fn untracked_collision(branch: &str) -> String {
    format!(
        "Some files on your computer aren't saved to the project, and '{branch}' has its own versions of them."
    )
}

pub fn files_block_switch(branch: &str, files: &str) -> String {
    format!(
        "Some files are in the way of switching to '{branch}'. Close them in SolidWorks and try again: {files}"
    )
}

pub fn could_not_switch(branch: &str) -> String {
    format!("could not switch to branch {branch}")
}

pub fn could_not_preview(stderr: &str) -> String {
    format!("Could not open that moment for a look: {stderr}")
}

pub const NOT_PREVIEWING: &str = "You are not looking at an old version right now.";

pub fn bad_branch_name(name: &str) -> String {
    format!("'{name}' can't be used as a branch name. Use letters, numbers, dashes and slashes, without spaces.")
}

pub fn could_not_branch_off(name: &str, stderr: &str) -> String {
    format!("Could not start the branch '{name}': {stderr}")
}

pub fn refusing_to_move(file: &str) -> String {
    format!("{file} has saved changes, refusing to move it.")
}

pub fn could_not_read_old_version(stderr: &str) -> String {
    format!("Could not read that earlier version from GitHub. ({stderr})")
}

pub fn could_not_restore_version(stderr: &str) -> String {
    format!("Could not bring that version back, is the file open in SolidWorks? ({stderr})")
}

pub fn restore_needs_locks(files: &str) -> String {
    format!("Lock these files before bringing the earlier version back, so nobody else is editing them at the same time: {files}")
}

pub const SW_NEWER_FORMAT: &str =
    "This file is in the newer (2015 and later) SolidWorks format, which keeps its list of parts compressed. SolidWorks has to be running to read it.";

pub fn claim_offline_still_held(files: &str) -> String {
    format!("Lost connection to GitHub partway through. Nothing was locked, except these, which could not be given back and are still locked to you: {files}. Unlock them when you are back online.")
}

#[allow(dead_code)]
pub const UNDO_NO_PARENT: &str =
    "This is the first change in the project, so there is nothing before it to go back to.";

#[allow(dead_code)]
pub fn could_not_remove_added(path: &str, why: &str) -> String {
    format!("Could not remove {path}: {why}. If it is open in SolidWorks, close it and try again.")
}

pub fn conflicts_changed_underneath(n: usize) -> String {
    format!(
        "The branch changed since this list was drawn: {n} file{} now clash that were not here before. Nothing was merged. Look again to see the current list.",
        if n == 1 { "" } else { "s" }
    )
}

pub const UNKNOWN_SIDE: &str = "That is not one of the two versions on offer.";

pub const CONFLICTS_SETTLED_NOT_SHARED: &str =
    "Your choices are made and merged here, but GitHub could not be reached to share the result. Use Save & Share once you are back online.";

pub fn conflicts_still_open(n: usize) -> String {
    format!("{n} file{} still {} a version chosen.", if n == 1 { "" } else { "s" }, if n == 1 { "needs" } else { "need" })
}


pub const PR_NEEDS_SIGN_IN: &str = "Sign in to GitHub first. Reviews use your GitHub account.";

pub const PR_NOT_FOUND: &str =
    "That pull request is not there any more. It may have been merged or closed.";

pub const PR_NEEDS_TITLE: &str = "Give it a title.";

pub const PR_UNKNOWN_REVIEW: &str = "That is not one of the review options.";

pub const PR_REVIEW_NEEDS_WORDS: &str = "Say what needs changing.";

pub const NO_GITHUB_SIGN_IN: &str =
    "SolidLocker could not find your GitHub sign-in on this computer. \
Signing in with GitHub Desktop, or running `git credential fill`, puts it \
where SolidLocker can find it.";

pub fn repos_refused(code: u16) -> String {
    match code {
        401 | 403 => "GitHub would not accept the sign-in stored on this \
computer. Signing in again with GitHub Desktop usually settles it."
            .to_string(),
        _ => format!("GitHub could not list your projects ({code})."),
    }
}

pub fn pr_not_allowed(detail: &str) -> String {
    format!("GitHub would not allow that: {detail}. The repository settings decide who can approve and merge.")
}

pub fn pr_failed(code: u16, detail: &str) -> String {
    format!("GitHub said no ({code}): {detail}")
}

pub fn restore_files_open(files: &str) -> String {
    format!("Close these files in SolidWorks first. SolidWorks keeps its own copy in memory and would write it straight back: {files}")
}

pub fn could_not_fix_files(stderr: &str) -> String {
    format!("Could not put the files back: SolidWorks is still holding one of them. A part stays held as long as an assembly using it is open, so close that assembly (or all of SolidWorks) and try again. ({stderr})")
}

/// Names the files SolidWorks would not let go of.
pub fn still_open_in_solidworks(paths: &[String]) -> String {
    let names: Vec<&str> = paths
        .iter()
        .take(3)
        .map(|p| p.rsplit('/').next().unwrap_or(p))
        .collect();
    let more = paths.len().saturating_sub(names.len());
    if more > 0 {
        format!("{} and {} more", names.join(", "), more)
    } else {
        names.join(", ")
    }
}

// ---- Locking and unlocking ----

pub const RELEASE_NEEDS_COMMIT: &str =
    "This file has unsaved changes. Use Save & Share first.";

pub const RELEASE_NEVER_SHARED: &str =
    "This file has never been shared, so unlocking it would leave it only on your computer while the name stays free for someone else. Use Save & Share first.";

pub const RELEASE_BRANCH_NEVER_SHARED: &str =
    "This branch has never been shared. Use Save & Share first.";

pub const RELEASE_NEEDS_PUSH: &str =
    "Your latest changes to this file are not on GitHub yet. Use Save & Share first.";

// Unlocking no longer requires closing the file in SolidWorks first; the
// read-only flag keeps an unlocked file safe on its own.
// pub const RELEASE_OPEN_IN_SW: &str =
//     "This file is open in SolidWorks. Close it there first, then unlock.";

#[allow(dead_code)] // only read by the Windows build
pub const RELEASE_UNSAVED_IN_SW: &str =
    "This file has unsaved changes in SolidWorks. Save or discard them there, then unlock.";

// ---- Getting the latest / conflicts ----

pub const UPDATE_UNRESOLVED: &str = "A previous update is still unresolved.";

pub const GET_LATEST_NEEDS_COMMIT: &str =
    "You have unsaved changes. Use Save & Share before getting the latest.";

pub fn could_not_reach_github(stderr: &str) -> String {
    format!("Could not reach GitHub: {stderr}")
}

pub const CAD_CONFLICT: &str =
    "A CAD file was changed both here and on GitHub, so only one version of it can be kept. Pick which one.";

pub const TEXT_CONFLICT: &str = "Some text files changed both here and on GitHub.";

pub fn could_not_merge(stderr: &str) -> String {
    format!("Could not bring in the team's changes: {stderr}")
}

pub fn files_block_update(files: &str) -> String {
    format!(
        "The team's changes cannot be written while SolidWorks has these files open. Close them in SolidWorks and they will come down on the next check: {files}"
    )
}

pub const MERGE_NEEDS_COMMIT: &str =
    "You have unsaved changes. Use Save & Share before merging branches.";

pub const UNDO_MERGE_DIRTY: &str =
    "You have unsaved changes now, so undoing the merge could take work with it. Save & Share or discard them first.";

pub const UNDO_MERGE_PUSHED: &str =
    "The merged result is already on GitHub, so it can't be quietly undone. Ask your lead if it needs to come out.";

pub const UNDO_MERGE_NOTHING: &str = "There is no recent merge to undo.";

pub fn merge_conflict_aborted(branch: &str, files: &str) -> String {
    format!(
        "'{branch}' and this branch changed the same files, so only one version of each can be kept: {files}. Pick which to keep for each one."
    )
}

// ---- Save & Share ----

pub const NO_FILES_SELECTED: &str = "No files selected.";

pub const NO_COMMIT_MESSAGE: &str = "Please describe what you changed.";

pub fn delete_locked_by_other(files: &str) -> String {
    format!(
        "Nothing was shared. You deleted files that teammates have locked, and sharing that would remove their work for everyone: {files}. Ask them first, or restore the files."
    )
}

pub fn could_not_push(stderr: &str) -> String {
    format!("Could not push to GitHub: {stderr}")
}

// ---- Offline ----

pub const FETCH_OFFLINE: &str =
    "Can't reach GitHub. Check your internet connection. SolidLocker will keep trying.";

pub const FETCH_SIGNED_OUT: &str =
    "GitHub refused to sync. The app is not signed in. Sign in again from your profile.";

pub const CLAIM_OFFLINE: &str =
    "Can't reach GitHub, so nothing was locked. Check your internet and try again.";

pub const RELEASE_OFFLINE: &str =
    "Can't reach GitHub, so nothing was unlocked. Check your internet and try again.";

// ---- Locks / lock server ----

pub const LOCKS_UNVERIFIED_PERMS_UNCHANGED: &str =
    "Cannot verify locks with GitHub right now. File permissions were left unchanged.";

pub const LOCK_SIGNIN_HINT: &str =
    "Couldn't verify locks with GitHub. Sign in to GitHub first (open GitHub Desktop or run any git pull so the browser sign in appears).";

pub const LOCK_VERIFY_FAILED: &str = "Couldn't verify locks with GitHub right now.";

pub fn could_not_lock(file: &str) -> String {
    format!("could not lock {file}")
}

pub fn could_not_unlock(file: &str) -> String {
    format!("could not unlock {file}")
}

// ---- SolidWorks ----

pub const SW_NOT_RUNNING: &str =
    "SolidWorks isn't running. Open it and try again. While SolidWorks is running, SolidLocker can read this file's referenced parts and select them automatically. But you may still select manually below.";

pub const SW_NOT_INSTALLED: &str =
    "SolidWorks isn't installed on this computer, so SolidLocker can't read this file's referenced parts. Pick the parts it uses below.";

pub const SW_TOO_SLOW: &str = "SolidWorks took too long to answer.";

pub const SW_MAP_NOT_RUNNING: &str =
    "SolidWorks isn't running, so there is nothing to read the references from. Open SolidWorks and press Redraw.";

pub const SW_MAP_NO_ANSWER: &str =
    "SolidWorks did not report any references. Either nothing in this project references anything else, or these files aren't models SolidWorks can open.";

pub const SW_MAP_NOT_INSTALLED: &str =
    "SolidWorks isn't installed on this computer, so SolidLocker can't work out what is built from what.";

pub fn sw_lookup_failed(stderr: &str) -> String {
    format!("SolidWorks reference lookup failed: {stderr}")
}

pub fn refs_blocked_by_open_doc(file: &str) -> String {
    format!(
        "{file} is open in SolidWorks, which blocks reading its references. Close it there and try again, or pick its parts below."
    )
}

// Used by the non-Windows fallback build.
#[allow(dead_code)]
pub fn refs_unreadable(file: &str) -> String {
    format!(
        "Couldn't read the references inside {file}. This SolidWorks version stores them in a format SolidLocker can't scan yet. Pick the parts it uses below."
    )
}

// ---- Window ----

pub const WINDOW_FAILED_TITLE: &str = "SolidLocker could not open its window";

pub const WINDOW_CONFIG_MISSING: &str = "the main window is missing from the app configuration";

pub fn window_failed_body(detail: &str) -> String {
    format!(
        "Your files are still protected and your locks are untouched. Quit SolidLocker from the tray icon, then start it again. ({detail})"
    )
}

// ---- Files ----

pub fn file_not_found(path: &str) -> String {
    format!("File not found: {path}")
}

pub const NOT_CLAIMED_BY_YOU: &str =
    "Modified locally but not locked by you. Lock it or discard the change.";

// ---- Debug log ----

pub const NO_LOG_FOLDER: &str = "Could not work out where the log folder lives on this computer.";
