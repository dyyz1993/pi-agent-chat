import { useRef, useState } from "react";
import { Bell, X, Info, AlertTriangle, AlertCircle, Trash2, BellRing } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNotificationStore, type AppNotification } from "../../stores/use-notification-store";
import { useSessionStore } from "../../stores/use-session-store";
import {
  requestNotificationPermission,
  getNotificationPermission,
} from "../../lib/channels/pwa-channel";
import { AnchoredPopover } from "../primitives";

const LEVEL_ICON: Record<AppNotification["level"], typeof Info> = {
  info: Info,
  warning: AlertTriangle,
  error: AlertCircle,
};

const LEVEL_COLOR: Record<AppNotification["level"], string> = {
  info: "text-status-info",
  warning: "text-status-warning",
  error: "text-status-error",
};

export function NotificationCenter() {
  const { t } = useTranslation("chat");
  const notifications = useNotificationStore((s) => s.notifications);
  const panelOpen = useNotificationStore((s) => s.panelOpen);
  const togglePanel = useNotificationStore((s) => s.togglePanel);
  const setPanelOpen = useNotificationStore((s) => s.setPanelOpen);
  const dismiss = useNotificationStore((s) => s.dismiss);
  const clearAll = useNotificationStore((s) => s.clearAll);
  const markRead = useNotificationStore((s) => s.markRead);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [pwaPerm, setPwaPerm] = useState(() => getNotificationPermission());

  const handleEnablePwa = async () => {
    const result = await requestNotificationPermission();
    setPwaPerm(result);
  };

  const handleNotificationClick = (n: AppNotification) => {
    if (n.requestId && n.sessionId) {
      useSessionStore.getState().setActiveSession(n.sessionId);
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-ui-request-id="${n.requestId}"]`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("ring-1", "ring-status-warning/50");
          setTimeout(() => {
            el.classList.remove("ring-1", "ring-status-warning/50");
          }, 2000);
        }
      });
    }
    if (!n.read) markRead(n.id);
    setPanelOpen(false);
  };

  const unread = notifications.filter((n) => !n.read).length;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        data-testid="notification-bell"
        onClick={(e) => {
          e.stopPropagation();
          togglePanel();
        }}
        className="p-1 rounded transition-colors text-text-tertiary dark:text-text-secondary hover:text-text-primary dark:hover:text-text-secondary relative"
        title={t("notification.title")}
        aria-label={
          unread > 0
            ? `${t("notification.title")}，${t("notification.unread", { count: unread })}`
            : t("notification.title")
        }
        aria-expanded={panelOpen}
      >
        <Bell className="w-3.5 h-3.5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[10px] h-[10px] flex items-center justify-center bg-status-error rounded-full text-[7px] leading-none text-white font-bold px-[2px]">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      <AnchoredPopover
        anchorRef={buttonRef}
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        placement="bottom"
        align="end"
        minWidth={288}
        maxHeight={320}
        className="bg-surface-dim border border-border-secondary rounded-lg shadow-xl overflow-hidden flex flex-col"
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-border-secondary">
            <span className="text-[11px] text-text-tertiary font-medium">
              {t("notification.title")}
            </span>
            {notifications.length > 0 && (
              <button
                onClick={clearAll}
                className="text-[10px] text-text-tertiary hover:text-text-primary dark:hover:text-text-secondary transition-colors flex items-center gap-0.5"
              >
                <Trash2 className="w-2.5 h-2.5" />
                {t("common:clear")}
              </button>
            )}
          </div>

          <div className="overflow-y-auto overflow-x-hidden flex-1">
            {notifications.length === 0 ? (
              <div className="py-6 text-center text-[11px] text-text-tertiary dark:text-text-secondary">
                {t("notification.noNotifications")}
              </div>
            ) : (
              notifications.map((n) => {
                const Icon = LEVEL_ICON[n.level];
                const isClickable = !!n.requestId && !!n.sessionId;
                return (
                  <div
                    key={n.id}
                    className={`flex items-start gap-2 px-3 py-2 border-b border-border-secondary/50 transition-colors ${!n.read ? "bg-surface-hover/20" : ""} ${isClickable ? "hover:bg-surface-hover/30 dark:hover:bg-surface-hover/30 cursor-pointer" : ""}`}
                    onMouseEnter={() => {
                      if (!n.read) markRead(n.id);
                    }}
                    onClick={() => {
                      if (isClickable) handleNotificationClick(n);
                    }}
                  >
                    <Icon className={`w-3 h-3 mt-0.5 shrink-0 ${LEVEL_COLOR[n.level]}`} />
                    <span className="flex-1 text-[11px] text-text-secondary break-all leading-relaxed">
                      {n.message}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        dismiss(n.id);
                      }}
                      className="shrink-0 text-text-tertiary dark:text-text-secondary hover:text-text-primary dark:hover:text-text-secondary transition-colors"
                      aria-label={t("notification.closeNotification")}
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {pwaPerm !== "granted" && pwaPerm !== "denied" && (
            <div className="px-3 py-2 border-t border-border-secondary">
              <button
                onClick={handleEnablePwa}
                className="w-full flex items-center justify-center gap-1.5 text-[11px] text-semantic-accent hover:text-semantic-accent transition-colors py-1"
              >
                <BellRing className="w-3 h-3" />
                {t("notification.enableSystemNotifications")}
              </button>
            </div>
          )}
      </AnchoredPopover>
    </div>
  );
}
