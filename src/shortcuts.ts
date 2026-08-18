import { useEffect, useRef } from "react";

/** A layer Escape can close. The first open one in the list takes the key. */
export type EscapeLayer = [open: boolean, close: () => void];

export interface Shortcuts {
  /** Ctrl+F */
  find: () => void;
  /** Ctrl+S */
  save: () => void;
  /** Ctrl+Z, which means nothing here */
  undo: () => void;
  /** Escape, topmost first. */
  layers: EscapeLayer[];
}

/**
 * Registered once, reading the current callbacks through a ref. Listing every
 * dialog's open flag as a dependency instead rebuilt the listener several
 * times per keystroke in the search box.
 */
export function useShortcuts(shortcuts: Shortcuts) {
  const latest = useRef(shortcuts);
  latest.current = shortcuts;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { find, save, undo, layers } = latest.current;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        find();
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
        return;
      }
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
        return;
      }
      if (e.key === "Escape") {
        const top = layers.find(([open]) => open);
        if (top) {
          e.preventDefault();
          top[1]();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
