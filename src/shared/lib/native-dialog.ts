export type OpenFolderFn = (opts: { startingFolder?: string }) => Promise<string[]>;

let _openFolder: OpenFolderFn | null = null;

export function setOpenFolderFn(fn: OpenFolderFn): void {
  _openFolder = fn;
}

export async function openFolder(opts: { startingFolder?: string }): Promise<string[]> {
  if (!_openFolder) return [];
  return _openFolder(opts);
}
