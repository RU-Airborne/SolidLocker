import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { getActivity, type CommitInfo } from "../../api";
import { githubAvatarFromEmail, UserAvatar } from "../common/UserAvatar";
import { formatDate } from "../../dates";
import {
  formatPerson,
  resolveCommitAuthors,
  useIdentities,
} from "../../identity";

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} minutes ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hours ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} days ago`;
  return formatDate(iso);
}

const STATUS_TITLE: Record<string, string> = {
  A: "Added",
  M: "Modified",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
};

function FileLine({
  status,
  path,
  onBranch,
  onSelect,
}: {
  status: string;
  path: string;
  onBranch: boolean;
  onSelect: (path: string) => void;
}) {
  const parts = path.split("/");
  const name = parts.pop();
  const folder = parts.join("/");
  const s = status.toLowerCase();
  return (
    <li className="commitfile" title={`${STATUS_TITLE[status] ?? "Changed"} — ${path}`}>
      <span className={`st st-${s}`}>{status}</span>
      <button
        className="commitfilejump"
        disabled={!onBranch}
        onClick={() => onSelect(path)}
        title={
          onBranch
            ? `Show ${path} in the file list`
            : `${path} is not in the file list on this branch`
        }
      >
        <span className="commitfilename">
          {name}
          {folder && <span className="muted"> · {folder}</span>}
        </span>
      </button>
    </li>
  );
}

function CommitRow({
  commit,
  author,
  avatarUrl,
  knownPaths,
  onSelectFile,
}: {
  commit: CommitInfo;
  author: string;
  avatarUrl: string | null;
  knownPaths: Set<string>;
  onSelectFile: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="commit">
      <button className="commithead" onClick={() => setOpen(!open)}>
        <span className={`commitmsg${open ? " open" : ""}`}>{commit.message}</span>
        {open && commit.body && (
          <span className="commitbody-text muted small">{commit.body}</span>
        )}
        <span className="commitmeta">
          <UserAvatar
            url={avatarUrl ?? githubAvatarFromEmail(commit.author_email)}
            name={author}
            size={16}
          />
          <span className="commitmetatext">
            <span className="muted small commitauthor">{author}</span>
            <span className="muted small commitwhen">
              {"· "}
              {relativeTime(commit.date)}
              {commit.files.length > 0 &&
                ` · ${commit.files.length} file${commit.files.length === 1 ? "" : "s"}`}
            </span>
          </span>
        </span>
      </button>
      {open && commit.files.length > 0 && (
        <ul className="commitfilelist">
          {commit.files.map((f) => (
            <FileLine
              key={f.path}
              status={f.status}
              path={f.path}
              onBranch={knownPaths.has(f.path.toLowerCase())}
              onSelect={onSelectFile}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export function ActivityPanel({
  knownPaths,
  onSelectFile,
}: {
  knownPaths: Set<string>;
  onSelectFile: (path: string) => void;
}) {
  const activity = useQuery({
    queryKey: ["activity"],
    queryFn: getActivity,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const identities = useIdentities();

  const authors = useMemo(
    () => resolveCommitAuthors(activity.data ?? [], identities.data ?? []),
    [activity.data, identities.data],
  );

  if (activity.isLoading) return <p className="muted">Reading document history…</p>;
  if (activity.isError) return <p className="muted">{String(activity.error)}</p>;
  if (!activity.data || activity.data.length === 0)
    return <p className="muted">No activity on this branch yet.</p>;

  return (
    <div className="activitylist">
      {activity.data.map((commit) => {
        const person = authors.get(commit.sha);
        return (
          <CommitRow
            key={commit.sha}
            commit={commit}
            author={
              person
                ? formatPerson(person.name, person.login)
                : commit.author_name
            }
            avatarUrl={person?.avatarUrl ?? null}
            knownPaths={knownPaths}
            onSelectFile={onSelectFile}
          />
        );
      })}
    </div>
  );
}
