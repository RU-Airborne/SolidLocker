import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  checkOutsideRefs,
  claimFiles,
  listConflicts,
  getCollisions,
  getAppState,
  getLatest,
  getLocks,
  getRepoStatus,
  listFiles,
  listPulls,
  releaseFiles,
  saveAndShare,
  syncAttributes,
  type LockProgress,
  type OutsideCheck,
  type PullSummary,
} from "./api";

export const POLL_LOCKS_MS = 10_000;

export function useAppState() {
  return useQuery({ queryKey: ["appState"], queryFn: getAppState });
}

export function useFiles(enabled: boolean) {
  return useQuery({
    queryKey: ["files"],
    queryFn: listFiles,
    enabled,
    refetchInterval: 60_000,
  });
}

const FOLDER_CHANGED = "repo-folder-changed";

export function useFolderWatch(enabled: boolean) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let stop: (() => void) | undefined;
    let gone = false;
    listen(FOLDER_CHANGED, () => {
      for (const key of ["files", "repoStatus", "conflicts"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    })
      .then((unlisten) => {
        // The component can go before the listener is ready.
        if (gone) unlisten();
        else stop = unlisten;
      })
      .catch(() => {
        // No watcher just means falling back to the timers.
      });
    return () => {
      gone = true;
      stop?.();
    };
  }, [enabled, queryClient]);
}

export function useLocks(enabled: boolean) {
  return useQuery({
    queryKey: ["locks"],
    queryFn: getLocks,
    enabled,
    refetchInterval: POLL_LOCKS_MS,
    refetchIntervalInBackground: false,
  });
}

export function useRepoStatus(enabled: boolean) {
  return useQuery({
    queryKey: ["repoStatus"],
    queryFn: getRepoStatus,
    enabled,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });
}

function useInvalidateLockState() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["locks"] });
    queryClient.invalidateQueries({ queryKey: ["files"] });
    queryClient.invalidateQueries({ queryKey: ["repoStatus"] });
    queryClient.invalidateQueries({ queryKey: ["activity"] });
    queryClient.invalidateQueries({ queryKey: ["identities"] });
    queryClient.invalidateQueries({ queryKey: ["appState"] });
  };
}

export function useGetLatest() {
  const invalidate = useInvalidateLockState();
  return useMutation({
    mutationFn: getLatest,
    onSettled: invalidate,
  });
}

export function useSaveAndShare() {
  const invalidate = useInvalidateLockState();
  return useMutation({
    mutationFn: ({ message, paths }: { message: string; paths: string[] }) =>
      saveAndShare(message, paths),
    onSettled: invalidate,
  });
}

export interface LockRun {
  paths: string[];
  onProgress?: (step: LockProgress) => void;
}

export function useOutsideRefs(paths: string[], enabled: boolean) {
  return useQuery<OutsideCheck>({
    queryKey: ["outsideRefs", paths.join(",")],
    queryFn: () => checkOutsideRefs(paths),
    enabled: enabled && paths.length > 0,
    staleTime: 15 * 60_000,
    retry: false,
  });
}

// Teammates editing the same CAD files. Costs a few git calls, so cached.
export function useCollisions(branch: string, enabled: boolean) {
  return useQuery({
    queryKey: ["collisions", branch],
    queryFn: getCollisions,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function usePulls(enabled: boolean) {
  return useQuery<PullSummary[]>({
    queryKey: ["pulls"],
    queryFn: listPulls,
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

// Files a half-finished merge left behind. Cheap to poll.
export function useConflicts(enabled: boolean) {
  return useQuery({
    queryKey: ["conflicts"],
    queryFn: listConflicts,
    enabled,
    refetchInterval: 10_000,
    retry: false,
  });
}

export function useClaim() {
  const invalidate = useInvalidateLockState();
  return useMutation({
    mutationFn: (run: LockRun) => claimFiles(run.paths, run.onProgress),
    onSettled: invalidate,
  });
}

export function useRelease() {
  const invalidate = useInvalidateLockState();
  return useMutation({
    mutationFn: (run: LockRun) => releaseFiles(run.paths, run.onProgress),
    onSettled: invalidate,
  });
}

export function useSyncAttributes() {
  const invalidate = useInvalidateLockState();
  return useMutation({
    mutationFn: syncAttributes,
    onSettled: invalidate,
  });
}
