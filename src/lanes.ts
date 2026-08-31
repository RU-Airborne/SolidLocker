/**
 * The colours a branch can be drawn in.
 */

// One hue per lane; 16 before a repeat.
const LANE_COLORS_DARK = [
  "#4e8cff", // blue
  "#d29922", // amber
  "#39c5cf", // teal
  "#bc8cff", // violet
  "#f778ba", // pink
  "#3fb950", // green
  "#ff9f43", // orange
  "#e3b341", // gold
  "#2fb38f", // mint
  "#f47067", // coral
  "#a5b4fc", // periwinkle
  "#a3b83a", // lime
  "#8b949e", // slate
  "#e2a8f0", // orchid
  "#5ad1a6", // jade
  "#dbab7a", // sand
];

const LANE_COLORS_LIGHT = [
  "#2563eb", // blue
  "#d97706", // amber
  "#0891b2", // teal
  "#7c3aed", // violet
  "#db2777", // pink
  "#16a34a", // green
  "#ea580c", // orange
  "#a16207", // gold
  "#059669", // mint
  "#e11d48", // coral
  "#4f46e5", // periwinkle
  "#65a30d", // lime
  "#64748b", // slate
  "#c026d3", // orchid
  "#047857", // jade
  "#92400e", // sand
];

/* Read per call rather than cached. Both reads are cheap and neither forces
   layout. */
function onLightBackground(): boolean {
  if (typeof document === "undefined") return false;
  const chosen = document.documentElement.getAttribute("data-theme");
  if (chosen === "light") return true;
  if (chosen === "dark") return false;
  return window.matchMedia("(prefers-color-scheme: light)").matches;
}

/** Both palettes are the same length; the dash rounds count against it. */
export const LANE_COUNT = LANE_COLORS_DARK.length;

export function laneColor(i: number): string {
  const palette = onLightBackground() ? LANE_COLORS_LIGHT : LANE_COLORS_DARK;
  return palette[i % palette.length];
}
