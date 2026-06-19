/**
 * Shared MIME type mapping for all HTTP file-serving endpoints.
 *
 * Consumers:
 * - gateway/http-routes.ts  (file content, file info, fs routes)
 * - server.ts               (static asset serving from dist/)
 * - sandbox/sandbox-agent.ts (sandbox raw file proxy)
 */

export const MIME_TYPES: Readonly<Record<string, string>> = {
  // Web
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".txt": "text/plain",
  ".xml": "application/xml",

  // Images
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",

  // Documents
  ".md": "text/markdown",
  ".mdc": "text/markdown",
  ".pdf": "application/pdf",

  // Source code (served as plain text)
  ".ts": "text/plain",
  ".tsx": "text/plain",
  ".py": "text/plain",

  // Archives
  ".zip": "application/zip",

  // Media
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",

  // Fonts
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

/**
 * Resolve MIME type by file extension, falling back to a default.
 */
export function getMimeType(ext: string, fallback = "application/octet-stream"): string {
  return MIME_TYPES[ext] ?? fallback;
}
