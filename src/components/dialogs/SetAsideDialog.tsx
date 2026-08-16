import { useState } from "react";
import { setAsideFiles, switchBranch } from "../../api";
import { isAppError } from "../../types";

export function SetAsideDialog({
  branch,
  files,
  onDone,
  onClose,
}: {
  branch: string;
  files: string[];
  onDone: (notice: string) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function moveAndSwitch() {
    setBusy(true);
    setError(null);
    try {
      const backupDir = await setAsideFiles(files);
      await switchBranch(branch);
      onDone(
        `Moved ${files.length} file${files.length === 1 ? "" : "s"} to ${backupDir} and switched to ${branch}.`,
      );
    } catch (e) {
      setError(isAppError(e) ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Files in the way of switching</h2>
        <p>
          These files on your computer aren't saved to the project, and{" "}
          <strong>{branch}</strong> has its own versions of them:
        </p>
        <ul>
          {files.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <p className="muted">
          SolidLocker can move your copies to a safe backup folder next to the
          project (nothing is deleted), then finish the switch.
        </p>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary" onClick={moveAndSwitch} disabled={busy}>
            {busy ? "Moving…" : `Move files & switch to ${branch}`}
          </button>
        </div>
      </div>
    </div>
  );
}
