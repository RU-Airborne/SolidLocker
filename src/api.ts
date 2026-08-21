import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  AppState,
  BranchSummary,
  FileEntry,
  LocksResult,
  RepoInfo,
} from "./types";

export const getAppState = () => invoke<AppState>("get_app_state");

export const selectExistingRepo = (path: string) =>
  invoke<RepoInfo>("select_existing_repo", { path });

export const openRepoFolder = () => invoke<void>("open_repo_folder");

/** Close to the tray. Destroys the window so the webview processes exit*/
export const hideToTray = () => invoke<void>("hide_to_tray");

export const quitApp = () => invoke<void>("quit_app");

export const openFile = (path: string) => invoke<void>("open_file", { path });

export const getSwIcon = () => invoke<string | null>("get_sw_icon");

export const getSwInstalled = () => invoke<boolean>("get_sw_installed");

export const getThumbnails = (paths: string[], px: number) =>
  invoke<Record<string, string>>("get_thumbnails", { paths, px });

export const getOpenDocuments = () => invoke<string[]>("get_open_documents");

export const getSwSound = (name: string) =>
  invoke<string | null>("get_sw_sound", { name });

export interface FileCommit {
  sha: string;
  message: string;
  author_name: string;
  author_email: string;
  date: string;
}

export const previewVersion = (path: string, sha: string) =>
  invoke<string | null>("preview_version", { path, sha });

export const restoreVersion = (paths: string[], sha: string) =>
  invoke<void>("restore_version", { paths, sha });

export interface RefsAtResult {
  resolved: string[];
  unresolved: string[];
  warning: string | null;
}

export const resolveReferencesAt = (path: string, sha: string) =>
  invoke<RefsAtResult>("resolve_references_at", { path, sha });

export const openVersion = (path: string, sha: string) =>
  invoke<string>("open_version", { path, sha });

export const branchFromCommit = (name: string, sha: string) =>
  invoke<SwitchResult>("branch_from_commit", { name, sha });


export const branchFromCommitFiles = (
  name: string,
  sha: string,
  paths: string[],
) => invoke<void>("branch_from_commit_files", { name, sha, paths });


export const mergeBranch = (name: string) =>
  invoke<{ merged: boolean; already_up_to_date: boolean }>("merge_branch", {
    name,
  });

export interface MergePreview {
  files: { status: string; path: string }[];
  conflicts: string[];
  up_to_date: boolean;
}

export const mergePreview = (name: string) =>
  invoke<MergePreview>("merge_preview", { name });

export const undoMerge = () => invoke<void>("undo_merge");

export const createBranch = (name: string, from: string | null) =>
  invoke<void>("create_branch", { name, from });

export const previewCommit = (sha: string) =>
  invoke<void>("preview_commit", { sha });

export const endPreview = () => invoke<void>("end_preview");

export const getPreviewState = () =>
  invoke<string | null>("get_preview_state");

export interface GraphCommit {
  sha: string;
  parents: string[];
  author_name: string;
  author_email: string;
  date: string;
  subject: string;
  refs: string[];
  is_head: boolean;
}

export const getGraph = () => invoke<GraphCommit[]>("get_graph");

export const getCommitFiles = (sha: string) =>
  invoke<{ status: string; path: string }[]>("get_commit_files", { sha });

export interface InitLockableResult {
  added: string[];
  committed: boolean;
  pushed: boolean;
}

export const initLockable = () =>
  invoke<InitLockableResult>("init_lockable");

export const getFileHistory = (path: string) =>
  invoke<FileCommit[]>("get_file_history", { path });

export interface CommitIdentity {
  name: string;
  email: string;
}

export const getCommitIdentities = () =>
  invoke<CommitIdentity[]>("get_commit_identities");

export interface CommitStat {
  date: string;
  author_name: string;
  author_email: string;
  file_count: number;
}

export const getCommitStats = () => invoke<CommitStat[]>("get_commit_stats");

export const cloneRepo = (
  url: string,
  destParent: string,
  onProgress: (line: string) => void,
) => {
  const channel = new Channel<string>();
  channel.onmessage = onProgress;
  return invoke<RepoInfo>("clone_repo", {
    url,
    destParent,
    onProgress: channel,
  });
};

export const listFiles = () => invoke<FileEntry[]>("list_files");

export const getLocks = () => invoke<LocksResult>("get_locks");

export interface ClaimResult {
  claimed: string[];
  failed: {
    path: string;
    owner: string | null;
    locked_at: string | null;
    message: string;
  }[];
  /** A teammate won part of the set mid-claim, so every lock this claim had
      already taken was released again */
  rolled_back: boolean;
}

export interface ReleaseOutcome {
  path: string;
  ok: boolean;
  code: string | null;
  message: string | null;
}

export interface SyncResult {
  made_writable: string[];
  made_readonly: string[];
  anomalies: { path: string; reason: string }[];
}

export const claimFiles = (paths: string[]) =>
  invoke<ClaimResult>("claim_files", { paths });

export const releaseFiles = (paths: string[]) =>
  invoke<ReleaseOutcome[]>("release_files", { paths });

export const forceUnlock = (path: string) =>
  invoke<void>("force_unlock", { path });

export const syncAttributes = () => invoke<SyncResult>("sync_attributes");

export interface RepoStatus {
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  dirty: string[];
  untracked: string[];
  conflicted: string[];
}

export const getRepoStatus = () => invoke<RepoStatus>("get_repo_status");

export const fetchRemote = () => invoke<boolean>("fetch_remote");

export const githubSignedIn = () => invoke<boolean>("github_signed_in");

/** Why GitHub is unreachable: signed out (auth) vs truly offline (network). */
export const connectionState = () =>
  invoke<"ok" | "signed_out" | "offline">("connection_state");

export const signOutGithub = () => invoke<void>("sign_out_github");

/** Opens the credential manager's sign in window. User action only. */
export const githubSignIn = () => invoke<boolean>("github_sign_in");

export interface CommitInfo {
  sha: string;
  author_name: string;
  author_email: string;
  date: string;
  message: string;
  body: string;
  files: { status: string; path: string }[];
}

export const getActivity = () => invoke<CommitInfo[]>("get_activity");

/** Project-wide history, every branch. Used by the Progress page. */
export const getActivityAll = () => invoke<CommitInfo[]>("get_activity_all");

export const getLatest = () =>
  invoke<{ merged: boolean; behind_before: number }>("get_latest");

export const abortMerge = () => invoke<void>("abort_merge");

export const resolveKeepTheirs = (paths: string[]) =>
  invoke<void>("resolve_keep_theirs", { paths });

export const saveAndShare = (message: string, paths: string[]) =>
  invoke<{ pushed: boolean }>("save_and_share", { message, paths });

export const pushNow = () => invoke<{ pushed: boolean }>("push_now");

export interface RefResolution {
  resolved: string[];
  ambiguous: { name: string; candidates: string[] }[];
  unresolved: string[];
  warning: string | null;
  suggestions: string[];
}

export const resolveReferences = (path: string) =>
  invoke<RefResolution>("resolve_references", { path });

export const listRepoBranches = () => invoke<string[]>("list_repo_branches");

/** Shows the debug log folder in Explorer, for bug reports. */
export const openLogsFolder = () => invoke<void>("open_logs_folder");

/** Writes a line into the shared debug log. Fire and forget. */
export const logFrontend = (message: string) =>
  invoke<void>("log_frontend", { message }).catch(() => {});

export const getBranchOverview = () =>
  invoke<BranchSummary[]>("get_branch_overview");

export interface SwitchResult {
  /** Still holding the old branch's content; safe to restore. */
  stuck_files: string[];
  /** Written while the switch ran. Unsaved work, so never restore these. */
  kept_files: string[];
}

export const switchBranch = (name: string) =>
  invoke<SwitchResult>("switch_branch", { name });

export const isSwitching = () => invoke<boolean>("is_switching");
export const restoreFiles = (files: string[]) =>
  invoke<void>("restore_files", { files });

export const setAsideFiles = (files: string[]) =>
  invoke<string>("set_aside_files", { files });

export const locateLockPaths = (paths: string[]) =>
  invoke<Record<string, string[]>>("locate_lock_paths", { paths });
