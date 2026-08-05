import type { RPCServer } from "@dyyz1993/rpc-core";
import * as readline from "node:readline";
import { createReadStream, existsSync } from "node:fs";
import type { HandlerOptions } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import type { TodoItem } from "../modules/todo";
import { createLogger } from "../lib/logger";

const log = createLogger("session");

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = createRegister(server);

  r("todo.list", async (params) => {
    const { sessionPath } = params;

    if (!existsSync(sessionPath)) {
      return { todos: [] };
    }

    // Stream the file so 100MB sessions don't blow memory.
    let todos: TodoItem[] = [];
    const rl = readline.createInterface({
      input: createReadStream(sessionPath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });

    try {
      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as Record<string, unknown>;

          if (entry.type === "custom" && entry.customType === "todo") {
            const data = entry.data as
              | { action: string; todos: TodoItem[]; nextId: number }
              | undefined;
            if (data?.todos) {
              todos = data.todos;
            }
          }

          if (entry.type === "message") {
            const msg = entry.message as Record<string, unknown> | undefined;
            if (msg?.role === "toolResult" && msg?.toolName === "todo") {
              const details = msg.details as
                | { action: string; todos: TodoItem[]; nextId: number }
                | undefined;
              if (details?.todos) {
                todos = details.todos;
              }
            }
          }
        } catch {
          log.debug("todo.list: skipping malformed JSONL line");
          continue;
        }
      }
    } catch (e) {
      log.debug("todo.list: failed to read session file", { sessionPath, error: String(e) });
      return { todos: [] };
    } finally {
      rl.close();
    }

    return { todos };
  });
}
