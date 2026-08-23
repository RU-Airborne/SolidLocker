import { BranchName } from "../common/BranchName";
import type { Collision } from "../../api";

/** Another branch is changing a CAD file this branch is also changing. */
export function CollisionNotice({
  collisions,
  onShow,
}: {
  collisions: Collision[];
  onShow: () => void;
}) {
  const risky = collisions.filter((c) => c.cad_files.length > 0);
  if (risky.length === 0) return null;

  const files = risky.reduce((n, c) => n + c.cad_files.length, 0);
  const only = risky.length === 1 ? risky[0] : null;

  return (
    <div className="notice warn">
      <span>
        {only ? (
          <>
            <BranchName name={only.branch} /> is changing {only.cad_files.length}{" "}
            file{only.cad_files.length === 1 ? "" : "s"} this branch is also
            changing.
          </>
        ) : (
          <>
            {risky.length} other branches are changing {files} files this
            branch is also changing.
          </>
        )}{" "}
        Only one version of each can be kept when they are combined.
      </span>
      <button className="notice-ok" onClick={onShow}>
        See which files
      </button>
    </div>
  );
}
