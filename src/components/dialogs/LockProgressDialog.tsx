import type { LockProgress } from "../../api";

export type LockRunKind = "lock" | "unlock";

export interface LockRunState {
  kind: LockRunKind;
  paths: string[];
  steps: Map<string, LockProgress["state"]>;
  finished: boolean;
  cancelling?: boolean;
}

const WORD: Record<LockRunKind, { verb: string; doing: string }> = {
  lock: { verb: "Locking", doing: "locked" },
  unlock: { verb: "Unlocking", doing: "unlocked" },
};

function shortName(path: string) {
  return path.split("/").pop() ?? path;
}

export function LockProgressDialog({
  run,
  onCancel,
  onClose,
}: {
  run: LockRunState;
  onCancel: () => void;
  onClose: () => void;
}) {
  const { verb, doing } = WORD[run.kind];
  const settled = run.paths.filter((p) => {
    const state = run.steps.get(p);
    return state === "done" || state === "failed" || state === "undone";
  }).length;
  const done = run.paths.filter((p) => run.steps.get(p) === "done").length;
  const undone = run.paths.some((p) => run.steps.get(p) === "undone");

  return (
    <div
      className="modal-backdrop"
      onClick={run.finished ? onClose : undefined}
    >
      <div className="modal lockprogress" onClick={(e) => e.stopPropagation()}>
        <h2>
          {run.finished
            ? undone
              ? "Nothing was locked"
              : `${done} ${doing}`
            : `${verb} ${run.paths.length} file${run.paths.length === 1 ? "" : "s"}…`}
        </h2>
        <p className="muted small">
          {run.finished
            ? undone
              ? "One file was taken by someone else, so the ones already held were given back. Locking is all or nothing."
              : `${settled} of ${run.paths.length} handled.`
            : `${settled} of ${run.paths.length} so far. Each one is a round trip to GitHub.`}
        </p>

        <ul className="locksteps">
          {run.paths.map((path) => {
            const state = run.steps.get(path) ?? "waiting";
            return (
              <li key={path} className={`lockstep lockstep-${state}`}>
                <span className="lockstep-mark" aria-hidden="true">
                  {state === "done"
                    ? "✓"
                    : state === "failed"
                      ? "✕"
                      : state === "undone"
                        ? "↩"
                        : state === "working"
                          ? "…"
                          : ""}
                </span>
                <span className="lockstep-name" title={path}>
                  {shortName(path)}
                </span>
                <span className="lockstep-state muted small">
                  {state === "done"
                    ? doing
                    : state === "failed"
                      ? "could not"
                      : state === "undone"
                        ? "given back"
                        : state === "working"
                          ? `${verb.toLowerCase()}…`
                          : "waiting"}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="modal-actions">
          {run.finished ? (
            <button className="primary" onClick={onClose}>
              Okie
            </button>
          ) : (
            <button onClick={onCancel} disabled={run.cancelling}>
              {run.cancelling ? "Stopping…" : "Cancel"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
