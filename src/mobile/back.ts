/**
 * Android hands its back gesture to the webview's history before closing the
 * app so anything that can be opened pushes a history entry and going 
 * back pops it.
 */

import { useEffect, useRef } from "react";

interface BackState {
  slBack?: number;
}

let sequence = 0;

/** One history entry stands for `open`. Back pops it and calls `onClose`. */
export function useBackable(open: boolean, onClose: () => void) {
  const latest = useRef(onClose);
  latest.current = onClose;

  useEffect(() => {
    if (!open) return;

    const id = ++sequence;
    let popped = false;
    window.history.pushState({ slBack: id } satisfies BackState, "");

    const onPop = () => {
      popped = true;
      latest.current();
    };
    window.addEventListener("popstate", onPop);

    return () => {
      window.removeEventListener("popstate", onPop);
      // Closed from the interface, so the entry is still there. Drop it.
      if (!popped && (window.history.state as BackState | null)?.slBack === id) {
        window.history.back();
      }
    };
  }, [open]);
}

/** The same, for depth: three folders in means three steps back out. */
export function useBackableDepth(depth: number, onBack: () => void) {
  const latest = useRef(onBack);
  latest.current = onBack;
  const known = useRef(0);

  useEffect(() => {
    if (depth > known.current) {
      for (let i = known.current; i < depth; i++) {
        window.history.pushState({ slBack: ++sequence } satisfies BackState, "");
      }
    } else if (depth < known.current) {
      // Gone up from a button, so drop the spare entries.
      const spare = known.current - depth;
      known.current = depth;
      window.history.go(-spare);
      return;
    }
    known.current = depth;
  }, [depth]);

  useEffect(() => {
    const onPop = () => {
      if (known.current > 0) {
        known.current -= 1;
        latest.current();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
}
