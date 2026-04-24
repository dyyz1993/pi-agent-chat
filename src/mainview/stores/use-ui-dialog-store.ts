import { create } from "zustand";
import { apiClient } from "../lib/api-client";

export interface UIPendingRequest {
  id: string;
  sessionId: string;
  method: "confirm" | "input" | "select" | "editor";
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  timeout?: number;
}

interface UIDialogState {
  pending: UIPendingRequest | null;
  respond: (response: Record<string, unknown>) => void;
  dismiss: () => void;
}

export const useUIDialogStore = create<UIDialogState>((set, get) => ({
  pending: null,

  respond: (response: Record<string, unknown>) => {
    const { pending } = get();
    if (!pending) return;
    apiClient.call("agent.respondUI", {
      sessionId: pending.sessionId,
      requestId: pending.id,
      response,
    }).catch(() => {});
    set({ pending: null });
  },

  dismiss: () => {
    const { pending } = get();
    if (!pending) return;
    apiClient.call("agent.respondUI", {
      sessionId: pending.sessionId,
      requestId: pending.id,
      response: { cancelled: true },
    }).catch(() => {});
    set({ pending: null });
  },
}));

const AUTO_RESPOND: Record<string, (req: UIPendingRequest) => Record<string, unknown>> = {
  select: (req) => ({ value: req.options?.[0] ?? "" }),
  confirm: () => ({ confirmed: true }),
  input: () => ({ value: "" }),
  editor: () => ({ value: "" }),
};

export function handleExtensionUIRequest(sessionId: string, event: Record<string, unknown>): void {
  const method = event.method as UIPendingRequest["method"];
  const id = event.id as string;
  if (!id || !method) return;

  const INTERACTIVE = new Set(["confirm", "input", "select", "editor"]);
  if (!INTERACTIVE.has(method)) return;

  const req: UIPendingRequest = {
    id,
    sessionId,
    method,
    title: event.title as string | undefined,
    message: event.message as string | undefined,
    options: event.options as string[] | undefined,
    placeholder: event.placeholder as string | undefined,
    prefill: event.prefill as string | undefined,
    timeout: event.timeout as number | undefined,
  };

  const autoResponse = AUTO_RESPOND[method];
  if (autoResponse) {
    apiClient.call("agent.respondUI", {
      sessionId,
      requestId: id,
      response: autoResponse(req),
    }).catch(() => {});
  }
}
