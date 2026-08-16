import { openUrl } from "@tauri-apps/plugin-opener";

export function BugReportDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Found a bug?</h2>
        <p>DM Scaven X (scaaavx) on Discord, or open an issue on GitHub.</p>

        <div className="modal-actions">
          <button onClick={onClose}>Close</button>
          <button
            className="primary"
            onClick={() => openUrl("https://github.com")}
          >
            Open GitHub
          </button>
        </div>
      </div>
    </div>
  );
}
