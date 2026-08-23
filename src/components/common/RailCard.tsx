import { useQuery } from "@tanstack/react-query";
import { getCommitFiles } from "../../api";
import { formatDateTime } from "../../dates";
import { BranchGlyph } from "./HistoryDiagrams";
import { StatusMark } from "./StatusMark";
import { githubAvatarFromEmail, UserAvatar } from "./UserAvatar";

/** The clicked railway node's commit, floating next to it: message, author,
 *  what it touched, and a jump to the Branches page. */
export function RailCard({
  commit,
  style,
  onOpen,
  who,
  avatar,
}: {
  commit: {
    sha: string;
    subject: string;
    author_name: string;
    author_email: string;
    date: string;
  };
  style: React.CSSProperties;
  onOpen?: () => void;
  /** Resolved display name/avatar, when the host knows better than git. */
  who?: string;
  avatar?: string | null;
}) {
  const files = useQuery({
    queryKey: ["commitFiles", commit.sha],
    queryFn: () => getCommitFiles(commit.sha),
    staleTime: Infinity,
    retry: false,
  });
  const count = (letter: string) =>
    (files.data ?? []).filter((f) => f.status.startsWith(letter)).length;
  const added = count("A");
  const removed = count("D");
  const changed = (files.data?.length ?? 0) - added - removed;
  return (
    <div className="rr-card rr-clickable" style={style}>
      <div className="rr-cardmain">
        <div className="rr-cardsubject">{commit.subject}</div>
        <div className="rr-cardwho muted small">
          <UserAvatar
            url={avatar !== undefined ? avatar : githubAvatarFromEmail(commit.author_email)}
            name={who ?? commit.author_name}
            size={16}
          />
          <span>{who ?? commit.author_name}</span>
        </div>
        <div className="rr-cardwhen muted small">{formatDateTime(commit.date)}</div>
        {onOpen && (
          <button type="button" className="rr-cardbtn" onClick={onOpen}>
            <BranchGlyph />
            <span>Open in Branches</span>
          </button>
        )}
      </div>
      {files.data && files.data.length > 0 && (
        <div className="rr-cardfiles muted small">
          {added > 0 && (
            <span className="rr-cardcount" title={`${added} file${added === 1 ? "" : "s"} added`}>
              <StatusMark status="A" /> {added}
            </span>
          )}
          {changed > 0 && (
            <span className="rr-cardcount" title={`${changed} file${changed === 1 ? "" : "s"} changed`}>
              <StatusMark status="M" /> {changed}
            </span>
          )}
          {removed > 0 && (
            <span className="rr-cardcount" title={`${removed} file${removed === 1 ? "" : "s"} removed`}>
              <StatusMark status="D" /> {removed}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
