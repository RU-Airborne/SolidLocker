import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RepoStatus } from "./api";
import { fetchRemote } from "./api";
import { copy } from "./copy";
import { useChoice } from "./persist";
import { playCheckComplete, playMateFailed } from "./sounds";
import { isAppError, isSwTemp } from "./types";

interface PullResult {
  merged: boolean;
  behind_before: number;
}

export interface SyncControls {
  lastFetchAt: number | null;
  intervalS: number;
  setIntervalS: (seconds: number) => void;
  /** A sync is running */
  syncing: boolean;
  /** The last fetch failed */
  failed: boolean;
  setFailed: (failed: boolean) => void;
  syncNow: () => void;
}

export interface SyncOptions {
  /** A branch switch is rewriting the worktree, hold */
  paused: boolean;
  status: RepoStatus | undefined;
  pullLatest: () => Promise<PullResult>;
  /** A pull is already in flight */
  busy: boolean;
  onNotice: (text: string) => void;
  onWarn: (text: string) => void;
  onConflict: (files: string[]) => void;
}

/** Never auto-pull more often than this */
const AUTO_PULL_GAP_MS = 30_000;


export function useSync(options: SyncOptions): SyncControls {
  const queryClient = useQueryClient();
  const [lastFetchAt, setLastFetchAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [intervalS, setIntervalS] = useChoice("fetchIntervalS", [30, 60, 120, 300], 60);
  const latest = useRef(options);
  latest.current = options;

  const lastAutoPull = useRef(0);

  useEffect(() => {
    const doFetch = () => {
      if (latest.current.paused) return;
      fetchRemote()
        .then(() => {
          setLastFetchAt(Date.now());
          setFailed(false);
          queryClient.invalidateQueries({ queryKey: ["repoStatus"] });
          // A fetch can bring in branches teammates just created.
          queryClient.invalidateQueries({ queryKey: ["repoBranches"] });
        })
        .catch(() => setFailed(true));
    };
    doFetch();
    const t = window.setInterval(doFetch, intervalS * 1000);
    return () => window.clearInterval(t);
  }, [queryClient, intervalS]);

  // Auto-sync
  const { paused, status, busy } = options;
  useEffect(() => {
    if (paused) return;
    if (
      !status ||
      status.behind === 0 ||
      status.dirty.some((p) => !isSwTemp(p)) ||
      status.conflicted.length > 0
    )
      return;
    if (busy) return;
    if (Date.now() - lastAutoPull.current < AUTO_PULL_GAP_MS) return;
    lastAutoPull.current = Date.now();
    latest.current
      .pullLatest()
      .then((r) => {
        if (r.merged) latest.current.onNotice(copy.syncedChanges(r.behind_before));
      })
      .catch((e) => {
        if (isAppError(e) && e.code === "CONFLICT") {
          const files = (e.detail as { files?: string[] } | undefined)?.files;
          // Never open the dialog with nothing to resolve.
          if (files && files.length > 0) {
            playMateFailed();
            latest.current.onConflict(files);
          }
        }
        // Other failures stay quiet, the next cycle retries
      });
  }, [paused, status, busy]);

  return {
    lastFetchAt,
    intervalS,
    setIntervalS,
    syncing,
    failed,
    setFailed,

    syncNow: () => {
      if (syncing) return;
      lastAutoPull.current = 0;
      setSyncing(true);
      fetchRemote()
        .then(() => {
          playCheckComplete();
          setLastFetchAt(Date.now());
          setFailed(false);
          for (const key of ["repoStatus", "locks", "files", "repoBranches"]) {
            queryClient.invalidateQueries({ queryKey: [key] });
          }
          if ((latest.current.status?.behind ?? 0) === 0) {
            latest.current.onNotice(copy.syncedOk);
          }
        })
        .catch((e) => {
          setFailed(true);
          latest.current.onWarn(isAppError(e) ? e.message : copy.offlineRetry);
        })
        .finally(() => setSyncing(false));
    },
  };
}
