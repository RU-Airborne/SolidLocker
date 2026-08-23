import { StatusMark } from "../common/StatusMark";
import { BranchName } from "../common/BranchName";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  branchProtection,
  mergeBranch,
  mergePreview,
  previewVersion,
} from "../../api";
import { isAppError } from "../../types";
import { PullRequestGlyph, InStepDiagram, MergeDiagram } from "../common/HistoryDiagrams";

function MergeGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M6 21V9a9 9 0 0 0 9 9" />
    </svg>
  );
}

const CAD_FILE = /\.(sldprt|sldasm|slddrw)$/i;

function IncomingThumb({ path, rev }: { path: string; rev: string }) {
  const thumb = useQuery({
    queryKey: ["previewVersion", path, rev],
    queryFn: () => previewVersion(path, rev),
    staleTime: Infinity,
    retry: false,
  });
  return (
    <span className="fthumb mergethumb" aria-hidden="true">
      {thumb.data && <img src={thumb.data} alt="" draggable={false} />}
    </span>
  );
}

export function MergeBranchDialog({
  branch,
  currentBranch,
  defaultBranch,
  onMerged,
  onReview,
  onResolve,
  onClose,
}: {
  branch: string;
  currentBranch: string;
  defaultBranch: string;
  onMerged: (notice: string, undoable: boolean) => void;
  onReview: (branch: string, into: string) => void;
  /** clash: hand over to the picker */
  onResolve: (branch: string) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const canLocalMerge = branch !== currentBranch;
  // A review goes into the branch you are on. Opened on that branch itself,
  // the only place left to propose it is the default branch.
  const reviewInto = canLocalMerge ? currentBranch : defaultBranch;
  const canPullRequest = branch !== reviewInto;

  const preview = useQuery({
    queryKey: ["mergePreview", branch],
    queryFn: () => mergePreview(branch),
    enabled: canLocalMerge,
    staleTime: 30_000,
    retry: false,
  });
  const hasConflicts = (preview.data?.conflicts.length ?? 0) > 0;
  const upToDate = preview.data?.up_to_date === true;
  const unrelated = preview.data?.unrelated === true;

  // unknown (offline, no remote) leaves the button on; push will say no anyway
  const guard = useQuery({
    queryKey: ["branchProtection", currentBranch],
    queryFn: () => branchProtection(currentBranch),
    enabled: canLocalMerge,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const guarded = guard.data?.requires_review === true;
  const incoming = preview.data?.files ?? [];
  const diagramInto = reviewInto;

  function openPullRequest() {
    onReview(branch, reviewInto);
  }

  async function mergeNow() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await mergeBranch(branch);
      onMerged(
        result.already_up_to_date
          ? `Nothing to merge: ${currentBranch} already has everything from ${branch}.`
          : `Brought ${branch}'s work into ${currentBranch}. Use Save & Share to put the merged result on GitHub, or Undo to take it back out.`,
        !result.already_up_to_date,
      );
    } catch (e) {
      // merge is already backed out at this point
      if (isAppError(e) && e.code === "CONFLICT") {
        setBusy(false);
        onResolve(branch);
        return;
      }
      setError(isAppError(e) ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Merge branches</h2>
        {upToDate ? (
          <>
            <p>
              <BranchName name={diagramInto} /> already has everything from{" "}
              <BranchName name={branch} /> , the two are in step, so there is
              nothing to merge right now.
            </p>
            <InStepDiagram fromBranch={branch} intoBranch={diagramInto} />
          </>
        ) : (
          <>
            <p>
              Bring <BranchName name={branch} />&rsquo;s work into{" "}
              <BranchName name={diagramInto} />. Afterwards{" "}
              <BranchName name={diagramInto} /> carries all files from both branches. {" "}
              <BranchName name={branch} /> stays unchanged, and nothing from
              either branches is lost.
            </p>
            <MergeDiagram
              fromBranch={branch}
              intoBranch={diagramInto}
              intoIsCurrent={diagramInto === currentBranch}
            />
          </>
        )}

        {canLocalMerge && (
          <div className="mergepreview">
            {preview.isLoading && (
              <p className="muted small">Checking what would change…</p>
            )}
            {!upToDate && incoming.length > 0 && (
              <>
                <p className="small">
                  This would bring {incoming.length} change
                  {incoming.length === 1 ? "" : "s"} into <BranchName name={currentBranch} />:
                </p>
                <ul className="gg-files">
                  {incoming.slice(0, 8).map((f) => (
                    <li key={f.path}>
                      <StatusMark status={f.status} />
                      {CAD_FILE.test(f.path) && f.status !== "D" && (
                        <IncomingThumb path={f.path} rev={branch} />
                      )}
                      <span className="gg-filepath">{f.path}</span>
                    </li>
                  ))}
                </ul>
                {incoming.length > 8 && (
                  <p className="muted small">
                    …and {incoming.length - 8} more.
                  </p>
                )}
              </>
            )}
            {guarded && (
              <p className="error">
                <BranchName name={currentBranch} /> is protected on GitHub:
                changes have to come through a review
                {guard.data!.approvals > 0
                  ? ` with ${guard.data!.approvals} approval${guard.data!.approvals === 1 ? "" : "s"}`
                  : ""}
                , so merging here is off.
              </p>
            )}
            {preview.isError && (
              <p className="errdetail">
                Could not work out what this merge would bring:{" "}
                {isAppError(preview.error) ? preview.error.message : String(preview.error)}
              </p>
            )}
            {unrelated && !upToDate && (
              <p className="warn-inline">
                <BranchName name={branch} /> and <BranchName name={currentBranch} />{" "}
                have never been connected: one of them started as an empty
                branch. Merging brings all {incoming.length} file(s) on <BranchName name={branch} />{" "} to <BranchName name={currentBranch} />.
                {hasConflicts && (
                  <>
                    , and{" "}
                    {preview.data!.conflicts.length === 1
                      ? "one file exists"
                      : `${preview.data!.conflicts.length} files exist`}{" "}
                    on both sides under the same name, so those count as clashes
                  </>
                )}
                .
              </p>
            )}
            {hasConflicts && !guarded && !unrelated && (
              <p className="warn-inline">
                Both branches changed{" "}
                {preview.data!.conflicts.length === 1
                  ? "this file"
                  : "these files"}
                : {preview.data!.conflicts.join(", ")}. SolidWorks files
                can&rsquo;t be merged, so you&rsquo;ll pick which version to
                keep before anything is merged.
              </p>
            )}
          </div>
        )}

        <div className="mergeoptions">
          {/* nothing to review if the target already has it all */}
          {canPullRequest && !upToDate && (
            <button
              className="mergecard recommended"
              onClick={openPullRequest}
              disabled={busy}
            >
              <PullRequestGlyph />
              <span className="vt-text">
                <span className="vt-title">
                  Request to merge into <BranchName name={reviewInto} />...
                  <span className="mergetag">recommended</span>
                </span>
                <span className="vt-sub">
                  A team lead, or anyone allowed to approve, will review your request and
                  merges it after reviewing.
                </span>
              </span>
            </button>
          )}

          {canLocalMerge && !upToDate && (
            <button
              className={`mergecard${confirming ? " selected" : ""}`}
              onClick={() => (hasConflicts ? onResolve(branch) : setConfirming(true))}
              disabled={busy || guarded || preview.isLoading || preview.isError}
            >
              <MergeGlyph />
              <span className="vt-text">
                <span className="vt-title">
                  Merge into <BranchName name={currentBranch} /> directly…
                </span>
                <span className="vt-sub">
                  {hasConflicts ? (
                    <>
                      Merges it on this computer without asking for review.{" "}
                      {preview.data!.conflicts.length === 1
                        ? "One file clashes"
                        : `${preview.data!.conflicts.length} files clash`}
                      , so you need To pick which version to keep first.
                    </>
                  ) : (
                    <>
                      Merges it on this computer right away without asking for review. You
                      see what changes and confirm before it happens.
                    </>
                  )}
                  {" "}Not available when the branch is protected on GitHub.
                </span>
              </span>
            </button>
          )}
        </div>

        {confirming && (
          <p className="muted small">
            Nothing goes to GitHub yet, and Undo takes it right back out until
            you Save &amp; Share.
          </p>
        )}
        {error && <p className="errdetail">{error}</p>}

        <div className="modal-actions">
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {confirming && (
            <button className="primary" onClick={mergeNow} disabled={busy}>
              {busy
                ? "Merging…"
                : `Merge ${incoming.length} change${incoming.length === 1 ? "" : "s"} into ${currentBranch}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
