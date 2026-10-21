import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getActivityAll,
  getBranchOverview,
  getCommitStats,
  getGraph,
  getDependencyGraph,
  getLocks,
} from "../../api";
import { FilePreview } from "../common/FilePreview";
import { BranchGlyph, BulbGlyph } from "../common/HistoryDiagrams";
import { computeLaneSlots, layoutGraph, routeSets } from "../history/HistoryPage";
import { isAppError } from "../../types";
import { BranchRailway } from "./BranchRailway";
import type { FileRowData } from "../dashboard/Dashboard";
import { UserAvatar } from "../common/UserAvatar";
import { BranchName, useBranchColors } from "../common/BranchName";
import {
  formatPerson,
  resolveCommitAuthors,
  useIdentities,
  usePeople,
} from "../../identity";
import { formatDate, useNow } from "../../dates";
import {
  AssemblyMap,
  BranchDivergence,
  LockTimeline,
  ShareCalendar,
  type Divergence,
  type HeldLock,
} from "./charts";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Activity chart ranges */
const RANGES = {
  week: { label: "Past week", buckets: 7, size: DAY_MS, unit: "day" },
  month: { label: "Past month", buckets: 30, size: DAY_MS, unit: "day" },
  quarter: { label: "Past 3 months", buckets: 13, size: WEEK_MS, unit: "week" },
} as const;

type RangeKey = keyof typeof RANGES;

// function truncName(s: string, n: number): string {
//   return s.length > n ? `${s.slice(0, n - 1)}…` : s;
// }

/** Break a long branch name over as many lines as it needs. A name is how
    the team refers to a piece of work, so it is never cut short; it wraps
    after a dash or slash where there is one, and mid-word only as a last
    resort. */


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



export function ProgressPage({
  rows,
  onOpenBranches,
  onOpenCommit,
}: {
  rows: FileRowData[];
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
  // Memoised: a fresh [] each render would rebuild everything downstream.
  const branchList = useMemo(() => branches.data ?? [], [branches.data]);
  const defaultName =
    branchList.find((b) => b.is_default)?.name ?? "the default branch";
  const graph = useQuery({
    queryKey: ["graph"],
    queryFn: getGraph,
    staleTime: 60_000,
  });
  const routes = useMemo(() => routeSets(graph.data ?? []), [graph.data]);
  const laid = useMemo(() => layoutGraph(graph.data ?? []), [graph.data]);
  const laneLayout = useMemo(
    () => computeLaneSlots(laid.rows, routes, laid.laneCount),
    [laid, routes],
  );
  const identities = useIdentities();
  // Branch tip -> the same resolved person the railway and Branches page show.
  const tipPerson = useMemo(() => {
    const authors = resolveCommitAuthors(
      (graph.data ?? []).map((c) => ({
        sha: c.sha,
        author_name: c.author_name,
        author_email: c.author_email,
      })),
      identities.data ?? [],
    );
    const map = new Map<string, ReturnType<typeof authors.get>>();
    for (const row of laid.rows) {
      for (const r of row.commit.refs) {
        const name = r.startsWith("origin/") ? r.slice(7) : r;
        if (!map.has(name)) map.set(name, authors.get(row.commit.sha));
      }
    }
    return map;
  }, [graph.data, identities.data, laid.rows]);
  const now = useNow();
  const branchColorOf = useBranchColors();
  const people = usePeople();

  // Who is holding what, and what is finished but still sitting on somebody's
  // machine. Both are "where is the work stuck", which the rest of this page
  // does not answer: everything else here is a record of what already went by.
  const locks = useQuery({
    queryKey: ["locks"],
    queryFn: getLocks,
    staleTime: 30_000,
  });
  /* Fed the parked "Finished but not shared" panel; back when it is.
  const pulls = useQuery({
    queryKey: ["pulls"],
    queryFn: listPulls,
    staleTime: 60_000,
    retry: false,
  });
  */

  /** Every lock either side of the fence, oldest first. */
  const held = useMemo<HeldLock[]>(() => {
    const all = [
      ...(locks.data?.ours ?? []).map((l) => ({ lock: l, mine: true })),
      ...(locks.data?.theirs ?? []).map((l) => ({ lock: l, mine: false })),
    ];
    return all
      .filter((h) => h.lock.locked_at)
      .map((h) => ({
        id: h.lock.id,
        path: h.lock.path,
        login: h.lock.owner?.name ?? null,
        since: new Date(h.lock.locked_at!).getTime(),
        mine: h.mine,
      }))
      .sort((a, b) => a.since - b.since)
      .slice(0, 12);
  }, [locks.data]);

  /* Fed the "Finished but not shared" panel, which is commented out below.
     Kept together with it so the two come back as one piece.

  /** Branches with work on them and no request open to bring it home. *|
  const unshared = useMemo(() => {
    const open = new Set(
      (pulls.data ?? []).filter((p) => p.state === "open").map((p) => p.head),
    );
    return branchList
      .filter((b) => !b.is_default && b.ahead > 0 && !open.has(b.name))
      .sort((a, b) => b.ahead - a.ahead);
  }, [branchList, pulls.data]);

  const waiting = useMemo(
    () =>
      (pulls.data ?? [])
        .filter((p) => p.state === "open")
        .sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        ),
    [pulls.data],
  );
  */

  // A COM round trip, so it stays off page load and starts itself when the
  // panel scrolls into view.
  const [depsOn, setDepsOn] = useState(false);
  const mapRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = mapRef.current;
    if (!el || depsOn) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setDepsOn(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [depsOn]);


  const [depFocus, setDepFocus] = useState<string | null>(null);
  const deps = useQuery({
    queryKey: ["dependencyGraph"],
    queryFn: getDependencyGraph,
    enabled: depsOn,
    staleTime: 5 * 60_000,
    retry: false,
  });

  // No automatic retry. Turning depsOn back off after a failure looked like a
  // way to let the next visit try again, but the observer is still watching a
  // panel that is still on screen: it fires straight back, the call fails
  // again, and the panel flickers between "Asking SolidWorks" and the error
  // for as long as you look at it. Leaving Insights unmounts this page, so
  // coming back is already a fresh attempt; in the meantime there is a
  // Try again to press.

  /** The first shared change, so the grid can start where the project did. */
  const firstShare = useMemo(() => {
    let earliest: number | null = null;
    for (const c of stats.data ?? []) {
      const t = new Date(c.date).getTime();
      if (!Number.isNaN(t) && (earliest === null || t < earliest)) earliest = t;
    }
    return earliest;
  }, [stats.data]);

  /** Shares per calendar day, for the season grid. */
  const sharesByDay = useMemo(() => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const out = new Map<string, number>();
    for (const c of stats.data ?? []) {
      const d = new Date(c.date);
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      out.set(key, (out.get(key) ?? 0) + 1);
    }
    return out;
  }, [stats.data]);

  /* Fed the treemap, which is parked below.

  const treeItems = useMemo<TreeItem[]>(
    () =>
      rows
        .filter((r) => !r.file.deleted && r.file.size > 0)
        .map((r) => ({
          group: r.file.dir.split("/")[0] || "Loose files",
          name: r.file.name,
          size: r.file.size,
          lock: r.status.kind,
          modified: r.file.modified,
        })),
    [rows],
  );
  */

  /** Ahead and behind per branch, with whoever was last on it. */
  const divergence = useMemo<Divergence[]>(
    () =>
      branchList
        .filter((b) => !b.is_default)
        .map((b) => {
          const who = tipPerson.get(b.name);
          return {
            name: b.name,
            ahead: b.ahead,
            behind: b.behind,
            isDefault: b.is_default,
            author: who?.name ?? b.author,
            login: who?.login ?? null,
            avatarUrl: who?.avatarUrl ?? null,
          };
        })
        .sort((a, b) => b.ahead + b.behind - (a.ahead + a.behind)),
    [branchList, tipPerson],
  );

  // Calling out a branch is now something you do on purpose, not something
  // that happens because the pointer crossed a row on its way somewhere else.
  // One at a time, and anything you press on the railway puts it away again.
  const [litBranch, setLitBranch] = useState<string | null>(null);
  const railwayRef = useRef<HTMLElement>(null);

  function toggleLit(name: string) {
    const next = litBranch === name ? null : name;
    setLitBranch(next);
    // The railway is above the list, and on a long page it is usually off
    // the top of the window by the time you reach the branch you wanted.
    if (next) {
      railwayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
  const [range, setRange] = useState<RangeKey>("month");
  const [peopleRange, setPeopleRange] = useState<RangeKey>("month");


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
        if (!/\.(sldprt|sldasm|slddrw|stl|3mf)$/i.test(f.path)) continue;
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
    <main className="settingspage progresspage">
      <div className="pagehead">
        <h2>Insights</h2>
      </div>

      <div className="settingsbody cardgrid">
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

        <section className="setupsection wide">
          <h3>Activity</h3>
          {/* A caption each, over the chart it belongs to. One line covering
              both left the reader working out which half was which, and the
              half about the grid sat a chart away from the grid. */}
          <div className="actstack">
          <div className="actbars">
            {/* Sat in the panel heading, where it looked as though it drove
                both charts. It only ever changed the bars. */}
            <div className="typefilter actrange">
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
          </div>
          <div className="actcal">
            <p className="muted chartcap">
              Each square represents a day. The busier the day, the brighter the square. 
              Outlined squares are days before the project existed.
            </p>
            <ShareCalendar days={sharesByDay} since={firstShare} now={now} />
          </div>
          </div>
        </section>

        <section className="setupsection wide" ref={railwayRef}>
          <div className="sectionhead">
            <h3>Branch Timeline</h3>
            <button
              className="branchoffbtn"
              onClick={onOpenBranches}
              title="Every branch and change on one railway, with branch off, restore and merge"
            >
              <BranchGlyph />
              Explore branches
            </button>
          </div>
          <p className="muted">
            Every branch your team has shared with newest work first. Ahead and
            behind are counted against <BranchName name={defaultName} />.
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
                highlight={litBranch}
                routes={routes}
                slots={laneLayout.slots}
                onOpenCommit={onOpenCommit}
                onClearHighlight={() => setLitBranch(null)}
              />
            )}
            <ul className="branchlist">
              {branchList.map((b) => (
                <li
                  key={b.name}
                  className={`branchrow${litBranch === b.name ? " lit" : ""}`}
                >
                  <span className="branchname">
                    <span
                      className="branchmark"
                      style={{ color: branchColorOf(b.name) }}
                      aria-hidden="true"
                    >
                      <BranchGlyph size={13} />
                    </span>
                    <BranchName name={b.name} />
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
                  <span className="muted small branchlast branchwho">
                    <UserAvatar
                      url={tipPerson.get(b.name)?.avatarUrl ?? null}
                      name={tipPerson.get(b.name)?.name ?? b.author}
                      size={16}
                    />
                    <span>
                      {tipPerson.get(b.name)
                        ? formatPerson(
                            tipPerson.get(b.name)!.name,
                            tipPerson.get(b.name)!.login,
                          )
                        : b.author}{" "}
                      &middot; {formatDate(b.last_commit_at * 1000)}
                    </span>
                  </span>
                  <button
                    className={`branchlight${litBranch === b.name ? " on" : ""}`}
                    onClick={() => toggleLit(b.name)}
                    aria-pressed={litBranch === b.name}
                    title={
                      litBranch === b.name
                        ? `Stop calling out ${b.name} on the railway`
                        : `Call out ${b.name}'s line on the railway above`
                    }
                  >
                    <BulbGlyph />
                    <span>Highlight</span>
                  </button>
                </li>
              ))}
            </ul>
            </>
          )}
        </section>

        {/* Where the work is stuck, rather than where it has been. */}
        <section className="setupsection">
          <h3>Who is holding what, and for how long</h3>
          <p className="muted">
            Each lock is shown as a bar from the time it was created up to now. A long
            bar means the file has been locked for a while.
          </p>
          {locks.isLoading ? (
            <p className="muted small">Reading the locks…</p>
          ) : held.length === 0 ? (
            <p className="muted">Nothing is locked right now.</p>
          ) : (
            <LockTimeline
              locks={held}
              now={now}
              nameFor={(l) => people.nameFor(l)}
              avatarFor={(l) => people.avatarFor(l)}
            />
          )}
        </section>

        <section className="setupsection">
          <h3>How far the branches have drifted</h3>
          <p className="muted">
            Work on <BranchName name={defaultName} /> that the branch hasn't picked up 
            yet appears on the left. Work that exists only on that branch appears on the 
            right. Any conflicting files need to be resolved manually, so the more a branch 
            differs from <BranchName name={defaultName} />, the more there is to sort out.
          </p>
          {divergence.length === 0 ? (
            <p className="muted">No branches have been shared yet.</p>
          ) : (
            <BranchDivergence
              branches={divergence}
              defaultName={defaultName}
              colorOf={branchColorOf}
            />
          )}
        </section>

        {/* Taken out of Progress for now; the data and the memos above are
            still here, so putting it back is uncommenting this.

        <section className="setupsection">
          <h3>Finished but not shared</h3>
          <p className="muted">
            Work that is done and still sitting on somebody's machine.
            Branches with changes on them and no request open to bring them
            into <BranchName name={defaultName} />, and the requests already
            waiting.
          </p>
          {unshared.length === 0 && waiting.length === 0 ? (
            <p className="muted">
              Nothing is waiting. Every branch with work on it has a request
              open, or has already been merged.
            </p>
          ) : (
            <ul className="contriblist">
              {unshared.map((b) => {
                const who = tipPerson.get(b.name);
                return (
                  <li key={b.name} className="churnrow">
                    <span className="contribname">
                      <span
                        className="branchmark"
                        style={{ color: branchColorOf(b.name) }}
                        aria-hidden="true"
                      >
                        <BranchGlyph size={13} />
                      </span>
                      <BranchName name={b.name} />
                    </span>
                    <span className="heldwho">
                      <UserAvatar
                        url={who?.avatarUrl ?? null}
                        name={who?.name ?? b.author}
                        size={20}
                      />
                      <span className="heldwho-name muted small">
                        {who
                          ? formatPerson(who.name, who.login)
                          : b.author}
                      </span>
                    </span>
                    <span className="muted small heldage stale">
                      {b.ahead} change{b.ahead === 1 ? "" : "s"} waiting
                    </span>
                  </li>
                );
              })}
              {waiting.map((p) => {
                const days = Math.floor(
                  (now - new Date(p.created_at).getTime()) / DAY_MS,
                );
                return (
                  <li key={`pr-${p.number}`} className="churnrow">
                    <span className="contribname" title={p.title}>
                      <span
                        className="branchmark"
                        style={{ color: branchColorOf(p.head) }}
                        aria-hidden="true"
                      >
                        <BranchGlyph size={13} />
                      </span>
                      <BranchName name={p.head} />
                    </span>
                    <span className="heldwho">
                      <UserAvatar
                        url={people.avatarFor(p.author)}
                        name={people.nameFor(p.author) ?? p.author}
                        size={20}
                      />
                      <span className="heldwho-name muted small">
                        {formatPerson(
                          people.nameFor(p.author) ?? p.author,
                          p.author,
                        )}
                      </span>
                    </span>
                    <span
                      className={`muted small heldage${days >= 3 ? " stale" : ""}`}
                    >
                      {days <= 0 ? "opened today" : `${days} day${days === 1 ? "" : "s"}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        */}


        {/* Asks SolidWorks over COM for every document's references, which
            takes seconds. Drawn when scrolled to, not on page load. */}
        <section className="setupsection wide" ref={mapRef}>
          <div className="sectionhead">
            <h3>What is built from what</h3>
            {depsOn && !deps.isLoading && (
              <button
                className="minibtn"
                onClick={() => void deps.refetch()}
                title="Ask SolidWorks again"
              >
                Redraw
              </button>
            )}
          </div>
          <p className="muted">
            Which parts are used by which assemblies. Click a file to see which assemblies 
            could be affected by a change to it. SolidWorks must be open to use this feature.
          </p>
          {/* A map already drawn is kept even when a later attempt fails:
              SolidWorks being shut now says nothing about whether the picture
              on screen was right when it was taken. */}
          {deps.isError && (
            <p className="errdetail deperr">
              {isAppError(deps.error) ? deps.error.message : String(deps.error)}{" "}
              <button className="linkish inline" onClick={() => void deps.refetch()}>
                Try again
              </button>
            </p>
          )}
          {deps.isFetching && (
            <p className="muted small">Asking SolidWorks…</p>
          )}
          {!depsOn && !deps.isFetching && (
            <p className="muted small">Waiting to draw…</p>
          )}
          {(deps.data ?? []).length > 0 ? (
            <AssemblyMap
              edges={deps.data ?? []}
              lockOf={(path) =>
                rows.find(
                  (r) => r.file.rel_path.toLowerCase() === path.toLowerCase(),
                )?.status.kind ?? "unlocked"
              }
              focus={depFocus}
              onPick={(p) => setDepFocus(p === "" ? null : p)}
            />
          ) : (
            depsOn &&
            !deps.isFetching &&
            !deps.isError && (
              <p className="muted">
                Nothing in this project references anything else.
              </p>
            )
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

        {/* Taken out. At a couple of hundred CAD files the treemap was a
            mosaic of slivers narrower than their own labels, and thinning it
            to the biggest few per folder still did not earn the room. It
            replaced "Areas of the plane" and "Heaviest files"; ProjectTreemap
            and the treeItems memo are still there if it is ever wanted.

        <section className="setupsection wide">
          <h3>The shape of the project</h3>
          <p className="muted">
            Every file as a block, sized by how much disk it takes and grouped
            by folder. Brighter means changed recently; a coloured edge means
            somebody is holding it.
          </p>
          {treeItems.length === 0 ? (
            <p className="muted">No files yet.</p>
          ) : (
            <ProjectTreemap items={treeItems} now={now} />
          )}
        </section>
        */}

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
