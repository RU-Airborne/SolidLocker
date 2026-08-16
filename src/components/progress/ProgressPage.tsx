import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { getActivityAll, getCommitStats } from "../../api";
import type { FileRowData } from "../dashboard/Dashboard";
import { UserAvatar } from "../common/UserAvatar";
import { formatPerson, resolveCommitAuthors, useIdentities } from "../../identity";
import { formatDate } from "../../dates";

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
function areaStats(rows: FileRowData[]): AreaStat[] {
  const weekAgo = Date.now() - WEEK_MS;
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

function quietFor(ms: number): string {
  if (ms === 0) return "no shared changes yet";
  const days = Math.floor((Date.now() - ms) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "touched today";
  if (days === 1) return "quiet for a day";
  if (days < 30) return `quiet for ${days} days`;
  const months = Math.floor(days / 30);
  return `quiet for ${months} month${months === 1 ? "" : "s"}`;
}

export function ProgressPage({
  rows,
  onClose,
}: {
  rows: FileRowData[];
  onClose: () => void;
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
  const identities = useIdentities();
  const [range, setRange] = useState<RangeKey>("month");
  const [peopleRange, setPeopleRange] = useState<RangeKey>("month");

  const areas = useMemo(() => areaStats(rows), [rows]);

  // Shares per bucket for the chosen range, oldest first.
  const buckets = useMemo(() => {
    const { buckets: count, size } = RANGES[range];
    const now = Date.now();
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
  }, [stats.data, range]);

  const peakCommits = Math.max(1, ...buckets.map((b) => b.commits));

  // Who has shared work in the chosen window.
  const contributors = useMemo(() => {
    const { buckets: n, size } = RANGES[peopleRange];
    const cutoff = Date.now() - n * size;
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
  }, [stats.data, identities.data, peopleRange]);

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

  const weekAgo = Date.now() - WEEK_MS;
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
            <span className="muted">
              What the team has been working on across every branch
            </span>
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
                    {a.total} file{a.total === 1 ? "" : "s"} · {quietFor(a.lastTouched)}
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
