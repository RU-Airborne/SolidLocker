import { BranchName } from "./BranchName";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  openVersion,
  previewVersion,
  type Conflict,
  type SideInfo,
} from "../../api";
import { formatDateTime } from "../../dates";
import type { Side } from "../../conflictPicks";
import {
  formatPerson,
  resolveCommitAuthors,
  useIdentities,
  type Person,
} from "../../identity";
import { OpenGlyph } from "./OpenGlyph";
import { BranchGlyph, BulbGlyph } from "./HistoryDiagrams";
import { githubAvatarFromEmail, UserAvatar } from "./UserAvatar";
import { ClashRailway, useClashLayout } from "./ClashRailway";

/** A pick someone proposed for one file, read back from the review. */
export interface Proposal {
  side: Side;
  branch: string;
  who: string;
  avatar: string | null;
  when: string;
}
import { useSwIcon, useSwInstalled } from "../dashboard/FileRow";

const shortName = (p: string) => p.split("/").pop() ?? p;
const folder = (p: string) => {
  const at = p.lastIndexOf("/");
  return at < 0 ? "" : p.slice(0, at);
};

function SideCell({
  path,
  info,
  person,
  chosen,
  decided,
  onPick,
  onUnpick,
  onOpenCommit,
  busy,
  color,
  readOnly,
}: {
  path: string;
  info: SideInfo;
  readOnly?: boolean;
  /** Branch colour, used for the kept highlight. */
  color?: string;
  person: Person | undefined;
  chosen: boolean;
  decided: boolean;
  onPick: () => void;
  onUnpick: () => void;
  onOpenCommit?: (sha: string) => void;
  busy: boolean;
}) {
  const shot = useQuery({
    queryKey: ["previewVersion", path, info.git_ref],
    queryFn: () => previewVersion(path, info.git_ref),
    enabled: info.present,
    staleTime: Infinity,
    retry: false,
  });
  const swIcon = useSwIcon();
  const swInstalled = useSwInstalled();
  const [opening, setOpening] = useState(false);
  const isCad = /\.(sldprt|sldasm|slddrw)$/i.test(path);

  const who = person
    ? formatPerson(person.name, person.login)
    : info.author || "unknown";
  const avatar =
    person?.avatarUrl ??
    (info.author_email ? githubAvatarFromEmail(info.author_email) : null);

  return (
    <div
      role="radio"
      tabIndex={busy ? -1 : 0}
      aria-checked={chosen}
      aria-disabled={busy}
      className={`cfcell${chosen ? " keep" : decided ? " drop" : ""}${busy ? " busy" : ""}${readOnly ? " ro" : ""}`}
      style={color ? ({ "--keep": color } as React.CSSProperties) : undefined}
      onClick={() => !busy && (chosen ? onUnpick() : onPick())}
      onKeyDown={(e) => {
        if (!busy && (e.key === " " || e.key === "Enter")) {
          e.preventDefault();
          if (chosen) onUnpick();
          else onPick();
        }
      }}
    >
      {!readOnly && (
        <input
          type="radio"
          className="cfmark"
          checked={chosen}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
        />
      )}
      <span className="cfshot">
        {!info.present ? (
          <span className="cfshot-gone" aria-hidden="true">
            ✕
          </span>
        ) : shot.data ? (
          <img src={shot.data} alt="" draggable={false} />
        ) : (
          <span className="cfshot-none" />
        )}
      </span>
      <span className="cfwhat">
        <span className="cfsubject">
          {!info.present
            ? "Deleted on this branch"
            : info.subject || "No message recorded"}
        </span>
        {!info.present && (
          <span className="cfwho muted small">
            Keeping this side removes the file
          </span>
        )}
        {info.full_sha && (
          <span className="cfwho muted small">
            <span className="cfperson">
              <UserAvatar url={avatar} name={who} size={16} />
              <span>{who}</span>
            </span>
            {info.date && (
              <span className="cfwhen">{formatDateTime(info.date)}</span>
            )}
            {info.sha && <span className="cfwhen">{info.sha}</span>}
          </span>
        )}
      </span>
      <span className="cfactions">
        {info.present && (
          <button
            type="button"
            className="cfview"
            disabled={opening}
            title="Open a read-only copy of this version"
            onClick={(e) => {
              e.stopPropagation();
              setOpening(true);
              openVersion(path, info.git_ref).finally(() => setOpening(false));
            }}
          >
            <span className="cfview-icon" aria-hidden="true">
              <OpenGlyph />
              {isCad && <img className="badgeicon" src={swIcon} alt="" />}
            </span>
            <span>{isCad && swInstalled ? "Open" : "View"} (read-only)</span>
          </button>
        )}
        {onOpenCommit && info.full_sha && (
          <button
            type="button"
            className="cfview"
            title="Open this commit in Branches"
            onClick={(e) => {
              e.stopPropagation();
              onOpenCommit(info.full_sha);
            }}
          >
            <BranchGlyph />
            <span>Open commit in Branches</span>
          </button>
        )}
      </span>
    </div>
  );
}

/**
 * The clash table: one row per file, a version from each branch, pick one.
 * Picks are local until the host acts on them. The railway card sits above.
 */
export function ConflictPicker({
  files,
  ours,
  theirs,
  picks,
  onChange,
  onOpenCommit,
  busy,
  title,
  intro,
  proposals,
  readOnly,
  at,
}: {
  files: Conflict[];
  ours: string;
  theirs: string;
  picks: Map<string, Side>;
  title?: ReactNode;
  intro?: ReactNode;
  /** Latest proposal per file, from the conversation. */
  proposals?: Map<string, Proposal>;
  readOnly?: boolean;
  /** Tips (and merge commit) of a merge that already happened. */
  at?: { ours: string; theirs: string; merge?: string };
  /** `picks` is mutated in place; this says it changed. */
  onChange: () => void;
  onOpenCommit?: (sha: string) => void;
  busy: boolean;
}) {
  const [litPath, setLitPath] = useState<string | null>(null);
  const railCard = useRef<HTMLElement>(null);
  function light(path: string | null) {
    setLitPath(path);
    if (path !== null) {
      railCard.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }
  const lit = useMemo(() => {
    const c = files.find((f) => f.path === litPath);
    if (!c) return null;
    return new Set([c.mine.full_sha, c.theirs.full_sha].filter(Boolean));
  }, [files, litPath]);

  const identities = useIdentities();
  const { laid } = useClashLayout(ours, theirs, at);
  const colors = laid?.colors;
  const frozen = busy || readOnly === true;
  const people = useMemo(
    () =>
      resolveCommitAuthors(
        files.flatMap((c) =>
          [c.mine, c.theirs]
            .filter((s) => s.full_sha)
            .map((s) => ({
              sha: s.full_sha,
              author_name: s.author,
              author_email: s.author_email,
            })),
        ),
        identities.data ?? [],
      ),
    [files, identities.data],
  );

  function set(path: string, side: Side | null) {
    if (side === null) picks.delete(path);
    else picks.set(path, side);
    onChange();
  }
  function all(side: Side) {
    for (const c of files) picks.set(c.path, side);
    onChange();
  }
  const proposed = files.filter((c) => proposals?.has(c.path));
  function useProposals() {
    for (const c of proposed) picks.set(c.path, proposals!.get(c.path)!.side);
    onChange();
  }

  return (
    <>
      <section className="setupsection cfrailcard" ref={railCard}>
        <h3>Where the two branches are</h3>
        {laid?.unrelated ? (
          <p className="muted">
            <BranchName name={ours} /> and <BranchName name={theirs} /> don&rsquo;t
            share any history, so there is no fork to show. This is the last
            few changes on each. Newest at the right; click a node to open it in
            Branches.
          </p>
        ) : (
          <p className="muted">
            <BranchName name={ours} /> and <BranchName name={theirs} />, back to
            where they parted. Newest at the right; click a node to open it in
            Branches.
          </p>
        )}
        <ClashRailway
          ours={ours}
          theirs={theirs}
          lit={lit}
          people={people}
          onOpenCommit={onOpenCommit}
          at={at}
          onBlankClick={() => light(null)}
        />
      </section>

      <section className="setupsection">
      {title && <h3>{title}</h3>}
      {intro && <p className="muted">{intro}</p>}
      {proposed.length > 0 && !readOnly && (
        <div className="cfproposed">
          <span className="muted small">
            {proposed.length} file{proposed.length === 1 ? " has" : "s have"} a
            proposed pick.
          </span>
          <button type="button" className="cfview" onClick={useProposals} disabled={busy}>
            Accept the proposals
          </button>
        </div>
      )}
      <div className="cftable">
      <div className="cfhead">
        <span className="cfh-file">File</span>
        <span className="cfh-side" style={{ color: colors?.ours }}>
          {ours}
          {!readOnly && (
            <button className="cfall" onClick={() => all("mine")} disabled={busy}>
              keep all
            </button>
          )}
        </span>
        <span className="cfh-side" style={{ color: colors?.theirs }}>
          {theirs}
          {!readOnly && (
            <button className="cfall" onClick={() => all("theirs")} disabled={busy}>
              keep all
            </button>
          )}
        </span>
      </div>

      <div className="cfbody">
        {files.map((c) => {
          const choice = picks.get(c.path);
          const decided = choice !== undefined;
          const isLit = litPath === c.path;
          return (
            <div
              key={c.path}
              className={`cfrow${decided ? " done" : ""}${isLit ? " lit" : ""}`}
              role="radiogroup"
              aria-label={c.path}
            >
              <span className="cffile">
                <strong title={c.path}>{shortName(c.path)}</strong>
                {folder(c.path) && (
                  <span className="muted small">{folder(c.path)}</span>
                )}
                {proposals?.get(c.path) && !readOnly && (
                  <span className="cfproposal muted small">
                    <UserAvatar
                      url={proposals.get(c.path)!.avatar}
                      name={proposals.get(c.path)!.who}
                      size={16}
                    />
                    <span className="cfproposaltext">
                      {proposals.get(c.path)!.who} proposed keeping the version in{" "}
                      <BranchName name={proposals.get(c.path)!.branch} />
                    </span>
                    {picks.get(c.path) !== proposals.get(c.path)!.side && (
                      <button
                        type="button"
                        className="cfview"
                        disabled={busy}
                        onClick={() => set(c.path, proposals.get(c.path)!.side)}
                      >
                        Accept
                      </button>
                    )}
                  </span>
                )}
                <button
                  type="button"
                  className={`cfview cflight${isLit ? " on" : ""}`}
                  aria-pressed={isLit}
                  title="Show this file's last change on each branch in the railway"
                  onClick={() => light(isLit ? null : c.path)}
                >
                  <BulbGlyph />
                  <span>Highlight</span>
                </button>
              </span>
              <SideCell
                path={c.path}
                info={c.mine}
                person={people.get(c.mine.full_sha)}
                chosen={choice === "mine"}
                decided={decided}
                onPick={() => set(c.path, "mine")}
                onUnpick={() => set(c.path, null)}
                onOpenCommit={onOpenCommit}
                busy={frozen}
                color={colors?.ours}
                readOnly={readOnly}
              />
              <SideCell
                path={c.path}
                info={c.theirs}
                person={people.get(c.theirs.full_sha)}
                chosen={choice === "theirs"}
                decided={decided}
                onPick={() => set(c.path, "theirs")}
                onUnpick={() => set(c.path, null)}
                onOpenCommit={onOpenCommit}
                busy={frozen}
                color={colors?.theirs}
                readOnly={readOnly}
              />
            </div>
          );
        })}
      </div>
      </div>
      </section>
    </>
  );
}
