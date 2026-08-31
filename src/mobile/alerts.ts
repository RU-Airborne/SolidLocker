/**
 * Local notifications off the lock poll.
 *
 * These only fire while the app is running. A backgrounded WebView is
 * suspended within a minute or two, so an alert about an overnight change
 * arrives when the app is next opened. Waking the phone itself would need a
 * push server.
 */

import { useEffect, useRef } from "react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

import type { Lock, LocksResult } from "./api";

const WATCHING = "solidlocker.watching";
const REMINDED = "solidlocker.reminded";
const SETTINGS = "solidlocker.alerts";

export interface AlertSettings {
  /** A file you asked about is nobody's again. */
  free: boolean;
  /** You have been holding something for a long time. */
  reminder: boolean;
  /** A lock of yours went without you giving it back. */
  taken: boolean;
  /** Hours before the reminder counts as due. */
  after: number;
}

export const DEFAULT_ALERTS: AlertSettings = {
  free: true,
  reminder: true,
  taken: true,
  after: 24,
};

function load<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as object) } : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage turned off: the settings simply do not survive a restart.
  }
}

export function readAlerts(): AlertSettings {
  return load(SETTINGS, DEFAULT_ALERTS);
}

export function writeAlerts(next: AlertSettings) {
  save(SETTINGS, next);
}

// ---- The watchlist ----

export function watchedPaths(): string[] {
  try {
    const raw = window.localStorage.getItem(WATCHING);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function isWatched(path: string): boolean {
  return watchedPaths().includes(path);
}

export function setWatched(path: string, on: boolean) {
  const now = watchedPaths().filter((p) => p !== path);
  if (on) now.push(path);
  save(WATCHING, now);
}

/** Locks released here, so giving one back is not reported as a theft. */
const releasedHere = new Map<string, number>();
const FORGIVE_MS = 90_000;

export function noteReleased(paths: string[]) {
  const now = Date.now();
  for (const path of paths) releasedHere.set(path, now);
}

function wasReleasedHere(path: string): boolean {
  const at = releasedHere.get(path);
  if (at === undefined) return false;
  if (Date.now() - at > FORGIVE_MS) {
    releasedHere.delete(path);
    return false;
  }
  return true;
}

// ---- Permission ----

export async function askToNotify(): Promise<boolean> {
  try {
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  } catch {
    return false;
  }
}

async function say(title: string, body: string) {
  try {
    if (!(await isPermissionGranted())) return;
    sendNotification({ title, body });
  } catch {
    // Turned off at the system level. Nothing to be done about it here.
  }
}

function nameOf(path: string): string {
  return path.split("/").pop() ?? path;
}

/** Compares successive polls, so it costs no extra requests. */
export function useLockAlerts(
  locks: LocksResult | undefined,
  me: string | null,
) {
  const previous = useRef<LocksResult | null>(null);

  useEffect(() => {
    if (!locks) return;
    const before = previous.current;
    previous.current = locks;
    if (!before) return; // The first read is a baseline, not news.

    const settings = readAlerts();
    const heldBefore = new Map<string, Lock>();
    for (const lock of [...before.ours, ...before.theirs]) {
      heldBefore.set(lock.path, lock);
    }
    const heldNow = new Set(
      [...locks.ours, ...locks.theirs].map((lock) => lock.path),
    );

    // A file you asked to be told about is free again.
    if (settings.free) {
      for (const path of watchedPaths()) {
        if (heldBefore.has(path) && !heldNow.has(path)) {
          void say(
            `${nameOf(path)} is free`,
            `${heldBefore.get(path)?.owner?.name ?? "Whoever had it"} gave it back. It is yours to take.`,
          );
          setWatched(path, false);
        }
      }
    }

    // One of yours went, and it was not you that gave it back.
    if (settings.taken && me) {
      for (const lock of before.ours) {
        if (heldNow.has(lock.path) || wasReleasedHere(lock.path)) continue;
        const takenBy = locks.theirs.find((l) => l.path === lock.path);
        void say(
          `Your lock on ${nameOf(lock.path)} was taken`,
          takenBy?.owner?.name
            ? `${takenBy.owner.name} has it now. If you had it open, save somewhere else before touching it again.`
            : "Someone forced it off. If you had it open, save somewhere else before touching it again.",
        );
      }
    }
  }, [locks, me]);

  // Remembered per file, so a reminder is said once and not every poll.
  useEffect(() => {
    if (!locks) return;
    const settings = readAlerts();
    if (!settings.reminder) return;

    const reminded = load<Record<string, number>>(REMINDED, {});
    const now = Date.now();
    let changed = false;

    for (const lock of locks.ours) {
      if (!lock.locked_at) continue;
      const held = now - new Date(lock.locked_at).getTime();
      if (held < settings.after * 3_600_000) continue;

      const lastSaid = reminded[lock.path] ?? 0;
      if (now - lastSaid < 20 * 3_600_000) continue;
      reminded[lock.path] = now;
      changed = true;
      void say(
        `Still holding ${nameOf(lock.path)}`,
        `You have had it for ${Math.round(held / 3_600_000)} hours. If you are done with it, give it back so somebody else can pick it up.`,
      );
    }

    for (const path of Object.keys(reminded)) {
      if (!locks.ours.some((l) => l.path === path)) {
        delete reminded[path];
        changed = true;
      }
    }
    if (changed) save(REMINDED, reminded);
  }, [locks]);
}
