import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import * as api from "../api";
import { useBranches, useGraph } from "../queries";
import {
  BranchName,
  Empty,
  FileTypeIcon,
  Sheet,
  Spinner,
  Trouble,
  UserAvatar,
} from "../components";
import { BranchRailway } from "../../components/progress/BranchRailway";
import {
  computeLaneSlots,
  layoutGraph,
  routeSets,
} from "../../components/history/HistoryPage";
import type { GraphCommit as DesktopCommit } from "../../api";
import type { BranchSummary } from "../../types";
import { formatDateTime, formatChanged } from "../../dates";

/**
 * The railway, full screen.
 *
 * The same component the desktop draws, not a phone-shaped imitation of it.
 * The map is wider than any phone, so it lives in its own tab where it can
 * have the whole screen and scroll sideways, and the branch list underneath
 * is how you find a line worth following rather than hunting for it.
 */
export function BranchesTab() {
  const graph = useGraph(true);
  const branches = useBranches(true);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [openCommit, setOpenCommit] = useState<string | null>(null);

  // The railway was written against the desktop's commit shape. The two
  // differ only in fields it never reads, so this is a rename, not a
  // conversion.
  const commits: DesktopCommit[] = useMemo(
    () =>
      (graph.data ?? []).map((c) => ({
        sha: c.sha,
        parents: c.parents,
        author_name: c.author_login || c.author_name,
        author_email: "",
        date: c.date,
        subject: c.subject,
        refs: c.refs,
        body: "",
        is_head: c.is_head,
      })),
    [graph.data],
  );

  const { rows, laneCount } = useMemo(() => layoutGraph(commits), [commits]);
  const routes = useMemo(() => routeSets(commits), [commits]);
  const { slots } = useMemo(
    () => computeLaneSlots(rows, routes, laneCount),
    [rows, routes, laneCount],
  );

  // The railway wants the desktop's branch summary. Ahead/behind are a call
  // per branch and the map does not read them, so they stay at zero here.
  const summaries: BranchSummary[] = useMemo(
    () =>
      (branches.data ?? []).map((b) => ({
        name: b.name,
        last_commit_at: b.last_commit_at,
        author: b.author,
        subject: b.subject,
        ahead: 0,
        behind: 0,
        is_default: b.is_default,
        forked_at: 0,
      })),
    [branches.data],
  );

  return (
    <div className="m-screen">
      <header className="m-head">
        <h1>Branches</h1>
        {highlight && (
          <button className="m-linkbtn" onClick={() => setHighlight(null)}>
            Show all
          </button>
        )}
      </header>

      <div className="m-scroll m-railtab">
        {graph.isLoading && <Spinner label="Drawing the railway…" />}
        {graph.isError && (
          <Trouble error={graph.error} onRetry={() => graph.refetch()} />
        )}

        {rows.length > 0 && (
          <>
            <p className="muted small m-railhint">
              Newest at the right. Drag the map sideways, tap a stop to open
              that change.
            </p>
            <BranchRailway
              rows={rows}
              laneCount={laneCount}
              branches={summaries}
              highlight={highlight}
              routes={routes}
              slots={slots}
              onOpenCommit={setOpenCommit}
              onClearHighlight={() => setHighlight(null)}
            />
          </>
        )}

        <h3 className="m-subhead">
          Every branch{" "}
          {branches.data && <span className="m-count">{branches.data.length}</span>}
        </h3>
        {branches.isLoading && <Spinner />}
        {branches.data?.length === 0 && <Empty title="No branches yet" />}

        {(branches.data ?? []).map((b) => (
          <button
            key={b.name}
            className={`m-row m-branch${highlight === b.name ? " here" : ""}`}
            onClick={() => setHighlight(highlight === b.name ? null : b.name)}
          >
            <span className="m-row-main">
              <span className="m-row-title">
                <BranchName name={b.name} isDefault={b.is_default} />
                {b.is_default && <span className="m-tag">default</span>}
                {b.protected && <span className="m-tag">protected</span>}
              </span>
              <span className="muted small">
                {b.subject || "Nothing of its own yet"}
              </span>
            </span>
            {highlight === b.name && (
              <span className="m-here-mark">Lit</span>
            )}
          </button>
        ))}
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
      {detail.isLoading && <Spinner label="Reading the change…" />}
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
            {commit.date && ` · ${formatChanged(new Date(commit.date).getTime())}`}
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
