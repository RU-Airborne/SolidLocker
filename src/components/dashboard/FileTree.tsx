import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FileRowData, RowActions } from "./Dashboard";
import { FileRow } from "./FileRow";

interface FolderNode {
  name: string;
  path: string;
  folders: FolderNode[];
  files: FileRowData[];
}

export type SortMode = "name" | "size" | "modified";

function buildTree(rows: FileRowData[], sort: SortMode): FolderNode {
  const root: FolderNode = { name: "", path: "", folders: [], files: [] };
  const nodes = new Map<string, FolderNode>([["", root]]);

  const folderFor = (dir: string): FolderNode => {
    const existing = nodes.get(dir);
    if (existing) return existing;
    const idx = dir.lastIndexOf("/");
    const parent = folderFor(idx === -1 ? "" : dir.slice(0, idx));
    const node: FolderNode = {
      name: idx === -1 ? dir : dir.slice(idx + 1),
      path: dir,
      folders: [],
      files: [],
    };
    parent.folders.push(node);
    nodes.set(dir, node);
    return node;
  };

  for (const row of rows) {
    folderFor(row.file.dir).files.push(row);
  }

  const aggregate = (node: FolderNode): { size: number; modified: number } => {
    let size = 0;
    let modified = 0;
    for (const row of node.files) {
      size += row.file.size;
      modified = Math.max(modified, row.file.modified);
    }
    for (const child of node.folders) {
      const agg = aggregate(child);
      size += agg.size;
      modified = Math.max(modified, agg.modified);
    }
    aggregates.set(node.path, { size, modified });
    return { size, modified };
  };
  const aggregates = new Map<string, { size: number; modified: number }>();
  aggregate(root);

  for (const node of nodes.values()) {
    if (sort === "size") {
      node.files.sort((a, b) => b.file.size - a.file.size);
      node.folders.sort(
        (a, b) =>
          (aggregates.get(b.path)?.size ?? 0) - (aggregates.get(a.path)?.size ?? 0),
      );
    } else if (sort === "modified") {
      node.files.sort((a, b) => b.file.modified - a.file.modified);
      node.folders.sort(
        (a, b) =>
          (aggregates.get(b.path)?.modified ?? 0) -
          (aggregates.get(a.path)?.modified ?? 0),
      );
    } else {
      node.files.sort((a, b) => a.file.name.localeCompare(b.file.name));
      node.folders.sort((a, b) => a.name.localeCompare(b.name));
    }
  }
  return root;
}

function subtreeStats(node: FolderNode): { claimable: string[]; mine: string[] } {
  const claimable: string[] = [];
  const mine: string[] = [];
  const visit = (n: FolderNode) => {
    for (const row of n.files) {
      if (row.status.kind === "unlocked") claimable.push(row.file.rel_path);
      if (row.status.kind === "mine") mine.push(row.file.rel_path);
    }
    n.folders.forEach(visit);
  };
  visit(node);
  return { claimable, mine };
}

const TREE_STORE_PREFIX = "solidlocker.tree.";

interface SavedTree {
  collapsed: string[];
  known: string[];
}

function loadTreeState(repoPath: string): SavedTree | null {
  try {
    const raw = localStorage.getItem(TREE_STORE_PREFIX + repoPath);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedTree;
    if (Array.isArray(parsed?.collapsed) && Array.isArray(parsed?.known)) {
      return parsed;
    }
  } catch {
    // A torn write is no reason to break the tree. Fall back to defaults.
  }
  return null;
}

function collectFolderPaths(node: FolderNode, out: string[] = []): string[] {
  for (const child of node.folders) {
    out.push(child.path);
    collectFolderPaths(child, out);
  }
  return out;
}

function ancestorsOf(dir: string): string[] {
  const out: string[] = [];
  let current = dir;
  while (current) {
    out.push(current);
    const idx = current.lastIndexOf("/");
    current = idx === -1 ? "" : current.slice(0, idx);
  }
  return out;
}

const Folder = memo(function Folder({
  node,
  depth,
  collapsed,
  toggle,
  actions,
  forceExpand,
}: {
  node: FolderNode;
  depth: number;
  collapsed: Set<string>;
  toggle: (path: string) => void;
  actions: RowActions;
  forceExpand: boolean;
}) {
  const isCollapsed = !forceExpand && collapsed.has(node.path);
  const { claimable, mine } = subtreeStats(node);

  return (
    <div className="treefolder">
      <div
        className="folderrow"
        style={{ paddingLeft: `${depth * 1.1}rem` }}
        onClick={() => toggle(node.path)}
      >
        <span className={`chevron${isCollapsed ? " closed" : ""}`}>▾</span>
        <span className="foldername">{node.name}</span>
        <span
          className="group-actions"
          onClick={(e) => e.stopPropagation()}
        >
          {claimable.length > 0 && (
            <button
              title={`Locks every available file under ${node.name}${node.folders.length > 0 ? ", including its subfolders" : ""}`}
              onClick={() =>
                actions.confirmFolder("lock", node.name, claimable)
              }
            >
              {node.folders.length > 0
                ? `Lock folder + subfolders (${claimable.length})`
                : `Lock folder (${claimable.length})`}
            </button>
          )}
          {mine.length > 0 && (
            <button
              title={`Unlocks your locked files under ${node.name}${node.folders.length > 0 ? ", including its subfolders" : ""}`}
              onClick={() =>
                actions.confirmFolder("unlock", node.name, mine)
              }
            >
              Unlock mine ({mine.length})
            </button>
          )}
          <button
            className="iconbtn openbtn"
            title="Open this folder on your computer"
            aria-label="Open folder"
            onClick={() => actions.open(node.path)}
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
            <svg
              className="badgeicon"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                d="M2 6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z"
                fill="#f0a92e"
              />
            </svg>
          </button>
        </span>
      </div>
      {!isCollapsed && (
        <>
          {node.files.map((row) => (
            <FileRow
              key={row.file.rel_path}
              row={row}
              actions={actions}
              depth={depth + 1}
            />
          ))}
          {node.folders.map((child) => (
            <Folder
              key={child.path}
              node={child}
              depth={depth + 1}
              collapsed={collapsed}
              toggle={toggle}
              actions={actions}
              forceExpand={forceExpand}
            />
          ))}
        </>
      )}
    </div>
  );
});

export const FileTree = memo(function FileTree({
  rows,
  actions,
  sort,
  forceExpand = false,
  repoPath,
}: {
  rows: FileRowData[];
  actions: RowActions;
  sort: SortMode;
  /** While searching or filtering, every folder shows its matches. */
  forceExpand?: boolean;
  /** Keys the remembered open/closed state of the folders. */
  repoPath: string;
}) {
  const tree = useMemo(() => buildTree(rows, sort), [rows, sort]);
  const folderPaths = useMemo(() => collectFolderPaths(tree), [tree]);

  const saved = useRef<{ collapsed: Set<string>; known: Set<string> } | null>(
    null,
  );
  const reconciled = useRef<Set<string>>(new Set());
  const repoFor = useRef<string | null>(null);
  const skipSave = useRef(false);

  const startCollapsed = (p: string) =>
    saved.current
      ? saved.current.collapsed.has(p) ||
        (!saved.current.known.has(p) && p.includes("/"))
      : p.includes("/");

  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    repoFor.current = repoPath;
    const s = loadTreeState(repoPath);
    saved.current = s && {
      collapsed: new Set(s.collapsed),
      known: new Set(s.known),
    };
    reconciled.current = new Set(folderPaths);
    return new Set(folderPaths.filter(startCollapsed));
  });

  useEffect(() => {
    if (repoFor.current !== repoPath) {
      // A different repo was opened into the same tree: start its view over.
      repoFor.current = repoPath;
      const s = loadTreeState(repoPath);
      saved.current = s && {
        collapsed: new Set(s.collapsed),
        known: new Set(s.known),
      };
      reconciled.current = new Set(folderPaths);
      skipSave.current = true;
      setCollapsed(new Set(folderPaths.filter(startCollapsed)));
      return;
    }
    const fresh = folderPaths.filter((p) => !reconciled.current.has(p));
    if (fresh.length === 0) return;
    for (const p of fresh) reconciled.current.add(p);
    const toClose = fresh.filter(startCollapsed);
    if (toClose.length === 0) return;
    setCollapsed((prev) => {
      const next = new Set(prev);
      for (const p of toClose) next.add(p);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath, folderPaths]);

  // Remember how the tree was left per repo.
  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    const known = new Set(saved.current?.known ?? []);
    for (const p of reconciled.current) known.add(p);
    try {
      localStorage.setItem(
        TREE_STORE_PREFIX + repoPath,
        JSON.stringify({ collapsed: [...collapsed], known: [...known] }),
      );
    } catch {
      // Storage full or blocked: the tree just forgets, nothing worse.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed]);
  const pinnedRows = useMemo(
    () => rows.filter((r) => actions.pinned.has(r.file.rel_path.toLowerCase())),
    [rows, actions.pinned],
  );

  const toggle = useCallback(
    (path: string) =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      }),
    [],
  );

  // Jumping to a file from "Who has what" must expand its ancestors first.
  const highlighted = actions.highlightedPath;
  useEffect(() => {
    if (!highlighted) return;
    const row = rows.find(
      (r) => r.file.rel_path.toLowerCase() === highlighted,
    );
    if (!row || !row.file.dir) return;
    setCollapsed((prev) => {
      const toOpen = ancestorsOf(row.file.dir).filter((a) => prev.has(a));
      if (toOpen.length === 0) return prev;
      const next = new Set(prev);
      for (const a of toOpen) next.delete(a);
      return next;
    });
  }, [highlighted, rows]);

  return (
    <div className="filetree">
      <div className="filerow filehead">
        <span className="filename">Files</span>
        <span className="size">Size</span>
        <span className="changed">Last changed</span>
        <span className="status">Status</span>
        <span className="actionshead">Actions</span>
      </div>
      {pinnedRows.length > 0 && (
        <div className="pinnedsection">
          <div className="pinnedhead muted small">Pinned</div>
          {pinnedRows.map((row) => (
            <FileRow
              key={`pin-${row.file.rel_path}`}
              row={row}
              actions={actions}
              depth={0}
            />
          ))}
        </div>
      )}
      {pinnedRows.length > 0 && (
        <div className="pinnedhead muted small">All files</div>
      )}
      {tree.files.map((row) => (
        <FileRow key={row.file.rel_path} row={row} actions={actions} depth={0} />
      ))}
      {tree.folders.map((node) => (
        <Folder
          key={node.path}
          node={node}
          depth={0}
          collapsed={collapsed}
          toggle={toggle}
          actions={actions}
          forceExpand={forceExpand}
        />
      ))}
    </div>
  );
});
