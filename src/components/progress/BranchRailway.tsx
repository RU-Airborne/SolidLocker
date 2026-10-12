/**
 * The railway: every branch and every merge on one map, newest at the right.
 *
 * Lifted out of the Insights page so the phone app can draw the same map
 * rather than an approximation of it. Nothing about it changed in the move:
 * the lanes, the strand offsets, the eased crossings and the station bars are
 * the ones that were already there, and both apps now render this one
 * component.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import {
  computeLaneSlots,
  crossPath,
  edgeRoutesOf,
  layoutGraph,
  routeColor,
  routeDash,
  type RouteMap,
  RAIL_W_THIN,
  paint,
  mergeStretchOf,
} from "../history/HistoryPage";
import type { BranchSummary } from "../../types";
import { RailCard } from "../common/RailCard";

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

const NO_ROUTE = "var(--muted)";
function sweep(x0: number, y0: number, x1: number, y1: number): string {
  return crossPath(y0, x0, y1, x1, "x");
}

// How much horizontal run a crossing gets.
// function runFor(dy: number, col: number): number {
//   return Math.min(col * 1.5, Math.max(col, Math.abs(dy) * 0.45));
// }

/** Gap between the stacked labels at a commit several branches stop at. */
const LABEL_STEP = 18;
/** How many characters fit on one line of a slanted label. */
const LABEL_CHARS = 14;

export function BranchRailway({
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
  const TOP = 224;
  const PAD = 36;
  const RIGHT = 80;
  const positions = useMemo(() => {
    const labelSlots = rows.map(({ commit: c }) =>
      [...new Set(c.refs
        .filter((r) => r !== "HEAD" && r !== "origin/HEAD")
        .map((r) => r.startsWith("origin/") ? r.slice(7) : r))]
        .filter((n) => !routes.repOf.has(n) || (routes.tipOf.get(c.sha) ?? []).includes(n))
        .reduce((count, name) => count + wrapName(name, LABEL_CHARS).length, 0),
    );
    const xs = Array<number>(rows.length);
    let nextX = PAD + COL / 2;
    for (let i = rows.length - 1; i >= 0; i--) {
      xs[i] = nextX;
      nextX += Math.max(COL, labelSlots[i] * LABEL_STEP + 8);
    }
    return xs;
  }, [rows, routes]);
  const W = (positions[0] ?? PAD - COL / 2) + PAD + RIGHT + COL / 2;
  // extra room under the lanes for the timeline
  const H = TOP + laneCount * LANE + 46;
  const shortDate = (d: string | number) =>
    new Date(d).toLocaleDateString(undefined, {
      month: "numeric",
      day: "numeric",
    });
  const forkOf = new Map(branches.map((b) => [b.name, b.forked_at]));
  const yOf = (l: number) => TOP + l * LANE;
  const xOf = (i: number) => positions[i];

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
  const mergeStretch = useMemo(
    () =>
      sel && (routes.bySha.get(sel) ?? []).length === 0
        ? mergeStretchOf(rows, routes, sel)
        : null,
    [sel, routes, rows],
  );
  const line = mergeStretch ?? selLine ?? hl;
  const lineOwn = mergeStretch ?? selOwn ?? hlOwn;

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
    const right = positions[newest];
    const left = positions[oldest];
    const middle = (left + right) / 2;
    const most = Math.max(0, el.scrollWidth - el.clientWidth);
    el.scrollTo({
      left: Math.min(most, Math.max(0, middle - el.clientWidth / 2)),
      behavior: "smooth",
    });
  }, [highlight, hl, rows, positions]);
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
          const xr = i > 0 ? (x + xOf(i - 1)) / 2 : x + COL / 2;
          const xl = i < rows.length - 1 ? (x + xOf(i + 1)) / 2 : x - COL / 2;
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
          const belowY = (lane: number) => {
            const bi = row.below.indexOf(lane);
            const rs =
              bi < 0
                ? []
                : edgeRoutesOf(
                    routes,
                    row.belowChilds[bi] ?? [],
                    row.belowShas[bi],
                  );
            const ys = rs.map((r) => slotY(lane, r));
            return ys.length
              ? (Math.min(...ys) + Math.max(...ys)) / 2
              : yOf(lane);
          };
          const towards = (sha: string | undefined) => {
            const seen = new Set<string>();
            let at = sha;
            while (at && !seen.has(at)) {
              seen.add(at);
              const r = (routes.bySha.get(at) ?? [])[0];
              if (r) return routeColor(routes, r);
              at = routes.firstParent.get(at);
            }
            return undefined;
          };
          const strands = (
            lane: number,
            rs: string[],
            fallback: number,
            toward?: string,
          ): {
            y: number;
            color: string;
            dash?: string;
            cls?: string;
            width?: number;
          }[] => {
            if (rs.length === 0)
              return [
                {
                  y: fallback,
                  color: towards(toward) ?? NO_ROUTE,
                  width: RAIL_W_THIN,
                },
              ];
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
            nodeRs.length === 1
              ? routeColor(routes, nodeRs[0])
              : nodeRs.length === 0
                ? (towards(c.sha) ?? NO_ROUTE)
                : NO_ROUTE;
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
          const contRs = row.continues
            ? edgeRoutesOf(routes, [c.sha], c.parents[0] ?? "").filter((r) =>
                sl.get(row.lane)?.has(r),
              )
            : nodeRs;
          const callingRs = [
            ...new Set(joinRs.flat()),
            ...restingRs,
          ].filter((r, i, a) => !nodeRs.includes(r) && a.indexOf(r) === i);
          const beads = [
            ...nodeRs.map((r) => ({ r, by: slotY(row.lane, r) })),
              // A line that ends here is packed outside the running ones.
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
                  {strands(j, passRs[k], yOf(j), row.passShas[k]).map((s) => (
                    <line
                      key={s.y}
                      className={s.cls}
                      x1={xl}
                      y1={s.y}
                      x2={xr}
                      y2={s.y}
                      stroke={paint(s.color)}
                      strokeWidth={s.width ?? 3}
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
                  {strands(row.lane, topRs, ncy, c.sha).map((s) => (
                    <line
                      key={s.y}
                      className={s.cls}
                      x1={x}
                      y1={s.y}
                      x2={xr}
                      y2={s.y}
                      stroke={paint(s.color)}
                      strokeWidth={s.width ?? 3}
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
                    const run = xr - x;
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
                        stroke={paint(
                          r
                            ? routeColor(routes, r)
                            : (towards(c.sha) ?? NO_ROUTE)
                        )}
                        strokeWidth={r ? 3 : RAIL_W_THIN}
                        strokeDasharray={r ? routeDash(routes, r) : undefined}
                      />
                    );
                  })}
                </g>
              ))}
              {row.continues && (
                <g className={dim(contLit)}>
                  {strands(row.lane, contRs, ncy, c.parents[0]).map((s) => (
                    <line
                      key={s.y}
                      className={s.cls}
                      x1={x}
                      y1={s.y}
                      x2={xl}
                      y2={s.y}
                      stroke={paint(s.color)}
                      strokeWidth={s.width ?? 3}
                      strokeDasharray={s.dash}
                    />
                  ))}
                </g>
              )}
              {row.forks.map((m, k) => {
                // The stretch running into where a line ends belongs to that
                // line, so the connector wears its colour to the tip.
                const fr = forkRs[k][0];
                const fy = fr ? slotY(m, fr) : belowY(m);
                const run = x - xl;
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
                    stroke={paint(
                      fr
                        ? routeColor(routes, fr)
                        : (towards(row.forkShas[k]) ?? NO_ROUTE)
                    )}
                    strokeWidth={fr ? 3 : RAIL_W_THIN}
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
                    {junction ? (
                      <>
                        <rect className="gg-halo" x={x - 13} y={bMin - 13} width={26} height={bMax - bMin + 26} rx={13} fill="var(--accent)" />
                        <rect x={x - 9} y={bMin - 9} width={18} height={bMax - bMin + 18} rx={9} fill="none" stroke="var(--accent)" strokeWidth={3} />
                        <rect x={x - 5} y={bMin - 5} width={10} height={bMax - bMin + 10} rx={5} fill="var(--headbg)" stroke={paint(NO_ROUTE)} strokeWidth={3} />
                        {beads.map(({ r, by }) => (
                          <circle key={r} cx={x} cy={by} r={2.2} fill={paint(routeColor(routes, r))} />
                        ))}
                      </>
                    ) : (
                      <>
                        <circle className="gg-halo" cx={x} cy={ncy} r={13} fill="var(--accent)" />
                        <circle cx={x} cy={ncy} r={8} fill="none" stroke="var(--accent)" strokeWidth={3} />
                        <circle cx={x} cy={ncy} r={4.2} fill="var(--accent)" />
                      </>
                    )}
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
                          stroke={paint(NO_ROUTE)}
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
                              fill={paint(routeColor(routes, r))}
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
                        fill={paint(routeColor(routes, focusLine!))}
                      />
                    )}
                    <circle
                      cx={x}
                      cy={focusStop}
                      r={tipName ? 6 : 5}
                      fill={paint(routeColor(routes, focusLine!))}
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
                        fill={paint(NO_ROUTE)}
                      />
                    )}
                    <rect
                      x={x - 5}
                      y={bMin - 5}
                      width={10}
                      height={bMax - bMin + 10}
                      rx={5}
                      fill="var(--headbg)"
                      stroke={paint(NO_ROUTE)}
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
                        fill={paint(routeColor(routes, r))}
                      />
                    ))}
                  </g>
                ) : (
                  <>
                    {/* a roomier invisible target than the dot itself */}
                    <circle cx={x} cy={ncy} r={11} fill="transparent" />
                    {sel === c.sha && (
                      <circle className="gg-halo" cx={x} cy={ncy} r={11} fill={paint(nodeColor)} />
                    )}
                    {terminus && sel !== c.sha ? (
                      // Where the line you are following ends: hollow, so it
                      // reads as "change here", not as the line carrying on.
                      <circle
                        className={dim(on, c.sha)}
                        cx={x}
                        cy={ncy}
                        r={tipName ? 6 : 5}
                        fill="var(--headbg)"
                        stroke={paint(nodeColor)}
                        strokeWidth={3}
                      />
                    ) : (
                      <circle
                        className={dim(on, c.sha)}
                        cx={x}
                        cy={ncy}
                        r={tipName ? 6 : 4.2}
                        fill={paint(nodeColor)}
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
                        fill={paint(fill)}
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
