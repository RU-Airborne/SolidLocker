import type { LockStatus } from "../../types";
import { usePeople } from "../../identity";

function LockGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function StatusBadge({
  status,
  writable,
}: {
  status: LockStatus;
  writable: boolean;
}) {
  const directory = usePeople();
  if (status.kind === "mine") {
    return (
      <span className="badge badge-mine" title="Locked by you">
        <LockGlyph />
        You
      </span>
    );
  }
  if (status.kind === "theirs") {
    const owner = status.lock.owner?.name;
    const display = owner ? (directory.nameFor(owner) ?? owner) : null;
    return (
      <span
        className="badge badge-theirs"
        title={`Locked by ${display ?? "another member"}`}
      >
        <LockGlyph />
        {display ?? "another member"}
      </span>
    );
  }
  return (
    <span className="badge badge-free">
      Available{writable ? " (writable!)" : ""}
    </span>
  );
}
