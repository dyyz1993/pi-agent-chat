import { useEffect, useState } from "react";
import { RefreshCw, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRetryStore } from "../../stores/use-retry-store";
import { useSessionStore } from "../../stores/use-session-store";

export function RetryNotification() {
  const { t } = useTranslation("chat");
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const retryInfo = useRetryStore((s) =>
    activeSessionId ? s.retryBySession[activeSessionId] : undefined,
  );
  const [remaining, setRemaining] = useState(0);

  const isActive = !!retryInfo;

  useEffect(() => {
    if (!isActive || !retryInfo) return;

    const update = () => {
      const elapsed = Date.now() - retryInfo.startedAt;
      const left = Math.max(0, Math.ceil((retryInfo.delayMs - elapsed) / 1000));
      setRemaining(left);
    };

    update();
    const timer = setInterval(update, 200);
    return () => clearInterval(timer);
  }, [isActive, retryInfo]);

  if (!isActive || !retryInfo || !activeSessionId) return null;

  const progress =
    retryInfo.delayMs > 0 ? Math.min(1, (Date.now() - retryInfo.startedAt) / retryInfo.delayMs) : 1;

  return (
    <div className="absolute top-12 right-3 z-40 animate-in slide-in-from-top-2 fade-in duration-300">
      <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-red-950/90 border border-red-500/40 shadow-lg shadow-red-900/20 backdrop-blur-sm max-w-xs">
        <RefreshCw
          className="w-4 h-4 text-status-error animate-spin shrink-0 mt-0.5"
          style={{ animationDuration: "2s" }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <AlertCircle className="w-3 h-3 text-status-error shrink-0" />
            <span className="text-[11px] font-semibold text-status-error">{t("autoRetrying")}</span>
          </div>
          <div className="text-[10px] text-status-error/80 space-y-0.5">
            <div>
              {t("attemptRetry", { current: retryInfo.attempt, max: retryInfo.maxAttempts })}
            </div>
            {remaining > 0 && (
              <div className="flex items-center gap-1.5">
                <span>{t("retryInSeconds", { seconds: remaining })}</span>
                <div className="flex-1 h-1 bg-red-900/60 rounded-full overflow-hidden min-w-[40px]">
                  <div
                    className="h-full bg-status-error rounded-full transition-all duration-200"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
              </div>
            )}
            {retryInfo.errorMessage && (
              <div className="text-status-error/70 truncate" title={retryInfo.errorMessage}>
                {retryInfo.errorMessage.length > 40
                  ? `${retryInfo.errorMessage.slice(0, 40)}...`
                  : retryInfo.errorMessage}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
