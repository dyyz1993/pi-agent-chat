import { apiClient } from "../../../lib/api-client";
import { proxyUrlSync } from "../../../lib/proxy";
import { toLocalFileUrl } from "../../../lib/file-url";
import { formatSize } from "../../../utils/file-utils";

export type ResourceType =
  | "image"
  | "url"
  | "html"
  | "pdf"
  | "video"
  | "audio"
  | "markdown"
  | "text";

export interface PreviewDetails {
  source: string;
  absolutePath?: string;
  resourceType: ResourceType;
  mimeType?: string;
  status: "ok" | "not_found" | "error";
  size?: number;
  title?: string;
  error?: string;
}

function looksLikeHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function looksLikeLocalPath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function joinProjectPath(root: string, relativePath: string): string {
  const normalizedRoot = normalizeSlashes(root).replace(/\/+$/g, "");
  const normalizedRelative = normalizeSlashes(relativePath).replace(/^\.?\//, "");
  return `${normalizedRoot}/${normalizedRelative}`;
}

function resolvePreviewAbsolutePath(
  source: string,
  explicitAbsolutePath: unknown,
  projectRoots?: string[],
): string | undefined {
  if (typeof explicitAbsolutePath === "string" && explicitAbsolutePath) {
    return explicitAbsolutePath;
  }

  if (looksLikeHttpUrl(source)) return undefined;
  if (looksLikeLocalPath(source)) return source;

  if (!Array.isArray(projectRoots) || projectRoots.length === 0) return undefined;

  const normalizedSource = normalizeSlashes(source);
  for (const root of projectRoots) {
    if (typeof root !== "string" || !root) continue;
    if (!looksLikeLocalPath(root)) continue;
    return joinProjectPath(root, normalizedSource);
  }

  return undefined;
}

export function normalizePreviewDetails(
  raw: unknown,
  projectRoots?: string[],
): PreviewDetails | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const source = typeof data.source === "string" ? data.source : "";
  const rawResourceType =
    typeof data.resourceType === "string"
      ? data.resourceType
      : typeof data.type === "string"
        ? data.type
        : "";

  if (!source || !rawResourceType) return null;

  const absolutePath = resolvePreviewAbsolutePath(source, data.absolutePath, projectRoots);

  return {
    source,
    absolutePath,
    resourceType: rawResourceType as ResourceType,
    mimeType: typeof data.mimeType === "string" ? data.mimeType : undefined,
    status:
      data.status === "ok" || data.status === "not_found" || data.status === "error"
        ? data.status
        : "error",
    size: typeof data.size === "number" ? data.size : undefined,
    title: typeof data.title === "string" ? data.title : undefined,
    error: typeof data.error === "string" ? data.error : undefined,
  };
}

export function getPreviewRenderableSource(details: PreviewDetails): string | undefined {
  if (details.absolutePath) return details.absolutePath;
  if (!details.source) return undefined;
  if (looksLikeHttpUrl(details.source) || looksLikeLocalPath(details.source)) return details.source;
  return undefined;
}

export function getPreviewRenderablePath(details: PreviewDetails): string | undefined {
  return getPreviewRenderableSource(details);
}

export function isPreviewRemoteUrl(value: string | undefined): boolean {
  return typeof value === "string" && looksLikeHttpUrl(value);
}

export function shouldUseRpcPreviewSource(value: string | undefined): boolean {
  return (
    typeof value === "string" && !looksLikeHttpUrl(value) && apiClient.getTransport() === "ipc"
  );
}

export function getFileHttpUrl(absolutePath: string): string {
  if (/^https?:\/\//i.test(absolutePath)) return proxyUrlSync(absolutePath);
  const baseUrl = apiClient.getBaseUrl();
  const token = apiClient.getAuthToken();
  if (!baseUrl) return toLocalFileUrl(absolutePath);
  return `${baseUrl}/file/${encodeURIComponent(absolutePath)}?token=${token}`;
}

export { formatSize as formatFileSize };
