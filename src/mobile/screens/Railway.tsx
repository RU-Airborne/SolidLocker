import { useMemo, useState } from "react";

import type { GraphCommit } from "../api";
import { useGraph } from "../queries";
import { BranchName, Empty, Spinner, Trouble, UserAvatar } from "../components";
import { laneColor, LANE_COUNT } from "../../lanes";
import { formatChanged } from "../../dates";

/**
 * The railway, turned on its side.
 *
 * The desktop draws this map wide, because it has the room: history runs left
 * to right and branches stack downwards. A phone has no width to give and
 * unlimited height, so here the history runs down the page and the branches
 * stack across. Same map, rotated to fit the paper.
 *
 * What it is NOT is a copy of the desktop layout squeezed into 400 pixels.
 * Sixteen lanes across a phone would be four pixels each and unreadable.
 */

const ROW = 56;
const LANE_W = 14;
const RAIL_LEFT = 14;
const DOT = 4.5;

interface Placed {
  commit: GraphCommit;
  lane: number;
  row: number;
}

interface Rails {
  placed: Placed[];
  laneCount: number;
  /** Lane -> the branch whose tip opened it, when a branch did. */
  ownerOf: Map<number, string>;
  rowOf: Map<string, number>;
  laneOf: Map<string, number>;
}

/**
 * Standard lane packing, newest first: a commit takes the lane that was
 * waiting for it, its first parent carries that lane onward, and any other
 * parent opens a lane of its own. A lane nobody is waiting on is free again.
 */
function layout(commits: GraphCommit[]): Rails {
  // What each lane is expecting to see next, by sha. Empty means free.
  const expecting: (string | null)[] = [];
  const placed: Placed[] = [];
  const ownerOf = new Map<number, string>();
  const rowOf = new Map<string, number>();
  const laneOf = new Map<string, number>();

  const take = (sha: string): number => {
    const waiting = expecting.indexOf(sha);
    if (waiting !== -1) return waiting;
    const free = expecting.indexOf(null);
    if (free !== -1) return free;
    expecting.push(null);
    return expecting.length - 1;
  };

  commits.forEach((commit, row) => {
    const lane = take(commit.sha);
    expecting[lane] = null;

    // A branch tip names the line it starts, which is what lets the rail be
    // drawn in the same colour as the branch's name in the text.
    if (commit.refs.length > 0 && !ownerOf.has(lane)) {
      ownerOf.set(lane, commit.refs[0]!);
    }

    placed.push({ commit, lane, row });
    rowOf.set(commit.sha, row);
    laneOf.set(commit.sha, lane);

    commit.parents.forEach((parent, i) => {
      if (i === 0) {
        // The first parent is the same line of work continuing.
        expecting[lane] = parent;
        return;
      }
      // Anything merged in arrives on a line of its own, unless some lane is
      // already waiting for it.
      if (!expecting.includes(parent)) {
        const spare = take(parent);
        expecting[spare] = parent;
        if (ownerOf.has(lane) && !ownerOf.has(spare)) {
          // Nothing names it yet; it stays neutral until a tip claims it.
        }
      }
    });
  });

  return {
    placed,
    laneCount: Math.max(1, expecting.length),
    ownerOf,
    rowOf,
    laneOf,
  };
}

/** Same hash the branch names use, so a rail and its name match. */
function hueOf(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % LANE_COUNT;
}

function colourOf(rails: Rails, lane: number, defaultBranch: string): string {
  const owner = rails.ownerOf.get(lane);
  if (!owner) {
    // History behind a deleted branch, or the far side of a merge. Track with
    // no line on it: never a hue that would read as somebody's branch.
    return "var(--muted)";
  }
  return owner === defaultBranch ? laneColor(0) : laneColor(hueOf(owner));
}

export function Railway({
  defaultBranch,
  onPick,
}: {
  defaultBranch: string;
  onPick?: (sha: string) => void;
}) {
  const graph = useGraph(true);
  const [open, setOpen] = useState<string | null>(null);

  const rails = useMemo(() => layout(graph.data ?? []), [graph.data]);

  if (graph.isLoading) return <Spinner label="Drawing the railway…" />;
  if (graph.isError) {
    return <Trouble error={graph.error} onRetry={() => graph.refetch()} />;
  }
  if (rails.placed.length === 0) {
    return <Empty title="No history yet" />;
  }

  const railWidth = RAIL_LEFT * 2 + (rails.laneCount - 1) * LANE_W;
  const height = rails.placed.length * ROW;
  const x = (lane: number) => RAIL_LEFT + lane * LANE_W;
  const y = (row: number) => row * ROW + ROW / 2;

  return (
    <div className="m-railway" style={{ ["--rail-w" as string]: `${railWidth}px` }}>
      <svg
        className="m-rail"
        width={railWidth}
        height={height}
        viewBox={`0 0 ${railWidth} ${height}`}
        aria-hidden="true"
      >
        {rails.placed.map(({ commit, lane, row }) =>
          commit.parents.map((parent, i) => {
            const parentRow = rails.rowOf.get(parent);
            if (parentRow === undefined) {
              // The parent is older than anything we asked for. Show the line
              // leaving the bottom rather than stopping dead.
              if (i > 0) return null;
              return (
                <path
                  key={`${commit.sha}-off`}
                  d={`M ${x(lane)} ${y(row)} L ${x(lane)} ${height}`}
                  stroke={colourOf(rails, lane, defaultBranch)}
                  strokeWidth={2}
                  fill="none"
                  opacity={0.45}
                />
              );
            }
            const parentLane = rails.laneOf.get(parent) ?? lane;
            const [x1, y1] = [x(lane), y(row)];
            const [x2, y2] = [x(parentLane), y(parentRow)];
            // A straight drop when it stays in its lane; a shoulder when it
            // moves across, curved so two lines crossing stay tellable apart.
            const d =
              lane === parentLane
                ? `M ${x1} ${y1} L ${x2} ${y2}`
                : `M ${x1} ${y1} C ${x1} ${y1 + ROW * 0.55}, ${x2} ${y2 - ROW * 0.55}, ${x2} ${y2}`;
            return (
              <path
                key={`${commit.sha}-${parent}`}
                d={d}
                stroke={colourOf(rails, i === 0 ? lane : parentLane, defaultBranch)}
                strokeWidth={2}
                fill="none"
              />
            );
          }),
        )}

        {rails.placed.map(({ commit, lane, row }) => (
          <circle
            key={commit.sha}
            cx={x(lane)}
            cy={y(row)}
            r={commit.refs.length > 0 ? DOT + 1.5 : DOT}
            fill={
              commit.refs.length > 0
                ? colourOf(rails, lane, defaultBranch)
                : "var(--menubg)"
            }
            stroke={colourOf(rails, lane, defaultBranch)}
            strokeWidth={2}
          />
        ))}
      </svg>

      <ol className="m-stops">
        {rails.placed.map(({ commit, lane }) => (
          <li key={commit.sha} style={{ height: ROW }}>
            <button
              className="m-stop"
              onClick={() => {
                setOpen(open === commit.sha ? null : commit.sha);
                onPick?.(commit.sha);
              }}
            >
              <span className="m-stop-main">
                <span className="m-stop-subject">{commit.subject}</span>
                <span className="m-stop-meta muted small">
                  {commit.refs.length > 0 && (
                    <span className="m-stop-refs">
                      {commit.refs.map((ref) => (
                        <BranchName
                          key={ref}
                          name={ref}
                          isDefault={ref === defaultBranch}
                        />
                      ))}
                    </span>
                  )}
                  {commit.author_login || commit.author_name}
                  {commit.at > 0 && ` · ${formatChanged(commit.at * 1000)}`}
                </span>
              </span>
              <UserAvatar
                url={commit.author_avatar || null}
                name={commit.author_name || commit.author_login}
                size={24}
              />
            </button>
            {open === commit.sha && (
              <span className="m-stop-sha muted small">
                {commit.sha.slice(0, 8)} · lane {lane + 1}
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
