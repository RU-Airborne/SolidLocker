import { useEffect, useMemo, useState } from "react";
import { resolveReferences, type RefResolution } from "../../api";
import { playSensorAlert } from "../../sounds";
import type { LockStatus } from "../../types";

export function ClaimDialog({
  startPath,
  lockStatusByPath,
  onClaim,
  onClose,
}: {
  startPath: string;
  lockStatusByPath: Map<string, LockStatus>;
  onClaim: (paths: string[]) => void;
  onClose: () => void;
}) {
  const [refs, setRefs] = useState<RefResolution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    resolveReferences(startPath)
      .then((r) => {
        if (cancelled) return;
        // Reference lookup needs a running SolidWorks
        if (r.warning) playSensorAlert();
        setRefs(r);
        setChecked(
          new Set(
            r.resolved.filter(
              (p) =>
                lockStatusByPath.get(p.toLowerCase())?.kind !== "theirs" &&
                lockStatusByPath.get(p.toLowerCase())?.kind !== "mine",
            ),
          ),
        );
      })
      .catch((e) => !cancelled && setError(String(e?.message ?? e)));
    return () => {
      cancelled = true;
    };
  }, [startPath]);

  const blockedByOthers = useMemo(
    () =>
      (refs?.resolved ?? []).filter(
        (p) => lockStatusByPath.get(p.toLowerCase())?.kind === "theirs",
      ),
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Lock with parts</h2>
        <p className="muted">{startPath}</p>
        <p>
          SolidLocker has identified the following referenced parts through SolidWorks' API:
        </p>

        {error && <p className="error">{error}</p>}
        {!refs && !error && <p className="muted">Scanning references…</p>}

        {refs && (
          <>
            <div className="ref-list">
              {refs.resolved.map((path) => {
                const status = lockStatusByPath.get(path.toLowerCase());
                const theirs = status?.kind === "theirs";
                const mine = status?.kind === "mine";
                return (
                  <label key={path} className={theirs ? "ref-blocked" : ""}>
                    <input
                      type="checkbox"
                      checked={checked.has(path)}
                      disabled={theirs || mine}
                      onChange={() => toggle(path)}
                    />
                    <span>{path}</span>
                    {theirs && status.kind === "theirs" && (
                      <span className="badge badge-theirs">
                        locked by {status.lock.owner?.name ?? "another member"}
                      </span>
                    )}
                    {mine && <span className="badge badge-mine">already yours</span>}
                  </label>
                );
              })}

              {refs.warning && (
                <p className="warn-inline">{refs.warning}</p>
              )}
              {refs.suggestions.map((path) => {
                const status = lockStatusByPath.get(path.toLowerCase());
                const taken = status?.kind === "theirs" || status?.kind === "mine";
                return (
                  <label key={path}>
                    <input
                      type="checkbox"
                      checked={checked.has(path)}
                      disabled={taken}
                      onChange={() => toggle(path)}
                    />
                    <span>{path}</span>
                    {status?.kind === "theirs" && (
                      <span className="badge badge-theirs">
                        locked by {status.lock.owner?.name ?? "another member"}
                      </span>
                    )}
                    {status?.kind === "mine" && (
                      <span className="badge badge-mine">already yours</span>
                    )}
                  </label>
                );
              })}
              {refs.ambiguous.map((amb) => (
                <div key={amb.name} className="ref-ambiguous">
                  <p className="muted">
                    “{amb.name}” exists in several folders — check the right one(s):
                  </p>
                  {amb.candidates.map((candidate) => (
                    <label key={candidate}>
                      <input
                        type="checkbox"
                        checked={checked.has(candidate)}
                        onChange={() => toggle(candidate)}
                      />
                      <span>{candidate}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>

            {refs.unresolved.length > 0 && (
              <p className="muted">
                Referenced but not found in this repository (may be library/toolbox
                parts): {refs.unresolved.join(", ")}
              </p>
            )}

            {blockedByOthers.length > 0 && (
              <p className="error">
                {blockedByOthers.length} referenced file(s) are locked by someone
                else. You can lock the rest, but you may not be able to save
                changes that touch theirs.
              </p>
            )}

            <div className="modal-actions">
              <button onClick={onClose}>Cancel</button>
              <button
                className="primary"
                disabled={checked.size === 0}
                onClick={() => onClaim([...checked])}
              >
                Lock {checked.size} file{checked.size === 1 ? "" : "s"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
