import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import * as api from "../api";
import { useLocks, useReworked } from "../queries";
import { Empty, FileTypeIcon, Spinner, Trouble } from "../components";
import { useNow } from "../../dates";

const WEEKS = 12;
const DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * DAY;

/**
 * How the project has been going.
 *
 * Every panel here is one measure, so none of them needs a legend: the heading
 * names the series and the numbers sit on the marks. The desktop has two more
 * that cannot follow. "Finished but not shared" compares against a working
 * tree, and "What is built from what" is read out of a running SolidWorks.
 * Neither exists on a phone, so neither is faked.
 */
export function Insights() {
  const stats = useQuery({
    queryKey: ["cloud", "stats"],
    queryFn: api.getCommitStats,
    staleTime: 5 * 60_000,
  });
  const now = useNow(5 * 60_000);

  const people = useMemo(() => {
    const count = new Map<string, number>();
    for (const row of stats.data ?? []) {
      const who = row.author_name || "unknown";
      count.set(who, (count.get(who) ?? 0) + 1);
    }
    return [...count.entries()]
      .map(([name, commits]) => ({ name, commits }))
      .sort((a, b) => b.commits - a.commits);
  }, [stats.data]);

  const weeks = useMemo(() => {
    const buckets = Array.from({ length: WEEKS }, (_, i) => ({
      startsAt: now - (WEEKS - 1 - i) * MS_PER_WEEK,
      commits: 0,
    }));
    const oldest = buckets[0]!.startsAt - MS_PER_WEEK;
    for (const row of stats.data ?? []) {
      const at = new Date(row.date).getTime();
      if (!Number.isFinite(at) || at < oldest) continue;
      const index = WEEKS - 1 - Math.floor((now - at) / MS_PER_WEEK);
      if (index >= 0 && index < WEEKS) buckets[index]!.commits += 1;
    }
    return buckets;
  }, [stats.data, now]);

  if (stats.isLoading) return <Spinner label="Adding it up..." />;
  if (stats.isError) {
    return <Trouble error={stats.error} onRetry={() => stats.refetch()} />;
  }
  if (people.length === 0) {
    return <Empty title="No changes yet" hint="Nobody has committed on this branch." />;
  }

  const busiest = people[0]!.commits;

  return (
    <div className="m-insights">
      <div className="m-statrow">
        <Stat value={stats.data?.length ?? 0} label="changes" />
        <Stat value={people.length} label={people.length === 1 ? "person" : "people"} />
        <Stat
          value={weeks.slice(-4).reduce((sum, w) => sum + w.commits, 0)}
          label="in 4 weeks"
        />
      </div>

      <Panel title="Activity" hue="var(--chart-1)">
        <Calendar rows={stats.data ?? []} now={now} />
        <p className="muted small m-panel-note">
          Every branch, not just the one you are reading.
        </p>
      </Panel>

      <Panel title="Changes per week" hue="var(--chart-1)">
        <WeekBars weeks={weeks} />
      </Panel>

      <Panel title="Who has been working" hue="var(--chart-2)">
        <ul className="m-rank">
          {people.map((person) => (
            <li key={person.name}>
              <span className="m-rank-label">
                <span className="m-rank-name">{person.name}</span>
                <span className="m-rank-count">{person.commits}</span>
              </span>
              <span className="m-rank-track">
                <span
                  className="m-rank-bar"
                  style={{ width: `${Math.max(2, (person.commits / busiest) * 100)}%` }}
                />
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Who is holding what, and for how long" hue="var(--chart-3)">
        <HeldFor now={now} />
      </Panel>

      <Panel title="Most reworked files" hue="var(--chart-1)">
        <Reworked />
      </Panel>
    </div>
  );
}

/**
 * One measure, one card, one colour. The colour is not decoration: it is what
 * lets the eye keep two panels apart while scrolling, which a page of
 * identical red bars does not.
 */
function Panel({
  title,
  hue,
  children,
}: {
  title: string;
  hue: string;
  children: React.ReactNode;
}) {
  return (
    <section className="m-panel" style={{ ["--panel-hue" as string]: hue }}>
      <h3 className="m-subhead">{title}</h3>
      {children}
    </section>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="m-stat">
      <span className="m-stat-value">{value}</span>
      <span className="m-stat-label">{label}</span>
    </div>
  );
}

/**
 * Days down, weeks across. A sequential ramp of one hue: more changes, darker
 * square. Never a rainbow, because the quantity is ordered and colour has to
 * be ordered with it.
 */
function Calendar({ rows, now }: { rows: api.CommitStat[]; now: number }) {
  const [touched, setTouched] = useState<number | null>(null);

  const { days, most } = useMemo(() => {
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const last = startOfToday.getTime();
    const span = WEEKS * 7;
    const counts = new Map<number, number>();
    for (const row of rows) {
      const at = new Date(row.date);
      if (Number.isNaN(at.getTime())) continue;
      at.setHours(0, 0, 0, 0);
      const key = at.getTime();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const days = Array.from({ length: span }, (_, i) => {
      const at = last - (span - 1 - i) * DAY;
      return { at, commits: counts.get(at) ?? 0 };
    });
    return { days, most: Math.max(1, ...days.map((d) => d.commits)) };
  }, [rows, now]);

  // Five steps of the one hue. Ordered by construction, so the ramp cannot
  // come out non-monotonic the way a hand-picked set can.
  const step = (n: number) => {
    if (n === 0) return "color-mix(in srgb, var(--border) 20%, transparent)";
    const share = Math.ceil((n / most) * 4);
    return `color-mix(in srgb, var(--panel-hue, var(--chart-1)) ${[26, 48, 72, 100][share - 1]}%, transparent)`;
  };

  const showing = touched === null ? null : days[touched];

  return (
    <div className="m-cal">
      <div className="m-cal-grid">
        {days.map((day, i) => (
          <button
            key={day.at}
            className={`m-cal-day${touched === i ? " touched" : ""}`}
            style={{ background: step(day.commits) }}
            onClick={() => setTouched(touched === i ? null : i)}
            aria-label={`${day.commits} on ${new Date(day.at).toLocaleDateString()}`}
          />
        ))}
      </div>
      <p className="muted small m-cal-note">
        {showing
          ? `${showing.commits} change${showing.commits === 1 ? "" : "s"} on ${new Date(showing.at).toLocaleDateString()}`
          : `Last ${WEEKS} weeks · tap a day`}
      </p>
    </div>
  );
}

function WeekBars({ weeks }: { weeks: { startsAt: number; commits: number }[] }) {
  const [touched, setTouched] = useState<number | null>(null);
  const tallest = Math.max(1, ...weeks.map((w) => w.commits));
  const showing = touched === null ? null : weeks[touched];

  return (
    <div className="m-weeks">
      <div className="m-weeks-plot">
        {weeks.map((week, i) => (
          <button
            key={week.startsAt}
            className={`m-week${touched === i ? " touched" : ""}`}
            onClick={() => setTouched(touched === i ? null : i)}
            aria-label={`${week.commits} changes in the week of ${new Date(week.startsAt).toLocaleDateString()}`}
          >
            <span
              className="m-week-bar"
              style={{ height: `${(week.commits / tallest) * 100}%` }}
            />
          </button>
        ))}
      </div>
      <p className="m-weeks-note muted small">
        {showing
          ? `${showing.commits} change${showing.commits === 1 ? "" : "s"} in the week of ${new Date(showing.startsAt).toLocaleDateString()}`
          : `Last ${WEEKS} weeks · tap a column`}
      </p>
    </div>
  );
}

/**
 * Every lock on the project, longest held first. The one panel here that is
 * about right now rather than about the past, and the one most likely to
 * start a conversation.
 */
function HeldFor({ now }: { now: number }) {
  const locks = useLocks(true);

  const held = useMemo(() => {
    const all = [
      ...(locks.data?.ours ?? []).map((l) => ({ lock: l, mine: true })),
      ...(locks.data?.theirs ?? []).map((l) => ({ lock: l, mine: false })),
    ];
    return all
      .map(({ lock, mine }) => {
        const since = lock.locked_at ? new Date(lock.locked_at).getTime() : now;
        return {
          path: lock.path,
          name: lock.path.split("/").pop() ?? lock.path,
          who: lock.owner?.name ?? "someone",
          mine,
          hours: Math.max(0, (now - since) / 3_600_000),
        };
      })
      .sort((a, b) => b.hours - a.hours);
  }, [locks.data, now]);

  if (locks.isLoading) return <Spinner />;
  if (held.length === 0) {
    return <p className="muted small">Nobody is holding anything right now.</p>;
  }

  const longest = Math.max(1, ...held.map((h) => h.hours));

  return (
    <ul className="m-rank">
      {held.slice(0, 12).map((item) => (
        <li key={item.path}>
          <span className="m-rank-label">
            <span className="m-rank-name">
              {item.name} <span className="muted">· {item.mine ? "you" : item.who}</span>
            </span>
            <span className="m-rank-count">{heldFor(item.hours)}</span>
          </span>
          <span className="m-rank-track">
            <span
              className={`m-rank-bar${item.mine ? " mine" : ""}`}
              style={{ width: `${Math.max(2, (item.hours / longest) * 100)}%` }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

function heldFor(hours: number): string {
  if (hours < 1) return "just now";
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * Files that keep coming back. Either the hard part of the design or the part
 * nobody agrees on, and on a CAD project it is usually worth knowing which.
 */
function Reworked() {
  const reworked = useReworked(true);

  if (reworked.isLoading) return <Spinner label="Reading what keeps changing..." />;
  if (reworked.isError) {
    return <Trouble error={reworked.error} onRetry={() => reworked.refetch()} />;
  }
  const files = reworked.data ?? [];
  if (files.length === 0) return <p className="muted small">Not enough history yet.</p>;

  const most = Math.max(1, ...files.map((f) => f.changes));

  return (
    <ul className="m-rank">
      {files.slice(0, 12).map((file) => (
        <li key={file.path}>
          <span className="m-rank-label">
            <span className="m-rank-name">
              <span className={`m-filetype${file.is_cad ? " cad" : ""} m-inline`}>
                <FileTypeIcon path={file.path} size={13} />
              </span>
              {file.path.split("/").pop()}
            </span>
            <span className="m-rank-count">
              {file.changes}
              <span className="muted"> · {file.people}p</span>
            </span>
          </span>
          <span className="m-rank-track">
            <span
              className="m-rank-bar"
              style={{ width: `${Math.max(2, (file.changes / most) * 100)}%` }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}
