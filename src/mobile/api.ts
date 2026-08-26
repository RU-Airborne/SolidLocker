/**
 * The phone's half of the bridge.
 *
 * Kept apart from `src/api.ts` on purpose. Those commands mean "do this to
 * the working tree"; these mean "ask GitHub". Same words in a couple of
 * places, very different promises, so they do not share a file.
 */

import { invoke } from "@tauri-apps/api/core";

export interface Me {
  login: string;
  name: string | null;
  avatar_url: string;
}

export interface CloudState {
  signed_in: boolean;
  me: Me | null;
  slug: string | null;
  branch: string | null;
  can_device_sign_in: boolean;
  platform: string;
}

export interface Platform {
  os: string;
  mobile: boolean;
}

export const getPlatform = () => invoke<Platform>("get_platform");

export const cloudState = () => invoke<CloudState>("cloud_state");

// ---- Signing in ----

export interface DeviceStart {
  user_code: string;
  verification_uri: string;
  device_code: string;
  interval: number;
  expires_in: number;
}

export type DevicePoll =
  | { state: "pending" }
  | { state: "slow_down"; interval: number }
  | { state: "done"; token: string };

export const deviceStart = () => invoke<DeviceStart>("cloud_device_start");

export const devicePoll = (deviceCode: string) =>
  invoke<DevicePoll>("cloud_device_poll", { deviceCode });

export const signInWithToken = (token: string) =>
  invoke<Me>("cloud_sign_in_token", { token });

export const signOut = () => invoke<void>("cloud_sign_out");

export const getClientId = () => invoke<string>("cloud_get_client_id");

export const setClientId = (id: string) =>
  invoke<void>("cloud_set_client_id", { id });

// ---- The project ----

export interface CloudRepo {
  slug: string;
  default_branch: string;
  private: boolean;
  can_push: boolean;
  can_admin: boolean;
  description: string;
  lockable_ok: boolean;
}

export interface RepoChoice {
  slug: string;
  name: string;
  owner: string;
  owner_avatar: string;
  private: boolean;
  updated_at: string;
  description: string;
}

export const myRepos = () => invoke<RepoChoice[]>("cloud_my_repos");

export const chooseRepo = (slug: string) =>
  invoke<CloudRepo>("cloud_choose_repo", { slug });

export const cloudRepo = () => invoke<CloudRepo>("cloud_repo");

export const forgetRepo = () => invoke<void>("cloud_forget_repo");

export const setBranch = (name: string) =>
  invoke<void>("cloud_set_branch", { name });

// ---- Files ----

export interface CloudFile {
  rel_path: string;
  name: string;
  dir: string;
  size: number;
  sha: string;
  is_cad: boolean;
  lockable: boolean;
  lfs: boolean;
}

export interface FileListing {
  files: CloudFile[];
  truncated: boolean;
}

export const listFiles = () => invoke<FileListing>("cloud_files");

// ---- Locks ----

export interface Lock {
  id: string;
  path: string;
  owner: { name: string } | null;
  locked_at: string | null;
}

export interface LocksResult {
  ours: Lock[];
  theirs: Lock[];
  fresh: boolean;
}

export const getLocks = () => invoke<LocksResult>("cloud_locks");

export interface FailedClaim {
  path: string;
  owner: string | null;
  locked_at: string | null;
  message: string;
}

export interface ClaimResult {
  claimed: string[];
  failed: FailedClaim[];
  rolled_back: boolean;
}

export const claim = (paths: string[]) =>
  invoke<ClaimResult>("cloud_claim", { paths });

export interface ReleaseOutcome {
  path: string;
  ok: boolean;
  code: string | null;
  message: string | null;
}

export const release = (paths: string[]) =>
  invoke<ReleaseOutcome[]>("cloud_release", { paths });

export const forceUnlock = (path: string) =>
  invoke<void>("cloud_force_unlock", { path });

// ---- Branches ----

export interface CloudBranch {
  name: string;
  sha: string;
  is_default: boolean;
  protected: boolean;
  last_commit_at: number;
  author: string;
  author_avatar: string;
  subject: string;
  ahead: number;
  behind: number;
}

export interface BranchStanding {
  ahead: number;
  behind: number;
  last_commit_at: number;
  author: string;
  author_avatar: string;
  subject: string;
}

export const listBranches = () => invoke<CloudBranch[]>("cloud_branches");

export const branchStanding = (base: string, head: string) =>
  invoke<BranchStanding>("cloud_branch_standing", { base, head });

export const createBranch = (name: string, fromSha: string) =>
  invoke<void>("cloud_create_branch", { name, fromSha });

// ---- History ----

export interface CloudCommit {
  sha: string;
  author_name: string;
  author_login: string;
  author_avatar: string;
  author_email: string;
  date: string;
  message: string;
  body: string;
}

export interface ChangedFile {
  status: string;
  path: string;
  additions: number;
  deletions: number;
  is_cad: boolean;
}

export interface CommitDetail extends CloudCommit {
  files: ChangedFile[];
}

export const getActivity = (limit?: number) =>
  invoke<CloudCommit[]>("cloud_activity", { limit });

export const getFileHistory = (path: string) =>
  invoke<CloudCommit[]>("cloud_file_history", { path });

export const getCommit = (sha: string) =>
  invoke<CommitDetail>("cloud_commit", { sha });

export interface CommitStat {
  date: string;
  author_name: string;
  author_email: string;
  file_count: number;
}

export const getCommitStats = () => invoke<CommitStat[]>("cloud_commit_stats");

// ---- The graph ----

export interface GraphCommit {
  sha: string;
  parents: string[];
  author_name: string;
  author_login: string;
  author_avatar: string;
  date: string;
  /** Seconds since the epoch. */
  at: number;
  subject: string;
  /** Branch names whose tip is this commit. */
  refs: string[];
  is_head: boolean;
}

export const getGraph = () => invoke<GraphCommit[]>("cloud_graph");

export interface ReworkedFile {
  path: string;
  changes: number;
  people: number;
  last_at: number;
  is_cad: boolean;
}

export const getReworked = () => invoke<ReworkedFile[]>("cloud_reworked");

// ---- People ----


export interface TeamMember {
  login: string;
  name: string;
  avatar_url: string;
  commits: number;
  holding: number;
}

export const getTeam = () => invoke<TeamMember[]>("cloud_team");

export const getDisplayNames = (logins: string[]) =>
  invoke<Record<string, string>>("cloud_display_names", { logins });

// ---- Previews ----

export const getPreview = (path: string) =>
  invoke<string | null>("cloud_preview", { path });

export const getPreviews = (paths: string[]) =>
  invoke<Record<string, string>>("cloud_previews", { paths });

export const previewCacheBytes = () => invoke<number>("cloud_preview_cache");

export const clearPreviews = () => invoke<void>("cloud_clear_previews");

/** "wifi" | "always" | "never" */
export type PreviewMode = "wifi" | "always" | "never";

export const getPreviewMode = () => invoke<PreviewMode>("cloud_preview_mode");

export const setPreviewMode = (mode: PreviewMode) =>
  invoke<void>("cloud_set_preview_mode", { mode });

// ---- Merge requests ----

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

export const listPulls = () => invoke<PullSummary[]>("cloud_pulls");

export const pullDetail = (number: number) =>
  invoke<PullDetail>("cloud_pull", { number });

export const reviewPull = (number: number, event: string, body: string) =>
  invoke<boolean>("cloud_review_pull", { number, event, body });

export const mergePull = (number: number, method: string) =>
  invoke<void>("cloud_merge_pull", { number, method });

export const closePull = (number: number) =>
  invoke<void>("cloud_close_pull", { number });

export const createPull = (
  title: string,
  body: string,
  head: string,
  base: string,
) => invoke<number>("cloud_create_pull", { title, body, head, base });

export interface Protection {
  protected: boolean;
  requires_review: boolean;
  approvals: number;
}

export const branchProtection = (branch: string) =>
  invoke<Protection>("cloud_branch_protection", { branch });
