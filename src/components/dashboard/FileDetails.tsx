import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { getFileHistory, getUsedBy, type FileCommit } from "../../api";
import type { RowActions } from "./Dashboard";
import { BranchGlyph } from "../common/HistoryDiagrams";
import {
  formatPerson,
  resolveCommitAuthors,
  useIdentities,
} from "../../identity";
import { githubAvatarFromEmail, UserAvatar } from "../common/UserAvatar";
import { formatDateTime } from "../../dates";
import { RestoreVersionDialog } from "../dialogs/RestoreVersionDialog";

/**
 * Where a file has been. What uses it, who changed it, and the way back to an
 * earlier version.
 */
export function FileDetails({
  path,
  actions,
  indentRem = 0,
  showPath = true,
}: {
  path: string;
  actions: RowActions;
  indentRem?: number;
  showPath?: boolean;
}) {
  const [restoring, setRestoring] = useState<FileCommit | null>(null);

  const usedBy = useQuery({
    queryKey: ["usedBy", path],
    queryFn: () => getUsedBy(path),
    enabled: /\.sldprt$/i.test(path),
    staleTime: 10 * 60_000,
    retry: false,
  });

  const history = useQuery({
    queryKey: ["fileHistory", path],
    queryFn: () => getFileHistory(path),
    staleTime: 60_000,
  });

  const identities = useIdentities();
  const authors = useMemo(
    () => resolveCommitAuthors(history.data ?? [], identities.data ?? []),
    [history.data, identities.data],
  );

  return (
    <>
      <div
        className="filedetail muted small"
        style={indentRem ? { paddingLeft: `${indentRem}rem` } : undefined}
      >
        {showPath && <div className="filedetail-path">{path}</div>}
        {usedBy.data && usedBy.data.length > 0 && (
          <div className="usedby">
            Used by {usedBy.data.length}{" "}
            {usedBy.data.length === 1 ? "assembly" : "assemblies"}:{" "}
            {usedBy.data
              .slice(0, 3)
              .map((p) => p.split("/").pop())
              .join(", ")}
            {usedBy.data.length > 3 ? ` and ${usedBy.data.length - 3} more` : ""}
            . Changing it changes{" "}
            {usedBy.data.length === 1 ? "that one" : "all of them"}.
          </div>
        )}
        {history.isLoading && <div>Reading document history…</div>}
        {history.data && history.data.length > 0 && (
          <ul className="filehistory">
            {history.data.map((c) => {
              const person = authors.get(c.sha);
              return (
                <li key={c.sha}>
                  <span className="fh-author">
                    <UserAvatar
                      url={
                        person?.avatarUrl ??
                        githubAvatarFromEmail(c.author_email)
                      }
                      name={person?.name ?? c.author_name}
                      size={14}
                    />
                    {person
                      ? formatPerson(person.name, person.login)
                      : c.author_name}
                  </span>
                  <span className="fh-msg" title={c.message}>
                    <span className="fh-msgtext">{c.message}</span>
                    <button
                      className="fh-branches"
                      onClick={() => actions.openCommit(c.sha)}
                      title="Open this change on the Branches page"
                    >
                      <BranchGlyph />
                    </button>
                  </span>
                  <span className="fh-date">{formatDateTime(c.date)}</span>
                  <button
                    className="fh-restore"
                    onClick={() => setRestoring(c)}
                    title="Look at this version, and bring it back if it is the one you want"
                  >
                    View…
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {history.isSuccess && history.data?.length === 0 && (
          <div>No shared changes recorded for this file yet.</div>
        )}
      </div>

      {restoring && (
        <RestoreVersionDialog
          path={path}
          commit={restoring}
          branchName={actions.currentBranch}
          onClose={() => setRestoring(null)}
          onDone={(notice, restored) => {
            setRestoring(null);
            actions.notify(notice, restored);
          }}
          onBranchedOff={(branch) => {
            setRestoring(null);
            actions.branchedOff(branch);
          }}
        />
      )}
    </>
  );
}
