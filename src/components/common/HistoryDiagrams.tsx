import { useBranchColors } from "./BranchName";
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

/** Lightbulb. */
export function BulbGlyph() {
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
      <path d="M9 18h6" />
      <path d="M10 21h4" />
      <path d="M8.5 14.5A6 6 0 1 1 15.5 14.5c-.6.6-1 1.4-1 2.5h-5c0-1.1-.4-1.9-1-2.5z" />
    </svg>
  );
}

/** Bin. */
export function TrashGlyph() {
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
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M9 7V4h6v3" />
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

function rails(main?: string, fresh?: string): React.CSSProperties | undefined {
  const style: Record<string, string> = {};
  if (main) style["--bd-main"] = main;
  if (fresh) style["--bd-new"] = fresh;
  return Object.keys(style).length > 0 ? (style as React.CSSProperties) : undefined;
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
        <text className="bd-labelmark" x={x} y={labelY} textAnchor="middle">
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
  fromTip,
}: {
  branchName: string;
  /** Live from the name input */
  newBranchName?: string;
  commitLabel?: string;
  fromTip?: boolean;
}) {
  const colorOf = useBranchColors();
  void commitLabel;
  if (fromTip) {
    const tipPath = "M 212 38 C 228 38 226 78 250 78 L 288 78";
    return (
      <svg
        className="branchdiagram"
        style={rails(colorOf(branchName), newBranchName ? colorOf(newBranchName) : undefined)}
        viewBox="0 0 340 118"
        role="img"
        aria-label={`Diagram: a new branch splits off from the tip of ${branchName}, right where you are now`}
      >
        <line className="bd-main" x1="12" y1="38" x2="314" y2="38" />
        <ArrowHead x={326} y={38} />
        {[44, 100, 156].map((x) => (
          <circle key={x} className="bd-dot" cx={x} cy="38" r="4" />
        ))}

        {/* the fork happens exactly where you stand */}
        <HereMarker x={212} y={38} labelY={18} />
        <path className="bd-new" d="M 212 38 C 228 38 226 78 250 78" />
        <line className="bd-new" x1="250" y1="78" x2="288" y2="78" />
        <ArrowHead x={300} y={78} accent />
        <circle className="bd-comet" r="2.6">
          <animateMotion dur="2.2s" repeatCount="indefinite" path={tipPath} />
        </circle>

        <text className="bd-label" x="326" y="50" textAnchor="end">
          {trunc(branchName, 18)}
        </text>
        <text className="bd-labelnew" x="300" y="92" textAnchor="end">
          {trunc(newBranchName || "Your new branch", 26)}
        </text>
      </svg>
    );
  }

  const forkPath = "M 130 38 C 148 38 146 78 170 78 L 284 78";
  return (
    <svg
      className="branchdiagram"
      style={rails(colorOf(branchName), newBranchName ? colorOf(newBranchName) : undefined)}
      viewBox="0 0 340 118"
      role="img"
      aria-label={`Diagram: the branch ${branchName} continues unchanged; a new dotted branch starts at this earlier version`}
    >
      {/* Team's branch: the solid rail, marching on regardless. */}
      <line className="bd-main" x1="12" y1="38" x2="314" y2="38" />
      <ArrowHead x={326} y={38} />
      {[44, 88, 186].map((x) => (
        <circle key={x} className="bd-dot" cx={x} cy="38" r="4" />
      ))}

      {/* The chosen version, where the two lines part ways. */}
      <circle className="bd-selectedring" cx="130" cy="38" r="10" />
      <circle className="bd-selected" cx="130" cy="38" r="5.5" />
      <text className="bd-labelmark" x="130" y="18" textAnchor="middle">
        This earlier version
      </text>

      {/* Where the user stands right now: the tip of the current branch. */}
      <HereMarker x={238} y={38} labelY={18} />

      {/* Your new branch: dotted, splitting off upward. */}
      <path className="bd-new" d="M 130 38 C 148 38 146 78 170 78" />
      <line className="bd-new" x1="170" y1="78" x2="284" y2="78" />
      <ArrowHead x={296} y={78} accent />
      <circle className="bd-comet" r="2.6">
        <animateMotion dur="2.2s" repeatCount="indefinite" path={forkPath} />
      </circle>

      <text className="bd-label" x="326" y="50" textAnchor="end">
        {trunc(branchName, 18)}
      </text>
      <text className="bd-labelnew" x="296" y="92" textAnchor="end">
        {trunc(newBranchName || "Your new branch", 26)}
      </text>

      {/* The full commit label gets its own uncramped line. */}
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
  const colorOf = useBranchColors();
  // The branch being merged runs underneath and climbs into the receiving
  // rail on top, the way the railway draws it.
  const mergePath = "M 30 78 L 168 78 C 198 78 194 34 224 34";
  return (
    <svg
      className="branchdiagram"
      style={rails(colorOf(intoBranch), colorOf(fromBranch))}
      viewBox="0 0 380 104"
      role="img"
      aria-label={`Diagram: the branch ${fromBranch} joins into ${intoBranch}. After the merge one line carries both branches' work`}
    >
      {/* The receiving branch: solid up to where you stand, dotted from
          there on, since that part only exists once the merge is done. */}
      <line className="bd-main" x1="12" y1="34" x2="132" y2="34" />
      <line className="bd-main bd-ahead" x1="132" y1="34" x2="354" y2="34" />
      <ArrowHead x={366} y={34} />
      {[44, 100].map((x) => (
        <circle key={x} className="bd-dot" cx={x} cy="34" r="4" />
      ))}
      {intoIsCurrent ? (
        <HereMarker x={132} y={34} labelY={16} />
      ) : (
        <circle className="bd-dot" cx="132" cy="34" r="4" />
      )}

      {/* The branch being merged: dotted until it joins. */}
      <line className="bd-new" x1="30" y1="78" x2="168" y2="78" />
      <path className="bd-new" d="M 168 78 C 198 78 194 34 224 34" />
      {[64, 122].map((x) => (
        <circle key={x} className="bd-newdot" cx={x} cy="78" r="4" />
      ))}
      <circle className="bd-comet" r="2.6">
        <animateMotion dur="2.2s" repeatCount="indefinite" path={mergePath} />
      </circle>

      {/* The merge point, where the two become one; dotted, it isn't there yet. */}
      <circle cx="224" cy="34" r="6" fill="none" stroke="var(--accent)" strokeWidth="2" strokeDasharray="2 2.5" />
      <text className="bd-labelmark" x="224" y="16" textAnchor="middle">
        After merging
      </text>
      <text className="bd-labelnew" x="30" y="96" textAnchor="start">
        {trunc(fromBranch, 26)}
      </text>
      <text className="bd-label" x="366" y="54" textAnchor="end">
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
  const colorOf = useBranchColors();
  return (
    <svg
      className="branchdiagram"
      style={rails(colorOf(intoBranch), colorOf(fromBranch))}
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
  const colorOf = useBranchColors();
  void commitLabel;
  const arcPath = "M 64 40 C 108 90 228 90 268 44";
  return (
    <svg
      className="branchdiagram"
      style={rails(colorOf(branchName))}
      viewBox="0 0 340 108"
      role="img"
      aria-label={`Diagram: on the branch ${branchName}, the old version is copied forward as the next change; the history in between stays`}
    >
      {/* The branch keeps flowing forward; nothing is rewound. Dotted past
          where you stand, since that part comes with the restore. */}
      <line className="bd-main" x1="12" y1="34" x2="216" y2="34" />
      <line className="bd-main bd-ahead" x1="216" y1="34" x2="298" y2="34" />
      <ArrowHead x={310} y={34} />
      <text className="bd-label" x="322" y="46" textAnchor="end">
        {trunc(branchName, 18)}
      </text>
      {[120, 168].map((x) => (
        <circle key={x} className="bd-dot" cx={x} cy="34" r="4" />
      ))}

      {/* The old version being brought back. */}
      <circle className="bd-selectedring" cx="64" cy="34" r="10" />
      <circle className="bd-selected" cx="64" cy="34" r="5.5" />
      <text className="bd-labelmark" x="64" y="16" textAnchor="middle">
        This earlier version
      </text>

      {/* Where the user stands right now. */}
      <HereMarker x={216} y={34} labelY={16} />

      {/* Its content arcs forward over the history in between… */}
      <path className="bd-new" d={arcPath} />
      {/* Tip on the arc's end, rotated to match its landing direction. */}
      <ArrowHead x={268} y={44} angle={-49} accent />
      <circle className="bd-comet" r="2.6">
        <animateMotion dur="2.2s" repeatCount="indefinite" path={arcPath} />
      </circle>

      {/* …and lands just ahead of you, as your next change. */}
      <circle className="bd-newdot" cx="268" cy="34" r="5.5" />

      {/*
      <text className="bd-label" x="170" y="0" textAnchor="middle">
        “{trunc(commitLabel ?? "this earlier version", 36)}”
      </text>
      */}
    </svg>
  );
}

export function FreshBranchDiagram({
  newBranchName,
}: {
  newBranchName?: string;
}) {
  const colorOf = useBranchColors();
  const freshPath = "M 64 78 L 288 78";
  return (
    <svg
      className="branchdiagram"
      style={rails(undefined, newBranchName ? colorOf(newBranchName) : undefined)}
      viewBox="0 0 340 104"
      role="img"
      aria-label="Diagram: a brand-new empty branch starts on its own line. The existing branches continue unchanged"
    >
      {/* everything that already exists, carrying on */}
      <line className="bd-main" x1="12" y1="34" x2="314" y2="34" />
      <polygon className="bd-arrow" points="302,39 314,34 302,29" />
      {[44, 100, 156, 212].map((x) => (
        <circle key={x} className="bd-dot" cx={x} cy="34" r="4" />
      ))}
      <text className="bd-label" x="326" y="16" textAnchor="end">
        The existing branches
      </text>

      {/* the fresh line: starts from empty, connected to nothing */}
      <circle className="bd-newdot" cx="64" cy="78" r="5.5" />
      <line className="bd-new" x1="70" y1="78" x2="288" y2="78" />
      <polygon className="bd-arrownew" points="286,83 298,78 286,73" />
      <circle className="bd-comet" r="2.6">
        <animateMotion dur="2s" repeatCount="indefinite" path={freshPath} />
      </circle>
      <text className="bd-labelnew" x="64" y="92" textAnchor="middle">
        Starts empty
      </text>
      <text className="bd-labelnew" x="298" y="92" textAnchor="end">
        {trunc(newBranchName || "Your new branch", 26)}
      </text>
    </svg>
  );
}

export function MergeGlyph() {
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
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M6 21V9a9 9 0 0 0 9 9" />
    </svg>
  );
}
