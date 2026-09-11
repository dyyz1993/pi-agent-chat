import { createLogger } from "../shared/lib/logger";
import https from "node:https";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import { createConnection } from "node:net";

const log = createLogger("proxy-register");

export interface ProxyRegistrar {
  register(targetHost: string, targetPort: number): Promise<string | null>;
}

function generateSubdomain(): string {
  return randomBytes(3).toString("hex");
}

function isLocalhost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function checkReachable(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.setTimeout(timeoutMs);
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/** 获取本机局域网 IP（优先 192.168.x.x） */
function getLanIp(): string | null {
  const interfaces = networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }
  return null;
}

export function createProxyRegistrar(
  proxyApiUrl: string,
  proxyPublicDomain: string,
): ProxyRegistrar {
  const routesApiUrl = proxyApiUrl.replace(/\/__api__\/register$/, "/__api__/routes");
  const lanIp = getLanIp();
  const cache = new Map<string, string>();
  const pending = new Map<string, Promise<string | null>>();

  async function doRegister(targetHost: string, targetPort: number): Promise<string | null> {
    const subdomain = generateSubdomain();
    const body: Record<string, unknown> = {
      subdomain,
      port: targetPort,
      policy: "public",
    };

    let reachHost = targetHost;
    if (isLocalhost(targetHost)) {
      if (lanIp) {
        body.host = lanIp;
        reachHost = lanIp;
      }
    } else {
      body.host = targetHost;
    }

    const reachable = await checkReachable(reachHost, targetPort);
    if (!reachable) {
      log.warn("Target not reachable on LAN, skip register", {
        targetHost,
        targetPort,
        reachHost,
      });
      return null;
    }

    try {
      // shanbox manage-route API uses {address: "host:port", policy} instead of
      // {subdomain, port, host}; detect by the /__api__/ path style.
      const shanboxStyle = routesApiUrl.includes("/__api__/");
      const payload = shanboxStyle
        ? { address: `${targetHost}:${targetPort}`, policy: "public" }
        : body;

      // Self-signed endpoints (e.g. LAN IP serving the wildcard cert) need a
      // per-request agent; NODE_TLS_REJECT_UNAUTHORIZED=0 is too broad.
      const insecure = process.env.PROXY_API_INSECURE_TLS === "1";
      const insecureAgent =
        insecure && routesApiUrl.startsWith("https://")
          ? new https.Agent({ rejectUnauthorized: false, servername: new URL(routesApiUrl).hostname })
          : undefined;

      // The LAN endpoint (IP-based) resets requests whose Host header doesn't
      // match a known vhost — set Host to the public domain explicitly.
      let hostHeader: string | undefined;
      if (shanboxStyle) {
        const u = new URL(routesApiUrl);
        hostHeader = proxyPublicDomain;
        if (u.port) hostHeader = `${proxyPublicDomain}:${u.port}`;
      }
      // Intermittent middlebox RSTs were observed on LAN Wi-Fi; retry twice.
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(routesApiUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(hostHeader ? { Host: hostHeader } : {}),
            },
            body: JSON.stringify(payload),
            ...(insecureAgent ? { agent: insecureAgent } : {}),
          });

          if (!res.ok) {
            log.warn("Register failed", {
              status: res.status,
              targetHost,
              targetPort,
            });
            return null;
          }

          const publicUrl = `https://${subdomain}.${proxyPublicDomain}`;
          log.info("Registered proxy", { targetHost, targetPort, publicUrl });
          return publicUrl;
        } catch (err) {
          lastErr = err;
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        }
      }
      log.warn("Register error after retries", {
        targetHost,
        targetPort,
        error: lastErr instanceof Error ? lastErr.message : String(lastErr),
      });
      return null;
    } catch (err) {
      log.warn("Register error", {
        targetHost,
        targetPort,
        error: String(err),
      });
      return null;
    }
  }

  return {
    async register(targetHost: string, targetPort: number): Promise<string | null> {
      const cacheKey = `${targetHost}:${targetPort}`;

      const cached = cache.get(cacheKey);
      if (cached) return cached;

      let p = pending.get(cacheKey);
      if (!p) {
        p = doRegister(targetHost, targetPort).finally(() => {
          pending.delete(cacheKey);
        });
        pending.set(cacheKey, p);
      }

      const result = await p;
      if (result) {
        cache.set(cacheKey, result);
      }
      return result;
    },
  };
}
