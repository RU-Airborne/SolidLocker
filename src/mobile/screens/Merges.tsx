import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";

import * as api from "../api";
import { usePull, usePulls } from "../queries";
import {
  BranchName,
  Confirm,
  Empty,
  FileTypeIcon,
  Flash,
  Segmented,
  Sheet,
  Spinner,
  Trouble,
  useFlash,
  UserAvatar,
} from "../components";
import { formatAgo, formatDateTime } from "../../dates";

type Which = "open" | "done";

/**
 * Merge requests, which are the one part of the desktop app that was already
 * pure GitHub. Reviewing a CAD change on a phone is not the same as opening
 * the assembly, but approving a change you have already looked at, or saying
 * "not yet" before someone merges it, is exactly the sort of thing that
 * should not have to wait until you are back at your desk.
 */
export function Merges({ canPush }: { canPush: boolean }) {
  const pulls = usePulls(true);
  const [which, setWhich] = useState<Which>("open");
  const [open, setOpen] = useState<number | null>(null);

  const { live, done } = useMemo(() => {
    const all = pulls.data ?? [];
    return {
      live: all.filter((p) => p.state === "open"),
      done: all.filter((p) => p.state !== "open"),
    };
  }, [pulls.data]);

  const shown = which === "open" ? live : done;

  return (
    <div className="m-screen">
      <header className="m-head">
        <h1>Merge requests</h1>
      </header>

      <div className="m-head-tools">
        <Segmented
          value={which}
          onChange={setWhich}
          options={[
            { value: "open", label: "Waiting", count: live.length },
            { value: "done", label: "Dealt with" },
          ]}
        />
      </div>

      <div className="m-scroll">
        {pulls.isLoading && <Spinner label="Reading merge requests…" />}
        {pulls.isError && (
          <Trouble error={pulls.error} onRetry={() => pulls.refetch()} />
        )}
        {pulls.data && shown.length === 0 && (
          <Empty
            title={which === "open" ? "Nothing waiting" : "Nothing here yet"}
            hint={
              which === "open"
                ? "Every branch has either been merged or is still being worked on."
                : undefined
            }
          />
        )}

        {shown.map((pull) => (
          <button
            key={pull.number}
            className="m-row m-pull"
            onClick={() => setOpen(pull.number)}
          >
            <StateMark state={pull.state} draft={pull.draft} />
            <span className="m-row-main">
              <span className="m-row-title">{pull.title}</span>
              <span className="muted small">
                #{pull.number} · <BranchName name={pull.head} /> into{" "}
                <BranchName name={pull.base} /> · {formatAgo(pull.updated_at)}
              </span>
            </span>
            <UserAvatar url={pull.author_avatar} name={pull.author} size={26} />
          </button>
        ))}
      </div>

      {open !== null && (
        <PullSheet number={open} canPush={canPush} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

function PullSheet({
  number,
  canPush,
  onClose,
}: {
  number: number;
  canPush: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const pull = usePull(number);
  const [words, setWords] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [trouble, setTrouble] = useState<unknown>(null);
  const [merging, setMerging] = useState(false);
  const [flash, say] = useFlash();

  const detail = pull.data;

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["cloud", "pull", number] });
    queryClient.invalidateQueries({ queryKey: ["cloud", "pulls"] });
  }

  async function send(event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT") {
    setBusy(event);
    setTrouble(null);
    try {
      const asAsked = await api.reviewPull(number, event, words);
      setWords("");
      say(
        asAsked
          ? event === "APPROVE"
            ? "Approved."
            : event === "REQUEST_CHANGES"
              ? "Changes asked for."
              : "Comment posted."
          : "GitHub logged that as a comment: you cannot review your own request.",
      );
      refresh();
    } catch (e) {
      setTrouble(e);
    } finally {
      setBusy(null);
    }
  }

  async function doMerge() {
    setMerging(false);
    setBusy("merge");
    setTrouble(null);
    try {
      await api.mergePull(number, "merge");
      say("Merged.");
      refresh();
    } catch (e) {
      setTrouble(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet
      title={detail ? `#${number}` : "Loading…"}
      onClose={onClose}
      footer={
        detail && detail.state === "open" && canPush ? (
          <div className="m-review">
            <textarea
              value={words}
              onChange={(e) => setWords(e.target.value)}
              placeholder="Say something about it (needed unless you are approving)"
              rows={2}
            />
            <div className="m-review-buttons">
              <button
                className="m-btn"
                onClick={() => send("COMMENT")}
                disabled={busy !== null || words.trim().length === 0}
              >
                Comment
              </button>
              <button
                className="m-btn m-btn-warn"
                onClick={() => send("REQUEST_CHANGES")}
                disabled={busy !== null || words.trim().length === 0}
              >
                Not yet
              </button>
              <button
                className="m-btn m-btn-go"
                onClick={() => send("APPROVE")}
                disabled={busy !== null}
              >
                {busy === "APPROVE" ? "…" : "Approve"}
              </button>
            </div>
            <button
              className="m-btn m-btn-wide"
              onClick={() => setMerging(true)}
              disabled={busy !== null || detail.mergeable === false}
            >
              {busy === "merge"
                ? "Merging…"
                : detail.mergeable === false
                  ? "GitHub says this cannot merge cleanly"
                  : "Merge it"}
            </button>
          </div>
        ) : undefined
      }
    >
      {pull.isLoading && <Spinner />}
      {pull.isError && <Trouble error={pull.error} onRetry={() => pull.refetch()} />}
      <Flash message={flash} />

      {detail && (
        <>
          <h3 className="m-pulltitle">{detail.title}</h3>
          <p className="muted small">
            <BranchName name={detail.head} /> into <BranchName name={detail.base} />
            {" · opened "}
            {formatAgo(detail.created_at)} by {detail.author}
          </p>

          {detail.state !== "open" && (
            <p className="m-notice">
              {detail.merged
                ? `Merged ${detail.merged_at ? formatDateTime(detail.merged_at) : ""}${detail.merged_by ? ` by ${detail.merged_by}` : ""}.`
                : "Closed without merging."}
            </p>
          )}

          {detail.body && <p className="m-pullbody">{detail.body}</p>}

          <h3 className="m-subhead">
            Files <span className="m-count">{detail.files.length}</span>
          </h3>
          <ul className="m-pullfiles">
            {detail.files.slice(0, 60).map((file) => (
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
          {detail.files.some((f) => f.is_cad) && (
            <p className="muted small">
              CAD files have no readable diff, here or anywhere. What changed is
              a question for whoever opens the model.
            </p>
          )}

          {detail.comments.length > 0 && (
            <>
              <h3 className="m-subhead">Conversation</h3>
              <ul className="m-comments">
                {detail.comments.map((comment, i) => (
                  <li key={i}>
                    <UserAvatar
                      url={comment.author_avatar}
                      name={comment.author}
                      size={24}
                    />
                    <span className="m-comment-main">
                      <span className="m-comment-who">
                        {comment.author}
                        <span className={`m-verdict m-verdict-${comment.kind}`}>
                          {verdictWord(comment.kind)}
                        </span>
                        <span className="muted small">
                          {formatAgo(comment.created_at)}
                        </span>
                      </span>
                      {comment.body && <span>{comment.body}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {trouble != null && <Trouble error={trouble} />}

          <button
            className="m-linkbtn"
            onClick={() => void openUrl(detail.url).catch(() => {})}
          >
            Open on github.com
          </button>
        </>
      )}

      {merging && detail && (
        <Confirm
          title="Merge this in?"
          confirmLabel="Merge"
          body={
            <p>
              <BranchName name={detail.head} /> goes into{" "}
              <BranchName name={detail.base} />. Everyone will pick it up next
              time they get the latest, and any CAD files it touches will
              change under them.
            </p>
          }
          onCancel={() => setMerging(false)}
          onConfirm={doMerge}
        />
      )}
    </Sheet>
  );
}

function verdictWord(kind: string): string {
  switch (kind) {
    case "approved":
      return "approved";
    case "changes_requested":
      return "asked for changes";
    case "proposal":
      return "proposed";
    default:
      return "";
  }
}

function StateMark({ state, draft }: { state: string; draft: boolean }) {
  const label = draft ? "draft" : state;
  return <span className={`m-pullstate m-pullstate-${label}`} title={label} />;
}
