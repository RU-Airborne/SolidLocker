import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getBranchOverview } from "../../api";
import {
  formatPerson,
  resolveAuthorsByName,
  useIdentities,
} from "../../identity";
import { BranchName, useBranchColors } from "../common/BranchName";
import { BranchGlyph } from "../common/HistoryDiagrams";
import { UserAvatar } from "../common/UserAvatar";

function ago(unixS: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unixS);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

export function OffBranchFileDialog({
  path,
  branches,
  currentBranch,
  switchingTo,
  switching,
  onGo,
  onClose,
}: {
  path: string;
  branches: string[];
  currentBranch: string;
  switchingTo: string | null;
  switching: boolean;
  onGo: (branch: string) => void;
  onClose: () => void;
}) {
  const name = path.split("/").pop() ?? path;
  const overview = useQuery({
    queryKey: ["branchOverview"],
    queryFn: getBranchOverview,
    staleTime: 30_000,
  });
  const identities = useIdentities();
  const branchColorOf = useBranchColors();
  const authors = useMemo(
    () =>
      resolveAuthorsByName(
        (overview.data ?? []).map((b) => b.author),
        identities.data ?? [],
      ),
    [overview.data, identities.data],
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>That file is on another branch</h2>
        <p>
          <strong>{name}</strong> is not part of{" "}
          <BranchName name={currentBranch} />, the branch you are on, so it
          cannot be shown in the file list here. It lives on{" "}
          {branches.length === 1 ? "this branch" : "these branches"}:
        </p>
        <ul className="filelist offbranch-list">
          {branches.map((br) => {
            const info = (overview.data ?? []).find((b) => b.name === br);
            const person = info
              ? authors.get(info.author.toLowerCase())
              : undefined;
            return (
              <li key={br} className="offbranch-goto">
                <span className="offbranch-where">
                  <span className="branchline">
                    <span
                      className="branchmark"
                      style={{ color: branchColorOf(br) }}
                      aria-hidden="true"
                    >
                      <BranchGlyph size={13} />
                    </span>
                    <BranchName name={br} />
                  </span>
                  {info && (
                    <span className="muted small offbranch-when">
                      <UserAvatar
                        url={person?.avatarUrl ?? null}
                        name={person?.name ?? info.author}
                        size={16}
                      />
                      {formatPerson(
                        person?.name ?? info.author,
                        person?.login ?? null,
                      )}
                      , {ago(info.last_commit_at)}
                    </span>
                  )}
                </span>
                <button disabled={switching} onClick={() => onGo(br)}>
                  {switchingTo === br ? "Switching…" : "Take me there"}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="muted small">
          Switching branches replaces your current files on the disk with the versions from the selected branch. 
          Make sure to save and share your work before switching. Any files open in SolidWorks will need to be closed 
          and reopened to show the updated versions.
        </p>
        <div className="modal-actions">
          <button onClick={onClose}>Stay here</button>
        </div>
      </div>
    </div>
  );
}
