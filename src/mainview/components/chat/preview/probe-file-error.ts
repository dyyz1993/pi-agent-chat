import { apiClient } from "../../../lib/api-client";

export type FileErrorKind = "forbidden" | "not_found" | "server_error" | "network";

export interface FileProbeResult {
  ok: boolean;
  error?: FileErrorKind;
  detail?: string;
}

/**
 * 当文件加载失败时，用 /info/ 端点探测具体 HTTP 错误原因。
 * /info/ 也走白名单校验但返回 JSON（而非文件 body），开销小。
 */
export async function probeFileError(absolutePath: string): Promise<FileProbeResult> {
  const baseUrl = apiClient.getBaseUrl();
  const token = apiClient.getAuthToken();
  if (!baseUrl) return { ok: false, error: "network", detail: "No server connection" };

  try {
    const res = await fetch(`${baseUrl}/info/${encodeURIComponent(absolutePath)}?token=${token}`);
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as Record<string, string>;
    const msg = body.error ?? res.statusText;
    if (res.status === 403) return { ok: false, error: "forbidden", detail: msg };
    if (res.status === 404) return { ok: false, error: "not_found", detail: msg };
    return { ok: false, error: "server_error", detail: msg };
  } catch {
    return { ok: false, error: "network", detail: "Network error" };
  }
}
