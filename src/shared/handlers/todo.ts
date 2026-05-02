import type { RPCServer } from "@dyyz1993/rpc-core";
import type { RPCMethods, HandlerOptions } from "../rpc-schema";
import type { TodoItem } from "../modules/todo";
import { readFile } from "fs/promises";
import { existsSync } from "fs";

type P<K extends keyof RPCMethods> = RPCMethods[K] extends { params: infer P } ? P : never;
type R<K extends keyof RPCMethods> = RPCMethods[K] extends { result: infer R } ? R : never;

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = <K extends keyof RPCMethods & string>(
    method: K,
    handler: (params: P<K>) => Promise<R<K>>,
  ) => {
    server.register(method, handler as (params: unknown) => Promise<unknown>);
  };

  r("todo.list", async (params) => {
    const { sessionPath } = params;

    if (!existsSync(sessionPath)) {
      return { todos: [] };
    }

    try {
      const content = await readFile(sessionPath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());

      let todos: TodoItem[] = [];

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as Record<string, unknown>;

          if (entry.type === "custom" && entry.customType === "todo") {
            const data = entry.data as { action: string; todos: TodoItem[]; nextId: number } | undefined;
            if (data?.todos) {
              todos = data.todos;
            }
          }

          if (entry.type === "message") {
            const msg = entry.message as Record<string, unknown> | undefined;
            if (msg?.role === "toolResult" && msg?.toolName === "todo") {
              const details = msg.details as { action: string; todos: TodoItem[]; nextId: number } | undefined;
              if (details?.todos) {
                todos = details.todos;
              }
            }
          }
        } catch {
          continue;
        }
      }

      return { todos };
    } catch {
      return { todos: [] };
    }
  });
}
