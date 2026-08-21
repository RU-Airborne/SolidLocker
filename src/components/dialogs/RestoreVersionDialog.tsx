import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  branchFromCommitFiles,
  getOpenDocuments,
  openVersion,
  previewVersion,
  resolveReferencesAt,
  restoreVersion,
} from "../../api";
import { formatDate, formatDateTime } from "../../dates";
import { isAppError } from "../../types";
import {
  BranchGlyph,
  RestoreDiagram,
  RestoreGlyph,
} from "../common/HistoryDiagrams";
import { BranchOffForm } from "./BranchOffDialog";

/** The commit fields the dialog needs; both FileCommit and CommitInfo fit. */
export interface VersionRef {
  sha: string;
  date: string;
  author_name: string;
  /** Commit subject, when the caller has it — used to label the diagrams. */
  message?: string;
}

export function RestoreVersionDialog({
  path,
  commit,
  branchName,
  branchScopeDefault,
  onDone,
  onBranchedOff,
  onClose,
}: {
  path: string;
  commit: VersionRef;
  branchName: string;
  branchScopeDefault?: "all" | "file";
  onDone: (notice: string, restored: string[]) => void;
  onBranchedOff: (branch: string) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"restore" | "branch">("restore");
  // opened from a file → "just this file"; opened from a commit → the
  // whole project, since that's what the commit represents
  const [branchScope, setBranchScope] = useState<"all" | "file">(
    branchScopeDefault ?? "file",
  );
  const [busy, setBusy] = useState<"restore" | "open" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const name = path.split("/").pop() ?? path;
  const isAssembly = /\.sldasm$/i.test(path);
  const commitLabel = commit.message?.trim()
    ? commit.message
    : `${name} · ${formatDate(commit.date)}`;

  const preview = useQuery({
    queryKey: ["previewVersion", path, commit.sha],
    queryFn: () => previewVersion(path, commit.sha),
    staleTime: Infinity,
    retry: false,
  });

  // For assemblies: the parts it referenced at that same commit.
  const refs = useQuery({
    queryKey: ["refsAt", path, commit.sha],
    queryFn: () => resolveReferencesAt(path, commit.sha),
    enabled: isAssembly,
    staleTime: Infinity,
    retry: false,
  });

  const openDocs = useQuery({
    queryKey: ["openDocuments"],
    queryFn: getOpenDocuments,
    refetchInterval: 5000,
  });

  const checkedRefs = useMemo(
    () => (refs.data?.resolved ?? []).filter((p) => !unchecked.has(p)),
    [refs.data, unchecked],
  );
  const restoreSet = useMemo(
    () => [path, ...checkedRefs],
    [path, checkedRefs],
  );

  const openBlockers = useMemo(() => {
    const open = new Set((openDocs.data ?? []).map((p) => p.toLowerCase()));
    return restoreSet.filter((p) => open.has(p.toLowerCase()));
  }, [openDocs.data, restoreSet]);

  function toggleRef(p: string) {
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  async function restore() {
    setBusy("restore");
    setError(null);
    try {
      await restoreVersion(restoreSet, commit.sha);
      onDone(
        restoreSet.length === 1
          ? `${name} is back to the version from ${formatDateTime(commit.date)}. Save & Share to send it to your team, or Undo to change your mind.`
          : `${name} and ${restoreSet.length - 1} referenced part${restoreSet.length === 2 ? "" : "s"} are back to the version from ${formatDateTime(commit.date)}. Save & Share to send them to your team, or Undo to change your mind.`,
        restoreSet,
      );
    } catch (e) {
      setError(isAppError(e) ? e.message : String(e));
      setBusy(null);
    }
  }

  async function openCopy() {
    setBusy("open");
    setError(null);
    try {
      await openVersion(path, commit.sha);
    } catch (e) {
      setError(isAppError(e) ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal versionmodal" onClick={(e) => e.stopPropagation()}>
        <h2>{name} (earlier version)</h2>
        <p>
          As it was on <strong>{formatDateTime(commit.date)}</strong>, by{" "}
          {commit.author_name}.
        </p>

        <div className="versionpreview">
          {preview.isLoading && (
            <span className="muted small">Fetching this version…</span>
          )}
          {preview.isError && (
            <span className="muted small">
              Could not read this version from GitHub.
            </span>
          )}
          {preview.isSuccess &&
            (preview.data ? (
              <img src={preview.data} alt={`${name} as it was`} />
            ) : (
              <span className="muted small">
                No preview available for this version.
              </span>
            ))}
        </div>

        {/* Two equal ways to use this version — pick a lane. */}
        <div className="versiontabs" role="tablist">
          <button
            role="tab"
            aria-selected={mode === "restore"}
            className={mode === "restore" ? "active" : ""}
            onClick={() => setMode("restore")}
          >
            <RestoreGlyph />
            <span className="vt-text">
              <span className="vt-title">Bring it back</span>
              <span className="vt-sub">Onto {branchName}, as your next change</span>
            </span>
          </button>
          <button
            role="tab"
            aria-selected={mode === "branch"}
            className={mode === "branch" ? "active" : ""}
            onClick={() => setMode("branch")}
          >
            <BranchGlyph />
            <span className="vt-text">
              <span className="vt-title">Branch off</span>
              <span className="vt-sub">Continue from it on a new branch</span>
            </span>
          </button>
        </div>

        {mode === "restore" && (
          <>
            {isAssembly && (
              <div className="versionrefs">
                {refs.isLoading && (
                  <p className="muted small">
                    Reading which parts this assembly used back then…
                  </p>
                )}
                {refs.data && refs.data.resolved.length > 0 && (
                  <>
                    <p className="small">
                      Bring back its parts from the same version, so the mates
                      still line up:
                    </p>
                    <div className="ref-list">
                      {refs.data.resolved.map((p) => (
                        <label key={p}>
                          <input
                            type="checkbox"
                            checked={!unchecked.has(p)}
                            onChange={() => toggleRef(p)}
                          />
                          <span>{p}</span>
                        </label>
                      ))}
                    </div>
                    <p className="muted small">
                      Unchecked parts keep their current version, fine if a
                      part hasn&rsquo;t changed, but mates can break if its
                      shape moved on since then.
                    </p>
                  </>
                )}
                {refs.data && refs.data.unresolved.length > 0 && (
                  <p className="muted small">
                    Referenced but not in this project (library/toolbox parts):{" "}
                    {refs.data.unresolved.join(", ")}
                  </p>
                )}
                {refs.data?.warning && (
                  <p className="muted small">{refs.data.warning}</p>
                )}
              </div>
            )}

            {openBlockers.length > 0 && (
              <p className="error">
                Open in SolidWorks right now:{" "}
                {openBlockers.map((p) => p.split("/").pop()).join(", ")}. Close{" "}
                {openBlockers.length === 1 ? "it" : "them"} there first (without
                saving) before bringing this version back. SolidWorks would
                write its in-memory copy straight over it.
              </p>
            )}

            <RestoreDiagram branchName={branchName} commitLabel={commitLabel} />
            <p className="muted small">
              Bringing a version back never rewrites history. The old version
              is copied forward as your <em>next</em> change, everything in
              between stays in the record, and you can Undo until you Save
              &amp; Share. You need{" "}
              {restoreSet.length === 1 ? "the file" : "these files"} locked by
              you.
            </p>
          </>
        )}

        {mode === "branch" && (
          <div className="branchoffpanel">
            {/* Branching can carry the whole project back, or just this
                file — say which, out loud, and let the user pick. */}
            <p className="small">What should the new branch carry back?</p>
            <div
              className={`branchscope${branchScopeDefault === "all" ? " allfirst" : ""}`}
              role="radiogroup"
            >
              <label className={branchScope === "file" ? "picked" : ""}>
                <input
                  type="radio"
                  name="branchscope"
                  checked={branchScope === "file"}
                  onChange={() => setBranchScope("file")}
                />
                <span>
                  <strong>
                    Just {name}
                    {checkedRefs.length > 0
                      ? ` and its ${checkedRefs.length} part${checkedRefs.length === 1 ? "" : "s"}`
                      : ""}
                  </strong>
                  <span className="vt-sub">
                    The branch starts from the current state of the project, with only{" "}
                    {restoreSet.length === 1 ? "this file" : "these files"} set
                    back to this version.
                  </span>
                </span>
              </label>
              <label className={branchScope === "all" ? "picked" : ""}>
                <input
                  type="radio"
                  name="branchscope"
                  checked={branchScope === "all"}
                  onChange={() => setBranchScope("all")}
                />
                <span>
                  <strong>The whole project as it was then</strong>
                  <span className="vt-sub">
                    Every file on the new branch goes back to this moment, so
                    everything fits together.
                  </span>
                </span>
              </label>
            </div>
            <BranchOffForm
              sha={commit.sha}
              branchName={branchName}
              commitLabel={commitLabel}
              onBranched={onBranchedOff}
              perform={
                branchScope === "file"
                  ? async (n) =>
                      branchFromCommitFiles(n, commit.sha, restoreSet)
                  : undefined
              }
            />
            <p className="muted small">
              Either way, <strong>{branchName}</strong> stays exactly as it is
              and no lock is needed. Combine the branch back later from the
              Branches page.
            </p>
          </div>
        )}

        {error && <p className="errdetail">{error}</p>}

        <div className="modal-actions">
          <button onClick={onClose} disabled={busy !== null}>
            Cancel
          </button>
          <button
            onClick={openCopy}
            disabled={busy !== null}
            title="Extracts a read-only copy (an assembly comes with its parts from this same version) and opens it, without touching your working files"
          >
            {busy === "open" ? "Opening…" : "Open a look-only copy"}
          </button>
          {mode === "restore" && (
            <button
              className="primary"
              onClick={restore}
              disabled={busy !== null || openBlockers.length > 0}
            >
              {busy === "restore"
                ? "Bringing it back…"
                : restoreSet.length === 1
                  ? "Bring this version back"
                  : `Bring back all ${restoreSet.length} files`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
