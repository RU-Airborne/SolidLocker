import { useEffect, useState } from "react";
import type { RepoStatus } from "../../api";
import type { AppState } from "../../types";
import { isSwTemp } from "../../types";
import { githubAvatarUrl, UserAvatar } from "../common/UserAvatar";
import { usePeople } from "../../identity";
import { GlassSelect } from "../common/GlassSelect";
import logo from "../../assets/logo.png";

function agoText(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function SyncedCaption({
  lastFetchAt,
  fetchIntervalS,
}: {
  lastFetchAt: number;
  fetchIntervalS: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const agoSec = Math.max(0, Math.round((now - lastFetchAt) / 1000));
  const nextSec = Math.max(0, fetchIntervalS - agoSec);
  return (
    <>
      In sync <span className="tick">✓</span> · {agoText(agoSec)} · next in{" "}
      {nextSec}s
    </>
  );
}

export function TopBar({
  appState,
  branches,
  currentBranch,
  onSwitchBranch,
  switchingTo,
  onSwitchRepo,
  status,
  lastFetchAt,
  offline,
  stale,
  onSyncNow,
  syncing,
  onSaveShare,
  onPushOnly,
  fetchIntervalS,
  updating,
  myClaimCount,
  mineActive,
  onToggleMine,
  onOpenSettings,
  onOpenProgress,
}: {
  appState: AppState;
  branches: string[] | undefined;
  currentBranch: string;
  onSwitchBranch: (name: string) => void;
  switchingTo: string | null;
  onSwitchRepo: () => void;
  status: RepoStatus | undefined;
  lastFetchAt: number | null;
  offline: boolean;
  stale: boolean;
  onSyncNow: () => void;
  syncing: boolean;
  onSaveShare: () => void;
  onPushOnly: () => void;
  fetchIntervalS: number;
  updating: boolean;
  myClaimCount: number;
  mineActive: boolean;
  onToggleMine: () => void;
  onOpenSettings: () => void;
  onOpenProgress: () => void;
}) {
  const directory = usePeople();
  // SolidWorks ~$ temp files never count as work worth saving.
  const dirtyCount =
    (status?.dirty.filter((p) => !isSwTemp(p)).length ?? 0) +
    (status?.untracked.filter((p) => !isSwTemp(p)).length ?? 0);
  const behind = status?.behind ?? 0;
  const ahead = status?.ahead ?? 0;

  let syncCap: React.ReactNode;
  let syncWarn = false;
  if (offline) {
    syncCap = (
      <>
        Out of sync <span className="cross">✗</span> · Can't reach GitHub
      </>
    );
  } else if (stale) {
    syncCap = (
      <>
        Out of sync <span className="cross">✗</span> · Lock info may be out of
        date
      </>
    );
  } else if (updating) syncCap = "Syncing with team…";
  else if (behind > 0 && dirtyCount > 0) {
    syncCap = `${behind} team change${behind === 1 ? "" : "s"} waiting — Save & Share first`;
    syncWarn = true;
  } else if (behind > 0) syncCap = "Syncing with team…";
  else if (lastFetchAt !== null)
    syncCap = (
      <SyncedCaption lastFetchAt={lastFetchAt} fetchIntervalS={fetchIntervalS} />
    );
  else syncCap = "Checking with team…";

  return (
    <header className="ghbar">
      <span className="brand logoglow" title="SolidLocker">
        <img src={logo} alt="SolidLocker" className="brandlogo" />
      </span>

      <button
        className="seg"
        onClick={onSwitchRepo}
        title={`${appState.repo!.repo_path}\nClick to switch repository`}
      >
        <span className="cap">Current repository</span>
        <span className="val">
          <svg
            className="segicon"
            viewBox="0 0 16 16"
            width="13"
            height="13"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2A1.75 1.75 0 0 0 5 1H1.75Z" />
          </svg>
          {appState.repo!.repo_slug.split("/")[1]}
          <span className="segchevron">⇄</span>
        </span>
      </button>

      <div className="seg">
        <span className="cap">
          {switchingTo ? `Switching to ${switchingTo}…` : "Current branch"}
        </span>
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
              : [{ value: currentBranch, label: currentBranch }]),
            ...(branches ?? []).map((b) => ({ value: b, label: b })),
          ]}
        />
      </div>

      <div className="seg seg-sync">
        <span className={`cap${syncWarn ? " warn" : ""}`}>{syncCap}</span>
        <button
          className="minibtn"
          onClick={onSyncNow}
          disabled={updating || syncing}
          title="Check GitHub for team changes right now"
        >
          {syncing ? "Syncing…" : "Sync now"}
        </button>
      </div>

      <span className="spacer" />

      {myClaimCount > 0 && (
        <button
          className={`barbtn claimchip${mineActive ? " active" : ""}`}
          onClick={onToggleMine}
          title="Show only the files you have locked"
        >
          You hold {myClaimCount}
        </button>
      )}

      {ahead > 0 && dirtyCount === 0 && (
        <button className="barbtn attention" onClick={onPushOnly} disabled={updating}>
          Share {ahead} saved change{ahead === 1 ? "" : "s"}
        </button>
      )}
      <button
        className={`barbtn${dirtyCount > 0 ? " attention" : ""}`}
        onClick={onSaveShare}
        disabled={updating || dirtyCount === 0}
      >
        Save &amp; Share{dirtyCount > 0 ? ` (${dirtyCount})` : ""}
      </button>
      <button
        className="barbtn"
        onClick={onOpenProgress}
        title="See what the team has been working on"
      >
        Progress
      </button>
      <button
        className="barbtn avatarbtn"
        onClick={onOpenSettings}
        title="Your account and project"
        aria-label="Your account and project"
      >
        {appState.username ? (
          <UserAvatar
            url={githubAvatarUrl(appState.username)}
            name={directory.nameFor(appState.username) ?? appState.username}
            size={26}
          />
        ) : (
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
          </svg>
        )}
      </button>
      {switchingTo && <div className="topbar-progress" aria-hidden="true" />}
    </header>
  );
}
