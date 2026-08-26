export function rowDomId(path: string): string {
  return `file-${encodeURIComponent(path.toLowerCase())}`;
}

export function folderDomId(path: string): string {
  return `folder-${encodeURIComponent(path.toLowerCase())}`;
}
