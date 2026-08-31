import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAppState } from "./queries";
import { Dashboard } from "./components/dashboard/Dashboard";
import { SetupWizard } from "./components/setup/SetupWizard";
import { isAppError } from "./types";
import DialLogo from "./components/DialLogo";
import { ThemeChoiceDialog } from "./components/dialogs/ThemeChoiceDialog";
import {
  ViewChoiceDialog,
  viewUnchosen,
} from "./components/dialogs/ViewChoiceDialog";
import { NeedsGitSplash, StartingUpSplash } from "./components/setup/Splashes";
import { greetingDue, markGreeted } from "./release";
import { themeUnchosen } from "./theme";
import "./styles.css";

export default function App() {
  const queryClient = useQueryClient();
  const appState = useAppState();
  const [owed] = useState(greetingDue);
  const [askTheme, setAskTheme] = useState(() => owed || themeUnchosen());
  const [askView, setAskView] = useState(() => owed || viewUnchosen());

  useEffect(() => {
    if (!askTheme && !askView) markGreeted();
  }, [askTheme, askView]);

  if (askTheme) {
    return <ThemeChoiceDialog onDone={() => setAskTheme(false)} />;
  }

  if (askView) {
    return <ViewChoiceDialog onDone={() => setAskView(false)} />;
  }

  // No sound here. A first time member simply has not installed Git yet,
  // which is expected, not a failure.

  if (appState.isLoading) {
    return <StartingUpSplash />;
  }

  if (appState.isError) {
    const raw = appState.error;
    // Tauri rejects with an object, so String() on it prints [object Object].
    // Read the code and message the backend actually sent.
    const err = isAppError(raw) ? raw : null;

    // Startup only fails when the settings file cannot be read or written. Say
    // that in words a member can act on, and keep the technical line for us.
    const cause =
      err?.code === "STORE"
        ? "SolidLocker could not read the settings file. The file may be damaged, or Windows may be blocking it."
        : (err?.message ?? (raw ? String(raw) : "Something went wrong while starting up."));

    return (
      <div className="center">
        <div className="card">
          <span className="logoglow">
            <DialLogo className="setuplogo" label="" />
          </span>
          <h2>SolidLocker could not start</h2>
          <p>{cause}</p>
          <button onClick={() => appState.refetch()}>Try again</button>
          {err?.code === "STORE" && (
            <p className="muted small altinstall">
              If it keeps happening, delete this file and open SolidLocker again.
              You will only have to pick your project folder once more.
              <br />
              <code className="errpath">
                %APPDATA%\SolidLocker\settings.json
              </code>
            </p>
          )}
          {err && (
            <p className="muted small errdetail">
              Details: [{err.code}] {err.message}
            </p>
          )}
        </div>
      </div>
    );
  }

  const state = appState.data!;

  if (!state.git_ok || !state.lfs_ok) {
    return <NeedsGitSplash onRecheck={() => appState.refetch()} />;
  }

  if (!state.repo) {
    return (
      <SetupWizard
        onDone={() => queryClient.invalidateQueries({ queryKey: ["appState"] })}
      />
    );
  }

  return <Dashboard key={state.repo?.repo_path ?? ""} appState={state} />;
}
