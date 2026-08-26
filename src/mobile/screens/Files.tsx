import { useMemo, useState } from "react";

import * as api from "../api";
import {
  useCanPrefetch,
  useFiles,
  useLockIndex,
  useLocks,
  usePreviews,
  type LockStatus,
} from "../queries";
import {
  bytes,
  Empty,
  FileTypeIcon,
  Search,
  Segmented,
  Spinner,
  Trouble,
} from "../components";
import { FileSheet } from "./FileSheet";

type Filter = "all" | "cad" | "held";
type Shape = "list" | "tiles";

/** Everything in the project, walked a folder at a time. */
export function Files({
  previewMode,
  canPush,
}: {
  previewMode: api.PreviewMode;
  canPush: boolean;
}) {
  const files = useFiles(true);
  const locks = useLocks(true);
  const statusOf = useLockIndex(locks.data);

  const [dir, setDir] = useState("");
  const [needle, setNeedle] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [shape, setShape] = useState<Shape>("list");
  const [open, setOpen] = useState<string | null>(null);

  const searching = needle.trim().length > 0;

  const matching = useMemo(() => {
    const all = files.data?.files ?? [];
    const q = needle.trim().toLowerCase();
    return all.filter((f) => {
      if (filter === "cad" && !f.is_cad) return false;
      if (filter === "held" && statusOf(f.rel_path).kind === "unlocked") return false;
      if (q) return f.rel_path.toLowerCase().includes(q);
      return true;
    });
  }, [files.data, needle, filter, statusOf]);

  // Searching flattens the project; otherwise you are stood in one folder.
  const { folders, here } = useMemo(() => {
    if (searching) return { folders: [] as string[], here: matching };
    const prefix = dir ? `${dir}/` : "";
    const subfolders = new Set<string>();
    const inThisFolder: api.CloudFile[] = [];
    for (const file of matching) {
      if (!file.rel_path.startsWith(prefix)) continue;
      const rest = file.rel_path.slice(prefix.length);
      const cut = rest.indexOf("/");
      if (cut === -1) inThisFolder.push(file);
      else subfolders.add(rest.slice(0, cut));
    }
    return { folders: [...subfolders].sort(), here: inThisFolder };
  }, [matching, dir, searching]);

  const canPrefetch = useCanPrefetch(previewMode);
  const previewable = useMemo(
    () => (shape === "tiles" ? here.filter((f) => f.is_cad).map((f) => f.rel_path).slice(0, 60) : []),
    [here, shape],
  );
  const previews = usePreviews(previewable, canPrefetch);

  const crumbs = dir ? dir.split("/") : [];

  return (
    <div className="m-screen">
      <header className="m-head">
        <h1>Files</h1>
        <button
          className="m-iconbtn"
          onClick={() => setShape(shape === "list" ? "tiles" : "list")}
          aria-label={shape === "list" ? "Show previews" : "Show a list"}
        >
          {shape === "list" ? <TilesGlyph /> : <ListGlyph />}
        </button>
      </header>

      <div className="m-head-tools">
        <Search value={needle} onChange={setNeedle} placeholder="Search every file" />
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "cad", label: "CAD" },
            {
              value: "held",
              label: "Held",
              count: (locks.data?.ours.length ?? 0) + (locks.data?.theirs.length ?? 0),
            },
          ]}
        />
      </div>

      {!searching && (
        <nav className="m-crumbs" aria-label="Folder">
          <button className={dir ? "" : "here"} onClick={() => setDir("")}>
            Project
          </button>
          {crumbs.map((part, i) => (
            <button
              key={i}
              className={i === crumbs.length - 1 ? "here" : ""}
              onClick={() => setDir(crumbs.slice(0, i + 1).join("/"))}
            >
              {part}
            </button>
          ))}
        </nav>
      )}

      {files.data?.truncated && (
        <p className="m-notice">
          This project is big enough that GitHub trimmed the file list, so some
          files are missing here. Search still reaches everything it sent.
        </p>
      )}

      <div className={shape === "tiles" ? "m-scroll m-tiles" : "m-scroll"}>
        {files.isLoading && <Spinner label="Reading the project…" />}
        {files.isError && (
          <Trouble error={files.error} onRetry={() => files.refetch()} />
        )}

        {shape === "list" &&
          folders.map((folder) => (
            <button
              key={folder}
              className="m-row m-folder"
              onClick={() => setDir(dir ? `${dir}/${folder}` : folder)}
            >
              <FolderGlyph />
              <span className="m-row-main">
                <span className="m-row-title">{folder}</span>
              </span>
              <ChevronGlyph />
            </button>
          ))}

        {shape === "tiles" &&
          folders.map((folder) => (
            <button
              key={folder}
              className="m-tile m-tile-folder"
              onClick={() => setDir(dir ? `${dir}/${folder}` : folder)}
            >
              <FolderGlyph />
              <span className="m-tile-name">{folder}</span>
            </button>
          ))}

        {here.map((file) =>
          shape === "tiles" ? (
            <Tile
              key={file.rel_path}
              file={file}
              status={statusOf(file.rel_path)}
              preview={previews.data?.[file.rel_path]}
              onOpen={() => setOpen(file.rel_path)}
            />
          ) : (
            <Row
              key={file.rel_path}
              file={file}
              status={statusOf(file.rel_path)}
              showPath={searching}
              onOpen={() => setOpen(file.rel_path)}
            />
          ),
        )}

        {files.data && folders.length === 0 && here.length === 0 && (
          <Empty
            title={searching ? "Nothing matched" : "Nothing here"}
            hint={
              filter === "held"
                ? "Nobody is holding a file at the moment."
                : undefined
            }
          />
        )}
      </div>

      {open && (
        <FileSheet
          path={open}
          file={files.data?.files.find((f) => f.rel_path === open) ?? null}
          status={statusOf(open)}
          canPush={canPush}
          previewMode={previewMode}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function Row({
  file,
  status,
  showPath,
  onOpen,
}: {
  file: api.CloudFile;
  status: LockStatus;
  showPath: boolean;
  onOpen: () => void;
}) {
  return (
    <button className="m-row m-file" onClick={onOpen}>
      <span className={`m-filetype${file.is_cad ? " cad" : ""}`}>
        <FileTypeIcon path={file.rel_path} size={18} />
      </span>
      <span className="m-row-main">
        <span className="m-row-title">{file.name}</span>
        <span className="muted small">
          {showPath ? file.dir || "Project root" : bytes(file.size) || (file.lfs ? "CAD file" : "")}
        </span>
      </span>
      <LockMark status={status} />
    </button>
  );
}

function Tile({
  file,
  status,
  preview,
  onOpen,
}: {
  file: api.CloudFile;
  status: LockStatus;
  preview: string | undefined;
  onOpen: () => void;
}) {
  return (
    <button
      className={`m-tile${status.kind === "mine" ? " ismine" : ""}`}
      onClick={onOpen}
    >
      <span className="m-tile-art">
        {preview ? (
          <img src={preview} alt="" />
        ) : (
          <FileTypeIcon path={file.rel_path} size={34} />
        )}
      </span>
      <span className="m-tile-name">{file.name}</span>
      <LockMark status={status} />
    </button>
  );
}

/** Who is holding it, in the smallest space that can carry the answer. */
export function LockMark({ status }: { status: LockStatus }) {
  if (status.kind === "unlocked") return null;
  const mine = status.kind === "mine";
  return (
    <span
      className={`m-lockmark${mine ? " mine" : ""}`}
      title={
        mine
          ? "You are holding this"
          : `${status.lock.owner?.name ?? "Someone"} is holding this`
      }
    >
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
        <rect x="4" y="10" width="16" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" strokeLinecap="round" />
      </svg>
      {!mine && <span>{status.lock.owner?.name}</span>}
    </span>
  );
}

function FolderGlyph() {
  return (
    <span className="m-filetype">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h9A1.5 1.5 0 0 1 21 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5Z" />
      </svg>
    </span>
  );
}

function ChevronGlyph() {
  return (
    <svg className="m-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function TilesGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </svg>
  );
}

function ListGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
