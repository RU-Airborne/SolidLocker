/**
 * Stable DOM id for a file row, so other views can scroll one into view.
 *
 * Kept in its own module (not on Dashboard) so Dashboard.tsx exports only
 * React components — mixing a plain function in there breaks Fast Refresh.
 */
export function rowDomId(path: string): string {
  return `file-${encodeURIComponent(path.toLowerCase())}`;
}
