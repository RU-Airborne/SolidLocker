/* Geometry for the SolidLocker logo.*/

const round = (n: number) => Math.round(n * 100) / 100;
const point = (r: number, a: number): [number, number] => [
  CX + r * Math.cos(a),
  CY + r * Math.sin(a),
];

const TAB = { w: 0.36, h: 0.1, taper: 0.93 };

export const VIEWBOX = 512;
export const CX = 256;
export const R = 470 / (2 + TAB.h);
export const CY = 256 + (R * TAB.h) / 2;

const RIM_IN = R * 0.84;
const FACE = RIM_IN - R * 0.008;
const TICK_OUTER = FACE - R * 0.048;
const MERGE = 0.17; /* fillet where the tab wall meets the rim */
const CORNER = 0.085; /* radius of the tab's own top corners */
const KNURL_COUNT = 52;
const KNURL_DEPTH = 0.64; /* how far the ridges reach across the rim */

export const CENTRE_R = R * 0.665;

export const COLOUR = {
  rim: "#8d949b" /* two-tone base */,
  rimLit: "#b6bdc4" /* two-tone highlight, upper left */,
  edge: "#6f747a",
  tooth: "#5f656c",
  face: "#0d0f13",
  tick: "#ffffff",
  index: "#a92e31",
};

function circlePath(r: number, sweep: 0 | 1): string {
  return (
    `M${round(CX - r)} ${round(CY)}` +
    `A${round(r)} ${round(r)} 0 1 ${sweep} ${round(CX + r)} ${round(CY)}` +
    `A${round(r)} ${round(r)} 0 1 ${sweep} ${round(CX - r)} ${round(CY)}Z`
  );
}

function buildBody(): string {
  const w = R * TAB.w;
  const h = R * TAB.h;
  const wallX = w * TAB.taper;
  const rc = R * CORNER;
  const yTop = CY - R - h;

  const th = Math.acos(Math.min(0.999, Math.max(-0.999, w / R)));
  const aRight = -th;
  const aLeft = -(Math.PI - th);
  const jRight = point(R, aRight);
  const jLeft = point(R, aLeft);
  const kRight: [number, number] = [CX + wallX, yTop + rc];
  const kLeft: [number, number] = [CX - wallX, yTop + rc];

  const wall = Math.hypot(kRight[0] - jRight[0], kRight[1] - jRight[1]);
  const fillet = Math.min(R * MERGE, wall * 0.8, R * 0.3);
  const dth = Math.min(fillet / R, (Math.PI - th) * 0.55);
  const uRight = [
    (kRight[0] - jRight[0]) / wall,
    (kRight[1] - jRight[1]) / wall,
  ];
  const uLeft = [(kLeft[0] - jLeft[0]) / wall, (kLeft[1] - jLeft[1]) / wall];
  const bRight = [
    jRight[0] + uRight[0] * fillet,
    jRight[1] + uRight[1] * fillet,
  ];
  const bLeft = [jLeft[0] + uLeft[0] * fillet, jLeft[1] + uLeft[1] * fillet];
  const aArc = point(R, aRight + dth);
  const bArc = point(R, aLeft - dth);

  return (
    `M${round(bRight[0])} ${round(bRight[1])}` +
    `Q${round(jRight[0])} ${round(jRight[1])} ${round(aArc[0])} ${round(aArc[1])}` +
    `A${round(R)} ${round(R)} 0 1 1 ${round(bArc[0])} ${round(bArc[1])}` +
    `Q${round(jLeft[0])} ${round(jLeft[1])} ${round(bLeft[0])} ${round(bLeft[1])}` +
    `L${round(kLeft[0])} ${round(kLeft[1])}` +
    `A${round(rc)} ${round(rc)} 0 0 1 ${round(CX - wallX + rc)} ${round(yTop)}` +
    `L${round(CX + wallX - rc)} ${round(yTop)}` +
    `A${round(rc)} ${round(rc)} 0 0 1 ${round(kRight[0])} ${round(kRight[1])}` +
    `Z` +
    circlePath(RIM_IN, 0)
  );
}

function buildTeeth(): { d: string; width: number } {
  const inner = RIM_IN + (R - RIM_IN) * (1 - KNURL_DEPTH);
  const step = (2 * Math.PI) / KNURL_COUNT;
  const gap = Math.asin(TAB.w) + MERGE + 0.06;
  const width = step * ((inner + R) / 2) * 0.34;
  let d = "";
  for (let i = 0; i < KNURL_COUNT; i += 1) {
    const a = -Math.PI / 2 + i * step;
    const off = Math.abs(
      Math.atan2(Math.sin(a + Math.PI / 2), Math.cos(a + Math.PI / 2)),
    );
    if (off < gap) continue;
    const p0 = point(inner + width / 2, a);
    const p1 = point(R - width / 2 - R * 0.008, a);
    d += `M${round(p0[0])} ${round(p0[1])}L${round(p1[0])} ${round(p1[1])}`;
  }
  return { d, width };
}

function buildTicks(): { major: string; minor: string; majorW: number; minorW: number } {
  let major = "";
  let minor = "";
  for (let i = 0; i < 40; i += 1) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 40;
    const isMajor = i % 5 === 0;
    const len = R * (isMajor ? 0.096 : 0.058);
    const p0 = point(TICK_OUTER - len, a);
    const p1 = point(TICK_OUTER, a);
    const seg = `M${round(p0[0])} ${round(p0[1])}L${round(p1[0])} ${round(p1[1])}`;
    if (isMajor) major += seg;
    else minor += seg;
  }
  return { major, minor, majorW: R * 0.031, minorW: R * 0.018 };
}

function buildIndex(): string {
  const h = R * TAB.h;
  const wallX = R * TAB.w * TAB.taper;
  const yTop = CY - R - h;
  const half = wallX * 0.26;
  const height = half * 1.94;
  const top = yTop + R * 0.07;
  return (
    `M${round(CX - half)} ${round(top)}` +
    `L${round(CX + half)} ${round(top)}` +
    `L${CX} ${round(top + height)}Z`
  );
}

export const BODY_D = buildBody();
export const TEETH = buildTeeth();
export const TICKS = buildTicks();
export const INDEX_D = buildIndex();
export const FACE_R = FACE;
export const EDGE_W = R * 0.013;
