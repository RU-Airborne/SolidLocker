import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useQuery } from "@tanstack/react-query";
import {
  isSwitching,
  listRepoBranches,
  getOpenDocuments,
  openFile,
  pushNow,
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
import { isAppError } from "../../types";
import type { Lock } from "../../types";
import { copy } from "../../copy";
import { notifyDesktop } from "../../notify";
import { read, useChoice, useFlag, usePathSet, usePersisted, write } from "../../persist";
import { useExitBehavior } from "../../exit";
import { useShortcuts } from "../../shortcuts";
import { useSignIn } from "../../signin";
import { useSync } from "../../sync";
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
import { ReleaseAllDialog } from "../dialogs/ReleaseAllDialog";
import DialLogo from "../DialLogo";
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
  /** Report an outcome from a row-level dialog and refresh what it changed. */
  notify: (text: string) => void;
}

export function Dashboard({ appState }: { appState: AppState }) {
  const files = useFiles(true);
  const locks = useLocks(true);
  const claim = useClaim();
  const release = useRelease();
  const perms = useSyncAttributes();
  const repoStatus = useRepoStatus(true);
  const getLatestMut = useGetLatest();
  const saveShareMut = useSaveAndShare();
  const [notice, setNoticeState] = useState<{
    text: string;
    warn: boolean;
  } | null>(null);
  const queryClient = useQueryClient();
  const swInstalled = useSwInstalled();

  // A branch switch rewrites every file in the project. Nothing else may run
  // against the worktree while it does. The backend enforces that, and the
  // UI blocks interaction so clicks do not queue up and land on a project
  // that changed underneath them.
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [stuckFiles, setStuckFiles] = useState<string[] | null>(null);
  // Closing to the tray destroys the window, so a switch can outlive the UI
  // that started it. A rebuilt window has no memory of one and must ask.
  const backendSwitching = useQuery({
    queryKey: ["isSwitching"],
    queryFn: isSwitching,
    refetchInterval: (query) => (query.state.data === true ? 1000 : false),
  });
  const switching = switchingTo !== null || backendSwitching.data === true;

  /** Ordinary news: quiet banner, no sound. */
  function setNotice(text: string | null) {
    setNoticeState(text ? { text, warn: false } : null);
  }

  /** Problems: red banner and SolidWorks' own failure sound. */
  function warn(text: string) {
    playMateFailed();
    setNoticeState({ text, warn: true });
  }

  function succeed(text: string) {
    playCheckComplete();
    setNoticeState({ text, warn: false });
  }

  // Banners dismiss themselves after 8s; the Okie button dismisses sooner.
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(t);
  }, [notice]);

  // Quietly fetch the remote on an interval so `behind` stays accurate.
  // Keeping up with the team: the interval fetch and the automatic pull.
  // sync.ts owns both, and the rules about when a pull is safe.
  const [conflictFiles, setConflictFiles] = useState<string[] | null>(null);
  const sync = useSync({
    paused: switching,
    status: repoStatus.data,
    pullLatest: getLatestMut.mutateAsync,
    busy: getLatestMut.isPending || saveShareMut.isPending,
    onNotice: setNotice,
    onWarn: warn,
    onConflict: setConflictFiles,
  });

  // Days a claim may sit idle before the release reminder; 0 disables it.
  const [staleDays, handleStaleDaysChange] = useChoice("staleDays", [0, 1, 3, 7], 3);

  // Large file warning threshold in MB; 0 disables it.
  const [bigFileMb, handleBigFileMbChange] = useChoice("bigFileMb", [0, 5, 25, 50], 5);

  // Notify about connection changes; on by default.
  const [notifyConnection, handleNotifyConnectionChange] = useFlag("notifyConnection");

  // Closing the window keeps SolidLocker running in the tray by default. The
  // choice lives in the exit dialog, which stops asking once "remember" is
  // ticked; exit.ts owns the whole arrangement.
  const exit = useExitBehavior();
  const [offlineHelp, setOfflineHelp] = useState(false);

  function handleFixPerms() {
    perms
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

  const [busyPaths, setBusyPaths] = useState<Set<string>>(new Set());
  const [claimDialogPath, setClaimDialogPath] = useState<string | null>(null);
  const [releaseDialogPath, setReleaseDialogPath] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [releaseAllOpen, setReleaseAllOpen] = useState(false);
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
  // writable only if claimed by me. Safe to repeat, since it never touches files
  // that are modified or claimed, so it can run on every poll.
  useEffect(() => {
    if (!locks.data?.fresh) return;
    // Read-only bits are meaningless mid-switch: git is replacing the files
    // they belong to. The next poll after the switch puts them right.
    if (switching) return;
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
  }, [locks.dataUpdatedAt, locks.data?.fresh, queryClient, switching]);

  // Right panel width, draggable and remembered.
  const [panelWidth, setPanelWidth] = useState(() => {
    const v = Number(read("panelWidth"));
    return v >= 220 && v <= 640 ? v : 280;
  });

  function startPanelResize(e: React.PointerEvent) {
    e.preventDefault();
    const onMove = (ev: PointerEvent) => {
      const w = Math.min(640, Math.max(220, window.innerWidth - ev.clientX));
      setPanelWidth(w);
      write("panelWidth", String(w));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // Pinned files stay at the top of the list, across restarts.
  // Every stored preference in this file used to be its own state + handler
  // pair with the key spelled out inline, nine times over. persist.ts holds
  // the shape now; this was the last of them:
  //
  // const [pinned, setPinned] = useState<Set<string>>(() => {
  //   try {
  //     return new Set(
  //       JSON.parse(localStorage.getItem("solidlocker.pinned") ?? "[]") as string[],
  //     );
  //   } catch {
  //     return new Set();
  //   }
  // });
  //
  // function togglePin(path: string) {
  //   setPinned((prev) => {
  //     const next = new Set(prev);
  //     const key = path.toLowerCase();
  //     if (next.has(key)) next.delete(key);
  //     else next.add(key);
  //     localStorage.setItem("solidlocker.pinned", JSON.stringify([...next]));
  //     return next;
  //   });
  // }
  const [pinned, togglePin] = usePathSet("pinned");

  // Search, file-type, and "only my claims" filtering.
  const [searchQuery, setSearchQuery] = useState("");
  const [showOnlyMine, setShowOnlyMine] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"all" | "sldasm" | "sldprt" | "slddrw">(
    "all",
  );

  // Tree sort order, remembered across restarts.
  const [sortMode, handleSortChange] = usePersisted<SortMode>(
    "sortMode",
    (raw) => (raw === "size" || raw === "modified" ? raw : "name"),
    (mode) => mode,
  );

  // "Tell me when it's free": watched paths (lowercased) survive restarts.
  const [watched, toggleWatch, editWatched] = usePathSet("watched");

  useEffect(() => {
    const l = locks.data;
    if (!l?.fresh || watched.size === 0) return;
    const lockedNow = new Set(
      [...l.ours, ...l.theirs].map((k) => k.path.toLowerCase()),
    );
    const freed = [...watched].filter((p) => !lockedNow.has(p));
    if (freed.length === 0) return;
    editWatched((next) => {
      for (const f of freed) next.delete(f);
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
  const [seenNew, , editSeen] = usePathSet("seenNew");

  function markSeen(path: string) {
    editSeen((next) => next.add(path.toLowerCase()));
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

  const openDocs = useQuery({
    queryKey: ["openDocuments"],
    queryFn: getOpenDocuments,
    enabled: swInstalled,
    refetchInterval: 30_000,
  });

  const seenTheirLocks = useRef<Set<string> | null>(null);
  useEffect(() => {
    const theirs = locks.data?.theirs;
    if (!theirs) return;
    const now = new Set(theirs.map((l) => l.path.toLowerCase()));
    const before = seenTheirLocks.current;
    seenTheirLocks.current = now;
    if (!before) return; // first read is the baseline, not news

    const open = new Set((openDocs.data ?? []).map((p) => p.toLowerCase()));
    if (open.size === 0) return;
    for (const lock of theirs) {
      const key = lock.path.toLowerCase();
      if (before.has(key) || !open.has(key)) continue;
      warn(copy.lockedWhileOpen(lock.path.split("/").pop() ?? lock.path, lock.owner?.name ?? null));
      break; // one banner is enough; the panel lists the rest
    }
  }, [locks.data, openDocs.data]);

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

  // Ctrl+Z has no meaning here, so it gets the sound every SolidWorks user
  // knows. Escape closes whatever is on top, so the list is ordered by depth.
  const searchRef = useRef<HTMLInputElement>(null);
  useShortcuts({
    find: () => {
      setProgressOpen(false);
      setSettingsOpen(false);
      searchRef.current?.focus();
      searchRef.current?.select();
    },
    save: () => setCommitDialogOpen(true),
    undo: () => {
      playMateFailed();
      setNotice("Mate failed... Wait, what? This isn't SolidWorks.");
    },
    layers: [
      [!!rowMenu, () => setRowMenu(null)],
      [offlineHelp, () => setOfflineHelp(false)],
      [!!openWarning, () => setOpenWarning(null)],
      [!!claimDialogPath, () => setClaimDialogPath(null)],
      [!!releaseDialogPath, () => setReleaseDialogPath(null)],
      [commitDialogOpen, () => setCommitDialogOpen(false)],
      [progressOpen, () => setProgressOpen(false)],
      [settingsOpen, () => setSettingsOpen(false)],
      [searchQuery !== "", () => setSearchQuery("")],
    ],
  });


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
    notify: (text) => {
      succeed(text);
      void queryClient.invalidateQueries({ queryKey: ["files"] });
      void queryClient.invalidateQueries({ queryKey: ["repoStatus"] });
    },
    claimWithRefs: (path) => setClaimDialogPath(path),
    releaseWithRefs: (path) => setReleaseDialogPath(path),
    toggleWatch,
    watched,
    togglePin,
    pinned,
    claim: (paths) => {
      if (switching) return;
      withBusy(paths, async () => {
        setNotice(null);
        try {
          const result = await claim.mutateAsync(paths);
          if (result.failed.length === 0) {
            succeed(copy.claimedOk(result.claimed));
          } else if (result.rolled_back) {
            const f = result.failed[0];
            warn(copy.claimRolledBack(f.path.split("/").pop() ?? f.path, f.owner));
          } else {
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
      });
    },
    release: (paths) => {
      if (switching) return;
      withBusy(paths, async () => {
        setNotice(null);
        try {
          const outcomes = await release.mutateAsync(paths);
          const blocked = outcomes.filter((o) => !o.ok);
          if (blocked.length === 0) {
            succeed(copy.releasedOk(outcomes.map((o) => o.path)));
          } else {
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
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [busyPaths, highlightedPath, watched, pinned, lockStatusByPath, switching]);

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
      // Files written while the switch ran still hold unsaved work. They were
      // deliberately left alone, and saying so matters more than the switch.
      if (result.kept_files.length > 0) {
        warn(copy.keptDuringSwitch(result.kept_files));
        if (result.stuck_files.length > 0) setStuckFiles(result.stuck_files);
      } else if (result.stuck_files.length > 0) {
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
  const offline = locks.isError || sync.failed;

  // The GitHub sign in, and the "why can't we reach GitHub" probe that tells
  // a signed out member apart from an offline one. signin.ts owns both.
  const signin = useSignIn(offline || stale, setNotice, warn, (ok) =>
    sync.setFailed(!ok),
  );

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
  }, [offline, notifyConnection]);

  const updating = getLatestMut.isPending || saveShareMut.isPending;
  const locking = claim.isPending || release.isPending;

  return (
    <div className="app">
      <TopBar
        appState={appState}
        branches={branches.data}
        currentBranch={currentBranch}
        onSwitchBranch={handleSwitchBranch}
        switchingTo={switchingTo}
        locking={locking}
        onSwitchRepo={handleSwitchRepo}
        status={repoStatus.data}
        lastFetchAt={sync.lastFetchAt}
        offline={offline}
        stale={stale}
        onSyncNow={sync.syncNow}
        syncing={sync.syncing}
        onSaveShare={() => setCommitDialogOpen(true)}
        onPushOnly={handlePushOnly}
        fetchIntervalS={sync.intervalS}
        updating={updating}
        myClaimCount={myClaimCount}
        mineActive={showOnlyMine}
        onToggleMine={() => setShowOnlyMine((v) => !v)}
        onReleaseMine={() => setReleaseAllOpen(true)}
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
      {signin.signedOut ? (
        <div className="notice warn">
          <span>{copy.notSignedIn}</span>
          <button className="notice-ok" onClick={signin.open}>
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
      {signin.prompting && (
        <SignInDialog
          checking={signin.checking}
          signingIn={signin.signingIn}
          onSignIn={signin.signIn}
          onCheckAgain={signin.checkAgain}
          onClose={signin.dismiss}
        />
      )}
      {exit.prompting && (
        <ExitDialog
          heldCount={myClaimCount}
          onCancel={exit.cancelPrompt}
          onStayInTray={(remember) => exit.answerPrompt(true, remember)}
          onQuit={(remember) => exit.answerPrompt(false, remember)}
        />
      )}
      <div className="stage">
      {switching && (
        <div className="switchblock" role="status" aria-live="polite">
          <div className="switchblock-card">
            <DialLogo className="switchlogo" label="" spinning />
            <p className="switchblock-title">
              {copy.switching(switchingTo ?? currentBranch)}
            </p>
            <p className="muted small">{copy.switchingDetail}</p>
          </div>
        </div>
      )}
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
      {releaseAllOpen && locks.data && locks.data.ours.length > 0 && (
        <ReleaseAllDialog
          locks={locks.data.ours}
          onClose={() => setReleaseAllOpen(false)}
          onConfirm={() => {
            const paths = locks.data!.ours.map((l) => l.path);
            setReleaseAllOpen(false);
            actions.release(paths);
          }}
        />
      )}
      {(progressOpen || settingsOpen) && (
        <div className="glasspage">
          {progressOpen ? (
            <ProgressPage rows={rows} onClose={() => setProgressOpen(false)} />
          ) : (
            <SettingsPage
              appState={appState}
              fetchIntervalS={sync.intervalS}
              onFetchIntervalChange={sync.setIntervalS}
              staleDays={staleDays}
              onStaleDaysChange={handleStaleDaysChange}
              bigFileMb={bigFileMb}
              onBigFileMbChange={handleBigFileMbChange}
              notifyConnection={notifyConnection}
              onNotifyConnectionChange={handleNotifyConnectionChange}
              closeBehavior={exit.behavior}
              onCloseBehaviorChange={exit.setBehavior}
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
