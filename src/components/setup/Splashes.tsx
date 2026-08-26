import { openUrl } from "@tauri-apps/plugin-opener";
import DialLogo from "../DialLogo";

export function StartingUpSplash() {
  return (
    <div className="center">
      <div className="card launchscreen">
        <span className="logoglow">
          <DialLogo className="setuplogo" label="" spinning />
        </span>
        <h2>SolidLocker</h2>
        <p className="muted">Starting up…</p>
      </div>
    </div>
  );
}

export function NeedsGitSplash({ onRecheck }: { onRecheck: () => void }) {
  return (
    <div className="center">
      <div className="card">
        <span className="logoglow">
          <DialLogo className="setuplogo" label="" />
        </span>
        <h2>You need Git to continue</h2>
        <p>
          SolidLocker needs Git. GitHub Desktop brings everything you need in one
          install (Git, Git&nbsp;LFS, and the GitHub sign in).
        </p>
        <button onClick={() => openUrl("https://desktop.github.com/")}>
          Download GitHub Desktop
        </button>
        <p className="restart-callout">
          After installing GitHub Desktop,{" "}
          <strong>close SolidLocker completely and open it again.</strong>
        </p>
        <button onClick={onRecheck}>I&rsquo;ve installed it. Check again</button>
        <p className="muted small altinstall">
          Rather not use it?{" "}
          <a
            className="linkish inline"
            href="https://git-scm.com/download/win"
            onClick={(e) => {
              e.preventDefault();
              openUrl("https://git-scm.com/download/win");
            }}
          >
            Install Git for Windows
          </a>{" "}
          instead.
        </p>
      </div>
    </div>
  );
}
