import { useQuery } from "@tanstack/react-query";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { getFileHistory, getSwIcon, getSwInstalled } from "../../api";
import { type FileRowData, type RowActions } from "./Dashboard";
import { rowDomId } from "./rowid";
import { StatusBadge } from "./StatusBadge";
import {
  formatPerson,
  resolveCommitAuthors,
  useIdentities,
} from "../../identity";
import { githubAvatarFromEmail, UserAvatar } from "../common/UserAvatar";
import { formatDateTime } from "../../dates";
import swIconFallback from "../../assets/sw-generic.svg";
import { FilePreview } from "../common/FilePreview";
import { RestoreVersionDialog } from "../dialogs/RestoreVersionDialog";
import type { FileCommit } from "../../api";

/** The installed SolidWorks' own icon */
function useSwIcon(): string {
  const icon = useQuery({
    queryKey: ["swIcon"],
    queryFn: getSwIcon,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });
  return icon.data ?? swIconFallback;
}

/** Whether this computer has SolidWorks at all. */
export function useSwInstalled(): boolean {
  const q = useQuery({
    queryKey: ["swInstalled"],
    queryFn: getSwInstalled,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return q.data ?? true;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatChanged(ms: number): string {
  if (ms === 0) return "";
  const age = Date.now() - ms;
  const min = Math.floor(age / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// Memoized: rows are the bulk of the DOM, and most state changes elsewhere
// in the Dashboard (banners, dialogs, polls that returned identical data)
// have nothing to do with them.
export const FileRow = memo(function FileRow({
  row,
  actions,
  depth,
}: {
  row: FileRowData;
  actions: RowActions;
  depth: number;
}) {
  const path = row.file.rel_path;
  const busy = actions.busyPaths.has(path);
  const swIcon = useSwIcon();
  const swInstalled = useSwInstalled();
  const [expanded, setExpanded] = useState(false);
  const [restoring, setRestoring] = useState<FileCommit | null>(null);
  const isPinned = actions.pinned.has(path.toLowerCase());

  const history = useQuery({
    queryKey: ["fileHistory", path],
    queryFn: () => getFileHistory(path),
    enabled: expanded,
    staleTime: 60_000,
  });
  const identities = useIdentities();
  const authors = useMemo(
    () => resolveCommitAuthors(history.data ?? [], identities.data ?? []),
    [history.data, identities.data],
  );
  const flashing = actions.highlightedPath === path.toLowerCase();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (flashing) {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [flashing]);

  return (
    <>
    <div
      ref={ref}
      id={rowDomId(path)}
      className={`filerow${flashing ? " flash" : ""}${row.file.deleted ? " isdeleted" : ""}`}
      onContextMenu={(e) => actions.contextMenu(e, row)}
    >
      <span
        className="filename"
        style={{ paddingLeft: `${depth * 1.1}rem` }}
      >
        <button
          className={`pinbtn${isPinned ? " ispinned" : ""}`}
          title={isPinned ? "Unpin" : "Pin to top"}
          aria-label={isPinned ? "Unpin" : "Pin to top"}
          onClick={() => actions.togglePin(path)}
        >
          {isPinned ? "★" : "☆"}
        </button>
        <FilePreview path={path} />
        <button
          className="namebtn"
          title={`${path}\nClick for details`}
          onClick={() => setExpanded((v) => !v)}
        >
          {row.file.name}
        </button>
      </span>
      <span className="muted size">{formatSize(row.file.size)}</span>
      <span
        className="muted changed"
        title={
          row.file.modified > 0
            ? `Last changed ${formatDateTime(row.file.modified)}`
            : undefined
        }
      >
        {formatChanged(row.file.modified)}
      </span>
      <span className="status">
        <StatusBadge status={row.status} writable={row.file.writable} />
        {row.edited && (
          <span
            className="badge badge-edited"
            title="You changed this file, the change is not on GitHub yet"
          >
            Edited
          </span>
        )}
        {row.isNew && row.file.tracked && (
          <span
            className="badge badge-new"
            title="Added to the project in the last week"
          >
            New
          </span>
        )}
        {!row.file.tracked && (
          <span
            className="badge badge-edited"
            title="This file only exists on your computer. Use Save & Share to send it to the team"
          >
            Not shared yet
          </span>
        )}
        {row.file.deleted && (
          <span
            className="badge badge-deleted"
            title="You deleted this file. Use Save & Share to remove it for the team as well"
          >
            Deleted
          </span>
        )}
      </span>
      <span className="actions">
        {row.status.kind === "unlocked" && !row.file.deleted && (
          <>
            {/\.(sldasm|slddrw)$/i.test(path) && (
              <button
                disabled={busy}
                title="Find every part this file uses and lock them all together"
                onClick={() => actions.claimWithRefs(path)}
              >
                Lock with parts
              </button>
            )}
            <button
              disabled={busy}
              title="Lock this file for yourself. It becomes editable for you and locked for teammates"
              onClick={() => actions.claim([path])}
            >
              {busy ? "Locking…" : "Lock"}
            </button>
          </>
        )}
        {row.status.kind === "theirs" && (
          <button
            className={actions.watched.has(path.toLowerCase()) ? "watching" : ""}
            title="Get a notification the moment this file is unlocked"
            onClick={() => actions.toggleWatch(path)}
          >
            {actions.watched.has(path.toLowerCase())
              ? "Will notify when free"
              : "Notify when free"}
          </button>
        )}
        {row.status.kind === "mine" && (
          <>
            {/\.(sldasm|slddrw)$/i.test(path) && (
              <button
                disabled={busy}
                title="Find every part this file uses and unlock the ones you hold all together"
                onClick={() => actions.releaseWithRefs(path)}
              >
                Unlock with parts
              </button>
            )}
            <button
              disabled={busy}
              title="Give this file back so teammates can lock it. Your latest changes must be shared to GitHub first"
              onClick={() => actions.release([path])}
            >
              {busy ? "Unlocking…" : "Unlock"}
            </button>
          </>
        )}
        <button
          className="iconbtn openbtn"
          disabled={busy || row.file.deleted}
          title={swInstalled ? "Open in SolidWorks" : "Open this file"}
          aria-label={swInstalled ? "Open in SolidWorks" : "Open this file"}
          onClick={() => actions.open(path)}
        >
          <svg
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          <img className="badgeicon" src={swIcon} alt="" />
        </button>
      </span>
    </div>
    {expanded && (
      <div
        className="filedetail muted small"
        style={{ paddingLeft: `${depth * 1.1 + 1.6}rem` }}
      >
        <div className="filedetail-path">{path}</div>
        {history.isLoading && <div>Reading document history…</div>}
        {history.data && history.data.length > 0 && (
          <ul className="filehistory">
            {history.data.map((c) => {
              const person = authors.get(c.sha);
              return (
                <li key={c.sha}>
                  <span className="fh-author">
                    <UserAvatar
                      url={
                        person?.avatarUrl ??
                        githubAvatarFromEmail(c.author_email)
                      }
                      name={person?.name ?? c.author_name}
                      size={14}
                    />
                    {person
                      ? formatPerson(person.name, person.login)
                      : c.author_name}
                  </span>
                  <span className="fh-msg" title={c.message}>
                    {c.message}
                  </span>
                  <span className="fh-date">{formatDateTime(c.date)}</span>
                  <button
                    className="fh-restore"
                    onClick={() => setRestoring(c)}
                    title="Look at this version, and bring it back if it is the one you want"
                  >
                    View…
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {history.isSuccess && history.data?.length === 0 && (
          <div>No shared changes recorded for this file yet.</div>
        )}
      </div>
    )}
    {restoring && (
      <RestoreVersionDialog
        path={path}
        commit={restoring}
        onClose={() => setRestoring(null)}
        onDone={(notice) => {
          setRestoring(null);
          actions.notify(notice);
        }}
      />
    )}
    </>
  );
});
