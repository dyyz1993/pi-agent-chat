import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions, R } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import type { MemoryFile, MemoryStatusResult } from "../modules/memory";
import { readdir, readFile, stat } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { getProcessManager } from "./agent";
import { createLogger } from "../lib/logger";
import { withTimeout } from "../lib/with-timeout";
import { getLegacyMemoryProjectDir, isPathInsideUserMemoryDir } from "../lib/pi-agent-paths";

const log = createLogger("mcp");

const CHANNEL_TIMEOUT_MS = 1_000;

function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---")) return { frontmatter: {}, body: normalized };
  const endIndex = normalized.indexOf("\n---", 3);
  if (endIndex === -1) return { frontmatter: {}, body: normalized };
  const yamlString = normalized.slice(4, endIndex);
  const body = normalized.slice(endIndex + 4).trim();
  const frontmatter: Record<string, string> = {};
  for (const line of yamlString.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    if (key) frontmatter[key] = value;
  }
  return { frontmatter, body };
}

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = createRegister(server);

  async function fallbackListFiles(projectPath: string): Promise<R<"memory.listFiles">> {
    const memoryDir = getLegacyMemoryProjectDir(projectPath);

    if (!existsSync(memoryDir)) {
      return { files: [], entrypointContent: null, memoryDir };
    }

    const files: MemoryFile[] = [];

    const entries = await readdir(memoryDir);
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      if (!entry.endsWith(".md")) continue;
      if (entry === "MEMORY.md") continue;

      const filePath = join(memoryDir, entry);
      try {
        const s = await stat(filePath);
        if (!s.isFile()) continue;
        const content = await readFile(filePath, "utf-8");
        const { frontmatter } = parseFrontmatter(content);
        files.push({
          filename: entry,
          filePath,
          description: frontmatter.description ?? frontmatter.name ?? null,
          type: (["user", "feedback", "project", "reference"].includes(frontmatter.type)
            ? frontmatter.type
            : null) as MemoryFile["type"],
          mtimeMs: s.mtimeMs,
          size: s.size,
        });
      } catch (err) {
        log.warn("failed to parse memory file", { filePath, error: String(err) });
      }
    }

    files.sort((a, b) => b.mtimeMs - a.mtimeMs);

    let entrypointContent: string | null = null;
    const entrypointPath = join(memoryDir, "MEMORY.md");
    if (existsSync(entrypointPath)) {
      try {
        entrypointContent = await readFile(entrypointPath, "utf-8");
      } catch (err) {
        log.warn("failed to read MEMORY.md", { error: String(err) });
      }
    }

    return { files, entrypointContent, memoryDir };
  }

  r("memory.listFiles", async (params) => {
    const manager = getProcessManager();
    if (manager) {
      const sessionId = params.sessionId;
      if (sessionId && manager.hasSession(sessionId)) {
        try {
          const result = (await withTimeout(
            manager.callChannel(sessionId, "memory", "memory.list", {
              projectPath: params.projectPath,
            }),
            CHANNEL_TIMEOUT_MS,
          )) as {
            files: MemoryFile[];
            entrypointContent: string | null;
            memoryDir?: string;
          } | null;
          if (result) return { ...result, memoryDir: result.memoryDir ?? "" };
        } catch (err) {
          log.warn("channel call failed", { error: String(err) });
        }
      }
    }

    return fallbackListFiles(params.projectPath);
  });

  r("memory.readFile", async (params) => {
    if (!isPathInsideUserMemoryDir(params.filePath)) {
      throw new Error("Path outside memory directory");
    }
    const content = await readFile(params.filePath, "utf-8");
    const s = await stat(params.filePath);
    return { content, size: s.size };
  });

  r("memory.remember", async (params) => {
    const manager = getProcessManager();
    if (manager && manager.hasSession(params.sessionId)) {
      try {
        await withTimeout(
          manager.callChannel(params.sessionId, "memory", "memory.userRemember", {
            sourceSessionId: params.sessionId,
            sourceMessageIds: params.messageIds,
            content: params.content,
          }),
          CHANNEL_TIMEOUT_MS,
        );
      } catch (err) {
        log.warn("memory.remember channel call failed", {
          sessionId: params.sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { ok: true };
  });

  r("memory.getStatus", async (params) => {
    const manager = getProcessManager();
    if (manager && params.sessionId && manager.hasSession(params.sessionId)) {
      try {
        const result = (await withTimeout(
          manager.callChannel(params.sessionId, "memory", "memory.getStatus", {}),
          CHANNEL_TIMEOUT_MS,
        )) as MemoryStatusResult | null;
        if (result) return result;
      } catch (err) {
        log.warn("memory.getStatus channel call failed", { error: String(err) });
      }
    }
    return {
      skipRules: { builtin: [], custom: [] },
      guardRules: { builtin: [], custom: [] },
      excludeKeywords: [],
      recentQueries: [],
      dream: { lastRunAt: null },
    };
  });

  r("memory.removeRule", async (params) => {
    const manager = getProcessManager();
    if (manager && params.sessionId && manager.hasSession(params.sessionId)) {
      try {
        await withTimeout(
          manager.callChannel(params.sessionId, "memory", "memory.removeRule", {
            rule: params.rule,
            excludeKeyword: params.excludeKeyword,
          }),
          CHANNEL_TIMEOUT_MS,
        );
      } catch (err) {
        log.warn("memory.removeRule channel call failed", {
          sessionId: params.sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { ok: true };
  });

  r("memory.addRule", async (params) => {
    const manager = getProcessManager();
    if (manager && params.sessionId && manager.hasSession(params.sessionId)) {
      try {
        await withTimeout(
          manager.callChannel(params.sessionId, "memory", "memory.addRule", {
            pattern: params.pattern,
            mode: params.mode,
            action: params.action,
          }),
          CHANNEL_TIMEOUT_MS,
        );
      } catch (err) {
        log.warn("memory.addRule channel call failed", {
          sessionId: params.sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { ok: true };
  });
}
