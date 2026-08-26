import {
  Fragment,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FileRowData, RowActions } from "./Dashboard";
import type { SortMode } from "./FileTree";
import { FilePreview } from "../common/FilePreview";
import { StatusBadge } from "./StatusBadge";
import { rowDomId } from "./rowid";
import { FileDetails } from "./FileDetails";
import { formatChanged, runningLabel } from "../../dates";
import { OpenFileButton, OpenFolderButton } from "../common/OpenButtons";

/**
 * The thumbnails layout.
 */

function FolderGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7.5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.5.7l1 1.2a2 2 0 0 0 1.5.7H19a2 2 0 0 1 2 2v8.4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

const REFERENCING = /\.(sldasm|slddrw)$/i;

interface Subfolder {
  name: string;
  path: string;
  files: number;
  theirs: number;
  claimable: string[];
  mine: string[];
  deep: boolean;
}

const FolderTile = memo(function FolderTile({
  folder,
  onOpen,
  onShowInExplorer,
  onFolderAction,
  refsRow,
}: {
  folder: Subfolder;
  onOpen: (path: string) => void;
  onShowInExplorer: (path: string) => void;
  onFolderAction: RowActions["confirmFolder"];
  refsRow: boolean;
}) {
  return (
    <div className="filetile foldertile">
      <button
        className="tileopen"
        onClick={() => onOpen(folder.path)}
        title={`Open ${folder.path}`}
      >
        <span className="tilepic folderpic">
          <FolderGlyph />
        </span>
        <span className="tilebody">
          <span className="tilename">{folder.name}</span>
          <span className="tilewhere muted">
            {folder.files} file{folder.files === 1 ? "" : "s"}
            {folder.mine.length > 0 ? ` · ${folder.mine.length} yours` : ""}
            {folder.theirs > 0 ? ` · ${folder.theirs} taken` : ""}
          </span>
        </span>
      </button>
      {/* The same two the list's folder rows carry, in shorter words. "Lock
          folder + subfolders (10)" is wider than a card and pushed the open
          button onto a second line. The tooltip still says it in full. */}
      <div className="tileactions">
        {refsRow && <div className="act-refs" />}
        <div className="act-main">
        {folder.claimable.length > 0 && (
          <button
            title={`Locks every available file under ${folder.name}${folder.deep ? ", including its subfolders" : ""}`}
            onClick={() =>
              onFolderAction("lock", folder.name, folder.claimable)
            }
          >
            Lock ({folder.claimable.length})
          </button>
        )}
        {folder.mine.length > 0 && (
          <button
            title={`Unlocks your locked files under ${folder.name}${folder.deep ? ", including its subfolders" : ""}`}
            onClick={() => onFolderAction("unlock", folder.name, folder.mine)}
          >
            Unlock ({folder.mine.length})
          </button>
        )}
        <OpenFolderButton path={folder.path} onOpen={onShowInExplorer} />
        </div>
      </div>
    </div>
  );
});

const Tile = memo(function Tile({
  row,
  actions,
  open,
  onToggle,
  refsRow,
}: {
  row: FileRowData;
  actions: RowActions;
  open: boolean;
  onToggle: (path: string) => void;
  refsRow: boolean;
}) {
  const path = row.file.rel_path;
  const busy = actions.busyPaths.has(path);
  const running = actions.busyPaths.get(path);
  const flashing = actions.highlightedPath === path.toLowerCase();
  const mine = row.status.kind === "mine";
  const isPinned = actions.pinned.has(path.toLowerCase());

  return (
    <div
      id={rowDomId(path)}
      className={`filetile${flashing ? " flash" : ""}${
        row.file.deleted ? " isdeleted" : ""
      }${mine ? " ismine" : ""}${open ? " isopen" : ""}`}
      onContextMenu={(e) => actions.contextMenu(e, row)}
      title={path}
    >
      {/* Over the corner of the thumbnail rather than in the row of buttons,
          which would cost every card a slot for something most never use. It
          cannot go inside the button below, since that is a button too. */}
      <button
        className={`pinbtn tilepin${isPinned ? " ispinned" : ""}`}
        title={isPinned ? "Unpin" : "Pin to top"}
        aria-label={isPinned ? "Unpin" : "Pin to top"}
        onClick={() => actions.togglePin(path)}
      >
        {isPinned ? "★" : "☆"}
      </button>

      {/* The picture and the name open the file's history. The buttons below
          are outside this, so pressing Lock does not also unfold the page. */}
      <button
        className="tileopen"
        onClick={() => onToggle(path)}
        aria-expanded={open}
        title={`${path}
Click for versions and details`}
      >
      <FilePreview path={path} className="tilepic" />

      <div className="tilebody">
        <p className="tilename">{row.file.name}</p>
        {/* One line, not two. It keeps the card shorter. */}
        <div className="tilemeta">
          <span className="tilewhere muted">
            {row.file.modified > 0 ? formatChanged(row.file.modified) : "—"}
          </span>
          <div className="tilebadges">
          <StatusBadge
            status={row.status}
            writable={row.file.writable}
            lockable={row.file.lockable}
          />
          {row.edited && (
            <span
              className="badge badge-edited"
              title="You changed this file, the change is not on GitHub yet"
            >
              Edited
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
            <span className="badge badge-deleted" title="You deleted this file">
              Deleted
            </span>
          )}
          </div>
        </div>
      </div>
      </button>

      <div className="tileactions">
        {/* Too wide to sit beside the plain Lock button, so it gets a line of
            its own. Every card on the line keeps that space whether it needs
            it or not, or the one assembly among a dozen parts would be the
            only card with its buttons lower than the rest. */}
        {refsRow && (
          <div className="act-refs">
            {row.file.lockable &&
              REFERENCING.test(path) &&
              row.status.kind === "unlocked" &&
              !row.file.deleted && (
                <button
                  disabled={busy || actions.previewing}
                  title="Follow this file's references and lock every part it uses along with it, in one go"
                  onClick={() => actions.claimWithRefs(path)}
                >
                  Lock references
                </button>
              )}
            {row.file.lockable &&
              REFERENCING.test(path) &&
              row.status.kind === "mine" && (
                <button
                  disabled={busy || actions.previewing}
                  title="Follow this file's references and give back every part it uses that you are holding, all together"
                  onClick={() => actions.releaseWithRefs(path)}
                >
                  Unlock references
                </button>
              )}
          </div>
        )}
        <div className="act-main">
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
            title="Get a notification the moment this file is unlocked"
            onClick={() => actions.toggleWatch(path)}
          >
            {actions.watched.has(path.toLowerCase())
              ? "Will notify"
              : "Notify me"}
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
        <OpenFileButton
          path={path}
          lockable={row.file.lockable}
          disabled={busy || row.file.deleted}
          onOpen={actions.open}
        />
        </div>
      </div>

    </div>
  );
});

export function FileTiles({
  rows,
  actions,
  sort,
  here,
  setHere,
}: {
  rows: FileRowData[];
  actions: RowActions;
  sort: SortMode;
  /** Which folder is open. Kept outside so it survives this component being
      taken off screen, and so switching to the list can land in the same
      place. */
  here: string;
  setHere: (folder: string) => void;
}) {
  const [showing, setShowing] = useState<string | null>(null);
  // Which way the last move went, so the wall of tiles comes in from the side
  // you are travelling towards. Going into a folder reads as moving right.
  const [going, setGoing] = useState<"in" | "out">("in");

  function goTo(folder: string) {
    setGoing(folder.length > here.length ? "in" : "out");
    setShowing(null);
    setHere(folder);
  }
  const order = useMemo(() => {
    const pinned = (r: FileRowData) =>
      Number(actions.pinned.has(r.file.rel_path.toLowerCase()));
    const by =
      sort === "size"
        ? (a: FileRowData, b: FileRowData) => b.file.size - a.file.size
        : sort === "modified"
          ? (a: FileRowData, b: FileRowData) => b.file.modified - a.file.modified
          : (a: FileRowData, b: FileRowData) =>
              a.file.name.localeCompare(b.file.name);
    return (list: FileRowData[]) =>
      [...list].sort((a, b) => pinned(b) - pinned(a) || by(a, b));
  }, [sort, actions.pinned]);

  // "Take me to that file" can name a file in a folder nobody is looking at,
  // and in here a file that is not in the open folder has no tile to scroll
  // to. So go to its folder first, then he panel opens under the whole line 
  // of tiles rather than under the one tile.
  const gridRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(1);
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const count = () => {
      const tracks = getComputedStyle(el).gridTemplateColumns;
      const n = tracks.split(" ").filter((t) => t && t !== "none").length;
      setCols(Math.max(1, n));
    };
    count();
    const watcher = new ResizeObserver(count);
    watcher.observe(el);
    return () => watcher.disconnect();
  });

  const wanted = actions.highlightedPath;
  const answered = useRef<string | null>(null);
  useEffect(() => {
    if (!wanted) {
      answered.current = null;
      return;
    }
    if (answered.current === wanted) return;
    const row = rows.find((r) => r.file.rel_path.toLowerCase() === wanted);
    if (!row) return;
    answered.current = wanted;
    if (row.file.dir === here) return;
    setGoing(row.file.dir.length > here.length ? "in" : "out");
    setHere(row.file.dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, rows]);

  const { folders, files, missing } = useMemo(() => {
    const prefix = here === "" ? "" : `${here}/`;
    const byName = new Map<string, Subfolder>();
    const loose: FileRowData[] = [];
    let anythingBelow = false;

    for (const row of rows) {
      const dir = row.file.dir;
      if (dir === here) {
        loose.push(row);
        anythingBelow = true;
        continue;
      }
      if (here !== "" && !dir.startsWith(prefix)) continue;
      const rest = here === "" ? dir : dir.slice(prefix.length);
      if (!rest) continue;
      anythingBelow = true;
      const name = rest.split("/")[0];
      const entry = byName.get(name) ?? {
        name,
        path: here === "" ? name : `${here}/${name}`,
        files: 0,
        theirs: 0,
        claimable: [] as string[],
        mine: [] as string[],
        deep: false,
      };
      entry.files += 1;
      if (rest.includes("/")) entry.deep = true;
      if (row.status.kind === "theirs") entry.theirs += 1;
      // Exports and PDFs are listed but not lockable.
      if (row.file.lockable) {
        if (row.status.kind === "unlocked") entry.claimable.push(row.file.rel_path);
        if (row.status.kind === "mine") entry.mine.push(row.file.rel_path);
      }
      byName.set(name, entry);
    }

    return {
      folders: [...byName.values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
      files: order(loose),
      missing: here !== "" && !anythingBelow,
    };
  }, [rows, here, order]);

  const trail = here === "" ? [] : here.split("/");

  // Folders first, then files.
  const wall = useMemo(
    () => [
      ...folders.map((folder) => ({ key: `d:${folder.path}`, folder, row: null })),
      ...files.map((row) => ({
        key: `f:${row.file.rel_path}`,
        folder: null,
        row,
      })),
    ],
    [folders, files],
  );

  const refsLines = useMemo(() => {
    const lines = new Set<number>();
    wall.forEach((item, i) => {
      const path = item.row?.file.rel_path;
      if (path && item.row!.file.lockable && REFERENCING.test(path)) {
        lines.add(Math.floor(i / cols));
      }
    });
    return lines;
  }, [wall, cols]);

  const openAt = showing
    ? wall.findIndex((item) => item.row?.file.rel_path === showing)
    : -1;
  const openRow = openAt >= 0 ? wall[openAt].row : null;
  const lineEnd =
    openAt >= 0
      ? Math.min(Math.floor(openAt / cols) * cols + cols - 1, wall.length - 1)
      : -1;

  return (
    <div className="tilesview">
      <nav className="tilecrumbs" aria-label="Which folder you are in">
        <button
          className="tileback"
          disabled={here === ""}
          onClick={() => goTo(trail.slice(0, -1).join("/"))}
          title={
            here === ""
              ? "You are at the top of the project"
              : `Back to ${trail.length > 1 ? trail[trail.length - 2] : "all files"}`
          }
          aria-label="Back one folder"
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
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <button className={here === "" ? "atop" : ""} onClick={() => goTo("")}>
          All files
        </button>
        {trail.map((name, i) => (
          <span key={name + i} className="tilecrumb">
            <span className="tilecrumbsep" aria-hidden="true">
              ›
            </span>
            <button
              className={i === trail.length - 1 ? "atop" : ""}
              onClick={() => goTo(trail.slice(0, i + 1).join("/"))}
            >
              {name}
            </button>
          </span>
        ))}
      </nav>

      {folders.length === 0 && files.length === 0 ? (
        <p className="muted">
          {missing
            ? "There is nothing in this folder any more."
            : "Nothing in this folder matches what you are looking for."}{" "}
          {/* You stay where you are either way: a filter that quietly moved
              you somewhere else would be worse than an empty folder. */}
          <button className="linkish" onClick={() => goTo("")}>
            Look in the whole project
          </button>
        </p>
      ) : (
        <div
          className={`filetiles walk-${going}${showing ? " hasopen" : ""}`}
          key={here}
          ref={gridRef}
        >
          {wall.map((item, i) => (
            <Fragment key={item.key}>
              {item.folder ? (
                <FolderTile
                  folder={item.folder}
                  onOpen={goTo}
                  onShowInExplorer={actions.open}
                  onFolderAction={actions.confirmFolder}
                  refsRow={refsLines.has(Math.floor(i / cols))}
                />
              ) : (
                <Tile
                  row={item.row!}
                  actions={actions}
                  open={showing === item.row!.file.rel_path}
                  onToggle={(p) => setShowing((was) => (was === p ? null : p))}
                  refsRow={refsLines.has(Math.floor(i / cols))}
                />
              )}
              {i === lineEnd && openRow && (
                <div className="tiledetail">
                  <div className="tiledetail-head">
                    <FilePreview
                      path={openRow.file.rel_path}
                      className="tiledetail-pic"
                    />
                    <div className="tiledetail-who">
                      <p className="tiledetail-name">{openRow.file.name}</p>
                      <p className="tiledetail-path muted small">
                        {openRow.file.rel_path}
                      </p>
                    </div>
                    <button
                      className="tiledetail-close"
                      onClick={() => setShowing(null)}
                      title="Close"
                      aria-label="Close details"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width="15"
                        height="15"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        aria-hidden="true"
                      >
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </div>
                  <FileDetails
                    path={openRow.file.rel_path}
                    actions={actions}
                    showPath={false}
                  />
                </div>
              )}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
