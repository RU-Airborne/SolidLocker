// const shortName = (p: string) => p.split("/").pop() ?? p;

/** Confirm before locking/unlocking a whole folder. */
export function FolderLockDialog({
  kind,
  folder,
  paths,
  onConfirm,
  onClose,
}: {
  kind: "lock" | "unlock";
  folder: string;
  paths: string[];
  onConfirm: () => void;
  onClose: () => void;
}) {
  const locking = kind === "lock";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      {/* same class as the progress dialog that follows, so the box
          does not change size or tone when confirm turns into progress */}
      <div className="modal lockprogress" onClick={(e) => e.stopPropagation()}>
        <h2>
          {locking ? "Lock" : "Unlock"} {paths.length}{" "}
          {paths.length === 1 ? "file" : "files"} in {folder}?
        </h2>
        <p className="muted small">
          {locking
            ? "They become yours to edit until you unlock them. Each one is a separate call to GitHub, so this takes a moment."
            : "They go back to the team. Any file with unshared changes is kept back and stays yours."}
        </p>

        <ul className="filelist">
          {paths.slice(0, 12).map((p) => (
            <li key={p} title={p}>
              {p}
            </li>
          ))}
          {paths.length > 12 && (
            <li className="muted">…and {paths.length - 12} more</li>
          )}
        </ul>

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={onConfirm}>
            {locking ? "Lock them" : "Unlock them"}
          </button>
        </div>
      </div>
    </div>
  );
}
