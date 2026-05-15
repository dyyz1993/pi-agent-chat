import { createLogger } from "../shared/lib/logger";
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

function checkReachable(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
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
      const res = await fetch(routesApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
