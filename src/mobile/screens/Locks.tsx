import { useMemo, useState } from "react";

import * as api from "../api";
import { useLockIndex, useLocks, useRelease } from "../queries";
import {
  Confirm,
  Empty,
  FileTypeIcon,
  Flash,
  Search,
  Spinner,
  Trouble,
  useFlash,
  UserAvatar,
} from "../components";
import { formatAgo } from "../../dates";
import { FileSheet } from "./FileSheet";
import { BranchSheet } from "./Branches";
import { BranchName } from "../components";

/**
 * The screen this whole app exists for: who is holding what, right now.
 *
 * The desktop app buries this in a panel beside the file tree because the
 * file tree is where the work happens. Away from the machine there is no work
 * happening, only the question, so it gets the front page.
 */
export function Locks({
  previewMode,
  canPush,
  branch,
  defaultBranch,
}: {
  previewMode: api.PreviewMode;
  canPush: boolean;
  branch: string;
  defaultBranch: string;
}) {
  const locks = useLocks(true);
  const statusOf = useLockIndex(locks.data);
  const release = useRelease();
  const [needle, setNeedle] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [askingAll, setAskingAll] = useState(false);
  const [pickingBranch, setPickingBranch] = useState(false);
  const [flash, say] = useFlash();

  const q = needle.trim().toLowerCase();
  const mine = useMemo(
    () => (locks.data?.ours ?? []).filter((l) => l.path.toLowerCase().includes(q)),
    [locks.data, q],
  );
  const others = useMemo(
    () => (locks.data?.theirs ?? []).filter((l) => l.path.toLowerCase().includes(q)),
    [locks.data, q],
  );

  const byPerson = useMemo(() => {
    const groups = new Map<string, api.Lock[]>();
    for (const lock of others) {
      const who = lock.owner?.name ?? "Someone";
      const list = groups.get(who) ?? [];
      list.push(lock);
      groups.set(who, list);
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [others]);

  async function giveAllBack() {
    setAskingAll(false);
    const outcomes = await release.mutateAsync(mine.map((l) => l.path));
    const stuck = outcomes.filter((o) => !o.ok).length;
    say(
      stuck === 0
        ? `Gave back ${outcomes.length} file${outcomes.length === 1 ? "" : "s"}.`
        : `${stuck} could not be given back.`,
    );
  }

  return (
    <div className="m-screen">
      <header className="m-head">
        <h1>Locks</h1>
        <button
          className="m-iconbtn"
          onClick={() => locks.refetch()}
          aria-label="Check again"
          disabled={locks.isFetching}
        >
          <RefreshGlyph spinning={locks.isFetching} />
        </button>
      </header>

      <div className="m-head-tools">
        {/* Which branch the locks belong to is the first thing that makes the
            list mean anything, so it sits above the list rather than behind a
            tab of its own. */}
        <button className="m-branchpick" onClick={() => setPickingBranch(true)}>
          <span className="muted small">Reading</span>
          <BranchName name={branch} isDefault={branch === defaultBranch} />
          <span className="m-chevron">›</span>
        </button>
        <Search value={needle} onChange={setNeedle} placeholder="Search held files" />
      </div>

      <Flash message={flash} />

      <div className="m-scroll">
        {locks.isLoading && <Spinner label="Asking who is holding what…" />}
        {locks.isError && (
          <Trouble error={locks.error} onRetry={() => locks.refetch()} />
        )}

        {locks.data && mine.length === 0 && others.length === 0 && (
          <Empty
            title="Nobody is holding anything"
            hint="Every file in the project is free to be picked up."
          />
        )}

        {mine.length > 0 && (
          <>
            <div className="m-groupbar">
              <h2>
                Yours <span className="m-count">{mine.length}</span>
              </h2>
              {canPush && (
                <button
                  className="m-linkbtn"
                  onClick={() => setAskingAll(true)}
                  disabled={release.isPending}
                >
                  Give all back
                </button>
              )}
            </div>
            {mine.map((lock) => (
              <LockRow key={lock.id} lock={lock} onOpen={() => setOpen(lock.path)} />
            ))}
          </>
        )}

        {byPerson.map(([who, held]) => (
          <div key={who}>
            <div className="m-groupbar">
              <h2>
                <UserAvatar
                  url={`https://github.com/${encodeURIComponent(who)}.png?size=48`}
                  name={who}
                  size={22}
                />
                {who} <span className="m-count">{held.length}</span>
              </h2>
            </div>
            {held.map((lock) => (
              <LockRow key={lock.id} lock={lock} onOpen={() => setOpen(lock.path)} />
            ))}
          </div>
        ))}

        {locks.data && !locks.data.fresh && (
          <p className="m-notice">
            This list came from a cache, so it may be behind. Pull again when
            you have a better signal.
          </p>
        )}
      </div>

      {open && (
        <FileSheet
          path={open}
          file={null}
          status={statusOf(open)}
          canPush={canPush}
          previewMode={previewMode}
          onClose={() => setOpen(null)}
        />
      )}

      {pickingBranch && (
        <BranchSheet
          branch={branch}
          defaultBranch={defaultBranch}
          onClose={() => setPickingBranch(false)}
        />
      )}

      {askingAll && (
        <Confirm
          title="Give every lock back?"
          confirmLabel={`Give back ${mine.length}`}
          body={
            <p>
              You are holding {mine.length} file{mine.length === 1 ? "" : "s"}.
              Giving them back lets anyone pick them up. Make sure your machine
              has shared the work first, or it will not be in what they get.
            </p>
          }
          onCancel={() => setAskingAll(false)}
          onConfirm={giveAllBack}
        />
      )}
    </div>
  );
}

function LockRow({ lock, onOpen }: { lock: api.Lock; onOpen: () => void }) {
  const name = lock.path.split("/").pop() ?? lock.path;
  const dir = lock.path.slice(0, lock.path.length - name.length - 1);
  return (
    <button className="m-row m-file" onClick={onOpen}>
      <span className="m-filetype cad">
        <FileTypeIcon path={lock.path} size={18} />
      </span>
      <span className="m-row-main">
        <span className="m-row-title">{name}</span>
        <span className="muted small">
          {dir || "Project root"}
          {lock.locked_at && ` · ${formatAgo(lock.locked_at)}`}
        </span>
      </span>
    </button>
  );
}

function RefreshGlyph({ spinning }: { spinning: boolean }) {
  return (
    <svg
      className={spinning ? "m-spin" : undefined}
      viewBox="0 0 24 24"
      width="19"
      height="19"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M20 11a8 8 0 1 0-2.3 6.3" />
      <path d="M20 5v6h-6" />
    </svg>
  );
}
