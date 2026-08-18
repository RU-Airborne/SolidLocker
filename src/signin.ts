import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { connectionState, fetchRemote, githubSignIn, githubSignedIn } from "./api";
import { isAppError } from "./types";

export interface SignInControls {
  prompting: boolean;
  open: () => void;
  dismiss: () => void;
  checking: boolean;
  signingIn: boolean;
  checkAgain: () => void;
  signIn: () => void;
  /**
   * True when the credentials are the reason GitHub is unreachable, so the
   * banner can say "you are signed out" rather than "check your connection"
   */
  signedOut: boolean;
}

/**
 * The GitHub sign in
 */
export function useSignIn(
  unreachable: boolean,
  onNotice: (text: string) => void,
  onError: (text: string) => void,
  onReachable: (ok: boolean) => void,
): SignInControls {
  const queryClient = useQueryClient();
  const [prompting, setPrompting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [state, setState] = useState<"ok" | "signed_out" | "offline" | null>(null);

  // Callbacks come from the dashboard's render scope and change identity
  // every render; the effects below must not restart because of that.
  const latest = useRef({ onNotice, onError, onReachable });
  latest.current = { onNotice, onError, onReachable };

  // First run: find out where we stand, exactly once.
  const checked = useRef(false);
  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    githubSignedIn()
      .then((ok) => {
        if (!ok) setPrompting(true);
        // Already signed in: the check just cached our login, so refetch the
        // app state to fill in the profile name and picture.
        else queryClient.invalidateQueries({ queryKey: ["appState"] });
      })
      .catch(() => {});
  }, [queryClient]);

  // Why is GitHub unreachable? Only asked while it actually is.
  useEffect(() => {
    if (!unreachable) {
      setState(null);
      return;
    }
    let cancelled = false;
    connectionState()
      .then((s) => !cancelled && setState(s))
      .catch(() => !cancelled && setState("offline"));
    return () => {
      cancelled = true;
    };
  }, [unreachable]);

  return {
    prompting,
    open: () => setPrompting(true),
    dismiss: () => setPrompting(false),
    checking,
    signingIn,
    signedOut: state === "signed_out",

    checkAgain: () => {
      setChecking(true);
      githubSignedIn()
        .then((ok) => {
          if (!ok) return;
          setPrompting(false);
          latest.current.onNotice("Signed in to GitHub.");
          queryClient.invalidateQueries();
        })
        .catch((e) => latest.current.onError(isAppError(e) ? e.message : String(e)))
        .finally(() => setChecking(false));
    },

    // Same flow as the Sign in button on the profile page: open the
    // credential manager's browser sign in, then refresh everything that was
    // blocked while signed out.
    signIn: () => {
      setSigningIn(true);
      githubSignIn()
        .then((ok) => {
          queryClient.invalidateQueries();
          if (!ok) return;
          setPrompting(false);
          latest.current.onNotice("Signed in to GitHub.");
          // Re-probe the connection now, so the warning banner clears here
          // instead of lingering until the next background poll.
          fetchRemote()
            .then(() => latest.current.onReachable(true))
            .catch(() => latest.current.onReachable(false));
        })
        .catch((e) => latest.current.onError(isAppError(e) ? e.message : String(e)))
        .finally(() => setSigningIn(false));
    },
  };
}
