import { useCallback, type MouseEvent } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { createLogger } from "../../../shared/lib/logger";
import { apiClient } from "../../lib/api-client";
import { useNotificationStore } from "../../stores/use-notification-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useAsyncGuard } from "../../hooks/use-async-guard";
import type { SessionStatus } from "../../types";

const log = createLogger("chat");

export function shouldShowChatReloadButton({
  sessionId,
  status,
}: {
  sessionId: string | null | undefined;
  status: SessionStatus | undefined;
}): boolean {
  return Boolean(sessionId) && status === "idle";
}

export function ChatReloadButton({
  sessionId,
  status,
}: {
  sessionId: string | null | undefined;
  status: SessionStatus | undefined;
}) {
  const { t } = useTranslation("chat");
  const pushNotif = useNotificationStore((s) => s.push);
  const isVisible = shouldShowChatReloadButton({ sessionId, status });

  const [handleReload, isReloading] = useAsyncGuard(
    useCallback(
      async (event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        if (!sessionId) return;
        try {
          await apiClient.call("agent.reload", { sessionId });
          useSessionStore.getState().fetchInitialState(sessionId);
          pushNotif({ message: t("reloadSuccess"), level: "info" });
        } catch (err) {
          log.warn("agent.reload failed", {
            sessionId,
            err: err instanceof Error ? err.message : String(err),
          });
          pushNotif({ message: t("reloadFailed"), level: "error" });
        }
      },
      [pushNotif, sessionId, t],
    ),
  );

  if (!isVisible && !isReloading) return null;

  return (
    <button
      type="button"
      onClick={handleReload}
      disabled={isReloading}
      className={`p-1 rounded transition-colors ${
        isReloading
          ? "text-accent cursor-wait"
          : "text-text-tertiary hover:text-text-primary hover:bg-surface-hover"
      }`}
      title={t("reloadTitle")}
      aria-label={t("reloadTitle")}
    >
      <RefreshCw className={`w-3.5 h-3.5 ${isReloading ? "animate-spin" : ""}`} />
    </button>
  );
}
