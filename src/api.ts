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

export interface UndoPlan {
  restore: string[];
  remove: string[];
  parent: string;
}

export const planUndo = (sha: string) => invoke<UndoPlan>("plan_undo", { sha });

export const undoChange = (sha: string) => invoke<void>("undo_change", { sha });

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
  unrelated: boolean;
}

export const mergePreview = (name: string) =>
  invoke<MergePreview>("merge_preview", { name });

export const mergePreviewBetween = (base: string, name: string) =>
  invoke<MergePreview>("merge_preview_between", { base, name });

export const undoMerge = () => invoke<void>("undo_merge");

export const deleteBranch = (name: string) =>
  invoke<void>("delete_branch", { name });

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
  /** The rest of the message after the first line, when there is one. */
  body: string;
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

export interface OutsideRef {
  from: string;
  to: string;
  missing: boolean;
}

export interface OutsideCheck {
  refs: OutsideRef[];
  scanned: number;
  /** False when SolidWorks could not be asked, so nothing was ruled out. */
  checked: boolean;
  why: string | null;
}

export interface SetupCheck {
  id: string;
  label: string;
  state: "ok" | "warn" | "fail";
  detail: string;
  fix: string | null;
  fixable: boolean;
}

export const runSetupChecks = () => invoke<SetupCheck[]>("run_setup_checks");

export interface Collision {
  branch: string;
  author: string;
  last_commit_at: number;
  files: string[];
  is_mine: boolean;
  cad_files: string[];
}

export const getCollisions = () => invoke<Collision[]>("get_collisions");

export interface SideInfo {
  sha: string;
  author: string;
  author_email: string;
  date: string;
  subject: string;
  present: boolean;
  git_ref: string;
  full_sha: string;
}

export interface Conflict {
  path: string;
  is_cad: boolean;
  resolved: string | null;
  mine: SideInfo;
  theirs: SideInfo;
}

export const conflictSides = () => invoke<[string, string]>("conflict_sides");

export const listConflicts = () => invoke<Conflict[]>("list_conflicts");

export interface PullSummary {
  number: number;
  title: string;
  author: string;
  author_avatar: string;
  head: string;
  base: string;
  draft: boolean;
  created_at: string;
  updated_at: string;
  /** "open" | "merged" | "closed" */
  state: string;
  merged_at: string;
  review_state: string;
  comments: number;
}

export interface PullFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  is_cad: boolean;
}

export interface PullComment {
  author: string;
  author_avatar: string;
  body: string;
  created_at: string;
  /** "comment" | "approved" | "changes_requested" | "reviewed" | "note" */
  kind: string;
  path: string;
  pick: string;
  picks: { path: string; branch: string }[];
}

export interface PullDetail {
  number: number;
  title: string;
  body: string;
  author: string;
  author_avatar: string;
  head: string;
  base: string;
  head_sha: string;
  state: string;
  merged: boolean;
  merged_at: string;
  merged_by: string;
  merged_by_avatar: string;
  merge_commit_sha: string;
  draft: boolean;
  created_at: string;
  updated_at: string;
  mergeable: boolean | null;
  mergeable_state: string;
  files: PullFile[];
  comments: PullComment[];
  url: string;
}

export const getDefaultBranch = () => invoke<string>("get_default_branch");

export const listPulls = () => invoke<PullSummary[]>("list_pulls");

export const pullDetail = (number: number) =>
  invoke<PullDetail>("pull_detail", { number });


export const planConflictsBetween = (base: string, head: string) =>
  invoke<Conflict[]>("plan_conflicts_between", { base, head });

export interface MergedPlan {
  base_sha: string;
  head_sha: string;
  /** `resolved` on each is "mine" | "theirs" | "other". */
  files: Conflict[];
}

export const mergedPicks = (sha: string) =>
  invoke<MergedPlan>("merged_picks", { sha });

export interface Protection {
  protected: boolean;
  requires_review: boolean;
  approvals: number;
}

export const branchProtection = (branch: string) =>
  invoke<Protection>("branch_protection", { branch });

export const proposePicks = (
  number: number,
  commitId: string,
  picks: { path: string; branch: string }[],
  event: string,
  body: string,
) => invoke<boolean>("propose_picks", { number, commitId, picks, event, body });

export const createPull = (title: string, body: string, head: string, base: string) =>
  invoke<number>("create_pull", { title, body, head, base });

export const reviewPull = (number: number, event: string, body: string) =>
  invoke<boolean>("review_pull", { number, event, body });

export const mergePull = (number: number, method: string) =>
  invoke<void>("merge_pull", { number, method });

export const closePull = (number: number) =>
  invoke<void>("close_pull", { number });

export const previewConflictSide = (path: string, side: string) =>
  invoke<string | null>("preview_conflict_side", { path, side });

export const openConflictSide = (path: string, side: string) =>
  invoke<void>("open_conflict_side", { path, side });

export const resolveConflict = (path: string, side: string) =>
  invoke<void>("resolve_conflict", { path, side });

export const finishConflicts = (picks: { path: string; side: string }[]) =>
  invoke<void>("finish_conflicts", { picks });

export const planConflicts = (branch: string) =>
  invoke<Conflict[]>("plan_conflicts", { branch });

export const combineWithPicks = (branch: string, picks: { path: string; side: string }[]) =>
  invoke<void>("combine_with_picks", { branch, picks });

export const abandonConflicts = () => invoke<void>("abandon_conflicts");

export const getUsedBy = (path: string) =>
  invoke<string[]>("get_used_by", { path });

export const checkOutsideRefs = (paths: string[]) =>
  invoke<OutsideCheck>("check_outside_refs", { paths });

export const getCommitIdentities = () =>
  invoke<CommitIdentity[]>("get_commit_identities");

/**
 * Display names from GitHub profiles. For people not committed yet, so this is the only
 * way to learn a lock holder's real name before their first commit.
 */
export const getProfileNames = (logins: string[]) =>
  invoke<Record<string, string>>("get_profile_names", { logins });

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
  still_held: string[];
  cancelled: boolean;
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

export interface LockProgress {
  state: "working" | "done" | "failed" | "undone";
  path: string;
  total: number;
}

function progressChannel(onProgress?: (step: LockProgress) => void) {
  const channel = new Channel<LockProgress>();
  if (onProgress) channel.onmessage = onProgress;
  return channel;
}

export const claimFiles = (
  paths: string[],
  onProgress?: (step: LockProgress) => void,
) =>
  invoke<ClaimResult>("claim_files", {
    paths,
    onProgress: progressChannel(onProgress),
  });

export const releaseFiles = (
  paths: string[],
  onProgress?: (step: LockProgress) => void,
) =>
  invoke<ReleaseOutcome[]>("release_files", {
    paths,
    onProgress: progressChannel(onProgress),
  });

export const cancelLockRun = () => invoke<void>("cancel_lock_run");

export const forceUnlock = (path: string) =>
  invoke<void>("force_unlock", { path });

export const syncAttributes = () => invoke<SyncResult>("sync_attributes");

export interface TidyResult {
  fetched: boolean;
  swept: string[];
  made_writable: number;
  made_readonly: number;
  anomalies: { path: string; reason: string }[];
}

export const tidyAndSync = () => invoke<TidyResult>("tidy_and_sync");

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
