import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";

import * as api from "../api";
import { useActivity, useTeam } from "../queries";
import {
  bytes,
  Confirm,
  Empty,
  FileTypeIcon,
  Segmented,
  Spinner,
  Trouble,
  UserAvatar,
} from "../components";
import { formatDateTime } from "../../dates";
import { useTheme, type Theme } from "../../theme";

type Page = "menu" | "activity" | "team" | "settings";

export function More({
  state,
  repo,
  previewMode,
  onPreviewMode,
}: {
  state: api.CloudState;
  repo: api.CloudRepo | undefined;
  previewMode: api.PreviewMode;
  onPreviewMode: (mode: api.PreviewMode) => void;
}) {
  const [page, setPage] = useState<Page>("menu");

  if (page !== "menu") {
    return (
      <div className="m-screen">
        <header className="m-head">
          <button className="m-backbtn" onClick={() => setPage("menu")}>
            ‹ More
          </button>
          <h1>{titleOf(page)}</h1>
        </header>
        <div className="m-scroll">
          {page === "activity" && <Activity />}
          {page === "team" && <Team />}
          {page === "settings" && (
            <Settings
              state={state}
              repo={repo}
              previewMode={previewMode}
              onPreviewMode={onPreviewMode}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="m-screen">
      <header className="m-head">
        <h1>More</h1>
      </header>
      <div className="m-scroll">
        <div className="m-whoami">
          <UserAvatar
            url={state.me?.avatar_url ?? null}
            name={state.me?.name ?? state.me?.login ?? "?"}
            size={44}
          />
          <span className="m-row-main">
            <span className="m-row-title">{state.me?.name ?? state.me?.login}</span>
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

  if (activity.isLoading) return <Spinner label="Reading the history…" />;
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
                {commit.author_login || commit.author_name} ·{" "}
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
  if (team.isLoading) return <Spinner label="Reading the team…" />;
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

function Settings({
  state,
  repo,
  previewMode,
  onPreviewMode,
}: {
  state: api.CloudState;
  repo: api.CloudRepo | undefined;
  previewMode: api.PreviewMode;
  onPreviewMode: (mode: api.PreviewMode) => void;
}) {
  const queryClient = useQueryClient();
  const [theme, setTheme] = useTheme();
  const [clientId, setClientId] = useState("");
  const [cacheBytes, setCacheBytes] = useState(0);
  const [askingOut, setAskingOut] = useState(false);

  useEffect(() => {
    void api.getClientId().then(setClientId).catch(() => {});
    void api.previewCacheBytes().then(setCacheBytes).catch(() => {});
  }, []);

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
        <h3 className="m-subhead">Previews</h3>
        <p className="muted small">
          A CAD preview means downloading the whole file once. It is kept
          afterwards, so it is paid for once per revision.
        </p>
        <Segmented
          value={previewMode}
          onChange={onPreviewMode}
          options={[
            { value: "wifi", label: "On wifi" },
            { value: "always", label: "Always" },
            { value: "never", label: "Never" },
          ]}
        />
        {state.platform === "ios" && previewMode === "wifi" && (
          <p className="muted small">
            iOS does not tell an app what kind of connection it is on, so
            SolidLocker cannot actually check. Treat this as your own rule.
          </p>
        )}
        <p className="m-setting-line muted small">
          Kept on this device: {cacheBytes > 0 ? bytes(cacheBytes) : "nothing yet"}
        </p>
        <button
          className="m-btn"
          onClick={async () => {
            await api.clearPreviews();
            setCacheBytes(0);
            queryClient.invalidateQueries({ queryKey: ["cloud", "previews"] });
          }}
        >
          Throw the previews away
        </button>
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
