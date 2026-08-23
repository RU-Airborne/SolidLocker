import { BranchName } from "../common/BranchName";
import type { Collision } from "../../api";
import { formatDateTime } from "../../dates";
import { FilePreview } from "../common/FilePreview";

export function CollisionsDialog({
  collisions,
  onOpenBranches,
  onClose,
}: {
  collisions: Collision[];
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
          Each of these is being changed here <em>and</em> on another branch.
          Only one version can be kept when the two are merged, so it is
          worth agreeing who is doing what now.
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
                  <li key={f}>
                    <FilePreview path={f} />
                    <span className="collisionpath" title={f}>
                      {f}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="muted small">
          Nothing is broken yet and nothing here changes anything. Usually one
          of you unlocks the file, or the branches get merged sooner.
        </p>

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
