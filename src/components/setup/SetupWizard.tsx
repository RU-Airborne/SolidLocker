import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { cloneRepo, selectExistingRepo } from "../../api";
import { isAppError } from "../../types";
import DialLogo from "../DialLogo";

export function SetupWizard({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [cloning, setCloning] = useState(false);
  const [opening, setOpening] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  async function pickExisting() {
    if (cloning || opening) return;
    setError(null);
    const dir = await open({
      directory: true,
      title: "Select your team's repository folder",
    });
    if (typeof dir !== "string") return;
    // Stays on until the dashboard replaces this screen: after the backend
    // accepts the repo, the app state still has to refetch, and dropping the
    // spinner early would flash the setup screen as if nothing had happened.
    setOpening(true);
    try {
      await selectExistingRepo(dir);
      onDone();
    } catch (e) {
      setOpening(false);
      setError(isAppError(e) ? e.message : String(e));
    }
  }

  if (opening) {
    return (
      <div className="center">
        <div className="card launchscreen" role="status" aria-live="polite">
          <span className="logoglow">
            <DialLogo className="setuplogo" label="" spinning />
          </span>
          <h2>Opening your project…</h2>
          <p className="muted">
            Checking the repository and preparing the CAD files. The first open
            of a large project can take a few minutes.
          </p>
        </div>
      </div>
    );
  }

  async function startClone() {
    if (cloning || url.trim() === "") return;
    setError(null);
    const parent = await open({
      directory: true,
      title: "Choose where to put the project folder",
    });
    if (typeof parent !== "string") return;
    setCloning(true);
    setProgress("Contacting GitHub…");
    try {
      await cloneRepo(url.trim(), parent, (line) => setProgress(line));
      onDone();
    } catch (e) {
      setError(isAppError(e) ? e.message : String(e));
    } finally {
      setCloning(false);
      setProgress(null);
    }
  }

  return (
    <div className="center">
      <div className="card setupcard">
        <span className="logoglow">
          <DialLogo className="setuplogo" label="" spinning={cloning} />
        </span>
        <h1>SolidLocker</h1>

        <div className="setupsection">
          <h3>Download a Git LFS project</h3>
          <p className="muted">
            Paste the repository link from GitHub's green &ldquo;Code&rdquo;
            button.
          </p>
          <div className="setuprow">
            <input
              placeholder="https://github.com/your-team/your-project"
              value={url}
              disabled={cloning}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && startClone()}
            />
            <button
              className="primary"
              disabled={cloning || url.trim() === ""}
              onClick={startClone}
            >
              {cloning ? "Downloading…" : "Download"}
            </button>
          </div>
          {progress && <p className="muted progressline">{progress}</p>}
        </div>

        <div className="setupdivider">or</div>

        <div className="setupsection">
          <h3>Already downloaded?</h3>
          <button className="setup-primary" onClick={pickExisting} disabled={cloning}>
            Select repository folder…
          </button>
        </div>

        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
