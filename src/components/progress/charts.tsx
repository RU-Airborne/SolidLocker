/**
 * Charts for the Insights page.
 */
import { useMemo, useState } from "react";
import { laneColor } from "../history/HistoryPage";
import { formatDate } from "../../dates";
import { UserAvatar } from "../common/UserAvatar";
import { BranchGlyph } from "../common/HistoryDiagrams";
import { BranchName } from "../common/BranchName";
import { formatPerson } from "../../identity";

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** A stable colour per person, so the same face is the same colour anywhere. */
export function personColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return laneColor(Math.abs(h));
}

function shortName(path: string): string {
  return path.split("/").pop() ?? path;
}

/* --------------------------------------------------------------- 1. locks */

export interface HeldLock {
  id: string;
  path: string;
  /** GitHub login, or null when the server did not say. */
  login: string | null;
  since: number;
  mine: boolean;
}

/**
 * Every lock as a bar from when it was taken to now, oldest first. A run of
 * one colour is one person holding a whole corner of the project.
 */
export function LockTimeline({
  locks,
  now,
  nameFor,
  avatarFor,
}: {
  locks: HeldLock[];
  now: number;
  nameFor: (login: string) => string | null;
  avatarFor: (login: string) => string;
}) {
  const oldest = Math.min(...locks.map((l) => l.since));
  // The axis frames the locks, not a fixed window. A flat one-day floor drew
  // a morning's locks as slivers. The 1.2 keeps a single fresh lock from
  // filling the width as though it had been held forever.
  const spread = Math.max(now - oldest, 20 * 60_000);
  const span = spread * 1.2;
  const start = now - span;

  /** Hours over a morning, days over a fortnight, weeks over a season. */
  const ticks = useMemo(() => {
    const days = span / DAY_MS;
    const hours = days <= 2;
    const step = hours
      ? span / 4
      : days <= 10
        ? DAY_MS
        : days <= 60
          ? 7 * DAY_MS
          : 30 * DAY_MS;
    const out: { at: number; label: string }[] = [];
    for (let t = now; t >= start; t -= step) {
      // Day and month only. The full date carried a year nobody is reading
      // here and made every label wide enough to collide with its neighbour.
      out.push({
        at: t,
        label: hours
          ? new Date(t).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })
          : new Date(t).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            }),
      });
    }
    return out.reverse();
  }, [span, now, start]);

  const people = useMemo(() => {
    const seen = new Map<string, number>();
    for (const l of locks) {
      const key = l.login ?? "someone";
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]);
  }, [locks]);

  const pct = (at: number) => ((at - start) / span) * 100;

  return (
    <div className="ltl">
      <div className="ltl-people">
        {people.map(([login, count]) => (
          <span className="ltl-person" key={login}>
            <span
              className="ltl-swatch"
              style={{ background: personColor(login) }}
              aria-hidden="true"
            />
            {login === "someone" ? "someone" : (nameFor(login) ?? login)}
            <span className="muted"> · {count}</span>
          </span>
        ))}
      </div>

      <div className="ltl-rows">
        {/* The day lines belong to the track. This layer repeats the row's 
        own two columns, which is the only way the lines, the bars and the 
        dates underneath can be guaranteed to agree. */}
        <div className="ltl-gridlayer" aria-hidden="true">
          <span />
          <span className="ltl-gridtrack">
            {ticks.map((t) => (
              <span
                className="ltl-grid"
                key={t.at}
                style={{ left: `${pct(t.at)}%` }}
              />
            ))}
          </span>
        </div>

        {locks.map((l) => {
          const key = l.login ?? "someone";
          const color = personColor(key);
          const days = Math.max(0, Math.floor((now - l.since) / DAY_MS));
          const who = l.login ? (nameFor(l.login) ?? l.login) : "someone";
          // A lock taken this morning is a sliver against a six-week one, and
          // a face and a number will not fit inside it. Under a tenth of the
          // width, the label goes outside the bar instead.
          const width = 100 - pct(l.since);
          const roomy = width >= 11;
          return (
            <div
              className="ltl-row"
              key={l.id}
              title={`${l.path}\nHeld by ${who} since ${formatDate(l.since)}`}
            >
              <span className="ltl-name">{shortName(l.path)}</span>
              <span className="ltl-track">
                <span
                  className={`ltl-bar${l.mine ? " mine" : ""}${roomy ? "" : " tight"}`}
                  style={{
                    left: `${pct(l.since)}%`,
                    right: 0,
                    background: color,
                  }}
                >
                  {roomy && l.login && (
                    <UserAvatar url={avatarFor(l.login)} name={who} size={16} />
                  )}
                  {roomy && (
                    <span className="ltl-days">
                      {days <= 0 ? "today" : `${days}d`}
                    </span>
                  )}
                </span>
                {!roomy && (
                  <span
                    className="ltl-outside muted"
                    style={{ right: `calc(${width}% + 0.4rem)` }}
                  >
                    {days <= 0 ? "today" : `${days}d`}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <div className="ltl-axis" aria-hidden="true">
        <span />
        <span className="ltl-axistrack">
        {ticks.map((t, i) => {
          // Centred on its line, except at the ends: the last tick sits at
          // 100% and half of it fell off the edge of the panel.
          const first = i === 0;
          const last = i === ticks.length - 1;
          return (
            <span
              className="ltl-tick"
              key={t.at}
              style={{
                left: `${pct(t.at)}%`,
                transform: last
                  ? "translateX(-100%)"
                  : first
                    ? "none"
                    : "translateX(-50%)",
              }}
            >
              {t.label}
            </span>
          );
        })}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ 2. treemap */

export interface TreeItem {
  /** Folder, or whatever the caller is grouping by. */
  group: string;
  name: string;
  size: number;
  /** "mine" | "theirs" | "unlocked" */
  lock: string;
  modified: number;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Squarified treemap. Plain ordering gives splinters too thin to label, and
 * areas you cannot compare by eye.
 */
function squarify(values: number[], box: Box): Box[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return values.map(() => ({ ...box, w: 0, h: 0 }));

  const out: Box[] = [];
  let rest = { ...box };
  let restTotal = total;
  let i = 0;

  const worst = (row: number[], side: number, sum: number) => {
    const area = (sum / restTotal) * (rest.w * rest.h);
    const thick = area / side;
    let bad = 1;
    for (const v of row) {
      const len = ((v / sum) * area) / thick;
      bad = Math.max(bad, thick / len, len / thick);
    }
    return bad;
  };

  while (i < values.length) {
    const horizontal = rest.w >= rest.h;
    const side = horizontal ? rest.h : rest.w;
    const row: number[] = [values[i]!];
    let sum = values[i]!;
    let j = i + 1;
    while (j < values.length) {
      const next = sum + values[j]!;
      if (worst([...row, values[j]!], side, next) > worst(row, side, sum)) break;
      row.push(values[j]!);
      sum = next;
      j++;
    }

    const area = (sum / restTotal) * (rest.w * rest.h);
    const thick = side === 0 ? 0 : area / side;
    let along = 0;
    for (const v of row) {
      const len = sum === 0 ? 0 : ((v / sum) * area) / (thick || 1);
      out.push(
        horizontal
          ? { x: rest.x, y: rest.y + along, w: thick, h: len }
          : { x: rest.x + along, y: rest.y, w: len, h: thick },
      );
      along += len;
    }

    if (horizontal) {
      rest = { x: rest.x + thick, y: rest.y, w: rest.w - thick, h: rest.h };
    } else {
      rest = { x: rest.x, y: rest.y + thick, w: rest.w, h: rest.h - thick };
    }
    restTotal -= sum;
    i = j;
  }
  return out;
}

/**
 * The project as area: a block per folder, a tile per file, sized by disk.
 * Held files are tinted.
 */
export function ProjectTreemap({
  items,
  now,
  onPick,
}: {
  items: TreeItem[];
  now: number;
  onPick?: (name: string) => void;
}) {
  // Files named per folder before the rest become one block. Two hundred
  // tiles is a mosaic of slivers narrower than their own labels.
  const [perGroup, setPerGroup] = useState(6);

  const groups = useMemo(() => {
    const by = new Map<string, TreeItem[]>();
    for (const it of items) {
      const list = by.get(it.group) ?? [];
      list.push(it);
      by.set(it.group, list);
    }
    const out = [...by.entries()].map(([group, files]) => {
      const sorted = [...files].sort((a, b) => b.size - a.size);
      const shown = sorted.slice(0, perGroup);
      const rest = sorted.slice(perGroup);
      if (rest.length > 0) {
        shown.push({
          group,
          name: `+${rest.length} smaller`,
          size: rest.reduce((a, f) => a + f.size, 0),
          lock: "rest",
          modified: Math.max(...rest.map((f) => f.modified)),
        });
      }
      return {
        group,
        files: shown,
        size: files.reduce((a, f) => a + f.size, 0),
      };
    });
    return out.sort((a, b) => b.size - a.size);
  }, [items, perGroup]);

  const outer = useMemo(
    () =>
      squarify(
        groups.map((g) => g.size),
        { x: 0, y: 0, w: 100, h: 100 },
      ),
    [groups],
  );

  return (
    <>
      <div className="tmap-controls">
        <span className="muted small">Name the biggest</span>
        <div className="typefilter">
          {[4, 6, 12].map((n) => (
            <button
              key={n}
              className={perGroup === n ? "active" : ""}
              onClick={() => setPerGroup(n)}
            >
              {n} per folder
            </button>
          ))}
          <button
            className={perGroup >= 9999 ? "active" : ""}
            onClick={() => setPerGroup(9999)}
          >
            Everything
          </button>
        </div>
      </div>
      <div className="tmap">
      {groups.map((g, gi) => {
        const box = outer[gi]!;
        const inner = squarify(
          g.files.map((f) => f.size),
          { x: 0, y: 0, w: 100, h: 100 },
        );
        return (
          <div
            className="tmap-group"
            key={g.group}
            style={{
              left: `${box.x}%`,
              top: `${box.y}%`,
              width: `${box.w}%`,
              height: `${box.h}%`,
            }}
          >
            <span className="tmap-label">{g.group}</span>
            <div className="tmap-inner">
              {g.files.map((f, fi) => {
                const b = inner[fi]!;
                const ageDays = Math.floor((now - f.modified) / DAY_MS);
                // Recent work glows; a file nobody has touched in months sits
                // back so the busy corners are the ones that stand out.
                const heat = Math.max(0, 1 - Math.min(ageDays, 90) / 90);
                return (
                  <button
                    className={`tmap-tile lock-${f.lock}`}
                    key={f.name + fi}
                    style={{
                      left: `${b.x}%`,
                      top: `${b.y}%`,
                      width: `${b.w}%`,
                      height: `${b.h}%`,
                      "--heat": heat.toFixed(2),
                    } as React.CSSProperties}
                    onClick={onPick ? () => onPick(f.name) : undefined}
                    title={`${f.name}\n${(f.size / 1024 / 1024).toFixed(1)} MB · changed ${formatDate(f.modified)}`}
                  >
                    <span className="tmap-tilename">{f.name}</span>
                    <span className="tmap-tilesize">
                      {f.size >= 1024 * 1024
                        ? `${(f.size / 1024 / 1024).toFixed(1)} MB`
                        : `${Math.round(f.size / 1024)} KB`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      </div>
    </>
  );
}

/* ----------------------------------------------------------- 3. calendar */

/* Sunday first, matching the columns: each one is wound back to the Sunday on
   or before its week. */
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * A square per day, weeks running down.
 */
export function ShareCalendar({
  days,
  since,
  now,
}: {
  /** Shares per day, keyed by YYYY-MM-DD. */
  days: Map<string, number>;
  /** The first share in the project; the grid starts from that week. */
  since: number | null;
  now: number;
}) {
  // From the day the project started, not a fixed window: on a young project
  // a year of empty squares says nothing, and on an old one a year cuts the
  // beginning off. Capped so a decade of history does not become a mile of
  // scrolling.
  const weeks = useMemo(() => {
    if (!since) return 26;
    const span = Math.max(0, now - since);
    // Half a year at least: a project three weeks old drawn as three
    // columns is a stamp in the middle of an empty panel.
    return Math.min(300, Math.max(26, Math.ceil(span / (7 * DAY_MS)) + 1));
  }, [since, now]);

  const cells = useMemo(() => {
    const end = new Date(now);
    end.setHours(0, 0, 0, 0);
    // Wind back to the Sunday on or before today, so every column is a week.
    const last = new Date(end);
    last.setDate(last.getDate() - last.getDay());
    const out: { key: string; at: number; count: number }[][] = [];
    for (let w = weeks - 1; w >= 0; w--) {
      const col: { key: string; at: number; count: number }[] = [];
      for (let d = 0; d < 7; d++) {
        const day = new Date(last);
        day.setDate(day.getDate() - w * 7 + d);
        const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
        col.push({ key, at: day.getTime(), count: days.get(key) ?? 0 });
      }
      out.push(col);
    }
    return out;
  }, [days, weeks, now]);

  const busiest = Math.max(
    1,
    ...cells.flat().map((c) => c.count),
  );

  const months = useMemo(
    () =>
      cells.map((col, i) => {
        const at = new Date(col[0].at);
        const before = i > 0 ? new Date(cells[i - 1][0].at) : null;
        const fresh = !before || before.getMonth() !== at.getMonth();
        return fresh
          ? at.toLocaleDateString(undefined, { month: "short" })
          : "";
      }),
    [cells],
  );

  return (
    <div className="cal">
      <div className="cal-scroll">
        {/* The pad stands in for the day-name column, so a month still sits
            over its own week. */}
        <div className="cal-months" aria-hidden="true">
          <span className="cal-pad" />
          {months.map((m, i) => (
            <span className="cal-month" key={i}>
              {m}
            </span>
          ))}
        </div>
        <div className="cal-grid">
          {/* Inside the grid, not beside it. The grid centres itself while it
              fits, and a column parked at the far left would be stranded. */}
          <div className="cal-side" aria-hidden="true">
            {WEEKDAYS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
        {cells.map((col, i) => (
          <div className="cal-week" key={i}>
            {col.map((c) => {
              const ahead = c.at > now;
              // The grid is never shorter than half a year, so on a young
              // project the columns before the first share are padding, not
              // history. Drawn as a quiet day they read as weeks of nobody
              // doing anything, which is not what they are.
              const before = since !== null && c.at < startOfDay(since);
              const blank = ahead || before;
              const level = c.count === 0 ? 0 : Math.ceil((c.count / busiest) * 4);
              return (
                <span
                  key={c.key}
                  className={`cal-day l${blank ? 0 : level}${blank ? " blank" : ""}`}
                  title={
                    before
                      ? "Before the project started"
                      : ahead
                        ? ""
                        : `${formatDate(c.at)}: ${c.count} share${c.count === 1 ? "" : "s"}`
                  }
                />
              );
            })}
          </div>
        ))}
        </div>
      </div>
      <div className="cal-key muted small">
        <span>Quieter</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span className={`cal-day l${l}`} key={l} aria-hidden="true" />
        ))}
        <span>Busier</span>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- 4. divergence */

export interface Divergence {
  name: string;
  ahead: number;
  behind: number;
  isDefault: boolean;
  author: string;
  login: string | null;
  avatarUrl: string | null;
}

/**
 * Ahead to the right, behind to the left, from a line down the middle. A
 * branch drifting badly is a lopsided shape you cannot miss; "18 behind ·
 * 3 ahead" is two numbers you have to stop and read.
 */
export function BranchDivergence({
  branches,
  defaultName,
  colorOf,
}: {
  branches: Divergence[];
  defaultName: string;
  colorOf: (name: string) => string | undefined;
}) {
  const widest = Math.max(1, ...branches.map((b) => Math.max(b.ahead, b.behind)));

  return (
    <div className="dvg">
      <div className="dvg-head muted small">
        <span className="dvg-behindlabel">
          behind <BranchName name={defaultName} />
        </span>
        <span className="dvg-aheadlabel">not shared yet</span>
      </div>
      {branches.map((b) => (
        <div className="dvg-row" key={b.name}>
          {/* The branch's own mark, not a face. This chart is about branches;
              whose branch it is belongs in the tooltip. */}
          <span className="dvg-name" title={`${b.name}, last touched by ${b.author}`}>
            <span
              className="branchmark"
              style={{ color: colorOf(b.name) }}
              aria-hidden="true"
            >
              <BranchGlyph size={13} />
            </span>
            <span className="dvg-branch" style={{ color: colorOf(b.name) }}>
              {b.name}
            </span>
          </span>
          <span className="dvg-track">
            <span className="dvg-centre" aria-hidden="true" />
            {b.behind > 0 && (
              <span
                className="dvg-behind"
                style={{ width: `${(b.behind / widest) * 50}%` }}
                title={`${b.behind} change${b.behind === 1 ? "" : "s"} on ${defaultName} that ${b.name} does not have`}
              >
                <span className="dvg-num">{b.behind}</span>
              </span>
            )}
            {b.ahead > 0 && (
              <span
                className="dvg-ahead"
                style={{
                  width: `${(b.ahead / widest) * 50}%`,
                  background: colorOf(b.name),
                }}
                title={`${b.ahead} change${b.ahead === 1 ? "" : "s"} on ${b.name} not yet in ${defaultName}`}
              >
                <span className="dvg-num">{b.ahead}</span>
              </span>
            )}
            {b.ahead === 0 && b.behind === 0 && (
              <span className="dvg-instep muted small">in step</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Shared by the panels that list a person. */
export function personLabel(
  login: string | null,
  nameFor: (login: string) => string | null,
): string {
  if (!login) return "someone";
  return formatPerson(nameFor(login) ?? login, login);
}

/* --------------------------------------------------- 5. assembly map */

/** Small padlock, for saying a file is held without borrowing the bar down
    the left edge, which means "this is where you are" everywhere else. */
function LockMark({ mine }: { mine: boolean }) {
  return (
    <svg
      className={`amap-lock${mine ? " mine" : ""}`}
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export interface DepNode {
  path: string;
  name: string;
  /** Assemblies and drawings that pull this file in. */
  parents: string[];
  lock: string;
}

/**
 * Which parts feed which assemblies. Columns by depth, not a force layout: a
 * spring layout of eighty CAD files settles into a hairball, and the question
 * here is about direction.
 */
export function AssemblyMap({
  edges,
  lockOf,
  onPick,
  focus,
}: {
  edges: { parent: string; child: string }[];
  lockOf: (path: string) => string;
  onPick: (path: string) => void;
  /** Highlight this file and everything it touches. */
  focus: string | null;
}) {
  const layout = useMemo(() => {
    const parentsOf = new Map<string, string[]>();
    const childrenOf = new Map<string, string[]>();
    const all = new Set<string>();
    for (const e of edges) {
      all.add(e.parent);
      all.add(e.child);
      (parentsOf.get(e.child) ?? parentsOf.set(e.child, []).get(e.child)!).push(
        e.parent,
      );
      (
        childrenOf.get(e.parent) ??
        childrenOf.set(e.parent, []).get(e.parent)!
      ).push(e.child);
    }

    // Depth = how far from a leaf part. Parts sit at 0, the assemblies built
    // from them at 1, an assembly of assemblies at 2, and so on.
    const depth = new Map<string, number>();
    const visit = (p: string, guard: Set<string>): number => {
      const known = depth.get(p);
      if (known !== undefined) return known;
      if (guard.has(p)) return 0; // a reference loop; do not chase it
      guard.add(p);
      const kids = childrenOf.get(p) ?? [];
      const d = kids.length === 0 ? 0 : 1 + Math.max(...kids.map((k) => visit(k, guard)));
      guard.delete(p);
      depth.set(p, d);
      return d;
    };
    for (const p of all) visit(p, new Set());

    const columns = new Map<number, string[]>();
    for (const p of all) {
      const d = depth.get(p) ?? 0;
      const col = columns.get(d) ?? [];
      col.push(p);
      columns.set(d, col);
    }
    for (const col of columns.values()) {
      col.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    }
    return {
      columns: [...columns.entries()].sort((a, b) => a[0] - b[0]),
      parentsOf,
      childrenOf,
    };
  }, [edges]);

  /**
   * Everything that uses this file, plus what it is directly made of. Lighting
   * the descendant tree too meant clicking the top assembly lit everything.
   */
  const lit = useMemo(() => {
    if (!focus) return null;
    const out = new Set<string>([focus]);
    const up = (p: string) => {
      for (const n of layout.parentsOf.get(p) ?? []) {
        if (out.has(n)) continue;
        out.add(n);
        up(n);
      }
    };
    up(focus);
    for (const n of layout.childrenOf.get(focus) ?? []) out.add(n);
    return out;
  }, [focus, layout]);

  /** Everything a change here would break, by name. */
  const reach = useMemo(() => {
    if (!focus) return null;
    const seen = new Set<string>();
    const up = (p: string) => {
      for (const n of layout.parentsOf.get(p) ?? []) {
        if (seen.has(n)) continue;
        seen.add(n);
        up(n);
      }
    };
    up(focus);
    return {
      affected: seen,
      names: [...seen].sort((a, b) =>
        shortName(a).toLowerCase().localeCompare(shortName(b).toLowerCase()),
      ),
      madeOf: layout.childrenOf.get(focus)?.length ?? 0,
    };
  }, [focus, layout]);

  if (layout.columns.length === 0) return null;
  const deepest = layout.columns[layout.columns.length - 1]![0];

  return (
    <>
      {/* Says what the dimming means and what changing this file costs; with
          nothing picked out, the key to the marks instead. Labels, not
          sentences: anything that reads as prose belongs in the caption
          above, where the reader is not scanning. */}
      <p className={`amap-reach${focus ? " on" : " muted small"}`}>
        {focus && reach ? (
          <>
            Changing <strong>{shortName(focus)}</strong>{" "}
            {reach.names.length === 0 ? (
              <>affects nothing else</>
            ) : (
              <>
                affects {reach.names.length} other file
                {reach.names.length === 1 ? "" : "s"}:{" "}
                {reach.names.map((n, i) => (
                  <span key={n}>
                    {i > 0 && ", "}
                    <button
                      className="linkish inline"
                      onClick={() => onPick(n)}
                      title={n}
                    >
                      {shortName(n)}
                    </button>
                  </span>
                ))}
              </>
            )}
            {reach.madeOf > 0 &&
              `. It is built from ${reach.madeOf} file${reach.madeOf === 1 ? "" : "s"} of its own`}
            .{" "}
            <button className="linkish inline" onClick={() => onPick("")}>
              Clear
            </button>
          </>
        ) : (
          <span className="amap-legend">
            {/* "used by 2" needs no key; it says what it is. */}
            <span className="amap-legenditem">
              <LockMark mine />
              <span>Locked by you</span>
            </span>
            <span className="amap-legenditem">
              <LockMark mine={false} />
              <span>Locked by a teammate</span>
            </span>
          </span>
        )}
      </p>
      <div className="amap">
      {layout.columns.map(([d, files]) => (
        <div className="amap-col" key={d}>
          <span className="amap-coltitle muted small">
            {d === 0
              ? "Parts"
              : d === deepest
                ? "Top level"
                : d === 1
                  ? "Assemblies"
                  : "Bigger assemblies"}
          </span>
          {files.map((path) => {
            const on = !lit || lit.has(path);
            const uses = layout.childrenOf.get(path)?.length ?? 0;
            const usedBy = layout.parentsOf.get(path)?.length ?? 0;
            const held = lockOf(path);
            return (
              <button
                key={path}
                className={`amap-node${focus === path ? " focus" : ""}${
                  reach?.affected.has(path) ? " affected" : ""
                }${on ? "" : " dim"}`}
                onClick={() => onPick(focus === path ? "" : path)}
                title={`${path}
Built from ${uses} file${uses === 1 ? "" : "s"} · ${usedBy} other file${usedBy === 1 ? "" : "s"} built from this one`}
              >
                {/* Always there, held or not. Rendered only when locked, the
                    padlock pushed those names right and left the column
                    ragged. */}
                <span className="amap-lockslot">
                  {held !== "unlocked" && <LockMark mine={held === "mine"} />}
                </span>
                <span className="amap-name">{shortName(path)}</span>
                {/* Spelled out. A bare number beside a file name reads as
                    "one what?", and the first guess is that it counts the
                    file itself, which it never does. */}
                {usedBy > 0 && (
                  <span className="amap-count">used by {usedBy}</span>
                )}
              </button>
            );
          })}
        </div>
      ))}
      </div>
    </>
  );
}
