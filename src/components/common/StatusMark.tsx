/** What happened to a file, as a small coloured mark instead of git's
 *  A/M/D letters: + added, pencil changed, − removed, arrow renamed. */

const WORDS: Record<string, string> = {
  a: "added",
  m: "changed",
  t: "changed",
  d: "removed",
  r: "renamed",
  c: "copied",
};

function Pencil() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
    </svg>
  );
}

function Arrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="3" y1="12" x2="19" y2="12" />
      <polyline points="13 6 19 12 13 18" />
    </svg>
  );
}

function Plus() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="12" y1="4" x2="12" y2="20" />
      <line x1="4" y1="12" x2="20" y2="12" />
    </svg>
  );
}

function Minus() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="4" y1="12" x2="20" y2="12" />
    </svg>
  );
}

export function StatusMark({ status }: { status: string }) {
  const s = status.charAt(0).toLowerCase();
  const word = WORDS[s] ?? "changed";
  return (
    <span className={`st st-${s}`} title={word} aria-label={word}>
      {s === "a" ? <Plus /> : s === "d" ? <Minus /> : s === "r" || s === "c" ? <Arrow /> : <Pencil />}
    </span>
  );
}
