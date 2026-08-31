import { useMemo, useState } from "react";

import * as api from "../api";
import { useFiles, useLockIndex, useLocks, type LockStatus } from "../queries";
import {
  bytes,
  Empty,
  FileTypeIcon,
  Search,
  Segmented,
  Spinner,
  Trouble,
} from "../components";
import { FileDetail } from "./FileSheet";
import { useBackableDepth } from "../back";

type Filter = "all" | "cad" | "held";

/** Everything in the project, walked a folder at a time. */
export function Files({
  canPush,
  corner,
}: {
  canPush: boolean;
  corner: React.ReactNode;
}) {
  const files = useFiles(true);
  const locks = useLocks(true);
  const statusOf = useLockIndex(locks.data);

  const [dir, setDir] = useState("");
  // Which way the last move went, so going into a folder slides in from the
  // right and coming back out slides in from the left.
  const [wentIn, setWentIn] = useState(true);

  const enter = (next: string) => {
    setWentIn(next.split("/").length > dir.split("/").length || dir === "");
    setDir(next);
  };
  const [needle, setNeedle] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
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

  const crumbs = dir ? dir.split("/") : [];
  // Back walks up one folder at a time before it leaves the screen.
  useBackableDepth(crumbs.length, () =>
    setDir((now) => {
      setWentIn(false);
      return now.split("/").slice(0, -1).join("/");
    }),
  );

  return (
    <div className="m-screen">
      <header className="m-head">
        <h1>Files</h1>
        {corner}
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
          <button className={dir ? "" : "here"} onClick={() => enter("")}>
            Project
          </button>
          {crumbs.map((part, i) => (
            <button
              key={i}
              className={i === crumbs.length - 1 ? "here" : ""}
              onClick={() => enter(crumbs.slice(0, i + 1).join("/"))}
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

      <div
        className={`m-scroll m-browse ${wentIn ? "m-fromright" : "m-fromleft"}`}
        key={dir}
      >
        {files.isLoading && <Spinner label="Reading the project..." />}
        {files.isError && (
          <Trouble error={files.error} onRetry={() => files.refetch()} />
        )}

        {folders.map((folder) => (
            <button
              key={folder}
              className="m-row m-folder"
              onClick={() => enter(dir ? `${dir}/${folder}` : folder)}
            >
              <FolderGlyph />
              <span className="m-row-main">
                <span className="m-row-title">{folder}</span>
              </span>
              <ChevronGlyph />
            </button>
        ))}

        {here.map((file) => {
          const showing = open === file.rel_path;
          return (
            <div
              key={file.rel_path}
              className={`m-expander${showing ? " open" : ""}`}
            >
              <Row
                file={file}
                status={statusOf(file.rel_path)}
                showPath={searching}
                expanded={showing}
                onOpen={() => setOpen(showing ? null : file.rel_path)}
              />
              {showing && (
                <div className="m-rowdetail">
                  <FileDetail
                    path={file.rel_path}
                    file={file}
                    status={statusOf(file.rel_path)}
                    canPush={canPush}
                  />
                </div>
              )}
            </div>
          );
        })}

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

    </div>
  );
}

function Row({
  file,
  status,
  showPath,
  expanded,
  onOpen,
}: {
  file: api.CloudFile;
  status: LockStatus;
  showPath: boolean;
  expanded: boolean;
  onOpen: () => void;
}) {
  return (
    <button className="m-row m-file" onClick={onOpen} aria-expanded={expanded}>
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


