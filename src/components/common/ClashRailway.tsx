import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { getGraph, type GraphCommit } from "../../api";
import { formatDateTime } from "../../dates";
import { formatPerson, type Person } from "../../identity";
import { laneColor, layoutGraph } from "../history/HistoryPage";
import { githubAvatarFromEmail, UserAvatar } from "./UserAvatar";

// Branch name from a merge commit's subject line.
function mergedName(subject: string): string | null {
  const m =
    subject.match(/^Merge (?:remote-tracking )?branch '([^']+)'/) ??
    subject.match(/^Merge pull request #\d+ from [^/\s]+\/(\S+)/);
  return m ? m[1]! : null;
}

export interface ClashRow {
  commit: GraphCommit;
  /** 0 is ours, 1 is theirs, 2 and up are branches merged in along the way. */
  lane: number;
}

// `along`: whose lane the straight run follows. "child" = fork (bend at the
// parent), "parent" = merge-in (bend at the child).
export interface ClashEdge {
  child: string;
  parent: string;
  along: "child" | "parent";
  color: string;
  width: number;
}

export interface ClashLaid {
  rows: ClashRow[];
  laneCount: number;
  edges: ClashEdge[];
  /** Tip labels by sha. */
  tips: Record<string, string>;
  /** Merged-in branch names by the sha of their last commit. */
  minor: Record<string, string[]>;
  stubs: Set<string>;
  /** Merge commits of theirs into ours. */
  converge: Set<string>;
  /** No common ancestor at all. */
  unrelated: boolean;
  colorOf: (sha: string) => string;
  colors: { ours: string; theirs: string };
}

/**
 * Layout for the two branches being merged: ours on lane 0, theirs on
 * lane 1 back to the fork, anything merged into either as a short stub.
 */
export function clashLayout(
  all: GraphCommit[],
  ours: string,
  theirs: string,
  at?: { ours: string; theirs: string; merge?: string },
): ClashLaid | null {
  const bySha = new Map(all.map((c) => [c.sha, c]));
  const index = new Map(all.map((c, i) => [c.sha, i]));
  const isName = (r: string, name: string) =>
    r === name || r === `origin/${name}`;
  const tipOf = (name: string, sha?: string) =>
    sha
      ? all.find((c) => c.sha === sha)
      : all.find((c) => c.refs.some((r) => isName(r, name)));
  const a = tipOf(ours, at?.ours);
  const b = tipOf(theirs, at?.theirs);
  if (!a || !b) return null;

  const behind = (tip: string) => {
    const seen = new Set<string>();
    const todo = [tip];
    while (todo.length) {
      const sha = todo.pop()!;
      if (seen.has(sha)) continue;
      seen.add(sha);
      for (const p of bySha.get(sha)?.parents ?? []) todo.push(p);
    }
    return seen;
  };
  const fromA = behind(a.sha);
  const fromB = behind(b.sha);

  // Fork = where the two first-parent chains meet. Using all ancestors
  // instead can drag the picture back to the root commit.
  const chain = (tip: string) => {
    const out: string[] = [];
    const seen = new Set<string>();
    let sha: string | undefined = tip;
    while (sha && bySha.has(sha) && !seen.has(sha)) {
      out.push(sha);
      seen.add(sha);
      sha = bySha.get(sha)?.parents[0];
    }
    return out;
  };
  const chainA = chain(a.sha);
  const chainB = chain(b.sha);
  const inA = new Set(chainA);
  const forkSha = chainB.find((sha) => inA.has(sha));
  // No common ancestor: show the last few commits of each, unjoined.
  const unrelated = !forkSha && ![...fromA].some((s) => fromB.has(s));
  const UNRELATED_REACH = 6;
  const fork = forkSha
    ? (index.get(forkSha) ?? all.length - 1)
    : unrelated
      ? Math.max(
          index.get(chainA[Math.min(chainA.length, UNRELATED_REACH) - 1]) ?? 0,
          index.get(chainB[Math.min(chainB.length, UNRELATED_REACH) - 1]) ?? 0,
        )
      : Math.max(index.get(a.sha) ?? 0, index.get(b.sha) ?? 0);
  const keep = new Set(
    [...fromA, ...fromB].filter((s) => (index.get(s) ?? Infinity) <= fork),
  );
  if (unrelated) {
    const shown = new Set([
      ...chainA.slice(0, UNRELATED_REACH),
      ...chainB.slice(0, UNRELATED_REACH),
    ]);
    for (const s of [...keep]) if (!shown.has(s)) keep.delete(s);
  }
  // Merge commit of a merge that already happened; not behind either tip.
  const merge = at?.merge && bySha.has(at.merge) ? at.merge : undefined;
  if (merge) keep.add(merge);

  // Theirs stays theirs even after ours has merged it in.
  const onOurs = new Set(chainA.filter((s) => keep.has(s)));
  if (merge) onOurs.add(merge);
  const onTheirs = new Set(chainB.filter((s) => keep.has(s) && !onOurs.has(s)));
  const main = new Set([...onOurs, ...onTheirs]);
  const stubs = new Set<string>();
  for (const sha of main) {
    for (const p of bySha.get(sha)?.parents.slice(1) ?? []) {
      if (keep.has(p) && !main.has(p)) stubs.add(p);
    }
  }
  const shown = new Set([...main, ...stubs]);
  const commits = all.filter((c) => shown.has(c.sha));
  const col = new Map(commits.map((c, i) => [c.sha, i]));

  // Stubs pack onto lanes >= 2 where their spans don't overlap.
  const lane = new Map<string, number>();
  for (const sha of onOurs) lane.set(sha, 0);
  for (const sha of onTheirs) lane.set(sha, 1);
  const spans: { lo: number; hi: number }[][] = [];
  for (const c of commits) {
    if (!stubs.has(c.sha)) continue;
    const mergeCol = Math.min(
      ...commits
        .filter((m) => m.parents.slice(1).includes(c.sha))
        .map((m) => col.get(m.sha)!),
    );
    const span = { lo: mergeCol, hi: col.get(c.sha)! };
    let j = 0;
    while (spans[j]?.some((s) => s.lo <= span.hi && span.lo <= s.hi)) j++;
    (spans[j] ??= []).push(span);
    lane.set(c.sha, 2 + j);
  }
  const laneCount = 2 + spans.length;

  // Same colours as the Branches page.
  const fullLane = new Map(
    layoutGraph(all).rows.map((r) => [r.commit.sha, r.lane]),
  );
  const colors = {
    ours: laneColor(fullLane.get(a.sha) ?? 0),
    theirs: laneColor(fullLane.get(b.sha) ?? 1),
  };
  const colorOf = (sha: string) =>
    stubs.has(sha)
      ? laneColor(fullLane.get(sha) ?? 0)
      : onTheirs.has(sha)
        ? colors.theirs
        : colors.ours;

  const edges: ClashEdge[] = [];
  for (const c of commits) {
    if (stubs.has(c.sha)) continue;
    for (const p of c.parents) {
      if (!shown.has(p)) continue;
      const lc = lane.get(c.sha)!;
      const lp = lane.get(p)!;
      const along = lc < lp ? "parent" : "child";
      const owner = along === "child" ? c.sha : p;
      edges.push({
        child: c.sha,
        parent: p,
        along,
        color: colorOf(owner),
        width: stubs.has(owner) ? 1.6 : 3,
      });
    }
  }

  const converge = new Set(
    commits
      .filter((c) => onOurs.has(c.sha) && c.parents.some((p) => onTheirs.has(p)))
      .map((c) => c.sha),
  );

  const tips: Record<string, string> = { [a.sha]: ours };
  tips[b.sha] = tips[b.sha] ? `${tips[b.sha]}, ${theirs}` : theirs;
  if (merge) tips[merge] = "merged";

  const minor: Record<string, string[]> = {};
  for (const c of commits) {
    if (tips[c.sha]) continue;
    const own = c.refs
      .filter((r) => r !== "HEAD" && r !== "origin/HEAD" && !r.startsWith("tag: "))
      .map((r) => (r.startsWith("origin/") ? r.slice(7) : r))
      .filter((r) => r !== ours && r !== theirs);
    if (own.length) minor[c.sha] = [...new Set(own)];
  }
  for (const c of commits) {
    const from = c.parents[1];
    const name = mergedName(c.subject);
    if (from && name && !tips[from] && !minor[from] && name !== ours && name !== theirs) {
      minor[from] = [name];
    }
  }

  return {
    rows: commits.map((c) => ({ commit: c, lane: lane.get(c.sha)! })),
    laneCount,
    edges,
    tips,
    minor,
    stubs,
    converge,
    unrelated,
    colorOf,
    colors,
  };
}

export function useClashLayout(
  ours: string,
  theirs: string,
  at?: { ours: string; theirs: string; merge?: string },
) {
  const graph = useQuery({
    queryKey: ["graph"],
    queryFn: getGraph,
    staleTime: 60_000,
  });
  // Depend on the shas, not the object (hosts rebuild it every render).
  const atOurs = at?.ours;
  const atTheirs = at?.theirs;
  const atMerge = at?.merge;
  const laid = useMemo(
    () =>
      clashLayout(
        graph.data ?? [],
        ours,
        theirs,
        atOurs && atTheirs
          ? { ours: atOurs, theirs: atTheirs, merge: atMerge }
          : undefined,
      ),
    [graph.data, ours, theirs, atOurs, atTheirs, atMerge],
  );
  return { laid, loading: graph.isLoading };
}

/** The SVG alone, no fetching; also used by the offline render harness. */
export function RailDrawing({
  laid,
  ours,
  theirs,
  lit,
  people,
  onOpenCommit,
  preview,
}: {
  laid: ClashLaid;
  ours: string;
  theirs: string;
  lit: Set<string> | null;
  people?: Map<string, Person>;
  onOpenCommit?: (sha: string) => void;
  /** Nothing merged yet: sketch where the merge would land, dotted. */
  preview?: boolean;
}) {
  const { rows, laneCount, edges, tips, minor, colorOf, stubs, converge } = laid;
  const ourTip = Object.keys(tips).find((sha) => tips[sha] === ours);
  const theirTip = Object.keys(tips).find((sha) => tips[sha] === theirs);
  const ghost =
    !!preview && converge.size === 0 && !laid.unrelated && !!ourTip && !!theirTip && ourTip !== theirTip;
  const COL = 44;
  const LANE = 30;
  const NOTE = lit ? 104 : 0; // room for the lit-commit card
  const stacked = Math.max(0, ...Object.values(minor).map((n) => n.length));
  const TOP = 22 + NOTE + Math.max(0, stacked - 1) * 10;
  const longest = Math.max(0, ...Object.values(minor).flat().map((n) => n.length));
  const PAD = Math.max(24, longest * 3 + 8);
  const RIGHT = 16;
  const H = TOP + laneCount * LANE + 30 + NOTE;
  const yOf = (l: number) => TOP + l * LANE;
  // With the ghost merge drawn, the tip names move under their nodes and the
  // room on the right only has to fit the ghost and its label.
  const labelRoom = ghost ? 130 : 7 * Math.max(ours.length, theirs.length) + 20;
  const W = PAD + rows.length * COL + labelRoom + RIGHT;
  const colOf = new Map(rows.map((r, i) => [r.commit.sha, i]));
  const xOf = (i: number) => W - RIGHT - labelRoom - i * COL - COL / 2;
  const xy = (sha: string) => {
    const i = colOf.get(sha)!;
    return { x: xOf(i), y: yOf(rows[i]!.lane) };
  };
  const shortDate = (d: string) =>
    new Date(d).toLocaleDateString(undefined, { month: "numeric", day: "numeric" });

  // A tip with a child has a line where its label would go; label goes under.
  const hasChild = new Set([
    ...edges.map((e) => e.parent),
    ...(ghost ? [ourTip!, theirTip!] : []),
  ]);

  const on = (sha: string) => lit === null || lit.has(sha);
  const dim = (bright: boolean) => (bright ? undefined : "rr-dim");
  const rail = dim(lit === null);

  return (
    <div className="railstage" style={{ width: W, height: H }}>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="branchrail"
        role="img"
        aria-label={`${ours} and ${theirs}, back to where they parted`}
      >
        {rows.map((row, i) => {
          const d = shortDate(row.commit.date);
          const newer = i > 0 ? shortDate(rows[i - 1]!.commit.date) : null;
          if (d === newer) return null;
          const x = xOf(i);
          return (
            <g key={`t${row.commit.sha}`}>
              <line x1={x} y1={H - 24} x2={x} y2={H - 18} stroke="var(--border)" strokeWidth={2} />
              <text className="rr-date" x={x} y={H - 6} textAnchor="middle">
                {d}
              </text>
            </g>
          );
        })}

        {edges.map((e) => {
          const c = xy(e.child);
          const p = xy(e.parent);
          const points =
            c.y === p.y
              ? `${c.x},${c.y} ${p.x},${p.y}`
              : e.along === "child"
                ? `${c.x},${c.y} ${p.x + COL / 2},${c.y} ${p.x},${p.y}`
                : `${c.x},${c.y} ${c.x - COL / 2},${p.y} ${p.x},${p.y}`;
          return (
            <polyline
              key={`${e.child}-${e.parent}`}
              className={rail}
              points={points}
              fill="none"
              stroke={e.color}
              strokeWidth={e.width}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}

        {ghost && (() => {
          const o = xy(ourTip!);
          const t = xy(theirTip!);
          const xg = xOf(0) + COL;
          return (
            <g className={`rr-ghost ${rail ?? ""}`} aria-label="Where the merge would land">
              <line
                className="rr-ghostline"
                x1={o.x} y1={o.y} x2={xg} y2={o.y}
                stroke={colorOf(ourTip!)} strokeWidth={2} strokeLinecap="round"
              />
              <polyline
                className="rr-ghostline"
                points={`${t.x},${t.y} ${xg - COL / 2},${t.y} ${xg},${o.y}`}
                fill="none" stroke={colorOf(theirTip!)} strokeWidth={2}
                strokeLinecap="round" strokeLinejoin="round"
              />
              <circle className="bd-comet" r={2.6}>
                <animateMotion
                  dur="2.2s"
                  repeatCount="indefinite"
                  path={`M ${t.x},${t.y} L ${xg - COL / 2},${t.y} L ${xg},${o.y}`}
                />
              </circle>
              <circle className="bd-comet" r={2.6}>
                <animateMotion
                  dur="2.2s"
                  repeatCount="indefinite"
                  path={`M ${o.x},${o.y} L ${xg},${o.y}`}
                />
              </circle>
              <circle cx={xg} cy={o.y} r={6} fill="none" stroke="var(--accent)" strokeWidth={2} strokeDasharray="2 2.5" />
              <text className="rr-label" x={xg + 12} y={o.y + 4.5} fill="var(--accent)">
                after merging
              </text>
            </g>
          );
        })()}

        {rows.map((row, i) => {
          const x = xOf(i);
          const y = yOf(row.lane);
          const c = row.commit;
          const tip = tips[c.sha];
          const small = minor[c.sha];
          const isLit = lit?.has(c.sha) ?? false;
          const person = people?.get(c.sha);
          const who = person ? formatPerson(person.name, person.login) : c.author_name;
          const above = row.lane === 0;
          return (
            <g key={c.sha}>
              {!stubs.has(c.sha) && (
                <g
                  className={`rr-node${onOpenCommit ? "" : " still"}`}
                  onClick={() => onOpenCommit?.(c.sha)}
                  role={onOpenCommit ? "button" : undefined}
                  aria-label={`Open ${c.subject} in Branches`}
                >
                  <title>
                    {`${c.subject}\n${who} · ${new Date(c.date).toLocaleString()}`}
                  </title>
                  <circle cx={x} cy={y} r={11} fill="transparent" />
                  {(isLit || converge.has(c.sha)) && (
                    <circle
                      className="gg-halo"
                      cx={x}
                      cy={y}
                      r={11}
                      fill={converge.has(c.sha) ? "var(--accent)" : colorOf(c.sha)}
                    />
                  )}
                  <circle
                    className={dim(on(c.sha))}
                    cx={x}
                    cy={y}
                    r={tip ? 6 : 4.2}
                    fill={converge.has(c.sha) ? "var(--accent)" : colorOf(c.sha)}
                  />
                </g>
              )}
              {tip && converge.has(c.sha) && (
                <foreignObject x={x + 10} y={y - 12} width={90} height={24}>
                  <div className="rr-herebox left">
                    <span className="gg-youarehere">{tip}</span>
                  </div>
                </foreignObject>
              )}
              {tip && !converge.has(c.sha) && !hasChild.has(c.sha) && (
                <text
                  className={`rr-label ${rail ?? ""}`}
                  x={x + 12}
                  y={y + 4.5}
                  fill={colorOf(c.sha)}
                >
                  {tip}
                </text>
              )}
              {tip && hasChild.has(c.sha) && (
                <text
                  className={`rr-label ${rail ?? ""}`}
                  x={x + 12}
                  y={above ? y - 12 : y + 20}
                  fill={colorOf(c.sha)}
                >
                  {tip}
                </text>
              )}
              {small && !tip && (
                <text
                  className={`rr-minor ${rail ?? ""}`}
                  x={x}
                  y={above ? y - 10 - (small.length - 1) * 10 : y + 16}
                  textAnchor="middle"
                  fill={colorOf(c.sha)}
                >
                  {small.map((name, k) => (
                    <tspan key={name} x={x} dy={k === 0 ? 0 : 10}>
                      {name}
                    </tspan>
                  ))}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Lit-commit cards: above lane 0, below the rest, away from the nearer edge. */}
      {lit &&
        rows.map((row, i) => {
          const c = row.commit;
          if (!lit.has(c.sha)) return null;
          const x = xOf(i);
          const y = yOf(row.lane);
          const above = row.lane === 0;
          const left = x < W / 2;
          const person = people?.get(c.sha);
          const who = person ? formatPerson(person.name, person.login) : c.author_name;
          // A card can't be scrolled to if it pokes out past the left edge,
          // so never let it be wider than the room on its side.
          const room = left ? W - (x - 8) : x + 8;
          const style: React.CSSProperties = {
            borderColor: colorOf(c.sha),
            maxWidth: Math.min(300, room - 4),
            ...(left ? { left: x - 8 } : { right: W - x - 8 }),
            ...(above ? { bottom: H - y + 12 } : { top: y + 12 }),
          };
          return (
            <div key={`n${c.sha}`} className="rr-card" style={style}>
              <div className="rr-cardsubject">{c.subject}</div>
              <div className="rr-cardwho muted small">
                <UserAvatar
                  url={person?.avatarUrl ?? githubAvatarFromEmail(c.author_email)}
                  name={who}
                  size={16}
                />
                <span>{who}</span>
              </div>
              <div className="rr-cardwhen muted small">{formatDateTime(c.date)}</div>
            </div>
          );
        })}
    </div>
  );
}

/**
 * Railway of the two branches being merged, newest at the right. `lit`
 * keeps only those commits bright and shows their details.
 */
export function ClashRailway({
  ours,
  theirs,
  lit,
  people,
  onOpenCommit,
  at,
}: {
  ours: string;
  theirs: string;
  lit: Set<string> | null;
  at?: { ours: string; theirs: string; merge?: string };
  people?: Map<string, Person>;
  onOpenCommit?: (sha: string) => void;
}) {
  const { laid, loading } = useClashLayout(ours, theirs, at);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [laid?.rows.length]);

  // Bring the lit commits into view; they may be far to the left.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !lit) return;
    const cards = Array.from(el.querySelectorAll<HTMLElement>(".rr-card"));
    if (cards.length === 0) return;
    const first = Math.min(...cards.map((c) => c.offsetLeft));
    const last = Math.max(...cards.map((c) => c.offsetLeft + c.offsetWidth));
    if (first < el.scrollLeft) el.scrollLeft = Math.max(0, first - 12);
    else if (last > el.scrollLeft + el.clientWidth) el.scrollLeft = last - el.clientWidth + 12;
  }, [lit]);

  if (loading) {
    return <p className="muted small">Reading the branches…</p>;
  }
  if (!laid) return null;

  return (
    <div className="railscroll clashrail" ref={scrollRef}>
      <RailDrawing
        laid={laid}
        ours={ours}
        theirs={theirs}
        lit={lit}
        people={people}
        onOpenCommit={onOpenCommit}
        preview={!at}
      />
    </div>
  );
}
