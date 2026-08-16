import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { cloneRepo, selectExistingRepo } from "../../api";
import { isAppError } from "../../types";
import logo from "../../assets/logo.png";

export function SetupWizard({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [cloning, setCloning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  async function pickExisting() {
    if (cloning) return;
    setError(null);
    const dir = await open({
      directory: true,
      title: "Select your team's repository folder",
    });
    if (typeof dir !== "string") return;
    try {
      await selectExistingRepo(dir);
      onDone();
    } catch (e) {
      setError(isAppError(e) ? e.message : String(e));
    }
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
          <img src={logo} alt="" className="setuplogo" />
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
