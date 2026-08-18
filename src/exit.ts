import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hideToTray, quitApp } from "./api";
import { useFlag } from "./persist";

export type CloseBehavior = "ask" | "tray" | "quit";

export interface ExitControls {
  behavior: CloseBehavior;
  setBehavior: (mode: CloseBehavior) => void;
  prompting: boolean;
  cancelPrompt: () => void;
  /** `remember` makes the choice standing, so the question stops. */
  answerPrompt: (toTray: boolean, remember: boolean) => void;
}

/**
 * What closing the window means. Dropping to the tray is the default, so
 * SolidLocker keeps protecting files while it is out of sight.
 */
export function useExitBehavior(): ExitControls {
  const [closeToTray, setCloseToTray] = useFlag("closeToTray");
  const [askOnExit, setAskOnExit] = useFlag("askOnExit");
  const [prompting, setPrompting] = useState(false);

  // The close handler is registered once, but has to act on the preferences
  // as they are when the X is clicked, not as they were at registration.
  const askRef = useRef(askOnExit);
  askRef.current = askOnExit;
  const trayRef = useRef(closeToTray);
  trayRef.current = closeToTray;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    // The listener arrives asynchronously. Without this flag a fast
    // unmount/remount (React strict mode, hot reload) loses the handle and
    // leaks a listener, so an old handler keeps hiding the window while the
    // new one opens the dialog.
    let disposed = false;
    getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (disposed) return;
        if (askRef.current) {
          event.preventDefault();
          // Make sure the window is up front, so the question can't be
          // answered blind behind other windows.
          const w = getCurrentWindow();
          await w.show();
          await w.unminimize();
          await w.setFocus();
          setPrompting(true);
          return;
        }
        if (trayRef.current) {
          event.preventDefault();
          // Tear the window down rather than hiding it: that lets the webview
          // processes exit, so sitting in the tray costs a fraction of the
          // memory. The tray icon rebuilds the window on demand.
          await hideToTray();
          return;
        }
        event.preventDefault();
        await quitApp();
      })
      .then((u) => {
        unlisten = u;
        if (disposed) u();
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return {
    behavior: askOnExit ? "ask" : closeToTray ? "tray" : "quit",
    setBehavior: (mode) => {
      setAskOnExit(mode === "ask");
      setCloseToTray(mode !== "quit");
    },
    prompting,
    cancelPrompt: () => setPrompting(false),
    answerPrompt: (toTray, remember) => {
      setPrompting(false);
      setCloseToTray(toTray);
      if (remember) setAskOnExit(false);
      if (toTray) hideToTray();
      else quitApp();
    },
  };
}
