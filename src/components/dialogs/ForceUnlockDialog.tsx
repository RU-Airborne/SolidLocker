import { useState } from "react";
import { forceUnlock } from "../../api";
import type { Lock } from "../../types";
import { isAppError } from "../../types";

export function ForceUnlockDialog({
  lock,
  onDone,
  onClose,
}: {
  lock: Lock;
  onDone: (notice: string) => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filename = lock.path.split("/").pop() ?? lock.path;
  const owner = lock.owner?.name ?? "another member";

  async function doForce() {
    setBusy(true);
    setError(null);
    try {
      await forceUnlock(lock.path);
      onDone(`Force-unlocked ${filename} (was locked by ${owner}).`);
    } catch (e) {
      setError(isAppError(e) ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Force-unlock a file</h2>
        <p>
          This takes the lock on <strong>{filename}</strong> away from{" "}
          <strong>{owner}</strong> without their knowledge. If they still have
          unsaved work on it, that work can be lost when someone else edits the
          file.
        </p>
        <p className="muted">Type the file name to confirm:</p>
        <input
          className="commit-message"
          placeholder={filename}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          disabled={busy}
        />
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="danger"
            disabled={busy || typed.trim().toLowerCase() !== filename.toLowerCase()}
            onClick={doForce}
          >
            {busy ? "Unlocking…" : "Force-unlock"}
          </button>
        </div>
      </div>
    </div>
  );
}
