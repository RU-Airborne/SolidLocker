import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import {
  cloneRepo,
  githubSignIn,
  listMyRepos,
  selectExistingRepo,
  type RepoChoice,
} from "../../api";
import { isAppError, type RepoInfo } from "../../types";
import { formatAgo } from "../../dates";
import { UserAvatar } from "./UserAvatar";
import { Loading } from "./Loading";
import { playFileOpenComplete, playMateFailed } from "../../sounds";
import DialLogo from "../DialLogo";

export function RepoPicker({
  onOpened,
  browseTitle,
}: {
  onOpened: (info: RepoInfo, cloned: boolean) => void;
  browseTitle: string;
}) {
  const [needle, setNeedle] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const repos = useQuery<RepoChoice[]>({
    queryKey: ["myRepos"],
    queryFn: listMyRepos,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const shown = useMemo(() => {
    const all = repos.data ?? [];
    const q = needle.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (r) =>
        r.slug.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q),
    );
  }, [repos.data, needle]);

  async function download(r: RepoChoice) {
    if (busy) return;
    setError(null);
    const parent = await open({
      directory: true,
      title: `Choose where to put ${r.name}`,
    });
    if (typeof parent !== "string") return;
    setBusy(r.slug);
    setProgress("Contacting GitHub…");
    try {
      const info = await cloneRepo(r.clone_url, parent, (line) =>
        setProgress(line),
      );
      playFileOpenComplete();
      onOpened(info, true);
    } catch (e) {
      playMateFailed();
      setError(isAppError(e) ? e.message : String(e));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  async function browse() {
    if (busy) return;
    setError(null);
    const dir = await open({ directory: true, title: browseTitle });
    if (typeof dir !== "string") return;
    setBusy("browse");
    try {
      const info = await selectExistingRepo(dir);
      playFileOpenComplete();
      onOpened(info, false);
    } catch (e) {
      playMateFailed();
      setError(isAppError(e) ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function signIn() {
    setSigningIn(true);
    setError(null);
    try {
      if (await githubSignIn()) {
        await repos.refetch();
      } else {
        setError("GitHub sign-in did not finish. Please try again.");
      }
    } catch (e) {
      setError(isAppError(e) ? e.message : String(e));
    } finally {
      setSigningIn(false);
    }
  }

  const busyRepo = shown.find((r) => r.slug === busy);

  return (
    <div className="repopicker">
      {busy !== null &&
        createPortal(
          <div className="switchblock switchblock-full" role="status" aria-live="polite">
            <div className="switchblock-card">
              <DialLogo className="switchlogo" label="" spinning />
              <p className="switchblock-title">
                {busyRepo
                  ? `Downloading ${busyRepo.name}…`
                  : "Opening your project…"}
              </p>
              <p className="muted small">
                {progress ??
                  "Checking the repository and preparing the CAD files. The first open of a large project can take a few minutes."}
              </p>
            </div>
          </div>,
          document.body,
        )}
      <input
        className="repopicksearch"
        placeholder="Search your projects…"
        value={needle}
        disabled={busy !== null}
        onChange={(e) => setNeedle(e.target.value)}
        aria-label="Search your projects"
      />

      {repos.isLoading && <Loading what="Reading your projects from GitHub…" />}

      {repos.isError && (
        isAppError(repos.error) && repos.error.code === "AUTH" ? (
          <p className="muted small">
            Sign in to GitHub to see your repositories.{" "}
            <button className="linkish" onClick={signIn} disabled={signingIn}>
              {signingIn ? "Waiting for GitHub…" : "Sign in"}
            </button>
          </p>
        ) : (
          <p className="errdetail">
            {isAppError(repos.error) ? repos.error.message : String(repos.error)}
          </p>
        )
      )}

      {repos.data && shown.length === 0 && (
        <p className="muted small repopicknone">
          {repos.data.length === 0
            ? "No projects you can write to. Ask whoever owns the repository to add you."
            : "Nothing matched. Try part of the owner or project name."}
        </p>
      )}

      {shown.length > 0 && (
        <ul className="repopicklist">
          {shown.map((r) => (
            <li key={r.slug}>
              <button
                className="repopickitem"
                disabled={busy !== null}
                onClick={() => download(r)}
                title={`Download ${r.slug}`}
              >
                <UserAvatar url={r.owner_avatar} name={r.owner} size={30} />
                <span className="repopickbody">
                  <span className="repopickname">
                    <span className="muted">{r.owner}/</span>
                    <strong>{r.name}</strong>
                    {r.private && (
                      <span className="repopickprivate" title="Private">
                        Private
                      </span>
                    )}
                  </span>
                  {r.description && (
                    <span className="muted small repopickblurb">
                      {r.description}
                    </span>
                  )}
                  <span className="muted small">
                    Updated {formatAgo(r.updated_at)}
                  </span>
                </span>
                {busy === r.slug && (
                  <span className="muted small repopickbusy">Downloading…</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="error">{error}</p>}

      <p className="muted small repopickbrowse">
        Already have a copy on this computer?{" "}
        <button className="linkish" onClick={browse} disabled={busy !== null}>
          {busy === "browse" ? "Opening…" : "Choose the folder…"}
        </button>
      </p>
    </div>
  );
}
