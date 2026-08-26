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
import {
  computeLaneSlots,
  crossPath,
  edgeRoutesOf,
  layoutGraph,
  routeColor,
  routeDash,
  routeSets,
  type RouteMap,
} from "../history/HistoryPage";
import { isAppError, type BranchSummary } from "../../types";
import type { FileRowData } from "../dashboard/Dashboard";
import { UserAvatar } from "../common/UserAvatar";
import { BranchName, useBranchColors } from "../common/BranchName";
import { RailCard } from "../common/RailCard";
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
function wrapName(name: string, max: number): string[] {
  if (name.length <= max) return [name];
  const lines: string[] = [];
  let rest = name;
  while (rest.length > max) {
    // Break after the last dash, slash or underscore that still fits, so
    // "h-tail-modifications" splits as "h-tail-" and "modifications".
    let cut = -1;
    for (let i = max; i >= 2; i--) {
      if (/[-_/. ]/.test(rest[i - 1])) {
        cut = i;
        break;
      }
    }
    if (cut <= 0) {
      lines.push(`${rest.slice(0, max - 1)}-`);
      rest = rest.slice(max - 1);
      continue;
    }
    lines.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length > 0) lines.push(rest);
  return lines;
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


const NO_ROUTE = "var(--muted)";
function sweep(x0: number, y0: number, x1: number, y1: number): string {
  return crossPath(y0, x0, y1, x1, "x");
}

// How much horizontal run a crossing gets.
// function runFor(dy: number, col: number): number {
//   return Math.min(col * 1.5, Math.max(col, Math.abs(dy) * 0.45));
// }

/** Gap between the stacked labels at a commit several branches stop at. */
const LABEL_STEP = 13;
/** How many characters fit on one line of a slanted label. */
const LABEL_CHARS = 14;

function BranchRailway({
  rows,
  laneCount,
  branches,
  highlight,
  routes,
  slots,
  onOpenCommit,
  onClearHighlight,
}: {
  rows: ReturnType<typeof layoutGraph>["rows"];
  laneCount: number;
  branches: BranchSummary[];
  highlight: string | null;
  routes: RouteMap;
  slots: ReturnType<typeof computeLaneSlots>["slots"];
  /** Jump to this commit on the Branches page. */
  onOpenCommit: (sha: string) => void;
  /** Anything else you press in here puts the called-out branch away. */
  onClearHighlight: () => void;
}) {
  const COL = 40;
  // Lanes sit about as far apart as a connector has room to travel, so a
  // corner turns through the same angle here as it does on the Branches
  // railway, where the lanes are 16 apart and the corner has 17 to turn in.
  // Push them further apart and the identical curve stands on end.
  const LANE = 20;
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

  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel]);
  const selRow = sel ? rows.find((r) => r.commit.sha === sel) : undefined;

  const stopsOf = useMemo(
    () => (route: string | null) => {
      if (!route) return null;
      const own = new Set<string>();
      for (const r of rows) {
        if ((routes.bySha.get(r.commit.sha) ?? []).includes(route)) {
          own.add(r.commit.sha);
        }
      }
      if (own.size === 0) return null;
      const all = new Set(own);
      const from = routes.forkPoint.get(route);
      if (from) all.add(from);
      // rows run newest first, so the line's tip is the earliest one in it.
      const tip = rows.find((r) => own.has(r.commit.sha))?.commit.sha;
      const merger = tip
        ? rows.find(
            (r) => !own.has(r.commit.sha) && r.commit.parents.indexOf(tip) > 0,
          )
        : undefined;
      if (merger) all.add(merger.commit.sha);
      return { own, all };
    },
    [rows, routes],
  );
  const lineOf = useMemo(
    () => (route: string | null) => stopsOf(route)?.all ?? null,
    [stopsOf],
  );
  // A clicked stop wins outright. Running the mouse down the branch list
  // below would otherwise keep relighting the diagram out from under the
  // stop you opened, which reads as the picture changing on its own.
  const hover = sel ? null : highlight;
  const hl = useMemo(
    () => lineOf(hover ? (routes.repOf.get(hover) ?? null) : null),
    [hover, routes, lineOf],
  );
  const hlOwn = useMemo(
    () => stopsOf(hover ? (routes.repOf.get(hover) ?? null) : null)?.own ?? null,
    [hover, routes, stopsOf],
  );
  /** Every branch the clicked stop is on, not just the ones drawn through
      it. A branch that broke off further along still came this way, so it
      lights too; only the branches whose history never reaches this stop
      go quiet. Same answer the panel gives when it says "On main, Susan". */
  const selRoutes = useMemo(
    () => (sel ? (routes.containedIn.get(sel) ?? []) : []),
    [sel, routes],
  );
  const selLine = useMemo(() => {
    if (!sel) return null;
    const all = new Set<string>();
    for (const r of selRoutes) {
      for (const sha of lineOf(r) ?? []) all.add(sha);
    }
    // A stop no line runs along lights only itself.
    return all.size > 0 ? all : new Set([sel]);
  }, [sel, selRoutes, lineOf]);
  const selOwn = useMemo(() => {
    if (!sel) return null;
    const all = new Set<string>();
    for (const r of selRoutes) {
      for (const sha of stopsOf(r)?.own ?? []) all.add(sha);
    }
    return all.size > 0 ? all : new Set([sel]);
  }, [sel, selRoutes, stopsOf]);
  const line = selLine ?? hl;
  const lineOwn = selOwn ?? hlOwn;

  // Scrolling the page to the railway is only half the job: the branch you
  // asked for is usually off to one side of a diagram wider than its box.
  // Bring its own stretch of line into view as well, centred where it fits.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !highlight || !hl || hl.size === 0) return;
    let newest = Infinity;
    let oldest = -Infinity;
    rows.forEach((r, i) => {
      if (!hl.has(r.commit.sha)) return;
      newest = Math.min(newest, i);
      oldest = Math.max(oldest, i);
    });
    if (!Number.isFinite(newest)) return;
    // xOf runs right to left: index 0 is the newest commit, at the far right.
    const right = W - PAD - RIGHT - newest * COL - COL / 2;
    const left = W - PAD - RIGHT - oldest * COL - COL / 2;
    const middle = (left + right) / 2;
    const most = Math.max(0, el.scrollWidth - el.clientWidth);
    el.scrollTo({
      left: Math.min(most, Math.max(0, middle - el.clientWidth / 2)),
      behavior: "smooth",
    });
  }, [highlight, hl, rows, W, PAD, RIGHT, COL]);
  // Picking out one line dims the strands beside it. Clicking a stop where
  // several lines meet picks out all of them, so none is singled out and
  // they all stay drawn as they are.
  const focusLine = hover
    ? (routes.repOf.get(hover) ?? null)
    : selRoutes.length === 1
      ? selRoutes[0]
      : null;
  /** Which branches the highlight is actually about. The lit set is commits,
      and a commit belongs to every line running through it, so a shared
      stretch lights whole branches that merely pass along it. This says who
      was asked for, and everyone else's strand steps back even where the
      track they share is lit. */
  const litRoutes = useMemo(() => {
    if (sel) return new Set(selRoutes);
    return focusLine !== null ? new Set([focusLine]) : null;
  }, [sel, selRoutes, focusLine]);
  const dim = (on: boolean, _sha?: string) =>
    line === null || on ? undefined : "rr-dim";
  const parentsOf = useMemo(
    () => new Map(rows.map((r) => [r.commit.sha, r.commit.parents])),
    [rows],
  );
  const mergedOut = (childs: string[] | undefined, parent: string) =>
    lineOwn !== null &&
    lineOwn.has(parent) &&
    (childs ?? []).some((ch) => {
      const ps = parentsOf.get(ch);
      return !!ps && ps.length > 1 && ps.slice(1).includes(parent);
    });
  const edgeLit = (childs: string[] | undefined, parent: string) =>
    line === null ||
    (line.has(parent) && (childs ?? []).some((ch) => line.has(ch)));

  return (
    <div className="railscroll" ref={scrollRef}>
      <div className="railstage" style={{ width: W, height: H }}>
      <svg
        className="branchrail"
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Every branch and merge in the project, newest at the right"
        onClick={() => {
          setSel(null);
          onClearHighlight();
        }}
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
          // A branch is named once, at the stop its line ends at.
          const endsHere = routes.tipOf.get(c.sha) ?? [];
          const tipNames = [
            ...new Set(
              c.refs
                .filter((r) => r !== "HEAD" && r !== "origin/HEAD")
                .map((r) => (r.startsWith("origin/") ? r.slice(7) : r)),
            ),
          ].filter((n) => !routes.repOf.has(n) || endsHere.includes(n));
          const tipName = tipNames[0];
          const on = line === null || line.has(c.sha);
          // A stop being lit does not light the track leaving it: the stops
          // where a followed line forks off or merges belong to other lines,
          // and their own history must stay dim. Both ends have to be on the
          // followed line, the same test every other edge uses.
          const contLit =
            line === null ||
            (line.has(c.sha) && line.has(c.parents[0] ?? ""));
          // Each label answers for itself: only the branches the highlight is
          // about stay bright, even where several stop here. A branch whose
          // line merely runs along the lit stretch is not one of them. Tags
          // aren't lines, so a tag at the clicked stop stays bright.
          const labelLit = (name: string) =>
            litRoutes === null ||
            litRoutes.has(name) ||
            (sel === c.sha && !routes.repOf.has(name));
          // Lines sharing a lane run as parallel strands, each keeping its
          // own offset across the lane for as long as the lane is in use.
          const sl = slots[i] ?? new Map();
          const slotY = (lane: number, r: string) =>
            yOf(lane) + (sl.get(lane)?.get(r) ?? 0);
          const strands = (
            lane: number,
            rs: string[],
            fallback: number,
          ): { y: number; color: string; dash?: string; cls?: string }[] => {
            if (rs.length === 0) return [{ y: fallback, color: NO_ROUTE }];
            // Where the followed lines share a lane, only their own strands
            // stay lit; the ones beside them step back.
            const litHere =
              litRoutes !== null && rs.some((r) => litRoutes.has(r));
            return rs.map((r) => ({
              y: slotY(lane, r),
              color: routeColor(routes, r),
              dash: routeDash(routes, r),
              cls:
                litHere && rs.length > 1 && !litRoutes!.has(r)
                  ? "rr-dim"
                  : undefined,
            }));
          };
          const allNodeRs = routes.bySha.get(c.sha) ?? [];
          const laneSlots = sl.get(row.lane);
          // Lines with a strand in this lane sit on it; ones that only call
          // here, parked, with nothing of their own, are packed beside
          // them rather than reserving width down the whole lane.
          const nodeRs = allNodeRs.filter((r) => laneSlots?.has(r));
          // Branches parked here with no line of their own are stashed at the
          // far end of the bar, in the order their names are listed above it,
          // so reading the beads matches reading the labels.
          const chipOrder = new Map<string, number>();
          c.refs.forEach((ref, k) => {
            const name = ref.startsWith("origin/") ? ref.slice(7) : ref;
            if (!chipOrder.has(name)) chipOrder.set(name, k);
          });
          const restingRs = allNodeRs
            .filter((r) => !laneSlots?.has(r))
            .sort(
              (a, b) =>
                (chipOrder.get(a) ?? Number.MAX_SAFE_INTEGER) -
                (chipOrder.get(b) ?? Number.MAX_SAFE_INTEGER),
            );
          const nodeYs = nodeRs.map((r) => slotY(row.lane, r));
          const nMin = nodeYs.length ? Math.min(...nodeYs) : y;
          const nMax = nodeYs.length ? Math.max(...nodeYs) : y;
          const ncy = (nMin + nMax) / 2;
          const nodeColor =
            nodeRs.length === 1 ? routeColor(routes, nodeRs[0]) : NO_ROUTE;
          const topRs = row.hasTop
            ? edgeRoutesOf(routes, row.topChilds, c.sha)
            : [];
          const passRs = row.passes.map((_, k) =>
            edgeRoutesOf(routes, row.passChilds[k] ?? [], row.passShas[k]),
          );
          const joinRs = row.joins.map((_, k) =>
            edgeRoutesOf(routes, row.joinChilds[k] ?? [], c.sha),
          );
          const forkRs = row.forks.map((_, k) =>
            edgeRoutesOf(routes, [c.sha], row.forkShas[k]),
          );
          const callingRs = [
            ...new Set(joinRs.flat()),
            ...restingRs,
          ].filter((r, i, a) => !nodeRs.includes(r) && a.indexOf(r) === i);
          const beads = [
            ...nodeRs.map((r) => ({ r, by: slotY(row.lane, r) })),
            // Packed straight on, so the bar has no empty space in it.
            ...callingRs.map((r, k) => ({ r, by: nMax + (k + 1) * 5 })),
          ];
          const junction = beads.length > 1;
          // Where a line's own bead sits, so its track runs into it rather
          // than into the middle of the bar.
          const beadAt = new Map(beads.map((b) => [b.r, b.by]));
          const bMin = Math.min(nMin, ...beads.map((b) => b.by));
          const bMax = Math.max(nMax, ...beads.map((b) => b.by));
          // While a branch is followed, its stops are drawn as its own dot
          // instead of hiding inside the station bar, on its own strand
          // where it runs through, and on its own bead where it only calls
          // here. Either way the dot lands exactly where that branch sits in
          // the bar, so the bar can step back behind it.
          const focusStop =
            focusLine !== null ? (beadAt.get(focusLine) ?? null) : null;
          // Lit, but none of the highlighted branches actually calls here:
          // the stop their line ran into, where another picked the work up.
          // Hollow says "change here", it keeps the stop's own colour, which
          // is somebody else's, without pretending the branch you are
          // following carries on through it. A stop a branch was made from is
          // not one of these: it does call there, which is where its line
          // starts.
          const terminus =
            litRoutes !== null &&
            on &&
            !beads.some((b) => litRoutes.has(b.r));
          // Labels start above the whole marker, so a station bar is never
          // clipped by the name pointing at it.
          const labelY = bMin - 16;
          return (
            <g key={c.sha}>
              {row.passes.map((j, k) => (
                <g
                  key={`p${j}`}
                  className={dim(
                    edgeLit(row.passChilds[k], row.passShas[k]) ||
                      mergedOut(row.passChilds[k], row.passShas[k]),
                  )}
                >
                  {strands(j, passRs[k], yOf(j)).map((s) => (
                    <line
                      key={s.y}
                      className={s.cls}
                      x1={xl}
                      y1={s.y}
                      x2={xr}
                      y2={s.y}
                      stroke={s.color}
                      strokeWidth={3}
                      strokeDasharray={s.dash}
                    />
                  ))}
                </g>
              ))}
              {row.hasTop && (
                <g
                  className={dim(
                    edgeLit(row.topChilds, c.sha) ||
                      mergedOut(row.topChilds, c.sha),
                  )}
                >
                  {strands(row.lane, topRs, ncy).map((s) => (
                    <line
                      key={s.y}
                      className={s.cls}
                      x1={x}
                      y1={s.y}
                      x2={xr}
                      y2={s.y}
                      stroke={s.color}
                      strokeWidth={3}
                      strokeDasharray={s.dash}
                    />
                  ))}
                </g>
              )}
              {row.joins.map((j, k) => (
                <g
                  key={`j${j}`}
                  className={dim(
                    edgeLit(row.joinChilds[k], c.sha) ||
                      mergedOut(row.joinChilds[k], c.sha),
                  )}
                >
                  {(joinRs[k].length > 0 ? joinRs[k] : [null]).map((r) => {
                    const y0 = r ? slotY(j, r) : yOf(j);
                    const y1 = (r ? beadAt.get(r) : undefined) ?? ncy;
                    // Half a column: the connector's own side of this stop,
                    // and no further, so it never draws over the rails of
                    // the column next door.
                    const run = COL / 2;
                    return (
                      <path
                        key={r ?? "-"}
                        className={
                          r &&
                          litRoutes !== null &&
                          joinRs[k].some((q) => litRoutes.has(q)) &&
                          joinRs[k].length > 1 &&
                          !litRoutes.has(r)
                            ? "rr-dim"
                            : undefined
                        }
                        d={sweep(x + run, y0, x, y1)}
                        fill="none"
                        stroke={r ? routeColor(routes, r) : NO_ROUTE}
                        strokeWidth={3}
                        strokeDasharray={r ? routeDash(routes, r) : undefined}
                      />
                    );
                  })}
                </g>
              ))}
              {row.continues && (
                <g className={dim(contLit)}>
                  {strands(row.lane, nodeRs, ncy).map((s) => (
                    <line
                      key={s.y}
                      className={s.cls}
                      x1={x}
                      y1={s.y}
                      x2={xl}
                      y2={s.y}
                      stroke={s.color}
                      strokeWidth={3}
                      strokeDasharray={s.dash}
                    />
                  ))}
                </g>
              )}
              {row.forks.map((m, k) => {
                // The stretch running into where a line ends belongs to that
                // line, so the connector wears its colour to the tip.
                const fr = forkRs[k][0];
                const fy = fr ? slotY(m, fr) : yOf(m);
                const run = COL / 2;
                return (
                  <path
                    key={`f${m}`}
                    className={dim(
                      edgeLit([c.sha], row.forkShas[k]) ||
                        // this "fork" is really the line merging in and ending
                        (lineOwn !== null &&
                          lineOwn.has(row.forkShas[k]) &&
                          c.parents.length > 1 &&
                          c.parents.slice(1).includes(row.forkShas[k])),
                    )}
                    d={sweep(x, ncy, x - run, fy)}
                    fill="none"
                    stroke={fr ? routeColor(routes, fr) : NO_ROUTE}
                    strokeWidth={3}
                    strokeDasharray={fr ? routeDash(routes, fr) : undefined}
                  />
                );
              })}
              {/* hover tells you which commit this is; click opens it on
                  the Branches page */}
              <g
                className="rr-node"
                onClick={(e) => {
                  e.stopPropagation();
                  onClearHighlight();
                  setSel(sel === c.sha ? null : c.sha);
                }}
                role="button"
                aria-label={`Show ${c.subject}`}
              >
                <title>
                  {`${c.subject}\n${c.author_name} · ${new Date(c.date).toLocaleString()}`}
                </title>
                {c.is_head ? (
                  <g className={`gg-head ${dim(on, c.sha) ?? ""}`}>
                    <circle className="gg-halo" cx={x} cy={ncy} r={13} fill="var(--accent)" />
                    <circle cx={x} cy={ncy} r={8} fill="none" stroke="var(--accent)" strokeWidth={3} />
                    <circle cx={x} cy={ncy} r={4.2} fill="var(--accent)" />
                    {/* SVG text can't blur what's behind it, so the pill is HTML. */}
                    <foreignObject x={x - 50} y={ncy + 14} width={100} height={24}>
                      <div className="rr-herebox">
                        <span className="gg-youarehere">You are here</span>
                      </div>
                    </foreignObject>
                  </g>
                ) : focusStop !== null ? (
                  // One line is picked out: its stop shows in its own colour
                  // on its own strand, and the bar behind steps back.
                  <g className={dim(on, c.sha)}>
                    <circle cx={x} cy={ncy} r={11} fill="transparent" />
                    {junction && (
                      <g className="rr-dim">
                        <rect
                          x={x - 5}
                          y={bMin - 5}
                          width={10}
                          height={bMax - bMin + 10}
                          rx={5}
                          fill="var(--headbg)"
                          stroke={NO_ROUTE}
                          strokeWidth={3}
                        />
                        {/* The lines sharing the stop stay in the bar,
                            stepped back, so it still reads as a station
                            behind the lit dot. */}
                        {beads
                          .filter((b) => b.r !== focusLine)
                          .map(({ r, by }) => (
                            <circle
                              key={r}
                              cx={x}
                              cy={by}
                              r={2.2}
                              fill={routeColor(routes, r)}
                            />
                          ))}
                      </g>
                    )}
                    {sel === c.sha && (
                      <circle
                        className="gg-halo"
                        cx={x}
                        cy={focusStop}
                        r={11}
                        fill={routeColor(routes, focusLine!)}
                      />
                    )}
                    <circle
                      cx={x}
                      cy={focusStop}
                      r={tipName ? 6 : 5}
                      fill={routeColor(routes, focusLine!)}
                    />
                  </g>
                ) : junction ? (
                  // A stop several lines call at: a station bar across them
                  // all, with a bead of each line's own colour inside.
                  <g className={dim(on, c.sha)}>
                    <circle cx={x} cy={ncy} r={11} fill="transparent" />
                    {sel === c.sha && (
                      <rect
                        className="gg-halo"
                        x={x - 8}
                        y={bMin - 8}
                        width={16}
                        height={bMax - bMin + 16}
                        rx={8}
                        fill={NO_ROUTE}
                      />
                    )}
                    <rect
                      x={x - 5}
                      y={bMin - 5}
                      width={10}
                      height={bMax - bMin + 10}
                      rx={5}
                      fill="var(--headbg)"
                      stroke={NO_ROUTE}
                      strokeWidth={3}
                    />
                    {beads.map(({ r, by }) => (
                      <circle
                        key={r}
                        // A line that only passes along the lit stretch is
                        // not what the highlight is about; its bead steps
                        // back with its strand.
                        className={
                          litRoutes && !litRoutes.has(r) ? "rr-dim" : undefined
                        }
                        cx={x}
                        cy={by}
                        r={2.2}
                        fill={routeColor(routes, r)}
                      />
                    ))}
                  </g>
                ) : (
                  <>
                    {/* a roomier invisible target than the dot itself */}
                    <circle cx={x} cy={ncy} r={11} fill="transparent" />
                    {sel === c.sha && (
                      <circle className="gg-halo" cx={x} cy={ncy} r={11} fill={nodeColor} />
                    )}
                    {terminus ? (
                      // Where the line you are following ends: hollow, so it
                      // reads as "change here", not as the line carrying on.
                      <circle
                        className={dim(on, c.sha)}
                        cx={x}
                        cy={ncy}
                        r={tipName ? 6 : 5}
                        fill="var(--headbg)"
                        stroke={nodeColor}
                        strokeWidth={3}
                      />
                    ) : (
                      <circle
                        className={dim(on, c.sha)}
                        cx={x}
                        cy={ncy}
                        r={tipName ? 6 : 4.2}
                        fill={nodeColor}
                      />
                    )}
                  </>
                )}
              </g>
              {/* Every branch and tag stopping here gets its own label, and
                  a long name its own extra lines. Each line is a separate
                  slanted run starting from the same horizontal baseline, so
                  the block shears into a parallelogram rather than the lines
                  drifting off at right angles to the tilt. */}
              {(() => {
                let slot = 0;
                return tipNames.flatMap((name) => {
                  const lines = wrapName(name, LABEL_CHARS);
                  const fill = routes.repOf.has(name)
                    ? routeColor(routes, name)
                    : nodeColor;
                  const cls = `rr-label ${dim(labelLit(name)) ?? ""}`;
                  return lines.map((part, li) => {
                    // Anchors march straight across, never down the slant.
                    const lx = x + 4 + slot * LABEL_STEP;
                    slot += 1;
                    const last = li === lines.length - 1;
                    return (
                      <text
                        key={`${name}:${li}`}
                        className={cls}
                        x={lx}
                        y={labelY}
                        fill={fill}
                        transform={`rotate(-72 ${lx} ${labelY})`}
                      >
                        {part}
                        {last && (
                          <tspan className="rr-date" dx="6">
                            {forkOf.get(name)
                              ? `${shortDate(forkOf.get(name)! * 1000)}→${shortDate(c.date)}`
                              : shortDate(c.date)}
                          </tspan>
                        )}
                      </text>
                    );
                  });
                });
              })()}
            </g>
          );
        })}
      </svg>

      {/* The clicked change, next to its node. */}
      {selRow && (() => {
        const i = rows.indexOf(selRow);
        const x = xOf(i);
        const y = yOf(selRow.lane);
        const c = selRow.commit;
        const left = x < W / 2;
        const room = left ? W - (x - 8) : x + 8;
        const selRs = routes.bySha.get(c.sha) ?? [];
        const style: React.CSSProperties = {
          borderColor:
            selRs.length === 1 ? routeColor(routes, selRs[0]) : NO_ROUTE,
          maxWidth: Math.min(300, room - 4),
          ...(left ? { left: x - 8 } : { right: W - x - 8 }),
          ...(y < H / 2 ? { top: y + 16 } : { bottom: H - y + 16 }),
        };
        return (
          <RailCard
            commit={c}
            style={style}
            onOpen={() => {
              setSel(null);
              onOpenCommit(c.sha);
            }}
          />
        );
      })()}
      </div>
    </div>
  );
}

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
  const laid = useMemo(() => layoutGraph(graph.data ?? []), [graph.data]);
  const routes = useMemo(() => routeSets(graph.data ?? []), [graph.data]);
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
            <p className="muted chartcap">
              Each bar is one {RANGES[range].unit} of shared changes.
            </p>
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
