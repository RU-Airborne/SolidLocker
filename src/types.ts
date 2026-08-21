/// SolidWorks writes ~$Foo.SLDPRT companions while a document is open. Junk,
/// not work worth saving.
export function isSwTemp(path: string): boolean {
  return (path.split("/").pop() ?? path).startsWith("~$");
}

export interface RepoInfo {
  repo_path: string;
  repo_slug: string;
  branch: string;
  lockable_ok: boolean;
}

export interface AppState {
  repo: RepoInfo | null;
  signed_in: boolean;
  username: string | null;
  git_ok: boolean;
  lfs_ok: boolean;
  lfs_version: string | null;
}

export interface FileEntry {
  rel_path: string;
  name: string;
  dir: string;
  size: number;
  modified: number;
  added: number;
  writable: boolean;
  tracked: boolean;
  deleted: boolean;
}

export interface Lock {
  id: string;
  path: string;
  owner: { name: string } | null;
  locked_at: string | null;
}

export interface BranchSummary {
  name: string;
  last_commit_at: number;
  author: string;
  subject: string;
  ahead: number;
  behind: number;
  is_default: boolean;
  forked_at: number;
}

export interface LocksResult {
  ours: Lock[];
  theirs: Lock[];
  fresh: boolean;
}

export type LockStatus =
  | { kind: "unlocked" }
  | { kind: "mine"; lock: Lock }
  | { kind: "theirs"; lock: Lock };

export interface AppError {
  code: string;
  message: string;
  detail?: unknown;
}

export function isAppError(e: unknown): e is AppError {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    "message" in e
  );
}
