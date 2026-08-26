import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";

import * as api from "../api";
import { useActivity, useTeam } from "../queries";
import {
  Confirm,
  Empty,
  FileTypeIcon,
  Segmented,
  Spinner,
  Trouble,
  UserAvatar,
} from "../components";
import { formatDateTime } from "../../dates";
import { formatPerson } from "../../identity";
import { useTheme, type Theme } from "../../theme";
import { useBackable } from "../back";
import { useEdgeBack } from "../swipe";
import {
  askToNotify,
  readAlerts,
  writeAlerts,
  type AlertSettings,
} from "../alerts";

type Page = "menu" | "activity" | "team" | "settings";

export function More({
  state,
  repo,
  onClose,
}: {
  state: api.CloudState;
  repo: api.CloudRepo | undefined;
  onClose: () => void;
}) {
  const [page, setPage] = useState<Page>("menu");
  useBackable(true, onClose);
  useBackable(page !== "menu", () => setPage("menu"));

  // Pulling in from the left edge goes back the same way the button does:
  // out to the menu from a page, and off the screen from the menu itself.
  const panel = useRef<HTMLDivElement>(null);
  const goBack = useCallback(
    () => (page === "menu" ? onClose() : setPage("menu")),
    [page, onClose],
  );
  useEdgeBack(panel, true, goBack);

  return (
    <div className="m-moresheet-back" onClick={onClose}>
      <div
        ref={panel}
        className={`m-moresheet${page === "menu" ? "" : " deep"}`}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Keyed on the page so each one is a new element, which is what lets
            it play its slide: pages arrive from the right, and going back to
            the menu comes in from the left. */}
        <div
          key={page}
          className={`m-subpage ${page === "menu" ? "m-fromleft" : "m-fromright"}`}
        >
        {page !== "menu" ? (
          <>
            <header className="m-head">
              <button className="m-backbtn" onClick={() => setPage("menu")}>
                ‹ More
              </button>
              <h1>{titleOf(page)}</h1>
              <button className="m-linkbtn" onClick={onClose}>
                Done
              </button>
            </header>
            <div className="m-scroll">
              {page === "activity" && <Activity />}
              {page === "team" && <Team />}
              {page === "settings" && (
                <Settings state={state} repo={repo} />
              )}
            </div>
          </>
        ) : (
          <>
      <header className="m-head">
        <h1>More</h1>
        <button className="m-linkbtn" onClick={onClose}>
          Done
        </button>
      </header>
      <div className="m-scroll">
        <div className="m-whoami">
          <UserAvatar
            url={state.me?.avatar_url ?? null}
            name={state.me?.name ?? state.me?.login ?? "?"}
            size={44}
          />
          <span className="m-row-main">
            <span className="m-row-title">
              {state.me
                ? formatPerson(state.me.name ?? state.me.login, state.me.login)
                : ""}
            </span>
            <span className="muted small">
              {state.slug}
              {repo && !repo.can_push && " · read only"}
            </span>
          </span>
        </div>

        {(["activity", "team", "settings"] as const).map((key) => (
          <button key={key} className="m-row" onClick={() => setPage(key)}>
            <span className="m-row-main">
              <span className="m-row-title">{titleOf(key)}</span>
              <span className="muted small">{blurbOf(key)}</span>
            </span>
            <span className="m-chevron">›</span>
          </button>
        ))}
      </div>
          </>
        )}
        </div>
      </div>
    </div>
  );
}

function titleOf(page: Page): string {
  switch (page) {
    case "activity":
      return "Activity";
    case "team":
      return "Team";
    case "settings":
      return "Settings";
    default:
      return "More";
  }
}

function blurbOf(page: Page): string {
  switch (page) {
    case "activity":
      return "What has changed on this branch lately";
    case "team":
      return "Who is on the project, and what they are holding";
    default:
      return "Your account, previews, and how this app looks";
  }
}

function Activity() {
  const activity = useActivity(true);
  const [open, setOpen] = useState<string | null>(null);

  if (activity.isLoading) return <Spinner label="Reading the history..." />;
  if (activity.isError) {
    return <Trouble error={activity.error} onRetry={() => activity.refetch()} />;
  }
  if ((activity.data ?? []).length === 0) {
    return <Empty title="Nothing yet" hint="No changes on this branch." />;
  }

  return (
    <>
      {(activity.data ?? []).map((commit) => (
        <div key={commit.sha}>
          <button
            className="m-row m-commit"
            onClick={() => setOpen(open === commit.sha ? null : commit.sha)}
          >
            <UserAvatar
              url={commit.author_avatar || null}
              name={commit.author_name || commit.author_login}
              size={30}
            />
            <span className="m-row-main">
              <span className="m-row-title">{commit.message}</span>
              <span className="muted small">
                {formatPerson(commit.author_name, commit.author_login)} ·{" "}
                {formatDateTime(commit.date)}
              </span>
            </span>
          </button>
          {open === commit.sha && <CommitFiles sha={commit.sha} />}
        </div>
      ))}
    </>
  );
}

function CommitFiles({ sha }: { sha: string }) {
  const detail = useQuery({
    queryKey: ["cloud", "commit", sha],
    queryFn: () => api.getCommit(sha),
    staleTime: Infinity,
  });
  if (detail.isLoading) return <Spinner />;
  if (detail.isError) return <Trouble error={detail.error} />;
  return (
    <ul className="m-pullfiles m-inset">
      {(detail.data?.files ?? []).slice(0, 40).map((file) => (
        <li key={file.path}>
          <span className={`m-filetype${file.is_cad ? " cad" : ""}`}>
            <FileTypeIcon path={file.path} size={16} />
          </span>
          <span className="m-pullfile-name">{file.path}</span>
          <span className={`m-status m-status-${file.status}`}>{file.status}</span>
        </li>
      ))}
    </ul>
  );
}

function Team() {
  const team = useTeam(true);
  if (team.isLoading) return <Spinner label="Reading the team..." />;
  if (team.isError) return <Trouble error={team.error} onRetry={() => team.refetch()} />;
  if ((team.data ?? []).length === 0) return <Empty title="Nobody yet" />;

  return (
    <>
      {(team.data ?? []).map((member) => (
        <div key={member.login} className="m-row m-member">
          <UserAvatar url={member.avatar_url} name={member.name} size={38} />
          <span className="m-row-main">
            <span className="m-row-title">{member.name}</span>
            <span className="muted small">
              @{member.login} · {member.commits} change
              {member.commits === 1 ? "" : "s"}
            </span>
          </span>
          {member.holding > 0 && (
            <span className="m-holding" title={`Holding ${member.holding} files`}>
              {member.holding}
            </span>
          )}
        </div>
      ))}
    </>
  );
}

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      className="m-toggle"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
    >
      <span className="m-toggle-label">{label}</span>
      <span className={`m-toggle-track${on ? " on" : ""}`} aria-hidden="true">
        <span className="m-toggle-knob" />
      </span>
    </button>
  );
}

function Settings({
  state,
  repo,
}: {
  state: api.CloudState;
  repo: api.CloudRepo | undefined;
}) {
  const queryClient = useQueryClient();
  const [theme, setTheme] = useTheme();
  const [clientId, setClientId] = useState("");
  const [askingOut, setAskingOut] = useState(false);
  const [alerts, setAlerts] = useState<AlertSettings>(readAlerts);

  useEffect(() => {
    void api.getClientId().then(setClientId).catch(() => {});
  }, []);

  async function changeAlerts(next: AlertSettings) {
    // Nothing to ask for until somebody actually wants to be told something.
    if ((next.free || next.reminder || next.taken) && !(await askToNotify())) {
      return;
    }
    setAlerts(next);
    writeAlerts(next);
  }

  return (
    <div className="m-settings">
      <section>
        <h3 className="m-subhead">Project</h3>
        <p className="m-setting-line">
          {state.slug}
          {repo?.private && <span className="m-tag">private</span>}
        </p>
        <p className="muted small">
          Reading {state.branch}
          {repo && !repo.can_push && " · you can look but not change"}
          {repo && !repo.lockable_ok &&
            " · nothing in this project is marked lockable, so there is nothing to hold"}
        </p>
        <button
          className="m-btn"
          onClick={async () => {
            await api.forgetRepo();
            queryClient.invalidateQueries({ queryKey: ["cloud"] });
          }}
        >
          Pick a different project
        </button>
      </section>


      <section>
        <h3 className="m-subhead">Tell me when</h3>
        <Toggle
          label="A file I am waiting on comes free"
          on={alerts.free}
          onChange={(free) => changeAlerts({ ...alerts, free })}
        />
        <Toggle
          label="Someone takes a lock off me"
          on={alerts.taken}
          onChange={(taken) => changeAlerts({ ...alerts, taken })}
        />
        <Toggle
          label="I have been holding something too long"
          on={alerts.reminder}
          onChange={(reminder) => changeAlerts({ ...alerts, reminder })}
        />
        {alerts.reminder && (
          <Segmented
            value={String(alerts.after)}
            onChange={(after) => changeAlerts({ ...alerts, after: Number(after) })}
            options={[
              { value: "8", label: "8h" },
              { value: "24", label: "A day" },
              { value: "72", label: "3 days" },
            ]}
          />
        )}
        <p className="muted small">
          These arrive while SolidLocker is open. A phone puts an app to sleep
          within a minute or two of you leaving it, so an alert about
          something that happened overnight turns up when you next open this,
          not at three in the morning. Waking the phone itself would need a
          server pushing to it.
        </p>
      </section>

      <section>
        <h3 className="m-subhead">Look</h3>
        <Segmented
          value={theme}
          onChange={(next: Theme) => setTheme(next)}
          options={[
            { value: "system" as Theme, label: "System" },
            { value: "light" as Theme, label: "Light" },
            { value: "dark" as Theme, label: "Dark" },
          ]}
        />
      </section>

      <section>
        <h3 className="m-subhead">Signing in</h3>
        <p className="muted small">
          Signed in as @{state.me?.login}. The GitHub client ID lets this app
          start a sign in of its own instead of asking for a pasted token.
        </p>
        <input
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          onBlur={() => void api.setClientId(clientId)}
          placeholder="GitHub OAuth client ID"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <button className="m-btn m-btn-danger" onClick={() => setAskingOut(true)}>
          Sign out
        </button>
      </section>

      <section>
        <h3 className="m-subhead">What this app cannot do</h3>
        <p className="muted small">
          Nothing is downloaded to this device, so there is no opening a model,
          no saving work, and no resolving a clash between two versions. Those
          need SolidWorks and the files themselves, which means your machine.
          Locking, reviewing and merging all happen on GitHub, which is why they
          work here.
        </p>
        <button
          className="m-linkbtn"
          onClick={() =>
            void openUrl("https://github.com/RU-Airborne/SolidLocker").catch(() => {})
          }
        >
          About SolidLocker
        </button>
      </section>

      {askingOut && (
        <Confirm
          title="Sign out?"
          danger
          confirmLabel="Sign out"
          body={
            <p>
              Any locks you are holding stay held. They are on GitHub, not on
              this phone, so signing out here does not give them back.
            </p>
          }
          onCancel={() => setAskingOut(false)}
          onConfirm={async () => {
            setAskingOut(false);
            await api.signOut();
            queryClient.invalidateQueries({ queryKey: ["cloud"] });
          }}
        />
      )}
    </div>
  );
}
