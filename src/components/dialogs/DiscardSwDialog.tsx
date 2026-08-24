/** Unlock was held back: these files have unsaved changes in SolidWorks. */
export function DiscardSwDialog({
  paths,
  onConfirm,
  onClose,
}: {
  paths: string[];
  onConfirm: () => void;
  onClose: () => void;
}) {
  const one = paths.length === 1;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Unsaved changes in SolidWorks</h2>
        <p>
          {one ? "This file has" : `These ${paths.length} files have`} changes
          in SolidWorks that were never saved, so unlocking now would leave
          that work stranded. Save {one ? "it" : "them"} in SolidWorks to keep
          the work, or discard {one ? "it" : "them"} here and unlock right
          away.
        </p>
        <ul className="filelist">
          {paths.slice(0, 10).map((p) => (
            <li key={p}>{p}</li>
          ))}
          {paths.length > 10 && (
            <li className="muted">…and {paths.length - 10} more</li>
          )}
        </ul>
        <p className="muted small">
          Discarding closes {one ? "the file" : "the files"} in SolidWorks
          without saving. The unsaved work is gone for good; the last shared
          version stays safe.
        </p>
        <div className="modal-actions">
          <button onClick={onClose}>Keep the changes</button>
          <button className="danger" onClick={onConfirm}>
            Discard &amp; unlock
          </button>
        </div>
      </div>
    </div>
  );
}
