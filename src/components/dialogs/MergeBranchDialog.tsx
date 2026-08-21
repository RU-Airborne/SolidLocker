import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";

import { mergeBranch, mergePreview, previewVersion } from "../../api";
import { isAppError } from "../../types";
import { InStepDiagram, MergeDiagram } from "../common/HistoryDiagrams";

function PullRequestGlyph() {
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
      <path d="M13 6h3a2 2 0 0 1 2 2v7" />
      <line x1="6" y1="9" x2="6" y2="21" />
    </svg>
  );
}

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
  repoSlug,
  onMerged,
  onClose,
}: {
  branch: string;
  currentBranch: string;
  defaultBranch: string;
  repoSlug: string;
  onMerged: (notice: string, undoable: boolean) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const canPullRequest = branch !== defaultBranch;
  const canLocalMerge = branch !== currentBranch;

  const preview = useQuery({
    queryKey: ["mergePreview", branch],
    queryFn: () => mergePreview(branch),
    enabled: canLocalMerge,
    staleTime: 30_000,
    retry: false,
  });
  const hasConflicts = (preview.data?.conflicts.length ?? 0) > 0;
  const upToDate = preview.data?.up_to_date === true;
  const incoming = preview.data?.files ?? [];
  const diagramInto = canLocalMerge ? currentBranch : defaultBranch;

  function openPullRequest() {
    void openUrl(
      `https://github.com/${repoSlug}/compare/${encodeURIComponent(defaultBranch)}...${encodeURIComponent(branch)}?expand=1`,
    );
  }

  async function mergeNow() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await mergeBranch(branch);
      onMerged(
        result.already_up_to_date
          ? `Nothing to combine: ${currentBranch} already has everything from ${branch}.`
          : `Brought ${branch}'s work into ${currentBranch}. Use Save & Share to put the combined result on GitHub, or Undo to take it back out.`,
        !result.already_up_to_date,
      );
    } catch (e) {
      setError(isAppError(e) ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Combine branches</h2>
        {confirming ? (
          // last look before anything on disk changes
          <>
            <p>
              This will change{" "}
              <strong>
                {incoming.length} file{incoming.length === 1 ? "" : "s"}
              </strong>{" "}
              in <strong>{currentBranch}</strong> on this computer:
            </p>
            <div className="mergefilelist">
              <ul className="gg-files">
                {incoming.map((f, i) => (
                  <li key={f.path}>
                    <span className={`st st-${f.status.toLowerCase()}`}>
                      {f.status}
                    </span>
                    {i < 12 && CAD_FILE.test(f.path) && f.status !== "D" && (
                      <IncomingThumb path={f.path} rev={branch} />
                    )}
                    <span className="gg-filepath">{f.path}</span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="muted small">
              Nothing goes to GitHub yet, and Undo takes it right back out until you Save &amp; Share.
            </p>
            {error && <p className="errdetail">{error}</p>}
            <div className="modal-actions">
              <button onClick={() => setConfirming(false)} disabled={busy}>
                Go back
              </button>
              <button className="primary" onClick={mergeNow} disabled={busy}>
                {busy
                  ? "Combining…"
                  : `Merge ${incoming.length} change${incoming.length === 1 ? "" : "s"} into ${currentBranch}`}
              </button>
            </div>
          </>
        ) : (
        <>
        {upToDate ? (
          <>
            <p>
              <strong>{diagramInto}</strong> already has everything from{" "}
              <strong>{branch}</strong> , the two are in step, so there is
              nothing to combine right now.
            </p>
            <InStepDiagram fromBranch={branch} intoBranch={diagramInto} />
          </>
        ) : (
          <>
            <p>
              Bring <strong>{branch}</strong>&rsquo;s work into{" "}
              <strong>{diagramInto}</strong>. After combining, one branch carries
              both. Nothing from either branch is lost.
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
                  {incoming.length === 1 ? "" : "s"} into {currentBranch}:
                </p>
                <ul className="gg-files">
                  {incoming.slice(0, 8).map((f) => (
                    <li key={f.path}>
                      <span className={`st st-${f.status.toLowerCase()}`}>
                        {f.status}
                      </span>
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
            {hasConflicts && (
              <p className="error">
                Both branches changed{" "}
                {preview.data!.conflicts.length === 1
                  ? "this file"
                  : "these files"}
                : {preview.data!.conflicts.join(", ")}. Merging here would
                collide, so that button is off. Use the reviewed way below.
              </p>
            )}
          </div>
        )}

        <div className="mergeoptions">
          {/* In-step with the current branch AND the current branch is the
              main line: a pull request would be empty too — offer nothing. */}
          {canPullRequest && !(upToDate && currentBranch === defaultBranch) && (
            <button
              className="mergecard recommended"
              onClick={openPullRequest}
              disabled={busy}
            >
              <PullRequestGlyph />
              <span className="vt-text">
                <span className="vt-title">
                  Propose merging into {defaultBranch}
                  <span className="mergetag">team reviews first</span>
                </span>
                <span className="vt-sub">
                  Opens GitHub, where teammates see exactly what would change
                  and approve it before it lands.
                </span>
              </span>
            </button>
          )}

          {canLocalMerge && !upToDate && (
            <button
              className="mergecard"
              onClick={() => setConfirming(true)}
              disabled={busy || hasConflicts || preview.isLoading}
            >
              <MergeGlyph />
              <span className="vt-text">
                <span className="vt-title">Merge into {currentBranch} here…</span>
                <span className="vt-sub">
                  Locally on this computer without a review. You&rsquo;ll see the
                  full list of what changes and confirm before anything
                  happens. If both branches changed the same files, this way
                  is off and you&rsquo;re pointed to the reviewed one.
                </span>
              </span>
            </button>
          )}
        </div>

        {error && <p className="errdetail">{error}</p>}

        <div className="modal-actions">
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
