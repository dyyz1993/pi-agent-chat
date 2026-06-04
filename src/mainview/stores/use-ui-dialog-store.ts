import { create } from "zustand";
import { useMemo } from "react";
import { apiClient } from "../lib/api-client";
import { useSessionStore } from "./use-session-store";
import { createLogger } from "../../shared/lib/logger";

const log = createLogger("chat");
import type { ContentBlock, UIInteractionBlock } from "../types";

export interface UIPendingRequest {
  requestId: string;
  sessionId: string;
  method: "confirm" | "input" | "select" | "editor";
  title?: string;
  message?: string;
  options?: string[];
  multiple?: boolean;
  placeholder?: string;
  prefill?: string;
  timeout?: number;
  toolCallId?: string;
  hookMeta?: {
    toolName: string;
    matcher: string;
    command?: string;
    reason: string;
  };
}

interface UIRequestState {
  request: UIPendingRequest;
  status: UIInteractionBlock["status"];
  response?: Record<string, unknown>;
}

const TOOL_METHOD_MAP: Record<string, UIPendingRequest["method"]> = {
  "ask-confirm": "confirm",
  "ask-select": "select",
  "ask-multiselect": "select",
  "ask-input": "input",
  "ask-editor": "editor",
};

export function toolNameToMethod(toolName: string): UIPendingRequest["method"] | undefined {
  return (
    TOOL_METHOD_MAP[toolName.toLowerCase()] ??
    (toolName.toLowerCase().includes("confirm")
      ? "confirm"
      : toolName.toLowerCase().includes("select")
        ? "select"
        : toolName.toLowerCase().includes("input")
          ? "input"
          : toolName.toLowerCase().includes("editor")
            ? "editor"
            : undefined)
  );
}

function toBlock(state: UIRequestState): UIInteractionBlock {
  const { request, status, response } = state;
  return {
    type: "uiInteraction",
    id: request.requestId,
    method: request.method,
    status,
    title: request.title,
    message: request.message,
    options: request.options,
    multiple: request.multiple,
    placeholder: request.placeholder,
    prefill: request.prefill,
    response,
    respondedAt: status !== "pending" ? Date.now() : undefined,
    hookMeta: request.hookMeta,
  };
}

interface UIDialogState {
  pending: UIPendingRequest[];
  requestStates: Map<string, UIRequestState>;
  panelOpen: boolean;

  registerUIRequest: (req: UIPendingRequest) => void;
  respondById: (requestId: string, response: Record<string, unknown>) => void;
  dismissById: (requestId: string) => void;
  clearPendingBySession: (sessionId: string) => void;
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
}

function checkPermissionClear(sessionId: string) {
  const { pending } = useUIDialogStore.getState();
  const remaining = pending.some((r) => r.sessionId === sessionId);
  if (!remaining) {
    const current = useSessionStore.getState().sessionStatusMap[sessionId];
    if (current === "permission") {
      useSessionStore.getState().updateSessionStatus(sessionId, "streaming");
    }
  }
}

export const useUIDialogStore = create<UIDialogState>((set, get) => ({
  pending: [],
  requestStates: new Map(),
  panelOpen: false,

  registerUIRequest: (req: UIPendingRequest) => {
    set((s) => {
      if (s.requestStates.has(req.requestId)) return s;
      const newStates = new Map(s.requestStates);
      newStates.set(req.requestId, { request: req, status: "pending" });
      return { pending: [...s.pending, req], requestStates: newStates };
    });
  },

  respondById: (requestId: string, response: Record<string, unknown>) => {
    const { requestStates } = get();
    const state = requestStates.get(requestId);
    if (!state) return;

    apiClient
      .call("agent.respondUI", {
        sessionId: state.request.sessionId,
        requestId,
        response,
      })
      .catch((err) => {
        log.warn("respondUI failed", { error: String(err) });
      });

    const newStates = new Map(requestStates);
    newStates.set(requestId, { ...state, status: "responded", response });

    set((s) => ({
      pending: s.pending.filter((r) => r.requestId !== requestId),
      requestStates: newStates,
      panelOpen: s.pending.length <= 1 ? false : s.panelOpen,
    }));
    checkPermissionClear(state.request.sessionId);
  },

  dismissById: (requestId: string) => {
    const { requestStates } = get();
    const state = requestStates.get(requestId);
    if (!state) return;

    apiClient
      .call("agent.respondUI", {
        sessionId: state.request.sessionId,
        requestId,
        response: { cancelled: true },
      })
      .catch((err) => {
        log.warn("dismissUI failed", { error: String(err) });
      });

    const newStates = new Map(requestStates);
    newStates.set(requestId, { ...state, status: "dismissed", response: { cancelled: true } });

    set((s) => ({
      pending: s.pending.filter((r) => r.requestId !== requestId),
      requestStates: newStates,
      panelOpen: s.pending.length <= 1 ? false : s.panelOpen,
    }));
    checkPermissionClear(state.request.sessionId);
  },

  clearPendingBySession: (sessionId: string) => {
    const { pending, requestStates } = get();
    const toRemove = pending.filter((r) => r.sessionId === sessionId);
    if (toRemove.length === 0) return;

    const removeIds = new Set(toRemove.map((r) => r.requestId));
    const newStates = new Map(requestStates);
    for (const id of removeIds) {
      const state = newStates.get(id);
      if (state) {
        newStates.set(id, { ...state, status: "dismissed", response: { cancelled: true } });
      }
    }

    set((s) => ({
      pending: s.pending.filter((r) => r.requestId !== sessionId && !removeIds.has(r.requestId)),
      requestStates: newStates,
      panelOpen: s.pending.every((r) => removeIds.has(r.requestId)) ? false : s.panelOpen,
    }));
    checkPermissionClear(sessionId);
  },

  setPanelOpen: (open: boolean) => set({ panelOpen: open }),

  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
}));

export function useUIBlockMap(
  content: ContentBlock[],
  sessionId: string,
): Map<string, UIInteractionBlock> {
  const storePending = useUIDialogStore((s) => s.pending);
  const storeStates = useUIDialogStore((s) => s.requestStates);

  return useMemo(() => {
    const result = new Map<string, UIInteractionBlock>();

    const pendingByMethod = new Map<UIPendingRequest["method"], UIPendingRequest[]>();
    for (const req of storePending) {
      if (req.sessionId !== sessionId) continue;
      const list = pendingByMethod.get(req.method) ?? [];
      list.push(req);
      pendingByMethod.set(req.method, list);
    }

    const assigned = new Set<string>();

    // Pass 1: toolCallId exact match (hooks ask etc.)
    for (const req of storePending) {
      if (req.sessionId !== sessionId || !req.toolCallId) continue;
      const state = storeStates.get(req.requestId);
      if (!state) continue;

      for (const block of content) {
        if (block.type !== "toolExecution") continue;
        if (block.toolCallId === req.toolCallId) {
          assigned.add(req.requestId);
          const uiBlock = toBlock(state);
          uiBlock.toolName = block.toolName;
          result.set(block.toolCallId, uiBlock);
          break;
        }
      }
    }

    // Pass 2: toolName match (ask-tools etc.)
    for (const block of content) {
      if (block.type !== "toolExecution" || block.status !== "running") continue;
      if (result.has(block.toolCallId)) continue;
      const method = toolNameToMethod(block.toolName);
      if (!method) continue;
      const queue = pendingByMethod.get(method);
      if (!queue) continue;
      const unassigned = queue.find((r) => !assigned.has(r.requestId));
      if (!unassigned) continue;
      assigned.add(unassigned.requestId);
      const state = storeStates.get(unassigned.requestId);
      if (state) {
        const uiBlock = toBlock(state);
        uiBlock.toolName = block.toolName;
        const isMultiByToolName = block.toolName.toLowerCase().includes("multi");
        if (isMultiByToolName) {
          uiBlock.multiple = true;
        }
        result.set(block.toolCallId, uiBlock);
      }
    }

    return result;
  }, [content, storePending, storeStates, sessionId]);
}
