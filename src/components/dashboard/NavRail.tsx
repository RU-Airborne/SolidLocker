import type { AppState } from "../../types";
import { githubAvatarUrl, UserAvatar } from "../common/UserAvatar";
import { usePeople } from "../../identity";
import DialLogo from "../DialLogo";
import { useFlag } from "../../persist";
import {
  BranchGlyph,
  CogGlyph,
  InsightGlyph,
  PullRequestGlyph,
} from "../common/HistoryDiagrams";

export type RailView = "files" | "branches" | "pulls" | "progress" | "settings";

function FilesGlyph({ size = 19 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h9A1.5 1.5 0 0 1 21 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5Z" />
    </svg>
  );
}

function RailItem({
  icon,
  label,
  hint,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`railitem${active ? " active" : ""}`}
      onClick={onClick}
      title={hint}
      aria-current={active ? "page" : undefined}
    >
      <span className="railicon" aria-hidden="true">
        {icon}
      </span>
      <span className="raillabel">{label}</span>
    </button>
  );
}

export function NavRail({
  view,
  onGo,
  appState,
  locking,
  defaultBranch,
}: {
  view: RailView;
  onGo: (view: RailView) => void;
  appState: AppState;
  locking: boolean;
  defaultBranch: string;
}) {
  const directory = usePeople();
  const [pinned, setPinned] = useFlag("railOpen", true);

  const who = appState.username
    ? (directory.nameFor(appState.username) ?? appState.username)
    : null;

  return (
    <nav className={`navrail${pinned ? " open" : ""}`} aria-label="Go to">
      <div className="railpane">
        <button
          className="railbrand"
          onClick={() => setPinned(!pinned)}
          title={pinned ? "Let the menu close again" : "Keep the menu open"}
          aria-pressed={pinned}
          aria-label={pinned ? "Let the menu close again" : "Keep the menu open"}
        >
          <span className="logoglow">
            <DialLogo className="raillogo" label="" spinning={locking} />
          </span>
          <span className="railwordmark">SolidLocker</span>
          {/* Only while pinned. It is the thing you press to let the menu go
              back to closing on its own, so it has no business being there
              when the menu is already doing that. */}
          {pinned && (
            <span className="railpin" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 17.2V22" />
                <path d="M8.6 3h6.8v7.4l2.4 3.6H6.2l2.4-3.6z" />
              </svg>
            </span>
          )}
        </button>

        <div className="railitems">
          <RailItem
            icon={<FilesGlyph />}
            label="Files"
            hint="Your project's files, and who is holding what"
            active={view === "files"}
            onClick={() => onGo("files")}
          />
          <RailItem
            icon={<BranchGlyph size={19} />}
            label="Branches"
            hint="Explore every branch and change, look at old versions, branch off, and merge branches"
            active={view === "branches"}
            onClick={() => onGo("branches")}
          />
          <RailItem
            icon={<PullRequestGlyph size={19} />}
            label="Merge Requests"
            hint={`Branches waiting to be merged into ${defaultBranch}, and the ones already dealt with`}
            active={view === "pulls"}
            onClick={() => onGo("pulls")}
          />
          <RailItem
            icon={<InsightGlyph />}
            label="Insights"
            hint="Who is holding what, how the project is shaped, and what the team has been up to"
            active={view === "progress"}
            onClick={() => onGo("progress")}
          />
        </div>

        <span className="railspacer" />

        {/* Who you are is a fact, Settings is a place, so they are separate.
            Every lock is stamped with that handle and these machines get
            shared, which is why the handle is worth the room. */}
        <div className="railitems railfoot">
          <div
            className="railitem railaccount"
            title={who ? `Signed in as ${who} (@${appState.username})` : "Not signed in"}
          >
            <span className="railicon railface" aria-hidden="true">
              {appState.username ? (
                <UserAvatar
                  url={githubAvatarUrl(appState.username)}
                  name={who ?? appState.username}
                  size={32}
                />
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  width="26"
                  height="26"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
                </svg>
              )}
            </span>
            <span className="raillabel railwho">
              <span className="railwho-name">{who ?? "Not signed in"}</span>
              {appState.username && (
                <span className="railwho-handle muted">@{appState.username}</span>
              )}
            </span>
          </div>

          <RailItem
            icon={<CogGlyph />}
            label="Settings"
            hint="Your account, this project, and how SolidLocker behaves"
            active={view === "settings"}
            onClick={() => onGo("settings")}
          />
        </div>
      </div>
    </nav>
  );
}
