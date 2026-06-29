import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, randomInt } from "node:crypto";
import { once } from "node:events";
import { buffer as readStreamBuffer } from "node:stream/consumers";

import { AuthStorage, ModelRegistry } from "@dyyz1993/pi-coding-agent";
import type { Api, Model } from "@dyyz1993/pi-ai";

import { createLogger } from "../lib/logger";

const log = createLogger("model-proxy");

const PROXY_HEADER_TOKEN = "x-pi-model-proxy-token";
const PROXY_HEADER_PROVIDER = "x-pi-model-proxy-provider";
const PROXY_HEADER_MODEL = "x-pi-model-proxy-model";
const PROXY_HEADER_API = "x-pi-model-proxy-api";

type LocalModelRegistry = Pick<ModelRegistry, "getAvailable" | "getAll" | "getApiKeyAndHeaders">;

export interface StartedModelProxy {
  localPort: number;
  remotePort: number;
  token: string;
  remoteUrl: string;
  env: Record<string, string>;
  sshArgs: string[];
  stop: () => Promise<void>;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function stripProxyHeaders(headers: IncomingMessage["headers"]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (
      lower === "host" ||
      lower === "connection" ||
      lower === "accept-encoding" ||
      lower === "content-length" ||
      lower === "user-agent" ||
      lower.startsWith("x-pi-model-proxy-") ||
      lower === "proxy-authorization"
    ) {
      continue;
    }
    if (Array.isArray(value)) {
      result[name] = value.join(", ");
    } else if (typeof value === "string") {
      result[name] = value;
    }
  }
  return result;
}

function stripUpstreamResponseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of headers.entries()) {
    const lower = name.toLowerCase();
    if (
      lower === "connection" ||
      lower === "content-encoding" ||
      lower === "content-length" ||
      lower === "keep-alive" ||
      lower === "proxy-authenticate" ||
      lower === "proxy-authorization" ||
      lower === "te" ||
      lower === "trailer" ||
      lower === "transfer-encoding" ||
      lower === "upgrade"
    ) {
      continue;
    }
    result[name] = value;
  }
  return result;
}

async function readRequestBody(req: IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  return readStreamBuffer(req);
}

async function pipeResponseBody(response: Response, res: ServerResponse): Promise<void> {
  if (!response.body) {
    res.end();
    return;
  }

  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(Buffer.from(value))) {
        await once(res, "drain");
      }
    }
    res.end();
  } catch (error) {
    log.warn("model proxy upstream response stream failed", {
      err: error instanceof Error ? error.message : String(error),
    });
    res.end();
  } finally {
    reader.releaseLock();
  }
}

function injectAuthHeaders(input: {
  headers: Record<string, string>;
  apiKey?: string;
  authHeaders?: Record<string, string>;
  api?: string;
}): Record<string, string> {
  const headers = { ...input.headers };
  const apiKey = input.apiKey;

  if (apiKey) {
    let replaced = false;
    for (const name of Object.keys(headers)) {
      const lower = name.toLowerCase();
      if (lower === "authorization") {
        headers[name] = `Bearer ${apiKey}`;
        replaced = true;
      } else if (lower === "x-api-key" || lower === "api-key") {
        headers[name] = apiKey;
        replaced = true;
      } else if (lower === "cf-aig-authorization") {
        headers[name] = `Bearer ${apiKey}`;
        replaced = true;
      }
    }

    if (!replaced) {
      if (input.api === "anthropic-messages") {
        headers["x-api-key"] = apiKey;
      } else {
        headers.Authorization = `Bearer ${apiKey}`;
      }
    }
  }

  if (input.authHeaders) {
    for (const [name, value] of Object.entries(input.authHeaders)) {
      headers[name] = value;
    }
  }

  return headers;
}

function sanitizeModels(models: Model<Api>[]): Model<Api>[] {
  return models.map((model) => {
    const compat = normalizeProxyModelCompat(model);
    return {
      id: model.id,
      name: model.name,
      api: model.api,
      provider: model.provider,
      baseUrl: model.baseUrl,
      reasoning: model.reasoning,
      thinkingLevelMap: model.thinkingLevelMap,
      input: model.input,
      cost: model.cost,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      headers: model.headers,
      compat,
    };
  });
}

function normalizeProxyModelCompat(model: Model<Api>): Model<Api>["compat"] {
  const compat = model.compat;
  if (
    model.api === "openai-completions" &&
    (model.provider === "opencode-go" ||
      model.provider === "opencode-go-compact-test" ||
      model.baseUrl.startsWith("https://opencode.ai/zen/go/"))
  ) {
    return {
      ...(compat ?? {}),
      supportsDeveloperRole: false,
    };
  }
  return compat;
}

function findModel(
  registry: LocalModelRegistry,
  provider: string | undefined,
  modelId: string | undefined,
): Model<Api> | undefined {
  if (!provider || !modelId) return undefined;
  return registry.getAll().find((model) => model.provider === provider && model.id === modelId);
}

async function writeJson(res: ServerResponse, status: number, value: unknown): Promise<void> {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

function buildUpstreamUrl(baseUrl: string, upstreamPath: string, search: string): URL {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedPath = upstreamPath.replace(/^\/+/, "");
  return new URL(normalizedPath + search, normalizedBase);
}

export function createModelProxyServer(options: {
  token: string;
  registry?: LocalModelRegistry;
}): Server {
  const registry = options.registry ?? ModelRegistry.create(AuthStorage.create());

  return createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      const token = req.headers[PROXY_HEADER_TOKEN];
      const bearer = req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice("Bearer ".length)
        : undefined;
      if (token !== options.token && bearer !== options.token) {
        await writeJson(res, 401, { error: "Unauthorized model proxy request" });
        return;
      }

      if (req.method === "GET" && requestUrl.pathname === "/models") {
        await writeJson(res, 200, { models: sanitizeModels(registry.getAvailable()) });
        return;
      }

      const match = requestUrl.pathname.match(/^\/proxy\/([^/]+)(\/.*)?$/);
      if (!match) {
        await writeJson(res, 404, { error: "Unknown model proxy route" });
        return;
      }

      const upstreamBaseUrl = Buffer.from(match[1], "base64url").toString("utf8");
      const upstreamPath = match[2] ?? "/";
      const upstreamUrl = buildUpstreamUrl(upstreamBaseUrl, upstreamPath, requestUrl.search);
      const provider = req.headers[PROXY_HEADER_PROVIDER];
      const modelId = req.headers[PROXY_HEADER_MODEL];
      const api = req.headers[PROXY_HEADER_API];
      const model = findModel(
        registry,
        Array.isArray(provider) ? provider[0] : provider,
        Array.isArray(modelId) ? modelId[0] : modelId,
      );
      if (!model) {
        await writeJson(res, 404, { error: "Model not available in local registry" });
        return;
      }

      const auth = await registry.getApiKeyAndHeaders(model);
      if (!auth.ok) {
        await writeJson(res, 401, { error: auth.error });
        return;
      }

      const strippedHeaders = stripProxyHeaders(req.headers);
      const upstreamHeaders = injectAuthHeaders({
        headers: strippedHeaders,
        apiKey: auth.apiKey,
        authHeaders: auth.headers,
        api: Array.isArray(api) ? api[0] : api,
      });

      const requestBody = await readRequestBody(req);
      const response = await fetch(upstreamUrl, {
        method: req.method,
        headers: upstreamHeaders,
        body: requestBody ? new Uint8Array(requestBody) : null,
      });

      res.writeHead(response.status, stripUpstreamResponseHeaders(response.headers));
      await pipeResponseBody(response, res);
    } catch (error) {
      log.warn("model proxy request failed", {
        err: error instanceof Error ? error.message : String(error),
      });
      if (!res.headersSent) {
        await writeJson(res, 500, { error: "Model proxy request failed" });
      } else {
        res.end();
      }
    }
  });
}

async function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Model proxy did not bind to a TCP port"));
        return;
      }
      resolve(address.port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
}

export function buildRemoteModelProxyEnv(options: {
  remoteUrl: string;
  token: string;
  models: Model<Api>[];
}): Record<string, string> {
  return {
    PI_MODEL_PROXY_URL: options.remoteUrl,
    PI_MODEL_PROXY_TOKEN: options.token,
    PI_MODEL_PROXY_MODELS_JSON: JSON.stringify(sanitizeModels(options.models)),
  };
}

export async function startModelProxy(options?: {
  registry?: LocalModelRegistry;
  remotePort?: number;
}): Promise<StartedModelProxy> {
  const token = randomBytes(24).toString("base64url");
  const registry = options?.registry ?? ModelRegistry.create(AuthStorage.create());
  const server = createModelProxyServer({ token, registry });
  const localPort = await listen(server);
  const remotePort = options?.remotePort ?? randomInt(39000, 49000);
  const remoteUrl = `http://127.0.0.1:${remotePort}`;
  const env = buildRemoteModelProxyEnv({
    remoteUrl,
    token,
    models: registry.getAvailable(),
  });

  return {
    localPort,
    remotePort,
    token,
    remoteUrl,
    env,
    sshArgs: ["-R", `127.0.0.1:${remotePort}:127.0.0.1:${localPort}`],
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

export function encodeModelProxyBaseUrl(baseUrl: string): string {
  return base64UrlEncode(baseUrl);
}
