/**
 * 本地代理模块 — 把 localhost / LAN 地址转成公网可访问的 HTTPS 代理 URL
 *
 * 配置来源：后端 .env 的 PROXY_API_URL，通过 /api/proxy-config 接口暴露给前端
 *
 * 代理服务 API（如 shanbox）：
 *   POST /__api__/register  { "address": "192.168.0.4:3000" }
 *   → { subdomain, key, url: "https://xxx.shanbox...:8443", ... }
 *
 * 前端使用：
 *   - proxyUrl(url)       异步，缓存未命中时会调代理 API 注册
 *   - proxyUrlSync(url)   同步，仅查缓存，未命中返回原始 URL
 *   - warmupProxyCache()  预热，启动时注册服务自身地址
 */

interface ProxyEntry {
  url: string; // e.g. "https://dm9ekm.shanbox.19930810.xyz:8443"
  key: string; // e.g. "spuw4kz3"
}

// ---- 内部状态（仅内存，不持久化） ----

let proxyApiUrl: string | null = null;
const cache = new Map<string, ProxyEntry>(); // host → entry
const pendingRegistrations = new Map<string, Promise<ProxyEntry | null>>(); // 去重

// ---- 初始化（从后端拉取） ----

/**
 * 从后端 /api/proxy-config 接口读取代理配置
 *
 * 前端启动时调用一次即可，配置来源是 .env 的 PROXY_API_URL
 */
export async function initProxyFromServer(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    // 从当前页面地址推导后端地址
    const base = `${window.location.protocol}//${window.location.host}`;
    const res = await fetch(`${base}/api/proxy-config`);
    if (!res.ok) return;
    const data = (await res.json()) as { proxyApiUrl: string | null };
    proxyApiUrl = data.proxyApiUrl ?? null;
  } catch {
    // 拉取失败，代理不启用
  }
}

/** 代理是否已启用 */
export function isProxyEnabled(): boolean {
  return !!proxyApiUrl;
}

/** 获取当前代理 API 地址 */
export function getProxyApiUrl(): string | null {
  return proxyApiUrl;
}

/**
 * 运行时开启代理（设置面板调用）
 *
 * @param apiUrl 代理注册 API 地址，如 "http://192.168.0.29:9080/__api__/register"
 */
export function enableProxy(apiUrl: string): void {
  proxyApiUrl = apiUrl;
}

/** 运行时关闭代理（设置面板调用） */
export function disableProxy(): void {
  proxyApiUrl = null;
  cache.clear();
}

// ---- URL 转换 ----

/**
 * 同步版本 — 仅查缓存，未命中返回原始 URL
 *
 * 适用场景：React render 函数等同步上下文
 */
export function proxyUrlSync(originalUrl: string): string {
  if (!proxyApiUrl) return originalUrl;
  try {
    const parsed = new URL(originalUrl);
    if (parsed.protocol === "https:") return originalUrl;
    if (parsed.protocol === "file:") return originalUrl;

    const cacheKey = parsed.host;
    const entry = cache.get(cacheKey);
    if (!entry) return originalUrl;

    return buildProxiedUrl(originalUrl, entry);
  } catch {
    return originalUrl;
  }
}

/**
 * 异步版本 — 如果缓存未命中，会调用代理 API 注册
 *
 * 适用场景：store action、事件处理、useEffect 等异步上下文
 */
export async function proxyUrl(originalUrl: string): Promise<string> {
  if (!proxyApiUrl) return originalUrl;
  try {
    const parsed = new URL(originalUrl);
    if (parsed.protocol === "https:") return originalUrl;
    if (parsed.protocol === "file:") return originalUrl;

    const cacheKey = parsed.host;
    const cached = cache.get(cacheKey);
    if (cached) return buildProxiedUrl(originalUrl, cached);

    // 注册（去重：同一 host 同时只发一次请求）
    let pending = pendingRegistrations.get(cacheKey);
    if (!pending) {
      pending = registerHost(cacheKey).finally(() => {
        pendingRegistrations.delete(cacheKey);
      });
      pendingRegistrations.set(cacheKey, pending);
    }

    const entry = await pending;
    if (!entry) return originalUrl;

    return buildProxiedUrl(originalUrl, entry);
  } catch {
    return originalUrl;
  }
}

/**
 * 预热缓存 — 批量注册多个 host
 *
 * 适用场景：应用启动时注册服务自身地址
 */
export async function warmupProxyCache(hosts: string[]): Promise<void> {
  if (!proxyApiUrl) return;
  await Promise.allSettled(hosts.map((h) => proxyUrl(`http://${h}/`)));
}

/**
 * 构造端口代理网关 URL — 用于 iframe 等场景
 *
 * 前端零异步：纯字符串拼接，将目标地址拼在 /__proxy__/ 后面
 * Server 端收到后自动注册并 307 重定向到公网地址
 *
 * @returns 拼接后的代理网关 URL，或 null（代理未启用或目标不是 HTTP）
 */
export function buildProxyGatewayUrl(targetUrl: string): string | null {
  if (!proxyApiUrl) return null;
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== "http:") return null;
    const base = `${window.location.protocol}//${window.location.host}`;
    return `${base}/__proxy__/${parsed.host}${parsed.pathname}`;
  } catch {
    return null;
  }
}

// ---- 内部实现 ----

async function registerHost(host: string): Promise<ProxyEntry | null> {
  if (!proxyApiUrl) return null;
  try {
    const res = await fetch(proxyApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: host }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      url?: string;
      key?: string;
      subdomain?: string;
    };
    if (!data.url || !data.key) return null;
    const entry: ProxyEntry = { url: data.url, key: data.key };
    cache.set(host, entry);
    return entry;
  } catch {
    return null;
  }
}

function buildProxiedUrl(originalUrl: string, entry: ProxyEntry): string {
  const proxyBase = new URL(entry.url);
  const result = new URL(originalUrl);
  result.protocol = proxyBase.protocol;
  result.host = proxyBase.host;
  result.searchParams.set("key", entry.key);
  return result.toString();
}
