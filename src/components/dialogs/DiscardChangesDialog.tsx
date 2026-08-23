/** Tracked edits are restored; untracked files are moved out, not deleted. */
export function DiscardChangesDialog({
  files,
  untracked,
  onConfirm,
  onClose,
}: {
  files: string[];
  untracked: string[];
  onConfirm: () => void;
  onClose: () => void;
}) {
  const both = files.length > 0 && untracked.length > 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>
          {files.length === 0
            ? "Clear out new files?"
            : "Discard your changes?"}
        </h2>

        {files.length > 0 && (
          <>
            <p>
              {files.length === 1
                ? "This file goes back"
                : `These ${files.length} files go back`}{" "}
              to the last shared version. The work in them since then is gone
              for good. There is no undo for this one.
            </p>
            <ul className="filelist">
              {files.slice(0, 10).map((p) => (
                <li key={p}>{p}</li>
              ))}
              {files.length > 10 && (
                <li className="muted">…and {files.length - 10} more</li>
              )}
            </ul>
          </>
        )}

        {untracked.length > 0 && (
          <>
            <p>
              {both ? "As well, " : ""}
              {untracked.length === 1
                ? "one file has"
                : `${untracked.length} files have`}{" "}
              never been shared, so there is nothing to go back to. They are
              moved to a folder next to the project, not deleted, so you can
              get them back.
            </p>
            <ul className="filelist">
              {untracked.slice(0, 10).map((p) => (
                <li key={p}>{p}</li>
              ))}
              {untracked.length > 10 && (
                <li className="muted">…and {untracked.length - 10} more</li>
              )}
            </ul>
          </>
        )}

        <p className="muted small">
          Close these files in SolidWorks first, or it may write its open copy
          right back.
        </p>
        <div className="modal-actions">
          <button onClick={onClose}>Keep everything</button>
          <button className="danger" onClick={onConfirm}>
            {files.length === 0
              ? "Move them out"
              : `Discard ${files.length === 1 ? "it" : "them"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
