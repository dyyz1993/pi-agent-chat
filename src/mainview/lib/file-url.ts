const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/;

export function toLocalFileUrl(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const pathname = WINDOWS_ABSOLUTE_PATH.test(normalizedPath)
    ? `/${normalizedPath}`
    : normalizedPath;

  return new URL(pathname, "file://").toString();
}
