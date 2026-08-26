import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import * as api from "../api";
import { useBranches, useGraph } from "../queries";
import {
  Empty,
  FileTypeIcon,
  Sheet,
  Spinner,
  Trouble,
  useBranchColors,
  UserAvatar,
} from "../components";
import {
  computeLaneSlots,
  layoutGraph,
  routeSets,
  RowRails,
} from "../../components/history/HistoryPage";
import type { GraphCommit as DesktopCommit } from "../../api";
import { formatChanged, formatDateTime } from "../../dates";

/**
 * The railway, running down the page, zoomed in.
 *
 * The same drawing as the desktop map - station bars where several lines call
 * at one stop, a bead per line inside them, hollow stops where a line ends,
 * eased crossings - laid out with the lanes across the screen and history
 * running down it.
 *
 * Nothing is written on it. A map with a commit message beside every stop is
 * a list with a diagram stuck to the side; this is a diagram, and the stop
 * you press is what tells you.
 *
 * The zoom is real magnification, not bigger numbers: the rails are drawn at
 * the pitch they were designed for and the whole thing is scaled, so the
 * geometry stays exactly as it is on a desktop and only gets larger.
 */

/**
 * How tall a row of rail is drawn.
 *
 * The desktop lays its rows out at 34, which is comfortable with a mouse and
 * a big screen and far too tight for a thumb and a readable font. The rails
 * are drawn taller rather than magnified: scaling left hairline seams between
 * rows wherever a boundary landed on a fractional device pixel, which is what
 * made the lines look broken.
 */
const ROW = 52;

export function BranchesTab({ corner }: { corner: React.ReactNode }) {
  const graph = useGraph(true);
  const branches = useBranches(true);
  const colorOf = useBranchColors();
  const [highlight, setHighlight] = useState<string | null>(null);
  const [openCommit, setOpenCommit] = useState<string | null>(null);


  // `is_head` is deliberately false throughout: on a desktop it marks where
  // your checkout stands and draws a "You are here" halo. Nothing is checked
  // out on a phone, so it would be pointing at a place that does not exist.
  const commits: DesktopCommit[] = useMemo(
    () =>
      (graph.data ?? []).map((c) => ({
        sha: c.sha,
        parents: c.parents,
        author_name: c.author_login || c.author_name,
        author_email: c.author_email,
        date: c.date,
        subject: c.subject,
        refs: c.refs,
        body: "",
        is_head: false,
      })),
    [graph.data],
  );

  const { rows, laneCount } = useMemo(() => layoutGraph(commits), [commits]);
  const routes = useMemo(() => routeSets(commits), [commits]);
  const { slots, laneX, totalW } = useMemo(
    () => computeLaneSlots(rows, routes, laneCount),
    [rows, routes, laneCount],
  );

  /** Every commit the followed branch's line runs through; null lights all. */
  const lit = useMemo(() => {
    if (!highlight) return null;
    const route = routes.repOf.get(highlight) ?? highlight;
    const on = new Set<string>();
    for (const row of rows) {
      if ((routes.bySha.get(row.commit.sha) ?? []).includes(route)) {
        on.add(row.commit.sha);
      }
    }
    const from = routes.forkPoint.get(route);
    if (from) on.add(from);
    return on.size > 0 ? on : null;
  }, [highlight, routes, rows]);

  const litRoutes = useMemo(
    () => (highlight ? new Set([routes.repOf.get(highlight) ?? highlight]) : null),
    [highlight, routes],
  );

  /** The newest change on the followed line, which is where to look. */
  const firstLit = useMemo(() => {
    if (!lit) return null;
    return rows.find((r) => lit.has(r.commit.sha))?.commit.sha ?? null;
  }, [lit, rows]);

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!firstLit) return;
    const row = listRef.current?.querySelector(`[data-sha="${firstLit}"]`);
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [firstLit]);

  return (
    <div className="m-screen">
      <header className="m-head">
        <h1>Branches</h1>
        {corner}
      </header>

      {/* One line of pills that scrolls sideways, like the map under it. A
          list down the page would have taken the room the map needs. */}
      <div className="m-pills" role="tablist" aria-label="Follow a branch">
        <button
          role="tab"
          aria-selected={highlight === null}
          className={`m-pill${highlight === null ? " on" : ""}`}
          onClick={() => setHighlight(null)}
        >
          All
        </button>
        {(branches.data ?? []).map((b) => {
          const on = highlight === b.name;
          const hue = colorOf(b.name);
          return (
            <button
              key={b.name}
              role="tab"
              aria-selected={on}
              className={`m-pill${on ? " on" : ""}`}
              style={{
                borderColor: hue,
                background: on ? hue : undefined,
                color: on ? "#fff" : hue,
              }}
              onClick={() => setHighlight(on ? null : b.name)}
            >
              {b.name}
            </button>
          );
        })}
      </div>

      <div className="m-scroll m-graph" ref={listRef}>
        {graph.isLoading && <Spinner label="Drawing the railway..." />}
        {graph.isError && (
          <Trouble error={graph.error} onRetry={() => graph.refetch()} />
        )}
        {graph.data?.length === 0 && <Empty title="No history yet" />}

        {rows.map((row, i) => {
          const c = row.commit;
          const its = routes.bySha.get(c.sha) ?? [];
          const tips = c.refs.filter((r) => r !== "HEAD");
          const quiet = lit !== null && !lit.has(c.sha);
          return (
            <div
              key={c.sha}
              data-sha={c.sha}
              className={`m-grow${quiet ? " quiet" : ""}`}
              style={
                {
                  // The row takes the colour of the line it sits on, which is
                  // what tints it when it is the one being followed.
                  "--lane":
                    its.length === 1 ? colorOf(its[0]!) : "var(--muted)",
                } as React.CSSProperties
              }
            >
              <button
                className="m-grow-line"
                style={{ height: ROW }}
                // Only opens the change. Following a line is what the pills
                // are for: having a tap do both meant reading three commits
                // re-lit the list three times, and only for the ones sitting
                // on exactly one line, which looked like it happened at
                // random.
                onClick={() => setOpenCommit(c.sha)}
              >
                <RowRails
                  row={row}
                  lit={lit}
                  routes={routes}
                  slots={slots[i] ?? new Map()}
                  laneX={laneX}
                  totalW={totalW}
                  rowHeight={ROW}
                  focusRoute={
                    highlight ? (routes.repOf.get(highlight) ?? null) : null
                  }
                  litRoutes={litRoutes}
                />
                <span className="m-grow-main">
                  <span className="m-grow-subject">{c.subject}</span>
                  <span className="m-grow-meta muted">
                    {c.author_name}
                    {c.date && ` · ${formatChanged(new Date(c.date).getTime())}`}
                  </span>
                </span>
                {tips.length > 0 && (
                  <span className="m-grow-refs">
                    {tips.slice(0, 2).map((ref) => (
                      <span
                        key={ref}
                        className="m-reftag"
                        style={{ color: colorOf(ref), borderColor: colorOf(ref) }}
                      >
                        {ref}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {openCommit && (
        <CommitSheet sha={openCommit} onClose={() => setOpenCommit(null)} />
      )}
    </div>
  );
}


/** One stop on the railway: what changed, who changed it, and when. */
function CommitSheet({ sha, onClose }: { sha: string; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ["cloud", "commit", sha],
    queryFn: () => api.getCommit(sha),
    staleTime: Infinity,
  });

  const commit = detail.data;

  return (
    <Sheet title={sha.slice(0, 8)} onClose={onClose}>
      {detail.isLoading && <Spinner label="Reading the change..." />}
      {detail.isError && (
        <Trouble error={detail.error} onRetry={() => detail.refetch()} />
      )}

      {commit && (
        <>
          <h3 className="m-pulltitle">{commit.message}</h3>
          <p className="m-holder muted small">
            <UserAvatar
              url={commit.author_avatar || null}
              name={commit.author_name || commit.author_login}
              size={22}
            />
            {commit.author_login || commit.author_name}
            {commit.date && ` · ${formatDateTime(commit.date)}`}
          </p>
          {commit.body && <p className="m-pullbody">{commit.body}</p>}

          <h3 className="m-subhead">
            Files <span className="m-count">{commit.files.length}</span>
          </h3>
          <ul className="m-pullfiles">
            {commit.files.slice(0, 80).map((file) => (
              <li key={file.path}>
                <span className={`m-filetype${file.is_cad ? " cad" : ""}`}>
                  <FileTypeIcon path={file.path} size={16} />
                </span>
                <span className="m-pullfile-name">{file.path}</span>
                <span className={`m-status m-status-${file.status}`}>
                  {file.status}
                </span>
              </li>
            ))}
          </ul>
          {commit.files.some((f) => f.is_cad) && (
            <p className="muted small">
              CAD files have no readable diff. What changed is a question for
              whoever opens the model.
            </p>
          )}
        </>
      )}
    </Sheet>
  );
}
