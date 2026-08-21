import type { Lock } from "../../types";

export function ReleaseAllDialog({
  locks,
  onConfirm,
  onClose,
}: {
  locks: Lock[];
  onConfirm: () => void;
  onClose: () => void;
}) {
  const shown = locks.slice(0, 12);
  const rest = locks.length - shown.length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Release everything you hold</h2>
        <p>
          This unlocks {locks.length} file{locks.length === 1 ? "" : "s"} so
          your team can take {locks.length === 1 ? "it" : "them"}. Anything you
          have changed is shared first, so nothing is lost.
        </p>
        <ul className="releaselist">
          {shown.map((lock) => (
            <li key={lock.id}>{lock.path.split("/").pop() ?? lock.path}</li>
          ))}
          {rest > 0 && <li className="muted">and {rest} more</li>}
        </ul>
        <p className="muted small">
          A file still open in SolidWorks keeps its lock, close it and press
          this again.
        </p>
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={onConfirm}>
            Unlock {locks.length} file{locks.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}
