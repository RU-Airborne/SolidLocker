/**
 * Android hands its back gesture to the webview's history before closing the
 * app, so anything that can be opened pushes a history entry and going back
 * pops it.
 *
 * Everything that can be gone back out of shares one stack and one listener.
 * It used to be a listener per caller, and they all heard every pop: leaving
 * a page inside the More sheet dropped its own entry, the sheet's listener
 * heard that pop as well, and the whole sheet closed instead of going back a
 * step. Only the entry on top of the stack answers a pop now, and the pops we
 * cause ourselves while tidying up are not mistaken for someone going back.
 */

import { useEffect, useRef } from "react";

interface BackState {
  slBack?: number;
}

interface Entry {
  id: number;
  fn: () => void;
  /** Set once this entry has answered a pop, so cleanup leaves history alone. */
  popped: boolean;
  /** The caller's own list, kept in step with the shared stack. */
  owner?: Entry[];
}

const stack: Entry[] = [];
/** Pops we asked for. history.back() and history.go() each raise one. */
let suppress = 0;
let sequence = 0;
let bound = false;

function drop(entry: Entry) {
  const i = stack.indexOf(entry);
  if (i >= 0) stack.splice(i, 1);
  if (entry.owner) {
    const j = entry.owner.indexOf(entry);
    if (j >= 0) entry.owner.splice(j, 1);
  }
}

function onPopState() {
  if (suppress > 0) {
    suppress -= 1;
    return;
  }
  const top = stack[stack.length - 1];
  if (!top) return;
  top.popped = true;
  drop(top);
  top.fn();
}

function bind() {
  if (bound) return;
  bound = true;
  window.addEventListener("popstate", onPopState);
}

function push(fn: () => void, owner?: Entry[]): Entry {
  bind();
  const entry: Entry = { id: ++sequence, fn, popped: false, owner };
  stack.push(entry);
  owner?.push(entry);
  window.history.pushState({ slBack: entry.id } satisfies BackState, "");
  return entry;
}

/** One history entry stands for `open`. Back pops it and calls `onClose`. */
export function useBackable(open: boolean, onClose: () => void) {
  const latest = useRef(onClose);
  latest.current = onClose;

  useEffect(() => {
    if (!open) return;
    const entry = push(() => latest.current());

    return () => {
      // Already answered a pop, so the entry has gone with it.
      if (entry.popped) return;
      // Closed from the interface instead, so the entry is still there.
      drop(entry);
      suppress += 1;
      window.history.back();
    };
  }, [open]);
}

/** The same, for depth: three folders in means three steps back out. */
export function useBackableDepth(depth: number, onBack: () => void) {
  const latest = useRef(onBack);
  latest.current = onBack;
  const mine = useRef<Entry[]>([]);

  useEffect(() => {
    const have = mine.current.length;
    if (depth > have) {
      for (let i = have; i < depth; i++) {
        push(() => latest.current(), mine.current);
      }
    } else if (depth < have) {
      // Gone up from a button, so drop the spare entries.
      const spare = have - depth;
      for (let i = 0; i < spare; i++) {
        const entry = mine.current[mine.current.length - 1];
        if (!entry) break;
        drop(entry);
      }
      // However far it goes, go() raises a single pop.
      suppress += 1;
      window.history.go(-spare);
    }
  }, [depth]);

  useEffect(() => {
    const held = mine.current;
    return () => {
      const spare = held.length;
      if (spare === 0) return;
      for (const entry of [...held]) drop(entry);
      suppress += 1;
      window.history.go(-spare);
    };
  }, []);
}
