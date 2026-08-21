import { abortMerge, resolveKeepTheirs } from "../../api";

export function ConflictDialog({
  files,
  onDone,
}: {
  files: string[];
  onDone: (notice: string | null) => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>Update conflict</h2>
        <p>
          These text files were changed both on your computer and on GitHub:
        </p>
        <ul>
          {files.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <p className="muted">
          “Keep GitHub's version” throws away your local edits to these files.
          “Cancel update” leaves everything as it was before Get Latest.
        </p>
        <div className="modal-actions">
          <button
            onClick={() =>
              abortMerge()
                .then(() => onDone("Update cancelled. Nothing was changed."))
                .catch((e) => onDone(String(e)))
            }
          >
            Cancel update
          </button>
          <button
            className="primary"
            onClick={() =>
              resolveKeepTheirs(files)
                .then(() => onDone("Kept GitHub's version of the conflicting files."))
                .catch((e) => onDone(String(e)))
            }
          >
            Keep GitHub's version
          </button>
        </div>
      </div>
    </div>
  );
}
