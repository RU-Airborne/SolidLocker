import { BranchName } from "../common/BranchName";
import type { Collision } from "../../api";

export function CollisionNotice({
  collisions,
  onShow,
  onDismiss,
}: {
  collisions: Collision[];
  onShow: () => void;
  onDismiss: () => void;
}) {
  const risky = collisions.filter((c) => c.cad_files.length > 0);
  if (risky.length === 0) return null;

  const files = risky.reduce((n, c) => n + c.cad_files.length, 0);
  const branches = [...new Set(risky.map((c) => c.branch))];
  const only = risky.length === 1 ? risky[0] : null;
  const first = only?.cad_files[0];
  const oneFile =
    only && only.cad_files.length === 1 && first
      ? (first.split("/").pop() ?? first)
      : null;

  return (
    <div className="notice warn">
      <span>
        {oneFile ? <strong>{oneFile}</strong> : `${files} files`}{" "}
        {oneFile ? "is" : "are"} also being changed on{" "}
        {branches.map((br, i) => (
          <span key={br}>
            {i > 0 && (i === branches.length - 1 ? " and " : ", ")}
            <BranchName name={br} />
          </span>
        ))}
        . Only one version of each can be kept when the branches merge.
      </span>
      <button className="notice-ok" onClick={onShow}>
        Compare versions
      </button>
      <button
        className="notice-ok"
        title="Stop showing this. It comes back when another file joins the list"
        onClick={onDismiss}
      >
        Dismiss
      </button>
    </div>
  );
}
