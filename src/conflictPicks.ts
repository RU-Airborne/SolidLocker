export type Side = "mine" | "theirs";

const store = new Map<string, Map<string, Side>>();

export function picksFor(key: string): Map<string, Side> {
  let m = store.get(key);
  if (!m) {
    m = new Map();
    store.set(key, m);
  }
  return m;
}

export function clearPicks(key: string) {
  store.delete(key);
}
