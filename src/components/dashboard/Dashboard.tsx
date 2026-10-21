import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useQuery } from "@tanstack/react-query";
import {
  endPreview,
  getPreviewState,
  initLockable,
  isSwitching,
  listRepoBranches,
  getOpenDocuments,
  openFile,
  openRepoFolder,
  previewCommit,
  pushNow,
  checkForUpdate,
  getDefaultBranch,
  restoreFiles,
  setAsideFiles,
  selectExistingRepo,
  switchBranch,
  syncAttributes,
  undoMerge,
  cancelLockRun,
  checkOutsideRefs,
  discardSwChanges,
  dropOwnLock,
  type CommitInfo,
  type LockProgress,
  type OutsideRef,
} from "../../api";
import {
  useClaim,
  useCollisions,
  useConflicts,
  useOutsideRefs,
  useFiles,
  useFolderWatch,
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
import {
  forgetRepo,
  read,
  rememberRepo,
  useChoice,
  useFlag,
  usePathSet,
  usePersisted,
  write,
} from "../../persist";
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
import { openUrl } from "@tauri-apps/plugin-opener";
import { PullsPage } from "../pulls/PullsPage";
import { CollisionNotice } from "./CollisionNotice";
// import { TeamPage } from "../team/TeamPage";
import { CollisionsDialog } from "../dialogs/CollisionsDialog";
import { ResolveConflictsDialog } from "../dialogs/ResolveConflictsDialog";
import { CommitDialog } from "../dialogs/CommitDialog";
import { ConflictDialog } from "../dialogs/ConflictDialog";
import { ForceUnlockDialog } from "../dialogs/ForceUnlockDialog";
import { SetAsideDialog } from "../dialogs/SetAsideDialog";
import { OfflineHelpDialog } from "../dialogs/OfflineHelpDialog";
import { BranchOffDialog } from "../dialogs/BranchOffDialog";
import { MergeBranchDialog } from "../dialogs/MergeBranchDialog";
import {
  RestoreVersionDialog,
  type VersionRef,
} from "../dialogs/RestoreVersionDialog";
import { RestoreFilesDialog } from "../dialogs/RestoreFilesDialog";
import { DiscardChangesDialog } from "../dialogs/DiscardChangesDialog";
import { DiscardSwDialog } from "../dialogs/DiscardSwDialog";
import { OffBranchFileDialog } from "../dialogs/OffBranchFileDialog";
import { OutsideRefsDialog } from "../dialogs/OutsideRefsDialog";
import { FolderLockDialog } from "../dialogs/FolderLockDialog";
import {
  LockProgressDialog,
  type LockRunKind,
  type LockRunState,
} from "../dialogs/LockProgressDialog";
import { CreateBranchDialog } from "../dialogs/CreateBranchDialog";
import { isSwTemp } from "../../types";
import { HistoryPage } from "../history/HistoryPage";
import { ActivityPanel } from "./ActivityPanel";
import { TopBar } from "./TopBar";
import { NavRail, type RailView } from "./NavRail";
import { FileTree, type SortMode } from "./FileTree";
import { rowDomId } from "./rowid";
import { FileTiles } from "./FileTiles";
import { useSwInstalled } from "./FileRow";
import { LocksPanel } from "./LocksPanel";

export interface FileRowData {
  file: FileEntry;
  status: LockStatus;
  /** Modified locally and not yet shared. */
  edited: boolean;
  /** Added to the project recently and not yet looked at. */
  isNew: boolean;
  /** Parts this file needs that live outside the project, so it opens broken
      for everyone else. Empty for the normal case. */
  outside: OutsideRef[];
}

export interface RowActions {
  claim: (paths: string[]) => void;
  release: (paths: string[]) => void;
  open: (path: string) => void;
  /** Right-click on a file row. */
  contextMenu: (e: React.MouseEvent, row: FileRowData) => void;
  confirmFolder: (kind: "lock" | "unlock", folder: string, paths: string[]) => void;
  claimWithRefs: (path: string) => void;
  releaseWithRefs: (path: string) => void;
  toggleWatch: (path: string) => void;
  watched: Set<string>;
  togglePin: (path: string) => void;
  pinned: Set<string>;
  busyPaths: Map<string, LockRunKind>;
  highlightedPath: string | null;
  /** Report an outcome from a row-level dialog and refresh what it changed.
      With undoPaths set, the banner offers an Undo that discards the local
      change on those files (possible until Save & Share). */
  notify: (text: string, undoPaths?: string[]) => void;
  branchedOff: (name: string) => void;
  openCommit: (sha: string) => void;
  currentBranch: string;
  previewing: boolean;
}

const TOUCH_SETTLE_MS = 30_000;

export function Dashboard({ appState }: { appState: AppState }) {
  const files = useFiles(true);
  // Windows tells us the moment a file is added or deleted in the folder.
  useFolderWatch(true);
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
    undoPaths?: string[];
    undoAction?: () => void;
  } | null>(null);
  const queryClient = useQueryClient();
  const swInstalled = useSwInstalled();

  // A branch switch rewrites every file in the project. Nothing else may run
  // against the worktree while it does. The backend enforces that, and the
  // UI blocks interaction so clicks do not queue up and land on a project
  // that changed underneath them.
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [openingRepo, setOpeningRepo] = useState<string | null>(null);
  const [stuckFiles, setStuckFiles] = useState<string[] | null>(null);
  const [fixingStuck, setFixingStuck] = useState(false);
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

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(
      () => setNotice(null),
      notice.undoPaths || notice.undoAction ? 30_000 : 8000,
    );
    return () => window.clearTimeout(t);
  }, [notice]);

  function doUndoMerge() {
    setNotice(null);
    undoMerge()
      .then(() => {
        queryClient.invalidateQueries();
        setNotice(copy.undoneMerge);
      })
      .catch((e) => warn(isAppError(e) ? e.message : String(e)));
  }

  function handleInitLockable() {
    if (settingUpLocking) return;
    setSettingUpLocking(true);
    initLockable()
      .then((r) => {
        queryClient.invalidateQueries();
        succeed(copy.lockingSetUp(r.pushed));
      })
      .catch((e) => warn(isAppError(e) ? e.message : String(e)))
      .finally(() => setSettingUpLocking(false));
  }

  function undoRestore(paths: string[]) {
    setNotice(null);
    restoreFiles(paths)
      .then(() => {
        queryClient.invalidateQueries();
        setNotice(copy.undoneRestore);
      })
      .catch((e) => warn(isAppError(e) ? e.message : String(e)));
  }

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

  const [busyPaths, setBusyPaths] = useState<Map<string, LockRunKind>>(
    new Map(),
  );
  const [lockRun, setLockRun] = useState<LockRunState | null>(null);
  const [claimDialogPath, setClaimDialogPath] = useState<string | null>(null);
  const [folderRun, setFolderRun] = useState<{
    kind: "lock" | "unlock";
    folder: string;
    paths: string[];
  } | null>(null);
  const [releaseDialogPath, setReleaseDialogPath] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [releaseAllOpen, setReleaseAllOpen] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const [pullsOpen, setPullsOpen] = useState(false);
  // const [teamOpen, setTeamOpen] = useState(false);
  // set by the Merge dialog; Merge Requests opens with the new-request dialog up
  const [pullsAsk, setPullsAsk] = useState<{ head: string; base: string } | null>(null);
  const defaultBranch = useQuery({
    queryKey: ["defaultBranch"],
    queryFn: getDefaultBranch,
    staleTime: 5 * 60_000,
  });
  // Runs on every launch, since this cache is memory only.
  const update = useQuery({
    queryKey: ["updateCheck"],
    queryFn: checkForUpdate,
    staleTime: 24 * 60 * 60_000,
    refetchInterval: 24 * 60 * 60_000,
    retry: 3,
    retryDelay: (attempt) => Math.min(30_000, 2_000 * 2 ** attempt),
  });
  const { data: updateInfo, refetch: recheckUpdate } = update;
  const [skippedUpdate, setSkippedUpdate] = useState(
    () => localStorage.getItem("skippedUpdate") ?? "",
  );
  // Files about to be shared that reach outside the project, hold back until user decides
  const [outsideRefs, setOutsideRefs] = useState<{
    refs: OutsideRef[];
    share: () => void;
  } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Looking at a file as it was at an older commit (from Activity/History).
  const [versionView, setVersionView] = useState<{
    path: string;
    commit: VersionRef;
    /** Branch-off scope default: commit context = "all", file = "file". */
    scopeDefault?: "all" | "file";
  } | null>(null);
  // "Branch off here" from a commit in Activity or History.
  const [branchOffTarget, setBranchOffTarget] = useState<{
    sha: string;
    label: string;
  } | null>(null);
  // "Merge…" from a branch card on the Branches page.
  const [mergeTarget, setMergeTarget] = useState<{
    branch: string;
    defaultBranch: string;
  } | null>(null);
  // Multi-file restore from a commit that touched several CAD files.
  const [multiRestore, setMultiRestore] = useState<{
    paths: string[];
    commit: VersionRef;
  } | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  // Unlock was held back: these files have unsaved changes in SolidWorks.
  const [swUnsaved, setSwUnsaved] = useState<string[] | null>(null);
  // waiting-changes push in flight (the no-message Save & Share case)
  const [pushing, setPushing] = useState(false);
  const [createBranchOpen, setCreateBranchOpen] = useState(false);
  const [historyFocusSha, setHistoryFocusSha] = useState<string | null>(null);
  const [settingUpLocking, setSettingUpLocking] = useState(false);
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
  const [panelOpen, setPanelOpen] = useFlag("panelOpen", true);
  const [panelLeaving, setPanelLeaving] = useState(false);
  const panelShown = panelOpen || panelLeaving;

  function togglePanel() {
    if (panelOpen) {
      setPanelLeaving(true);
      setPanelOpen(false);
      window.setTimeout(() => setPanelLeaving(false), 210);
    } else {
      setPanelLeaving(false);
      setPanelOpen(true);
    }
  }

  const touchedPaths = useRef<Map<string, number>>(new Map());
  function touchPaths(paths: string[], until: number) {
    for (const p of paths) touchedPaths.current.set(p, until);
  }

  const [forceTarget, setForceTarget] = useState<Lock | null>(null);
  const [dropMineAsk, setDropMineAsk] = useState<Lock | null>(null);
  const [droppingMine, setDroppingMine] = useState(false);
  const [offBranchFile, setOffBranchFile] = useState<{
    path: string;
    branches: string[];
  } | null>(null);
  const [setAside, setSetAside] = useState<{ branch: string; files: string[] } | null>(
    null,
  );
  const highlightTimer = useRef<number | undefined>(undefined);

  function focusFile(path: string) {
    window.clearTimeout(highlightTimer.current);
    setHighlightedPath(path.toLowerCase());
  }

  /**
   * After a branch switch the switch has to finish, the list has to be read
   * again, and in tiles the folder has to open. Wait for the row to 
   * exist and start the countdown.
   */
  useEffect(() => {
    if (!highlightedPath) return;
    let tries = 0;
    let clearAt = 0;

    const look = () => {
      const el = document.getElementById(rowDomId(highlightedPath));
      if (!el) return false;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      clearAt = window.setTimeout(() => setHighlightedPath(null), 2600);
      return true;
    };

    if (look()) {
      return () => window.clearTimeout(clearAt);
    }
    // About twelve seconds of looking, then give up rather than leave a row
    // lit forever.
    const hunt = window.setInterval(() => {
      tries += 1;
      if (look()) {
        window.clearInterval(hunt);
      } else if (tries > 40) {
        window.clearInterval(hunt);
        setHighlightedPath(null);
      }
    }, 300);
    return () => {
      window.clearInterval(hunt);
      window.clearTimeout(clearAt);
    };
  }, [highlightedPath]);
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
  const [typeFilter, setTypeFilter] = useState<
    "all" | "sldasm" | "sldprt" | "slddrw" | "other"
  >("all");

  // Tree sort order, remembered across restarts.
  const [sortMode, handleSortChange] = usePersisted<SortMode>(
    "sortMode",
    (raw) => (raw === "size" || raw === "modified" ? raw : "name"),
    (mode) => mode,
  );

  // Which folder the tiles are showing. Up here so a filter that matches
  // nothing cannot throw it away, and so the list knows where to open.
  const [tileFolder, setTileFolder] = useState("");

  const [tileCols, setTileCols] = useChoice(
    "tileColumns",
    [2, 3, 4, 5, 6, 7, 8, 9, 10],
    5,
  );
  // List or tiles, remembered too.
  const [viewMode, setViewMode] = usePersisted<"list" | "tiles">(
    "fileView",
    (raw) => (raw === "tiles" ? "tiles" : "list"),
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

  // Only assemblies and drawings reference anything else.
  const referencing = useMemo(
    () =>
      (files.data ?? [])
        .map((f) => f.rel_path)
        .filter((p) => /\.(sldasm|slddrw)$/i.test(p))
        .sort(),
    [files.data],
  );
  const outsideCheck = useOutsideRefs(referencing, true);
  const outsideByPath = useMemo(() => {
    const byPath = new Map<string, OutsideRef[]>();
    for (const ref of outsideCheck.data?.refs ?? []) {
      const key = ref.from.toLowerCase();
      byPath.set(key, [...(byPath.get(key) ?? []), ref]);
    }
    return byPath;
  }, [outsideCheck.data]);

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

  const hasOtherFiles = useMemo(
    () => (files.data ?? []).some((f) => !f.lockable),
    [files.data],
  );

  const lockablePaths = useMemo(
    () =>
      new Set(
        (files.data ?? [])
          .filter((f) => f.lockable)
          .map((f) => f.rel_path.toLowerCase()),
      ),
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
      outside: outsideByPath.get(file.rel_path.toLowerCase()) ?? [],
    }));
  }, [files.data, lockStatusByPath, outsideByPath, repoStatus.data, seenNew]);

  const visibleRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (showOnlyMine && r.status.kind !== "mine") return false;
      // "Other" is everything the locking rules do not cover.
      if (typeFilter === "other" && r.file.lockable) return false;
      if (
        typeFilter !== "all" &&
        typeFilter !== "other" &&
        !r.file.rel_path.toLowerCase().endsWith(`.${typeFilter}`)
      )
        return false;
      if (q && !r.file.rel_path.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, searchQuery, showOnlyMine, typeFilter]);

  const myClaimCount = locks.data?.ours.length ?? 0;
  // The filter can only ever show files that exist on this branch, so the
  // chip counts those; locks living on other branches get named separately
  // rather than leaving the filter mysteriously empty.
  const myClaimsHere = useMemo(
    () =>
      (locks.data?.ours ?? []).filter((l) =>
        knownPaths.has(l.path.toLowerCase()),
      ).length,
    [locks.data, knownPaths],
  );
  const myClaimsElsewhere = myClaimCount - myClaimsHere;

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
    if (showOnlyMine && myClaimsHere === 0) setShowOnlyMine(false);
  }, [showOnlyMine, myClaimsHere]);

  // Same for "Other" once the last such file leaves the project. A filter you
  // can no longer see must not keep filtering.
  useEffect(() => {
    if (typeFilter === "other" && !hasOtherFiles) setTypeFilter("all");
  }, [typeFilter, hasOtherFiles]);


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
      setHistoryOpen(false);
      // setTeamOpen(false);
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
      [!!versionView, () => setVersionView(null)],
      [!!branchOffTarget, () => setBranchOffTarget(null)],
      [!!mergeTarget, () => setMergeTarget(null)],
      [!!multiRestore, () => setMultiRestore(null)],
      [discardOpen, () => setDiscardOpen(false)],
      [createBranchOpen, () => setCreateBranchOpen(false)],
      [commitDialogOpen, () => setCommitDialogOpen(false)],
      [progressOpen, () => setProgressOpen(false)],
      [pullsOpen, () => setPullsOpen(false)],
      // [teamOpen, () => setTeamOpen(false)],
      [settingsOpen, () => setSettingsOpen(false)],
      [historyOpen, () => setHistoryOpen(false)],
      [searchQuery !== "", () => setSearchQuery("")],
    ],
  });


  function withBusy(paths: string[], kind: LockRunKind, fn: () => Promise<void>) {
    touchPaths(paths, Number.POSITIVE_INFINITY);
    setBusyPaths((prev) => {
      const next = new Map(prev);
      for (const p of paths) next.set(p, kind);
      return next;
    });
    fn().finally(() => {
      touchPaths(paths, Date.now() + TOUCH_SETTLE_MS);
      setBusyPaths((prev) => {
        const next = new Map(prev);
        for (const p of paths) next.delete(p);
        return next;
      });
    });
  }

  function watchRun(kind: LockRunKind, paths: string[]) {
    if (paths.length < 2) return undefined;
    const listed = [...new Set(paths)].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    );
    setLockRun({ kind, paths: listed, steps: new Map(), finished: false });
    return (step: LockProgress) =>
      setLockRun((prev) =>
        prev ? { ...prev, steps: new Map(prev.steps).set(step.path, step.state) } : prev,
      );
  }

  // dialog stays up until closed so failures can actually be read
  function endRun(_clean: boolean) {
    setLockRun((prev) => (prev ? { ...prev, finished: true } : prev));
  }

  // Referentially stable so the memoized FileTree/FileRow components only
  // re-render when something a row actually shows has changed. The handlers
  // close over state setters and mutateAsync, which React keeps stable.
  const currentBranch = repoStatus.data?.branch ?? appState.repo!.branch;

  const collisions = useCollisions(currentBranch, !!appState.repo);
  const openConflicts = useConflicts(!!appState.repo);
  // plan = branch to merge (nothing merged yet); no plan = merge already half done
  const [resolving, setResolving] = useState<{ plan?: string } | null>(null);
  const [showCollisions, setShowCollisions] = useState(false);

  const collisionKeys = useMemo(() => {
    const keys: string[] = [];
    for (const c of collisions.data ?? []) {
      for (const f of c.cad_files) keys.push(`${c.branch}|${f}`);
    }
    return keys.sort();
  }, [collisions.data]);
  const collisionSig = useMemo(
    () => JSON.stringify(collisionKeys),
    [collisionKeys],
  );
  const [collisionsHidden, setCollisionsHidden] = useState(
    () => localStorage.getItem("collisionsDismissed") ?? "",
  );
  const collisionsShown =
    collisionKeys.length > 0 && collisionSig !== collisionsHidden;

  const heldKey = `heldLocks:${appState.repo?.repo_slug ?? ""}`;
  useEffect(() => {
    const data = locks.data;
    if (!data || !data.fresh) return;

    // Sorted so the comparison below only fires on a real change.
    const mine = data.ours.map((l) => l.path).sort();
    const held = new Set(mine);
    let before: string[] = [];
    try {
      const raw = localStorage.getItem(heldKey);
      if (raw) before = JSON.parse(raw) as string[];
    } catch {
      // A damaged entry just means we start watching from here.
    }
    // Every ten seconds otherwise, for a set that rarely changes.
    const packed = JSON.stringify(mine);
    if (packed !== JSON.stringify(before)) {
      localStorage.setItem(heldKey, packed);
    }

    const now = Date.now();
    for (const [p, until] of touchedPaths.current) {
      if (until < now) touchedPaths.current.delete(p);
    }
    const taken = before.filter(
      (p) => !held.has(p) && !touchedPaths.current.has(p),
    );
    if (taken.length === 0) return;

    // The lock is gone, so it carries no owner any more. If somebody has
    // claimed the file since, that at least tells us who has it now.
    const heldBy = new Map<string, string>();
    for (const l of data.theirs) {
      if (l.owner?.name) heldBy.set(l.path, l.owner.name);
    }
    warn(copy.locksTaken(taken));
    void notifyDesktop(
      taken.length === 1
        ? "Your lock was taken off"
        : "Your locks were taken off",
      copy.locksTakenBody(taken, heldBy),
    );
  }, [locks.data, heldKey]);

  useEffect(() => {
    const risky = (collisions.data ?? []).filter((c) => c.cad_files.length > 0);
    if (risky.length === 0) return;
    let seen: string[] = [];
    try {
      seen = JSON.parse(localStorage.getItem("collisionsToasted") ?? "[]");
    } catch {
      // start fresh
    }
    const known = new Set(seen);
    const fresh: string[] = [];
    const lines: string[] = [];
    for (const c of risky) {
      for (const f of c.cad_files) {
        const key = `${c.branch}|${f}`;
        if (known.has(key)) continue;
        fresh.push(key);
        lines.push(`${f.split("/").pop() ?? f} — also on ${c.branch}`);
      }
    }
    if (fresh.length === 0) return;
    const body =
      lines.slice(0, 3).join("\n") +
      (lines.length > 3 ? `\n…and ${lines.length - 3} more` : "");
    void notifyDesktop("Same file on two branches", body);
    localStorage.setItem(
      "collisionsToasted",
      JSON.stringify([...known, ...fresh].slice(-200)),
    );
  }, [collisions.data]);

  // Read-only mode: the tree is parked on an old commit.
  const previewState = useQuery({
    queryKey: ["previewState"],
    queryFn: getPreviewState,
    refetchInterval: 30_000,
  });
  const previewReturn = previewState.data ?? null;
  const previewing = previewReturn !== null;

  async function handlePreviewCommit(sha: string, label: string) {
    setHistoryOpen(false);
    setNotice(null);
    setSwitchingTo(label);
    try {
      await previewCommit(sha);
      queryClient.invalidateQueries();
      setNotice(copy.previewStarted(label));
    } catch (e) {
      if (isAppError(e) && e.code === "NEEDS_COMMIT") {
        setCommitDialogOpen(true);
      } else {
        warn(isAppError(e) ? e.message : String(e));
      }
    } finally {
      setSwitchingTo(null);
    }
  }

  function handleDiscardChanges() {
    const files = (repoStatus.data?.dirty ?? []).filter((p) => !isSwTemp(p));
    const fresh = (repoStatus.data?.untracked ?? []).filter((p) => !isSwTemp(p));
    setDiscardOpen(false);
    // tracked edits are restored; untracked files get moved out instead
    Promise.resolve()
      .then(() => (files.length > 0 ? restoreFiles(files) : null))
      .then(() => (fresh.length > 0 ? setAsideFiles(fresh) : null))
      .then((movedTo) => {
        queryClient.invalidateQueries();
        setNotice(
          copy.clearedWorkingFolder(files.length, fresh.length, movedTo ?? null),
        );
      })
      .catch((e) => warn(isAppError(e) ? e.message : String(e)));
  }

  function handleEndPreview() {
    const back = previewReturn ?? "";
    setSwitchingTo(back);
    endPreview()
      .then(() => {
        queryClient.invalidateQueries();
        setNotice(copy.previewEnded(back));
      })
      .catch((e) => warn(isAppError(e) ? e.message : String(e)))
      .finally(() => setSwitchingTo(null));
  }

  const actions: RowActions = useMemo(() => ({
    busyPaths,
    highlightedPath,
    open: (path) => {
      // Opening a file you have not locked is the classic way to lose work.
      // Only for files that can be locked. There is no lock to take on a PDF,
      // so warning somebody off it is noise.
      const status = lockStatusByPath.get(path.toLowerCase());
      const isFile = /\.[a-z0-9]+$/i.test(path);
      const guarded = lockablePaths.has(path.toLowerCase());
      if (guarded && isFile && status?.kind !== "mine") {
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
    openCommit: (sha) => {
      setHistoryFocusSha(sha);
      setHistoryOpen(true);
    },
    notify: (text, undoPaths) => {
      playCheckComplete();
      setNoticeState({ text, warn: false, undoPaths });
      void queryClient.invalidateQueries({ queryKey: ["files"] });
      void queryClient.invalidateQueries({ queryKey: ["repoStatus"] });
    },
    branchedOff: (name) => {
      queryClient.invalidateQueries();
      succeed(copy.branchedOff(name));
    },
    currentBranch,
    previewing,
    confirmFolder: (kind, folder, paths) => {
      if (switching || previewing) return;
      setFolderRun({ kind, folder, paths });
    },
    claimWithRefs: (path) => setClaimDialogPath(path),
    releaseWithRefs: (path) => setReleaseDialogPath(path),
    toggleWatch,
    watched,
    togglePin,
    pinned,
    claim: (paths) => {
      if (switching || previewing) return;
      const report = watchRun("lock", paths);
      withBusy(paths, "lock", async () => {
        setNotice(null);
        try {
          const result = await claim.mutateAsync({ paths, onProgress: report });
          endRun(result.failed.length === 0 && !result.cancelled);
          if (result.cancelled) {
            setNotice(copy.lockRunCancelled(result.still_held));
          } else if (result.failed.length === 0) {
            succeed(copy.claimedOk(result.claimed));
          } else if (result.rolled_back) {
            const f = result.failed[0];
            const lost = f.path.split("/").pop() ?? f.path;
            warn(
              result.still_held.length > 0
                ? copy.claimRolledBackStuck(lost, f.owner, result.still_held)
                : copy.claimRolledBack(lost, f.owner),
            );
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
          endRun(false);
          setNotice(String(e));
        }
      });
    },
    release: (paths) => {
      if (switching || previewing) return;
      const report = watchRun("unlock", paths);
      withBusy(paths, "unlock", async () => {
        setNotice(null);
        try {
          const outcomes = await release.mutateAsync({ paths, onProgress: report });
          const blocked = outcomes.filter((o) => !o.ok);
          endRun(blocked.length === 0);
          if (blocked.length === 0) {
            succeed(copy.releasedOk(outcomes.map((o) => o.path)));
          } else {
            // Files with unsaved SolidWorks edits get a dialog with a way
            // out (discard in SolidWorks and unlock) instead of a warning.
            const unsaved = blocked
              .filter((o) => o.code === "UNSAVED_IN_SW")
              .map((o) => o.path);
            const others = blocked.filter((o) => o.code !== "UNSAVED_IN_SW");
            if (others.length > 0) {
              const released = outcomes.length - blocked.length;
              const first = `${others[0].path.split("/").pop()}: ${others[0].message}`;
              warn(
                copy.releasePartial(
                  released,
                  outcomes.length,
                  first,
                  others.length - 1,
                ),
              );
            }
            if (unsaved.length > 0) setSwUnsaved(unsaved);
          }
        } catch (e) {
          endRun(false);
          setNotice(String(e));
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [busyPaths, highlightedPath, watched, pinned, lockStatusByPath, switching, previewing, currentBranch]);

  function handleSaveShare(message: string, paths: string[]) {
    const share = () => {
      setOutsideRefs(null);
      saveShareMut
        .mutateAsync({ message, paths })
        .then((result) => {
          playRebuildComplete();
          setCommitDialogOpen(false);
          const moved = result?.moved_locks ?? [];
          setNotice(
            copy.sharedOk + (moved.length > 0 ? copy.locksMoved(moved) : ""),
          );
        })
        .catch((e) => warn(isAppError(e) ? e.message : String(e)));
    };

    checkOutsideRefs(paths)
      .then((check) => {
        if (check.checked && check.refs.length > 0) {
          setOutsideRefs({ refs: check.refs, share });
        } else {
          share();
        }
      })
      .catch(() => share());
  }

  const branches = useQuery({
    queryKey: ["repoBranches"],
    queryFn: listRepoBranches,
    staleTime: 5 * 60_000,
  });

  function dropMyLock(lock: Lock) {
    if (droppingMine) return;
    setDroppingMine(true);
    dropOwnLock(lock.path, lock.id)
      .then(() => {
        setDropMineAsk(null);
        succeed(copy.releasedOk([lock.path]));
        queryClient.invalidateQueries({ queryKey: ["locks"] });
        queryClient.invalidateQueries({ queryKey: ["files"] });
        queryClient.invalidateQueries({ queryKey: ["repoStatus"] });
      })
      .catch((e) => warn(isAppError(e) ? e.message : String(e)))
      .finally(() => setDroppingMine(false));
  }

  const unsharedPaths = useMemo(
    () =>
      new Set([
        ...(repoStatus.data?.dirty ?? []),
        ...(repoStatus.data?.untracked ?? []),
      ]),
    [repoStatus.data],
  );

  function handleFixStuck() {
    if (!stuckFiles || fixingStuck) return;
    setFixingStuck(true);
    restoreFiles(stuckFiles)
      .then(() => {
        setStuckFiles(null);
        setNotice(copy.stuckFixed);
        queryClient.invalidateQueries();
      })
      .catch((e) => warn(isAppError(e) ? e.message : String(e)))
      .finally(() => setFixingStuck(false));
  }

  // Read when the timer fires, not pinned to the render that started it.
  const liveState = useRef<{ open: string[]; untracked: string[] }>({
    open: [],
    untracked: [],
  });
  liveState.current = {
    open: openDocs.data ?? [],
    untracked: repoStatus.data?.untracked ?? [],
  };

  useEffect(() => {
    if (!stuckFiles || stuckFiles.length === 0) return;
    if (switching || fixingStuck) return;
    const t = window.setInterval(() => {
      const held = new Set(liveState.current.open.map((p) => p.toLowerCase()));
      const leftovers = new Set(liveState.current.untracked);
      const free = stuckFiles.filter(
        (p) => leftovers.has(p) && !held.has(p.toLowerCase()),
      );
      if (free.length === 0) return;
      const done = new Set(free);
      restoreFiles(free)
        .then(() => {
          const left = stuckFiles.filter((p) => !done.has(p));
          setStuckFiles(left.length > 0 ? left : null);
          if (left.length === 0) setNotice(copy.stuckFixed);
          queryClient.invalidateQueries();
        })
        .catch(() => {
          // Still held. The next round tries again.
        });
    }, 20_000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stuckFiles, switching, fixingStuck]);

  async function handleSwitchBranch(name: string) {
    if (name === "__create__") {
      setCreateBranchOpen(true);
      return;
    }
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
    await handleOpenRepo(dir);
  }

  // Both top-bar routes come through here, browsing and the opened-before
  // list. Swaps as much underfoot as a branch switch, so it blocks the same way.
  async function handleOpenRepo(dir: string) {
    const name = dir.split(/[\\/]/).filter(Boolean).pop() ?? dir;
    setOpeningRepo(name);
    try {
      await selectExistingRepo(dir);
      forgetRepoData();
      playFileOpenComplete();
    } catch (e) {
      // A remembered project can be renamed, moved, or on an unplugged drive.
      playMateFailed();
      forgetRepo(dir);
      setNotice(isAppError(e) ? e.message : String(e));
    } finally {
      setOpeningRepo(null);
    }
  }

  // invalidating alone keeps showing the old repo's data until refetch lands
  function forgetRepoData() {
    queryClient.removeQueries({
      predicate: (q) => q.queryKey[0] !== "appState",
    });
    queryClient.invalidateQueries();
  }

  function handlePushOnly() {
    if (pushing) return;
    setNotice(null);
    setPushing(true);
    pushNow()
      .then(() => {
        playRebuildComplete();
        setNotice(copy.sharedOk);
      })
      .catch((e) => warn(isAppError(e) ? e.message : String(e)))
      .finally(() => setPushing(false));
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

  useEffect(() => {
    if (!offline && !updateInfo) void recheckUpdate();
  }, [offline, updateInfo, recheckUpdate]);

  const repoPath = appState.repo?.repo_path;
  const repoSlug = appState.repo?.repo_slug;
  useEffect(() => {
    if (repoPath && repoSlug) rememberRepo({ slug: repoSlug, path: repoPath });
  }, [repoPath, repoSlug]);

  const updating = getLatestMut.isPending || saveShareMut.isPending;
  const locking = claim.isPending || release.isPending;

  const view: RailView = pullsOpen
    ? "pulls"
    : historyOpen
      ? "branches"
      : progressOpen
        ? "progress"
        : settingsOpen
          ? "settings"
          : "files";

  function goTo(next: RailView) {
    setPullsOpen(next === "pulls");
    setHistoryOpen(next === "branches");
    setProgressOpen(next === "progress");
    setSettingsOpen(next === "settings");
    if (next !== "branches") setHistoryFocusSha(null);
  }

  return (
    <div className={`app${offline ? " offlinetone" : ""}`}>
      <NavRail
        view={view}
        onGo={goTo}
        appState={appState}
        locking={locking}
        defaultBranch={defaultBranch.data ?? "main"}
      />
      <div className={`appmain${view === "files" ? "" : " onpage"}`}>
      <TopBar
        appState={appState}
        branches={branches.data}
        currentBranch={currentBranch}
        onSwitchBranch={handleSwitchBranch}
        switchingTo={switchingTo}
        onSwitchRepo={() => void handleSwitchRepo()}
        onOpenRepo={(dir) => void handleOpenRepo(dir)}
        onOpenFolder={() =>
          openRepoFolder().catch((e) =>
            warn(isAppError(e) ? e.message : String(e)),
          )
        }
        status={repoStatus.data}
        lastFetchAt={sync.lastFetchAt}
        offline={offline}
        stale={stale}
        onSyncNow={sync.syncNow}
        syncing={sync.syncing}
        checking={sync.checking}
        onSaveShare={() => !previewing && setCommitDialogOpen(true)}
        onPushOnly={() => !previewing && handlePushOnly()}
        onDiscard={() => !previewing && setDiscardOpen(true)}
        fetchIntervalS={sync.intervalS}
        updating={updating || pushing}
        leftovers={stuckFiles ?? []}
      />
      {/* Stays put, and comes back every time the app opens, until the member
          dismisses this particular version. The next release says hello again. */}
      {updateInfo?.newer && updateInfo.latest !== skippedUpdate && (
        <div className="notice">
          <span>
            SolidLocker {updateInfo.latest} is out. Right now you have {" "}
            {updateInfo.current}. Update soon to get the latest features and fixes.
          </span>
          <button
            className="notice-ok"
            onClick={() => void openUrl(updateInfo.url)}
          >
            See what&rsquo;s new
          </button>
          <button
            className="notice-ok"
            title={`Stop showing this for ${updateInfo.latest}. You will hear about the version after it`}
            onClick={() => {
              localStorage.setItem("skippedUpdate", updateInfo.latest);
              setSkippedUpdate(updateInfo.latest);
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      {(openConflicts.data?.length ?? 0) > 0 && !resolving && (
        <div className="notice warn">
          <span>
            A merge is half done: {openConflicts.data!.length} file
            {openConflicts.data!.length === 1 ? "" : "s"} changed on both sides
            and need a version picked.
          </span>
          <button className="notice-ok" onClick={() => setResolving({})}>
            Sort it out
          </button>
        </div>
      )}
      {collisions.data && collisionsShown && (
        <CollisionNotice
          collisions={collisions.data}
          onShow={() => setShowCollisions(true)}
          onDismiss={() => {
            setCollisionsHidden(collisionSig);
            localStorage.setItem("collisionsDismissed", collisionSig);
          }}
        />
      )}
      {stuckFiles && stuckFiles.length > 0 && (
        <div className="notice warn">
          <span>{copy.stuckFiles(stuckFiles)}</span>
          <button className="notice-ok" onClick={handleFixStuck}>
            {fixingStuck ? "Fixing…" : "Fix now"}
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
      {previewing && (
        <div className="notice warn">
          <span>{copy.previewBanner(previewReturn!)}</span>
          <button className="notice-ok" onClick={handleEndPreview}>
            Back to {previewReturn}
          </button>
        </div>
      )}
      {(!appState.repo!.lockable_ok || !appState.repo!.ignore_ok) && (
        <div className="notice warn">
          <span>
            {appState.repo!.lockable_ok
              ? copy.noIgnoreRules
              : copy.noLockingRules}
          </span>
          <button
            className="notice-ok"
            onClick={handleInitLockable}
            disabled={settingUpLocking}
            title="Adds the locking rules for .sldprt, .sldasm, .slddrw, .stl and .3mf files and a .gitignore for temp files to this branch, and shares them with the team"
          >
            {settingUpLocking
              ? "Setting up…"
              : appState.repo!.lockable_ok
                ? "Add ignore rules"
                : "Set up locking"}
          </button>
        </div>
      )}
      {notice && (
        <div className={`notice${notice.warn ? " warn" : ""}`}>
          <span>{notice.text}</span>
          {(notice.undoPaths || notice.undoAction) && (
            <button
              className="notice-ok"
              onClick={() =>
                notice.undoAction
                  ? notice.undoAction()
                  : undoRestore(notice.undoPaths!)
              }
            >
              Undo
            </button>
          )}
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
            // Nothing to lock or unlock on a file the rules do not cover.
            ...(rowMenu.row.file.lockable && rowMenu.row.status.kind === "unlocked"
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
            ...(rowMenu.row.file.lockable && rowMenu.row.status.kind === "mine"
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
            ...(rowMenu.row.file.lockable && rowMenu.row.status.kind === "theirs"
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
              // SolidWorks has nothing to do with a PDF, but everything opens
              // with something.
              label: rowMenu.row.file.lockable
                ? "Open in SolidWorks"
                : "Open",
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
            withBusy([p], "lock", async () => {
              const result = await claim.mutateAsync({ paths: [p] });
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
      {/* Outside the file list, because the file list is hidden while you are
          on another page and a switch can be started from the branch picker
          wherever you are. A switch holds up the whole window, so it says so
          across the whole window. */}
      {(switching || openingRepo !== null) && (
        <div className="switchblock" role="status" aria-live="polite">
          <div className="switchblock-card">
            <DialLogo className="switchlogo" label="" spinning />
            <p className="switchblock-title">
              {openingRepo !== null
                ? `Opening ${openingRepo}…`
                : copy.switching(switchingTo ?? currentBranch)}
            </p>
            <p className="muted small">
              {openingRepo !== null
                ? "Checking the repository and preparing the CAD files. The first open of a large project can take a few minutes."
                : copy.switchingDetail}
            </p>
          </div>
        </div>
      )}
      <div className="stage">
      <div className="body">
        {/* The heading belongs to the file list, not to the whole window.
            Spanning both columns left the divider starting halfway down the
            page with nothing above it; inside the column, the line runs from
            the toolbar to the bottom in one piece. */}
        <div className="filescolumn">
        {/* Named like the other places, but on one line: this is the only page
            whose content is a table that wants every row it can get, and a
            heading with a paragraph under it was costing a whole band of it.
            The side pane's switch lives here too, rather than in the toolbar
            above, where it would have been the one button that came and went
            depending on which page you were on. */}
        <div className="pagehead filespagehead">
          <h2>Files</h2>
          <button
            className={`barbtn panelbtn${panelOpen ? " on" : ""}`}
            onClick={togglePanel}
            title={
              panelOpen
                ? "Hide who has what and the team's activity"
                : "Show who has what and the team's activity"
            }
            aria-pressed={panelOpen}
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="4.5" width="18" height="15" rx="2" />
              <line x1="15" y1="4.5" x2="15" y2="19.5" />
            </svg>
            {/* Hidden, the pane has to name both the things it holds; out,
                its own tabs do that and the switch goes back to an icon. */}
            {!panelOpen && <span>Locked files &amp; Activity</span>}
          </button>
        </div>
        {/* Outside .content on purpose. In there it loses the width of the
            list's scrollbar, so the search box never lines up with the pane
            switch above it, and it scrolls out of sight. */}
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
                ...(hasOtherFiles ? [["other", "Other"] as const] : []),
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={typeFilter === value && !showOnlyMine ? "active" : ""}
                onClick={() => {
                  setTypeFilter(value);
                  setShowOnlyMine(false);
                }}
              >
                {label}
              </button>
            ))}
            {/* One of the filters, in with the filters. On its own it was an
                accent chip that looked switched on whether it was or not. */}
            {myClaimsHere > 0 && (
              <button
                className={showOnlyMine ? "active" : ""}
                onClick={() => {
                  setShowOnlyMine(true);
                  setTypeFilter("all");
                }}
                title="Show only the files you are holding on this branch"
              >
                Locked by you ({myClaimsHere})
              </button>
            )}
          </div>
          {/* Out of the way until you are looking at what you hold. */}
          {showOnlyMine && (
            <button
              className="unlockallbtn"
              onClick={() => setReleaseAllOpen(true)}
              disabled={switching}
              title="Give back everything you have finished with"
            >
              Unlock all…
            </button>
          )}
          {/* Two bare icons at the end of a toolbar are a puzzle, not a
              switch. */}
          <div className="viewswitch" role="group" aria-label="How to show the files">
            <button
              className={viewMode === "list" ? "active" : ""}
              onClick={() => setViewMode("list")}
              aria-pressed={viewMode === "list"}
              title="Show the files as a list, in their folders"
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
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              List
            </button>
            <button
              className={viewMode === "tiles" ? "active" : ""}
              onClick={() => setViewMode("tiles")}
              aria-pressed={viewMode === "tiles"}
              title="Show the files as tiles"
            >
              <svg
                viewBox="0 0 24 24"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
                <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
                <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
                <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
              </svg>
              Tiles
            </button>
          </div>
          {viewMode === "tiles" && (
            <label className="tilezoom">
              {/* Right means bigger, so 12 - value flips 2..10 onto 10..2. */}
              <input
                type="range"
                min={2}
                max={10}
                step={1}
                value={12 - tileCols}
                onChange={(e) => setTileCols(12 - Number(e.target.value))}
                aria-label="How big the tiles are"
                title={`${tileCols} tiles across`}
              />
            </label>
          )}
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
        <main className="content">
          {files.isLoading ? (
            <p className="muted">Verifying references…</p>
          ) : files.isError ? (
            <p className="error">Could not list files: {String(files.error)}</p>
          ) : rows.length === 0 ? (
            <p className="muted">There are no files in this project yet.</p>
          ) : visibleRows.length === 0 && viewMode === "list" ? (
            <p className="muted">No files match.</p>
          ) : (
            /* Tiles say this themselves, in the folder you are in, and
               keep the trail so you can walk out. Swapping the view for a line
               of text unmounted it and lost the folder. */
            viewMode === "tiles" ? (
              <FileTiles
                rows={visibleRows}
                actions={actions}
                sort={sortMode}
                here={tileFolder}
                setHere={setTileFolder}
                columns={tileCols}
              />
            ) : (
              <FileTree
                rows={visibleRows}
                actions={actions}
                sort={sortMode}
                repoPath={appState.repo!.repo_path}
                reveal={tileFolder}
                forceExpand={
                  searchQuery.trim() !== "" || showOnlyMine || typeFilter !== "all"
                }
              />
            )
          )}
        </main>
        </div>
        {panelOpen && (
        <div
          className="panelresizer"
          onPointerDown={startPanelResize}
          title="Drag to resize"
        />
        )}
        {panelShown && (
        <aside
          className={`branchpanel${panelLeaving ? " isleaving" : ""}`}
          style={
            { width: panelWidth, "--panelw": `${panelWidth}px` } as React.CSSProperties
          }
        >
          <div className="paneltabs">
            <button
              className={panelTab === "locks" ? "active" : ""}
              onClick={() => setPanelTab("locks")}
            >
              Locked files
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
              onOffBranchFile={(path, branchesOn) =>
                setOffBranchFile({ path, branches: branchesOn })
              }
              onForceRelease={setForceTarget}
              onDropMine={setDropMineAsk}
              mineElsewhere={myClaimsElsewhere}
            />
          ) : (
            <ActivityPanel
              knownPaths={knownPaths}
              onSelectFile={focusFile}
              onViewVersion={(path, commit) =>
                setVersionView({ path, commit })
              }
              onBranchOff={(commit: CommitInfo) =>
                setBranchOffTarget({
                  sha: commit.sha,
                  label: commit.message,
                })
              }
              onRestoreFiles={(paths, commit) =>
                setMultiRestore({ paths, commit })
              }
            />
          )}
        </aside>
        )}
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
      {versionView && (
        <RestoreVersionDialog
          path={versionView.path}
          commit={versionView.commit}
          branchName={currentBranch}
          branchScopeDefault={versionView.scopeDefault}
          onClose={() => setVersionView(null)}
          onDone={(text, restored) => {
            setVersionView(null);
            actions.notify(text, restored);
          }}
          onBranchedOff={(name) => {
            setVersionView(null);
            setHistoryOpen(false);
            actions.branchedOff(name);
          }}
        />
      )}
      {createBranchOpen && (
        <CreateBranchDialog
          branches={branches.data ?? []}
          currentBranch={currentBranch}
          onClose={() => setCreateBranchOpen(false)}
          onCreated={(name, fresh) => {
            setCreateBranchOpen(false);
            queryClient.invalidateQueries();
            succeed(fresh ? copy.freshBranch(name) : copy.branchedOff(name));
          }}
        />
      )}
      {discardOpen && (
        <DiscardChangesDialog
          files={(repoStatus.data?.dirty ?? []).filter((p) => !isSwTemp(p))}
          untracked={(repoStatus.data?.untracked ?? []).filter(
            (p) => !isSwTemp(p),
          )}
          onClose={() => setDiscardOpen(false)}
          onConfirm={handleDiscardChanges}
        />
      )}
      {offBranchFile && (
        <OffBranchFileDialog
          path={offBranchFile.path}
          branches={offBranchFile.branches}
          currentBranch={currentBranch}
          switchingTo={switchingTo}
          switching={switching}
          onGo={(br) => {
            // The switch has its own progress UI; this dialog is done.
            const path = offBranchFile.path;
            setOffBranchFile(null);
            void handleSwitchBranch(br).then(() => focusFile(path));
          }}
          onClose={() => setOffBranchFile(null)}
        />
      )}
      {swUnsaved && (
        <DiscardSwDialog
          paths={swUnsaved}
          onClose={() => setSwUnsaved(null)}
          onConfirm={() => {
            const paths = swUnsaved;
            setSwUnsaved(null);
            discardSwChanges(paths)
              .then(() => actions.release(paths))
              .catch((e) => warn(isAppError(e) ? e.message : String(e)));
          }}
        />
      )}
      {showCollisions && collisions.data && (
        <CollisionsDialog
          collisions={collisions.data.filter((c) => c.cad_files.length > 0)}
          currentBranch={currentBranch}
          onClose={() => setShowCollisions(false)}
          onOpenBranches={() => {
            setShowCollisions(false);
            setHistoryOpen(true);
          }}
        />
      )}
      {resolving && (
        <ResolveConflictsDialog
          plan={resolving.plan}
          ours={currentBranch}
          onClose={() => setResolving(null)}
          onOpenCommit={(sha) => {
            setResolving(null);
            setHistoryFocusSha(sha);
            setHistoryOpen(true);
          }}
          onDone={(notice) => {
            setResolving(null);
            setNotice(notice);
          }}
        />
      )}
      {outsideRefs && (
        <OutsideRefsDialog
          refs={outsideRefs.refs}
          onShareAnyway={outsideRefs.share}
          onClose={() => setOutsideRefs(null)}
        />
      )}
      {folderRun && (
        <FolderLockDialog
          kind={folderRun.kind}
          folder={folderRun.folder}
          paths={folderRun.paths}
          onClose={() => setFolderRun(null)}
          onConfirm={() => {
            const { kind, paths } = folderRun;
            setFolderRun(null);
            if (kind === "lock") actions.claim(paths);
            else actions.release(paths);
          }}
        />
      )}
      {lockRun && (
        <LockProgressDialog
          run={lockRun}
          onCancel={() => {
            setLockRun((prev) => (prev ? { ...prev, cancelling: true } : prev));
            cancelLockRun().catch(() => {});
          }}
          onClose={() => setLockRun(null)}
        />
      )}
      {multiRestore && (
        <RestoreFilesDialog
          paths={multiRestore.paths}
          commit={multiRestore.commit}
          branchName={currentBranch}
          onClose={() => setMultiRestore(null)}
          onDone={(text, restored) => {
            setMultiRestore(null);
            setHistoryOpen(false);
            actions.notify(text, restored);
          }}
        />
      )}
      {mergeTarget && (
        <MergeBranchDialog
          branch={mergeTarget.branch}
          currentBranch={currentBranch}
          defaultBranch={mergeTarget.defaultBranch}
          onClose={() => setMergeTarget(null)}
          onReview={(head, base) => {
            setMergeTarget(null);
            setHistoryOpen(false);
            setPullsAsk({ head, base });
            setPullsOpen(true);
          }}
          onResolve={(branch) => {
            setMergeTarget(null);
            setResolving({ plan: branch });
          }}
          onMerged={(text, undoable) => {
            setMergeTarget(null);
            queryClient.invalidateQueries();
            playCheckComplete();
            setNoticeState({
              text,
              warn: false,
              undoAction: undoable ? doUndoMerge : undefined,
            });
          }}
        />
      )}
      {branchOffTarget && (
        <BranchOffDialog
          sha={branchOffTarget.sha}
          label={branchOffTarget.label}
          branchName={currentBranch}
          onClose={() => setBranchOffTarget(null)}
          onBranched={(name) => {
            setBranchOffTarget(null);
            setHistoryOpen(false);
            actions.branchedOff(name);
          }}
        />
      )}
      {view !== "files" && (
        <div className="pagearea">
          {/*
          teamOpen ? (
            <TeamPage
              currentBranch={currentBranch}
              username={appState.username ?? null}
              onClose={() => setTeamOpen(false)}
              onOpenPulls={() => {
                setTeamOpen(false);
                setPullsOpen(true);
              }}
              onOpenBranches={() => {
                setTeamOpen(false);
                setHistoryOpen(true);
              }}
            />
          ) : ...
          */}
          {pullsOpen ? (
            <PullsPage
              currentBranch={currentBranch}
              ask={pullsAsk}
              onAsked={() => setPullsAsk(null)}
              onOpenCommit={(sha) => {
                setPullsOpen(false);
                setHistoryFocusSha(sha);
                setHistoryOpen(true);
              }}
            />
          ) : historyOpen ? (
            <HistoryPage
              currentBranch={currentBranch}
              focusSha={historyFocusSha}
              onSwitchBranch={(name) => {
                setHistoryOpen(false);
                void handleSwitchBranch(name);
              }}
              onBranchOff={(sha, label) => setBranchOffTarget({ sha, label })}
              onViewVersion={(path, commit, scopeDefault) =>
                setVersionView({ path, commit, scopeDefault })
              }
              onRestoreFiles={(paths, commit) =>
                setMultiRestore({ paths, commit })
              }
              onPreviewCommit={handlePreviewCommit}
              onMergeBranch={(branch, defaultBranch) =>
                setMergeTarget({ branch, defaultBranch })
              }
            />
          ) : progressOpen ? (
            <ProgressPage
              rows={rows}
              onOpenBranches={() => {
                setProgressOpen(false);
                setHistoryOpen(true);
              }}
              onOpenCommit={(sha) => {
                setProgressOpen(false);
                setHistoryFocusSha(sha);
                setHistoryOpen(true);
              }}
            />
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
                forgetRepoData();
              }}
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
      {dropMineAsk &&
        (() => {
          const name = dropMineAsk.path.split("/").pop() ?? dropMineAsk.path;
          const unshared = unsharedPaths.has(dropMineAsk.path);
          return (
            <div
              className="modal-backdrop"
              onClick={() => !droppingMine && setDropMineAsk(null)}
            >
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h2>
                  {unshared ? "Unlock without sharing?" : "Unlock this file?"}
                </h2>
                {unshared ? (
                  <>
                    <p>
                      <strong>{name}</strong> has changes that are not on
                      GitHub yet. Unlocking hands the file to the next
                      person, and your edits stay on this computer only &mdash;
                      whoever takes it next starts from the last shared
                      version.
                    </p>
                    <p className="muted">
                      Save &amp; Share first if you want the work to travel.
                    </p>
                  </>
                ) : (
                  <p>
                    <strong>{name}</strong> goes back to view-only and anyone
                    on the team can claim it. Take it again whenever you need
                    it.
                  </p>
                )}
                <div className="modal-actions">
                  <button
                    onClick={() => setDropMineAsk(null)}
                    disabled={droppingMine}
                  >
                    Cancel
                  </button>
                  <button
                    className={unshared ? "danger" : "primary"}
                    disabled={droppingMine}
                    onClick={() => dropMyLock(dropMineAsk)}
                  >
                    {droppingMine
                      ? "Unlocking…"
                      : unshared
                        ? "Unlock anyway"
                        : "Unlock"}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
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
    </div>
  );
}
