/** One place to change how dates display app-wide. */

import { useEffect, useState } from "react";

export function formatDate(when: string | number | Date): string {
  return new Date(when).toLocaleDateString();
}

export function formatDateTime(when: string | number | Date): string {
  const d = new Date(when);
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${d.toLocaleDateString()} ${time}`;
}

/**
 * `Date.now()` read inside a `useMemo` is a hidden input: the value silently
 * depends on when React last happened to recompute, so a chart's day
 * boundaries move whenever an unrelated prop changes and never move when
 * nothing does. Taking the clock as an explicit, slowly ticking value makes
 * the memo honest about what it depends on, and makes the view update on its
 * own as time passes.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}
