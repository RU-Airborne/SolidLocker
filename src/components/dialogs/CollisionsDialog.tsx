import { useQuery } from "@tanstack/react-query";
import { BranchName } from "../common/BranchName";
import { previewVersion, type Collision } from "../../api";
import { formatDateTime } from "../../dates";
import { FilePreview } from "../common/FilePreview";
import { FileTypeIcon } from "../common/FileTypeIcon";

function TheirShot({ path, branch }: { path: string; branch: string }) {
  const shot = useQuery({
    queryKey: ["previewVersion", path, "origin/" + branch],
    queryFn: () => previewVersion(path, "origin/" + branch),
    staleTime: Infinity,
    retry: false,
  });
  return (
    <span className="duelshot" aria-hidden="true">
      {shot.data ? (
        <img src={shot.data} alt="" draggable={false} />
      ) : shot.isLoading ? (
        <span className="duelwait">&hellip;</span>
      ) : (
        <FileTypeIcon path={path} />
      )}
    </span>
  );
}

export function CollisionsDialog({
  collisions,
  currentBranch,
  onOpenBranches,
  onClose,
}: {
  collisions: Collision[];
  currentBranch: string;
  onOpenBranches: () => void;
  onClose: () => void;
}) {
  const total = collisions.reduce((n, c) => n + c.cad_files.length, 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal collisionmodal" onClick={(e) => e.stopPropagation()}>
        <h2>
          {total} file{total === 1 ? "" : "s"} changed on both sides
        </h2>
        <p>
          Each of these is being changed here and on another branch.
          Only one version can be kept when the two are merged.
        </p>

        <div className="collisionlist">
          {collisions.map((c) => (
            <div key={c.branch} className="collisiongroup">
              <div className="collisionwho">
                <BranchName name={c.branch} />
                <span className="muted small">
                  {c.is_mine ? "your own branch" : c.author}
                  {c.last_commit_at > 0 &&
                    ` · last changed ${formatDateTime(
                      new Date(c.last_commit_at * 1000).toISOString(),
                    )}`}
                </span>
              </div>
              <ul className="collisionfiles">
                {c.cad_files.map((f) => (
                  <li key={f} className="collisionduel">
                    <span className="collisionpath" title={f}>
                      {f}
                    </span>
                    <div className="duelrow">
                      <figure className="duelside">
                        <FilePreview path={f} className="duelshot" />
                        <figcaption className="muted small">
                          Here, on <BranchName name={currentBranch} />
                        </figcaption>
                      </figure>
                      <span className="duelvs muted">vs</span>
                      <figure className="duelside">
                        <TheirShot path={f} branch={c.branch} />
                        <figcaption className="muted small">
                          {c.is_mine ? "You" : c.author} on{" "}
                          <BranchName name={c.branch} />
                        </figcaption>
                      </figure>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>Close</button>
          <button className="primary" onClick={onOpenBranches}>
            Open Branches
          </button>
        </div>
      </div>
    </div>
  );
}
