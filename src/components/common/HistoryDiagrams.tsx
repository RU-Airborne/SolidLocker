function trunc(s: string, n: number): string {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export function BranchGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="6" cy="5" r="2.4" />
      <circle cx="6" cy="19" r="2.4" />
      <circle cx="18" cy="7" r="2.4" />
      <path d="M6 7.4v9.2" />
      <path d="M18 9.4c0 3-2.5 4.6-5 4.6H9" />
    </svg>
  );
}

export function RestoreGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

export function EyeGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function ArrowHead({
  x,
  y,
  angle = 0,
  accent,
}: {
  x: number;
  y: number;
  angle?: number;
  accent?: boolean;
}) {
  return (
    <polygon
      className={accent ? "bd-arrownew" : "bd-arrow"}
      points="-11,-4.5 0,0 -11,4.5"
      transform={`translate(${x} ${y}) rotate(${angle})`}
    />
  );
}

function HereMarker({
  x,
  y,
  labelY,
}: {
  x: number;
  y: number;
  labelY?: number;
}) {
  return (
    <g>
      <circle className="gg-halo" cx={x} cy={y} r={9} fill="var(--accent)" />
      <circle
        cx={x}
        cy={y}
        r={6}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
      />
      <circle cx={x} cy={y} r={3.2} fill="var(--accent)" />
      {labelY !== undefined && (
        <text className="bd-labelnew" x={x} y={labelY} textAnchor="middle">
          Where you are now
        </text>
      )}
    </g>
  );
}

export function BranchDiagram({
  branchName,
  newBranchName,
  commitLabel,
}: {
  branchName: string;
  /** Live from the name input */
  newBranchName?: string;
  commitLabel?: string;
}) {
  const forkPath = "M 130 78 C 148 78 146 38 170 38 L 284 38";
  return (
    <svg
      className="branchdiagram"
      viewBox="0 0 340 118"
      role="img"
      aria-label={`Diagram: the branch ${branchName} continues unchanged; a new dotted branch starts at this earlier version`}
    >
      {/* Team's branch: the solid rail, marching on regardless. */}
      <line className="bd-main" x1="12" y1="78" x2="314" y2="78" />
      <ArrowHead x={326} y={78} />
      {[44, 88, 186].map((x) => (
        <circle key={x} className="bd-dot" cx={x} cy="78" r="4" />
      ))}

      {/* The chosen version, where the two lines part ways. */}
      <circle className="bd-selectedring" cx="130" cy="78" r="10" />
      <circle className="bd-selected" cx="130" cy="78" r="5.5" />
      <text className="bd-label" x="130" y="98" textAnchor="middle">
        This earlier version
      </text>

      {/* Where the user stands right now: the tip of the current branch. */}
      <HereMarker x={238} y={78} labelY={98} />

      {/* Your new branch: dotted, splitting off upward. */}
      <path className="bd-new" d="M 130 78 C 148 78 146 38 170 38" />
      <line className="bd-new" x1="170" y1="38" x2="284" y2="38" />
      <ArrowHead x={296} y={38} accent />
      <circle className="bd-comet" r="2.6">
        <animateMotion dur="2.2s" repeatCount="indefinite" path={forkPath} />
      </circle>

      <text className="bd-label" x="326" y="66" textAnchor="end">
        {trunc(branchName, 18)}
      </text>
      <text className="bd-labelnew" x="296" y="24" textAnchor="end">
        {trunc(newBranchName || "Your new branch", 26)}
      </text>

      {/* The full commit label gets its own uncramped line. */}
      {commitLabel && (
        <text className="bd-label" x="170" y="114" textAnchor="middle">
          Splitting off at “{trunc(commitLabel, 38)}”
        </text>
      )}
    </svg>
  );
}

export function MergeDiagram({
  fromBranch,
  intoBranch,
  intoIsCurrent,
}: {
  fromBranch: string;
  intoBranch: string;
  /** Mark the receiving rail's tip with "you are here". */
  intoIsCurrent?: boolean;
}) {
  const mergePath = "M 30 34 L 168 34 C 198 34 194 78 224 78";
  return (
    <svg
      className="branchdiagram"
      // Wide enough that "both together" and "where you are now" share one
      // label row with clear air between them.
      viewBox="0 0 380 104"
      role="img"
      aria-label={`Diagram: the branch ${fromBranch} joins into ${intoBranch}; after the merge one line carries both branches' work`}
    >
      {/* The receiving branch: a solid rail that keeps going. */}
      <line className="bd-main" x1="12" y1="78" x2="354" y2="78" />
      <ArrowHead x={366} y={78} />
      {[44, 100].map((x) => (
        <circle key={x} className="bd-dot" cx={x} cy="78" r="4" />
      ))}

      {/* The branch being merged: dotted until it joins. */}
      <line className="bd-new" x1="30" y1="34" x2="168" y2="34" />
      <path className="bd-new" d="M 168 34 C 198 34 194 78 224 78" />
      {[64, 122].map((x) => (
        <circle key={x} className="bd-newdot" cx={x} cy="34" r="4" />
      ))}
      <circle className="bd-comet" r="2.6">
        <animateMotion dur="2.2s" repeatCount="indefinite" path={mergePath} />
      </circle>

      {/* The merge point, where the two become one. */}
      <circle className="bd-selectedring" cx="224" cy="78" r="10" />
      <circle className="bd-selected" cx="224" cy="78" r="5.5" />
      <text className="bd-label" x="224" y="98" textAnchor="middle">
        Both together
      </text>
      {intoIsCurrent ? (
        <HereMarker x={316} y={78} labelY={98} />
      ) : (
        <circle className="bd-dot" cx="316" cy="78" r="4" />
      )}

      <text className="bd-labelnew" x="30" y="22" textAnchor="start">
        {trunc(fromBranch, 26)}
      </text>
      <text className="bd-label" x="366" y="66" textAnchor="end">
        {trunc(intoBranch, 18)}
      </text>
    </svg>
  );
}

export function InStepDiagram({
  fromBranch,
  intoBranch,
}: {
  fromBranch: string;
  intoBranch: string;
}) {
  return (
    <svg
      className="branchdiagram"
      viewBox="0 0 380 84"
      role="img"
      aria-label={`Diagram: ${intoBranch} already contains everything from ${fromBranch}`}
    >
      <line className="bd-main" x1="12" y1="46" x2="330" y2="46" />
      <ArrowHead x={342} y={46} />
      {[52, 116, 180].map((x) => (
        <circle key={x} className="bd-dot" cx={x} cy="46" r="4" />
      ))}
      {/* One shared tip, ringed: both names point at the same place. */}
      <circle className="bd-selectedring" cx="252" cy="46" r="10" />
      <circle className="bd-selected" cx="252" cy="46" r="5.5" />
      <text className="bd-labelnew" x="252" y="24" textAnchor="middle">
        {trunc(fromBranch, 20)}
      </text>
      <text className="bd-label" x="252" y="68" textAnchor="middle">
        {trunc(intoBranch, 20)}
      </text>
      <text className="bd-label" x="342" y="76" textAnchor="end">
        Nothing to combine
      </text>
    </svg>
  );
}


export function RestoreDiagram({
  branchName,
  commitLabel,
}: {
  branchName: string;
  commitLabel?: string;
}) {
  const arcPath = "M 64 72 C 108 22 228 22 268 68";
  return (
    <svg
      className="branchdiagram"
      viewBox="0 0 340 130"
      role="img"
      aria-label={`Diagram: on the branch ${branchName}, the old version is copied forward as the next change; the history in between stays`}
    >
      {/* The branch keeps flowing forward; nothing is rewound. */}
      <line className="bd-main" x1="12" y1="78" x2="298" y2="78" />
      <ArrowHead x={310} y={78} />
      {[120, 168].map((x) => (
        <circle key={x} className="bd-dot" cx={x} cy="78" r="4" />
      ))}

      {/* The old version being brought back. */}
      <circle className="bd-selectedring" cx="64" cy="78" r="10" />
      <circle className="bd-selected" cx="64" cy="78" r="5.5" />
      <text className="bd-label" x="64" y="96" textAnchor="middle">
        This earlier version
      </text>

      {/* Where the user stands right now. */}
      <HereMarker x={216} y={78} labelY={96} />

      {/* Its content arcs forward over the history in between… */}
      <path className="bd-new" d={arcPath} />
      {/* Tip on the arc's end, rotated to match its landing direction. */}
      <ArrowHead x={268} y={68} angle={49} accent />
      <circle className="bd-comet" r="2.6">
        <animateMotion dur="2.2s" repeatCount="indefinite" path={arcPath} />
      </circle>

      {/* …and lands just ahead of you, as your next change. */}
      <circle className="bd-newdot" cx="268" cy="78" r="5.5" />

      {/* Caption on two lines of its own, clear of every rail and label. */}
      <text className="bd-label" x="170" y="112" textAnchor="middle">
        “{trunc(commitLabel ?? "this earlier version", 36)}”
      </text>
      <text className="bd-label" x="170" y="126" textAnchor="middle">
        comes back as your next change on {trunc(branchName, 16)}
      </text>
    </svg>
  );
}

export function FreshBranchDiagram({
  newBranchName,
}: {
  newBranchName?: string;
}) {
  const freshPath = "M 64 34 L 288 34";
  return (
    <svg
      className="branchdiagram"
      viewBox="0 0 340 104"
      role="img"
      aria-label="Diagram: a brand-new empty branch starts on its own line. The existing branches continue unchanged"
    >
      {/* everything that already exists, carrying on */}
      <line className="bd-main" x1="12" y1="78" x2="314" y2="78" />
      <polygon className="bd-arrow" points="302,73 314,78 302,83" />
      {[44, 100, 156, 212].map((x) => (
        <circle key={x} className="bd-dot" cx={x} cy="78" r="4" />
      ))}
      <text className="bd-label" x="326" y="96" textAnchor="end">
        The existing branches
      </text>

      {/* the fresh line: starts from empty, connected to nothing */}
      <circle className="bd-newdot" cx="64" cy="34" r="5.5" />
      <line className="bd-new" x1="70" y1="34" x2="288" y2="34" />
      <polygon className="bd-arrownew" points="286,29 298,34 286,39" />
      <circle className="bd-comet" r="2.6">
        <animateMotion dur="2s" repeatCount="indefinite" path={freshPath} />
      </circle>
      <text className="bd-label" x="64" y="56" textAnchor="middle">
        Starts empty
      </text>
      <text className="bd-labelnew" x="298" y="20" textAnchor="end">
        {trunc(newBranchName || "Your new branch", 26)}
      </text>
    </svg>
  );
}
