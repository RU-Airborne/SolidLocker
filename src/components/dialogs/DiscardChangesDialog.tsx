/** Throw away everything changed since the last Save & Share */
export function DiscardChangesDialog({
  files,
  untrackedCount,
  onConfirm,
  onClose,
}: {
  files: string[];
  untrackedCount: number;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Discard your changes?</h2>
        <p>
          {files.length === 1
            ? "This file goes back"
            : `These ${files.length} files go back`}{" "}
          to the last shared version. The work in them since then is gone for
          good. There is no undo for this one.
        </p>
        <ul className="discardlist">
          {files.slice(0, 10).map((p) => (
            <li key={p}>{p}</li>
          ))}
          {files.length > 10 && (
            <li className="muted">…and {files.length - 10} more</li>
          )}
        </ul>
        {untrackedCount > 0 && (
          <p className="muted small">
            {untrackedCount} brand-new file{untrackedCount === 1 ? "" : "s"}{" "}
            (never shared) will be left alone.
          </p>
        )}
        <p className="muted small">
          Close these files in SolidWorks first, or it may write its open copy
          right back.
        </p>
        <div className="modal-actions">
          <button onClick={onClose}>Keep my changes</button>
          <button className="danger" onClick={onConfirm}>
            Discard {files.length === 1 ? "it" : "them"}
          </button>
        </div>
      </div>
    </div>
  );
}
