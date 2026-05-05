import { apiClient } from "../../../lib/api-client";

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
  if (/^https?:\/\//i.test(absolutePath)) return absolutePath;
  const baseUrl = apiClient.getBaseUrl();
  const token = apiClient.getAuthToken();
  if (!baseUrl) return `file://${absolutePath}`;
  return `${baseUrl}/file/${encodeURIComponent(absolutePath)}?token=${token}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
