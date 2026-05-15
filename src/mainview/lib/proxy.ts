/**
 * 本地代理模块 — 把 localhost / LAN 地址转成 /__proxy__/ 路径
 *
 * 前端只做一件事：识别本地地址，把 URL 改写成 /__proxy__/host:port/path。
 * 实际的注册和 302 重定向由后端 /__proxy__/ 端点处理。
 *
 * 流程：
 *   1. preview 发现 http://localhost:8080/index.html
 *   2. proxyUrlSync() → /__proxy__/localhost:8080/index.html
 *   3. 浏览器请求 /__proxy__/localhost:8080/index.html（同源）
 *   4. 后端探测可达性 → 注册 shanbox → 302 到 https://xxx.shanbox:8443/index.html
 *   5. 浏览器跟随 302，从 shanbox 加载内容
 */

// ---- 内部状态 ----

let active = false;

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

/** 开启代理 */
export function enableProxy(): void {
  active = true;
}

/** 关闭代理 */
export function disableProxy(): void {
  active = false;
}

/**
 * 启动时检测：向后端发一个注册请求来验证代理是否可用
 * - 后端配了 PROXY_API_URL → 注册成功 → 开启
 * - 后端没配 → 502 → 自动关闭
 */
export async function tryEnable(serverHost: string): Promise<void> {
  active = true;
  if (!serverHost) {
    active = false;
    return;
  }
  try {
    const colonIdx = serverHost.lastIndexOf(":");
    const hostname = colonIdx >= 0 ? serverHost.slice(0, colonIdx) : serverHost;
    const port = colonIdx >= 0 ? parseInt(serverHost.slice(colonIdx + 1), 10) : 3100;

    const res = await fetch("/api/proxy-register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: hostname, port }),
    });
    if (!res.ok) {
      active = false;
    }
  } catch {
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
    return `/__proxy__/${parsed.host}${parsed.pathname}${parsed.search}`;
  } catch {
    return originalUrl;
  }
}
