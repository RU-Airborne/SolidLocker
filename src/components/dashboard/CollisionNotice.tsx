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

  const byWho = new Map<
    string,
    { who: string; isMine: boolean; branches: string[] }
  >();
  for (const c of risky) {
    const label = c.is_mine ? "You" : c.author;
    const g = byWho.get(label.toLowerCase()) ?? {
      who: label,
      isMine: c.is_mine,
      branches: [],
    };
    g.branches.push(c.branch);
    byWho.set(label.toLowerCase(), g);
  }
  const folks = [...byWho.values()];
  const plural = folks.length > 1 || folks.some((g) => g.isMine);
  const first = only?.cad_files[0];
  const oneFile =
    only && only.cad_files.length === 1 && first
      ? (first.split("/").pop() ?? first)
      : null;

  return (
    <div className="notice warn">
      <span>
        {only ? (
          only.is_mine ? (
            <>
              Your other branch <BranchName name={only.branch} /> is changing{" "}
              {oneFile ? (
                <strong>{oneFile}</strong>
              ) : (
                `${only.cad_files.length} files`
              )}{" "}.
            </>
          ) : (
            <>
              You and {only.author} are both changing{" "}
              {oneFile ? (
                <strong>{oneFile}</strong>
              ) : (
                `${only.cad_files.length} files`
              )}{" "}
              &mdash; their copy lives on <BranchName name={only.branch} />.
            </>
          )
        ) : (
          <>
            {folks.map((g, i) => (
              <span key={g.who}>
                {i > 0 && (i === folks.length - 1 ? " and " : ", ")}
                {g.who} (in{" "}
                {g.branches.map((br, j) => (
                  <span key={br}>
                    {j > 0 &&
                      (j === g.branches.length - 1 ? " and " : ", ")}
                    <BranchName name={br} />
                  </span>
                ))}
                )
              </span>
            ))}{" "}
            {plural ? "are" : "is"} changing {files} files this branch is also
            changing.
          </>
        )}{" "}
        Only one version of each can be kept when the branches merge.
      </span>
      <button className="notice-ok" onClick={onShow}>
        Compare versions
      </button>
    </div>
  );
}
