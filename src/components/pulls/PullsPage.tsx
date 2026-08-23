import { BranchName } from "../common/BranchName";
import { MergeDiagram, TrashGlyph } from "../common/HistoryDiagrams";
import { useEffect, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  combineWithPicks,
  createPull,
  deleteBranch,
  getBranchOverview,
  listPulls,
  mergePreviewBetween,
  closePull,
  mergePull,
  mergedPicks,
  openVersion,
  planConflictsBetween,
  previewVersion,
  proposePicks,
  pullDetail,
  reviewPull,
  type Conflict,
  type PullDetail,
  type PullFile,
  type PullSummary,
} from "../../api";
import { clearPicks, picksFor, type Side } from "../../conflictPicks";
import { ConflictPicker, type Proposal } from "../common/ConflictPicker";
import { useClashLayout } from "../common/ClashRailway";
import { formatDateTime } from "../../dates";
import { isAppError } from "../../types";
import { UserAvatar } from "../common/UserAvatar";
import { Loading } from "../common/Loading";
import { formatPerson, usePeople } from "../../identity";

const shortName = (p: string) => p.split("/").pop() ?? p;

export function PullsPage({
  currentBranch,
  onClose,
  onOpenCommit,
  ask,
  onAsked,
}: {
  currentBranch: string;
  onClose: () => void;
  onOpenCommit: (sha: string) => void;
  ask?: { head: string; base: string } | null;
  onAsked?: () => void;
}) {
  const [open, setOpen] = useState<{ number: number; tidy?: boolean } | null>(null);
  const overview = useQuery({
    queryKey: ["branchOverview"],
    queryFn: getBranchOverview,
    staleTime: 30_000,
  });
  const tidyable = new Set(
    (overview.data ?? [])
      .filter((b) => !b.is_default && b.ahead === 0)
      .map((b) => b.name),
  );

  const pulls = useQuery<PullSummary[]>({
    queryKey: ["pulls"],
    queryFn: listPulls,
    staleTime: 60_000,
    retry: false,
  });

  // GitHub refuses a second open PR for the same pair, just open the existing one.
  const already = ask
    ? (pulls.data ?? []).find(
        (p) => p.state === "open" && p.head === ask.head && p.base === ask.base,
      )
    : undefined;
  useEffect(() => {
    if (already) {
      setOpen({ number: already.number });
      onAsked?.();
    }
  }, [already, onAsked]);
  const asking = !!ask && !already && !pulls.isLoading;

  if (open !== null) {
    return (
      <main className="settingspage pullspage">
        <div className="settingshead">
          <button className="backbtn" onClick={() => setOpen(null)}>
            ← All merge requests
          </button>
        </div>
        <div className="settingsbody">
          <PullView
            key={open.number}
            number={open.number}
            currentBranch={currentBranch}
            onOpenCommit={onOpenCommit}
            focusTidy={open.tidy === true}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="settingspage pullspage">
      <div className="settingshead">
        <button className="backbtn" onClick={onClose}>
          ← Back
        </button>
        <div className="settingsbrand">
          <div className="settingstitle">
            <h2>Merge Requests</h2>
            <p className="muted small">
              Requests to merge a branch, waiting for a team lead to approve
              them, and the ones already approved or closed.
            </p>
          </div>
        </div>
      </div>

      {asking && (
        <OpenPullDialog
          head={ask.head}
          base={ask.base}
          onClose={() => onAsked?.()}
          onOpened={(n) => {
            onAsked?.();
            setOpen({ number: n });
          }}
        />
      )}
      <div className="settingsbody">
            <section className="setupsection">
              <h3>Open requests</h3>
              {pulls.isLoading && <Loading what="Fetching information from GitHub…" />}
              {pulls.isError && (
                <p className="errdetail">
                  {isAppError(pulls.error)
                    ? pulls.error.message
                    : String(pulls.error)}
                </p>
              )}
              <PullList
                items={(pulls.data ?? []).filter((p) => p.state === "open")}
                empty="Nothing waiting. Requests made here or on GitHub show up in this list."
                onOpen={(number) => setOpen({ number })}
              />
            </section>

            <section className="setupsection">
              <h3>Closed requests</h3>
              <p className="muted">
                Merged, or closed without being merged. Open one to see
                what was kept from which branch.
              </p>
              <PullList
                items={(pulls.data ?? []).filter((p) => p.state !== "open")}
                empty="None yet."
                onOpen={(number) => setOpen({ number })}
                tidyable={tidyable}
                onTidy={(number) => setOpen({ number, tidy: true })}
              />
            </section>
      </div>

    </main>
  );
}

function PullList({
  items,
  empty,
  onOpen,
  tidyable,
  onTidy,
}: {
  items: PullSummary[];
  empty: string;
  onOpen: (number: number) => void;
  tidyable?: Set<string>;
  onTidy?: (number: number) => void;
}) {
  const directory = usePeople();
  if (items.length === 0) return <p className="muted small">{empty}</p>;
  return (
    <ul className="pulllist">
      {items.map((p) => (
        <li key={p.number} className={`pullcard ${p.state}`}>
          <button className="pullopen" onClick={() => onOpen(p.number)}>
            <UserAvatar
              url={p.author_avatar}
              name={directory.nameFor(p.author) ?? p.author}
              size={36}
            />
            <span className="pulltitle">
              <strong>
                {p.title} <span className="muted">#{p.number}</span>
                {p.draft ? <span className="muted"> · draft</span> : null}
              </strong>
              <span className="muted small">
                {formatPerson(directory.nameFor(p.author) ?? p.author, p.author)}
                {" · "}
                <BranchName name={p.head} /> → <BranchName name={p.base} />
              </span>
              <span className="muted small">
                Opened {formatDateTime(p.created_at)}
                {p.state === "merged"
                  ? ` · merged ${formatDateTime(p.merged_at)}`
                  : p.updated_at !== p.created_at
                    ? ` · last updated ${formatDateTime(p.updated_at)}`
                    : ""}
              </span>
            </span>
          </button>
          {p.state === "merged" && tidyable?.has(p.head) && onTidy && (
            <button
              className="pulltidy"
              onClick={() => onTidy(p.number)}
              title={`${p.head} is merged but still exists. Delete it`}
            >
              <TrashGlyph />
              Tidy up…
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function OpenPullDialog({
  head,
  base,
  onClose,
  onOpened,
}: {
  head: string;
  base: string;
  onClose: () => void;
  onOpened: (number: number) => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useQuery({
    queryKey: ["mergePreviewBetween", base, head],
    queryFn: () => mergePreviewBetween(base, head),
    staleTime: 30_000,
    retry: false,
  });
  const files = preview.data?.files ?? [];
  const clashes = preview.data?.conflicts ?? [];
  const nothing = preview.data?.up_to_date === true;

  // Clashing files can be picked here; the picks go up as a proposal.
  const clash = useQuery({
    queryKey: ["planConflictsBetween", base, head],
    queryFn: () => planConflictsBetween(`origin/${base}`, `origin/${head}`),
    enabled: clashes.length > 0,
    staleTime: 30_000,
    retry: false,
  });
  const clashFiles = clash.data ?? [];
  const pickKey = `ask:${head}>${base}`;
  const picks = picksFor(pickKey);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  function go() {
    setBusy(true);
    setError(null);
    const proposal = [...picks].map(([path, side]) => ({
      path,
      branch: side === "mine" ? base : head,
    }));
    createPull(title.trim(), body.trim(), head, base)
      .then(async (n) => {
        if (proposal.length > 0) {
          const d = await pullDetail(n);
          await proposePicks(
            n,
            d.head_sha,
            proposal,
            "COMMENT",
            `Picks for the file${proposal.length === 1 ? "" : "s"} with two versions.`,
          );
          clearPicks(pickKey);
        }
        queryClient.invalidateQueries({ queryKey: ["pulls"] });
        onOpened(n);
      })
      .catch((e) => {
        setError(isAppError(e) ? e.message : String(e));
        setBusy(false);
      });
  }

  return createPortal(
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div
        className={`modal askmodal${clashFiles.length > 0 ? " wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Request to merge</h2>
        <p className="muted">
          A team lead, or anyone allowed to approve, will look it over{" "}
          <BranchName name={head} /> before it goes into{" "}
          <BranchName name={base} />. Nothing changes on either branch until
          they approve and merge it.
        </p>
        <MergeDiagram fromBranch={head} intoBranch={base} intoIsCurrent={false} />

        <section className="asksection">
          <h3>What they will see</h3>
          {preview.isLoading && <p className="muted small">Comparing the branches…</p>}
          {preview.isError && (
            <p className="errdetail">
              {isAppError(preview.error) ? preview.error.message : String(preview.error)}
            </p>
          )}
          {nothing && (
            <p className="muted small">
              <BranchName name={base} /> already has everything from{" "}
              <BranchName name={head} />, so there is nothing to review yet.
            </p>
          )}
          {files.length > 0 && (
            <>
              <p className="muted small">
                {files.length} file{files.length === 1 ? "" : "s"} changed on{" "}
                <BranchName name={head} /> since it split from{" "}
                <BranchName name={base} />.
                {clashes.length > 0 && (
                  <>
                    {" "}
                    {clashes.length === 1 ? "One has" : `${clashes.length} have`}{" "}
                    two versions. Pick which to keep below.
                  </>
                )}
              </p>
              <div className="mergefilelist askfiles">
                <ul className="gg-files">
                  {files.map((f, i) => (
                    <li key={f.path} className={clashes.includes(f.path) ? "askclash" : ""}>
                      <span className={`st st-${f.status.toLowerCase()}`}>{f.status}</span>
                      {i < 12 && CAD_FILE.test(f.path) && f.status !== "D" && (
                        <AskThumb path={f.path} rev={`origin/${head}`} />
                      )}
                      <span className="gg-filepath">{f.path}</span>
                      {clashes.includes(f.path) && <span className="asktwo">two versions</span>}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </section>

        {clashFiles.length > 0 && (
          <div className="askpicker">
            <ConflictPicker
              files={clashFiles}
              ours={base}
              theirs={head}
              picks={picks}
              onChange={bump}
              busy={busy}
              title={`Merge conflicts (${clashFiles.length})`}
              intro={
                <>
                  Both <BranchName name={base} /> and <BranchName name={head} />{" "}
                  changed these files. SolidWorks files can&rsquo;t be merged, so
                  only one version of each can be carried over. Pick the one
                  you&rsquo;d like to keep. Your picks go with the request as a
                  suggestion; the reviewer can accept them or choose
                  differently. Leaving some unpicked is fine.
                </>
              }
            />
          </div>
        )}

        <section className="asksection">
          <h3>What to call it</h3>
          <label className="askfield">
            <span>Title</span>
            <input
              type="text"
              placeholder={`Changes on ${head}`}
              value={title}
              maxLength={120}
              autoFocus
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="askfield">
            <span>Note for the reviewer <em>optional</em></span>
            <textarea
              className="prbody"
              placeholder="What changed, and where to look first"
              value={body}
              rows={3}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
        </section>

        {error && <p className="errdetail">{error}</p>}
        {!busy && (preview.isLoading || nothing || !title.trim()) && (
          <p className="muted small askwhy">
            {preview.isLoading
              ? "Still comparing the branches…"
              : nothing
                ? `Nothing to review: ${base} already has everything from ${head}.`
                : "Needs a title."}
          </p>
        )}
        <div className="modal-actions">
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="primary"
            onClick={go}
            disabled={busy || !title.trim() || nothing || preview.isLoading}
          >
            {busy
              ? "Sending…"
              : picks.size > 0
                ? `Send the request with ${picks.size} pick${picks.size === 1 ? "" : "s"}`
                : "Send the request"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const CAD_FILE = /\.(sldprt|sldasm|slddrw)$/i;

function AskThumb({ path, rev }: { path: string; rev: string }) {
  const thumb = useQuery({
    queryKey: ["previewVersion", path, rev],
    queryFn: () => previewVersion(path, rev),
    staleTime: Infinity,
    retry: false,
  });
  return (
    <span className="fthumb mergethumb" aria-hidden="true">
      {thumb.data && <img src={thumb.data} alt="" draggable={false} />}
    </span>
  );
}

function ChangedFile({ file, headRef }: { file: PullFile; headRef: string }) {
  const [opening, setOpening] = useState(false);
  const shot = useQuery({
    queryKey: ["previewVersion", file.path, headRef],
    queryFn: () => previewVersion(file.path, headRef),
    enabled: file.is_cad && file.status !== "removed",
    staleTime: Infinity,
    retry: false,
  });

  return (
    <li className="changedfile">
      <span className="changedshot">
        {shot.data ? (
          <img src={shot.data} alt="" draggable={false} />
        ) : (
          <span className="changedshot-empty" aria-hidden="true" />
        )}
      </span>
      <span className="changedname">
        <strong title={file.path}>{shortName(file.path)}</strong>
        <span className="muted small">
          {file.status}
          {file.is_cad ? "" : ` · +${file.additions} −${file.deletions}`}
        </span>
      </span>
      {file.is_cad && file.status !== "removed" && (
        <button
          className="barbtn"
          disabled={opening}
          title="Open this version in SolidWorks (as a copy)"
          onClick={() => {
            setOpening(true);
            openVersion(file.path, headRef).finally(() => setOpening(false));
          }}
        >
          {opening ? "Opening…" : "Open"}
        </button>
      )}
    </li>
  );
}

function PullView({
  number,
  currentBranch,
  onOpenCommit,
  focusTidy,
}: {
  number: number;
  currentBranch: string;
  onOpenCommit: (sha: string) => void;
  focusTidy?: boolean;
}) {
  const queryClient = useQueryClient();
  const tidyCard = useRef<HTMLElement>(null);
  const [tidyLit, setTidyLit] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [closing, setClosing] = useState(false);
  const picks = picksFor(`pr:${number}`);
  const directory = usePeople();
  const [, bump] = useReducer((n: number) => n + 1, 0);

  const pr = useQuery<PullDetail>({
    queryKey: ["pull", number],
    queryFn: () => pullDetail(number),
    retry: false,
    // no cache: reopening must not flash the previous copy
    gcTime: 0,
    staleTime: 0,
  });

  function act(kind: "APPROVE" | "REQUEST_CHANGES" | "COMMENT") {
    setBusy(kind);
    setError(null);
    setSaid(null);
    const proposal = [...picks].map(([path, side]) => ({
      path,
      branch: side === "mine" ? d!.base : d!.head,
    }));
    // Only a request for changes carries the picks.
    const carries = kind === "REQUEST_CHANGES" && proposal.length > 0;
    const send = carries
      ? proposePicks(number, d!.head_sha, proposal, kind, note)
      : reviewPull(number, kind, note);
    send
      .then((asAsked) => {
        setNote("");
        const withPicks = carries
          ? ` Your picks for ${proposal.length} file${proposal.length === 1 ? "" : "s"} went with it as a proposal.`
          : "";
        // GitHub downgrades an author's own verdict to a comment.
        const what = !asAsked
          ? "Posted as a comment. GitHub does not take a verdict on your own request."
          : kind === "APPROVE"
            ? "Approved."
            : kind === "REQUEST_CHANGES"
              ? "Changes requested."
              : "Comment posted.";
        setSaid(what + withPicks);
        queryClient.invalidateQueries({ queryKey: ["pull", number] });
      })
      .catch((e) => setError(isAppError(e) ? e.message : String(e)))
      .finally(() => setBusy(null));
  }

  function closeNow() {
    setClosing(false);
    setBusy("close");
    setError(null);
    setSaid(null);
    closePull(number)
      .then(() => {
        setSaid("Closed. Nothing was merged; the branch is still there.");
        queryClient.invalidateQueries();
      })
      .catch((e) => setError(isAppError(e) ? e.message : String(e)))
      .finally(() => setBusy(null));
  }

  // Own PR: GitHub refuses the approval, the merge still goes ahead.
  function approveAndCombine() {
    setConfirming(false);
    setBusy("merge");
    setError(null);
    setSaid(null);
    const clashing = d?.mergeable === false && clashFiles.length > 0;
    reviewPull(number, "APPROVE", note)
      .catch((e) => {
        const msg = isAppError(e) ? e.message : String(e);
        if (/own pull request/i.test(msg)) return false;
        throw e;
      })
      .then((approved) => {
        // Clean: merge on GitHub. Clashing: merge locally with the picks and
        // push; GitHub marks the PR merged on its own.
        const go = clashing
          ? combineWithPicks(
              d!.head,
              [...picks].map(([path, side]) => ({ path, side })),
            )
          : mergePull(number, "merge");
        return go.then(() => approved);
      })
      .then((approved) => {
        clearPicks(`pr:${number}`);
        setNote("");
        setSaid(
          approved
            ? `Approved and merged into ${d?.base ?? "the target branch"}.`
            : `Merged into ${d?.base ?? "the target branch"}. GitHub does not record approval of your own request.`,
        );
        queryClient.invalidateQueries();
      })
      .catch((e) => setError(isAppError(e) ? e.message : String(e)))
      .finally(() => setBusy(null));
  }

  const d = pr.data;
  const onBase = d ? currentBranch === d.base : false;
  const lanes = useClashLayout(d?.base ?? "", d?.head ?? "").laid?.colors;

  // From origin/* so the table reads the same on any branch.
  const clashes = useQuery<Conflict[]>({
    queryKey: ["planConflictsBetween", d?.base ?? "", d?.head ?? ""],
    queryFn: () => planConflictsBetween(`origin/${d!.base}`, `origin/${d!.head}`),
    enabled: !!d && d.mergeable === false,
    staleTime: Infinity,
    retry: false,
  });
  const clashFiles = clashes.data ?? [];
  const unpicked = clashFiles.filter((c) => !picks.has(c.path)).length;

  // After a merge: which side each clashing file went to.
  const merged = useQuery({
    queryKey: ["mergedPicks", d?.merge_commit_sha ?? ""],
    queryFn: () => mergedPicks(d!.merge_commit_sha),
    enabled: !!d && d.merged && !!d.merge_commit_sha,
    staleTime: Infinity,
    retry: false,
  });
  const overview = useQuery({
    queryKey: ["branchOverview"],
    queryFn: getBranchOverview,
    enabled: !!d && d.merged,
    staleTime: 30_000,
  });
  const headBranch = overview.data?.find((b) => b.name === d?.head);
  const canTidy =
    !!d && d.merged && !!headBranch && !headBranch.is_default && headBranch.ahead === 0;
  const [tidying, setTidying] = useState(false);
  useEffect(() => {
    if (!focusTidy || !canTidy) return;
    const el = tidyCard.current;
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setTidyLit(true);
    const t = setTimeout(() => setTidyLit(false), 2200);
    return () => clearTimeout(t);
  }, [focusTidy, canTidy]);
  function tidy() {
    setBusy("delete");
    setError(null);
    deleteBranch(d!.head)
      .then(() => {
        setTidying(false);
        setSaid(`${d!.head} deleted. Its commits stay in the history.`);
        queryClient.invalidateQueries();
      })
      .catch((e) => setError(isAppError(e) ? e.message : String(e)))
      .finally(() => setBusy(null));
  }
  const decided = new Map<string, Side>();
  for (const c of merged.data?.files ?? []) {
    if (c.resolved === "mine" || c.resolved === "theirs") decided.set(c.path, c.resolved);
  }

  // latest proposal per file wins
  const proposals = new Map<string, Proposal>();
  for (const c of d?.comments ?? []) {
    for (const p of c.picks ?? []) {
      proposals.set(p.path, {
        side: p.branch === d!.base ? "mine" : "theirs",
        branch: p.branch,
        who: directory.nameFor(c.author) ?? c.author,
        avatar: c.author_avatar,
        when: c.created_at,
      });
    }
  }

  return (
    <>
      {pr.isLoading && <Loading what="Fetching information from GitHub…" />}
      {pr.isError && (
        <p className="errdetail">
          {isAppError(pr.error) ? pr.error.message : String(pr.error)}
        </p>
      )}

      {d && (
        <>
          <section className="setupsection prhead">
            <div className="prwho">
              <UserAvatar
                url={d.author_avatar}
                name={directory.nameFor(d.author) ?? d.author}
                size={44}
              />
              <div className="prtitleblock">
                <h2 className="prtitle">
                  {d.title} <span className="muted">#{d.number}</span>
                </h2>
                <p className="muted">
                  {formatPerson(directory.nameFor(d.author) ?? d.author, d.author)}
                  {d.draft ? " · draft" : ""}

                </p>
                <p className="muted small">
                  Opened {formatDateTime(d.created_at)}
                  {d.merged
                    ? ` · merged ${formatDateTime(d.merged_at)}`
                    : d.updated_at !== d.created_at
                      ? ` · last updated ${formatDateTime(d.updated_at)}`
                      : ""}
                </p>
              </div>
            </div>
            <div className="prbranches">
              <span
                className="gg-chip prchip"
                style={{ color: lanes?.theirs, borderColor: lanes?.theirs }}
              >
                {d.head}
              </span>
              <span className="prarrow" aria-label="into">
                →
              </span>
              <span
                className="gg-chip prchip"
                style={{ color: lanes?.ours, borderColor: lanes?.ours }}
              >
                {d.base}
              </span>
            </div>
            {d.body.trim() && <p className="prbodytext">{d.body}</p>}

            {/* mergeable is null until GitHub has worked it out */}
            {d.state === "open" && d.mergeable === true && (
              <p className="muted small">This would merge cleanly.</p>
            )}
            {d.state === "open" && d.mergeable === null && (
              <p className="muted small">
                GitHub is still working out whether this merges cleanly.
              </p>
            )}
            {d.state !== "open" && !d.merged && (
              <p className="muted small">
                Closed without being merged: the work on{" "}
                <BranchName name={d.head} /> never went into{" "}
                <BranchName name={d.base} />.
              </p>
            )}
            {d.state === "open" && d.mergeable === false && !onBase && (
              <p className="muted small">
                <BranchName name={d.head} /> and <BranchName name={d.base} />{" "}
                changed some of the same files. You can pick which version to
                keep and suggest it to the reviewer from here. To approve and
                merge, switch to <BranchName name={d.base} /> first.
              </p>
            )}
          </section>

          <section className="setupsection">
            <h3>Conversation ({d.comments.length + (d.merged && d.merged_by ? 1 : 0)})</h3>
            {d.comments.length === 0 && (
              <p className="muted small prnothing">Nothing has been said about it yet.</p>
            )}
            <ul className="prcomments">
              {[
                ...d.comments,
                // the merge itself, as the last entry
                ...(d.merged && d.merged_by
                  ? [
                      {
                        author: d.merged_by,
                        author_avatar: d.merged_by_avatar,
                        body: "",
                        created_at: d.merged_at,
                        kind: d.comments.some(
                          (c) => c.kind === "approved" && c.author === d.merged_by,
                        )
                          ? "approved_and_merged"
                          : "merged",
                        path: "",
                        pick: "",
                        picks: [],
                      },
                    ]
                  : []),
              ].map((c, i) => {
                const who = formatPerson(
                  directory.nameFor(c.author) ?? c.author,
                  c.author,
                );
                const n = c.picks?.length ?? 0;
                const withPicks = n > 0 ? `, with ${n} pick${n === 1 ? "" : "s"}` : "";
                const did =
                  c.kind === "approved"
                    ? "approved"
                    : c.kind === "changes_requested"
                      ? `asked for changes${withPicks}`
                      : c.kind === "reviewed"
                        ? `reviewed${withPicks}`
                        : c.kind === "note"
                          ? `on ${shortName(c.path)}`
                          : c.kind === "proposal"
                            ? `proposed ${n === 1 ? "a pick" : `${n} picks`}`
                            : "";
                const closing =
                  c.kind === "approved_and_merged" || c.kind === "merged";
                return (
                  <li key={i} className={`prcomment ${c.kind}`}>
                    <UserAvatar url={c.author_avatar} name={who} size={28} />
                    <div className="prcommentbody">
                      <div className="prcommenthead">
                        {closing ? (
                          <span className="prclosing">
                            <strong>{who}</strong>{" "}
                            {c.kind === "approved_and_merged"
                              ? "approved and merged"
                              : "merged"}{" "}
                            <BranchName name={d.head} /> into{" "}
                            <BranchName name={d.base} />. Review closed.
                          </span>
                        ) : (
                          <strong>{who}</strong>
                        )}
                        {did && <span className="prdid">{did}</span>}
                        <span className="muted small">
                          {formatDateTime(c.created_at)}
                        </span>
                      </div>
                      {c.body.trim() && <p className="prbodytext">{c.body}</p>}
                      {n > 0 && (
                        <ul className="prpicks">
                          {c.picks.map((p) => (
                            <li key={p.path}>
                              <span className="prpickfile">{shortName(p.path)}</span>
                              {" "}keep the version from <BranchName name={p.branch} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {canTidy && (
            <section
              className={`setupsection${tidyLit ? " litcard" : ""}`}
              ref={tidyCard}
            >
              <h3>Tidy up</h3>
              <p className="muted">
                Everything on <BranchName name={d.head} /> is in{" "}
                <BranchName name={d.base} /> now, so the branch can go. Its
                commits stay in the history.
              </p>
              <div className="setuprow">
                <button
                  className="branchoffbtn"
                  onClick={() => setTidying(true)}
                  disabled={busy !== null}
                >
                  <TrashGlyph />
                  {busy === "delete" ? "Deleting…" : `Delete ${d.head}`}
                </button>
                {currentBranch === d.head && (
                  <span className="muted small">
                    You are on it. Switch to another branch first.
                  </span>
                )}
              </div>
              {said && <p className="muted small prsaid">{said}</p>}
              {error && <p className="errdetail">{error}</p>}
            </section>
          )}

          {tidying && (
            <div className="modal-backdrop" onClick={() => setTidying(false)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h2>Delete this branch?</h2>
                <p className="muted">
                  <BranchName name={d.head} /> is removed from GitHub and from
                  this computer. Nothing is lost; all of it is in{" "}
                  <BranchName name={d.base} /> already.
                </p>
                <div className="modal-actions">
                  <button onClick={() => setTidying(false)} disabled={busy !== null}>
                    Keep it
                  </button>
                  <button className="danger" onClick={tidy} disabled={busy !== null}>
                    {busy === "delete" ? "Deleting…" : "Delete it"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {d.merged ? (
            <>
              {merged.isLoading && (
                <section className="setupsection">
                  <h3>What was kept</h3>
                  <p className="muted small">Reading the merge…</p>
                </section>
              )}
              {merged.data && merged.data.files.length === 0 && (
                <section className="setupsection">
                  <h3>What was kept</h3>
                  <p className="muted small">
                    Nothing clashed, so every file came in as it was on{" "}
                    <BranchName name={d.head} />.
                  </p>
                </section>
              )}
              {merged.data && merged.data.files.length > 0 && (
                <ConflictPicker
                  files={merged.data.files}
                  ours={d.base}
                  theirs={d.head}
                  at={{
                    ours: merged.data.base_sha,
                    theirs: merged.data.head_sha,
                    merge: d.merge_commit_sha,
                  }}
                  picks={decided}
                  onChange={() => {}}
                  onOpenCommit={onOpenCommit}
                  busy={false}
                  readOnly
                  title={`What was kept (${merged.data.files.length})`}
                  intro={
                    <>
                      These files had two versions when <BranchName name={d.head} />{" "}
                      was merged into <BranchName name={d.base} />. The marked
                      one was kept.
                    </>
                  }
                />
              )}
            </>
          ) : d.mergeable === false ? (
            <>
              {(clashes.isLoading || clashes.isError) && (
                <section className="setupsection">
                  <h3>Merge conflicts</h3>
                  {clashes.isLoading && (
                    <p className="muted small">Reading both branches…</p>
                  )}
                  {clashes.isError && (
                    <p className="errdetail">
                      {isAppError(clashes.error)
                        ? clashes.error.message
                        : String(clashes.error)}
                    </p>
                  )}
                </section>
              )}
              {clashFiles.length > 0 && (
                <ConflictPicker
                  files={clashFiles}
                  ours={d.base}
                  theirs={d.head}
                  picks={picks}
                  onChange={bump}
                  onOpenCommit={onOpenCommit}
                  busy={busy !== null}
                  proposals={proposals}
                  title={`Merge conflicts (${clashFiles.length})`}
                  intro={
                    <>
                      Both <BranchName name={d.base} /> and{" "}
                      <BranchName name={d.head} /> changed these files.
                      SolidWorks files can&rsquo;t be merged, so only one version
                      of each can be carried over. Pick the one to keep.
                      Nothing changes until you merge, and your picks are
                      remembered if you leave and come back.
                    </>
                  }
                />
              )}
            </>
          ) : (
          <section className="setupsection">
            <h3>
              {d.state !== "open" && !d.merged
                ? `What it would have brought (${d.files.length})`
                : `What changed (${d.files.length})`}
            </h3>
            <ul className="changedlist">
              {d.files.map((f) => (
                <ChangedFile
                  key={f.path}
                  file={f}
                  headRef={`origin/${d.head}`}
                />
              ))}
            </ul>
          </section>
          )}

          {!d.merged && d.state === "open" && (
          <section className="setupsection">
            <h3>Your review</h3>
            <textarea
              className="prbody"
              placeholder="What do you think of it?"
              value={note}
              rows={3}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="setuprow prreviewrow">
              <button
                onClick={() => act("COMMENT")}
                disabled={busy !== null || !note.trim()}
                title="Post your note. Picks are not sent with a comment"
              >
                {busy === "COMMENT" ? "Sending…" : "Comment"}
              </button>
              <button
                onClick={() => act("REQUEST_CHANGES")}
                disabled={busy !== null || picks.size === 0}
                title={
                  picks.size > 0
                    ? `Ask for changes and propose your picks for ${picks.size} file${picks.size === 1 ? "" : "s"}`
                    : "Pick a version for at least one file first"
                }
              >
                {busy === "REQUEST_CHANGES"
                  ? "Sending…"
                  : picks.size > 0
                    ? `Ask for changes with ${picks.size} pick${picks.size === 1 ? "" : "s"}`
                    : "Ask for changes"}
              </button>
              <button
                className="prclose"
                onClick={() => setClosing(true)}
                disabled={busy !== null}
                title="Close this request and leave the branch as it is"
              >
                {busy === "close" ? "Closing…" : "Close without merging"}
              </button>
              <button
                className="primary"
                onClick={() => setConfirming(true)}
                disabled={
                  busy !== null ||
                  (d.mergeable === false && (!onBase || unpicked > 0))
                }
                title={
                  d.mergeable === false && !onBase
                    ? `Switch to ${d.base} to settle the clash first`
                    : `Approve and bring it into ${d.base}`
                }
              >
                {busy === "merge"
                  ? "Merging…"
                  : d.mergeable === false && onBase && unpicked > 0
                    ? `${unpicked} still to pick`
                    : "Approve and merge"}
              </button>
            </div>

            {said && <p className="muted small prsaid">{said}</p>}
            {error && <p className="errdetail">{error}</p>}
          </section>
          )}

          {closing && (
            <div className="modal-backdrop" onClick={() => setClosing(false)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h2>Close without merging?</h2>
                <p className="muted">
                  <strong>{d.title}</strong> is closed and nothing goes into{" "}
                  <BranchName name={d.base} />. <BranchName name={d.head} /> stays
                  as it is. A new request can be made
                  later.
                </p>
                <div className="modal-actions">
                  <button onClick={() => setClosing(false)}>Keep it open</button>
                  <button className="danger" onClick={closeNow}>
                    Close it
                  </button>
                </div>
              </div>
            </div>
          )}

          {confirming && (
            <div className="modal-backdrop" onClick={() => setConfirming(false)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h2>Approve and merge?</h2>
                <p className="muted">
                  Records your approval of <strong>{d.title}</strong> and brings{" "}
                  <BranchName name={d.head} /> into <BranchName name={d.base} />.
                  The team gets it next time they get the latest.
                </p>
                {clashFiles.length > 0 &&
                  (
                    [
                      ["mine", d.base],
                      ["theirs", d.head],
                    ] as const
                  ).map(([side, name]) => {
                    const kept = clashFiles.filter(
                      (c) => picks.get(c.path) === side,
                    );
                    if (kept.length === 0) return null;
                    return (
                      <div key={side} className="prkeep">
                        <p className="muted small">
                          Kept from <BranchName name={name} />:
                        </p>
                        <ul className="prkeeplist">
                          {kept.map((c) => {
                            const info = side === "mine" ? c.mine : c.theirs;
                            return (
                              <li key={c.path}>
                                <span>{shortName(c.path)}</span>
                                {!info.present && (
                                  <span className="muted small"> · deleted</span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                {note.trim() && (
                  <p className="muted small">Your note goes with the approval.</p>
                )}
                <div className="modal-actions">
                  <button onClick={() => setConfirming(false)}>Not yet</button>
                  <button className="primary" onClick={approveAndCombine}>
                    Approve and merge
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

    </>
  );
}
