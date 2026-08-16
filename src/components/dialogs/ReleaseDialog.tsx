import { useEffect, useMemo, useState } from "react";
import { resolveReferences, type RefResolution } from "../../api";
import { playSensorAlert } from "../../sounds";
import type { LockStatus } from "../../types";

export function ReleaseDialog({
  startPath,
  lockStatusByPath,
  onRelease,
  onClose,
}: {
  startPath: string;
  lockStatusByPath: Map<string, LockStatus>;
  onRelease: (paths: string[]) => void;
  onClose: () => void;
}) {
  const [refs, setRefs] = useState<RefResolution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const isMine = (path: string) =>
    lockStatusByPath.get(path.toLowerCase())?.kind === "mine";

  useEffect(() => {
    let cancelled = false;
    resolveReferences(startPath)
      .then((r) => {
        if (cancelled) return;
        if (r.warning) playSensorAlert();
        setRefs(r);
        setChecked(new Set(r.resolved.filter(isMine)));
      })
      .catch((e) => !cancelled && setError(String(e?.message ?? e)));
    return () => {
      cancelled = true;
    };
  }, [startPath]);

  const notMineCount = useMemo(
    () => (refs?.resolved ?? []).filter((p) => !isMine(p)).length,
    [refs, lockStatusByPath],
  );

  function toggle(path: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function renderRow(path: string) {
    const status = lockStatusByPath.get(path.toLowerCase());
    const mine = status?.kind === "mine";
    const theirs = status?.kind === "theirs";
    return (
      <label key={path} className={mine ? "" : "ref-blocked"}>
        <input
          type="checkbox"
          checked={checked.has(path)}
          disabled={!mine}
          onChange={() => toggle(path)}
        />
        <span>{path}</span>
        {theirs && status.kind === "theirs" && (
          <span className="badge badge-theirs">
            locked by {status.lock.owner?.name ?? "another member"}
          </span>
        )}
        {!mine && !theirs && <span className="badge">not locked</span>}
      </label>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Unlock with parts</h2>
        <p className="muted">{startPath}</p>

        {error && <p className="error">{error}</p>}
        {!refs && !error && <p className="muted">Scanning references…</p>}

        {refs && (
          <>
            <div className="ref-list">
              {refs.resolved.map(renderRow)}

              {refs.warning && <p className="warn-inline">{refs.warning}</p>}
              {refs.suggestions.filter(isMine).map(renderRow)}
              {refs.ambiguous.map((amb) => (
                <div key={amb.name} className="ref-ambiguous">
                  <p className="muted">
                    “{amb.name}” exists in several folders, check the right
                    one(s):
                  </p>
                  {amb.candidates.map(renderRow)}
                </div>
              ))}
            </div>

            {refs.unresolved.length > 0 && (
              <p className="muted">
                Referenced but not found in this repository (may be library/toolbox
                parts): {refs.unresolved.join(", ")}
              </p>
            )}

            {notMineCount > 0 && (
              <p className="muted">
                {notMineCount} referenced file{notMineCount === 1 ? " is" : "s are"} not
                yours to unlock and will be skipped.
              </p>
            )}

            <p className="muted">
              Close these files in SolidWorks first. A file still open there can
              be saved over even after you unlock it. Files with changes not yet
              on GitHub will refuse to unlock until you Save &amp; Share.
            </p>

            <div className="modal-actions">
              <button onClick={onClose}>Cancel</button>
              <button
                className="primary"
                disabled={checked.size === 0}
                onClick={() => onRelease([...checked])}
              >
                Unlock {checked.size} file{checked.size === 1 ? "" : "s"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
