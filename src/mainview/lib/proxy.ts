/**
 * 本地代理模块 — 把 localhost / LAN 地址转成 /__proxy__/ 路径
 *
 * 前端只做一件事：识别本地地址，把 URL 改写成 /__proxy__/host:port/path。
 * 实际的注册和 302 重定向由后端 /__proxy__/ 端点处理。
 *
 * 流程：
 *   1. preview 发现 http://localhost:8080/index.html
 *   2. checkProxyUrl() 探测可达性 → 不可达则直接返回错误
 *   3. proxyUrlSync() → /__proxy__/localhost:8080/index.html
 *   4. 浏览器请求 /__proxy__/localhost:8080/index.html（同源）
 *   5. 后端注册 shanbox → 302 到 https://xxx.shanbox:8443/index.html
 *   6. 浏览器跟随 302，从 shanbox 加载内容
 */

// ---- 内部状态 ----

import { createLogger } from "../../shared/lib/logger";

const logger = createLogger("proxy-register");

const PROXY_PREFERENCE_KEY = "pi-local-proxy-enabled";

let preferred = readProxyPreference();
let active = false;
let configured: boolean | null = null;
let statusError: string | undefined;

function readProxyPreference(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(PROXY_PREFERENCE_KEY) === "true";
}

function writeProxyPreference(next: boolean): void {
  preferred = next;
  if (typeof localStorage === "undefined") return;
  if (next) {
    localStorage.setItem(PROXY_PREFERENCE_KEY, "true");
  } else {
    localStorage.removeItem(PROXY_PREFERENCE_KEY);
  }
}

export interface ProxyStatus {
  preferred: boolean;
  active: boolean;
  configured: boolean | null;
  error?: string;
}

export function getProxyStatus(): ProxyStatus {
  return { preferred, active, configured, error: statusError };
}

function applyRemoteStatus(
  data: { preferred?: boolean; configured?: boolean; active?: boolean; error?: string },
  fallbackPreferred = preferred,
): ProxyStatus {
  preferred = typeof data.preferred === "boolean" ? data.preferred : fallbackPreferred;
  configured = data.configured === true;
  active = typeof data.active === "boolean" ? data.active : preferred && configured;
  statusError = data.error;
  writeProxyPreference(preferred);
  return getProxyStatus();
}

// ---- 公开 API ----

/** 判断是否为本地/LAN 地址，只有这类地址需要走代理 */
export function isLocalAddress(host: string): boolean {
  if (!host) return false;
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower === "127.0.0.1" || lower === "::1") return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return false;
}

/** 代理是否已启用 */
export function isProxyEnabled(): boolean {
  return active;
}

/** 本地开启代理偏好；设置面板使用 setProxyPreference 走服务端持久化确认。 */
export function enableProxy(): ProxyStatus {
  writeProxyPreference(true);
  active = true;
  return getProxyStatus();
}

/** 关闭代理偏好 */
export function disableProxy(): ProxyStatus {
  writeProxyPreference(false);
  active = false;
  statusError = undefined;
  return getProxyStatus();
}

export function parseProxyServerHost(
  serverHost: string,
  defaultPort = 80,
): { hostname: string; port: number } | null {
  if (!serverHost) return null;
  const colonIdx = serverHost.lastIndexOf(":");
  const hostname = colonIdx >= 0 ? serverHost.slice(0, colonIdx) : serverHost;
  const parsedPort = colonIdx >= 0 ? Number.parseInt(serverHost.slice(colonIdx + 1), 10) : NaN;
  const port = Number.isFinite(parsedPort) ? parsedPort : defaultPort;
  return { hostname, port };
}

/** 刷新服务端代理能力。用户偏好和真实配置都满足时，代理才算 active。 */
export async function refreshProxyStatus(): Promise<ProxyStatus> {
  try {
    const res = await fetch("/api/proxy-status", { method: "GET" });
    if (!res.ok) {
      configured = false;
      active = false;
      statusError = `HTTP ${res.status}`;
      return getProxyStatus();
    }

    const data = (await res.json()) as {
      preferred?: boolean;
      configured?: boolean;
      active?: boolean;
      error?: string;
    };
    return applyRemoteStatus(data);
  } catch (e) {
    configured = false;
    active = false;
    statusError = String(e);
    logger.warn("Proxy status check failed", { error: statusError });
    return getProxyStatus();
  }
}

export async function setProxyPreference(next: boolean): Promise<ProxyStatus> {
  const previous = getProxyStatus();
  try {
    const res = await fetch("/api/proxy-preference", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      preferred?: boolean;
      configured?: boolean;
      active?: boolean;
      error?: string;
    };
    return applyRemoteStatus(data, next);
  } catch (e) {
    preferred = previous.preferred;
    active = previous.active;
    configured = previous.configured;
    statusError = String(e);
    writeProxyPreference(preferred);
    logger.warn("Proxy preference update failed", { enabled: next, error: statusError });
    return getProxyStatus();
  }
}

/**
 * 启动时检测：读取持久化偏好，并向后端发一个注册请求来验证代理是否可用。
 * 只有偏好已开启、服务端已配置且注册成功时才保持 active。
 */
export async function tryEnable(serverHost: string, defaultPort = 80): Promise<void> {
  await refreshProxyStatus();
  if (!preferred || !configured) {
    active = false;
    return;
  }

  if (!serverHost) {
    active = false;
    return;
  }
  try {
    const target = parseProxyServerHost(serverHost, defaultPort);
    if (!target) {
      active = false;
      return;
    }

    const res = await fetch("/api/proxy-register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: target.hostname, port: target.port }),
    });
    if (!res.ok) {
      active = false;
    }
  } catch (e) {
    logger.warn("Proxy registration failed", { serverHost, error: String(e) });
    active = false;
  }
}

/**
 * 同步转换 — 把本地 http URL 改写为 /__proxy__/ 路径
 *
 * 只有本地/LAN 的 http 地址才会被改写，其他地址原样返回。
 * 浏览器请求 /__proxy__/ 路径时，后端会注册 shanbox 并 302 重定向。
 */
export function proxyUrlSync(originalUrl: string): string {
  if (!active) return originalUrl;
  try {
    const parsed = new URL(originalUrl);
    if (parsed.protocol !== "http:") return originalUrl;
    if (!isLocalAddress(parsed.hostname)) return originalUrl;
    return `/__proxy__/${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (e) {
    logger.warn("Failed to parse URL for proxy rewrite", { originalUrl, error: String(e) });
    return originalUrl;
  }
}

export interface ProxyCheckResult {
  url: string;
  error?: string;
}

/**
 * 异步前置检测 + 转换 — preview 渲染前调用
 *
 * 1. 非本地地址 → 原样返回
 * 2. 本地地址 → 调后端 /api/proxy-check 探测 TCP 可达性
 *    - 可达 → 返回 /__proxy__/ 路径
 *    - 不可达 → 返回错误信息（服务只监听 127.0.0.1）
 */
export async function checkProxyUrl(originalUrl: string): Promise<ProxyCheckResult> {
  if (!active) return { url: originalUrl };
  try {
    const parsed = new URL(originalUrl);
    if (parsed.protocol !== "http:") return { url: originalUrl };
    if (!isLocalAddress(parsed.hostname)) return { url: originalUrl };

    const colonIdx = parsed.host.lastIndexOf(":");
    const host = colonIdx >= 0 ? parsed.host.slice(0, colonIdx) : parsed.host;
    const port = colonIdx >= 0 ? parseInt(parsed.host.slice(colonIdx + 1), 10) : 80;

    const res = await fetch("/api/proxy-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host, port }),
    });
    const data = (await res.json()) as { reachable?: boolean };

    if (!data.reachable) {
      return {
        url: originalUrl,
        error: `${parsed.host} 服务未在局域网开放，可能只监听 127.0.0.1`,
      };
    }

    return { url: `/__proxy__/${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}` };
  } catch (e) {
    logger.warn("Proxy URL check failed", { originalUrl, error: String(e) });
    return { url: originalUrl };
  }
}
