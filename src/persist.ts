import { useCallback, useState } from "react";

/**
 * Settings that outlive the window kept in localStorage.
 */
const NS = "solidlocker.";

export function read(key: string): string | null {
  try {
    return localStorage.getItem(NS + key);
  } catch {
    return null;
  }
}

export function write(key: string, value: string) {
  try {
    localStorage.setItem(NS + key, value);
  } catch {
    // A full or blocked store costs the user their preference, nothing more.
  }
}

/**
 * State that writes itself back on every change. `parse` is handed `null`
 * when nothing is stored yet, so it owns the default too.
 */
export function usePersisted<T>(
  key: string,
  parse: (raw: string | null) => T,
  serialize: (value: T) => string,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => parse(read(key)));
  const set = useCallback(
    (next: T) => {
      write(key, serialize(next));
      setValue(next);
    },
    [key, serialize],
  );
  return [value, set];
}

/** on unless explicitly turned off */
export function useFlag(key: string, defaultOn = true): [boolean, (on: boolean) => void] {
  return usePersisted(
    key,
    (raw) => (raw === null ? defaultOn : raw !== "off"),
    (on) => (on ? "on" : "off"),
  );
}

export function useChoice(
  key: string,
  allowed: readonly number[],
  fallback: number,
): [number, (value: number) => void] {
  return usePersisted(
    key,
    (raw) => {
      const n = Number(raw);
      return raw !== null && allowed.includes(n) ? n : fallback;
    },
    String,
  );
}

/**
 * A set of repo-relative paths, compared case-insensitively. Windows paths
 * differ only in case constantly, and a pin that quietly stops matching after
 * a rename reads as the feature being broken.
 */
export function usePathSet(
  key: string,
): [Set<string>, (path: string) => void, (edit: (next: Set<string>) => void) => void] {
  const [paths, setPaths] = useState<Set<string>>(() => {
    try {
      const stored = JSON.parse(read(key) ?? "[]") as unknown;
      if (!Array.isArray(stored)) return new Set();
      return new Set(stored.filter((p): p is string => typeof p === "string"));
    } catch {
      return new Set();
    }
  });

  const toggle = useCallback(
    (path: string) => {
      setPaths((prev) => {
        const next = new Set(prev);
        const entry = path.toLowerCase();
        if (next.has(entry)) next.delete(entry);
        else next.add(entry);
        write(key, JSON.stringify([...next]));
        return next;
      });
    },
    [key],
  );

  /**
   * Add or drop several at once. `toggle` flips membership, which is wrong
   * for a sweep: two passes over one path put it back.
   */
  const edit = useCallback(
    (change: (next: Set<string>) => void) => {
      setPaths((prev) => {
        const next = new Set(prev);
        change(next);
        write(key, JSON.stringify([...next]));
        return next;
      });
    },
    [key],
  );

  return [paths, toggle, edit];
}

/** A project this computer has opened before. */
export interface RecentRepo {
  slug: string;
  path: string;
}

const RECENT_KEY = "recentRepos";
const RECENT_MAX = 8;

/**
 * The projects opened on this machine, most recent first. Paths are compared
 * case-insensitively: Windows hands back the same folder spelled differently
 * depending on how you got to it, and the same project twice in the list
 * would be worse than not remembering it at all.
 */
export function readRecentRepos(): RecentRepo[] {
  try {
    const raw = JSON.parse(read(RECENT_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (r): r is RecentRepo =>
        !!r &&
        typeof r === "object" &&
        typeof (r as RecentRepo).slug === "string" &&
        typeof (r as RecentRepo).path === "string",
    );
  } catch {
    return [];
  }
}

export function rememberRepo(entry: RecentRepo): RecentRepo[] {
  const key = entry.path.toLowerCase();
  const next = [
    entry,
    ...readRecentRepos().filter((r) => r.path.toLowerCase() !== key),
  ].slice(0, RECENT_MAX);
  write(RECENT_KEY, JSON.stringify(next));
  return next;
}

/** Drops one the user no longer wants offered, or that has gone missing. */
export function forgetRepo(path: string): RecentRepo[] {
  const key = path.toLowerCase();
  const next = readRecentRepos().filter((r) => r.path.toLowerCase() !== key);
  write(RECENT_KEY, JSON.stringify(next));
  return next;
}
