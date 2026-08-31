import { read, write } from "./persist";

export const RELEASE = "0.8.1";

/**
 * Anyone who last ran a version older than this gets the opening questions
 * again.
*/
const ASK_AGAIN_BEFORE = "0.8.0";

const KEY = "greetedVersion";

function parts(version: string): number[] {
  return version
    .split(".")
    .map((n) => Number.parseInt(n, 10))
    .map((n) => (Number.isFinite(n) ? n : 0));
}

function olderThan(version: string, than: string): boolean {
  const a = parts(version);
  const b = parts(than);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const l = a[i] ?? 0;
    const r = b[i] ?? 0;
    if (l !== r) return l < r;
  }
  return false;
}

export function greetingDue(): boolean {
  const seen = read(KEY);
  // Nothing recorded means a fresh install, or a version from before this was tracked
  if (seen === null) return true;
  return olderThan(seen, ASK_AGAIN_BEFORE);
}

export function markGreeted(): void {
  if (read(KEY) !== RELEASE) write(KEY, RELEASE);
}
