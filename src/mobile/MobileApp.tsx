import { useEffect, useState } from "react";

import * as api from "./api";
import { useCloudState, useLocks, useRepo } from "./queries";
import { Spinner, Trouble } from "./components";
import { SignIn } from "./screens/SignIn";
import { PickProject } from "./screens/PickProject";
import { Files } from "./screens/Files";
import { Locks } from "./screens/Locks";
import { Merges } from "./screens/Merges";
import { BranchesTab } from "./screens/BranchesTab";
import { Insights } from "./screens/Insights";
import { More } from "./screens/More";
import "./mobile.css";

const TABS = ["locks", "files", "branches", "insights", "merges", "more"] as const;
type Tab = (typeof TABS)[number];

/**
 * The phone app.
 *
 * It is a different app from the desktop one, not a squeezed copy, because it
 * is answering a different question. On a machine the question is "let me get
 * on with this model"; away from it the question is "who has got the model,
 * and can I have it". Everything that needs the files themselves lives on the
 * desktop and is honestly absent here rather than present and broken.
 */
export function MobileApp() {
  const state = useCloudState();
  const [tab, setTab] = useState<Tab>("locks");
  // Which way the last move went, so a screen arrives from the side the tab
  // it replaced sits on. Going left to right should look like going left to
  // right.
  const [wentForward, setWentForward] = useState(true);

  const goTo = (next: Tab) => {
    setWentForward(TABS.indexOf(next) >= TABS.indexOf(tab));
    setTab(next);
  };
  const [previewMode, setPreviewMode] = useState<api.PreviewMode>("wifi");

  useEffect(() => {
    void api.getPreviewMode().then(setPreviewMode).catch(() => {});
  }, []);

  // Pinch and double-tap zoom belong in a browser, not in an app: a stray
  // two-finger touch while scrolling a file list leaves the whole interface
  // askew with no obvious way back. Set here rather than in index.html so the
  // desktop build keeps its own zoom.
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    meta?.setAttribute(
      "content",
      "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover",
    );
  }, []);

  const signedIn = state.data?.signed_in ?? false;
  const hasRepo = Boolean(state.data?.slug);
  const repo = useRepo(signedIn && hasRepo);
  // Kept warm here so the tab badge is right whichever screen is showing.
  const locks = useLocks(signedIn && hasRepo);

  if (state.isLoading) {
    return (
      <div className="m-app m-centre">
        <Spinner label="Starting up…" />
      </div>
    );
  }

  if (state.isError) {
    return (
      <div className="m-app m-centre">
        <Trouble error={state.error} onRetry={() => state.refetch()} />
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="m-app m-centre">
        <SignIn canDeviceSignIn={state.data?.can_device_sign_in ?? false} />
      </div>
    );
  }

  if (!hasRepo) {
    return (
      <div className="m-app">
        <PickProject
          onSignOut={async () => {
            await api.signOut();
            state.refetch();
          }}
        />
      </div>
    );
  }

  const canPush = repo.data?.can_push ?? false;
  const branch = state.data?.branch ?? repo.data?.default_branch ?? "main";

  async function chooseMode(mode: api.PreviewMode) {
    setPreviewMode(mode);
    await api.setPreviewMode(mode);
  }

  return (
    <div className="m-app">
      {/* Keyed on the tab so React remounts on every change, which is what
          lets the arriving screen play its slide. */}
      <main className={`m-body ${wentForward ? "m-fromright" : "m-fromleft"}`} key={tab}>
        {tab === "locks" && (
          <Locks
            previewMode={previewMode}
            canPush={canPush}
            branch={branch}
            defaultBranch={repo.data?.default_branch ?? "main"}
          />
        )}
        {tab === "files" && <Files previewMode={previewMode} canPush={canPush} />}
        {tab === "branches" && <BranchesTab />}
        {tab === "insights" && (
          <div className="m-screen">
            <header className="m-head">
              <h1>Insights</h1>
            </header>
            <div className="m-scroll">
              <Insights />
            </div>
          </div>
        )}
        {tab === "merges" && <Merges canPush={canPush} />}
        {tab === "more" && (
          <More
            state={state.data!}
            repo={repo.data}
            previewMode={previewMode}
            onPreviewMode={chooseMode}
          />
        )}
      </main>

      <nav className="m-tabs" aria-label="Go to">
        <TabButton
          tab="locks"
          current={tab}
          onGo={goTo}
          label="Locks"
          badge={locks.data?.ours.length ?? 0}
          icon={<LockGlyph />}
        />
        <TabButton
          tab="files"
          current={tab}
          onGo={goTo}
          label="Files"
          icon={<FilesGlyph />}
        />
        <TabButton
          tab="branches"
          current={tab}
          onGo={goTo}
          label="Branches"
          icon={<BranchGlyph />}
        />
        <TabButton
          tab="insights"
          current={tab}
          onGo={goTo}
          label="Insights"
          icon={<InsightGlyph />}
        />
        <TabButton
          tab="merges"
          current={tab}
          onGo={goTo}
          label="Merges"
          icon={<MergeGlyph />}
        />
        <TabButton
          tab="more"
          current={tab}
          onGo={goTo}
          label="More"
          icon={<MoreGlyph />}
        />
      </nav>
    </div>
  );
}

function TabButton({
  tab,
  current,
  onGo,
  label,
  icon,
  badge,
}: {
  tab: Tab;
  current: Tab;
  onGo: (tab: Tab) => void;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}) {
  const active = tab === current;
  return (
    <button
      className={`m-tab${active ? " active" : ""}`}
      onClick={() => onGo(tab)}
      aria-current={active ? "page" : undefined}
    >
      <span className="m-tab-icon" aria-hidden="true">
        {icon}
        {badge !== undefined && badge > 0 && <span className="m-tab-badge">{badge}</span>}
      </span>
      <span className="m-tab-label">{label}</span>
    </button>
  );
}

const stroke = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function LockGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" {...stroke}>
      <rect x="4" y="10" width="16" height="10" rx="2.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function FilesGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" {...stroke}>
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h9A1.5 1.5 0 0 1 21 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5Z" />
    </svg>
  );
}

function BranchGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" {...stroke}>
      <circle cx="7" cy="6" r="2.4" />
      <circle cx="7" cy="18" r="2.4" />
      <circle cx="17" cy="10" r="2.4" />
      <path d="M7 8.4v7.2" />
      <path d="M17 12.4c0 3-2.6 3.4-5.4 3.9" />
    </svg>
  );
}

function InsightGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" {...stroke}>
      <path d="M4 19h16" />
      <path d="M7 19v-6" />
      <path d="M12 19V6" />
      <path d="M17 19v-9" />
    </svg>
  );
}

function MergeGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" {...stroke}>
      <circle cx="7" cy="6" r="2.4" />
      <circle cx="7" cy="18" r="2.4" />
      <circle cx="17" cy="18" r="2.4" />
      <path d="M7 8.4v7.2" />
      <path d="M17 15.6V12a3 3 0 0 0-3-3H9" />
      <path d="m11 7 -2 2 2 2" />
    </svg>
  );
}

function MoreGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" {...stroke}>
      <circle cx="5.5" cy="12" r="1.4" fill="currentColor" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.4" fill="currentColor" />
    </svg>
  );
}
