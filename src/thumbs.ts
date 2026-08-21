import { useEffect, useSyncExternalStore } from "react";

import { getThumbnails } from "./api";

/* Preview pictures for CAD files. */
const PX = 96;
const CHUNK = 48;

const cache = new Map<string, string>();
const asked = new Set<string>();
const queue: string[] = [];
const listeners = new Set<() => void>();
let draining = false;

function announce() {
  for (const listener of listeners) listener();
}

async function drain() {
  if (draining) return;
  draining = true;
  while (queue.length > 0) {
    const batch = queue.splice(0, CHUNK);
    try {
      const drawn = await getThumbnails(batch, PX);
      let landed = false;
      for (const [path, uri] of Object.entries(drawn)) {
        cache.set(path, uri);
        landed = true;
      }
      if (landed) announce();
    } catch {
      /**/
    }
  }
  draining = false;
}

function request(path: string) {
  if (asked.has(path)) return;
  asked.add(path);
  queue.push(path);
  void drain();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function useThumb(path: string): string | undefined {
  useEffect(() => {
    request(path);
  }, [path]);
  return useSyncExternalStore(
    subscribe,
    () => cache.get(path),
    () => undefined,
  );
}
