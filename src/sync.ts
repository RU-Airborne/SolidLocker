import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RepoStatus } from "./api";
import { fetchRemote, tidyAndSync } from "./api";
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
  syncing: boolean;
  checking: boolean;
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

const PULL_RETRY_MS = 60_000;


export function useSync(options: SyncOptions): SyncControls {
  const queryClient = useQueryClient();
  const [lastFetchAt, setLastFetchAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [intervalS, setIntervalS] = useChoice("fetchIntervalS", [15, 30, 60, 120, 300], 15);
  const latest = useRef(options);
  latest.current = options;

  const lastAutoPull = useRef(0);
  const pulling = useRef(false);

  useEffect(() => {
    const doFetch = () => {
      if (latest.current.paused) return;
      setChecking(true);
      fetchRemote()
        .then(() => {
          setLastFetchAt(Date.now());
          setFailed(false);
          queryClient.invalidateQueries({ queryKey: ["repoStatus"] });
          // A fetch can bring in branches teammates just created.
          queryClient.invalidateQueries({ queryKey: ["repoBranches"] });
        })
        .catch(() => setFailed(true))
        .finally(() => setChecking(false));
    };
    doFetch();
    const t = window.setInterval(doFetch, intervalS * 1000);
    return () => window.clearInterval(t);
  }, [queryClient, intervalS]);

  const attemptPull = useCallback((manual: boolean) => {
    if (pulling.current) return Promise.resolve();
    pulling.current = true;
    lastAutoPull.current = Date.now();
    const now = latest.current;
    return now
      .pullLatest()
      .then((r) => {
        if (r.merged) now.onNotice(copy.syncedChanges(r.behind_before));
        else if (manual) now.onNotice(copy.syncedOk);
      })
      .catch((e) => {
        if (
          isAppError(e) &&
          (e.code === "CONFLICT" || e.code === "CAD_CONFLICT")
        ) {
          const files = (e.detail as { files?: string[] } | undefined)?.files;
          // Never open the dialog with nothing to resolve.
          if (files && files.length > 0) {
            playMateFailed();
            now.onConflict(files);
            return;
          }
        }
        now.onWarn(isAppError(e) ? e.message : copy.offlineRetry);
      })
      .finally(() => {
        pulling.current = false;
      });
  }, []);

  const { paused, status, busy } = options;
  const behind = status?.behind ?? 0;
  const blocked =
    !status ||
    status.dirty.some((p) => !isSwTemp(p)) ||
    status.conflicted.length > 0;

  useEffect(() => {
    if (paused || busy || blocked || behind === 0) return;
    const tick = () => {
      if (Date.now() - lastAutoPull.current < AUTO_PULL_GAP_MS) return;
      void attemptPull(false);
    };
    tick();
    const t = window.setInterval(tick, PULL_RETRY_MS);
    return () => window.clearInterval(t);
  }, [paused, busy, blocked, behind, attemptPull]);

  return {
    lastFetchAt,
    intervalS,
    checking,
    setIntervalS,
    syncing,
    failed,
    setFailed,

    syncNow: () => {
      if (syncing) return;
      lastAutoPull.current = 0;
      setSyncing(true);
      tidyAndSync()
        .then((tidy) => {
          playCheckComplete();
          if (tidy.swept.length > 0) {
            latest.current.onNotice(copy.sweptForeignFiles(tidy.swept.length));
          }
          setLastFetchAt(Date.now());
          setFailed(false);
          for (const key of ["repoStatus", "locks", "files", "repoBranches"]) {
            queryClient.invalidateQueries({ queryKey: [key] });
          }
          // tidyAndSync only fetches; the button has to pull as well.
          return attemptPull(true);
        })
        .catch((e) => {
          setFailed(true);
          latest.current.onWarn(isAppError(e) ? e.message : copy.offlineRetry);
        })
        .finally(() => setSyncing(false));
    },
  };
}
