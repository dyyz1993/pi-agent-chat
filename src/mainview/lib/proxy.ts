/**
 * 本地代理模块 — 把 localhost / LAN 地址转成公网可访问的 HTTPS URL
 *
 * 前端通过 same-origin 调后端端点 /api/proxy-register，由后端负责
 * 调用外部代理服务（如 shanbox）进行注册和缓存。
 *
 * 生命周期：
 *   1. 启动时调用 tryEnable() → 尝试注册本机地址
 *      成功 → 代理开启，后续 URL 自动转换
 *      失败（502）→ 代理关闭
 *   2. 设置面板可手动开关
 */

interface ProxyEntry {
  baseUrl: string; // e.g. "https://xxx.shanbox.19930810.xyz:8443"
}

// ---- 内部状态 ----

let active = false;
const cache = new Map<string, ProxyEntry>();
const pendingReg = new Map<string, Promise<ProxyEntry | null>>();

// ---- 公开 API ----

/** 代理是否已启用 */
export function isProxyEnabled(): boolean {
  return active;
}

/** 开启代理 */
export function enableProxy(): void {
  active = true;
}

/** 关闭代理（清空缓存） */
export function disableProxy(): void {
  active = false;
  cache.clear();
}

/**
 * 启动时自动检测：尝试注册本机地址
 * - 后端配了 PROXY_API_URL → 注册成功 → 开启
 * - 后端没配 → 502 → 自动关闭
 *
 * @param serverHost 服务端地址，如 "192.168.0.4:3100"
 */
export async function tryEnable(serverHost: string): Promise<void> {
  active = true;
  if (!serverHost) {
    active = false;
    return;
  }
  const result = await registerHost(serverHost);
  if (!result) {
    active = false;
  }
}

/**
 * 同步转换 — 仅查缓存，未命中返回原始 URL
 *
 * 适用场景：React render 函数等同步上下文
 */
export function proxyUrlSync(originalUrl: string): string {
  if (!active) return originalUrl;
  try {
    const parsed = new URL(originalUrl);
    if (parsed.protocol === "file:" || parsed.protocol === "https:") return originalUrl;
    const entry = cache.get(parsed.host);
    if (!entry) return originalUrl;
    return buildProxiedUrl(originalUrl, entry);
  } catch {
    return originalUrl;
  }
}

/**
 * 异步转换 — 缓存未命中时调后端注册
 *
 * 适用场景：store action、useEffect 等
 */
export async function proxyUrl(originalUrl: string): Promise<string> {
  if (!active) return originalUrl;
  try {
    const parsed = new URL(originalUrl);
    if (parsed.protocol === "file:" || parsed.protocol === "https:") return originalUrl;

    const cached = cache.get(parsed.host);
    if (cached) return buildProxiedUrl(originalUrl, cached);

    let p = pendingReg.get(parsed.host);
    if (!p) {
      p = registerHost(parsed.host).finally(() => pendingReg.delete(parsed.host));
      pendingReg.set(parsed.host, p);
    }

    const entry = await p;
    if (!entry) return originalUrl;
    return buildProxiedUrl(originalUrl, entry);
  } catch {
    return originalUrl;
  }
}

/**
 * 预热：注册一批 host，让后续 proxyUrlSync() 能命中缓存
 */
export async function warmupProxyCache(hosts: string[]): Promise<void> {
  if (!active) return;
  await Promise.allSettled(hosts.map((h) => proxyUrl(`http://${h}/`)));
}

// ---- 内部 ----

async function registerHost(host: string): Promise<ProxyEntry | null> {
  try {
    const colonIdx = host.lastIndexOf(":");
    const hostname = colonIdx >= 0 ? host.slice(0, colonIdx) : host;
    const port = colonIdx >= 0 ? parseInt(host.slice(colonIdx + 1), 10) : 80;

    const res = await fetch("/api/proxy-register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: hostname, port }),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as { publicUrl?: string };
    if (!data.publicUrl) return null;

    const entry: ProxyEntry = { baseUrl: data.publicUrl.replace(/\/+$/, "") };
    cache.set(host, entry);
    return entry;
  } catch {
    return null;
  }
}

function buildProxiedUrl(originalUrl: string, entry: ProxyEntry): string {
  const proxyParsed = new URL(entry.baseUrl);
  const result = new URL(originalUrl);
  result.protocol = proxyParsed.protocol;
  result.host = proxyParsed.host;
  return result.toString();
}
