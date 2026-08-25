import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { planUndo, undoChange, type UndoPlan } from "../../api";
import { formatDateTime } from "../../dates";
import { isAppError } from "../../types";
import type { VersionRef } from "./RestoreVersionDialog";

const shortName = (p: string) => p.split("/").pop() ?? p;

/** Undo a shared change by committing the earlier versions on top. */
export function UndoChangeDialog({
  commit,
  onDone,
  onClose,
}: {
  commit: VersionRef;
  onDone: (notice: string, touched: string[]) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan = useQuery<UndoPlan>({
    queryKey: ["undoPlan", commit.sha],
    queryFn: () => planUndo(commit.sha),
    staleTime: Infinity,
    retry: false,
  });

  const touched = [...(plan.data?.restore ?? []), ...(plan.data?.remove ?? [])];

  function run() {
    setBusy(true);
    setError(null);
    undoChange(commit.sha)
      .then(() => {
        onDone(
          `Undone. ${touched.length} file${touched.length === 1 ? "" : "s"} went back to how they were before. Save & Share to send it, or Undo to change your mind.`,
          touched,
        );
      })
      .catch((e) => {
        setError(isAppError(e) ? e.message : String(e));
        setBusy(false);
      });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Undo this change?</h2>
        <p>
          Made on <strong>{formatDateTime(commit.date)}</strong> by{" "}
          {commit.author_name}
          {commit.message?.trim() ? (
            <>
              , “<em>{commit.message}</em>”
            </>
          ) : null}
          .
        </p>

        {plan.isLoading && <p className="muted small">Working out what it did…</p>}
        {plan.isError && (
          <p className="errdetail">
            {isAppError(plan.error) ? plan.error.message : String(plan.error)}
          </p>
        )}

        {plan.data && (
          <>
            {plan.data.restore.length > 0 && (
              <>
                <p className="small">
                  {plan.data.restore.length === 1
                    ? "This file goes back to how it was before:"
                    : `These ${plan.data.restore.length} files go back to how they were before:`}
                </p>
                <ul className="filelist">
                  {plan.data.restore.slice(0, 10).map((p) => (
                    <li key={p} title={p}>
                      {shortName(p)}
                    </li>
                  ))}
                  {plan.data.restore.length > 10 && (
                    <li className="muted">
                      …and {plan.data.restore.length - 10} more
                    </li>
                  )}
                </ul>
              </>
            )}

            {plan.data.remove.length > 0 && (
              <>
                <p className="small">
                  {plan.data.remove.length === 1
                    ? "This file was added by the change, so it goes away again:"
                    : `These ${plan.data.remove.length} files were added by the change, so they go away again:`}
                </p>
                <ul className="filelist">
                  {plan.data.remove.slice(0, 10).map((p) => (
                    <li key={p} title={p}>
                      {shortName(p)}
                    </li>
                  ))}
                  {plan.data.remove.length > 10 && (
                    <li className="muted">
                      …and {plan.data.remove.length - 10} more
                    </li>
                  )}
                </ul>
              </>
            )}

            {touched.length === 0 && (
              <p className="muted small">
                This change touched no files that can be put back.
              </p>
            )}

            <p className="muted small">
              Nothing is erased: the change stays in the record and the undo
              is added after it. You need these files locked by you, and you
              can Undo until you Save &amp; Share.
            </p>
          </>
        )}

        {error && <p className="errdetail">{error}</p>}

        <div className="modal-actions">
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="danger"
            onClick={run}
            disabled={busy || !plan.data || touched.length === 0}
          >
            {busy ? "Undoing…" : "Undo it"}
          </button>
        </div>
      </div>
    </div>
  );
}
