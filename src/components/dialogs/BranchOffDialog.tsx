import { useState } from "react";
import { branchFromCommit } from "../../api";
import { isAppError } from "../../types";
import { BranchDiagram } from "../common/HistoryDiagrams";

/** Suggest a safe branch name from free text. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function BranchOffForm({
  sha,
  branchName,
  commitLabel,
  onBranched,
  perform,
}: {
  sha: string;
  branchName: string;
  commitLabel?: string;
  onBranched: (name: string) => void;
  perform?: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleaned = slugify(name);

  async function go() {
    if (!cleaned || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (perform) {
        await perform(cleaned);
      } else {
        await branchFromCommit(cleaned, sha);
      }
      onBranched(cleaned);
    } catch (e) {
      setError(isAppError(e) ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="branchoff">
      <BranchDiagram
        branchName={branchName}
        newBranchName={cleaned || undefined}
        commitLabel={commitLabel}
      />
      <div className="setuprow">
        <input
          placeholder="Name the new branch, e.g. motor-mount-rework"
          value={name}
          disabled={busy}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
        />
        <button className="primary" disabled={busy || !cleaned} onClick={go}>
          {busy ? "Starting…" : "Start branch"}
        </button>
      </div>
      {cleaned && cleaned !== name.trim() && (
        <p className="muted small">Will be created as “{cleaned}”.</p>
      )}
      {error && <p className="errdetail">{error}</p>}
    </div>
  );
}

export function BranchOffDialog({
  sha,
  label,
  branchName,
  onBranched,
  onClose,
}: {
  sha: string;
  label: string;
  branchName: string;
  onBranched: (name: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Branch off from here</h2>
        <p>
          Starting point: <strong>{label}</strong>
        </p>
        <BranchOffForm
          sha={sha}
          branchName={branchName}
          commitLabel={label}
          onBranched={onBranched}
        />
        <p className="muted small">
          A branch is a separate line of work. Your team&rsquo;s branch stays
          exactly as it is. You continue from this older moment on a new branch,
          and the two can be compared or combined later. Locks still apply
          across all branches.
        </p>
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
