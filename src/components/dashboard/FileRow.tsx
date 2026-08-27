import { memo, useRef, useState } from "react";
import { type FileRowData, type RowActions } from "./Dashboard";
import { rowDomId } from "./rowid";
import { StatusBadge } from "./StatusBadge";
import { formatChanged, formatDateTime, runningLabel } from "../../dates";
import { FilePreview } from "../common/FilePreview";
import { FileDetails } from "./FileDetails";
import { OpenFileButton } from "../common/OpenButtons";
import { OutsideRefsDialog } from "../dialogs/OutsideRefsDialog";

// useSwIcon and useSwInstalled live in common/OpenButtons now so the tiles can
// use them. Re-exported because the Dashboard asks this file for them.
export { useSwIcon, useSwInstalled } from "../common/OpenButtons";


function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  const [showOutside, setShowOutside] = useState(false);
  const running = actions.busyPaths.get(path);
  const [expanded, setExpanded] = useState(false);
  const isPinned = actions.pinned.has(path.toLowerCase());
  const flashing = actions.highlightedPath === path.toLowerCase();
  // The Dashboard does the scrolling. It has to keep looking until the row
  // exists, which can be a while after a branch switch.
  const ref = useRef<HTMLDivElement>(null);

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
          className={`namebtn${expanded ? " open" : ""}`}
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
        <StatusBadge
          status={row.status}
          writable={row.file.writable}
          lockable={row.file.lockable}
        />
        {row.outside.length > 0 && (
          <button
            className="badge badge-broken"
            title={`Needs ${row.outside.length} file${
              row.outside.length === 1 ? "" : "s"
            } from outside the project, so it opens broken for everyone else. Click for details.`}
            onClick={(e) => {
              e.stopPropagation();
              setShowOutside(true);
            }}
          >
            <span aria-hidden="true">!</span>
            <span className="sr-only">Broken links</span>
          </button>
        )}
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
      {/* The bulk action, the single file one, then opening it. */}
      <span className="actions">
        <span className="act-slot act-parts">
          {row.file.lockable &&
            /\.(sldasm|slddrw)$/i.test(path) &&
            row.status.kind === "unlocked" &&
            !row.file.deleted && (
              <button
                disabled={busy || actions.previewing}
                title="Follow this file's references and lock every part it uses along with it, in one go, so nobody can take one out from under you halfway through"
                onClick={() => actions.claimWithRefs(path)}
              >
                Lock with parts
              </button>
            )}
          {row.file.lockable &&
            /\.(sldasm|slddrw)$/i.test(path) &&
            row.status.kind === "mine" && (
              <button
                disabled={busy || actions.previewing}
                title="Follow this file's references and give back every part it uses that you are holding, all together"
                onClick={() => actions.releaseWithRefs(path)}
              >
                Unlock with parts
              </button>
            )}
        </span>

        <span className="act-slot act-main">
          {row.file.lockable && row.status.kind === "unlocked" && !row.file.deleted && (
            <button
              disabled={busy || actions.previewing}
              title="Lock this file for yourself. It becomes editable for you and locked for teammates"
              onClick={() => actions.claim([path])}
            >
              {busy ? runningLabel(running, "Locking…") : "Lock"}
            </button>
          )}
          {row.file.lockable && row.status.kind === "theirs" && (
            <button
              className={actions.watched.has(path.toLowerCase()) ? "watching" : ""}
              title={
                actions.watched.has(path.toLowerCase())
                  ? "You will get a notification the moment this file is unlocked. Click to stop."
                  : "Get a notification the moment this file is unlocked"
              }
              onClick={() => actions.toggleWatch(path)}
            >
              {actions.watched.has(path.toLowerCase())
                ? "Will notify when free"
                : "Notify when free"}
            </button>
          )}
          {row.file.lockable && row.status.kind === "mine" && (
            <button
              disabled={busy || actions.previewing}
              title="Give this file back so teammates can lock it. Your latest changes must be shared to GitHub first"
              onClick={() => actions.release([path])}
            >
              {busy ? runningLabel(running, "Unlocking…") : "Unlock"}
            </button>
          )}
        </span>

        <span className="act-slot act-open">
        <OpenFileButton
          path={path}
          lockable={row.file.lockable}
          disabled={busy || row.file.deleted}
          onOpen={actions.open}
        />
        </span>
      </span>
    </div>
    {expanded && (
      <FileDetails
        path={path}
        actions={actions}
        indentRem={depth * 1.1 + 1.6}
      />
    )}
    {showOutside && (
      <OutsideRefsDialog
        refs={row.outside}
        // Nothing is being shared from here
        onShareAnyway={null}
        onClose={() => setShowOutside(false)}
      />
    )}
    </>
  );
});
