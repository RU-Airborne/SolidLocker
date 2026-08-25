import type { RepoStatus } from "../../api";
import type { AppState } from "../../types";
import { isSwTemp } from "../../types";
import { GlassSelect } from "../common/GlassSelect";
import { useBranchColors } from "../common/BranchName";
import { SyncChip } from "./SyncChip";
import { RepoMenu } from "./RepoMenu";
import { ShareGlyph } from "../common/HistoryDiagrams";

export function TopBar({
  appState,
  branches,
  currentBranch,
  onSwitchBranch,
  switchingTo,
  onSwitchRepo,
  onOpenRepo,
  status,
  lastFetchAt,
  offline,
  stale,
  onSyncNow,
  syncing,
  checking,
  onSaveShare,
  onPushOnly,
  fetchIntervalS,
  updating,
  onDiscard,
}: {
  appState: AppState;
  branches: string[] | undefined;
  currentBranch: string;
  onSwitchBranch: (name: string) => void;
  switchingTo: string | null;
  onSwitchRepo: () => void;
  onOpenRepo: (path: string) => void;
  status: RepoStatus | undefined;
  lastFetchAt: number | null;
  offline: boolean;
  stale: boolean;
  onSyncNow: () => void;
  syncing: boolean;
  checking: boolean;
  onSaveShare: () => void;
  onPushOnly: () => void;
  fetchIntervalS: number;
  updating: boolean;
  /** Open the discard-changes confirm. */
  onDiscard: () => void;
}) {
  const branchColorOf = useBranchColors();
  // SolidWorks ~$ temp files never count as work worth saving.
  const trackedDirty = status?.dirty.filter((p) => !isSwTemp(p)).length ?? 0;
  const dirtyCount =
    trackedDirty +
    (status?.untracked.filter((p) => !isSwTemp(p)).length ?? 0);
  const behind = status?.behind ?? 0;
  const ahead = status?.ahead ?? 0;

  const behindBlocked = !offline && !stale && !updating && behind > 0 && dirtyCount > 0;

  return (
    <>
    <header className="ghbar">
      {/* Where you are, read left to right, instead of two boxed panels with
          headings over them. The mark that used to sit here is at the top of
          the rail now, where it is bigger and never scrolls away. */}
      <nav className="crumbs" aria-label="Where you are">
        <RepoMenu
          slug={appState.repo!.repo_slug}
          path={appState.repo!.repo_path}
          onPick={onOpenRepo}
          onBrowse={onSwitchRepo}
        />

        <span className="crumbsep" aria-hidden="true">
          ›
        </span>

        {switchingTo ? (
          <span className="crumb switching">Switching to {switchingTo}…</span>
        ) : (
          <GlassSelect
            className="branchselect"
            value={currentBranch}
            disabled={switchingTo !== null}
            onChange={onSwitchBranch}
            title="Switch branch (blocked while you have unsaved changes)"
            ariaLabel="Current branch"
            options={[
              ...(branches?.includes(currentBranch)
                ? []
                : [
                    {
                      value: currentBranch,
                      label: currentBranch,
                      color: branchColorOf(currentBranch),
                    },
                  ]),
              ...(branches ?? []).map((b) => ({
                value: b,
                label: b,
                color: branchColorOf(b),
              })),
              // not a branch, intercepted upstream to open the create dialog
              { value: "__create__", label: "＋ New branch…" },
            ]}
          />
        )}
      </nav>

      <span className="spacer" />

      {/* untracked-only counts too: a branch switch can leave files behind
          with no edits at all, and there was no way to clear them */}
      {dirtyCount > 0 && (
        <button
          className="barbtn"
          onClick={onDiscard}
          disabled={updating}
          title={
            trackedDirty > 0
              ? "Throw away everything changed since the last Save & Share"
              : "Move files that were never shared out of the project"
          }
        >
          {trackedDirty > 0 ? "Discard…" : "Clear out…"}
        </button>
      )}
      <button
        className={`barbtn${dirtyCount > 0 || ahead > 0 ? " attention" : ""}`}
        onClick={dirtyCount > 0 ? onSaveShare : onPushOnly}
        disabled={updating || (dirtyCount === 0 && ahead === 0)}
        title={
          dirtyCount > 0
            ? "Describe your changes and send them to the team"
            : ahead > 0
              ? `Everything is saved. This sends ${ahead} waiting change${ahead === 1 ? "" : "s"} to GitHub`
              : "Nothing to share yet"
        }
      >
        {updating && dirtyCount === 0 && ahead > 0 ? (
          "Sharing…"
        ) : (
          <>
            <ShareGlyph />
            Save &amp; Share
            {dirtyCount > 0
              ? ` (${dirtyCount})`
              : ahead > 0
                ? ` (${ahead} waiting)`
                : ""}
          </>
        )}
      </button>
      {/* Merge Requests, Branches, Progress and your account moved to the
          rail on the left; they are places to go, not things to do here. The
          side pane's switch sits on the Files page itself, since that is the
          only page with a side pane. */}

      {/* Last thing on the bar, far corner: the place a Windows app puts the
          state of its connection, and out of the way of the crumbs. */}
      <SyncChip
        offline={offline}
        stale={stale}
        updating={updating}
        behind={behind}
        dirtyCount={dirtyCount}
        lastFetchAt={lastFetchAt}
        fetchIntervalS={fetchIntervalS}
        syncing={syncing}
        checking={checking}
        onSyncNow={onSyncNow}
      />
      {switchingTo && <div className="topbar-progress" aria-hidden="true" />}
    </header>

    {behindBlocked && (
      <div className="notice warn">
        <span>
          {behind} team change{behind === 1 ? "" : "s"} cannot come down until
          your own work goes up. Save &amp; Share first.
        </span>
        <button className="notice-ok" onClick={onSaveShare}>
          Save &amp; Share
        </button>
      </div>
    )}
    </>
  );
}
