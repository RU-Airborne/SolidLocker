import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { locateLockPaths } from "../../api";
import type { Lock, LocksResult } from "../../types";
import { FilePreview } from "../common/FilePreview";
import { UserAvatar } from "../common/UserAvatar";
import { formatPerson, usePeople } from "../../identity";
import { copy } from "../../copy";

function heldFor(lockedAt: string | null): string {
  if (!lockedAt) return "";
  const ms = Date.now() - new Date(lockedAt).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

interface PersonLocks {
  name: string;
  isMe: boolean;
  locks: Lock[];
}


export function LocksPanel({
  locks,
  lockError,
  knownPaths,
  onSelectFile,
  onForceRelease,
}: {
  locks: LocksResult | undefined;
  lockError: string | null;
  knownPaths: Set<string>;
  onSelectFile: (path: string) => void;
  onForceRelease: (lock: Lock) => void;
}) {
  const offBranchPaths = useMemo(
    () =>
      [...(locks?.ours ?? []), ...(locks?.theirs ?? [])]
        .map((l) => l.path)
        .filter((p) => !knownPaths.has(p.toLowerCase()))
        .sort(),
    [locks, knownPaths],
  );

  const locations = useQuery({
    queryKey: ["lockLocations", offBranchPaths],
    queryFn: () => locateLockPaths(offBranchPaths),
    enabled: offBranchPaths.length > 0,
    staleTime: 5 * 60_000,
  });
  const directory = usePeople();

  const people: PersonLocks[] = useMemo(() => {
    if (!locks) return [];
    const byName = new Map<string, PersonLocks>();
    const add = (lock: Lock, isMe: boolean) => {
      const name = lock.owner?.name ?? "unknown";
      const entry = byName.get(name.toLowerCase());
      if (entry) entry.locks.push(lock);
      else byName.set(name.toLowerCase(), { name, isMe, locks: [lock] });
    };
    for (const lock of locks.ours) add(lock, true);
    for (const lock of locks.theirs) add(lock, false);
    return [...byName.values()].sort(
      (a, b) => Number(b.isMe) - Number(a.isMe) || b.locks.length - a.locks.length,
    );
  }, [locks]);

  return (
    <div className="lockslist">
      {lockError && (
        <p className="warn-inline">{copy.locksUnavailable(lockError)}</p>
      )}
      {!lockError && locks && !locks.fresh && (
        <p className="warn-inline">{copy.locksMayBeStale}</p>
      )}
      {!lockError && people.length === 0 && (
        <p className="muted">No files are locked right now.</p>
      )}
      {people.map((person) => (
        <div key={person.name} className="personlocks">
          <div className="personhead">
            <UserAvatar
              url={directory.avatarFor(person.name)}
              name={directory.nameFor(person.name) ?? person.name}
              size={16}
            />
            <strong>
              {formatPerson(
                directory.nameFor(person.name) ?? person.name,
                person.name,
              )}
              {person.isMe ? " · you" : ""}
            </strong>
            <span className="muted small">
              {person.locks.length} file{person.locks.length === 1 ? "" : "s"}
            </span>
          </div>
          <ul className="personfiles">
            {person.locks.map((lock) => {
              const parts = lock.path.split("/");
              const name = parts.pop();
              const folder = parts.join("/");
              const onBranch = knownPaths.has(lock.path.toLowerCase());
              return (
                <li key={lock.id} title={lock.path} className="lockitem">
                  {!person.isMe && (
                    <button
                      className="forcebtn"
                      title="Force unlock this file (admin)"
                      onClick={() => onForceRelease(lock)}
                    >
                      ✕
                    </button>
                  )}
                  <button
                    className="lockjump"
                    disabled={!onBranch}
                    onClick={() => onSelectFile(lock.path)}
                  >
                    <span className="lockname">
                      <FilePreview path={lock.path} className="fthumb lockthumb" />
                      {name}
                    </span>
                    <span className="muted small lockmeta">
                      {folder && (
                        <span className="lockmetatext">{folder}</span>
                      )}
                      {heldFor(lock.locked_at) && (
                        <span className="lockheld">
                          {folder ? `· ${heldFor(lock.locked_at)}` : heldFor(lock.locked_at)}
                        </span>
                      )}
                      {!onBranch &&
                        (() => {
                          const on = locations.data?.[lock.path];
                          if (on && on.length > 0) {
                            return (
                              <span className="offbranch">
                                on {on.slice(0, 2).join(", ")}
                                {on.length > 2 ? "…" : ""}
                              </span>
                            );
                          }
                          return locations.isSuccess ? (
                            <span
                              className="offbranch dangling"
                              title="This lock points at a path that exists on no branch, usually a mistyped command line lock. You may force unlock it."
                            >
                              dangling
                            </span>
                          ) : (
                            <span className="offbranch">not on your branch</span>
                          );
                        })()}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
