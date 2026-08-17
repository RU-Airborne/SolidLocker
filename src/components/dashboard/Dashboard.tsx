import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useQuery } from "@tanstack/react-query";
import {
  connectionState,
  fetchRemote,
  githubSignIn,
  githubSignedIn,
  hideToTray,
  listRepoBranches,
  openFile,
  pushNow,
  quitApp,
  restoreFiles,
  selectExistingRepo,
  switchBranch,
  syncAttributes,
} from "../../api";
import {
  useClaim,
  useFiles,
  useGetLatest,
  useLocks,
  useRelease,
  useRepoStatus,
  useSaveAndShare,
  useSyncAttributes,
} from "../../queries";
import type { AppState, FileEntry, LockStatus } from "../../types";
import { isAppError, isSwTemp } from "../../types";
import type { Lock } from "../../types";
import { copy } from "../../copy";
import { notifyDesktop } from "../../notify";
import {
  playCheckComplete,
  playFileOpenComplete,
  playMateFailed,
  playRebuildComplete,
} from "../../sounds";
import { GlassSelect } from "../common/GlassSelect";
import { RowMenu } from "./RowMenu";
import { OpenUnlockedDialog } from "../dialogs/OpenUnlockedDialog";
import { ClaimDialog } from "../dialogs/ClaimDialog";
import { ExitDialog } from "../dialogs/ExitDialog";
import { SignInDialog } from "../dialogs/SignInDialog";
import { ReleaseDialog } from "../dialogs/ReleaseDialog";
import { SettingsPage } from "../settings/SettingsPage";
import { ProgressPage } from "../progress/ProgressPage";
import { CommitDialog } from "../dialogs/CommitDialog";
import { ConflictDialog } from "../dialogs/ConflictDialog";
import { ForceUnlockDialog } from "../dialogs/ForceUnlockDialog";
import { SetAsideDialog } from "../dialogs/SetAsideDialog";
import { OfflineHelpDialog } from "../dialogs/OfflineHelpDialog";
import { ActivityPanel } from "./ActivityPanel";
import { TopBar } from "./TopBar";
import { FileTree, type SortMode } from "./FileTree";
import { useSwInstalled } from "./FileRow";
import { LocksPanel } from "./LocksPanel";

export interface FileRowData {
  file: FileEntry;
  status: LockStatus;
  /** Modified locally and not yet shared. */
  edited: boolean;
  /** Added to the project recently and not yet looked at. */
  isNew: boolean;
}

export interface RowActions {
  claim: (paths: string[]) => void;
  release: (paths: string[]) => void;
  open: (path: string) => void;
  /** Right-click on a file row. */
  contextMenu: (e: React.MouseEvent, row: FileRowData) => void;
  claimWithRefs: (path: string) => void;
  releaseWithRefs: (path: string) => void;
  toggleWatch: (path: string) => void;
  watched: Set<string>;
  togglePin: (path: string) => void;
  pinned: Set<string>;
  busyPaths: Set<string>;
  highlightedPath: string | null;
}

export function Dashboard({ appState }: { appState: AppState }) {
  const files = useFiles(true);
  const locks = useLocks(true);
  const claim = useClaim();
  const release = useRelease();
  const sync = useSyncAttributes();
  const repoStatus = useRepoStatus(true);
  const getLatestMut = useGetLatest();
  const saveShareMut = useSaveAndShare();
  const [notice, setNoticeState] = useState<{
    text: string;
    warn: boolean;
  } | null>(null);
  const queryClient = useQueryClient();
  const swInstalled = useSwInstalled();

  /** Ordinary news: quiet banner, no sound. */
  function setNotice(text: string | null) {
    setNoticeState(text ? { text, warn: false } : null);
  }

  /** Problems: red banner and SolidWorks' own failure sound. */
  function warn(text: string) {
    playMateFailed();
    setNoticeState({ text, warn: true });
  }

  // Banners dismiss themselves after 8s; the Okie button dismisses sooner.
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(t);
  }, [notice]);

  // Quietly fetch the remote on an interval so `behind` stays accurate.
  const [lastFetchAt, setLastFetchAt] = useState<number | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [fetchIntervalS, setFetchIntervalS] = useState(() => {
    const v = Number(localStorage.getItem("solidlocker.fetchIntervalS"));
    return [30, 60, 120, 300].includes(v) ? v : 60;
  });

  function handleFetchIntervalChange(seconds: number) {
    localStorage.setItem("solidlocker.fetchIntervalS", String(seconds));
    setFetchIntervalS(seconds);
  }

  // Days a claim may sit idle before the release reminder; 0 disables it.
  const [staleDays, setStaleDays] = useState(() => {
    const v = Number(localStorage.getItem("solidlocker.staleDays"));
    return [0, 1, 3, 7].includes(v) && localStorage.getItem("solidlocker.staleDays") !== null
      ? v
      : 3;
  });

  function handleStaleDaysChange(days: number) {
    localStorage.setItem("solidlocker.staleDays", String(days));
    setStaleDays(days);
  }

  // Large file warning threshold in MB; 0 disables it.
  const [bigFileMb, setBigFileMb] = useState(() => {
    const v = Number(localStorage.getItem("solidlocker.bigFileMb"));
    return [0, 5, 25, 50].includes(v) &&
      localStorage.getItem("solidlocker.bigFileMb") !== null
      ? v
      : 5;
  });

  function handleBigFileMbChange(mb: number) {
    localStorage.setItem("solidlocker.bigFileMb", String(mb));
    setBigFileMb(mb);
  }

  // Notify about connection changes; on by default.
  const [notifyConnection, setNotifyConnection] = useState(
    () => localStorage.getItem("solidlocker.notifyConnection") !== "off",
  );

  function handleNotifyConnectionChange(on: boolean) {
    localStorage.setItem("solidlocker.notifyConnection", on ? "on" : "off");
    setNotifyConnection(on);
  }

  // Closing the window keeps SolidLocker running in the tray; on by default.
  // The choice lives in the exit dialog, which stops asking once the user
  // ticks "remember".
  const [closeToTray, setCloseToTray] = useState(
    () => localStorage.getItem("solidlocker.closeToTray") !== "off",
  );
  const [askOnExit, setAskOnExit] = useState(
    () => localStorage.getItem("solidlocker.askOnExit") !== "off",
  );
  const [exitPrompt, setExitPrompt] = useState(false);
  const [offlineHelp, setOfflineHelp] = useState(false);

  useEffect(() => {
    const doFetch = () =>
      fetchRemote()
        .then(() => {
          setLastFetchAt(Date.now());
          setFetchFailed(false);
          queryClient.invalidateQueries({ queryKey: ["repoStatus"] });
          // A fetch can bring in branches teammates just created.
          queryClient.invalidateQueries({ queryKey: ["repoBranches"] });
        })
        // A failed fetch must never look like a successful one.
        .catch(() => setFetchFailed(true));
    doFetch();
    const t = window.setInterval(doFetch, fetchIntervalS * 1000);
    return () => window.clearInterval(t);
  }, [queryClient, fetchIntervalS]);

  function handleFixPerms() {
    sync
      .mutateAsync()
      .then((r) =>
        setNotice(
          copy.permsChecked(
            r.made_writable.length,
            r.made_readonly.length,
            r.anomalies.length,
          ),
        ),
      )
      .catch((e) => warn(String(e)));
  }

  function handleSyncNow() {
    if (syncing) return;
    lastAutoPull.current = 0;
    setSyncing(true);
    fetchRemote()
      .then(() => {
        playCheckComplete();
        setLastFetchAt(Date.now());
        setFetchFailed(false);
        queryClient.invalidateQueries({ queryKey: ["repoStatus"] });
        queryClient.invalidateQueries({ queryKey: ["locks"] });
        queryClient.invalidateQueries({ queryKey: ["files"] });
        queryClient.invalidateQueries({ queryKey: ["repoBranches"] });
        // Only for a sync the user asked for. The 60s poll stays silent.
        // If teammates' changes came in, the auto pull below reports what
        // actually arrived, so do not claim "up to date" over the top of it.
        const behind = repoStatus.data?.behind ?? 0;
        if (behind === 0) setNotice(copy.syncedOk);
      })
      .catch((e) => {
        setFetchFailed(true);
        warn(isAppError(e) ? e.message : copy.offlineRetry);
      })
      .finally(() => setSyncing(false));
  }

  // Auto-sync: when teammates have pushed changes and we have nothing
  // unsaved, pull them in automatically.
  const lastAutoPull = useRef(0);
  useEffect(() => {
    const s = repoStatus.data;
    if (
      !s ||
      s.behind === 0 ||
      s.dirty.some((p) => !isSwTemp(p)) ||
      s.conflicted.length > 0
    )
      return;
    if (getLatestMut.isPending || saveShareMut.isPending) return;
    if (Date.now() - lastAutoPull.current < 30_000) return;
    lastAutoPull.current = Date.now();
    getLatestMut
      .mutateAsync()
      .then((r) => {
        if (r.merged) {
          setNotice(copy.syncedChanges(r.behind_before));
        }
      })
      .catch((e) => {
        if (isAppError(e) && e.code === "CONFLICT") {
          const files = (e.detail as { files?: string[] } | undefined)?.files;
          // Never open the dialog with nothing to resolve.
          if (files && files.length > 0) {
            playMateFailed();
            setConflictFiles(files);
          }
        }
        // Other failures (offline etc.) stay quiet; next cycle retries.
      });
  }, [repoStatus.data, getLatestMut, saveShareMut.isPending]);
  const [busyPaths, setBusyPaths] = useState<Set<string>>(new Set());
  const [claimDialogPath, setClaimDialogPath] = useState<string | null>(null);
  const [releaseDialogPath, setReleaseDialogPath] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const [rowMenu, setRowMenu] = useState<{
    x: number;
    y: number;
    row: FileRowData;
  } | null>(null);
  const [openWarning, setOpenWarning] = useState<{
    path: string;
    lockedByOther: string | null;
  } | null>(null);

  function doOpen(path: string) {
    markSeen(path);
    openFile(path).catch((e) =>
      setNotice(isAppError(e) ? e.message : String(e)),
    );
  }
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [conflictFiles, setConflictFiles] = useState<string[] | null>(null);
  const [highlightedPath, setHighlightedPath] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<"locks" | "activity">("locks");
  const [forceTarget, setForceTarget] = useState<Lock | null>(null);
  const [setAside, setSetAside] = useState<{ branch: string; files: string[] } | null>(
    null,
  );
  const highlightTimer = useRef<number | undefined>(undefined);

  function focusFile(path: string) {
    setHighlightedPath(path.toLowerCase());
    window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(
      () => setHighlightedPath(null),
      2200,
    );
  }
  const lastSyncAt = useRef(0);

  // After every fresh (server-verified) lock refresh, align read-only bits:
  // writable only if claimed by me. Safe to repeat — it never touches files
  // that are modified or claimed, so it can run on every poll.
  useEffect(() => {
    if (!locks.data?.fresh) return;
    if (Date.now() - lastSyncAt.current < 10_000) return;
    lastSyncAt.current = Date.now();
    syncAttributes()
      .then((r) => {
        if (r.made_writable.length > 0 || r.made_readonly.length > 0) {
          queryClient.invalidateQueries({ queryKey: ["files"] });
        }
      })
      .catch(() => {
        lastSyncAt.current = 0;
      });
  }, [locks.dataUpdatedAt, locks.data?.fresh, queryClient]);

  // Right panel width, draggable and remembered.
  const [panelWidth, setPanelWidth] = useState(() => {
    const v = Number(localStorage.getItem("solidlocker.panelWidth"));
    return v >= 220 && v <= 640 ? v : 280;
  });

  function startPanelResize(e: React.PointerEvent) {
    e.preventDefault();
    const onMove = (ev: PointerEvent) => {
      const w = Math.min(640, Math.max(220, window.innerWidth - ev.clientX));
      setPanelWidth(w);
      localStorage.setItem("solidlocker.panelWidth", String(w));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // Pinned files stay at the top of the list, across restarts.
  const [pinned, setPinned] = useState<Set<string>>(() => {
    try {
      return new Set(
        JSON.parse(localStorage.getItem("solidlocker.pinned") ?? "[]") as string[],
      );
    } catch {
      return new Set();
    }
  });

  function togglePin(path: string) {
    setPinned((prev) => {
      const next = new Set(prev);
      const key = path.toLowerCase();
      if (next.has(key)) next.delete(key);
      else next.add(key);
      localStorage.setItem("solidlocker.pinned", JSON.stringify([...next]));
      return next;
    });
  }

  // Search, file-type, and "only my claims" filtering.
  const [searchQuery, setSearchQuery] = useState("");
  const [showOnlyMine, setShowOnlyMine] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"all" | "sldasm" | "sldprt" | "slddrw">(
    "all",
  );

  // Tree sort order, remembered across restarts.
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    const saved = localStorage.getItem("solidlocker.sortMode");
    return saved === "size" || saved === "modified" ? saved : "name";
  });

  function handleSortChange(mode: SortMode) {
    localStorage.setItem("solidlocker.sortMode", mode);
    setSortMode(mode);
  }

  // "Tell me when it's free": watched paths (lowercased) survive restarts.
  const [watched, setWatched] = useState<Set<string>>(() => {
    try {
      return new Set(
        JSON.parse(localStorage.getItem("solidlocker.watched") ?? "[]") as string[],
      );
    } catch {
      return new Set();
    }
  });

  function toggleWatch(path: string) {
    setWatched((prev) => {
      const next = new Set(prev);
      const key = path.toLowerCase();
      if (next.has(key)) next.delete(key);
      else next.add(key);
      localStorage.setItem("solidlocker.watched", JSON.stringify([...next]));
      return next;
    });
  }

  useEffect(() => {
    const l = locks.data;
    if (!l?.fresh || watched.size === 0) return;
    const lockedNow = new Set(
      [...l.ours, ...l.theirs].map((k) => k.path.toLowerCase()),
    );
    const freed = [...watched].filter((p) => !lockedNow.has(p));
    if (freed.length === 0) return;
    setWatched((prev) => {
      const next = new Set(prev);
      for (const f of freed) next.delete(f);
      localStorage.setItem("solidlocker.watched", JSON.stringify([...next]));
      return next;
    });
    const names = freed.map((p) => p.split("/").pop() ?? p);
    for (const name of names) {
      notifyDesktop(copy.freedNotificationTitle, copy.freedNotificationBody(name));
    }
    setNotice(copy.freedFiles(names));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locks.dataUpdatedAt]);

  // Gentle reminder for claims held idle past the user's chosen threshold.
  // Once per app run is enough nagging.
  const staleReminded = useRef(false);
  useEffect(() => {
    if (staleReminded.current || staleDays === 0) return;
    const l = locks.data;
    if (!l?.fresh) return;
    const dirty = new Set(repoStatus.data?.dirty ?? []);
    const cutoff = Date.now() - staleDays * 24 * 60 * 60 * 1000;
    const idle = l.ours.filter(
      (k) =>
        k.locked_at &&
        new Date(k.locked_at).getTime() < cutoff &&
        !dirty.has(k.path),
    );
    if (idle.length > 0) {
      staleReminded.current = true;
      setNotice(copy.staleClaims(idle.map((k) => k.path), staleDays));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locks.dataUpdatedAt, staleDays]);

  // The backend learns our username from the first fresh lock response that
  // contains one of our locks; refresh app state so the avatar appears
  // without a restart.
  useEffect(() => {
    if (appState.username) return;
    const l = locks.data;
    if (l?.fresh && l.ours.length > 0) {
      queryClient.invalidateQueries({ queryKey: ["appState"] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locks.dataUpdatedAt]);

  const lockStatusByPath = useMemo(() => {
    const byPath = new Map<string, LockStatus>();
    for (const lock of locks.data?.ours ?? []) {
      byPath.set(lock.path.toLowerCase(), { kind: "mine", lock });
    }
    for (const lock of locks.data?.theirs ?? []) {
      byPath.set(lock.path.toLowerCase(), { kind: "theirs", lock });
    }
    return byPath;
  }, [locks.data]);

  // "New" badges disappear once a file is opened or edited, or after a week.
  const [seenNew, setSeenNew] = useState<Set<string>>(() => {
    try {
      return new Set(
        JSON.parse(localStorage.getItem("solidlocker.seenNew") ?? "[]") as string[],
      );
    } catch {
      return new Set();
    }
  });

  function markSeen(path: string) {
    setSeenNew((prev) => {
      const key = path.toLowerCase();
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      localStorage.setItem("solidlocker.seenNew", JSON.stringify([...next]));
      return next;
    });
  }

  // Editing a file counts as having looked at it.
  useEffect(() => {
    for (const p of repoStatus.data?.dirty ?? []) markSeen(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoStatus.data?.dirty]);

  const knownPaths = useMemo(
    () => new Set((files.data ?? []).map((f) => f.rel_path.toLowerCase())),
    [files.data],
  );


  const rows: FileRowData[] = useMemo(() => {
    const dirty = new Set(repoStatus.data?.dirty ?? []);
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return (files.data ?? []).map((file) => ({
      file,
      status:
        lockStatusByPath.get(file.rel_path.toLowerCase()) ?? { kind: "unlocked" },
      edited: dirty.has(file.rel_path),
      isNew:
        file.added > weekAgo &&
        !seenNew.has(file.rel_path.toLowerCase()) &&
        !dirty.has(file.rel_path),
    }));
  }, [files.data, lockStatusByPath, repoStatus.data, seenNew]);

  const visibleRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (showOnlyMine && r.status.kind !== "mine") return false;
      if (
        typeFilter !== "all" &&
        !r.file.rel_path.toLowerCase().endsWith(`.${typeFilter}`)
      )
        return false;
      if (q && !r.file.rel_path.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, searchQuery, showOnlyMine, typeFilter]);

  const myClaimCount = locks.data?.ours.length ?? 0;

  // The "You hold N" filter chip only shows while you hold files. If you unlock
  // your last one with the filter on, the chip vanishes but the filter would
  // stay active and leave the list stuck empty, so turn it off.
  useEffect(() => {
    if (showOnlyMine && myClaimCount === 0) setShowOnlyMine(false);
  }, [showOnlyMine, myClaimCount]);

  const sizeByPath = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of files.data ?? []) m.set(f.rel_path, f.size);
    return m;
  }, [files.data]);

  /** Dirty files that no longer exist on disk are deletions. */
  const deletedPaths = useMemo(
    () =>
      new Set(
        (files.data ?? []).filter((f) => f.deleted).map((f) => f.rel_path),
      ),
    [files.data],
  );

  // Closing the window: ask once (then remember), hide to the tray so
  // protection keeps running, or quit outright.
  const askOnExitRef = useRef(askOnExit);
  askOnExitRef.current = askOnExit;
  const closeToTrayRef = useRef(closeToTray);
  closeToTrayRef.current = closeToTray;
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    // The listener arrives asynchronously. Without this flag a fast
    // unmount/remount (React strict mode, hot reload) loses the handle and
    // leaks a listener, so an old handler keeps hiding the window while the
    // new one opens the dialog.
    let disposed = false;
    getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (disposed) return;
        if (askOnExitRef.current) {
          event.preventDefault();
          // Make sure the window is up front, so the question can't be
          // answered blind behind other windows.
          const w = getCurrentWindow();
          await w.show();
          await w.unminimize();
          await w.setFocus();
          setExitPrompt(true);
          return;
        }
        if (closeToTrayRef.current) {
          event.preventDefault();
          // Tear the window down rather than hiding it: that lets the webview
          // processes exit, so sitting in the tray costs a fraction of the
          // memory. The tray icon rebuilds the window on demand.
          await hideToTray();
          return;
        }
        event.preventDefault();
        await quitApp();
      })
      .then((u) => {
        unlisten = u;
        if (disposed) u();
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Keyboard shortcuts. Ctrl+Z has no meaning here, so it gets the sound
  // every SolidWorks user knows.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setProgressOpen(false);
        setSettingsOpen(false);
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        setCommitDialogOpen(true);
        return;
      }
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        playMateFailed();
        setNotice("Mate failed... Wait, what? This isn't SolidWorks.");
        return;
      }
      if (e.key === "Escape") {
        if (rowMenu) return setRowMenu(null);
        if (offlineHelp) return setOfflineHelp(false);
        if (openWarning) return setOpenWarning(null);
        if (claimDialogPath) return setClaimDialogPath(null);
        if (releaseDialogPath) return setReleaseDialogPath(null);
        if (commitDialogOpen) return setCommitDialogOpen(false);
        if (progressOpen) return setProgressOpen(false);
        if (settingsOpen) return setSettingsOpen(false);
        if (searchQuery) return setSearchQuery("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    rowMenu,
    offlineHelp,
    openWarning,
    claimDialogPath,
    releaseDialogPath,
    commitDialogOpen,
    progressOpen,
    settingsOpen,
    searchQuery,
  ]);

  const closeBehavior: "ask" | "tray" | "quit" = askOnExit
    ? "ask"
    : closeToTray
      ? "tray"
      : "quit";

  function handleCloseBehaviorChange(mode: "ask" | "tray" | "quit") {
    const ask = mode === "ask";
    const tray = mode !== "quit";
    localStorage.setItem("solidlocker.askOnExit", ask ? "on" : "off");
    localStorage.setItem("solidlocker.closeToTray", tray ? "on" : "off");
    setAskOnExit(ask);
    setCloseToTray(tray);
  }

  function rememberExitChoice(toTray: boolean, remember: boolean) {
    localStorage.setItem("solidlocker.closeToTray", toTray ? "on" : "off");
    setCloseToTray(toTray);
    if (remember) {
      localStorage.setItem("solidlocker.askOnExit", "off");
      setAskOnExit(false);
    }
  }


  function withBusy(paths: string[], fn: () => Promise<void>) {
    setBusyPaths((prev) => new Set([...prev, ...paths]));
    fn().finally(() => {
      setBusyPaths((prev) => {
        const next = new Set(prev);
        for (const p of paths) next.delete(p);
        return next;
      });
    });
  }

  // Referentially stable so the memoized FileTree/FileRow components only
  // re-render when something a row actually shows has changed. The handlers
  // close over state setters and mutateAsync, which React keeps stable.
  const actions: RowActions = useMemo(() => ({
    busyPaths,
    highlightedPath,
    open: (path) => {
      // Opening a file you have not locked is the classic way to lose work.
      const status = lockStatusByPath.get(path.toLowerCase());
      const isFile = /\.[a-z0-9]+$/i.test(path);
      if (isFile && status?.kind !== "mine") {
        setOpenWarning({
          path,
          lockedByOther:
            status?.kind === "theirs"
              ? (status.lock.owner?.name ?? "another member")
              : null,
        });
        return;
      }
      doOpen(path);
    },
    contextMenu: (e, row) => {
      e.preventDefault();
      setRowMenu({ x: e.clientX, y: e.clientY, row });
    },
    claimWithRefs: (path) => setClaimDialogPath(path),
    releaseWithRefs: (path) => setReleaseDialogPath(path),
    toggleWatch,
    watched,
    togglePin,
    pinned,
    claim: (paths) =>
      withBusy(paths, async () => {
        setNotice(null);
        try {
          const result = await claim.mutateAsync(paths);
          if (result.failed.length > 0) {
            const held = result.failed
              .slice(0, 4)
              .map(
                (f) =>
                  `${f.path.split("/").pop()}${f.owner ? ` (${f.owner})` : ""}`,
              )
              .join(", ");
            const more =
              result.failed.length > 4
                ? ` and ${result.failed.length - 4} more`
                : "";
            warn(
              copy.claimPartial(
                result.claimed.length,
                paths.length,
                `${held}${more}`,
              ),
            );
          }
        } catch (e) {
          setNotice(String(e));
        }
      }),
    release: (paths) =>
      withBusy(paths, async () => {
        setNotice(null);
        try {
          const outcomes = await release.mutateAsync(paths);
          const blocked = outcomes.filter((o) => !o.ok);
          if (blocked.length > 0) {
            const released = outcomes.length - blocked.length;
            const first = `${blocked[0].path.split("/").pop()}: ${blocked[0].message}`;
            warn(
              copy.releasePartial(
                released,
                outcomes.length,
                first,
                blocked.length - 1,
              ),
            );
          }
        } catch (e) {
          setNotice(String(e));
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [busyPaths, highlightedPath, watched, pinned, lockStatusByPath]);

  function handleSaveShare(message: string, paths: string[]) {
    saveShareMut
      .mutateAsync({ message, paths })
      .then(() => {
        playRebuildComplete();
        setCommitDialogOpen(false);
        setNotice(copy.sharedOk);
      })
      .catch((e) => warn(isAppError(e) ? e.message : String(e)));
  }

  const branches = useQuery({
    queryKey: ["repoBranches"],
    queryFn: listRepoBranches,
    staleTime: 5 * 60_000,
  });
  const currentBranch = repoStatus.data?.branch ?? appState.repo!.branch;

  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [stuckFiles, setStuckFiles] = useState<string[] | null>(null);

  function handleFixStuck() {
    if (!stuckFiles) return;
    restoreFiles(stuckFiles)
      .then(() => {
        setStuckFiles(null);
        setNotice(copy.stuckFixed);
        queryClient.invalidateQueries();
      })
      .catch((e) => warn(isAppError(e) ? e.message : String(e)));
  }

  async function handleSwitchBranch(name: string) {
    if (!name || name === currentBranch || switchingTo) return;
    setNotice(null);
    setSwitchingTo(name);
    try {
      const result = await switchBranch(name);
      queryClient.invalidateQueries();
      if (result.stuck_files.length > 0) {
        playMateFailed();
        setStuckFiles(result.stuck_files);
      } else {
        // The whole document set just swapped underneath you.
        playFileOpenComplete();
        setNotice(copy.switchedBranch(name));
      }
    } catch (e) {
      if (isAppError(e) && e.code === "NEEDS_COMMIT") {
        setCommitDialogOpen(true);
      } else if (isAppError(e) && e.code === "UNTRACKED_COLLISION") {
        const detail = e.detail as { files?: string[]; branch?: string } | undefined;
        setSetAside({ branch: detail?.branch ?? name, files: detail?.files ?? [] });
      } else {
        warn(isAppError(e) ? e.message : String(e));
      }
    } finally {
      setSwitchingTo(null);
    }
  }

  async function handleSwitchRepo() {
    const dir = await open({
      directory: true,
      title: "Select the repository folder SolidLocker should manage",
    });
    if (typeof dir !== "string") return;
    try {
      await selectExistingRepo(dir);
      queryClient.invalidateQueries();
    } catch (e) {
      setNotice(isAppError(e) ? e.message : String(e));
    }
  }

  function handlePushOnly() {
    setNotice(null);
    pushNow()
      .then(() => setNotice(copy.sharedOk))
      .catch((e) => warn(isAppError(e) ? e.message : String(e)));
  }

  const stale = locks.data ? !locks.data.fresh : false;
  const offline = locks.isError || fetchFailed;

  // First run check GitHub credentials once
  const [signInPrompt, setSignInPrompt] = useState(false);
  const [checkingSignIn, setCheckingSignIn] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [connState, setConnState] = useState<
    "ok" | "signed_out" | "offline" | null
  >(null);
  const signInChecked = useRef(false);
  useEffect(() => {
    if (signInChecked.current) return;
    signInChecked.current = true;
    githubSignedIn()
      .then((ok) => {
        if (!ok) setSignInPrompt(true);
        // Already signed in: the check just cached our login, so refetch the
        // app state to fill in the profile name and picture.
        else queryClient.invalidateQueries({ queryKey: ["appState"] });
      })
      .catch(() => {});
  }, []);

  function recheckSignIn() {
    setCheckingSignIn(true);
    githubSignedIn()
      .then((ok) => {
        if (ok) {
          setSignInPrompt(false);
          setNotice("Signed in to GitHub.");
          queryClient.invalidateQueries();
        }
      })
      .catch((e) => warn(isAppError(e) ? e.message : String(e)))
      .finally(() => setCheckingSignIn(false));
  }

  // Same flow as the Sign in button on the profile page: open the credential
  // manager's browser sign in, then refresh everything that was blocked.
  function handleSignIn() {
    setSigningIn(true);
    githubSignIn()
      .then((ok) => {
        queryClient.invalidateQueries();
        if (ok) {
          setSignInPrompt(false);
          setNotice("Signed in to GitHub.");
          // Re-check the connection right away so the warning banner clears
          // now, instead of lingering until the next background poll.
          fetchRemote()
            .then(() => setFetchFailed(false))
            .catch(() => setFetchFailed(true));
        }
      })
      .catch((e) => warn(isAppError(e) ? e.message : String(e)))
      .finally(() => setSigningIn(false));
  }

  // A branch without locking rules cannot protect anything
  const lockableOk = appState.repo!.lockable_ok;
  useEffect(() => {
    if (!lockableOk) playMateFailed();
  }, [lockableOk]);

  // Announce connection changes once per transition.
  const wasOffline = useRef<boolean | null>(null);
  useEffect(() => {
    const previous = wasOffline.current;
    wasOffline.current = offline;
    if (previous === null || previous === offline) return;
    if (offline) playMateFailed();
    else playCheckComplete();
    if (!notifyConnection) return;
    if (offline) {
      notifyDesktop(copy.offlineNotificationTitle, copy.offlineNotificationBody);
    } else {
      notifyDesktop(copy.onlineNotificationTitle, copy.onlineNotificationBody);
      setNotice(copy.onlineNotificationBody);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offline, notifyConnection]);

  // When the warning banner is up, ask the backend WHY GitHub is unreachable,
  // so it can say "you are signed out" instead of "check your connection".
  useEffect(() => {
    if (!(offline || stale)) {
      setConnState(null);
      return;
    }
    let cancelled = false;
    connectionState()
      .then((s) => !cancelled && setConnState(s))
      .catch(() => !cancelled && setConnState("offline"));
    return () => {
      cancelled = true;
    };
  }, [offline, stale]);
  const signedOut = connState === "signed_out";

  const updating = getLatestMut.isPending || saveShareMut.isPending;

  return (
    <div className="app">
      <TopBar
        appState={appState}
        branches={branches.data}
        currentBranch={currentBranch}
        onSwitchBranch={handleSwitchBranch}
        switchingTo={switchingTo}
        onSwitchRepo={handleSwitchRepo}
        status={repoStatus.data}
        lastFetchAt={lastFetchAt}
        offline={offline}
        stale={stale}
        onSyncNow={handleSyncNow}
        syncing={syncing}
        onSaveShare={() => setCommitDialogOpen(true)}
        onPushOnly={handlePushOnly}
        fetchIntervalS={fetchIntervalS}
        updating={updating}
        myClaimCount={myClaimCount}
        mineActive={showOnlyMine}
        onToggleMine={() => setShowOnlyMine((v) => !v)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenProgress={() => setProgressOpen(true)}
      />
      {stuckFiles && stuckFiles.length > 0 && (
        <div className="notice warn">
          <span>{copy.stuckFiles(stuckFiles)}</span>
          <button className="notice-ok" onClick={handleFixStuck}>
            Fix now
          </button>
        </div>
      )}
      {signedOut ? (
        <div className="notice warn">
          <span>{copy.notSignedIn}</span>
          <button className="notice-ok" onClick={() => setSignInPrompt(true)}>
            Sign in
          </button>
        </div>
      ) : offline ? (
        <div className="notice warn">
          <span>{copy.checkConnection} {copy.offlineStillWorking}</span>
          <button className="notice-ok" onClick={() => setOfflineHelp(true)}>
            Show me how
          </button>
        </div>
      ) : stale ? (
        <div className="notice warn">
          <span>{copy.cantVerifyClaims}</span>
        </div>
      ) : null}
      {!appState.repo!.lockable_ok && (
        <div className="notice warn">
          <span>{copy.noLockingRules}</span>
        </div>
      )}
      {notice && (
        <div className={`notice${notice.warn ? " warn" : ""}`}>
          <span>{notice.text}</span>
          <button className="notice-ok" onClick={() => setNotice(null)}>
            Okie
          </button>
        </div>
      )}
      {rowMenu && (
        <RowMenu
          x={rowMenu.x}
          y={rowMenu.y}
          onClose={() => setRowMenu(null)}
          items={[
            ...(rowMenu.row.status.kind === "unlocked"
              ? [
                  {
                    label: "Lock",
                    onClick: () => actions.claim([rowMenu.row.file.rel_path]),
                  },
                  ...(/\.(sldasm|slddrw)$/i.test(rowMenu.row.file.rel_path)
                    ? [
                        {
                          label: "Lock with parts",
                          onClick: () =>
                            setClaimDialogPath(rowMenu.row.file.rel_path),
                        },
                      ]
                    : []),
                ]
              : []),
            ...(rowMenu.row.status.kind === "mine"
              ? [
                  {
                    label: "Unlock",
                    onClick: () => actions.release([rowMenu.row.file.rel_path]),
                  },
                  ...(/\.(sldasm|slddrw)$/i.test(rowMenu.row.file.rel_path)
                    ? [
                        {
                          label: "Unlock with parts",
                          onClick: () =>
                            setReleaseDialogPath(rowMenu.row.file.rel_path),
                        },
                      ]
                    : []),
                ]
              : []),
            ...(rowMenu.row.status.kind === "theirs"
              ? [
                  {
                    label: watched.has(
                      rowMenu.row.file.rel_path.toLowerCase(),
                    )
                      ? "Stop notifying when free"
                      : "Notify when free",
                    onClick: () => toggleWatch(rowMenu.row.file.rel_path),
                  },
                ]
              : []),
            {
              label: "Open in SolidWorks",
              onClick: () => actions.open(rowMenu.row.file.rel_path),
            },
            {
              label: "Show in Explorer",
              onClick: () => doOpen(rowMenu.row.file.dir),
            },
            {
              label: pinned.has(rowMenu.row.file.rel_path.toLowerCase())
                ? "Unpin"
                : "Pin to top",
              onClick: () => togglePin(rowMenu.row.file.rel_path),
            },
            {
              label: "Copy path",
              onClick: () => {
                navigator.clipboard
                  ?.writeText(rowMenu.row.file.rel_path)
                  .then(() => setNotice("Path copied."))
                  .catch(() => warn("Could not copy the path."));
              },
            },
          ]}
        />
      )}
      {openWarning && (
        <OpenUnlockedDialog
          path={openWarning.path}
          lockedByOther={openWarning.lockedByOther}
          swInstalled={swInstalled}
          onCancel={() => setOpenWarning(null)}
          onOpenAnyway={() => {
            const p = openWarning.path;
            setOpenWarning(null);
            doOpen(p);
          }}
          onLockAndOpen={() => {
            const p = openWarning.path;
            setOpenWarning(null);
            withBusy([p], async () => {
              const result = await claim.mutateAsync([p]);
              if (result.claimed.length > 0) doOpen(p);
              else warn(copy.claimPartial(0, 1, p.split("/").pop() ?? p));
            });
          }}
        />
      )}
      {offlineHelp && <OfflineHelpDialog onClose={() => setOfflineHelp(false)} />}
      {signInPrompt && (
        <SignInDialog
          checking={checkingSignIn}
          signingIn={signingIn}
          onSignIn={handleSignIn}
          onCheckAgain={recheckSignIn}
          onClose={() => setSignInPrompt(false)}
        />
      )}
      {exitPrompt && (
        <ExitDialog
          heldCount={myClaimCount}
          onCancel={() => setExitPrompt(false)}
          onStayInTray={(remember) => {
            setExitPrompt(false);
            rememberExitChoice(true, remember);
            hideToTray();
          }}
          onQuit={(remember) => {
            setExitPrompt(false);
            rememberExitChoice(false, remember);
            quitApp();
          }}
        />
      )}
      <div className="stage">
      <div className="body">
        <main className="content">
          <div className="treetoolbar">
            <GlassSelect
              className="sortselect"
              title="Sort files and folders"
              ariaLabel="Sort files and folders"
              value={sortMode}
              onChange={(v) => handleSortChange(v as SortMode)}
              options={[
                { value: "name", label: "Sort: A to Z" },
                { value: "size", label: "Sort: Biggest first" },
                { value: "modified", label: "Sort: Recently changed" },
              ]}
            />
            <div className="typefilter">
              {(
                [
                  ["all", "All"],
                  ["sldasm", "Assemblies"],
                  ["sldprt", "Parts"],
                  ["slddrw", "Drawings"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  className={typeFilter === value ? "active" : ""}
                  onClick={() => setTypeFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="spacer" />
            <input
              ref={searchRef}
              className="treesearch"
              placeholder="Search files…  (Ctrl+F)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {(searchQuery !== "" || showOnlyMine || typeFilter !== "all") && (
              <button
                className="linkish"
                onClick={() => {
                  setSearchQuery("");
                  setShowOnlyMine(false);
                  setTypeFilter("all");
                }}
              >
                Clear
              </button>
            )}
          </div>
          {files.isLoading ? (
            <p className="muted">Verifying references…</p>
          ) : files.isError ? (
            <p className="error">Could not list files: {String(files.error)}</p>
          ) : rows.length === 0 ? (
            <p className="muted">No lockable CAD files found in this repository.</p>
          ) : visibleRows.length === 0 ? (
            <p className="muted">No files match.</p>
          ) : (
            <FileTree
              rows={visibleRows}
              actions={actions}
              sort={sortMode}
              forceExpand={
                searchQuery.trim() !== "" || showOnlyMine || typeFilter !== "all"
              }
            />
          )}
        </main>
        <div
          className="panelresizer"
          onPointerDown={startPanelResize}
          title="Drag to resize"
        />
        <aside className="branchpanel" style={{ width: panelWidth }}>
          <div className="paneltabs">
            <button
              className={panelTab === "locks" ? "active" : ""}
              onClick={() => setPanelTab("locks")}
            >
              Who has what
            </button>
            <button
              className={panelTab === "activity" ? "active" : ""}
              onClick={() => setPanelTab("activity")}
            >
              Activity
            </button>
          </div>
          {panelTab === "locks" ? (
            <LocksPanel
              locks={locks.data}
              lockError={
                locks.isError
                  ? isAppError(locks.error)
                    ? locks.error.message
                    : String(locks.error)
                  : null
              }
              knownPaths={knownPaths}
              onSelectFile={focusFile}
              onForceRelease={setForceTarget}
            />
          ) : (
            <ActivityPanel knownPaths={knownPaths} onSelectFile={focusFile} />
          )}
        </aside>
      </div>
      {(progressOpen || settingsOpen) && (
        <div className="glasspage">
          {progressOpen ? (
            <ProgressPage rows={rows} onClose={() => setProgressOpen(false)} />
          ) : (
            <SettingsPage
              appState={appState}
              fetchIntervalS={fetchIntervalS}
              onFetchIntervalChange={handleFetchIntervalChange}
              staleDays={staleDays}
              onStaleDaysChange={handleStaleDaysChange}
              bigFileMb={bigFileMb}
              onBigFileMbChange={handleBigFileMbChange}
              notifyConnection={notifyConnection}
              onNotifyConnectionChange={handleNotifyConnectionChange}
              closeBehavior={closeBehavior}
              onCloseBehaviorChange={handleCloseBehaviorChange}
              onFixPerms={() => {
                setSettingsOpen(false);
                handleFixPerms();
              }}
              onRepoChanged={(message) => {
                setSettingsOpen(false);
                setNotice(message);
                queryClient.invalidateQueries();
              }}
              onClose={() => setSettingsOpen(false)}
            />
          )}
        </div>
      )}
      </div>
      {commitDialogOpen && (
        <CommitDialog
          dirtyFiles={[
            ...(repoStatus.data?.dirty ?? []),
            ...(repoStatus.data?.untracked ?? []),
          ]}
          sizeByPath={sizeByPath}
          deletedPaths={deletedPaths}
          lockedByMe={
            new Set((locks.data?.ours ?? []).map((l) => l.path.toLowerCase()))
          }
          bigFileMb={bigFileMb}
          saving={saveShareMut.isPending}
          onSave={handleSaveShare}
          onClose={() => setCommitDialogOpen(false)}
        />
      )}
      {conflictFiles && (
        <ConflictDialog
          files={conflictFiles}
          onDone={(msg) => {
            setConflictFiles(null);
            setNotice(msg);
            repoStatus.refetch();
          }}
        />
      )}
      {setAside && (
        <SetAsideDialog
          branch={setAside.branch}
          files={setAside.files}
          onDone={(msg) => {
            setSetAside(null);
            setNotice(msg);
            queryClient.invalidateQueries();
          }}
          onClose={() => setSetAside(null)}
        />
      )}
      {forceTarget && (
        <ForceUnlockDialog
          lock={forceTarget}
          onDone={(msg) => {
            setForceTarget(null);
            setNotice(msg);
            queryClient.invalidateQueries({ queryKey: ["locks"] });
            queryClient.invalidateQueries({ queryKey: ["files"] });
          }}
          onClose={() => setForceTarget(null)}
        />
      )}
      {claimDialogPath && (
        <ClaimDialog
          startPath={claimDialogPath}
          lockStatusByPath={lockStatusByPath}
          onClaim={(paths) => {
            setClaimDialogPath(null);
            actions.claim(paths);
          }}
          onClose={() => setClaimDialogPath(null)}
        />
      )}
      {releaseDialogPath && (
        <ReleaseDialog
          startPath={releaseDialogPath}
          lockStatusByPath={lockStatusByPath}
          onRelease={(paths) => {
            setReleaseDialogPath(null);
            actions.release(paths);
          }}
          onClose={() => setReleaseDialogPath(null)}
        />
      )}
    </div>
  );
}
