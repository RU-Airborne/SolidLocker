export function rowDomId(path: string): string {
  return `file-${encodeURIComponent(path.toLowerCase())}`;
}
