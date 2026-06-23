import type { ChatMessage, ContentBlock, SessionMeta, ProjectTab, SessionStatus } from "../types";
import type { PersistedTab } from "../../shared/modules/project";
import type { BashChannelEvent, BashProcess } from "../../shared/modules/bash";
import type { LspChannelEvent } from "../../shared/modules/lsp";
import type { RulesChannelEvent } from "../../shared/modules/rules";
import type { SupervisorChannelEvent } from "../../shared/modules/supervisor";
import { apiClient } from "../lib/api-client";
import { useSessionStore, insertAfterPinned, clearStatusWatchdog } from "./use-session-store";
import { useChatStore, clearBackgroundRefreshGeneration } from "./use-chat-store";
import { useSubagentStore, handleSubagentEvent } from "./use-subagent-store";
import { useBashStore, handleBashEvent } from "./use-bash-store";
import { useLspStore } from "./use-lsp-store";
import { useRulesStore } from "./use-rules-store";
import { useMemoryStore } from "./use-memory-store";
import { useTurnStore } from "./use-turn-store";
import { useChatNavStore } from "./use-chat-nav-store";
import { useSupervisorStore } from "./use-supervisor-store";
import { useStatusStore } from "./use-status-store";
import { useChangeReviewStore } from "./use-change-review-store";
import { clearSessionFetchInitCache } from "./session-initial-state";
import { clearRetrySession } from "./use-retry-store";
import { handleAgentEvent, toolCallNameMap, toolCallArgsMap, cleanupEventHandlerMaps } from "../lib/agent-event-handler";
import { notificationGateway } from "../lib/notification-gateway";
import { useAppStore } from "./use-app-store";
import { useHooksStore } from "./use-hooks-store";
import { useSnapshotStore } from "./use-snapshot-store";
import { useTierStore } from "./use-tier-store";
import { useAgentStore } from "./use-agent-store";
import { clearAgentStarted } from "./use-session-store";
import { useSessionTodoStore } from "./use-session-todo-store";
import { useDelegateActivityStore } from "./use-delegate-activity-store";
import { createLogger } from "../../shared/lib/logger";

const perfLog = createLogger("session-perf");

function unsubscribeSubscriptionValue(value: string | undefined): void {
  if (!value) return;
  for (const subId of value.split(",").map((item) => item.trim())) {
    if (subId && subId !== "__pending__") apiClient.unsubscribe(subId);
  }
}

function syncCoordinatorChildSessionStatus(childSessionId: string, status: SessionStatus): void {
  const sessionStore = useSessionStore.getState();
  sessionStore.updateSessionStatus(childSessionId, status);

  const nextSessionStatus = status === "idle" ? "idle" : "running";
  const { sessionsByProject } = sessionStore;
  for (const [projectPath, sessions] of Object.entries(sessionsByProject)) {
    const idx = sessions.findIndex((session) => session.sessionId === childSessionId);
    if (idx === -1) continue;
    const updated = [...sessions];
    updated[idx] = { ...updated[idx], status: nextSessionStatus };
    useSessionStore.setState((prev) => ({
      sessionsByProject: { ...prev.sessionsByProject, [projectPath]: updated },
    }));
    return;
  }
}

function statusFromCoordinatorChildEvent(event: unknown): SessionStatus | null {
  if (!event || typeof event !== "object") return null;
  const type = (event as Record<string, unknown>).type;
  switch (type) {
    case "agent_start":
      return "streaming";
    case "agent_end":
      return "idle";
    case "compaction_start":
      return "compacting";
    case "auto_retry_start":
      return "retrying";
    case "extension_ui_request":
      return "permission";
    case "extension_ui_resolved":
    case "auto_retry_end":
      return "streaming";
    default:
      return null;
  }
}

type ToolExecBlock = Extract<ContentBlock, { type: "toolExecution" }>;

function normalizeBashCommand(args: string | undefined): string {
  if (!args) return "";
  try {
    const parsed = JSON.parse(args) as unknown;
    if (parsed && typeof parsed === "object" && parsed !== null) {
      const command = (parsed as Record<string, unknown>).command;
      if (typeof command === "string") return command.trim();
    }
  } catch {
    // Plain command strings are expected for live bash cards.
  }
  return args.trim();
}

function findBashProcess(event: BashChannelEvent): BashProcess | undefined {
  if (!event.toolCallId || !Array.isArray(event.processes)) return undefined;
  return event.processes.find((proc) => proc.toolCallId === event.toolCallId);
}

function bashProcessToToolStatus(proc: BashProcess): ToolExecBlock["status"] {
  if (proc.status === "done") return "done";
  if (proc.status === "error" || proc.status === "terminated") return "error";
  return "running";
}

function buildBashToolDetails(proc: BashProcess, previous: unknown): unknown {
  const base =
    previous && typeof previous === "object" ? (previous as Record<string, unknown>) : {};
  if (proc.status !== "terminated") return base;
  return {
    ...base,
    terminated: {
      reason: "terminated",
      pid: proc.pid,
      command: proc.command,
      startedAt: proc.startedAt,
      endedAt: proc.endedAt ?? Date.now(),
      durationMs: (proc.endedAt ?? Date.now()) - proc.startedAt,
      exitCode: proc.exitCode,
      logPath: proc.logPath,
    },
  };
}

function findBashToolBlockByProcess(
  messages: ChatMessage[],
  proc: BashProcess,
): { msgIndex: number; blockIndex: number; block: ToolExecBlock } | null {
  // Phase 1: exact toolCallId match (always preferred)
  for (let mi = messages.length - 1; mi >= 0; mi--) {
    const msg = messages[mi];
    if (msg.role !== "assistant") continue;
    for (let bi = msg.content.length - 1; bi >= 0; bi--) {
      const block = msg.content[bi];
      if (block.type !== "toolExecution" || block.toolName.toLowerCase() !== "bash") continue;
      if (block.toolCallId === proc.toolCallId) {
        return { msgIndex: mi, blockIndex: bi, block };
      }
    }
  }

  // Phase 2: semantic match by command text
  const targetCommand = proc.command.trim();
  let runningMatch: { msgIndex: number; blockIndex: number; block: ToolExecBlock } | null = null;
  let doneMatch: { msgIndex: number; blockIndex: number; block: ToolExecBlock } | null = null;
  let runningMatches = 0;

  for (let mi = messages.length - 1; mi >= 0; mi--) {
    const msg = messages[mi];
    if (msg.role !== "assistant") continue;
    for (let bi = msg.content.length - 1; bi >= 0; bi--) {
      const block = msg.content[bi];
      if (block.type !== "toolExecution" || block.toolName.toLowerCase() !== "bash") continue;
      if (normalizeBashCommand(block.args) !== targetCommand) continue;
      if (block.status === "running") {
        runningMatches++;
        runningMatch ??= { msgIndex: mi, blockIndex: bi, block };
      } else {
        doneMatch ??= { msgIndex: mi, blockIndex: bi, block };
      }
    }
  }

  // Prefer the running match (the command is actively executing)
  if (runningMatches === 1) return runningMatch;
  // Fallback to done block (output may arrive after the block was closed by message_end)
  if (runningMatch) return runningMatch; // multiple running — take the most recent
  return doneMatch;
}

export function reconcileChatToolFromBashEvent(sessionId: string, event: BashChannelEvent): void {
  // Handle output events for real-time streaming + terminal events for final status
  if (
    event.type !== "output" &&
    event.type !== "end" &&
    event.type !== "error" &&
    event.type !== "terminated"
  )
    return;
  const proc = findBashProcess(event);
  if (!proc) return;

  const chat = useChatStore.getState();
  const messages = chat.messagesBySession[sessionId] || [];
  const match = findBashToolBlockByProcess(messages, proc);
  if (!match) return;

  const isOutput = event.type === "output";
  const status = isOutput ? "running" : bashProcessToToolStatus(proc);
  const output = proc.output.length > 0 ? proc.output : (proc.error ?? match.block.output);
  const nextBlock: ToolExecBlock = {
    ...match.block,
    toolCallId: match.block.toolCallId,
    toolName: "bash",
    args: match.block.args || proc.command,
    status,
    output,
    details: isOutput ? match.block.details : buildBashToolDetails(proc, match.block.details),
    startedAt: match.block.startedAt ?? proc.startedAt,
    endedAt: isOutput ? match.block.endedAt : (proc.endedAt ?? Date.now()),
  };

  if (
    match.block.status === nextBlock.status &&
    match.block.output === nextBlock.output &&
    match.block.endedAt === nextBlock.endedAt
  ) {
    return;
  }

  const nextMessages = [...messages];
  const msg = nextMessages[match.msgIndex];
  const nextContent = [...msg.content];
  nextContent[match.blockIndex] = nextBlock;
  nextMessages[match.msgIndex] = { ...msg, content: nextContent };
  // Use streamingFastPath to bypass prepareMessagesForStore, which would
  // force-close running blocks when the assistant message isn't marked
  // isStreaming (common after page refresh when messages are loaded from
  // server without the streaming flag).
  chat.setMessagesForSession(sessionId, nextMessages, {
    streamingFastPath: true,
    bumpStreamVersion: true,
  });
}

/**
 * Replay bash processes from the bash store into the chat tool blocks.
 *
 * Use this when the chat messages have just been loaded (or the bash store
 * has just been populated) and bash events may have already been processed
 * before the chat block existed. Without this, output streamed in the
 * window between the bash subscription being set up and the chat messages
 * being loaded would be lost from the chat panel — the user would see
 * dynamic output in the bash panel sidebar but the chat's "Output" section
 * would stay empty.
 *
 * Idempotent: calling multiple times has no effect once the chat block
 * already reflects the latest bash state.
 */
export function syncBashStoreToChat(sessionId: string): void {
  const procs = useBashStore.getState().processesBySession[sessionId] || [];
  if (procs.length === 0) return;

  for (const proc of procs) {
    if (!proc.toolCallId) continue;
    // Synthesize a "output" event so reconcileChatToolFromBashEvent treats
    // this as live streaming. For processes that have already ended we use
    // "end" so the chat block transitions to its final status.
    const eventType: BashChannelEvent["type"] =
      proc.status === "running" || proc.status === "background" ? "output" : "end";
    const syntheticEvent: BashChannelEvent = {
      type: eventType,
      toolCallId: proc.toolCallId,
      processes: [proc],
      timestamp: proc.endedAt ?? Date.now(),
    };
    reconcileChatToolFromBashEvent(sessionId, syntheticEvent);
  }
}

export interface SubscriptionMaps {
  agentSubscriptions: Record<string, string>;
  subagentSubscriptions: Record<string, string>;
  todoSubscriptions: Record<string, string>;
  bashSubscriptions: Record<string, string>;
  lspSubscriptions: Record<string, string>;
  rulesSubscriptions: Record<string, string>;
  notifySubscriptions: Record<string, string>;
  memorySubscriptions: Record<string, string[]>;
  coordinatorSubscriptions: Record<string, string>;
  supervisorSubscriptions: Record<string, string>;
}

export type TodoPriority = "high" | "medium" | "low";

export interface TodoItem {
  id: number;
  text: string;
  done: boolean;
  priority?: TodoPriority;
  deleted?: boolean;
}

export function setupSubscriptions(
  state: SubscriptionMaps & { projectTabs: ProjectTab[]; activeProjectId: string | null },
  set: (fn: (s: SubscriptionMaps) => Partial<SubscriptionMaps>) => void,
  id: string,
  session: SessionMeta,
): void {
  const t0 = performance.now();
  perfLog.info("[setupSubs] begin", { sessionId: id });

  const {
    agentSubscriptions,
    subagentSubscriptions,
    todoSubscriptions,
    bashSubscriptions,
    lspSubscriptions,
    rulesSubscriptions,
    notifySubscriptions,
    memorySubscriptions,
    coordinatorSubscriptions,
    supervisorSubscriptions,
  } = state;
  if (!agentSubscriptions[id]) {
    set((s) => ({
      agentSubscriptions: { ...s.agentSubscriptions, [id]: "__pending__" },
    }));

    apiClient
      .subscribe(
        "agent.event",
        (payload) => {
          if (payload.sessionId !== id) return;
          handleAgentEvent(id, payload.event);
        },
        { sessionId: id },
      )
      .then((subId) => {
        set((s) => ({
          agentSubscriptions: { ...s.agentSubscriptions, [id]: subId },
        }));
      })
      .catch((err) => {
        set((s) => {
          const { [id]: _, ...rest } = s.agentSubscriptions;
          return { agentSubscriptions: rest };
        });
        useAppStore.getState().addLog(`[sub] ${String(err)}`);
      });
  }

  if (!subagentSubscriptions[id]) {
    set((s) => ({
      subagentSubscriptions: { ...s.subagentSubscriptions, [id]: "__pending__" },
    }));

    apiClient
      .subscribe(
        "subagent.event",
        (payload) => {
          if (payload.parentSessionId !== id) return;

          const subStore = useSubagentStore.getState();
          const sid = payload.subSessionId;
          const path = payload.parentSessionPath ?? session.sessionPath;
          const eventType = payload.event.type;

          if (eventType === "subagent_start") {
            const evt = payload.event as {
              type: "subagent_start";
              description: string;
              instruction: string;
              toolCallId?: string;
            };
            subStore.upsertLiveSubagent(path, sid, {
              sessionId: sid,
              toolCallId: evt.toolCallId,
              description: evt.description,
              instruction: evt.instruction,
              startedAt: Date.now(),
            });
            return;
          }

          const existing = subStore.subsessionsByParent[path] || [];
          if (!existing.find((s) => s.sessionId === sid)) {
            subStore.upsertLiveSubagent(path, sid, {
              sessionId: sid,
              startedAt: Date.now(),
            });
          }

          handleSubagentEvent(sid, payload.event as Parameters<typeof handleSubagentEvent>[1], id);

          if (eventType === "agent_end") {
            subStore.upsertLiveSubagent(path, sid, {
              completedAt: Date.now(),
              exitCode: 0,
            });
          }
        },
        { parentSessionId: id },
      )
      .then((subId) => {
        set((s) => ({
          subagentSubscriptions: { ...s.subagentSubscriptions, [id]: subId },
        }));
      })
      .catch((err) => {
        set((s) => {
          const { [id]: _, ...rest } = s.subagentSubscriptions;
          return { subagentSubscriptions: rest };
        });
        useAppStore.getState().addLog(`[sub] ${String(err)}`);
      });
  }

  if (!todoSubscriptions[id]) {
    set((s) => ({
      todoSubscriptions: { ...s.todoSubscriptions, [id]: "__pending__" },
    }));

    apiClient
      .subscribe(
        "todo.event",
        (payload: { sessionId: string; action: string; todos: TodoItem[]; timestamp: number }) => {
          if (payload.sessionId !== id) return;
          useSessionTodoStore.getState().setSessionTodos(id, payload.todos);
        },
        { sessionId: id },
      )
      .then((subId) => {
        set((s) => ({
          todoSubscriptions: { ...s.todoSubscriptions, [id]: subId },
        }));
        apiClient
          .call("todo.list", { sessionPath: session.sessionPath })
          .then((result) => {
            if (result.todos.length > 0) {
              useSessionTodoStore.getState().setSessionTodos(id, result.todos);
            }
          })
          .catch((err) => {
            useAppStore.getState().addLog(`[sub] ${String(err)}`);
          });
      })
      .catch((err) => {
        set((s) => {
          const { [id]: _, ...rest } = s.todoSubscriptions;
          return { todoSubscriptions: rest };
        });
        useAppStore.getState().addLog(`[sub] ${String(err)}`);
      });
  }

  if (!bashSubscriptions[id]) {
    set((s) => ({
      bashSubscriptions: { ...s.bashSubscriptions, [id]: "__pending__" },
    }));

    apiClient
      .subscribe(
        "bash.event",
        (payload: { sessionId: string; event: BashChannelEvent }) => {
          if (payload.sessionId !== id) return;
          handleBashEvent(id, payload.event);
          reconcileChatToolFromBashEvent(id, payload.event);
        },
        { sessionId: id },
      )
      .then((subId) => {
        set((s) => ({
          bashSubscriptions: { ...s.bashSubscriptions, [id]: subId },
        }));
        useBashStore
          .getState()
          .loadHistory(id)
          .then(() => {
            // Replay bash store into chat after history load — covers the case
            // where chat messages are still being fetched when bash history
            // arrives, or where the bash history itself has output we should
            // fold into the chat block immediately.
            syncBashStoreToChat(id);
          })
          .catch((err) => {
            useAppStore.getState().addLog(`[sub] ${String(err)}`);
          });
      })
      .catch((err) => {
        set((s) => {
          const { [id]: _, ...rest } = s.bashSubscriptions;
          return { bashSubscriptions: rest };
        });
        useAppStore.getState().addLog(`[sub] ${String(err)}`);
      });
  }

  if (!lspSubscriptions[id]) {
    set((s) => ({
      lspSubscriptions: { ...s.lspSubscriptions, [id]: "__pending__" },
    }));

    apiClient
      .subscribe(
        "lsp.event",
        (payload: { sessionId: string; event: LspChannelEvent }) => {
          if (payload.sessionId !== id) return;
          useLspStore.getState().handleLspEvent(id, payload.event);
        },
        { sessionId: id },
      )
      .then((subId) => {
        set((s) => ({
          lspSubscriptions: { ...s.lspSubscriptions, [id]: subId },
        }));
        useLspStore
          .getState()
          .loadHistory(session.sessionPath, id)
          .catch((err) => {
            useAppStore.getState().addLog(`[sub] ${String(err)}`);
          });
      })
      .catch((err) => {
        set((s) => {
          const { [id]: _, ...rest } = s.lspSubscriptions;
          return { lspSubscriptions: rest };
        });
        useAppStore.getState().addLog(`[sub] ${String(err)}`);
      });
  }

  if (!rulesSubscriptions[id]) {
    set((s) => ({
      rulesSubscriptions: { ...s.rulesSubscriptions, [id]: "__pending__" },
    }));

    apiClient
      .subscribe(
        "rules.event",
        (payload: { sessionId: string; event: RulesChannelEvent }) => {
          if (payload.sessionId !== id) return;
          useRulesStore.getState().handleRulesEvent(id, payload.event);
        },
        { sessionId: id },
      )
      .then((subId) => {
        set((s) => ({
          rulesSubscriptions: { ...s.rulesSubscriptions, [id]: subId },
        }));
      })
      .catch((err) => {
        set((s) => {
          const { [id]: _, ...rest } = s.rulesSubscriptions;
          return { rulesSubscriptions: rest };
        });
        useAppStore.getState().addLog(`[sub] ${String(err)}`);
      });
  }

  if (!notifySubscriptions[id]) {
    set((s) => ({
      notifySubscriptions: { ...s.notifySubscriptions, [id]: "__pending__" },
    }));

    apiClient
      .subscribe(
        "agent.notify",
        (payload: {
          sessionId: string;
          message: string;
          notifyType: "info" | "warning" | "error";
        }) => {
          if (payload.sessionId !== id) return;

          notificationGateway.emit({
            type: "agent_notify",
            sessionId: payload.sessionId,
            title: payload.message,
            body: "",
            level: payload.notifyType,
          });
        },
        { sessionId: id },
      )
      .then((subId) => {
        set((s) => ({
          notifySubscriptions: { ...s.notifySubscriptions, [id]: subId },
        }));
      })
      .catch((err) => {
        set((s) => {
          const { [id]: _, ...rest } = s.notifySubscriptions;
          return { notifySubscriptions: rest };
        });
        useAppStore.getState().addLog(`[sub] ${String(err)}`);
      });
  }

  if (!memorySubscriptions[id] || memorySubscriptions[id].length === 0) {
    set((s) => ({
      memorySubscriptions: { ...s.memorySubscriptions, [id]: ["__pending__"] },
    }));

    const projectTab = useSessionStore
      .getState()
      .projectTabs.find((t) => t.id === useSessionStore.getState().activeProjectId);
    const memorySubIds: string[] = [];

    function trackSub(promise: Promise<string>) {
      promise
        .then((subId) => {
          memorySubIds.push(subId);
          set((s) => ({
            memorySubscriptions: { ...s.memorySubscriptions, [id]: [...memorySubIds] },
          }));
        })
        .catch((err) => {
          if (memorySubIds.length === 0) {
            set((s) => {
              const { [id]: _, ...rest } = s.memorySubscriptions;
              return { memorySubscriptions: rest };
            });
          }
          useAppStore.getState().addLog(`[sub] ${String(err)}`);
        });
    }

    trackSub(
      apiClient.subscribe(
        "memory.bookmark_creating",
        (payload: { sessionId: string; timestamp: number }) => {
          if (payload.sessionId !== id) return;
          const memStore = useMemoryStore.getState();
          memStore.addEvent(id, {
            id: `mem-creating-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            customType: "bookmark_creating",
            data: payload,
            timestamp: payload.timestamp || Date.now(),
          });
          memStore.setBookmarkCreating(id, true);
        },
        { sessionId: id },
      ),
    );

    trackSub(
      apiClient.subscribe(
        "memory.updated",
        (payload: {
          sessionId: string;
          files: Array<{
            filename: string;
            filePath: string;
            description: string | null;
            type: string | null;
            mtimeMs: number;
          }>;
          timestamp: number;
        }) => {
          if (payload.sessionId !== id) return;
          const memStore = useMemoryStore.getState();
          memStore.addEvent(id, {
            id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            customType: "memory_updated",
            data: payload,
            timestamp: payload.timestamp,
          });
          memStore.setBookmarkCreating(id, false);
          if (projectTab) {
            memStore.loadFiles(projectTab.path, id);
          }
        },
        { sessionId: id },
      ),
    );

    trackSub(
      apiClient.subscribe(
        "memory.update_failed",
        (payload: { sessionId: string; reason: string; timestamp: number }) => {
          if (payload.sessionId !== id) return;
          const memStore = useMemoryStore.getState();
          memStore.addEvent(id, {
            id: `mem-fail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            customType: "memory_update_failed",
            data: payload,
            timestamp: payload.timestamp,
          });
          memStore.setBookmarkCreating(id, false);
        },
        { sessionId: id },
      ),
    );

    const MEMORY_OPERATION_EVENTS = [
      "memory.memory_prefetch",
      "memory.memory_prefetch_result",
      "memory.memory_extract",
      "memory.memory_extract_result",
      "memory.memory_dream",
      "memory.memory_dream_result",
    ] as const;

    for (const eventName of MEMORY_OPERATION_EVENTS) {
      trackSub(
        apiClient.subscribe(
          eventName,
          (payload) => {
            if (payload.sessionId !== id) return;
            const customType = eventName.replace("memory.", "");
            const timestamp = payload.timestamp || Date.now();
            const eventData = (({ sessionId: _s, timestamp: _t, ...rest }) => rest)(payload);

            const memStore = useMemoryStore.getState();
            memStore.addEvent(id, {
              id: `mem-${customType}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
              customType,
              data: eventData,
              timestamp,
            });

            if (customType === "memory_prefetch_result") {
              const data = eventData as { summary?: string; snippet?: string };
              if (data) {
                memStore.addInjected(id, {
                  summary: data.summary ?? "",
                  snippet: data.snippet ?? "",
                });
              }
            }
          },
          { sessionId: id },
        ),
      );
    }
  }

  if (!supervisorSubscriptions[id]) {
    set((s) => ({
      supervisorSubscriptions: { ...s.supervisorSubscriptions, [id]: "__pending__" },
    }));

    apiClient
      .subscribe(
        "supervisor.event",
        (payload: { sessionId: string; event: SupervisorChannelEvent }) => {
          if (payload.sessionId !== id) return;
          useSupervisorStore.getState().handleEvent(id, payload.event);
        },
        { sessionId: id },
      )
      .then((subId) => {
        set((s) => ({
          supervisorSubscriptions: { ...s.supervisorSubscriptions, [id]: subId },
        }));
        const supervisorStore = useSupervisorStore.getState();
        Promise.allSettled([
          supervisorStore.fetchStatus(id),
          supervisorStore.fetchTaskReport(id),
          supervisorStore.fetchTriggerHistory(id, 50),
        ]).catch((err) => {
          useAppStore.getState().addLog(`[sub] ${String(err)}`);
        });
      })
      .catch((err) => {
        set((s) => {
          const { [id]: _, ...rest } = s.supervisorSubscriptions;
          return { supervisorSubscriptions: rest };
        });
        useAppStore.getState().addLog(`[sub] ${String(err)}`);
      });
  }

  if (!coordinatorSubscriptions[id]) {
    set((s) => ({
      coordinatorSubscriptions: { ...s.coordinatorSubscriptions, [id]: "__pending__" },
    }));

    const createdSubPromise = apiClient
      .subscribe(
        "coordinator.session_created",
        (payload: { parentSessionId: string; session: SessionMeta }) => {
          if (payload.parentSessionId !== id) return;

          const projectPath = payload.session.projectPath;

          useSessionStore.setState((s) => {
            const sessions = s.sessionsByProject[projectPath] || [];
            if (sessions.find((sess) => sess.sessionId === payload.session.sessionId)) {
              return {};
            }
            if (sessions.find((sess) => sess.sessionPath === payload.session.sessionPath)) {
              return {};
            }

            const updates: Record<string, unknown> = {
              sessionsByProject: {
                ...s.sessionsByProject,
                [projectPath]: insertAfterPinned(sessions, payload.session),
              },
            };

            const tabExists = s.projectTabs.find((t) => t.path === projectPath);
            if (!tabExists) {
              const projectName = projectPath.split("/").pop() ?? projectPath;
              const newTab: ProjectTab = {
                id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                name: projectName,
                path: projectPath,
              };
              const nextTabs = [...s.projectTabs, newTab];
              syncTabsToBackend(nextTabs, s.activeProjectId);
              updates.projectTabs = nextTabs;
            }

            return updates;
          });
        },
        { parentSessionId: id },
      );

    const eventSubPromise = apiClient.subscribe(
      "coordinator.session_event",
      (payload: { parentSessionId: string; childSessionId: string; event: unknown }) => {
        if (payload.parentSessionId !== id) return;
        const childStatus = statusFromCoordinatorChildEvent(payload.event);
        if (childStatus) {
          syncCoordinatorChildSessionStatus(payload.childSessionId, childStatus);
        }
        useDelegateActivityStore.getState().handleEvent(payload.childSessionId, payload.event);
      },
      { parentSessionId: id },
    );

    Promise.all([createdSubPromise, eventSubPromise])
      .then((subIds) => {
        set((s) => ({
          coordinatorSubscriptions: { ...s.coordinatorSubscriptions, [id]: subIds.join(",") },
        }));
      })
      .catch((err) => {
        createdSubPromise.then((subId) => apiClient.unsubscribe(subId)).catch(() => {});
        eventSubPromise.then((subId) => apiClient.unsubscribe(subId)).catch(() => {});
        set((s) => {
          const { [id]: _, ...rest } = s.coordinatorSubscriptions;
          return { coordinatorSubscriptions: rest };
        });
        useAppStore.getState().addLog(`[sub] ${String(err)}`);
      });
  }

  perfLog.info("[setupSubs] all subscribe calls dispatched (async callbacks pending)", {
    sessionId: id,
    dispatchMs: Math.round(performance.now() - t0),
  });
}

export function cleanupSession(state: SubscriptionMaps, sessionId: string): void {
  const singleSubMaps: Array<Record<string, string>> = [
    state.agentSubscriptions,
    state.subagentSubscriptions,
    state.todoSubscriptions,
    state.bashSubscriptions,
    state.lspSubscriptions,
    state.rulesSubscriptions,
    state.notifySubscriptions,
    state.coordinatorSubscriptions,
    state.supervisorSubscriptions,
  ];

  for (const map of singleSubMaps) {
    unsubscribeSubscriptionValue(map[sessionId]);
  }

  const memSubIds = state.memorySubscriptions[sessionId];
  if (Array.isArray(memSubIds)) {
    for (const subId of memSubIds) {
      if (subId) apiClient.unsubscribe(subId);
    }
  }

  const msgs = useChatStore.getState().messagesBySession[sessionId] || [];
  for (const msg of msgs) {
    if (msg.role === "assistant") {
      for (const block of msg.content) {
        if (block.type === "toolExecution") {
          delete toolCallNameMap[block.toolCallId];
          delete toolCallArgsMap[block.toolCallId];
        }
      }
    }
  }
}

/**
 * Light cleanup: reset lightweight UI state while preserving status.
 * Keeps heavy data (messages, bash logs, memory) in cache for fast tab-switch-back.
 * Status is NOT reset here — the backend `agent.session_status_changed` subscription
 * and `agent.event` subscription continue to push accurate status for background sessions.
 * This ensures the TabBar and session list always reflect the true running state
 * even when the user switches away from an active session.
 */
export function cleanupSessionLight(sessionId: string): void {
  cleanupEventHandlerMaps(sessionId);
}

/**
 * Heavy cleanup: remove all cached data from all stores (same as old cleanupSessionData).
 * Used when LRU eviction kicks in, or when a session is deleted.
 */
export function cleanupSessionHeavy(sessionId: string): void {
  useChatStore.getState().clearSessionMessages(sessionId);
  clearBackgroundRefreshGeneration(sessionId);
  clearSessionFetchInitCache(sessionId);
  clearStatusWatchdog(sessionId);
  clearRetrySession(sessionId);
  useTurnStore.getState().clearSessionUI(sessionId);
  useChatNavStore.getState().clearSessionUI(sessionId);
  useMemoryStore.getState().clearSession(sessionId);
  useRulesStore.getState().clearSession(sessionId);
  useBashStore.getState().clearSession(sessionId);
  useLspStore.getState().clearSession(sessionId);
  useSupervisorStore.getState().clearSession(sessionId);
  useHooksStore.getState().clearSession(sessionId);
  useSnapshotStore.getState().clearSession(sessionId);
  useTierStore.getState().clearSession(sessionId);
  useAgentStore.getState().clearSession(sessionId);
  useDelegateActivityStore.getState().clearSession(sessionId);
  clearAgentStarted(sessionId);

  // Clean up module-level maps in agent-event-handler
  cleanupEventHandlerMaps(sessionId);

  useStatusStore.getState().clearSessionData();
  useChangeReviewStore.getState().clearAll();
}

/** @deprecated Use cleanupSessionLight or cleanupSessionHeavy instead */
export function cleanupSessionData(sessionId: string): void {
  cleanupSessionHeavy(sessionId);
}

export function clearSubscriptionState(
  state: SubscriptionMaps & { sessionReady: Record<string, boolean> },
  sessionId: string,
): Partial<SubscriptionMaps & { sessionReady: Record<string, boolean> }> {
  const { [sessionId]: _a, ...restAgent } = state.agentSubscriptions;
  const { [sessionId]: _b, ...restSubagent } = state.subagentSubscriptions;
  const { [sessionId]: _c, ...restTodo } = state.todoSubscriptions;
  const { [sessionId]: _d, ...restBash } = state.bashSubscriptions;
  const { [sessionId]: _e, ...restLsp } = state.lspSubscriptions;
  const { [sessionId]: _f, ...restRules } = state.rulesSubscriptions;
  const { [sessionId]: _g, ...restNotify } = state.notifySubscriptions;
  const { [sessionId]: _h, ...restMemory } = state.memorySubscriptions;
  const { [sessionId]: _j, ...restCoord } = state.coordinatorSubscriptions;
  const { [sessionId]: _k, ...restSupervisor } = state.supervisorSubscriptions;
  const { [sessionId]: _i, ...restReady } = state.sessionReady;
  return {
    agentSubscriptions: restAgent,
    subagentSubscriptions: restSubagent,
    todoSubscriptions: restTodo,
    bashSubscriptions: restBash,
    lspSubscriptions: restLsp,
    rulesSubscriptions: restRules,
    notifySubscriptions: restNotify,
    memorySubscriptions: restMemory,
    coordinatorSubscriptions: restCoord,
    supervisorSubscriptions: restSupervisor,
    sessionReady: restReady,
  };
}

export function syncTabsToBackend(tabs: ProjectTab[], activeTabId: string | null) {
  const persistTabs: PersistedTab[] = tabs.map((t) => ({
    id: t.id,
    name: t.name,
    path: t.path,
    runtime: t.runtime,
    remote: t.remote,
  }));
  apiClient.call("project.syncTabs", { tabs: persistTabs, activeTabId }).catch((err) => {
    useAppStore.getState().addLog(`[sub] ${String(err)}`);
  });
}

let projectStatusSubId: string | null = null;
let sessionRenamedSubId: string | null = null;

export function setupSessionRenamedSubscription(): void {
  if (sessionRenamedSubId) return;

  apiClient
    .subscribe(
      "agent.session_renamed",
      (payload: { sessionId: string; projectPath: string; newName: string }) => {
        const s = useSessionStore.getState();
        const sessions = s.sessionsByProject[payload.projectPath];
        if (!sessions) return;
        const idx = sessions.findIndex((sess) => sess.sessionId === payload.sessionId);
        if (idx === -1) return;
        const updated = [...sessions];
        updated[idx] = { ...updated[idx], name: payload.newName };
        useSessionStore.setState({
          sessionsByProject: { ...s.sessionsByProject, [payload.projectPath]: updated },
        });
      },
      {},
    )
    .then((subId) => {
      sessionRenamedSubId = subId;
    })
    .catch((err) => {
      useAppStore.getState().addLog(`[sub] ${String(err)}`);
    });
}

export function setupProjectStatusSubscription(): void {
  if (projectStatusSubId) return;

  apiClient
    .subscribe(
      "agent.session_status_changed",
      (payload: { sessionId: string; projectPath: string; status: string }) => {
        const s = useSessionStore.getState();
        s.updateSessionStatus(payload.sessionId, payload.status as SessionStatus);

        const sessions = s.sessionsByProject[payload.projectPath];
        if (sessions) {
          const idx = sessions.findIndex((sess) => sess.sessionId === payload.sessionId);
          if (idx !== -1) {
            const updated = [...sessions];
            updated[idx] = { ...updated[idx], status: payload.status as "idle" | "running" };
            useSessionStore.setState({
              sessionsByProject: { ...s.sessionsByProject, [payload.projectPath]: updated },
            });
          }
        }
      },
      {},
    )
    .then((subId) => {
      projectStatusSubId = subId;
    })
    .catch((err) => {
      useAppStore.getState().addLog(`[sub] ${String(err)}`);
    });
}

/**
 * Request rules snapshot for a session that has already been started.
 * Should be called AFTER agent.start resolves to avoid the race condition
 * where requestSnapshot fires before the process is registered.
 */
export function requestRulesSnapshot(sessionId: string): void {
  const store = useRulesStore.getState();
  const sessionState = store.bySession[sessionId];
  if (sessionState && sessionState.totalRules > 0) return;

  apiClient
    .call("rules.requestSnapshot", { sessionId })
    .then((result) => {
      if (result.totalRules === 0) return;
      useRulesStore.getState().handleRulesEvent(sessionId, {
        type: "snapshot",
        rules: result.rules,
        totalRules: result.totalRules,
        unconditionalCount: result.unconditionalCount,
        conditionalCount: result.conditionalCount,
        injectedRuleNames: [],
        matchHistory: [],
        lifecycleLog: [],
        loadedAt: Date.now(),
        cacheTTL: 0,
      });
    })
    .catch((err) => {
      useAppStore.getState().addLog(`[rules-snapshot] ${String(err)}`);
    });
}
