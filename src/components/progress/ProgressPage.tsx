import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getActivityAll,
  getBranchOverview,
  getCommitStats,
  getGraph,
} from "../../api";
import { FilePreview } from "../common/FilePreview";
import { BranchGlyph } from "../common/HistoryDiagrams";
import { laneColor, layoutGraph } from "../history/HistoryPage";
import type { BranchSummary } from "../../types";
import type { FileRowData } from "../dashboard/Dashboard";
import { UserAvatar } from "../common/UserAvatar";
import { formatPerson, resolveCommitAuthors, useIdentities } from "../../identity";
import { formatDate, useNow } from "../../dates";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Activity chart ranges */
const RANGES = {
  week: { label: "Past week", buckets: 7, size: DAY_MS, unit: "day" },
  month: { label: "Past month", buckets: 30, size: DAY_MS, unit: "day" },
  quarter: { label: "Past 3 months", buckets: 13, size: WEEK_MS, unit: "week" },
} as const;

type RangeKey = keyof typeof RANGES;

interface AreaStat {
  name: string;
  total: number;
  changedThisWeek: number;
  locked: number;
  lockedByMe: number;
  lastTouched: number;
}

/** Top-level folders */
function areaStats(rows: FileRowData[], now: number): AreaStat[] {
  const weekAgo = now - WEEK_MS;
  const byArea = new Map<string, AreaStat>();
  for (const row of rows) {
    const name = row.file.dir.split("/")[0] || "Loose files";
    const area =
      byArea.get(name) ??
      {
        name,
        total: 0,
        changedThisWeek: 0,
        locked: 0,
        lockedByMe: 0,
        lastTouched: 0,
      };
    area.total += 1;
    if (row.file.modified > weekAgo) area.changedThisWeek += 1;
    if (row.status.kind === "theirs") area.locked += 1;
    if (row.status.kind === "mine") area.lockedByMe += 1;
    area.lastTouched = Math.max(area.lastTouched, row.file.modified);
    byArea.set(name, area);
  }
  return [...byArea.values()].sort((a, b) => b.lastTouched - a.lastTouched);
}

function quietFor(ms: number, now: number): string {
  if (ms === 0) return "no shared changes yet";
  const days = Math.floor((now - ms) / DAY_MS);
  if (days <= 0) return "touched today";
  if (days === 1) return "quiet for a day";
  if (days < 30) return `quiet for ${days} days`;
  const months = Math.floor(days / 30);
  return `quiet for ${months} month${months === 1 ? "" : "s"}`;
}

function truncName(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}


// function BranchTree({
//   branches,
//   defaultName,
//   highlight,
// }: {
//   branches: BranchSummary[];
//   defaultName: string;
//   /** Branch name being hovered in the list below; its line lights up. */
//   highlight: string | null;
// }) {
//   const others = branches.filter((b) => !b.is_default).slice(0, 6);
//   const n = others.length;
//   const W = 520;
//   const ROW = 30;
//   // extra room under the rail for the fork dates
//   const H = 58 + n * ROW;
//   const mainY = H - 28;
//   const lineEnd = W - 168;
//   const forkDate = (secs: number) =>
//     new Date(secs * 1000).toLocaleDateString(undefined, {
//       month: "short",
//       day: "numeric",
//     });
//   return (
//     <svg
//       className="branchtree"
//       viewBox={`0 0 ${W} ${H}`}
//       role="img"
//       aria-label={`Simplified branch tree: ${defaultName} with ${n} branch${n === 1 ? "" : "es"} forking off`}
//     >
//       <line className="bt-main" x1="10" y1={mainY} x2={W - 70} y2={mainY} />
//       <polygon
//         className="bt-arrow"
//         points={`${W - 70},${mainY - 4.5} ${W - 59},${mainY} ${W - 70},${mainY + 4.5}`}
//       />
//       {[36, 88, 140].map((x) => (
//         <circle key={x} className="bt-maindot" cx={x} cy={mainY} r="3" />
//       ))}
//       <text className="bt-mainlabel" x={W - 8} y={mainY + 3.5} textAnchor="end">
//         {truncName(defaultName, 14)}
//       </text>
//
//       {others.map((b, i) => {
//         // Newest branch closest to the rail; forks stagger left to right.
//         const y = 14 + i * ROW;
//         const xFork = 46 + i * 34;
//         const color = laneColor(i);
//         const dots = Math.max(1, Math.min(b.ahead, 5));
//         const cls =
//           highlight === null
//             ? "bt-branch"
//             : highlight === b.name
//               ? "bt-branch hot"
//               : "bt-branch dim";
//         return (
//           <g key={b.name} className={cls}>
//             <path
//               className="bt-line"
//               stroke={color}
//               d={`M ${xFork} ${mainY} C ${xFork + 16} ${mainY} ${xFork + 12} ${y} ${xFork + 30} ${y} L ${lineEnd} ${y}`}
//             />
//             {/* the junction: where and when this branch split off */}
//             <circle cx={xFork} cy={mainY} r="3.2" fill={color} />
//             {b.forked_at > 0 && (
//               <text
//                 className="bt-sub"
//                 x={xFork}
//                 y={mainY + (i % 2 === 0 ? 13 : 24)}
//                 textAnchor="middle"
//               >
//                 {forkDate(b.forked_at)}
//               </text>
//             )}
//             {Array.from({ length: dots }).map((_, k) => (
//               <circle
//                 key={k}
//                 cx={lineEnd - 12 - k * 14}
//                 cy={y}
//                 r="3"
//                 fill={color}
//               />
//             ))}
//             <text className="bt-label" x={lineEnd + 8} y={y - 1} fill={color}>
//               {truncName(b.name, 18)}
//             </text>
//             <text className="bt-sub" x={lineEnd + 8} y={y + 11}>
//               updated {formatDate(b.last_commit_at * 1000)}
//               {b.ahead > 0 ? ` · ${b.ahead} ahead` : ""}
//             </text>
//           </g>
//         );
//       })}
//     </svg>
//   );
// }


function BranchRailway({
  rows,
  laneCount,
  branches,
  highlight,
  onOpenCommit,
}: {
  rows: ReturnType<typeof layoutGraph>["rows"];
  laneCount: number;
  branches: BranchSummary[];
  highlight: string | null;
  /** Jump to this commit on the Branches page. */
  onOpenCommit: (sha: string) => void;
}) {
  const COL = 40;
  const LANE = 34;
  const TOP = 176;
  const PAD = 36;
  const RIGHT = 80;
  const W = PAD * 2 + rows.length * COL + RIGHT;
  // extra room under the lanes for the timeline
  const H = TOP + laneCount * LANE + 46;
  const shortDate = (d: string | number) =>
    new Date(d).toLocaleDateString(undefined, {
      month: "numeric",
      day: "numeric",
    });
  const forkOf = new Map(branches.map((b) => [b.name, b.forked_at]));
  const yOf = (l: number) => TOP + l * LANE;
  const xOf = (i: number) => W - PAD - RIGHT - i * COL - COL / 2;

  // newest commits sit at the right edge, start the view there
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [rows.length]);

  const hl = useMemo(() => {
    if (!highlight) return null;
    const bySha = new Map(rows.map((r) => [r.commit.sha, r.commit]));
    const tip = rows.find((r) =>
      r.commit.refs.some((x) => x === highlight || x === `origin/${highlight}`),
    );
    if (!tip) return null;
    const set = new Set<string>();
    let sha: string | undefined = tip.commit.sha;
    while (sha && !set.has(sha)) {
      set.add(sha);
      sha = bySha.get(sha)?.parents[0];
    }
    return set;
  }, [highlight, rows]);
  const dim = (on: boolean) => (hl === null || on ? undefined : "rr-dim");
  const edgeLit = (childs: string[] | undefined, parent: string) =>
    hl === null ||
    (hl.has(parent) && (childs ?? []).some((ch) => hl.has(ch)));

  return (
    <div className="railscroll" ref={scrollRef}>
      <svg
        className="branchrail"
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Every branch and merge in the project, newest at the right"
      >
        {/* timeline: a date tick wherever the day changes, oldest to newest */}
        {rows.map((row, i) => {
          const d = shortDate(row.commit.date);
          const newer = i > 0 ? shortDate(rows[i - 1].commit.date) : null;
          if (d === newer) return null;
          const x = xOf(i);
          return (
            <g key={`t${row.commit.sha}`}>
              <line
                x1={x}
                y1={H - 34}
                x2={x}
                y2={H - 26}
                stroke="var(--border)"
                strokeWidth={2}
              />
              <text className="rr-date" x={x} y={H - 12} textAnchor="middle">
                {d}
              </text>
            </g>
          );
        })}
        {rows.map((row, i) => {
          const x = xOf(i);
          const y = yOf(row.lane);
          const xr = x + COL / 2;
          const xl = x - COL / 2;
          const c = row.commit;
          const tipName = c.refs[0]?.startsWith("origin/")
            ? c.refs[0].slice(7)
            : c.refs[0];
          const on = hl === null || hl.has(c.sha);
          const labelOn =
            hl === null ||
            (highlight !== null &&
              c.refs.some(
                (r) => r === highlight || r === `origin/${highlight}`,
              ));
          return (
            <g key={c.sha}>
              {row.passes.map((j, k) => (
                <line
                  key={`p${j}`}
                  className={dim(edgeLit(row.passChilds[k], row.passShas[k]))}
                  x1={xl}
                  y1={yOf(j)}
                  x2={xr}
                  y2={yOf(j)}
                  stroke={laneColor(j)}
                  strokeWidth={3}
                />
              ))}
              {row.hasTop && (
                <line
                  className={dim(edgeLit(row.topChilds, c.sha))}
                  x1={x}
                  y1={y}
                  x2={xr}
                  y2={y}
                  stroke={laneColor(row.lane)}
                  strokeWidth={3}
                />
              )}
              {row.joins.map((j, k) => (
                <line
                  key={`j${j}`}
                  className={dim(edgeLit(row.joinChilds[k], c.sha))}
                  x1={xr}
                  y1={yOf(j)}
                  x2={x}
                  y2={y}
                  stroke={laneColor(j)}
                  strokeWidth={3}
                />
              ))}
              {row.continues && (
                <line className={dim(on)} x1={x} y1={y} x2={xl} y2={y} stroke={laneColor(row.lane)} strokeWidth={3} />
              )}
              {row.forks.map((m, k) => (
                <line
                  key={`f${m}`}
                  className={dim(edgeLit([c.sha], row.forkShas[k]))}
                  x1={x}
                  y1={y}
                  x2={xl}
                  y2={yOf(m)}
                  stroke={laneColor(m)}
                  strokeWidth={3}
                />
              ))}
              {/* hover tells you which commit this is; click opens it on
                  the Branches page */}
              <g
                className="rr-node"
                onClick={() => onOpenCommit(c.sha)}
                role="button"
                aria-label={`Open ${c.subject} on the Branches page`}
              >
                <title>
                  {`${c.subject}\n${c.author_name} · ${new Date(c.date).toLocaleString()}`}
                </title>
                {c.is_head ? (
                  <g className={`gg-head ${dim(on) ?? ""}`}>
                    <circle className="gg-halo" cx={x} cy={y} r={13} fill="var(--accent)" />
                    <circle cx={x} cy={y} r={8} fill="none" stroke="var(--accent)" strokeWidth={3} />
                    <circle cx={x} cy={y} r={4.2} fill="var(--accent)" />
                    <text className="rr-here" x={x} y={y + 28} textAnchor="middle">
                      You are here
                    </text>
                  </g>
                ) : (
                  <>
                    {/* a roomier invisible target than the dot itself */}
                    <circle cx={x} cy={y} r={11} fill="transparent" />
                    <circle
                      className={dim(on)}
                      cx={x}
                      cy={y}
                      r={tipName ? 6 : 4.2}
                      fill={laneColor(row.lane)}
                    />
                  </>
                )}
              </g>
              {tipName && (
                <text
                  className={`rr-label ${dim(labelOn) ?? ""}`}
                  x={x + 4}
                  y={y - 16}
                  fill={laneColor(row.lane)}
                  transform={`rotate(-72 ${x + 4} ${y - 16})`}
                >
                  {truncName(tipName, 14)}
                  <tspan className="rr-date" dx="6">
                    {forkOf.get(tipName)
                      ? `${shortDate(forkOf.get(tipName)! * 1000)}→${shortDate(c.date)}`
                      : shortDate(c.date)}
                  </tspan>
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function ProgressPage({
  rows,
  onClose,
  onOpenBranches,
  onOpenCommit,
}: {
  rows: FileRowData[];
  onClose: () => void;
  onOpenBranches: () => void;
  /** Jump straight to one commit on the Branches page. */
  onOpenCommit: (sha: string) => void;
}) {
  const stats = useQuery({
    queryKey: ["commitStats"],
    queryFn: getCommitStats,
    staleTime: 5 * 60_000,
  });
  const activity = useQuery({
    queryKey: ["activityAll"],
    queryFn: getActivityAll,
    staleTime: 60_000,
  });
  const branches = useQuery({
    queryKey: ["branchOverview"],
    queryFn: getBranchOverview,
    staleTime: 60_000,
  });
  const branchList = branches.data ?? [];
  const defaultName =
    branchList.find((b) => b.is_default)?.name ?? "the default branch";
  const graph = useQuery({
    queryKey: ["graph"],
    queryFn: getGraph,
    staleTime: 60_000,
  });
  const laid = useMemo(() => layoutGraph(graph.data ?? []), [graph.data]);
  const identities = useIdentities();
  const now = useNow();
  const [hoveredBranch, setHoveredBranch] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("month");
  const [peopleRange, setPeopleRange] = useState<RangeKey>("month");

  const areas = useMemo(() => areaStats(rows, now), [rows, now]);

  // Shares per bucket for the chosen range, oldest first
  const buckets = useMemo(() => {
    const { buckets: count, size } = RANGES[range];
    const start = now - count * size;
    const out = Array.from({ length: count }, (_, i) => ({
      start: start + i * size,
      commits: 0,
      files: 0,
    }));
    for (const c of stats.data ?? []) {
      const idx = Math.floor((new Date(c.date).getTime() - start) / size);
      if (idx >= 0 && idx < count) {
        out[idx]!.commits += 1;
        out[idx]!.files += c.file_count;
      }
    }
    return out;
  }, [stats.data, range, now]);

  const peakCommits = Math.max(1, ...buckets.map((b) => b.commits));

  // Who has shared work in the chosen window
  const contributors = useMemo(() => {
    const { buckets: n, size } = RANGES[peopleRange];
    const cutoff = now - n * size;
    const recent = (stats.data ?? []).filter(
      (c) => new Date(c.date).getTime() > cutoff,
    );
    const people = resolveCommitAuthors(
      recent.map((c, i) => ({
        sha: String(i),
        author_name: c.author_name,
        author_email: c.author_email,
      })),
      identities.data ?? [],
    );
    const tally = new Map<
      string,
      { name: string; login: string | null; avatarUrl: string | null; commits: number }
    >();
    recent.forEach((c, i) => {
      const p = people.get(String(i));
      const key = (p?.login ?? p?.name ?? c.author_name).toLowerCase();
      const entry = tally.get(key) ?? {
        name: p?.name ?? c.author_name,
        login: p?.login ?? null,
        avatarUrl: p?.avatarUrl ?? null,
        commits: 0,
      };
      entry.commits += 1;
      tally.set(key, entry);
    });
    return [...tally.values()].sort((a, b) => b.commits - a.commits);
  }, [stats.data, identities.data, peopleRange, now]);

  // Repeated edits
  const churn = useMemo(() => {
    const tally = new Map<string, { path: string; edits: number; last: number }>();
    for (const commit of activity.data ?? []) {
      const when = new Date(commit.date).getTime();
      for (const f of commit.files) {
        if (!/\.(sldprt|sldasm|slddrw)$/i.test(f.path)) continue;
        const entry = tally.get(f.path) ?? { path: f.path, edits: 0, last: 0 };
        entry.edits += 1;
        entry.last = Math.max(entry.last, when);
        tally.set(f.path, entry);
      }
    }
    return [...tally.values()]
      .filter((e) => e.edits > 1)
      .sort((a, b) => b.edits - a.edits || b.last - a.last)
      .slice(0, 8);
  }, [activity.data]);

  const weekAgo = now - WEEK_MS;
  const totalFiles = rows.length;
  const changedThisWeek = rows.filter((r) => r.file.modified > weekAgo).length;
  const lockedNow = rows.filter((r) => r.status.kind !== "unlocked").length;
  const sharesThisWeek = (stats.data ?? []).filter(
    (c) => new Date(c.date).getTime() > weekAgo,
  ).length;

  return (
    <main className="settingspage">
      <div className="settingshead">
        <button className="backbtn" onClick={onClose}>
          ← Back
        </button>
        <div className="settingsbrand">
          <div className="settingstitle">
            <h2>Progress</h2>
          </div>
        </div>
      </div>

      <div className="settingsbody">
        <div className="statrow">
          <div className="stattile">
            <span className="statnum">{totalFiles}</span>
            <span className="muted small">CAD files</span>
          </div>
          <div className="stattile">
            <span className="statnum">{changedThisWeek}</span>
            <span className="muted small">changed this week</span>
          </div>
          <div className="stattile">
            <span className="statnum">{lockedNow}</span>
            <span className="muted small">locked right now</span>
          </div>
          <div className="stattile">
            <span className="statnum">{sharesThisWeek}</span>
            <span className="muted small">shares this week</span>
          </div>
        </div>

        <section className="setupsection">
          <div className="sectionhead">
            <h3>Activity</h3>
            <div className="typefilter">
              {(Object.keys(RANGES) as RangeKey[]).map((key) => (
                <button
                  key={key}
                  className={range === key ? "active" : ""}
                  onClick={() => setRange(key)}
                >
                  {RANGES[key].label}
                </button>
              ))}
            </div>
          </div>
          <p className="muted">
            Each bar is one {RANGES[range].unit} of shared changes, hover for
            the numbers.
          </p>
          {stats.isLoading ? (
            <p className="muted">Reading project history…</p>
          ) : (
            <div className="weekchart">
              {buckets.map((b, i) => (
                <div
                  key={i}
                  className="weekbar"
                  title={`${formatDate(b.start)}: ${b.commits} share${b.commits === 1 ? "" : "s"}, ${b.files} file change${b.files === 1 ? "" : "s"}`}
                >
                  <div
                    className="weekfill"
                    style={{
                      height: `${Math.max(b.commits === 0 ? 2 : 8, (b.commits / peakCommits) * 100)}%`,
                      opacity: b.commits === 0 ? 0.25 : 1,
                    }}
                  />
                  <span className="weeklabel muted">
                    {i === 0 || i === buckets.length - 1
                      ? new Date(b.start).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })
                      : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="setupsection">
          <div className="sectionhead">
            <h3>Branches</h3>
            <button
              className="branchoffbtn"
              onClick={onOpenBranches}
              title="The full picture: every branch and change on one railway, with branch off, restore and combine"
            >
              <BranchGlyph />
              Explore branches
            </button>
          </div>
          <p className="muted">
            Every branch your team has shared, newest work first. Ahead and
            behind are counted against {defaultName}.
          </p>
          {branches.isLoading ? (
            <p className="muted">Reading branches…</p>
          ) : branchList.length === 0 ? (
            <p className="muted">No branches have been shared yet.</p>
          ) : (
            <>
            {laid.rows.length > 0 && (
              <BranchRailway
                rows={laid.rows}
                laneCount={laid.laneCount}
                branches={branchList}
                highlight={hoveredBranch}
                onOpenCommit={onOpenCommit}
              />
            )}
            <ul className="branchlist">
              {branchList.map((b) => (
                <li
                  key={b.name}
                  className="branchrow"
                  onMouseEnter={() => setHoveredBranch(b.name)}
                  onMouseLeave={() =>
                    setHoveredBranch((prev) => (prev === b.name ? null : prev))
                  }
                >
                  <span className="branchname">
                    {b.name}
                    {b.is_default && (
                      <span className="branchtag">default</span>
                    )}
                  </span>
                  <span className="branchdiv">
                    {b.is_default ? (
                      <span className="muted small">&mdash;</span>
                    ) : (
                      <>
                        {b.ahead > 0 && (
                          <span className="branchahead">{b.ahead} ahead</span>
                        )}
                        {b.behind > 0 && (
                          <span className="branchbehind">{b.behind} behind</span>
                        )}
                        {b.ahead === 0 && b.behind === 0 && (
                          <span className="muted small">in step</span>
                        )}
                      </>
                    )}
                  </span>
                  <span className="muted small branchlast">
                    {b.author} &middot; {formatDate(b.last_commit_at * 1000)}
                  </span>
                </li>
              ))}
            </ul>
            </>
          )}
        </section>

        <section className="setupsection">
          <h3>Most reworked files</h3>
          <p className="muted">
            Files changed more than once in recent history. See which part is being repeatedly reworked.
          </p>
          {churn.length === 0 ? (
            <p className="muted">
              Nothing has been changed more than once recently.
            </p>
          ) : (
            <ul className="contriblist">
              {churn.map((c) => (
                <li key={c.path} className="churnrow">
                  <span className="contribname" title={c.path}>
                    <FilePreview path={c.path} className="fthumb lockthumb" />
                    {c.path.split("/").pop()}
                  </span>
                  <span className="contribbar">
                    <span
                      className="contribfill"
                      style={{
                        width: `${(c.edits / churn[0]!.edits) * 100}%`,
                      }}
                    />
                  </span>
                  <span className="muted small">
                    {c.edits} changes · {formatDate(c.last)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="setupsection">
          <h3>Areas of the plane</h3>
          <p className="muted">
            Top level folders only.
          </p>
          <div className="arealist">
            {areas.map((a) => (
              <div key={a.name} className="areacard">
                <div className="areahead">
                  <strong>{a.name}</strong>
                  <span className="muted small">
                    {a.total} file{a.total === 1 ? "" : "s"} · {quietFor(a.lastTouched, now)}
                  </span>
                </div>
                <div className="areabar">
                  <div
                    className="areafill"
                    style={{
                      width: `${Math.round((a.changedThisWeek / a.total) * 100)}%`,
                    }}
                  />
                </div>
                <div className="areameta muted small">
                  {a.changedThisWeek} changed this week
                  {a.lockedByMe > 0 && ` · ${a.lockedByMe} locked by you`}
                  {a.locked > 0 && ` · ${a.locked} locked by teammates`}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="setupsection">
          <div className="sectionhead">
            <h3>Who has been working</h3>
            <div className="typefilter">
              {(Object.keys(RANGES) as RangeKey[]).map((key) => (
                <button
                  key={key}
                  className={peopleRange === key ? "active" : ""}
                  onClick={() => setPeopleRange(key)}
                >
                  {RANGES[key].label}
                </button>
              ))}
            </div>
          </div>
          {contributors.length === 0 ? (
            <p className="muted">
              No shared changes in the {RANGES[peopleRange].label.toLowerCase()}.
            </p>
          ) : (
            <ul className="contriblist">
              {contributors.map((c) => (
                <li key={c.name}>
                  <UserAvatar url={c.avatarUrl} name={c.name} size={20} />
                  <span className="contribname">
                    {formatPerson(c.name, c.login)}
                  </span>
                  <span className="contribbar">
                    <span
                      className="contribfill"
                      style={{
                        width: `${(c.commits / contributors[0]!.commits) * 100}%`,
                      }}
                    />
                  </span>
                  <span className="muted small">
                    {c.commits} share{c.commits === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
