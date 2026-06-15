import { apiClient } from "../../../lib/api-client";
import { proxyUrlSync } from "../../../lib/proxy";
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

export function getFileHttpUrl(absolutePath: string): string {
  if (/^https?:\/\//i.test(absolutePath)) return proxyUrlSync(absolutePath);
  const baseUrl = apiClient.getBaseUrl();
  const token = apiClient.getAuthToken();
  if (!baseUrl) return `file://${absolutePath}`;
  return `${baseUrl}/file/${encodeURIComponent(absolutePath)}?token=${token}`;
}

export { formatSize as formatFileSize };
