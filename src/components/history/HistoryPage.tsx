import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  getBranchOverview,
  getCommitFiles,
  getGraph,
  type GraphCommit,
} from "../../api";
import { formatDate, formatDateTime } from "../../dates";
import { BranchGlyph, EyeGlyph, RestoreGlyph } from "../common/HistoryDiagrams";
import type { VersionRef } from "../dialogs/RestoreVersionDialog";
import { githubAvatarFromEmail, UserAvatar } from "../common/UserAvatar";
import {
  formatPerson,
  resolveCommitAuthors,
  useIdentities,
} from "../../identity";

const CAD_FILE = /\.(sldprt|sldasm|slddrw)$/i;

interface LaidRow {
  commit: GraphCommit;
  lane: number;
  hasTop: boolean;
  joins: number[];
  continues: boolean;
  forks: number[];
  passes: number[];
  passShas: string[];
  passChilds: string[][];
  forkShas: string[];
  topChilds: string[];
  joinChilds: string[][];
  below: number[];
}

export function layoutGraph(commits: GraphCommit[]): {
  rows: LaidRow[];
  laneCount: number;
} {
  const lanes: (string | null)[] = [];
  const laneChilds: string[][] = [];
  const rows: LaidRow[] = [];
  let laneCount = 1;

  for (const c of commits) {
    const before = [...lanes];
    const beforeChilds = laneChilds.map((l) => [...l]);
    const hits: number[] = [];
    lanes.forEach((sha, i) => {
      if (sha === c.sha) hits.push(i);
    });

    let lane: number;
    if (hits.length > 0) {
      lane = hits[0];
    } else {
      const free = lanes.indexOf(null);
      lane = free >= 0 ? free : (lanes.push(null), lanes.length - 1);
    }
    for (const h of hits) {
      lanes[h] = null;
      laneChilds[h] = [];
    }

    let continues = false;
    const forks: number[] = [];
    const forkShas: string[] = [];
    for (const [pi, parent] of c.parents.entries()) {
      if (pi === 0) {
        lanes[lane] = parent;
        laneChilds[lane] = [c.sha];
        continues = true;
        continue;
      }
      const existing = lanes.findIndex((sha) => sha === parent);
      if (existing >= 0) {
        forks.push(existing);
        forkShas.push(parent);
        (laneChilds[existing] ??= []).push(c.sha);
        continue;
      }
      const free = lanes.indexOf(null);
      const m = free >= 0 ? free : (lanes.push(null), lanes.length - 1);
      lanes[m] = parent;
      laneChilds[m] = [c.sha];
      forks.push(m);
      forkShas.push(parent);
    }

    const passes: number[] = [];
    const passShas: string[] = [];
    const passChilds: string[][] = [];
    before.forEach((sha, i) => {
      if (sha !== null && !hits.includes(i)) {
        passes.push(i);
        passShas.push(sha);
        passChilds.push(beforeChilds[i] ?? []);
      }
    });

    const below: number[] = [];
    lanes.forEach((sha, i) => {
      if (sha !== null) below.push(i);
    });

    rows.push({
      commit: c,
      lane,
      hasTop: hits.length > 0,
      topChilds: hits.length > 0 ? (beforeChilds[hits[0]] ?? []) : [],
      joins: hits.slice(1),
      joinChilds: hits.slice(1).map((h) => beforeChilds[h] ?? []),
      continues,
      forks,
      forkShas,
      passes,
      passShas,
      passChilds,
      below,
    });
    laneCount = Math.max(laneCount, lanes.length);
  }
  return { rows, laneCount };
}

const LANE_COLORS = [
  "#4e8cff",
  "#d29922",
  "#39c5cf",
  "#bc8cff",
  "#f778ba",
  "#e3b341",
  "#58a6ff",
  "#8b949e",
  "#6cb2c9",
  "#c9a2f7",
  "#b0851f",
  "#7ea6e0",
];

const ROW_H = 34;
const COL_W = 14;

export function laneColor(i: number): string {
  return LANE_COLORS[i % LANE_COLORS.length];
}

function FillRails({ lanes, laneCount }: { lanes: number[]; laneCount: number }) {
  const w = laneCount * COL_W + 4;
  return (
    <svg
      className="gg-fillrails"
      width={w}
      viewBox={`0 0 ${w} 10`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {lanes.map((j) => (
        <line
          key={j}
          x1={j * COL_W + COL_W / 2}
          y1={0}
          x2={j * COL_W + COL_W / 2}
          y2={10}
          stroke={laneColor(j)}
          strokeWidth="2"
        />
      ))}
    </svg>
  );
}

function RowRails({ row, laneCount }: { row: LaidRow; laneCount: number }) {
  const w = laneCount * COL_W + 4;
  const mid = ROW_H / 2;
  const x = (i: number) => i * COL_W + COL_W / 2;
  const xl = x(row.lane);
  const topLanes = [
    ...row.passes,
    ...(row.hasTop ? [row.lane] : []),
    ...row.joins,
  ];
  const bottomLanes = [
    ...row.passes,
    ...(row.continues ? [row.lane] : []),
    ...row.forks,
  ];
  return (
    <span className="gg-railcol" aria-hidden="true">
    <FillRails lanes={topLanes} laneCount={laneCount} />
    <svg
      className="gg-rails"
      width={w}
      height={ROW_H}
      viewBox={`0 0 ${w} ${ROW_H}`}
      aria-hidden="true"
    >
      {row.passes.map((j) => (
        <line
          key={`p${j}`}
          x1={x(j)}
          y1={0}
          x2={x(j)}
          y2={ROW_H}
          stroke={laneColor(j)}
          strokeWidth="2"
        />
      ))}
      {row.hasTop && (
        <line x1={xl} y1={0} x2={xl} y2={mid} stroke={laneColor(row.lane)} strokeWidth="2" />
      )}
      {row.joins.map((j) => (
        <path
          key={`j${j}`}
          d={`M ${x(j)} 0 C ${x(j)} ${mid} ${xl} ${mid * 0.4} ${xl} ${mid}`}
          fill="none"
          stroke={laneColor(j)}
          strokeWidth="2"
        />
      ))}
      {row.continues && (
        <line x1={xl} y1={mid} x2={xl} y2={ROW_H} stroke={laneColor(row.lane)} strokeWidth="2" />
      )}
      {row.forks.map((m) => (
        <path
          key={`f${m}`}
          d={`M ${xl} ${mid} C ${xl} ${(mid + ROW_H) / 2} ${x(m)} ${(mid + ROW_H) / 2} ${x(m)} ${ROW_H}`}
          fill="none"
          stroke={laneColor(m)}
          strokeWidth="2"
        />
      ))}
      {row.commit.is_head ? (
        // "You are here": a pulsing halo and a double ring, unmissable
        // against the plain dots.
        <g className="gg-head">
          <circle className="gg-halo" cx={xl} cy={mid} r={10} fill="var(--accent)" />
          <circle
            cx={xl}
            cy={mid}
            r={6.5}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
          />
          <circle cx={xl} cy={mid} r={3.4} fill="var(--accent)" />
        </g>
      ) : (
        <circle cx={xl} cy={mid} r={4} fill={laneColor(row.lane)} />
      )}
    </svg>
    <FillRails lanes={bottomLanes} laneCount={laneCount} />
    </span>
  );
}

function DetailRails({
  lanes,
  laneCount,
}: {
  lanes: number[];
  laneCount: number;
}) {
  const w = laneCount * COL_W + 4;
  return (
    <svg
      className="gg-detailrails"
      width={w}
      viewBox={`0 0 ${w} 10`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {lanes.map((j) => (
        <line
          key={j}
          x1={j * COL_W + COL_W / 2}
          y1={0}
          x2={j * COL_W + COL_W / 2}
          y2={10}
          stroke={laneColor(j)}
          strokeWidth="2"
        />
      ))}
    </svg>
  );
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return formatDate(iso);
}

function CommitDetail({
  commit,
  onBranchOff,
  onViewVersion,
  onRestoreFiles,
  onPreviewCommit,
}: {
  commit: GraphCommit;
  onBranchOff: (sha: string, label: string) => void;
  onViewVersion: (
    path: string,
    commit: VersionRef,
    scopeDefault?: "all" | "file",
  ) => void;
  onRestoreFiles: (paths: string[], commit: VersionRef) => void;
  onPreviewCommit: (sha: string, label: string) => void;
}) {
  const files = useQuery({
    queryKey: ["commitFiles", commit.sha],
    queryFn: () => getCommitFiles(commit.sha),
    staleTime: Infinity,
  });
  const cadFiles = (files.data ?? []).filter(
    (f) => CAD_FILE.test(f.path) && f.status !== "D",
  );
  const ref: VersionRef = {
    sha: commit.sha,
    date: commit.date,
    author_name: commit.author_name,
    message: commit.subject,
  };

  function restoreFromHere() {
    if (cadFiles.length === 1) {
      // one file
      onViewVersion(cadFiles[0].path, ref, "all");
    } else {
      // several: let them pick which ones come back together
      onRestoreFiles(cadFiles.map((f) => f.path), ref);
    }
  }

  return (
    <div className="gg-detail">
      <p className="muted small">
        {formatDateTime(commit.date)} · {commit.sha.slice(0, 8)}
      </p>
      {files.isLoading && <p className="muted small">Reading what changed…</p>}
      {files.data && files.data.length > 0 && (
        <ul className="gg-files">
          {files.data.map((f) => (
            <li key={f.path}>
              <span className={`st st-${f.status.toLowerCase()}`}>
                {f.status}
              </span>
              <span className="gg-filepath">{f.path}</span>
              {CAD_FILE.test(f.path) && f.status !== "D" && (
                <button
                  className="fh-restore"
                  onClick={() =>
                    onViewVersion(f.path, {
                      sha: commit.sha,
                      date: commit.date,
                      author_name: commit.author_name,
                      message: commit.subject,
                    })
                  }
                  title="Look at this file as it was in this change"
                >
                  View…
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {files.isSuccess && files.data?.length === 0 && (
        <p className="muted small">No file changes recorded.</p>
      )}
      <div className="commitactions">
        <button
          className="branchoffbtn"
          onClick={() =>
            onPreviewCommit(
              commit.sha,
              `${commit.subject} · ${formatDate(commit.date)}`,
            )
          }
          title="Swap every file to this moment for a look around, without changing anything. One click brings you back"
        >
          <EyeGlyph />
          Look around here
        </button>
        {cadFiles.length > 0 && (
          <button
            className="branchoffbtn"
            onClick={restoreFromHere}
            title="Bring a file back to how it was in this change"
          >
            <RestoreGlyph />
            Restore this version…
          </button>
        )}
        <button
          className="branchoffbtn"
          onClick={() =>
            onBranchOff(commit.sha, `${commit.subject} · ${formatDate(commit.date)}`)
          }
          title="Start a new branch from this moment in time. Your current branch stays untouched"
        >
          <BranchGlyph />
          Branch off from here
        </button>
      </div>
    </div>
  );
}

export function HistoryPage({
  currentBranch,
  focusSha,
  onClose,
  onSwitchBranch,
  onBranchOff,
  onViewVersion,
  onRestoreFiles,
  onPreviewCommit,
  onMergeBranch,
}: {
  currentBranch: string;
  focusSha?: string | null;
  onClose: () => void;
  onSwitchBranch: (name: string) => void;
  onBranchOff: (sha: string, label: string) => void;
  onViewVersion: (
    path: string,
    commit: VersionRef,
    scopeDefault?: "all" | "file",
  ) => void;
  onRestoreFiles: (paths: string[], commit: VersionRef) => void;
  /** Look around a whole commit without changing anything. */
  onPreviewCommit: (sha: string, label: string) => void;
  /** Open the combine dialog for a branch (second arg: the default branch). */
  onMergeBranch: (branch: string, defaultBranch: string) => void;
}) {
  const graph = useQuery({
    queryKey: ["graph"],
    queryFn: getGraph,
    staleTime: 30_000,
  });
  const branches = useQuery({
    queryKey: ["branchOverview"],
    queryFn: getBranchOverview,
    staleTime: 30_000,
  });
  const identities = useIdentities();
  const [openSha, setOpenSha] = useState<string | null>(null);
  // branch card being hovered — its line in the railway lights up
  const [hoverBranch, setHoverBranch] = useState<string | null>(null);

  // arriving from a Progress-railway node: open that commit and scroll to it
  useEffect(() => {
    if (!focusSha) return;
    setOpenSha(focusSha);
    const t = window.setTimeout(() => {
      document
        .getElementById(`gg-${focusSha}`)
        ?.scrollIntoView({ block: "center" });
    }, 120);
    return () => window.clearTimeout(t);
  }, [focusSha]);

  const laid = useMemo(
    () => layoutGraph(graph.data ?? []),
    [graph.data],
  );

  // Where each branch's tip sits in the railway, so the card list and the
  // diagram share colors and can point at each other.
  const tips = useMemo(() => {
    const map = new Map<string, { lane: number; sha: string }>();
    for (const row of laid.rows) {
      for (const r of row.commit.refs) {
        const name = r.startsWith("origin/") ? r.slice(7) : r;
        if (!map.has(name)) map.set(name, { lane: row.lane, sha: row.commit.sha });
      }
    }
    return map;
  }, [laid.rows]);

  function jumpToBranch(name: string) {
    const tip = tips.get(name);
    if (!tip) return;
    setOpenSha(null);
    document
      .getElementById(`gg-${tip.sha}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  const authors = useMemo(
    () =>
      resolveCommitAuthors(
        (graph.data ?? []).map((c) => ({
          sha: c.sha,
          author_name: c.author_name,
          author_email: c.author_email,
        })),
        identities.data ?? [],
      ),
    [graph.data, identities.data],
  );

  return (
    <main className="settingspage historypage">
      <div className="pagehead">
        <button className="backbtn" onClick={onClose}>
          ← Back to your files
        </button>
        <h2>Branches</h2>
        <p className="muted small">
          Every branch is a separate line of work on the same project. The
          railway below shows how they split and come back together (newest
          at the top). Click a change to see what it touched, look at old
          versions, branch off from any point, or combine branches when the
          work is ready.
        </p>
      </div>

      <div className="historybody">
        <aside className="branchlist">
          <h3>Branches</h3>
          {branches.isLoading && <p className="muted small">Reading…</p>}
          {(branches.data ?? []).map((b) => {
            const tip = tips.get(b.name);
            const color = tip ? laneColor(tip.lane) : "var(--muted)";
            // branches parked on the same commit share a line (and color) in
            // the railway — say so, or it just looks like we ran out of paint
            const twins = (branches.data ?? [])
              .filter(
                (o) => o.name !== b.name && tips.get(o.name)?.sha === tip?.sha,
              )
              .map((o) => o.name);
            return (
            <div
              key={b.name}
              className={`branchcard${b.name === currentBranch ? " current" : ""}`}
              // soft wash of the branch's color instead of a hard bar
              style={tip ? { boxShadow: `inset 0 0 44px ${color}1c` } : undefined}
              onMouseEnter={() => setHoverBranch(b.name)}
              onMouseLeave={() =>
                setHoverBranch((prev) => (prev === b.name ? null : prev))
              }
            >
              <div className="branchname">
                <button
                  className="branchjump"
                  style={{ color }}
                  onClick={() => jumpToBranch(b.name)}
                  title="Show this branch's line in the diagram"
                >
                  <span className="branchdot" style={{ background: color }} />
                  {b.name}
                </button>
                {b.is_default && <span className="badge">main line</span>}
                {b.name === currentBranch && (
                  <span className="badge badge-mine">you are here</span>
                )}
              </div>
              <div className="muted small branchmeta">
                {b.subject || "—"}
                <br />
                {b.author} · {relativeTime(new Date(b.last_commit_at * 1000).toISOString())}
                {!b.is_default && (b.ahead > 0 || b.behind > 0) && (
                  <>
                    <br />
                    {b.ahead} ahead · {b.behind} behind the main line
                  </>
                )}
                {twins.length > 0 && (
                  <>
                    <br />
                    same point as {twins.slice(0, 3).join(", ")}
                    {twins.length > 3 ? ` +${twins.length - 3}` : ""}: no work
                    of its own yet
                  </>
                )}
              </div>
              <div className="branchcardactions">
                {b.name !== currentBranch && (
                  <button
                    className="fh-restore"
                    onClick={() => onSwitchBranch(b.name)}
                    title="Swap every file over to this branch's version"
                  >
                    Switch to it
                  </button>
                )}
                <button
                  className="fh-restore"
                  onClick={() =>
                    onMergeBranch(
                      b.name,
                      (branches.data ?? []).find((x) => x.is_default)?.name ??
                        "main",
                    )
                  }
                  title="Bring this branch's work into another branch directly, or through a reviewed pull request on GitHub"
                >
                  Combine…
                </button>
              </div>
            </div>
            );
          })}
        </aside>

        <section className="graphpane">
          {graph.isLoading && <p className="muted">Reading the history…</p>}
          {graph.isError && (
            <p className="muted">{String(graph.error)}</p>
          )}
          {laid.rows.map((row) => {
            const c = row.commit;
            const person = authors.get(c.sha);
            const open = openSha === c.sha;
            return (
              <div
                key={c.sha}
                id={`gg-${c.sha}`}
                className={`gg-row${open ? " open" : ""}${c.is_head ? " here" : ""}${
                  hoverBranch &&
                  c.refs.some(
                    (r) => r === hoverBranch || r === `origin/${hoverBranch}`,
                  )
                    ? " hl"
                    : ""
                }`}
              >
                <button
                  className="gg-line"
                  onClick={() => setOpenSha(open ? null : c.sha)}
                >
                  <RowRails row={row} laneCount={laid.laneCount} />
                  <span className="gg-refs">
                    {c.is_head && (
                      <span className="gg-youarehere">You are here</span>
                    )}
                    {c.refs.map((r) => (
                      <span
                        key={r}
                        className={`gg-chip${r === currentBranch ? " here" : ""}`}
                        style={{ borderColor: laneColor(row.lane) }}
                      >
                        {r}
                      </span>
                    ))}
                  </span>
                  <span className="gg-subject" title={c.subject}>
                    {c.subject}
                  </span>
                  <span className="gg-meta">
                    <UserAvatar
                      url={
                        person?.avatarUrl ?? githubAvatarFromEmail(c.author_email)
                      }
                      name={person?.name ?? c.author_name}
                      size={16}
                    />
                    <span className="muted small">
                      {person
                        ? formatPerson(person.name, person.login)
                        : c.author_name}
                    </span>
                    <span className="muted small gg-when">
                      {relativeTime(c.date)}
                    </span>
                  </span>
                </button>
                {open && (
                  <div className="gg-open">
                    <DetailRails lanes={row.below} laneCount={laid.laneCount} />
                    <CommitDetail
                      commit={c}
                      onBranchOff={onBranchOff}
                      onViewVersion={onViewVersion}
                      onRestoreFiles={onRestoreFiles}
                      onPreviewCommit={onPreviewCommit}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </section>
      </div>
    </main>
  );
}
