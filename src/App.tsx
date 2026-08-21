import { useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAppState } from "./queries";
import { Dashboard } from "./components/dashboard/Dashboard";
import { SetupWizard } from "./components/setup/SetupWizard";
import { isAppError } from "./types";
import DialLogo from "./components/DialLogo";

export default function App() {
  const queryClient = useQueryClient();
  const appState = useAppState();

  // No sound here. A first time member simply has not installed Git yet,
  // which is expected, not a failure.

  if (appState.isLoading) {
    return (
      <div className="center">
        <div className="card launchscreen">
          <span className="logoglow">
            <DialLogo className="setuplogo" label="" spinning />
          </span>
          <h2>SolidLocker</h2>
          <p className="muted">Starting up…</p>
        </div>
      </div>
    );
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
    return (
      <div className="center">
        <div className="card">
          <span className="logoglow">
            <DialLogo className="setuplogo" label="" />
          </span>
          <h2>You need Git to continue</h2>
          <p>
            SolidLocker needs Git. GitHub Desktop brings everything you need in one
            install (Git, Git&nbsp;LFS, and the GitHub sign in).
          </p>
          <button onClick={() => openUrl("https://desktop.github.com/")}>
            Download GitHub Desktop
          </button>
          <p className="restart-callout">
            After installing GitHub Desktop,{" "}
            <strong>close SolidLocker completely and open it again.</strong>
          </p>
          <button onClick={() => appState.refetch()}>
            I&rsquo;ve installed it. Check again
          </button>
          <p className="muted small altinstall">
            Rather not use it?{" "}
            <a
              className="linkish inline"
              href="https://git-scm.com/download/win"
              onClick={(e) => {
                e.preventDefault();
                openUrl("https://git-scm.com/download/win");
              }}
            >
              Install Git for Windows
            </a>{" "}
            instead.
          </p>
        </div>
      </div>
    );
  }

  if (!state.repo) {
    return (
      <SetupWizard
        onDone={() => queryClient.invalidateQueries({ queryKey: ["appState"] })}
      />
    );
  }

  return <Dashboard appState={state} />;
}
