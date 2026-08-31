import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import * as api from "../api";
import {
  useClaim,
  useFileHistory,
  useForceUnlock,
  useRelease,
  type LockStatus,
} from "../queries";
import {
  bytes,
  Confirm,
  Spinner,
  Trouble,
  UserAvatar,
} from "../components";
import { formatAgo, formatDateTime } from "../../dates";
import { formatPerson } from "../../identity";
import { isWatched, setWatched } from "../alerts";

/**
 * One file, everything the network knows about it, and the two buttons that
 * matter. What is missing next to the desktop version is everything that
 * needs the file itself to be here: opening it, discarding changes, restoring
 * an old version over the top of it.
 *
 * This opens out under the row it belongs to rather than over the top of the
 * list, the same way a change does on the branches page. A sheet covered the
 * very list you were comparing the file against, and put the file's name in
 * its header a second time when the row above already said it.
 */
export function FileDetail({
  path,
  file,
  status,
  canPush,
}: {
  path: string;
  file: api.CloudFile | null;
  status: LockStatus;
  canPush: boolean;
}) {
  const claim = useClaim();
  const release = useRelease();
  const force = useForceUnlock();
  const [asking, setAsking] = useState(false);
  const [trouble, setTrouble] = useState<unknown>(null);
  const [watching, setWatching] = useState(() => isWatched(path));

  const name = path.split("/").pop() ?? path;
  const dir = path.slice(0, path.length - name.length - 1);

  const preview = useQuery({
    queryKey: ["cloud", "preview", path],
    queryFn: () => api.getPreview(path),
    enabled: file?.is_cad ?? false,
    staleTime: Infinity,
    retry: false,
  });

  const history = useFileHistory(path);
  const working = claim.isPending || release.isPending || force.isPending;

  async function take() {
    setTrouble(null);
    try {
      const result = await claim.mutateAsync([path]);
      if (result.failed.length > 0) {
        setTrouble({ code: "HELD", message: result.failed[0]!.message });
      }
    } catch (e) {
      setTrouble(e);
    }
  }

  async function giveBack() {
    setTrouble(null);
    try {
      const [outcome] = await release.mutateAsync([path]);
      if (outcome && !outcome.ok) {
        setTrouble({ code: outcome.code ?? "LFS", message: outcome.message ?? "" });
      }
    } catch (e) {
      setTrouble(e);
    }
  }

  return (
    <div className="m-fdetail">
      {preview.data && (
        <div className="m-preview">
          <img src={preview.data} alt={`Preview of ${name}`} />
        </div>
      )}

      <dl className="m-facts">
        <dt>Folder</dt>
        <dd>{dir || "Project root"}</dd>
        {file && file.size > 0 && (
          <>
            <dt>Size</dt>
            <dd>{bytes(file.size)}</dd>
          </>
        )}
        <dt>Held by</dt>
        <dd>
          {status.kind === "unlocked" ? (
            <span className="muted">Nobody</span>
          ) : (
            <span className="m-holder">
              <UserAvatar
                url={
                  status.lock.owner
                    ? `https://github.com/${encodeURIComponent(status.lock.owner.name)}.png?size=48`
                    : null
                }
                name={status.lock.owner?.name ?? "?"}
                size={22}
              />
              {status.kind === "mine" ? "You" : status.lock.owner?.name}
              {status.lock.locked_at && (
                <span className="muted small">
                  {" "}
                  since {formatAgo(status.lock.locked_at)}
                </span>
              )}
            </span>
          )}
        </dd>
        {file && !file.lockable && (
          <>
            <dt>Locking</dt>
            <dd className="muted">
              Not set up for this file. The project's .gitattributes does not
              mark it lockable.
            </dd>
          </>
        )}
      </dl>

      {status.kind === "theirs" && (
        <button
          className={`m-watch${watching ? " on" : ""}`}
          onClick={() => {
            setWatched(path, !watching);
            setWatching(!watching);
          }}
        >
          {watching
            ? "You will be told when this comes free"
            : "Tell me when this is free"}
        </button>
      )}

      {trouble != null && <Trouble error={trouble} />}

      <h3 className="m-subhead">Recent changes</h3>
      {history.isLoading && <Spinner />}
      {history.isError && <Trouble error={history.error} />}
      {history.data?.length === 0 && (
        <p className="muted small">No changes on this branch yet.</p>
      )}
      <ul className="m-history">
        {(history.data ?? []).slice(0, 12).map((commit) => (
          <li key={commit.sha}>
            <UserAvatar
              url={commit.author_avatar || null}
              name={commit.author_name || commit.author_login}
              size={22}
            />
            <span className="m-history-main">
              <span>{commit.message}</span>
              <span className="muted small">
                {formatPerson(commit.author_name, commit.author_login)} ·{" "}
                {formatDateTime(commit.date)}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <div className="m-fdetail-actions">
        <Actions
          status={status}
          canPush={canPush}
          lockable={file?.lockable ?? true}
          working={working}
          onTake={take}
          onGiveBack={giveBack}
          onForce={() => setAsking(true)}
        />
      </div>

      {asking && (
        <Confirm
          title="Take this lock off someone?"
          danger
          confirmLabel="Take the lock"
          body={
            <p>
              {status.kind === "theirs" ? status.lock.owner?.name : "Someone"} is
              holding <strong>{name}</strong>. If they have it open and unsaved,
              taking the lock now means their work has nowhere to go. Ask them
              first if you can.
            </p>
          }
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            force.mutate(path, { onError: setTrouble });
          }}
        />
      )}
    </div>
  );
}

function Actions({
  status,
  canPush,
  lockable,
  working,
  onTake,
  onGiveBack,
  onForce,
}: {
  status: LockStatus;
  canPush: boolean;
  lockable: boolean;
  working: boolean;
  onTake: () => void;
  onGiveBack: () => void;
  onForce: () => void;
}) {
  if (!canPush) {
    return (
      <p className="muted small">
        You can look at this project but not change it, so locking is not
        yours to do here.
      </p>
    );
  }
  if (!lockable) {
    return <p className="muted small">This file is not set up for locking.</p>;
  }
  if (status.kind === "mine") {
    return (
      <button className="m-btn m-btn-wide" onClick={onGiveBack} disabled={working}>
        {working ? "Giving it back..." : "Give the lock back"}
      </button>
    );
  }
  if (status.kind === "theirs") {
    return (
      <button className="m-btn m-btn-danger m-btn-wide" onClick={onForce} disabled={working}>
        Take the lock off {status.lock.owner?.name ?? "them"}
      </button>
    );
  }
  return (
    <button className="m-btn m-btn-go m-btn-wide" onClick={onTake} disabled={working}>
      {working ? "Taking it..." : "Take the lock"}
    </button>
  );
}
