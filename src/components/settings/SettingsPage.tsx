/* 
// import { SplashGallery, SPLASH_GALLERY } from "./SplashGallery";
*/
import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import DialLogo from "../DialLogo";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  checkForUpdate,
  cloneRepo,
  githubSignIn,
  githubSignedIn,
  openLogsFolder,
  openRepoFolder,
  selectExistingRepo,
  signOutGithub,
} from "../../api";
import { isAppError, type AppState } from "../../types";
import { githubAvatarUrl, UserAvatar } from "../common/UserAvatar";
import { usePeople } from "../../identity";
import { copy } from "../../copy";
// import { BugReportDialog } from "../dialogs/BugReportDialog";
import { GlassSelect } from "../common/GlassSelect";
import { FilterBar } from "../common/FilterBar";
import { SetupChecks } from "./SetupChecks";
import { useTheme } from "../../theme";
import { BranchName, useBranchColors } from "../common/BranchName";
import { BranchGlyph } from "../common/HistoryDiagrams";

const THEME_CHOICES = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const FETCH_CHOICES = [
  { seconds: 15, short: "15 sec", label: "Every 15 seconds (recommended)" },
  { seconds: 30, short: "30 sec", label: "Every 30 seconds" },
  { seconds: 60, short: "1 min", label: "Every minute" },
  { seconds: 120, short: "2 min", label: "Every 2 minutes" },
  { seconds: 300, short: "5 min", label: "Every 5 minutes" },
];

const STALE_CHOICES = [
  { days: 1, short: "1 day", label: "After 1 day" },
  { days: 3, short: "3 days", label: "After 3 days (recommended)" },
  { days: 7, short: "7 days", label: "After 7 days" },
  { days: 0, short: "Never", label: "Never remind me" },
];

const BIGFILE_CHOICES = [
  { mb: 5, short: "5 MB", label: "Over 5 MB (recommended)" },
  { mb: 25, short: "25 MB", label: "Over 25 MB" },
  { mb: 50, short: "50 MB", label: "Over 50 MB" },
  { mb: 0, short: "Never", label: "Never warn" },
];

/** Asks GitHub whether a newer release exists on demand. */
function UpdateTool() {
  const [busy, setBusy] = useState(false);
  const [word, setWord] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  function look() {
    setBusy(true);
    setWord(null);
    setLink(null);
    checkForUpdate()
      .then((u) => {
        if (u.newer) {
          setWord(`${u.latest} is out. Right now you have ${u.current}. Update soon to get the latest features and fixes.`);
          setLink(u.url);
        } else {
          setWord(`You are on the newest version (${u.current}).`);
        }
      })
      .catch((e) => setWord(isAppError(e) ? e.message : String(e)))
      .finally(() => setBusy(false));
  }
  return (
    <div className="setuprow updatetool">
      <button
        className="ghbtn"
        onClick={look}
        disabled={busy}
        title="The app also checks on its own once a day"
      >
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
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M3 21v-5h5" />
          <circle cx="12" cy="12" r="2.6" />
          <path d="M14.6 12h1.3M13.95 8.62l-.65 1.13M10.05 8.62l.65 1.13M8.1 12h1.3M10.05 15.38l.65-1.13M13.95 15.38l-.65-1.13" />
        </svg>
        {busy ? "Checking…" : "Check for updates"}
      </button>
      {word && <span className="muted small">{word}</span>}
      {link && (
        <button className="notice-ok" onClick={() => void openUrl(link)}>
          Open the release page
        </button>
      )}
    </div>
  );
}

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
}) {
  const [theme, setTheme] = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [cloning, setCloning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  // const [bugOpen, setBugOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [version, setVersion] = useState("");
  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

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
  const branchColorOf = useBranchColors();
  const [owner, shortRepo] = (() => {
    const cut = repo.repo_slug.lastIndexOf("/");
    return cut < 0
      ? ["", repo.repo_slug]
      : [repo.repo_slug.slice(0, cut), repo.repo_slug.slice(cut + 1)];
  })();

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
      {/* bugOpen && <BugReportDialog onClose={() => setBugOpen(false)} /> */}
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
        <div className="settingsbrand">
          <span className="logoglow">
            <DialLogo className="settingslogo" label="" />
          </span>
          <div className="settingstitle">
            <div className="settingsname">
              <h2>SolidLocker</h2>
              {version && <span className="versiontag">v{version}</span>}
            </div>
            {/* The only line under the name, so it carries its weight. */}
            <span className="muted settingsby">
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
          {/* The bug report button opened a dialog; it is a plain line at
              the bottom of the page now.
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
          */}
          <UpdateTool />
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

        {/* Was three facts in one muted paragraph with a <br> in the middle.
            The folder path is what people come here for when something is
            wrong, so it gets its own line in a monospace face. */}
        <section className="setupsection">
          <h3>Repository</h3>
          <p className="muted">
            The currently opened project in SolidLocker.
          </p>
          <div className="repocard">
            <span className="repoicon" aria-hidden="true">
              <svg
                viewBox="0 0 16 16"
                width="26"
                height="26"
                fill="currentColor"
              >
                <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2A1.75 1.75 0 0 0 5 1H1.75Z" />
              </svg>
            </span>
            <div className="repodetails">
              <span className="reponame">
                {/* Owner and name as one run, so the ellipsis has something
                    to bite on. Loose in the flex row they were an anonymous
                    item that could only wrap, and it wrapped into the
                    buttons. */}
                <span className="repotitle" title={repo.repo_slug}>
                  <span className="repoowner">{owner ? `${owner}/` : ""}</span>
                  {shortRepo}
                </span>
                <span
                  className="repobranch"
                  title={`On branch ${repo.branch}`}
                >
                  <span style={{ color: branchColorOf(repo.branch) }}>
                    <BranchGlyph size={12} />
                  </span>
                  <BranchName name={repo.branch} />
                </span>
              </span>
              <code className="repopath" title={repo.repo_path}>
                {repo.repo_path}
              </code>
            </div>
            <div className="repoaction">
              <button
                onClick={() =>
                  openRepoFolder().catch((e) =>
                    setError(isAppError(e) ? e.message : String(e)),
                  )
                }
                disabled={cloning}
              >
                Open in File Explorer
              </button>
              <button onClick={pickExisting} disabled={cloning}>
                Change…
              </button>
            </div>
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

        <section className="setupsection settingsplit">
          <div className="settingtext">
          <h3>Appearance</h3>
          <p className="muted">
            Follow Windows' light or dark setting, or pick one.
          </p>
          </div>
          <FilterBar
            ariaLabel="App appearance"
            value={theme}
            onChange={(v) => setTheme(v as typeof theme)}
            options={THEME_CHOICES.map((c) => ({
              value: c.value as typeof theme,
              label: c.label,
            }))}
          />
        </section>

        <section className="setupsection settingsplit">
          <div className="settingtext">
          <h3>Checking for team changes</h3>
          <p className="muted">
            How often SolidLocker looks on GitHub for teammates' changes. Lock
            info is always checked every 10 seconds regardless.
          </p>
          </div>
          <FilterBar
            ariaLabel="How often to check for team changes"
            value={String(fetchIntervalS)}
            onChange={(v) => onFetchIntervalChange(Number(v))}
            options={FETCH_CHOICES.map((c) => ({
              value: String(c.seconds),
              label: c.short,
              title: c.label,
            }))}
          />
        </section>

        <section className="setupsection settingsplit">
          <div className="settingtext">
          <h3>Unlock reminders</h3>
          <p className="muted">
            Remind you to unlock files you have locked but not changed in a
            while, so teammates are not left waiting.
          </p>
          </div>
          <FilterBar
            ariaLabel="Unlock reminders"
            value={String(staleDays)}
            onChange={(v) => onStaleDaysChange(Number(v))}
            options={STALE_CHOICES.map((c) => ({
              value: String(c.days),
              label: c.short,
              title: c.label,
            }))}
          />
        </section>

        <section className="setupsection settingsplit">
          <div className="settingtext">
          <h3>When you close the window</h3>
          <p className="muted">
            Running in the background keeps protecting your files and lets
            SolidLocker tell you when a file you are waiting on is free.
          </p>
          </div>
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

        <section className="setupsection settingsplit">
          <div className="settingtext">
          <h3>Large file warning</h3>
          <p className="muted">
            Point out unusually large files in Save &amp; Share before they make
            downloads slow for the whole team.
          </p>
          </div>
          <FilterBar
            ariaLabel="Large file warning"
            value={String(bigFileMb)}
            onChange={(v) => onBigFileMbChange(Number(v))}
            options={BIGFILE_CHOICES.map((c) => ({
              value: String(c.mb),
              label: c.short,
              title: c.label,
            }))}
          />
        </section>

        <section className="setupsection">
          <h3>When something is wrong</h3>
          <div className="toollist">
            <div className="tool">
              <div className="settingtext">
                <strong>Fix file permissions</strong>
                <p className="muted">
                  Sets every file back to view-only except the ones you hold.
                  Run it if a file is editable when it shouldn't be, or won't
                  open when it should.
                </p>
              </div>
              <div className="setuprow">
                <button onClick={onFixPerms}>Fix them</button>
              </div>
            </div>

            <div className="tool">
              <div className="settingtext">
                <strong>Open log folder</strong>
                <p className="muted">
                  Errors and slow operations are recorded here. Attach this
                  when reporting a problem.
                </p>
              </div>
              <div className="setuprow">
                <button onClick={() => void openLogsFolder().catch(() => {})}>
                  Open in File Explorer
                </button>
              </div>
            </div>

            <div className="tool">
              <div className="settingtext">
                <strong>Check this computer</strong>
                <p className="muted">
                  Checks Git, Git LFS, locking, CAD files and previews on this
                  machine. Run it after setup, or when something is off.
                </p>
              </div>
              <SetupChecks />
            </div>
            {/* The update check lived down here for a while; it moved up to
                the header next to the version number.
            <div className="tool">
              <div className="settingtext">
                <strong>Check for updates</strong>
                <p className="muted small">
                  Asks GitHub whether a newer SolidLocker release is out. The
                  app also checks automatically once a day on its own.
                </p>
              </div>
              <UpdateTool />
            </div>
            */}
          </div>
        </section>

        <p className="muted small bugfooter">
          Found a bug? DM Scaven X (scaaavx) on Discord, or open an issue on{" "}
          <a
            className="linkish inline"
            href="https://github.com/RU-Airborne/SolidLocker/issues"
            onClick={(e) => {
              e.preventDefault();
              openUrl("https://github.com/RU-Airborne/SolidLocker/issues");
            }}
          >
            GitHub project page
          </a>
          , and attach the log from the folder above.
        </p>

        {/*
        {SPLASH_GALLERY && <SplashGallery />}
        */}
      </div>
    </main>
  );
}
