import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";

import * as api from "../api";
import { isAppError } from "../../types";
import { Spinner, Trouble } from "../components";
import DialLogo from "../../components/DialLogo";

type Stage =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "waiting"; start: api.DeviceStart }
  | { kind: "trouble"; error: unknown };

export function SignIn({ canDeviceSignIn }: { canDeviceSignIn: boolean }) {
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [byToken, setByToken] = useState(!canDeviceSignIn);
  const [addingId, setAddingId] = useState(false);
  // The signal came and went mid sign-in. Worth saying, not worth stopping for.
  const [lostSignal, setLostSignal] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => () => void (cancelled.current = true), []);

  const done = () => {
    queryClient.invalidateQueries({ queryKey: ["cloud"] });
  };

  async function begin() {
    setStage({ kind: "starting" });
    try {
      const start = await api.deviceStart();
      setStage({ kind: "waiting", start });
      // Deliberately not opening the browser here. On a desktop the code stays
      // visible beside the browser window; on a phone the browser IS the
      // screen, so opening it straight away hides the very code it is asking
      // for. Show the code, let them go when they have it.
      await keepAsking(start);
    } catch (error) {
      setStage({ kind: "trouble", error });
    }
  }

  async function keepAsking(start: api.DeviceStart) {
    let wait = start.interval * 1000;
    const giveUpAt = Date.now() + start.expires_in * 1000;

    while (!cancelled.current && Date.now() < giveUpAt) {
      await new Promise((r) => setTimeout(r, wait));
      if (cancelled.current) return;
      try {
        const answer = await api.devicePoll(start.device_code);
        if (answer.state === "done") {
          done();
          return;
        }
        if (answer.state === "slow_down") wait = answer.interval * 1000;
        setLostSignal(false);
      } catch (error) {
        // Losing the signal is the ordinary condition of a phone halfway
        // between two networks, which is exactly where somebody is while they
        // read a code out of one app and type it into another. The code is
        // good for fifteen minutes; one poll that never left the handset is
        // not the end of the sign in, and throwing it away means asking them
        // to start over for nothing.
        if (isAppError(error) && error.code === "OFFLINE") {
          setLostSignal(true);
          continue;
        }
        setStage({ kind: "trouble", error });
        return;
      }
    }
    if (!cancelled.current) {
      setStage({
        kind: "trouble",
        error: { code: "EXPIRED", message: "That code ran out. Start again." },
      });
    }
  }

  return (
    <div className="m-signin">
      <span className="logoglow">
        <DialLogo className="m-signin-logo" label="" />
      </span>
      <h1>SolidLocker</h1>
      <p className="muted">
        See who is holding which part, and take or give back a lock, without
        going back to your machine.
      </p>

      {stage.kind === "waiting" ? (
        <Waiting
          start={stage.start}
          lostSignal={lostSignal}
          onGiveUp={() => setStage({ kind: "idle" })}
        />
      ) : (
        <>
          {stage.kind === "trouble" && (
            <Trouble
              error={stage.error}
              onRetry={() => setStage({ kind: "idle" })}
            />
          )}
          {stage.kind === "starting" && <Spinner label="Asking GitHub..." />}

          {canDeviceSignIn && !byToken && stage.kind !== "starting" && (
            <button className="m-btn m-btn-go m-btn-wide" onClick={begin}>
              Sign in with GitHub
            </button>
          )}

          {byToken ? (
            <TokenForm onDone={done} />
          ) : (
            <button className="m-linkbtn" onClick={() => setByToken(true)}>
              Use an access token instead
            </button>
          )}

          {!canDeviceSignIn &&
            (addingId ? (
              <ClientIdForm
                onSaved={() =>
                  queryClient.invalidateQueries({ queryKey: ["cloud", "state"] })
                }
              />
            ) : (
              <>
                <p className="muted small m-note">
                  This build has no GitHub client ID, so it cannot start a sign
                  in of its own yet. A token works just as well in the meantime.
                </p>
                {/* Settings is behind the sign in, so without this the only way
                    out of "no client ID" would be a new build. */}
                <button className="m-linkbtn" onClick={() => setAddingId(true)}>
                  Add a client ID
                </button>
              </>
            ))}
        </>
      )}
    </div>
  );
}

function Waiting({
  start,
  lostSignal,
  onGiveUp,
}: {
  start: api.DeviceStart;
  lostSignal: boolean;
  onGiveUp: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="m-device">
      <p>Copy this code, then open GitHub and paste it:</p>
      <button
        className="m-code"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(start.user_code)
            .then(() => setCopied(true))
            .catch(() => {});
        }}
      >
        {start.user_code}
      </button>
      <p className="muted small">
        {copied ? "Copied. Now open GitHub." : "Tap the code to copy it."}
      </p>
      <button
        className={copied ? "m-btn m-btn-go m-btn-wide" : "m-btn m-btn-wide"}
        onClick={() => void openUrl(start.verification_uri).catch(() => {})}
      >
        Open {start.verification_uri.replace("https://", "")}
      </button>
      <p className="muted small">
        Come back here afterwards; this screen finishes the sign in on its own.
      </p>
      <Spinner
        label={
          lostSignal
            ? "No signal at the moment. Still waiting, and it will pick up on its own."
            : "Waiting for you to finish on GitHub..."
        }
      />
      <button className="m-linkbtn" onClick={onGiveUp}>
        Cancel
      </button>
    </div>
  );
}

function TokenForm({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.signInWithToken(token);
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="m-tokenform">
      <label htmlFor="token">GitHub access token</label>
      <input
        id="token"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="github_pat_..."
        type="password"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <p className="muted small">
        It needs access to the project's contents and pull requests. Locking is
        part of write access to the contents.
      </p>
      {error != null && <Trouble error={error} />}
      <button
        className="m-btn m-btn-go m-btn-wide"
        onClick={submit}
        disabled={busy || token.trim().length === 0}
      >
        {busy ? "Checking..." : "Sign in"}
      </button>
    </div>
  );
}

function ClientIdForm({ onSaved }: { onSaved: () => void }) {
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="m-tokenform">
      <label htmlFor="clientid">GitHub client ID</label>
      <input
        id="clientid"
        value={id}
        onChange={(e) => setId(e.target.value)}
        placeholder="Ov23li... or Iv1...."
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <p className="muted small">
        From the OAuth app or GitHub app your team registered, with device flow
        switched on. Client IDs are public, so this is not a secret.
      </p>
      <button
        className="m-btn m-btn-wide"
        disabled={busy || id.trim().length === 0}
        onClick={async () => {
          setBusy(true);
          try {
            await api.setClientId(id.trim());
            onSaved();
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Saving..." : "Save it"}
      </button>
    </div>
  );
}
