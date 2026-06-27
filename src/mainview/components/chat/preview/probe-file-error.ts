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
  if (!baseUrl) {
    try {
      await apiClient.call("file.readFile", { path: absolutePath });
      return {
        ok: false,
        error: "server_error",
        detail: "Local file exists but renderer failed to load it",
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const lowered = detail.toLowerCase();
      if (lowered.includes("enoent") || lowered.includes("not found")) {
        return { ok: false, error: "not_found", detail };
      }
      if (lowered.includes("eacces") || lowered.includes("permission")) {
        return { ok: false, error: "forbidden", detail };
      }
      return { ok: false, error: "server_error", detail };
    }
  }

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
