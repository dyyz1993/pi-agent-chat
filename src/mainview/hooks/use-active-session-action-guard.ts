import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useNotificationStore } from "../stores/use-notification-store";
import { useSessionStore } from "../stores/use-session-store";
import type { SessionStatus } from "../types";

const DEFAULT_BUSY_STATUSES = new Set<SessionStatus>(["streaming", "compacting", "retrying"]);

export interface ActiveSessionActionGuardOptions {
  requireReady?: boolean;
  blockWhileBusy?: boolean;
  readyMessage?: string;
  busyMessage?: string;
}

export interface ActiveSessionActionGuardResult {
  sessionId: string | null;
  isReady: boolean;
  status: SessionStatus | undefined;
  isBusy: boolean;
  canRun: boolean;
  guard: (options?: ActiveSessionActionGuardOptions) => string | null;
}

export function useActiveSessionActionGuard(
  defaultOptions: ActiveSessionActionGuardOptions = {},
): ActiveSessionActionGuardResult {
  const { t } = useTranslation("chat");
  const sessionId = useSessionStore((s) => s.activeSessionId);
  const isReady = useSessionStore((s) =>
    sessionId ? (s.sessionReady?.[sessionId] ?? false) : false,
  );
  const status = useSessionStore((s) =>
    sessionId ? s.sessionStatusMap?.[sessionId] : undefined,
  );
  const push = useNotificationStore((s) => s.push);
  const isBusy = status ? DEFAULT_BUSY_STATUSES.has(status) : false;
  const requireReady = defaultOptions.requireReady ?? true;
  const blockWhileBusy = defaultOptions.blockWhileBusy ?? true;

  const notifyNoActiveSession = useCallback(() => {
    push({
      message: t("sessionAction.noActiveSession", {
        defaultValue: "No active session.",
      }),
      level: "warning",
    });
  }, [push, t]);

  const notifyNotReady = useCallback(
    (message?: string) => {
      push({
        message:
          message ??
          t("sessionAction.requiresActiveSession", {
            defaultValue: "This action requires an active session. Please wait for reconnect.",
          }),
        level: "warning",
      });
    },
    [push, t],
  );

  const notifyBusy = useCallback(
    (message?: string) => {
      push({
        message:
          message ??
          t("sessionAction.busy", {
            defaultValue: "Cannot run this action while the agent is busy.",
          }),
        level: "warning",
      });
    },
    [push, t],
  );

  const guard = useCallback(
    (options: ActiveSessionActionGuardOptions = {}) => {
      const mergedRequireReady = options.requireReady ?? requireReady;
      const mergedBlockWhileBusy = options.blockWhileBusy ?? blockWhileBusy;
      if (!sessionId) {
        notifyNoActiveSession();
        return null;
      }
      if (mergedRequireReady && !isReady) {
        notifyNotReady(options.readyMessage ?? defaultOptions.readyMessage);
        return null;
      }
      if (mergedBlockWhileBusy && isBusy) {
        notifyBusy(options.busyMessage ?? defaultOptions.busyMessage);
        return null;
      }
      return sessionId;
    },
    [
      blockWhileBusy,
      defaultOptions.busyMessage,
      defaultOptions.readyMessage,
      isBusy,
      isReady,
      notifyBusy,
      notifyNoActiveSession,
      notifyNotReady,
      requireReady,
      sessionId,
    ],
  );

  return {
    sessionId,
    isReady,
    status,
    isBusy,
    canRun: !!sessionId && (!requireReady || isReady) && (!blockWhileBusy || !isBusy),
    guard,
  };
}
