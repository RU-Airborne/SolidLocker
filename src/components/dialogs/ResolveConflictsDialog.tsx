import { useReducer, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  abandonConflicts,
  combineWithPicks,
  conflictSides,
  finishConflicts,
  listConflicts,
  planConflicts,
  type Conflict,
} from "../../api";
import { isAppError } from "../../types";
import { clearPicks, picksFor } from "../../conflictPicks";
import { ConflictPicker } from "../common/ConflictPicker";

export function ResolveConflictsDialog({
  plan,
  ours,
  onDone,
  onClose,
  onOpenCommit,
}: {
  plan?: string;
  ours: string;
  onDone: (notice: string) => void;
  onClose: () => void;
  onOpenCommit?: (sha: string) => void;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = plan ? `branch:${plan}` : "live";
  const picks = picksFor(key);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  const sides = useQuery({
    queryKey: ["conflictSides"],
    queryFn: conflictSides,
    enabled: !plan,
    staleTime: Infinity,
    retry: false,
  });
  const theirName = plan ?? sides.data?.[1] ?? "the other branch";
  const ourName = plan ? ours : (sides.data?.[0] ?? ours);

  const conflicts = useQuery<Conflict[]>({
    queryKey: plan ? ["planConflicts", plan] : ["conflicts"],
    queryFn: () => (plan ? planConflicts(plan) : listConflicts()),
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  const files = conflicts.data ?? [];
  const left = files.filter((c) => !picks.has(c.path)).length;

  function finish() {
    setBusy(true);
    setError(null);
    const list = [...picks].map(([path, side]) => ({ path, side }));
    (plan ? combineWithPicks(plan, list) : finishConflicts(list))
      .then(() => {
        clearPicks(key);
        queryClient.invalidateQueries();
        onDone(
          `Combined and shared. ${files.length} file${files.length === 1 ? "" : "s"} settled.`,
        );
      })
      .catch((e) => {
        setError(isAppError(e) ? e.message : String(e));
        setBusy(false);
      });
  }

  function abandon() {
    // nothing in git to undo yet when there is a plan
    if (plan) {
      clearPicks(key);
      onDone("Left as it was. Nothing was combined.");
      return;
    }
    setBusy(true);
    abandonConflicts()
      .then(() => {
        clearPicks(key);
        queryClient.invalidateQueries();
        onDone("Left as it was. Nothing was combined.");
      })
      .catch((e) => {
        setError(isAppError(e) ? e.message : String(e));
        setBusy(false);
      });
  }

  return (
    <div className="modal-backdrop">
      <div className="modal conflictmodal">
        <h2>Same file, two versions</h2>
        <p className="muted small">
          {files.length} file{files.length === 1 ? "" : "s"} changed on both
          branches. CAD files can&rsquo;t be merged, so pick which version to
          keep. Nothing happens until you press Combine; picks are kept if you
          close this and come back.
        </p>

        {conflicts.isLoading && (
          <p className="muted small">Reading both branches…</p>
        )}
        {conflicts.isError && (
          <p className="errdetail">
            {isAppError(conflicts.error)
              ? conflicts.error.message
              : String(conflicts.error)}
          </p>
        )}

        {files.length > 0 && (
          <ConflictPicker
            files={files}
            ours={ourName}
            theirs={theirName}
            picks={picks}
            onChange={bump}
            onOpenCommit={onOpenCommit}
            busy={busy}
          />
        )}

        {error && <p className="errdetail">{error}</p>}

        <div className="modal-actions">
          <button onClick={onClose} disabled={busy}>
            Come back to this
          </button>
          <button onClick={abandon} disabled={busy}>
            Leave it alone
          </button>
          <button
            className="primary"
            onClick={finish}
            disabled={busy || left > 0 || files.length === 0}
          >
            {busy ? "Combining…" : left > 0 ? `${left} still to pick` : "Combine"}
          </button>
        </div>
      </div>
    </div>
  );
}
