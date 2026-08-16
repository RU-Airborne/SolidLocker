import { useState } from "react";
import { isSwTemp } from "../../types";
import { copy } from "../../copy";

export function CommitDialog({
  dirtyFiles,
  sizeByPath,
  deletedPaths,
  lockedByMe,
  bigFileMb,
  onSave,
  onClose,
  saving,
}: {
  dirtyFiles: string[];
  sizeByPath: Map<string, number>;
  /** Files being removed by this share. */
  deletedPaths: Set<string>;
  /** Paths you currently hold, lowercased. */
  lockedByMe: Set<string>;
  bigFileMb: number;
  onSave: (message: string, paths: string[]) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const message = description.trim()
    ? `${summary.trim()}\n\n${description.trim()}`
    : summary.trim();
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(dirtyFiles.filter((p) => !isSwTemp(p))),
  );

  function toggle(path: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Save &amp; Share</h2>
        <p className="muted">
          These changes will be saved to GitHub so your teammates can see them.
        </p>
        <div className="ref-list">
          {dirtyFiles.map((path) => {
            const size = sizeByPath.get(path) ?? 0;
            const isBig = bigFileMb > 0 && size > bigFileMb * 1024 * 1024;
            return (
              <label key={path}>
                <input
                  type="checkbox"
                  checked={checked.has(path)}
                  onChange={() => toggle(path)}
                />
                <span>{path}</span>
                {isSwTemp(path) && (
                  <span className="badge">SolidWorks temp — no need to share</span>
                )}
                {isBig && (
                  <span className="badge badge-edited">
                    {(size / (1024 * 1024)).toFixed(0)} MB
                  </span>
                )}
                {deletedPaths.has(path) && (
                  <span className="badge badge-deleted">Removes this file</span>
                )}
              </label>
            );
          })}
        </div>
        {(() => {
          const unlockedDeletes = [...checked].filter(
            (p) => deletedPaths.has(p) && !lockedByMe.has(p.toLowerCase()),
          );
          return unlockedDeletes.length > 0 ? (
            <p className="warn-inline">
              {copy.deletingUnlocked(unlockedDeletes)}
            </p>
          ) : null;
        })()}
        {bigFileMb > 0 &&
          (() => {
            const bigCount = [...checked].filter(
              (p) => (sizeByPath.get(p) ?? 0) > bigFileMb * 1024 * 1024,
            ).length;
            return bigCount > 0 ? (
              <p className="warn-inline">{copy.bigFileNote(bigCount, bigFileMb)}</p>
            ) : null;
          })()}
        <input
          className="commit-message"
          placeholder="Summary, e.g. Moved main spar closer to the leading edge"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
        <textarea
          className="commit-message commit-description"
          rows={3}
          placeholder="Description (optional). Why you changed it, what teammates should know."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="modal-actions">
          <button onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={saving || checked.size === 0 || summary.trim() === ""}
            onClick={() => onSave(message, [...checked])}
          >
            {saving
              ? "Sharing…"
              : checked.size === 0
                ? "Select files to share"
                : summary.trim() === ""
                  ? "Add a summary first"
                  : `Share ${checked.size} file${checked.size === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
