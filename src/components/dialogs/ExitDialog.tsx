import { useState } from "react";

export function ExitDialog({
  heldCount,
  onStayInTray,
  onQuit,
  onCancel,
}: {
  heldCount: number;
  onStayInTray: (remember: boolean) => void;
  onQuit: (remember: boolean) => void;
  onCancel: () => void;
}) {
  const [remember, setRemember] = useState(false);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>SolidLocker will keep running in the background</h2>
        <p className="muted">
          Closing this window leaves SolidLocker running in the system tray. It keeps protecting your files, keeps your locks
          visible to teammates, and can tell you when a file you are waiting on
          becomes free.
        </p>
        {heldCount > 0 && (
          <p className="warn-inline">
            You hold {heldCount} locked file{heldCount === 1 ? "" : "s"}. If
            you quit completely, teammates still cannot work on{" "}
            {heldCount === 1 ? "it" : "them"} until you unlock{" "}
            {heldCount === 1 ? "it" : "them"}.
          </p>
        )}
        <label className="togglerow">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span>Remember my choice and stop asking</span>
        </label>
        <div className="modal-actions">
          <button onClick={onCancel}>Stay open</button>
          <button onClick={() => onQuit(remember)}>Quit completely</button>
          <button className="primary" onClick={() => onStayInTray(remember)}>
            Keep running in background
          </button>
        </div>
      </div>
    </div>
  );
}
