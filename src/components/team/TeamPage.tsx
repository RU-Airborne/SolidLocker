import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getBranchOverview,
  getLocks,
  listPulls,
  type PullSummary,
} from "../../api";
import type { BranchSummary, Lock, LocksResult } from "../../types";
import { useCollisions } from "../../queries";
import { usePeople } from "../../identity";
import { BranchName } from "../common/BranchName";
import { FilePreview } from "../common/FilePreview";
import { UserAvatar } from "../common/UserAvatar";
import { PullRequestGlyph } from "../common/HistoryDiagrams";

const DAY = 86400;

function ago(unixS: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unixS);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < DAY) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / DAY);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

interface Bench {
  key: string;
  name: string;
  login: string | null;
  avatar: string | null;
  isMe: boolean;
  locks: Lock[];
  branches: BranchSummary[];
  pulls: PullSummary[];
  lastActive: number;
}

export function TeamPage({
  currentBranch,
  username,
  onClose,
  onOpenPulls,
  onOpenBranches,
}: {
  currentBranch: string;
  username: string | null;
  onClose: () => void;
  onOpenPulls: () => void;
  onOpenBranches: () => void;
}) {
  const people = usePeople();
  const locks = useQuery<LocksResult>({
    queryKey: ["locks"],
    queryFn: getLocks,
    staleTime: 30_000,
  });
  const overview = useQuery({
    queryKey: ["branchOverview"],
    queryFn: getBranchOverview,
    staleTime: 30_000,
  });
  const pulls = useQuery<PullSummary[]>({
    queryKey: ["pulls"],
    queryFn: listPulls,
    staleTime: 60_000,
    retry: false,
  });
  const collisions = useCollisions(currentBranch, true);

  // branch -> how many CAD files it shares with the branch checked out here
  const overlap = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of collisions.data ?? []) {
      if (c.cad_files.length > 0) m.set(c.branch, c.cad_files.length);
    }
    return m;
  }, [collisions.data]);

  const benches = useMemo(() => {
    const out = new Map<string, Bench>();
    const meName = username ? (people.nameFor(username) ?? username) : null;

    // Locks know logins, branches only know commit names
    const bench = (name: string, login: string | null): Bench => {
      const key = (login ?? name).toLowerCase();
      const alias = name.toLowerCase();
      const found = out.get(key) ?? out.get(alias);
      if (found) {
        if (login && !found.login) {
          found.login = login;
          found.avatar = found.avatar ?? people.avatarFor(login);
          if (username && login.toLowerCase() === username.toLowerCase()) {
            found.isMe = true;
          }
        }
        return found;
      }
      const b: Bench = {
        key,
        name,
        login,
        avatar: login ? people.avatarFor(login) : null,
        isMe:
          !!username &&
          (login?.toLowerCase() === username.toLowerCase() ||
            (!!meName && alias === meName.toLowerCase())),
        locks: [],
        branches: [],
        pulls: [],
        lastActive: 0,
      };
      out.set(key, b);
      if (alias !== key) out.set(alias, b);
      return b;
    };
    const touched = (b: Bench, iso: string | null) => {
      if (!iso) return;
      const t = Math.floor(Date.parse(iso) / 1000);
      if (Number.isFinite(t)) b.lastActive = Math.max(b.lastActive, t);
    };

    for (const l of locks.data?.theirs ?? []) {
      const login = l.owner?.name;
      if (!login) continue;
      const b = bench(people.nameFor(login) ?? login, login);
      b.locks.push(l);
      touched(b, l.locked_at);
    }
    if (username) {
      for (const l of locks.data?.ours ?? []) {
        const b = bench(meName ?? username, username);
        b.locks.push(l);
        touched(b, l.locked_at);
      }
    }
    for (const br of overview.data ?? []) {
      if (br.is_default) continue;
      const b = bench(br.author, null);
      b.branches.push(br);
      b.lastActive = Math.max(b.lastActive, br.last_commit_at);
    }
    for (const p of pulls.data ?? []) {
      if (p.state !== "open") continue;
      const b = bench(people.nameFor(p.author) ?? p.author, p.author);
      if (!b.avatar && p.author_avatar) b.avatar = p.author_avatar;
      b.pulls.push(p);
      touched(b, p.updated_at);
    }

    const list = [...new Set(out.values())];
    list.sort(
      (a, b) =>
        Number(b.isMe) - Number(a.isMe) ||
        b.lastActive - a.lastActive ||
        a.name.localeCompare(b.name),
    );
    return list;
  }, [locks.data, overview.data, pulls.data, username, people]);

  const now = Math.floor(Date.now() / 1000);
  const heldCount =
    (locks.data?.ours.length ?? 0) + (locks.data?.theirs.length ?? 0);
  const openPulls = (pulls.data ?? []).filter((p) => p.state === "open").length;
  const activeToday = benches.filter(
    (b) => b.lastActive > 0 && now - b.lastActive < DAY,
  ).length;
  const loading = locks.isLoading || overview.isLoading;

  return (
    <main className="settingspage teampage">
      <div className="settingshead">
        <button className="backbtn" onClick={onClose}>
          ← Back
        </button>
        <div className="settingstitle">
          <h2>Who&rsquo;s working on what</h2>
          <span className="muted">
            Held files, branches and waiting merge requests, person by person —
            so nobody steps on anyone&rsquo;s toes.
          </span>
        </div>
      </div>

      <div className="settingsbody">
        <div className="teamstats">
          <div className="teamstat">
            <span className="teamstat-num">{benches.length}</span>
            <span className="teamstat-cap">
              {benches.length === 1 ? "person" : "people"} on the board
            </span>
          </div>
          <div className="teamstat">
            <span className="teamstat-num">{heldCount}</span>
            <span className="teamstat-cap">
              file{heldCount === 1 ? "" : "s"} held
            </span>
          </div>
          <div className="teamstat">
            <span className="teamstat-num">{openPulls}</span>
            <span className="teamstat-cap">
              merge request{openPulls === 1 ? "" : "s"} waiting
            </span>
          </div>
          <div className="teamstat">
            <span className="teamstat-num">{activeToday}</span>
            <span className="teamstat-cap">active today</span>
          </div>
        </div>

        {benches.length === 0 && !loading && (
          <p className="muted teamempty">
            The board is clear: no files held, no branches ahead, nothing
            waiting to merge.
          </p>
        )}

        <div className="teamgrid">
          {benches.map((b) => {
            const idle = now - b.lastActive;
            const pulse =
              b.lastActive === 0
                ? "quiet"
                : idle < DAY
                  ? "today"
                  : idle < 7 * DAY
                    ? "week"
                    : "quiet";
            return (
              <section
                key={b.key}
                className={`teambench pulse-${pulse}${b.isMe ? " me" : ""}`}
              >
                <header className="benchhead">
                  <span className="benchring">
                    <UserAvatar url={b.avatar} name={b.name} size={38} />
                  </span>
                  <div className="benchwho">
                    <strong>
                      {b.name}
                      {b.isMe ? " (you)" : ""}
                    </strong>
                    <span className="muted small">
                      {b.lastActive > 0
                        ? `last seen ${ago(b.lastActive)}`
                        : "no recent activity"}
                    </span>
                  </div>
                </header>

                {b.locks.length > 0 && (
                  <div className="benchsec">
                    <span className="benchcap">
                      Holding {b.locks.length} file
                      {b.locks.length === 1 ? "" : "s"}
                    </span>
                    <ul className="benchfiles">
                      {b.locks.map((l) => (
                        <li key={l.id} title={l.path}>
                          <FilePreview path={l.path} />
                          <span className="benchfile-name">
                            {l.path.split("/").pop() ?? l.path}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {b.branches.length > 0 && (
                  <div className="benchsec">
                    <span className="benchcap">
                      On branch{b.branches.length === 1 ? "" : "es"}
                    </span>
                    <ul className="benchbranches">
                      {b.branches.map((br) => {
                        const shared = overlap.get(br.name);
                        return (
                          <li key={br.name}>
                            <button
                              className="benchbranch"
                              onClick={onOpenBranches}
                              title={br.subject}
                            >
                              <BranchName name={br.name} />
                              {br.name === currentBranch && (
                                <span className="muted small">(here)</span>
                              )}
                              <span className="muted small">
                                {br.ahead > 0 ? `${br.ahead} ahead` : "even"} ·{" "}
                                {ago(br.last_commit_at)}
                              </span>
                            </button>
                            {shared !== undefined &&
                              br.name !== currentBranch && (
                                <span
                                  className="benchwarn"
                                  title={`Changing ${shared} file${shared === 1 ? "" : "s"} that ${currentBranch} is also changing`}
                                >
                                  ⚠ overlaps {currentBranch}
                                </span>
                              )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {b.pulls.length > 0 && (
                  <div className="benchsec">
                    <span className="benchcap">Waiting to merge</span>
                    <ul className="benchpulls">
                      {b.pulls.map((p) => (
                        <li key={p.number}>
                          <button className="benchpull" onClick={onOpenPulls}>
                            <PullRequestGlyph size={13} />
                            <span className="benchpull-title">{p.title}</span>
                            <span className="muted small benchpull-route">
                              <BranchName name={p.head} /> →{" "}
                              <BranchName name={p.base} />
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {b.locks.length === 0 &&
                  b.branches.length === 0 &&
                  b.pulls.length === 0 && (
                    <p className="muted small benchidle">Nothing in flight.</p>
                  )}
              </section>
            );
          })}
        </div>

        <p className="muted small teamfoot">
          Locks are live; branches and merge requests refresh with sync. A
          bright ring means activity today, a faint one this week.
        </p>
      </div>
    </main>
  );
}
