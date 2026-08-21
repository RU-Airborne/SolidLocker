import { useState } from "react";

import { createBranch } from "../../api";
import { isAppError } from "../../types";
import { GlassSelect } from "../common/GlassSelect";
import {
  BranchDiagram,
  FreshBranchDiagram,
} from "../common/HistoryDiagrams";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function CreateBranchDialog({
  branches,
  currentBranch,
  onCreated,
  onClose,
}: {
  branches: string[];
  currentBranch: string;
  onCreated: (name: string, fresh: boolean) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"from" | "fresh">("from");
  const [source, setSource] = useState(currentBranch);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleaned = slugify(name);

  const sourceOptions = [
    ...(branches.includes(currentBranch) ? [] : [currentBranch]),
    ...branches,
  ];

  async function go() {
    if (!cleaned || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createBranch(cleaned, mode === "from" ? source : null);
      onCreated(cleaned, mode === "fresh");
    } catch (e) {
      setError(isAppError(e) ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New branch</h2>

        <div className="setuprow">
          <input
            placeholder="Name it, e.g. motor-mount-rework"
            value={name}
            disabled={busy}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go()}
          />
        </div>
        {cleaned && cleaned !== name.trim() && (
          <p className="muted small">Will be created as “{cleaned}”.</p>
        )}

        <div className="branchscope" role="radiogroup">
          <label className={mode === "from" ? "picked" : ""}>
            <input
              type="radio"
              name="newbranchmode"
              checked={mode === "from"}
              onChange={() => setMode("from")}
            />
            <span>
              <strong>Continue from an existing branch</strong>
              <span className="vt-sub">
                Starts with everything that branch has currently.
              </span>
              {mode === "from" && (
                <GlassSelect
                  className="settingselect"
                  ariaLabel="Branch to start from"
                  value={source}
                  onChange={setSource}
                  options={sourceOptions.map((b) => ({
                    value: b,
                    label: b === currentBranch ? `${b} (current)` : b,
                  }))}
                />
              )}
            </span>
          </label>
          <label className={mode === "fresh" ? "picked" : ""}>
            <input
              type="radio"
              name="newbranchmode"
              checked={mode === "fresh"}
              onChange={() => setMode("fresh")}
            />
            <span>
              <strong>Start completely fresh</strong>
              <span className="vt-sub">
                An empty project with no files carried over, Git LFS
                locking set up from the first commit. For a brand new design in
                the same repository.
              </span>
            </span>
          </label>
        </div>

        {mode === "from" ? (
          <BranchDiagram
            branchName={source}
            newBranchName={cleaned || undefined}
            commitLabel={`${source} as it is today`}
          />
        ) : (
          <FreshBranchDiagram newBranchName={cleaned || undefined} />
        )}

        {error && <p className="errdetail">{error}</p>}

        <div className="modal-actions">
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary" onClick={go} disabled={busy || !cleaned}>
            {busy ? "Creating…" : "Create and switch to it"}
          </button>
        </div>
      </div>
    </div>
  );
}
