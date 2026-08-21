import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { getOpenDocuments, previewVersion, restoreVersion } from "../../api";
import { formatDate, formatDateTime } from "../../dates";
import { isAppError } from "../../types";
import { RestoreDiagram } from "../common/HistoryDiagrams";
import type { VersionRef } from "./RestoreVersionDialog";

function OldThumb({ path, sha }: { path: string; sha: string }) {
  const thumb = useQuery({
    queryKey: ["previewVersion", path, sha],
    queryFn: () => previewVersion(path, sha),
    staleTime: Infinity,
    retry: false,
  });
  return (
    <span className="fthumb mergethumb" aria-hidden="true">
      {thumb.data && <img src={thumb.data} alt="" draggable={false} />}
    </span>
  );
}

export function RestoreFilesDialog({
  paths,
  commit,
  branchName,
  onDone,
  onClose,
}: {
  paths: string[];
  commit: VersionRef;
  branchName: string;
  onDone: (notice: string, restored: string[]) => void;
  onClose: () => void;
}) {
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const commitLabel = commit.message?.trim()
    ? commit.message
    : formatDate(commit.date);

  const selected = useMemo(
    () => paths.filter((p) => !unchecked.has(p)),
    [paths, unchecked],
  );

  const openDocs = useQuery({
    queryKey: ["openDocuments"],
    queryFn: getOpenDocuments,
    refetchInterval: 5000,
  });
  const openBlockers = useMemo(() => {
    const open = new Set((openDocs.data ?? []).map((p) => p.toLowerCase()));
    return selected.filter((p) => open.has(p.toLowerCase()));
  }, [openDocs.data, selected]);

  function toggle(p: string) {
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  async function restore() {
    if (selected.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await restoreVersion(selected, commit.sha);
      onDone(
        `${selected.length} file${selected.length === 1 ? " is" : "s are"} back to the version from ${formatDateTime(commit.date)}. Save & Share to send them to your team, or Undo to change your mind.`,
        selected,
      );
    } catch (e) {
      setError(isAppError(e) ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal versionmodal" onClick={(e) => e.stopPropagation()}>
        <h2>Restore files from this change</h2>
        <p>
          As they were on <strong>{formatDateTime(commit.date)}</strong>, by{" "}
          {commit.author_name}
          {commit.message?.trim() ? (
            <>
              {" "}
              — “<em>{commit.message}</em>”
            </>
          ) : null}
          .
        </p>

        <p className="small">Pick which files to bring back together:</p>
        <div className="ref-list restorepicker">
          {paths.map((p) => (
            <label key={p}>
              <input
                type="checkbox"
                checked={!unchecked.has(p)}
                onChange={() => toggle(p)}
              />
              <OldThumb path={p} sha={commit.sha} />
              <span>{p}</span>
            </label>
          ))}
        </div>

        {openBlockers.length > 0 && (
          <p className="error">
            Open in SolidWorks right now:{" "}
            {openBlockers.map((p) => p.split("/").pop()).join(", ")}. Close{" "}
            {openBlockers.length === 1 ? "it" : "them"} there first (without
            saving): SolidWorks would write its in-memory copy straight over
            the restored version.
          </p>
        )}

        <RestoreDiagram branchName={branchName} commitLabel={commitLabel} />
        <p className="muted small">
          Nothing is rewritten: the old versions are copied forward as your{" "}
          <em>next</em> change, and you can Undo until you Save &amp; Share.
          You need the selected files locked by you.
        </p>

        {error && <p className="errdetail">{error}</p>}

        <div className="modal-actions">
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="primary"
            onClick={restore}
            disabled={busy || selected.length === 0 || openBlockers.length > 0}
          >
            {busy
              ? "Bringing them back…"
              : `Bring back ${selected.length} file${selected.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
