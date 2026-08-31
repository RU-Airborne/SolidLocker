import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import * as api from "../api";
import { useBranches, useGraph } from "../queries";
import {
  Empty,
  FileTypeIcon,
  Spinner,
  Trouble,
  useBranchColors,
  UserAvatar,
} from "../components";
import {
  computeLaneSlots,
  detailLanesOf,
  DetailRails,
  layoutGraph,
  lineOfRoute,
  litThroughCommit,
  routeSets,
  RowRails,
} from "../../components/history/HistoryPage";
import type { GraphCommit as DesktopCommit } from "../../api";
import { formatChanged, formatDateTime } from "../../dates";
import { formatPerson } from "../../identity";

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
  // Which change is opened out in place. The desktop expands the row rather
  // than covering the map with a sheet, because the point of pressing a stop
  // is to see it in the context of the line it sits on. A sheet hid exactly
  // the drawing you were asking about.
  const [openSha, setOpenSha] = useState<string | null>(null);


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

  /** Who made each change. The commits handed to the layout carry a single
      flattened name because that is all the drawing needs; the row wants the
      display name, the login and the face, so they are kept alongside. */
  const people = useMemo(
    () =>
      new Map(
        (graph.data ?? []).map((c) => [
          c.sha,
          {
            name: c.author_name,
            login: c.author_login,
            avatar: c.author_avatar,
          },
        ]),
      ),
    [graph.data],
  );

  const { rows, laneCount } = useMemo(() => layoutGraph(commits), [commits]);
  const routes = useMemo(() => routeSets(commits), [commits]);
  const { slots, laneX, totalW } = useMemo(
    () => computeLaneSlots(rows, routes, laneCount),
    [rows, routes, laneCount],
  );

  /** The line the pills are following; null lights everything. */
  const pillRoute = highlight ? (routes.repOf.get(highlight) ?? highlight) : null;

  /** What stays bright.

      An open change outranks a followed branch, the same way round as the
      desktop: opening a stop asks "who came this way?", and every branch
      whose history runs through it did, including ones that broke off further
      along. Lighting the followed branch as well would answer a question
      nobody asked. */
  const lit = useMemo(() => {
    if (openSha) return litThroughCommit(rows, routes, openSha);
    return lineOfRoute(rows, routes, pillRoute);
  }, [openSha, pillRoute, routes, rows]);

  /** Which branches the highlight is actually about. A commit belongs to
      every line running through it, so a shared trunk would otherwise light
      branches that merely pass along it. */
  const litRoutes = useMemo(() => {
    if (openSha) return new Set(routes.containedIn.get(openSha) ?? []);
    return pillRoute ? new Set([pillRoute]) : null;
  }, [openSha, pillRoute, routes]);

  /** The newest change on the followed line, which is where to look.

      Only when a branch is being followed: scrolling because a row was opened
      would pull the row out from under the thumb that just pressed it. */
  const firstLit = useMemo(() => {
    if (openSha || !lit) return null;
    return rows.find((r) => lit.has(r.commit.sha))?.commit.sha ?? null;
  }, [openSha, lit, rows]);

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
          onClick={() => {
            setOpenSha(null);
            setHighlight(null);
          }}
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
              // Following a branch and reading one change are two different
              // questions, and the answer to each is a different drawing. Ask
              // one and the other is put away.
              onClick={() => {
                setOpenSha(null);
                setHighlight(on ? null : b.name);
              }}
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
          const open = openSha === c.sha;
          return (
            <div
              key={c.sha}
              data-sha={c.sha}
              className={`m-grow${quiet ? " quiet" : ""}${open ? " open" : ""}`}
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
                style={{ minHeight: ROW }}
                // Only opens the change. Following a line is what the pills
                // are for: having a tap do both meant reading three commits
                // re-lit the list three times, and only for the ones sitting
                // on exactly one line, which looked like it happened at
                // random.
                onClick={() => {
                  setHighlight(null);
                  setOpenSha(open ? null : c.sha);
                }}
                aria-expanded={open}
              >
                <RowRails
                  row={row}
                  open={open}
                  lit={lit}
                  routes={routes}
                  slots={slots[i] ?? new Map()}
                  laneX={laneX}
                  totalW={totalW}
                  rowHeight={ROW}
                  focusRoute={openSha ? null : pillRoute}
                  litRoutes={litRoutes}
                />
                <span className="m-grow-main">
                  <span className="m-grow-subject">{c.subject}</span>
                  <span className="m-grow-meta muted">
                    {/* The face only appears once the change is open. Every
                        row carrying one turned the list into a column of
                        avatars with the history behind it. */}
                    {open && (
                      <UserAvatar
                        url={people.get(c.sha)?.avatar || null}
                        name={people.get(c.sha)?.name ?? c.author_name}
                        size={20}
                      />
                    )}
                    <span className="m-grow-who">
                      {formatPerson(
                        people.get(c.sha)?.name ?? c.author_name,
                        people.get(c.sha)?.login ?? null,
                      )}
                      {c.date &&
                        ` · ${formatChanged(new Date(c.date).getTime())}`}
                    </span>
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

              {open && (
                <div className="gg-open m-grow-open">
                  {/* The rails keep going past the words. Stopping them at the
                      detail broke the line in half at exactly the stop being
                      read, which is the one place it has to stay joined. */}
                  <DetailRails
                    lanes={detailLanesOf(
                      row,
                      slots[i] ?? new Map(),
                      routes,
                      laneX,
                      lit,
                      highlight,
                    )}
                    totalW={totalW}
                  />
                  <CommitDetail
                    sha={c.sha}
                    onBranch={routes.containedIn.get(c.sha) ?? []}
                    colorOf={colorOf}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


/** The rest of a change, opened out under its own stop.

    The row above already carries the face, the person and the message, so
    none of that is repeated here: this is only what would not fit on a line. */
function CommitDetail({
  sha,
  onBranch,
  colorOf,
}: {
  sha: string;
  /** Every branch holding this change, however it reached them. */
  onBranch: string[];
  /** Undefined for a branch with no line of its own, which leaves the name in
      the inherited colour rather than inventing one for it. */
  colorOf: (branch: string) => string | undefined;
}) {
  const detail = useQuery({
    queryKey: ["cloud", "commit", sha],
    queryFn: () => api.getCommit(sha),
    staleTime: Infinity,
  });

  const commit = detail.data;

  return (
    <div className="gg-detail m-cdetail">
      {detail.isLoading && <Spinner label="Reading the change..." />}
      {detail.isError && (
        <Trouble error={detail.error} onRetry={() => detail.refetch()} />
      )}

      {commit && (
        <>
          {commit.body && <p className="m-cdetail-body">{commit.body}</p>}

          <p className="muted small">
            {commit.date && `${formatDateTime(commit.date)} · `}
            {sha.slice(0, 8)}
          </p>

          {onBranch.length > 0 && (
            <p className="muted small m-cdetail-on">
              On{" "}
              {onBranch.map((b, i) => (
                <span key={b}>
                  {i > 0 && ", "}
                  <strong style={{ color: colorOf(b) }}>{b}</strong>
                </span>
              ))}
            </p>
          )}

          <h4 className="m-subhead">
            Files <span className="m-count">{commit.files.length}</span>
          </h4>
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
          {commit.files.length > 80 && (
            <p className="muted small">
              Showing the first 80 of {commit.files.length}.
            </p>
          )}
          {commit.files.some((f) => f.is_cad) && (
            <p className="muted small">
              CAD files have no readable diff. What changed is a question for
              whoever opens the model.
            </p>
          )}
        </>
      )}
    </div>
  );
}
