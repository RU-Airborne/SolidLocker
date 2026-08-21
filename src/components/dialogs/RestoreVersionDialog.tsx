import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { previewVersion, restoreVersion, type FileCommit } from "../../api";
import { formatDateTime } from "../../dates";
import { isAppError } from "../../types";

export function RestoreVersionDialog({
  path,
  commit,
  onDone,
  onClose,
}: {
  path: string;
  commit: FileCommit;
  onDone: (notice: string) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = path.split("/").pop() ?? path;

  const preview = useQuery({
    queryKey: ["previewVersion", path, commit.sha],
    queryFn: () => previewVersion(path, commit.sha),
    staleTime: Infinity,
    retry: false,
  });

  async function restore() {
    setBusy(true);
    setError(null);
    try {
      await restoreVersion(path, commit.sha);
      onDone(
        `${name} is back to the version from ${formatDateTime(commit.date)}. Save & Share to send it to your team.`,
      );
    } catch (e) {
      setError(isAppError(e) ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Bring back an earlier version</h2>
        <p>
          <strong>{name}</strong> as it was on{" "}
          {formatDateTime(commit.date)}, by {commit.author_name}.
        </p>

        <div className="versionpreview">
          {preview.isLoading && (
            <span className="muted small">Fetching this version…</span>
          )}
          {preview.isError && (
            <span className="muted small">
              Could not read this version from GitHub.
            </span>
          )}
          {preview.isSuccess &&
            (preview.data ? (
              <img src={preview.data} alt={`${name} as it was`} />
            ) : (
              <span className="muted small">
                No preview available for this version.
              </span>
            ))}
        </div>

        <p className="muted small">
          Nothing is rewritten: this version becomes your next change, so the
          history in between is kept. You need the file locked and closed in
          SolidWorks.
        </p>
        {error && <p className="errdetail">{error}</p>}

        <div className="modal-actions">
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary" onClick={restore} disabled={busy}>
            {busy ? "Bringing it back…" : "Bring this version back"}
          </button>
        </div>
      </div>
    </div>
  );
}
