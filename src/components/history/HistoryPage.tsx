import { StatusMark } from "../common/StatusMark";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";

import {
  deleteBranch,
  getBranchOverview,
  getCommitFiles,
  getGraph,
  type GraphCommit,
} from "../../api";
import { isAppError } from "../../types";
import { BranchName } from "../common/BranchName";
import { formatDate, formatDateTime } from "../../dates";
import {
  BranchGlyph,
  EyeGlyph,
  MergeGlyph,
  RestoreGlyph,
  TrashGlyph,
} from "../common/HistoryDiagrams";
import type { VersionRef } from "../dialogs/RestoreVersionDialog";
import { githubAvatarFromEmail, UserAvatar } from "../common/UserAvatar";
import { Loading } from "../common/Loading";
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
  belowShas: string[];
  belowChilds: string[][];
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
    const belowShas: string[] = [];
    const belowChilds: string[][] = [];
    lanes.forEach((sha, i) => {
      if (sha !== null) {
        below.push(i);
        belowShas.push(sha);
        belowChilds.push(laneChilds[i] ?? []);
      }
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
      belowShas,
      belowChilds,
    });
    laneCount = Math.max(laneCount, lanes.length);
  }
  return { rows, laneCount };
}

// One hue per lane; 16 before a repeat.
const LANE_COLORS_DARK = [
  "#4e8cff", // blue
  "#d29922", // amber
  "#39c5cf", // teal
  "#bc8cff", // violet
  "#f778ba", // pink
  "#3fb950", // green
  "#ff9f43", // orange
  "#e3b341", // gold
  "#2fb38f", // mint
  "#f47067", // coral
  "#a5b4fc", // periwinkle
  "#a3b83a", // lime
  "#8b949e", // slate
  "#e2a8f0", // orchid
  "#5ad1a6", // jade
  "#dbab7a", // sand
];

const LANE_COLORS_LIGHT = [
  "#2563eb", // blue
  "#d97706", // amber
  "#0891b2", // teal
  "#7c3aed", // violet
  "#db2777", // pink
  "#16a34a", // green
  "#ea580c", // orange
  "#a16207", // gold
  "#059669", // mint
  "#e11d48", // coral
  "#4f46e5", // periwinkle
  "#65a30d", // lime
  "#64748b", // slate
  "#c026d3", // orchid
  "#047857", // jade
  "#92400e", // sand
];

const ROW_H = 34;
const COL_W = 16;

/* Read per call rather than cached. Both reads are cheap and neither forces
   layout. */
function onLightBackground(): boolean {
  if (typeof document === "undefined") return false;
  const chosen = document.documentElement.getAttribute("data-theme");
  if (chosen === "light") return true;
  if (chosen === "dark") return false;
  return window.matchMedia("(prefers-color-scheme: light)").matches;
}

/** Both palettes are the same length; the dash rounds count against it. */
export const LANE_COUNT = LANE_COLORS_DARK.length;

export function laneColor(i: number): string {
  const palette = onLightBackground() ? LANE_COLORS_LIGHT : LANE_COLORS_DARK;
  return palette[i % palette.length];
}

/* Subway-map trunks: every branch is its tip's first parent chain,
   drawn as its own strand. Where several routes share a stretch of history
   the strands run in parallel, each in a fixed slot for the whole lane so a
   branch's line stays straight while neighbours come and go, and every stop
   stretches into a station bar crossing the strands present. Merges are
   plain connectors between lines, not part of any route. */
const STRAND_GAP = 5;
const RAIL_W = 3;
/** Solid, then dashed, then dotted */
const DASH_PATTERNS: (string | undefined)[] = [undefined, "7 4", "2 3"];
/** A stretch no named branch runs along (history behind a deleted branch, or
    the far side of a merge) is track without a line: neutral, never a hue
    that would read as somebody's branch. */
const NO_ROUTE = "var(--muted)";

/** The routes riding the edges into `childs`, in stable order. */
function routesForShas(routes: RouteMap, shas: string[]): string[] {
  const seen = new Set<string>();
  for (const s of shas) {
    for (const r of routes.bySha.get(s) ?? []) seen.add(r);
  }
  return [...seen].sort(
    (a, b) => (routes.orderIndex.get(a) ?? 0) - (routes.orderIndex.get(b) ?? 0),
  );
}

/** The routes riding the edge child->parent: normally the lines both ends
    are on, which is the whole bundle along a trunk. Where they share none,
    the edge is a merge connector, and the stretch running down into where
    a line ends belongs to that line, so it wears its colour and sits on its
    strand all the way to the tip. Anything else is track no line runs
    along, and stays neutral. */
export function edgeRoutesOf(
  routes: RouteMap,
  childs: string[],
  parentSha: string,
): string[] {
  return edgeRoutes(routes, childs, parentSha);
}

function edgeRoutes(
  routes: RouteMap,
  childs: string[],
  parentSha: string,
): string[] {
  const onParent = new Set(routes.bySha.get(parentSha) ?? []);
  const above = routesForShas(routes, childs);
  const shared = above.filter((r) => onParent.has(r));
  if (shared.length > 0) return shared;
  // The stretch where a line leaves the one it broke off from belongs to
  // the line above, the same way the stretch into a tip belongs to the line
  // ending there.
  const leaving = above.filter((r) => routes.forkPoint.get(r) === parentSha);
  if (leaving.length > 0) return leaving;
  return (routes.tipOf.get(parentSha) ?? []).slice(0, 1);
}

export type LaneSlots = Map<number, Map<string, number>>;

export interface LaneLayout {
  /** Strand offsets to use for each row, by lane then route. */
  slots: LaneSlots[];
  /** Centre x of each lane. Lanes are only as wide as their own bundle
      needs, so a single-branch lane stays narrow next to a busy trunk. */
  laneX: number[];
  totalW: number;
}

/** Where each line sits across a lane. The rule: for as long as a lane is
    continuously occupied, every line running down it keeps one fixed offset,
    and the bundle is centred on the lane, so lines stay straight while
    neighbours come and go. When a lane empties and is later reused by
    unrelated history, that new occupancy is centred on its own, rather than
    inheriting slots from lines it never runs beside. */
export function computeLaneSlots(
  rows: LaidRow[],
  routes: RouteMap,
  laneCount: number,
): LaneLayout {
  // What each row draws in each lane, and which lanes it touches at all.
  const drawn: Map<number, Set<string>>[] = [];
  const touched: Set<number>[] = [];
  for (const row of rows) {
    const m = new Map<number, Set<string>>();
    const add = (lane: number, rs: string[]) => {
      let s = m.get(lane);
      if (!s) m.set(lane, (s = new Set()));
      for (const r of rs) s.add(r);
    };
    // Only lines that actually run through this lane get a slot. A branch
    // that calls at a single stop and goes nowhere, parked with no commits
    // of its own, would otherwise reserve a strand's width down the entire
    // lane to show one bead, which is what pushes everything else outwards.
    // Its bead is packed at the stop instead.
    if (row.hasTop) {
      add(row.lane, edgeRoutes(routes, row.topChilds, row.commit.sha));
    }
    row.passes.forEach((j, k) =>
      add(j, edgeRoutes(routes, row.passChilds[k] ?? [], row.passShas[k])),
    );
    row.joins.forEach((j, k) =>
      add(j, edgeRoutes(routes, row.joinChilds[k] ?? [], row.commit.sha)),
    );
    row.below.forEach((j, k) =>
      add(j, edgeRoutes(routes, row.belowChilds[k] ?? [], row.belowShas[k])),
    );
    drawn.push(m);
    const here = new Set<number>([row.lane]);
    for (const j of row.passes) here.add(j);
    for (const j of row.joins) here.add(j);
    for (const m2 of row.forks) here.add(m2);
    for (const j of row.below) here.add(j);
    touched.push(here);
  }

  // Break each lane into runs of rows where the same history stays in it. A
  // run carries on only while the lane still holds the commit it was
  // waiting for, a lane freed on one row and picked up by unrelated
  // history on the next looks continuous but is not, and letting those
  // share one allocation leaves both sitting off the lane's centre. A
  // stretch carrying no line does not end a run, so a line's offset
  // survives a neutral gap in the middle of its lane.
  const runOfRow: Map<number, number>[] = rows.map(() => new Map());
  const runRoutes = new Map<string, Set<string>>();
  const openRun = new Map<number, number>();
  const runCount = new Map<number, number>();
  const held = new Map<number, string>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const carriesOn = new Set<number>();
    row.passes.forEach((j, k) => {
      if (held.get(j) === row.passShas[k]) carriesOn.add(j);
    });
    if (row.hasTop && held.get(row.lane) === row.commit.sha) {
      carriesOn.add(row.lane);
    }
    for (const j of row.joins) {
      if (held.get(j) === row.commit.sha) carriesOn.add(j);
    }
    for (const lane of touched[i]) {
      let run = carriesOn.has(lane) ? openRun.get(lane) : undefined;
      if (run === undefined) {
        run = runCount.get(lane) ?? 0;
        runCount.set(lane, run + 1);
        openRun.set(lane, run);
      }
      runOfRow[i].set(lane, run);
      const key = `${lane}:${run}`;
      let set = runRoutes.get(key);
      if (!set) runRoutes.set(key, (set = new Set()));
      for (const r of drawn[i].get(lane) ?? []) set.add(r);
    }
    held.clear();
    row.below.forEach((j, k) => held.set(j, row.belowShas[k]));
    for (const lane of [...openRun.keys()]) {
      if (!held.has(lane)) openRun.delete(lane);
    }
  }

  // One centred allocation per run, and a lane sized by its busiest run.
  const runSlots = new Map<string, Map<string, number>>();
  const widest = new Map<number, number>();
  for (const [key, set] of runRoutes) {
    const lane = Number(key.slice(0, key.indexOf(":")));
    const ordered = [...set].sort(
      (a, b) =>
        (routes.orderIndex.get(a) ?? 0) - (routes.orderIndex.get(b) ?? 0),
    );
    const m = new Map<string, number>();
    ordered.forEach((r, i) =>
      m.set(r, (i - (ordered.length - 1) / 2) * STRAND_GAP),
    );
    runSlots.set(key, m);
    widest.set(lane, Math.max(widest.get(lane) ?? 1, ordered.length));
  }

  const slots: LaneSlots[] = rows.map((_, i) => {
    const m: LaneSlots = new Map();
    for (const [lane, run] of runOfRow[i]) {
      const s = runSlots.get(`${lane}:${run}`);
      if (s) m.set(lane, s);
    }
    return m;
  });

  // Each lane is only as wide as its own bundle plus room for the station
  // bar capping it, so the diagram stays tight and forks travel a short way.
  const laneX: number[] = [];
  let edge = 0;
  // Width comes from the strands that run down the lane, and nothing else.
  // Beads for branches that only call at one stop hang off the end of that
  // stop's bar instead of buying width along the whole lane, a lane is
  // costly, and they have no line to put in it.
  for (let i = 0; i < Math.max(laneCount, widest.size); i++) {
    const width = Math.max(COL_W, ((widest.get(i) ?? 1) - 1) * STRAND_GAP + 12);
    laneX.push(edge + width / 2);
    edge += width;
  }
  return { slots, laneX, totalW: edge };
}

/** Tags arrive decorated by the backend ("🏷 v1"), which is how they are
    told apart from branch names. */
export function isTagRef(ref: string): boolean {
  return ref.startsWith("🏷");
}

export interface RouteMap {
  /** Stable drawing order for every route (branch or tag) label. */
  orderIndex: Map<string, number>;
  /** sha -> the route labels whose line runs through it. */
  bySha: Map<string, string[]>;
  /** sha -> its first parent, for telling route edges from connectors. */
  firstParent: Map<string, string | undefined>;
  /** sha -> the routes that END here, i.e. whose branch tip this is. */
  tipOf: Map<string, string[]>;
  /** Route -> the commit it broke off at, where its strip starts. */
  forkPoint: Map<string, string | undefined>;
  /** The colour each route keeps everywhere it is drawn. */
  color: Map<string, string>;
  /** Once the palette is exhausted, lines reuse a hue but take a dash
      pattern, so neighbours still tell apart. Undefined means solid. */
  dash: Map<string, string | undefined>;
  /** sha -> every branch whose history holds it, however it got there.
      Which line is *drawn* along a stretch is a different question: a
      merge diamond's side path is one spur, not the whole bundle. */
  containedIn: Map<string, string[]>;
  /** Branch -> the line it is drawn as. Branches sitting on the same commit
      have the same history, so they share one line. */
  repOf: Map<string, string>;
  /** That line -> every branch riding it. */
  members: Map<string, string[]>;
}

/** Which routes pass through each commit. A route is its tip's first-parent
    chain, the line the branch draws on the map; merges connect lines but
    do not spread them. */
export function routeSets(commits: GraphCommit[]): RouteMap {
  const byShaCommit = new Map(commits.map((c) => [c.sha, c]));
  const firstParent = new Map<string, string | undefined>(
    commits.map((c) => [c.sha, c.parents[0]]),
  );
  const tips = new Map<string, string>();
  for (const c of commits) {
    for (const r of c.refs) {
      // Only branches draw a line. A tag marks one stop, like a landmark
      // beside a station, and would otherwise claim the whole history
      // behind it as a route of its own.
      if (r === "HEAD" || r === "origin/HEAD" || isTagRef(r)) continue;
      const name = r.startsWith("origin/") ? r.slice(7) : r;
      if (!tips.has(name)) tips.set(name, c.sha);
    }
  }
  // Every branch is its own line with its own colour, including two sitting
  // on the same commit: they are different branches and the team has to
  // tell them apart, so they run alongside each other with a bead each.
  const repOf = new Map<string, string>();
  const members = new Map<string, string[]>();
  const orderIndex = new Map<string, number>();
  const bySha = new Map<string, string[]>();
  const tipOf = new Map<string, string[]>();
  const forkPoint = new Map<string, string | undefined>();
  let order = 0;
  for (const [label, tipSha] of tips) {
    repOf.set(label, label);
    members.set(label, [label]);
    orderIndex.set(label, order++);
    let ends = tipOf.get(tipSha);
    if (!ends) tipOf.set(tipSha, (ends = []));
    ends.push(label);
  }

  // Has this branch broken off, or is it parked on someone else's line?
  // Git keeps no record of when a branch was made, but this question is
  // answerable and it is the one that matters: a branch is parked when its
  // tip sits on another line's own run of commits. Being merged into
  // another branch does not make it parked, its work still went its own
  // way first, so it keeps a strip that ends where it merged. Branches on
  // the very same commit do not park each other either; neither is behind
  // the other, so they simply run together.
  const chainOf = new Map<string, Set<string>>();
  for (const [label, tipSha] of tips) {
    const seen = new Set<string>();
    let sha: string | undefined = tipSha;
    while (sha && !seen.has(sha)) {
      seen.add(sha);
      sha = byShaCommit.get(sha)?.parents[0];
    }
    chainOf.set(label, seen);
  }
  const brokeOff = new Map<string, boolean>();
  for (const [label, tipSha] of tips) {
    let parked = false;
    for (const [other, otherTip] of tips) {
      if (other === label || otherTip === tipSha) continue;
      if (chainOf.get(other)?.has(tipSha)) {
        parked = true;
        break;
      }
    }
    brokeOff.set(label, !parked);
  }

  // Lines that broke off go first and take the commits their first parents
  // reach, stopping where they meet a line already running, that meeting
  // point is the commit they were made from, and their strip starts there.
  // Nothing of theirs is drawn before it.
  const claimed = new Set<string>();
  const drewOwn = new Set<string>();
  for (const [label, tipSha] of tips) {
    if (!brokeOff.get(label)) continue;
    const seen = new Set<string>();
    let sha: string | undefined = tipSha;
    while (sha && !seen.has(sha) && !claimed.has(sha)) {
      seen.add(sha);
      claimed.add(sha);
      let list = bySha.get(sha);
      if (!list) bySha.set(sha, (list = []));
      list.push(label);
      sha = byShaCommit.get(sha)?.parents[0];
    }
    if (seen.size === 0) continue; // a twin on the same commit got there first
    drewOwn.add(label);
    forkPoint.set(label, sha && !seen.has(sha) ? sha : undefined);
  }

  // A branch with no stretch of its own to draw, parked on another line,
  // or sharing a commit with a twin, runs the whole way alongside it in
  // its own colour, so the stops they share become pods naming both.
  for (const [label, tipSha] of tips) {
    if (drewOwn.has(label)) continue;
    const seen = new Set<string>();
    let sha: string | undefined = tipSha;
    while (sha && !seen.has(sha)) {
      seen.add(sha);
      let list = bySha.get(sha);
      if (!list) bySha.set(sha, (list = []));
      list.push(label);
      sha = byShaCommit.get(sha)?.parents[0];
    }
    forkPoint.set(label, undefined);
  }
  // Keep every stop's lines in the drawing order the strands use.
  for (const [sha, rs] of bySha) {
    if (rs.length > 1) {
      bySha.set(
        sha,
        [...rs].sort(
          (a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0),
        ),
      );
    }
  }

  // Work that arrived through a merge sits on a second parent, a `git pull`
  // puts the incoming commits there, so no tip's first-parent chain reaches
  // Nothing is adopted onto a line it does not run along. When two people
  // commit on the same base and one pulls, git writes a merge whose second
  // side is the other person's work: real history, but no branch of its own
  // ever ran there. That stretch stays neutral, and the commit's own panel
  // lists the branches whose history holds it.

  // Colours: every branch gets its own, outright. Only colouring lines that
  // touch was not enough, two branches on opposite sides of the diagram
  // never meet, so they were handed the same hue and read as one branch.
  // Sixteen colours times three dash patterns is 48 before any repeat.
  const color = new Map<string, string>();
  const dash = new Map<string, string | undefined>();
  for (const [label, i] of orderIndex) {
    color.set(label, laneColor(i));
    // Solid right through the palette first, so dashes only appear once
    // there are more branches than colours.
    const round = Math.floor(i / LANE_COUNT);
    dash.set(
      label,
      DASH_PATTERNS[Math.min(round, DASH_PATTERNS.length - 1)],
    );
  }
  // Which branches is this commit on? Every branch whose own run of commits
  // passes through it, its first parents, back through whatever it was made
  // from and on into the history behind that. So a branch made from this
  // commit later still counts: its line runs back through here.
  //
  // A branch that merged this work in does not. The merge happened at a
  // later commit; the work was never on that branch at this point in the
  // story, it arrived afterwards. This is also how the railway picks what to
  // draw, so the lines and the words agree.
  const containedIn = new Map<string, string[]>();
  for (const [label] of tips) {
    for (const sha of chainOf.get(label) ?? []) {
      let list = containedIn.get(sha);
      if (!list) containedIn.set(sha, (list = []));
      list.push(label);
    }
  }
  // Plain containment, every parent followed, merges included. Kept for the
  // day the question is "who has this work now?" rather than "whose line was
  // it made on?", the two differ the moment anything is merged.
  // const containedIn = new Map<string, string[]>();
  // for (const [label, tipSha] of tips) {
  //   const seen = new Set<string>();
  //   const stack = [tipSha];
  //   while (stack.length > 0) {
  //     const sha = stack.pop()!;
  //     if (seen.has(sha)) continue;
  //     seen.add(sha);
  //     let list = containedIn.get(sha);
  //     if (!list) containedIn.set(sha, (list = []));
  //     list.push(label);
  //     const c = byShaCommit.get(sha);
  //     if (c) stack.push(...c.parents);
  //   }
  // }
  return {
    orderIndex,
    bySha,
    firstParent,
    tipOf,
    forkPoint,
    color,
    dash,
    containedIn,
    repOf,
    members,
  };
}

/** A line ends where it merges, so the last stretch, the connector running
    up into the merge commit, belongs to it and lights with it. Without the
    merge commit in the lit set that final segment would stay dim. */
function addMergePoint(set: Set<string>, rows: LaidRow[], topSha: string) {
  const merger = rows.find(
    (r) =>
      !set.has(r.commit.sha) &&
      r.commit.parents.indexOf(topSha) > 0,
  );
  if (merger) set.add(merger.commit.sha);
}

/** Every route keeps one colour everywhere it is drawn. */
export function routeColor(routes: RouteMap, r: string): string {
  const line = routes.repOf.get(r) ?? r;
  return routes.color.get(line) ?? laneColor(routes.orderIndex.get(line) ?? 0);
}

/** A fork or merge crossing between lanes: out of its own lane, through a
    rounded corner, across, then back in through another. Both railways draw
    it with this one function. `lane` runs across the tracks and `travel`
    along them, Branches runs down the page and Progress across it, so the
    two hand the same pair of numbers in the other way round and get the
    identical curve back. */
export function crossPath(
  lane0: number,
  travel0: number,
  lane1: number,
  travel1: number,
  along: "x" | "y",
): string {
  const pt = (l: number, t: number) =>
    along === "y" ? `${l} ${t}` : `${t} ${l}`;
  if (lane0 === lane1) return `M ${pt(lane0, travel0)} L ${pt(lane1, travel1)}`;
  // Tangents along the track at both ends, so the turn eases in and out with
  // no corner anywhere.
  const mid = (travel0 + travel1) / 2;
  return `M ${pt(lane0, travel0)} C ${pt(lane0, mid)} ${pt(lane1, mid)} ${pt(lane1, travel1)}`;
}

function crossing(x0: number, y0: number, x1: number, y1: number): string {
  return crossPath(x0, y0, x1, y1, "y");
}

/** Solid until the palette runs out; then dashes tell the reused hues apart. */
export function routeDash(routes: RouteMap, r: string): string | undefined {
  return routes.dash.get(routes.repOf.get(r) ?? r);
}

/** One strand at an absolute x, optionally quieted (not the focused route). */
interface Strand {
  x: number;
  cls?: string;
  color?: string;
  dash?: string;
}

interface FillLane {
  lane: number;
  on: boolean;
  strands: Strand[];
}

function FillRails({ lanes, totalW }: { lanes: FillLane[]; totalW: number }) {
  const w = totalW + 4;
  return (
    <svg
      className="gg-fillrails"
      width={w}
      viewBox={`0 0 ${w} 10`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {lanes.map(({ lane: j, on, strands }) => (
        <g key={j} className={on ? undefined : "gg-quiet"}>
          {strands.map(({ x: sx, cls: sc, color: scol, dash: sd }) => (
            <line
              key={sx}
              className={sc}
              x1={sx}
              y1={0}
              x2={sx}
              y2={10}
              stroke={scol ?? NO_ROUTE}
              strokeWidth={RAIL_W}
              strokeDasharray={sd}
            />
          ))}
        </g>
      ))}
    </svg>
  );
}

function RowRails({
  row,
  open,
  lit,
  routes,
  slots,
  laneX,
  totalW,
  focusRoute,
  litRoutes,
}: {
  row: LaidRow;
  open?: boolean;
  /** The one line of history that stays bright; null lights everything. */
  lit?: Set<string> | null;
  /** Which routes run through which commit (see routeSets). */
  routes: RouteMap;
  /** Fixed strand slot per lane and route (see computeLaneSlots). */
  slots: LaneSlots;
  laneX: number[];
  totalW: number;
  /** The branch whose own strand stays lit on shared trunks. */
  focusRoute?: string | null;
  /** Which branches the highlight is actually about. `lit` is commits, and a
      commit belongs to every line running through it, so a shared stretch
      lights branches that merely pass along it. These are the ones that were
      asked for; the rest step back even on lit track. */
  litRoutes?: Set<string> | null;
}) {
  const w = totalW + 4;
  const mid = ROW_H / 2;
  const x = (i: number) => laneX[i] ?? i * COL_W + COL_W / 2;
  const xl = x(row.lane);
  const c = row.commit;
  const edgeOn = (childs: string[], parent: string) =>
    !lit || (lit.has(parent) && childs.some((ch) => lit.has(ch)));
  const passOn = (k: number) => edgeOn(row.passChilds[k] ?? [], row.passShas[k]);
  const topOn = edgeOn(row.topChilds, c.sha);
  const joinOn = (k: number) => edgeOn(row.joinChilds[k] ?? [], c.sha);
  const contOn = !lit || (lit.has(c.sha) && lit.has(c.parents[0] ?? ""));
  const forkOn = (k: number) => edgeOn([c.sha], row.forkShas[k]);
  const nodeOn = !lit || lit.has(c.sha);
  const cls = (on: boolean) => (on ? undefined : "gg-quiet");

  // Strand math: a route rides only its own first-parent edges, in a fixed
  // slot per lane, so each branch keeps one straight line. An edge with no
  // route (a merge connector, or history no label points at) draws a single
  // centre line.
  const slotX = (lane: number, r: string) =>
    x(lane) + (slots.get(lane)?.get(r) ?? 0);
  /** Where a lane's line sits for a given set of routes: the middle of
      their strands, or the lane centre when the stretch is nobody's line. */
  const laneAnchor = (lane: number, rs: string[]) => {
    const xs = rs.map((r) => slotX(lane, r));
    return xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : x(lane);
  };
  const allNodeRs = routes.bySha.get(c.sha) ?? [];
  const laneSlots = slots.get(row.lane);
  // Lines with a strand in this lane sit on it; ones that only call here
  // are packed beside them.
  const nodeRs = allNodeRs.filter((r) => laneSlots?.has(r));
  // Branches parked here with no line of their own are stashed to the right
  // of the ones that run, in the order their chips are listed on the row, 
  // so reading the beads left to right matches reading the names.
  const chipOrder = new Map<string, number>();
  c.refs.forEach((ref, i) => {
    const name = ref.startsWith("origin/") ? ref.slice(7) : ref;
    if (!chipOrder.has(name)) chipOrder.set(name, i);
  });
  const restingRs = allNodeRs
    .filter((r) => !laneSlots?.has(r))
    .sort(
      (a, b) =>
        (chipOrder.get(a) ?? Number.MAX_SAFE_INTEGER) -
        (chipOrder.get(b) ?? Number.MAX_SAFE_INTEGER),
    );

  // Where the stop sits: centred on the strands present at this commit.
  const nodeXs = nodeRs.map((r) => slotX(row.lane, r));
  const nMin = nodeXs.length ? Math.min(...nodeXs) : xl;
  const nMax = nodeXs.length ? Math.max(...nodeXs) : xl;
  const ncx = (nMin + nMax) / 2;

  // A segment carrying no route of its own (a merge connector, or history
  // no label points at) is a single line, drawn where its line sits rather
  // than at the bare lane centre, so nothing jumps sideways.
  const strandsFor = (lane: number, rs: string[], fallbackX: number): Strand[] => {
    if (rs.length === 0) return [{ x: fallbackX }];
    const litHere = litRoutes != null && rs.some((r) => litRoutes.has(r));
    return rs.map((r) => ({
      x: slotX(lane, r),
      color: routeColor(routes, r),
      dash: routeDash(routes, r),
      cls:
        litHere && rs.length > 1 && !litRoutes!.has(r) ? "gg-quiet" : undefined,
    }));
  };

  const topRs = row.hasTop ? edgeRoutes(routes, row.topChilds, c.sha) : [];
  const contRs = nodeRs;
  const passRs = row.passes.map((_, k) =>
    edgeRoutes(routes, row.passChilds[k] ?? [], row.passShas[k]),
  );
  const passFallback = row.passes.map((j) => x(j));
  const forkRs = row.forks.map((_, k) =>
    edgeRoutes(routes, [c.sha], row.forkShas[k]),
  );
  const joinRs = row.joins.map((_, k) =>
    edgeRoutes(routes, row.joinChilds[k] ?? [], c.sha),
  );
  // Every line calling at this stop: the ones running through, plus any
  // that break off here, this commit is where their history starts, so
  // they call here. A line merging in does not: the merge commit belongs
  // to the line it merged into, not to the one that ended. Lines passing
  // through keep their own strand; a line starting here takes a bead
  // beside them, since its own track lies in another lane.
  // Order matters: branches that break off here come first, so their beads
  // sit close to the lanes they leave for and their connectors stay short.
  // The parked ones, no line, nowhere to go, are stashed on the far end,
  // where they cost nobody anything.
  const callingRs = [
    ...new Set(joinRs.flat()),
    ...restingRs,
  ].filter((r, i, a) => !nodeRs.includes(r) && a.indexOf(r) === i);
  const beads = [
    ...nodeRs.map((r) => ({ r, bx: slotX(row.lane, r) })),
    // Packed straight onto the end, so the bar has no empty space in it.
    ...callingRs.map((r, i) => ({ r, bx: nMax + (i + 1) * STRAND_GAP })),
  ];
  const junction = beads.length > 1;
  /** Where a line's own bead sits, so its track runs into it and not into
      the middle of the bar. */
  const beadAt = new Map(beads.map((b) => [b.r, b.bx]));
  const bMin = Math.min(nMin, ...beads.map((b) => b.bx));
  const bMax = Math.max(nMax, ...beads.map((b) => b.bx));
  // A stop on one line wears that line's colour; an interchange stays
  // neutral rather than picking a winner among the lines calling there.
  const nodeColor =
    nodeRs.length === 1 && !junction
      ? routeColor(routes, nodeRs[0])
      : NO_ROUTE;
  // While a branch is picked out, its stops are drawn as its own dot instead
  // of hiding inside the interchange bar, on its own strand where it runs
  // through, and on its own bead where it only calls here. Either way the
  // dot lands exactly where that branch sits in the bar, so the bar can step
  // back behind it.
  const litStopRoute =
    litRoutes != null
      ? (nodeRs.find((r) => litRoutes.has(r)) ??
        beads.find((b) => litRoutes.has(b.r))?.r ??
        null)
      : null;
  const stopRoute =
    focusRoute != null && beadAt.has(focusRoute) ? focusRoute : litStopRoute;
  const focusStop = stopRoute != null ? (beadAt.get(stopRoute) ?? null) : null;
  // Lit, but none of the highlighted branches actually calls here: this is
  // the stop their line ran into, where another line picked the work up.
  // Hollow says "change here", it keeps the stop's own colour, which is
  // somebody else's, without pretending the branch you are following carries
  // on through it. A stop a branch was made from is not one of these: the
  // branch does call there, which is where its line starts.
  const terminus =
    litRoutes != null &&
    lit != null &&
    lit.has(c.sha) &&
    !beads.some((b) => litRoutes.has(b.r));

  const topLanes: FillLane[] = [
    ...row.passes.map((j, k) => ({
      lane: j,
      on: passOn(k),
      strands: strandsFor(j, passRs[k], passFallback[k]),
    })),
    ...(row.hasTop
      ? [{ lane: row.lane, on: topOn, strands: strandsFor(row.lane, topRs, ncx) }]
      : []),
    ...row.joins.map((j, k) => ({
      lane: j,
      on: joinOn(k),
      strands: strandsFor(j, joinRs[k], x(j)),
    })),
  ];
  const bottomLanes: FillLane[] = [
    ...row.passes.map((j, k) => ({
      lane: j,
      on: passOn(k),
      strands: strandsFor(j, passRs[k], passFallback[k]),
    })),
    ...(row.continues
      ? [{ lane: row.lane, on: contOn, strands: strandsFor(row.lane, contRs, ncx) }]
      : []),
    ...row.forks.map((m, k) => ({
      lane: m,
      on: forkOn(k),
      strands: [
        {
          x: laneAnchor(m, forkRs[k]),
          color: forkRs[k].length ? routeColor(routes, forkRs[k][0]) : undefined,
          dash: forkRs[k].length ? routeDash(routes, forkRs[k][0]) : undefined,
        },
      ],
    })),
  ];
  return (
    <span className="gg-railcol" aria-hidden="true">
    <FillRails lanes={topLanes} totalW={totalW} />
    <svg
      className="gg-rails"
      width={w}
      height={ROW_H}
      viewBox={`0 0 ${w} ${ROW_H}`}
      aria-hidden="true"
    >
      {row.passes.map((j, k) => (
        <g key={`p${j}`} className={cls(passOn(k))}>
          {strandsFor(j, passRs[k], passFallback[k]).map(({ x: sx, cls: sc, color: scol, dash: sd }) => (
            <line
              key={sx}
              className={sc}
              x1={sx}
              y1={0}
              x2={sx}
              y2={ROW_H}
              stroke={scol ?? NO_ROUTE}
              strokeWidth={RAIL_W}
              strokeDasharray={sd}
            />
          ))}
        </g>
      ))}
      {row.hasTop && (
        <g className={cls(topOn)}>
          {strandsFor(row.lane, topRs, ncx).map(({ x: sx, cls: sc, color: scol, dash: sd }) => (
            <line
              key={sx}
              className={sc}
              x1={sx}
              y1={0}
              x2={sx}
              y2={mid}
              stroke={scol ?? NO_ROUTE}
              strokeWidth={RAIL_W}
              strokeDasharray={sd}
            />
          ))}
        </g>
      )}
      {row.joins.map((j, k) => (
        <g key={`j${j}`} className={cls(joinOn(k))}>
          {(joinRs[k].length > 0 ? joinRs[k] : [null]).map((r) => {
            const x0 = r ? slotX(j, r) : x(j);
            const x1 = (r ? beadAt.get(r) : undefined) ?? ncx;
            const litHere =
              litRoutes != null && joinRs[k].some((q) => litRoutes.has(q));
            return (
              <path
                key={r ?? "-"}
                className={
                  r && litHere && joinRs[k].length > 1 && !litRoutes!.has(r)
                    ? "gg-quiet"
                    : undefined
                }
                d={crossing(x0, 0, x1, mid)}
                fill="none"
                stroke={r ? routeColor(routes, r) : NO_ROUTE}
                strokeWidth={RAIL_W}
                strokeDasharray={r ? routeDash(routes, r) : undefined}
              />
            );
          })}
        </g>
      ))}
      {row.continues && (
        <g className={cls(contOn)}>
          {strandsFor(row.lane, contRs, ncx).map(({ x: sx, cls: sc, color: scol, dash: sd }) => (
            <line
              key={sx}
              className={sc}
              x1={sx}
              y1={mid}
              x2={sx}
              y2={ROW_H}
              stroke={scol ?? NO_ROUTE}
              strokeWidth={RAIL_W}
              strokeDasharray={sd}
            />
          ))}
        </g>
      )}
      {row.forks.map((m, k) => {
        // Merge connector: it wears the colour of the line being merged in
        // when it reaches that branch's tip, and lands on its strand rather
        // than the bare lane centre.
        const prs = forkRs[k];
        const xm = laneAnchor(m, prs);
        return (
          <path
            key={`f${m}`}
            className={cls(forkOn(k))}
            d={crossing(ncx, mid, xm, ROW_H)}
            fill="none"
            stroke={prs.length ? routeColor(routes, prs[0]) : NO_ROUTE}
            strokeWidth={RAIL_W}
            strokeDasharray={prs.length ? routeDash(routes, prs[0]) : undefined}
          />
        );
      })}
      {row.commit.is_head ? (
        // "You are here": a pulsing halo and a double ring, unmissable
        // against the plain dots, centred on this commit's strands.
        <g className="gg-head">
          <circle className="gg-halo" cx={ncx} cy={mid} r={12} fill="var(--accent)" />
          <circle
            cx={ncx}
            cy={mid}
            r={8}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={RAIL_W}
          />
          <circle cx={ncx} cy={mid} r={4} fill="var(--accent)" />
        </g>
      ) : focusStop !== null ? (
        // One line is picked out: its stops show as its own colour, and the
        // interchange bar behind them steps back rather than dominating.
        <g className={cls(nodeOn)}>
          {junction && (
            <g className="gg-quiet">
              <rect
                x={bMin - 5}
                y={mid - 5}
                width={bMax - bMin + 10}
                height={10}
                rx={5}
                fill="var(--headbg)"
                stroke={NO_ROUTE}
                strokeWidth={RAIL_W}
              />
              {/* The lines sharing the stop stay in the bar, stepped back,
                  so it still reads as an interchange behind the lit dot. */}
              {beads
                .filter((b) => b.r !== stopRoute)
                .map(({ r, bx }) => (
                  <circle
                    key={r}
                    cx={bx}
                    cy={mid}
                    r={2}
                    fill={routeColor(routes, r)}
                  />
                ))}
            </g>
          )}
          {open && (
            <circle
              className="gg-halo"
              cx={focusStop}
              cy={mid}
              r={11}
              fill={routeColor(routes, stopRoute!)}
            />
          )}
          <circle
            cx={focusStop}
            cy={mid}
            r={open ? 6 : 5}
            fill={routeColor(routes, stopRoute!)}
          />
        </g>
      ) : junction ? (
        // A stop several lines call at: a rounded station bar crossing them
        // all, background-filled and outlined, the interchange marker from
        // subway maps. Its outline stays neutral, since no one branch owns
        // the stop.
        (() => {
          const sw = bMax - bMin + 10 + (open ? 2 : 0);
          const sh = 10 + (open ? 1 : 0);
          const bcx = (bMin + bMax) / 2;
          return (
            <g className={cls(nodeOn)}>
              {open && (
                <rect
                  className="gg-halo"
                  x={bcx - sw / 2 - 3}
                  y={mid - sh / 2 - 3}
                  width={sw + 6}
                  height={sh + 6}
                  rx={(sh + 6) / 2}
                  fill={nodeColor}
                />
              )}
              <rect
                x={bcx - sw / 2}
                y={mid - sh / 2}
                width={sw}
                height={sh}
                rx={sh / 2}
                fill="var(--headbg)"
                stroke={nodeColor}
                strokeWidth={RAIL_W}
              />
              {/* Each line calling here keeps a bead of its own colour
                  inside the bar, so the stop still says who stops at it. */}
              {beads.map(({ r, bx }) => (
                <circle
                  key={r}
                  // A line that only passes along the lit stretch is not what
                  // the highlight is about; its bead steps back with its
                  // strand.
                  className={
                    litRoutes && !litRoutes.has(r) ? "gg-quiet" : undefined
                  }
                  cx={bx}
                  cy={mid}
                  r={open ? 2.4 : 2}
                  fill={routeColor(routes, r)}
                />
              ))}
            </g>
          );
        })()
      ) : (
        <g className={cls(nodeOn)}>
          {open && (
            <circle className="gg-halo" cx={ncx} cy={mid} r={10} fill={nodeColor} />
          )}
          {terminus ? (
            // Where the line being followed ends. Hollow is the "change
            // here" marker: it keeps the stop's own colour while making
            // clear the followed line stops rather than carries on.
            <circle
              cx={ncx}
              cy={mid}
              r={open ? 6 : 5}
              fill="var(--headbg)"
              stroke={nodeColor}
              strokeWidth={RAIL_W}
            />
          ) : (
            <circle cx={ncx} cy={mid} r={open ? 6 : 5} fill={nodeColor} />
          )}
        </g>
      )}
    </svg>
    <FillRails lanes={bottomLanes} totalW={totalW} />
    </span>
  );
}

function DetailRails({ lanes, totalW }: { lanes: FillLane[]; totalW: number }) {
  const w = totalW + 4;
  return (
    <svg
      className="gg-detailrails"
      width={w}
      viewBox={`0 0 ${w} 10`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {lanes.map(({ lane: j, on, strands }) => (
        <g key={j} className={on ? undefined : "gg-quiet"}>
          {strands.map(({ x: sx, cls: sc, color: scol, dash: sd }) => (
            <line
              key={sx}
              className={sc}
              x1={sx}
              y1={0}
              x2={sx}
              y2={10}
              stroke={scol ?? NO_ROUTE}
              strokeWidth={RAIL_W}
              strokeDasharray={sd}
            />
          ))}
        </g>
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
  onBranch,
  colorOf,
  mergedBy,
}: {
  commit: GraphCommit;
  /** Every branch holding this commit, however it reached them. */
  onBranch: string[];
  colorOf: (branch: string) => string;
  /** Set when this change sits on a grey spur: the merge that took it in. */
  mergedBy: GraphCommit | null;
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
    // Always the whole change. Routing a one-file commit through the per-file dialog made the button mean two things.
    onRestoreFiles(cadFiles.map((f) => f.path), ref);
  }

  return (
    <div className="gg-detail">
      {commit.body && <p className="gg-body">{commit.body}</p>}
      <p className="muted small">
        {formatDateTime(commit.date)} · {commit.sha.slice(0, 8)}
      </p>
      {onBranch.length > 0 && (
        <p className="muted small gg-onbranches">
          On{" "}
          {onBranch.map((b, i) => (
            <span key={b}>
              {i > 0 && ", "}
              <strong style={{ color: colorOf(b) }}>{b}</strong>
            </span>
          ))}
        </p>
      )}
      {mergedBy && (
        <p className="gg-spurnote muted small">
          Its line is grey because this change never sat on a branch of its
          own.{" "}
          {commit.author_name === mergedBy.author_name
            ? "It was saved"
            : `${commit.author_name} saved it`}{" "}
          from the same starting point as someone else, and the two were
          brought together by {mergedBy.author_name}
          {"'"}s update
          {mergedBy.date ? ` on ${formatDate(mergedBy.date)}` : ""}. Nobody
          branched here. It is part of every branch listed above.
        </p>
      )}
      {files.isLoading && <p className="muted small">Reading what changed…</p>}
      {files.data && files.data.length > 0 && (
        <ul className="gg-files">
          {files.data.map((f) => (
            <li key={f.path}>
              <StatusMark status={f.status} />
              <span className="gg-filepath">{f.path}</span>
              {CAD_FILE.test(f.path) && f.status !== "D" && !commit.is_head && (
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
        {/* Already here: only branching off makes sense. */}
        {!commit.is_head && (
        <button
          className="branchoffbtn"
          onClick={() =>
            onPreviewCommit(
              commit.sha,
              `${commit.subject} · ${formatDate(commit.date)}`,
            )
          }
          title="Open the project as it was at this point, read-only. One click brings you back"
        >
          <EyeGlyph />
          View this version (read-only)
        </button>
        )}
        {cadFiles.length > 0 && !commit.is_head && (
          <button
            className="branchoffbtn"
            onClick={restoreFromHere}
            title="Bring a file back to how it was in this change"
          >
            <RestoreGlyph />
            Restore this version…
          </button>
        )}
        {/* 
        <button
          className="branchoffbtn"
          onClick={() => onUndoChange(ref)}
          title="Put every file this change touched back to how it was"
        >
          <RestoreGlyph />
          Undo this change…
        </button>
        */}
        <button
          className="branchoffbtn"
          onClick={() =>
            onBranchOff(commit.sha, `${commit.subject} · ${formatDate(commit.date)}`)
          }
          title="Start a new branch from this moment in time. Your current branch stays untouched"
        >
          <BranchGlyph />
          Branch off from here…
        </button>
      </div>
    </div>
  );
}

export function HistoryPage({
  currentBranch,
  focusSha,
  onSwitchBranch,
  onBranchOff,
  onViewVersion,
  onRestoreFiles,
  onPreviewCommit,
  onMergeBranch,
}: {
  currentBranch: string;
  focusSha?: string | null;
  onSwitchBranch: (name: string) => void;
  onBranchOff: (sha: string, label: string) => void;
  onViewVersion: (
    path: string,
    commit: VersionRef,
    scopeDefault?: "all" | "file",
  ) => void;
  onRestoreFiles: (paths: string[], commit: VersionRef) => void;
  /** View a whole commit as it was, read-only. */
  onPreviewCommit: (sha: string, label: string) => void;
  /** Open the merge dialog for a branch (second arg: the default branch). */
  onMergeBranch: (branch: string, defaultBranch: string) => void;
}) {
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  function deleteNow() {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    deleteBranch(deleting)
      .then(() => {
        setDeleting(null);
        queryClient.invalidateQueries();
      })
      .catch((e) => setDeleteError(isAppError(e) ? e.message : String(e)))
      .finally(() => setDeleteBusy(false));
  }

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
  // branch card being hovered, its line in the railway lights up
  const [hoverBranch, setHoverBranch] = useState<string | null>(null);
  // clicked card: stays highlighted and shows its buttons until clicked again
  const [pickedBranch, setPickedBranch] = useState<string | null>(null);

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
  const routes = useMemo(() => routeSets(graph.data ?? []), [graph.data]);
  const { slots, laneX, totalW } = useMemo(
    () => computeLaneSlots(laid.rows, routes, laid.laneCount),
    [laid, routes],
  );

  /** Exactly one branch's stops, plus the stop it broke off at and the one
      it merged into, so the connectors at either end light with it. Without
      those two a one-commit branch would light a dot and no line at all. */
  const lineOf = useMemo(
    () => (route: string | null) => {
      if (!route) return null;
      const set = new Set<string>();
      for (const row of laid.rows) {
        // Exactly the commits drawn in this branch's colour, so what lights
        // up and what is coloured can never disagree.
        if ((routes.bySha.get(row.commit.sha) ?? []).includes(route)) {
          set.add(row.commit.sha);
        }
      }
      if (set.size === 0) return null;
      // rows run newest first, so the line's tip is the first one in it.
      const tip = laid.rows.find((r) => set.has(r.commit.sha));
      if (tip) addMergePoint(set, laid.rows, tip.commit.sha);
      const from = routes.forkPoint.get(route);
      if (from) set.add(from);
      return set;
    },
    [laid, routes],
  );

  // Opening a commit asks "who came this way?". Every branch whose history
  // runs through it did, including ones that broke off further along, so
  // they all light; a branch that never reaches it goes quiet.
  const litLine = useMemo(() => {
    if (!openSha) return null;
    const on = routes.containedIn.get(openSha) ?? [];
    if (on.length > 0) {
      const all = new Set<string>([openSha]);
      for (const r of on) for (const sha of lineOf(r) ?? []) all.add(sha);
      return all;
    }
    // No branch reaches it any more, history behind a branch someone
    // deleted. Nothing to name it by, so follow its own first parents down
    // and the same line back up, and light that.
    const bySha = new Map(laid.rows.map((r) => [r.commit.sha, r]));
    const set = new Set<string>();
    let sha: string | undefined = openSha;
    while (sha && bySha.has(sha) && !set.has(sha)) {
      set.add(sha);
      sha = bySha.get(sha)!.commit.parents[0];
    }
    const openLane = bySha.get(openSha)?.lane;
    let cur = openSha;
    for (;;) {
      const kids = laid.rows.filter(
        (r) => r.commit.parents[0] === cur && !set.has(r.commit.sha),
      );
      if (kids.length === 0) break;
      const pick = kids.find((r) => r.lane === openLane) ?? kids[0];
      set.add(pick.commit.sha);
      cur = pick.commit.sha;
    }
    addMergePoint(set, laid.rows, cur);
    return set;
  }, [openSha, laid, routes, lineOf]);

  // Same idea for a hovered or picked branch card: its line stays lit.
  // A branch you actually clicked outranks one the pointer is merely passing
  // over. The other way round, picking a branch and then reaching for it with
  // the mouse handed the railway to whichever card you crossed on the way.
  const focusBranch = pickedBranch ?? hoverBranch;
  // Several branches parked on one commit share a line, so focus works on
  // the line, not the name. An open commit wins outright: running the mouse
  // down the branch list must not relight the diagram under it.
  const focusLine =
    openSha || !focusBranch ? null : (routes.repOf.get(focusBranch) ?? null);
  const hoverLine = useMemo(() => lineOf(focusLine), [focusLine, lineOf]);
  const quietSet = litLine ?? hoverLine;
  // Which branches the highlight is about. The lit set is commits, and a
  // commit belongs to every line running through it, so a shared trunk
  // lights branches that merely pass along it. These are the ones that were
  // asked for; the rest step back even on lit track.
  const litRoutes = useMemo(() => {
    if (openSha) return new Set(routes.containedIn.get(openSha) ?? []);
    return focusLine ? new Set([focusLine]) : null;
  }, [openSha, focusLine, routes]);

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

  // Where each branch's local and GitHub copies sit, to spot divergence.
  const refSpots = useMemo(() => {
    const local = new Map<string, string>();
    const remote = new Map<string, string>();
    for (const row of laid.rows) {
      for (const r of row.commit.refs) {
        if (r === "HEAD" || r.startsWith("tag: ")) continue;
        if (r.startsWith("origin/")) {
          const n = r.slice(7);
          if (!remote.has(n)) remote.set(n, row.commit.sha);
        } else if (!local.has(r)) {
          local.set(r, row.commit.sha);
        }
      }
    }
    return { local, remote };
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
        <h2>Branches</h2>
        <p className="muted small">
          Each branch is its own line of work. The railway shows where they
          split off and where they join back up, newest at the top.
        </p>
      </div>

      <div className="historybody">
        <aside className="branchlist">
          {branches.isLoading && <Loading what="Reading the branches…" />}
          {(branches.data ?? []).map((b) => {
            const tip = tips.get(b.name);
            // Every branch card wears its own line's colour, the same one
            // its strand has on the railway.
            const color = routes.repOf.has(b.name)
              ? routeColor(routes, b.name)
              : tip
                ? laneColor(tip.lane)
                : "var(--muted)";
            // same name and picture as the railway, via GitHub identities
            const person = tip ? authors.get(tip.sha) : undefined;
            const who = person
              ? formatPerson(person.name, person.login)
              : b.author;
            const twins = (branches.data ?? [])
              .filter(
                (o) => o.name !== b.name && tips.get(o.name)?.sha === tip?.sha,
              )
              .map((o) => o.name);
            return (
            <div
              key={b.name}
              className={`branchcard${b.name === currentBranch ? " current" : ""}${pickedBranch === b.name ? " picked" : ""}${pickedBranch && pickedBranch !== b.name ? " quiet" : ""}`}
              // soft wash of the branch's color instead of a hard bar
              style={
                pickedBranch === b.name
                  ? ({
                      "--pick": color,
                      borderColor: color,
                      background: `${color}1a`,
                    } as React.CSSProperties)
                  : tip
                    ? ({
                        "--pick": color,
                        boxShadow: `inset 0 0 44px ${color}1c`,
                      } as React.CSSProperties)
                    : undefined
              }
              onMouseEnter={() => setHoverBranch(b.name)}
              onMouseLeave={() =>
                setHoverBranch((prev) => (prev === b.name ? null : prev))
              }
              onClick={(e) => {
                // buttons inside do their own thing
                if ((e.target as HTMLElement).closest("button")) return;
                const picking = pickedBranch !== b.name;
                // Only one thing is ever called out, so picking a branch
                // puts away whatever commit was open.
                setOpenSha(null);
                setPickedBranch(picking ? b.name : null);
                if (picking) jumpToBranch(b.name);
              }}
            >
              <div className="branchname">
                <button
                  className="branchjump"
                  style={{ color }}
                  onClick={() => jumpToBranch(b.name)}
                  title="Show this branch's line in the diagram"
                >
                  {/* The branch's own mark, the same drawing the toolbar and
                      the rail use, in this branch's colour. A dashed line on
                      the railway still gets a dashed mark, which is what the
                      dot's dashed border used to say. */}
                  <span
                    className={`branchmark${routeDash(routes, b.name) ? " dashed" : ""}`}
                    style={{ color }}
                    aria-hidden="true"
                  >
                    <BranchGlyph size={14} />
                  </span>
                  {b.name}
                </button>
                {b.is_default && <span className="badge">default</span>}
                {b.name === currentBranch && (
                  <span className="badge badge-mine">you are here</span>
                )}
              </div>
              {pickedBranch === b.name ? (
                <div className="muted small branchmeta">
                  <span className="branchsubject">{b.subject || "—"}</span>
                  <span className="branchwho">
                    <UserAvatar url={person?.avatarUrl ?? null} name={who} size={16} />
                    <span>
                      {who} ·{" "}
                      {formatDateTime(new Date(b.last_commit_at * 1000).toISOString())}
                    </span>
                  </span>
                  {!b.is_default && (b.ahead > 0 || b.behind > 0) && (
                    <>
                      <br />
                      {b.ahead} ahead · {b.behind} behind{" "}
                      {(branches.data ?? []).find((x) => x.is_default)?.name ?? "main"}
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
              ) : (
                <div className="muted small branchmeta branchwho">
                  <UserAvatar url={person?.avatarUrl ?? null} name={who} size={16} />
                  <span>
                    Last change by {who} ·{" "}
                    {relativeTime(new Date(b.last_commit_at * 1000).toISOString())}
                  </span>
                </div>
              )}
              {pickedBranch === b.name && (
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
                {b.name !== currentBranch && (
                  <button
                    className="branchoffbtn"
                    onClick={() =>
                      onMergeBranch(
                        b.name,
                        (branches.data ?? []).find((x) => x.is_default)?.name ??
                          "main",
                      )
                    }
                    title="Bring this branch's work into another branch, directly or through a review"
                  >
                    <MergeGlyph />
                    Merge…
                  </button>
                )}
                {/* Fully merged: only a name now. */}
                {!b.is_default && b.name !== currentBranch && b.ahead === 0 && (
                  <button
                    className="branchoffbtn branchdelete"
                    onClick={() => {
                      setDeleteError(null);
                      setDeleting(b.name);
                    }}
                    title={`Everything on ${b.name} is already in ${(branches.data ?? []).find((x) => x.is_default)?.name ?? "main"}, so it can go`}
                  >
                    <TrashGlyph />
                    Delete…
                  </button>
                )}
              </div>
              )}
            </div>
            );
          })}
        </aside>

        {/* Portalled: inside the page's own glass it came out too see-through. */}
        {deleting &&
          createPortal(
          <div className="modal-backdrop" onClick={() => !deleteBusy && setDeleting(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h2>Delete this branch?</h2>
              <p className="muted">
                Everything on <BranchName name={deleting} /> is already in{" "}
                <BranchName
                  name={(branches.data ?? []).find((x) => x.is_default)?.name ?? "main"}
                />
                , so nothing is lost. The branch is removed from GitHub and
                this computer. Its commits stay in the history.
              </p>
              {deleteError && <p className="errdetail">{deleteError}</p>}
              <div className="modal-actions">
                <button onClick={() => setDeleting(null)} disabled={deleteBusy}>
                  Keep it
                </button>
                <button className="danger" onClick={deleteNow} disabled={deleteBusy}>
                  {deleteBusy ? "Deleting…" : "Delete it"}
                </button>
              </div>
            </div>
          </div>
            ,
            document.body,
          )}

        <section className="graphpane">
          {graph.isLoading && <Loading what="Reading the history…" />}
          {graph.isError && (
            <p className="muted">{String(graph.error)}</p>
          )}
          {laid.rows.map((row, rowIndex) => {
            const c = row.commit;
            const rowSlots = slots[rowIndex] ?? new Map();
            const person = authors.get(c.sha);
            const open = openSha === c.sha;
            return (
              <div
                key={c.sha}
                id={`gg-${c.sha}`}
                style={
                  {
                    "--lane": (() => {
                      const rs = routes.bySha.get(c.sha) ?? [];
                      return rs.length === 1
                        ? routeColor(routes, rs[0])
                        : laneColor(row.lane);
                    })(),
                  } as React.CSSProperties
                }
                className={`gg-row${open ? " open" : ""}${c.is_head ? " here" : ""}${
                  focusBranch &&
                  c.refs.some(
                    (r) => r === focusBranch || r === `origin/${focusBranch}`,
                  )
                    ? " hl"
                    : ""
                }`}
              >
                <button
                  className="gg-line"
                  onClick={() => {
                    // ...and the other way round: opening a commit drops a
                    // picked branch rather than lighting two lines at once.
                    setPickedBranch(null);
                    setOpenSha(open ? null : c.sha);
                  }}
                >
                  <RowRails
                    row={row}
                    open={
                      open ||
                      (focusBranch !== null &&
                        tips.get(focusBranch)?.sha === c.sha)
                    }
                    lit={quietSet}
                    routes={routes}
                    slots={rowSlots}
                    laneX={laneX}
                    totalW={totalW}
                    focusRoute={focusLine}
                    litRoutes={litRoutes}
                  />
                  <span className="gg-refs">
                    {c.is_head && (
                      <span className="gg-youarehere">You are here</span>
                    )}
                    {(() => {
                      // One chip per branch; git's local and GitHub copies
                      // only get told apart when they sit on different rows.
                      const seen = new Set<string>();
                      return c.refs.flatMap((r) => {
                        const name = r.startsWith("origin/") ? r.slice(7) : r;
                        if (name === "HEAD" || seen.has(name)) return [];
                        seen.add(name);
                        const localAt = refSpots.local.get(name);
                        const remoteAt = refSpots.remote.get(name);
                        const diverged =
                          localAt !== undefined &&
                          remoteAt !== undefined &&
                          localAt !== remoteAt;
                        const label = diverged
                          ? remoteAt === c.sha
                            ? `${name} (GitHub)`
                            : `${name} (here)`
                          : name;
                        return [
                          <span
                            key={name}
                            className={`gg-chip${name === currentBranch ? " here" : ""}`}
                            style={{
                              borderColor: routes.repOf.has(name)
                                ? routeColor(routes, name)
                                : laneColor(row.lane),
                            }}
                          >
                            {label}
                          </span>,
                        ];
                      });
                    })()}
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
                    <DetailRails
                      lanes={row.below.map((j, k) => {
                        const rs = edgeRoutes(
                          routes,
                          row.belowChilds[k] ?? [],
                          row.belowShas[k],
                        );
                        const focusHere =
                          focusBranch != null && rs.includes(focusBranch);
                        const cx = laneX[j] ?? j * COL_W + COL_W / 2;
                        const strands = rs.length
                          ? rs.map((r) => ({
                              x: cx + (rowSlots.get(j)?.get(r) ?? 0),
                              color: routeColor(routes, r),
                              dash: routeDash(routes, r),
                              cls:
                                focusHere && rs.length > 1 && r !== focusBranch
                                  ? "gg-quiet"
                                  : undefined,
                            }))
                          : [{ x: cx }];
                        return {
                          lane: j,
                          on:
                            !quietSet ||
                            (quietSet.has(row.belowShas[k]) &&
                              (row.belowChilds[k] ?? []).some((ch) =>
                                quietSet.has(ch),
                              )),
                          strands,
                        };
                      })}
                      totalW={totalW}
                    />
                    <CommitDetail
                      commit={c}
                      onBranch={routes.containedIn.get(c.sha) ?? []}
                      colorOf={(b) => routeColor(routes, b)}
                      mergedBy={
                        // Only a change on a grey spur needs explaining:
                        // no line runs along it, so say how it got here.
                        (routes.bySha.get(c.sha) ?? []).length === 0
                          ? (laid.rows.find(
                              (r) => r.commit.parents.indexOf(c.sha) > 0,
                            )?.commit ?? null)
                          : null
                      }
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
