import { openUrl } from "@tauri-apps/plugin-opener";

const ISSUES_URL = "https://github.com/RU-Airborne/SolidLocker/issues";

export function BugReportDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Found a bug?</h2>
        <p>
          DM Scaven X (scaaavx) on Discord, or open an issue on GitHub. Attach
          the log from Settings if you can.
        </p>

        <div className="modal-actions">
          <button onClick={onClose}>Close</button>
          <button
            className="primary"
            onClick={() => openUrl(ISSUES_URL)}
          >
            Open an issue
          </button>
        </div>
      </div>
    </div>
  );
}
