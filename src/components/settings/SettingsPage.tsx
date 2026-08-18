import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import DialLogo from "../DialLogo";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cloneRepo,
  githubSignIn,
  githubSignedIn,
  openRepoFolder,
  selectExistingRepo,
  signOutGithub,
} from "../../api";
import { isAppError, type AppState } from "../../types";
import { githubAvatarUrl, UserAvatar } from "../common/UserAvatar";
import { usePeople } from "../../identity";
import { copy } from "../../copy";
import { BugReportDialog } from "../dialogs/BugReportDialog";
import { GlassSelect } from "../common/GlassSelect";

const FETCH_CHOICES = [
  { seconds: 30, label: "Every 30 seconds" },
  { seconds: 60, label: "Every minute (recommended)" },
  { seconds: 120, label: "Every 2 minutes" },
  { seconds: 300, label: "Every 5 minutes" },
];

const STALE_CHOICES = [
  { days: 1, label: "After 1 day" },
  { days: 3, label: "After 3 days (recommended)" },
  { days: 7, label: "After 7 days" },
  { days: 0, label: "Never remind me" },
];

const BIGFILE_CHOICES = [
  { mb: 5, label: "Over 5 MB (recommended)" },
  { mb: 25, label: "Over 25 MB" },
  { mb: 50, label: "Over 50 MB" },
  { mb: 0, label: "Never warn" },
];

export function SettingsPage({
  appState,
  fetchIntervalS,
  onFetchIntervalChange,
  staleDays,
  onStaleDaysChange,
  bigFileMb,
  onBigFileMbChange,
  notifyConnection,
  onNotifyConnectionChange,
  closeBehavior,
  onCloseBehaviorChange,
  onFixPerms,
  onRepoChanged,
  onClose,
}: {
  appState: AppState;
  fetchIntervalS: number;
  onFetchIntervalChange: (seconds: number) => void;
  staleDays: number;
  onStaleDaysChange: (days: number) => void;
  bigFileMb: number;
  onBigFileMbChange: (mb: number) => void;
  notifyConnection: boolean;
  onNotifyConnectionChange: (on: boolean) => void;
  closeBehavior: "ask" | "tray" | "quit";
  onCloseBehaviorChange: (mode: "ask" | "tray" | "quit") => void;
  onFixPerms: () => void;
  onRepoChanged: (message: string) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [cloning, setCloning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [bugOpen, setBugOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const queryClient = useQueryClient();
  const signedIn = useQuery({
    queryKey: ["githubSignedIn"],
    queryFn: githubSignedIn,
    staleTime: 30_000,
  });
  function doSignOut() {
    setSigningOut(true);
    signOutGithub()
      .then(() => {
        setSignOutOpen(false);
        queryClient.invalidateQueries({ queryKey: ["githubSignedIn"] });
        queryClient.invalidateQueries({ queryKey: ["appState"] });
      })
      .catch((e) => setError(isAppError(e) ? e.message : String(e)))
      .finally(() => setSigningOut(false));
  }

  function doSignIn() {
    setSigningOut(true);
    githubSignIn()
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["githubSignedIn"] });
        queryClient.invalidateQueries({ queryKey: ["appState"] });
      })
      .catch((e) => setError(isAppError(e) ? e.message : String(e)))
      .finally(() => setSigningOut(false));
  }

  const repo = appState.repo!;
  const directory = usePeople();

  async function pickExisting() {
    if (cloning) return;
    setError(null);
    const dir = await open({
      directory: true,
      title: "Select the repository folder SolidLocker should manage",
    });
    if (typeof dir !== "string") return;
    try {
      const info = await selectExistingRepo(dir);
      onRepoChanged(copy.nowManaging(info.repo_slug));
    } catch (e) {
      setError(isAppError(e) ? e.message : String(e));
    }
  }

  async function startClone() {
    if (cloning || url.trim() === "") return;
    setError(null);
    const parent = await open({
      directory: true,
      title: "Choose where to put the project folder",
    });
    if (typeof parent !== "string") return;
    setCloning(true);
    setProgress("Contacting GitHub…");
    try {
      const info = await cloneRepo(url.trim(), parent, (line) =>
        setProgress(line),
      );
      onRepoChanged(copy.downloadedAndManaging(info.repo_slug));
    } catch (e) {
      setError(isAppError(e) ? e.message : String(e));
    } finally {
      setCloning(false);
      setProgress(null);
    }
  }

  return (
    <main className="settingspage">
      {bugOpen && <BugReportDialog onClose={() => setBugOpen(false)} />}
      {signOutOpen && (
        <div className="modal-backdrop" onClick={() => setSignOutOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Sign out of GitHub?</h2>
            <p>
              This forgets the GitHub sign in saved on this computer, so the
              next lock or share opens a browser window to sign in again.
            </p>
            <p className="warn-inline">
              Files you have locked stay locked under your old account. Unlock
              anything you are done with before switching.
            </p>
            <div className="modal-actions">
              <button onClick={() => setSignOutOpen(false)} disabled={signingOut}>
                Cancel
              </button>
              <button className="danger" onClick={doSignOut} disabled={signingOut}>
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="settingshead">
        <button className="backbtn" onClick={onClose} disabled={cloning}>
          ← Back
        </button>
        <div className="settingsbrand">
          <span className="logoglow">
            <DialLogo className="settingslogo" label="" />
          </span>
          <div className="settingstitle">
            <h2>SolidLocker</h2>
            <span className="muted">
              by{" "}
              <a
                className="linkish inline"
                href="https://github.com/scavenx"
                onClick={(e) => {
                  e.preventDefault();
                  openUrl("https://github.com/scavenx");
                }}
              >
                Scaven X
              </a>{" "}
              at RU Airborne
            </span>
          </div>
          <span className="spacer" />
          <div className="headerbtns">
          <button
            className="ghbtn"
            onClick={() => openUrl("https://github.com/RU-Airborne/SolidLocker")}
            title="Open GitHub"
          >
            <svg
              viewBox="0 0 16 16"
              width="16"
              height="16"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
            </svg>
            Open project on GitHub
          </button>
          <button
            className="ghbtn"
            onClick={() => setBugOpen(true)}
            title="Report a problem"
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M8 6a4 4 0 0 1 8 0v1H8z" />
              <path d="M6.5 10a5.5 5.5 0 0 1 11 0v3a5.5 5.5 0 0 1-11 0z" />
              <path d="M3 11h3.5M17.5 11H21M3.8 17.5 6.9 16M17.1 16l3.1 1.5M4.5 5.6 7 7.4M19.5 5.6 17 7.4M12 21v-3" />
            </svg>
            Found a bug?
          </button>
          </div>
        </div>
      </div>

      <div className="settingsbody">
        {error && <p className="error">{error}</p>}

        <section className="setupsection">
          <h3>GitHub Account</h3>
          <p className="muted">
            {signedIn.data === false
              ? "Signing in opens a browser window. Windows remembers it afterwards, and SolidLocker never sees your password."
              : "Sign out to switch to a different GitHub account. This forgets the sign in saved on this computer, including for other apps like GitHub Desktop."}
          </p>
          <div className="accountcard">
            <div className="accountavatar">
              {appState.username ? (
                <UserAvatar
                  url={githubAvatarUrl(appState.username)}
                  name={directory.nameFor(appState.username) ?? appState.username}
                  size={56}
                />
              ) : (
                <span className="avatar-img avatar-initials" style={{ width: 56, height: 56 }}>
                  ?
                </span>
              )}
            </div>

            <div className="accountdetails">
              <span className="accountname">
                {appState.username
                  ? (directory.nameFor(appState.username) ?? appState.username)
                  : signedIn.data === false
                    ? "No account yet"
                    : "Your account"}
              </span>
              {appState.username ? (
                <span className="muted accounthandle">@{appState.username}</span>
              ) : signedIn.data === false ? null : (
                <span className="muted accounthandle">
                  Your name and picture appear here after you sign in.
                </span>
              )}
              <span className="accountstatus muted small">
                <span
                  className={`statusdot${signedIn.data === false ? " off" : signedIn.isLoading ? " unknown" : ""}`}
                />
                {signedIn.isLoading
                  ? "Checking GitHub…"
                  : signedIn.data === false
                    ? "Not signed in, so locking and sharing will not work"
                    : "Connected to GitHub"}
                {appState.lfs_version ? ` · ${appState.lfs_version}` : ""}
              </span>
            </div>

            <div className="accountaction">
              {signedIn.data === false ? (
                <button onClick={doSignIn} disabled={signingOut}>
                  {signingOut ? "Waiting for GitHub…" : "Sign in"}
                </button>
              ) : (
                <button
                  onClick={() => setSignOutOpen(true)}
                  disabled={signedIn.isLoading}
                >
                  Sign out
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="setupsection">
          <h3>Repository</h3>
          <p className="muted" title={repo.repo_path}>
            {repo.repo_slug} · branch {repo.branch}
            <br />
            {repo.repo_path}
          </p>
          <div className="setuprow">
            <button onClick={pickExisting} disabled={cloning}>
              Select a different folder…
            </button>
            <button
              onClick={() =>
                openRepoFolder().catch((e) =>
                  setError(isAppError(e) ? e.message : String(e)),
                )
              }
              disabled={cloning}
            >
              Open folder
            </button>
          </div>
        </section>

        <section className="setupsection">
          <h3>Download another Git LFS project</h3>
          <p className="muted">
            Paste the repository link from GitHub's green &ldquo;Code&rdquo;
            button. SolidLocker will download it and switch to it.
          </p>
          <div className="setuprow">
            <input
              placeholder="https://github.com/your-team/your-project"
              value={url}
              disabled={cloning}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && startClone()}
            />
            <button
              className="primary"
              disabled={cloning || url.trim() === ""}
              onClick={startClone}
            >
              {cloning ? "Downloading…" : "Download"}
            </button>
          </div>
          {progress && <p className="muted progressline">{progress}</p>}
        </section>

        <section className="setupsection">
          <h3>Checking for team changes</h3>
          <p className="muted">
            How often SolidLocker looks on GitHub for teammates' changes. Lock
            info is always checked every 10 seconds regardless.
          </p>
          <GlassSelect
            className="settingselect"
            ariaLabel="How often to check for team changes"
            value={String(fetchIntervalS)}
            onChange={(v) => onFetchIntervalChange(Number(v))}
            options={FETCH_CHOICES.map((c) => ({
              value: String(c.seconds),
              label: c.label,
            }))}
          />
        </section>

        <section className="setupsection">
          <h3>Unlock reminders</h3>
          <p className="muted">
            Remind you to unlock files you have locked but not changed in a
            while, so teammates are not left waiting.
          </p>
          <GlassSelect
            className="settingselect"
            ariaLabel="Unlock reminders"
            value={String(staleDays)}
            onChange={(v) => onStaleDaysChange(Number(v))}
            options={STALE_CHOICES.map((c) => ({
              value: String(c.days),
              label: c.label,
            }))}
          />
        </section>

        <section className="setupsection">
          <h3>When you close the window</h3>
          <p className="muted">
            Running in the background keeps protecting your files and lets
            SolidLocker tell you when a file you are waiting on is free.
          </p>
          <GlassSelect
            className="settingselect"
            ariaLabel="When you close the window"
            value={closeBehavior}
            onChange={(v) =>
              onCloseBehaviorChange(v as "ask" | "tray" | "quit")
            }
            options={[
              { value: "tray", label: "Keep running in the background" },
              { value: "quit", label: "Quit completely" },
              { value: "ask", label: "Ask me every time" },
            ]}
          />
        </section>

        <section className="setupsection">
          <h3>Connection alerts</h3>
          <p className="muted">
            Get a notification when SolidLocker loses its connection to GitHub and
            when it comes back. While offline, locking and unlocking are
            paused.
          </p>
          <label className="togglerow">
            <input
              type="checkbox"
              checked={notifyConnection}
              onChange={(e) => onNotifyConnectionChange(e.target.checked)}
            />
            <span>Tell me when the connection changes</span>
          </label>
        </section>

        <section className="setupsection">
          <h3>Large file warning</h3>
          <p className="muted">
            Point out unusually large files in Save &amp; Share before they make
            downloads slow for the whole team.
          </p>
          <GlassSelect
            className="settingselect"
            ariaLabel="Large file warning"
            value={String(bigFileMb)}
            onChange={(v) => onBigFileMbChange(Number(v))}
            options={BIGFILE_CHOICES.map((c) => ({
              value: String(c.mb),
              label: c.label,
            }))}
          />
        </section>

        <section className="setupsection">
          <h3>Maintenance</h3>
          <p className="muted">
            Makes sure only the files you have locked are editable and sets
            everything else back to view only. Run this if a file looks
            editable or locked when it should not be.
          </p>
          <div className="setuprow">
            <button onClick={onFixPerms}>Fix file permissions</button>
          </div>
        </section>
      </div>
    </main>
  );
}
