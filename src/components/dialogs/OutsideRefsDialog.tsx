import type { OutsideRef } from "../../api";

function shortName(path: string) {
  return path.split("/").pop() ?? path;
}

export function OutsideRefsDialog({
  refs,
  onShareAnyway,
  onClose,
}: {
  refs: OutsideRef[];
  /** Null when this is only being looked at, not shared. */
  onShareAnyway: (() => void) | null;
  onClose: () => void;
}) {
  const holders = [...new Set(refs.map((r) => r.from))];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>
          {refs.length === 1
            ? "This uses a file from outside the project"
            : `These use ${refs.length} files from outside the project`}
        </h2>
        <p>
          {holders.length === 1 ? (
            <>
              <strong>{shortName(holders[0])}</strong> needs
            </>
          ) : (
            <>
              {holders.length} of the files you are sharing need
            </>
          )}{" "}
          {refs.length === 1 ? "a part that is" : "parts that are"} not in the
          project. Nobody else has{" "}
          {refs.length === 1 ? "it" : "them"}, so the assembly will open broken
          for the rest of the team.
        </p>

        <ul className="outsidelist">
          {refs.slice(0, 8).map((r) => (
            <li key={`${r.from} ${r.to}`}>
              <span className="outsidefrom">{shortName(r.from)}</span>
              <span className="outsideto" title={r.to}>
                {r.to}
                {r.missing ? " (not on this computer either)" : ""}
              </span>
            </li>
          ))}
          {refs.length > 8 && (
            <li className="muted">…and {refs.length - 8} more</li>
          )}
        </ul>

        <p className="muted small">
          To fix it: copy those files into the project folder, open the
          assembly in SolidWorks and point it at the copies, then save and
          share again.
        </p>

        <div className="modal-actions">
          <button onClick={onClose}>{onShareAnyway ? "Let me fix it" : "Close"}</button>
          {onShareAnyway && (
            <button className="danger" onClick={onShareAnyway}>
              Share anyway
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
