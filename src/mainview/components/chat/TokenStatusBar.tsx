import { memo } from "react";
import { useSessionStore } from "../../stores/use-session-store";
import { useSubagentStore } from "../../stores/use-subagent-store";
import type { SessionStatus, ContextUsage } from "../../types";

function formatTokens(tokens: number | null | undefined): string {
  if (tokens == null || tokens <= 0) return "--";
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}K`;
  return `${tokens}`;
}

const STATUS_CONFIGS = {
  streaming: { strokeClass: "text-yellow-400", animClass: "animate-pulse", label: "工作中" },
  compacting: { strokeClass: "text-yellow-400", animClass: "animate-pulse", label: "工作中" },
  permission: { strokeClass: "text-red-400", animClass: "", label: "需要协助" },
  retrying: { strokeClass: "text-red-400", animClass: "animate-pulse", label: "重试中" },
  idle: { strokeClass: "text-green-400", animClass: "", label: "空闲" },
} as const;

function statusConfig(status: SessionStatus | undefined) {
  switch (status) {
    case "streaming":
    case "compacting":
      return STATUS_CONFIGS.streaming;
    case "permission":
      return STATUS_CONFIGS.permission;
    case "retrying":
      return STATUS_CONFIGS.retrying;
    case "idle":
    default:
      return STATUS_CONFIGS.idle;
  }
}

const ContextRing = memo(function ContextRing({ percent, strokeClass, isWorking }: { percent: number; strokeClass: string; isWorking: boolean }) {
  const size = 18;
  const stroke = 2.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(Math.max(percent, 0), 1);
  const offset = circumference - clamped * circumference;

  return (
    <svg width={size} height={size} className={`shrink-0 ${isWorking ? "animate-pulse" : ""} ${strokeClass}`} viewBox={`0 0 ${size} ${size}`} role="progressbar" aria-valuenow={Math.round(clamped * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`上下文使用 ${Math.round(clamped * 100)}%`}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        className="text-gray-700"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 0.5s ease" }}
      />
    </svg>
  );
});

export const TokenStatusBar = memo(function TokenStatusBar({ sessionId }: { sessionId: string }) {
  const activeSubId = useSubagentStore((s) => s.activeSubsessionId);

  const parentContext = useSessionStore((s) => s.sessionContextMap[sessionId]);
  const parentStatus = useSessionStore((s) => s.sessionStatusMap[sessionId]);

  const subContext = useSubagentStore((s) => activeSubId ? s.subagentContextMap[activeSubId] : undefined);
  const subStatus = useSubagentStore((s) => activeSubId ? s.subagentStatusMap[activeSubId] : undefined);

  const contextUsage: ContextUsage | undefined = activeSubId ? subContext : parentContext;
  const sessionStatus: SessionStatus | undefined = activeSubId ? subStatus : parentStatus;

  const config = statusConfig(sessionStatus);
  const used = formatTokens(contextUsage?.tokens);
  const available = formatTokens(contextUsage?.contextWindow);

  let percent = 0;
  if (contextUsage?.tokens && contextUsage?.contextWindow > 0) {
    percent = contextUsage.tokens / contextUsage.contextWindow;
  }

  const isWorking = sessionStatus === "streaming" || sessionStatus === "compacting" || sessionStatus === "retrying";

  return (
    <div className="flex items-center gap-1.5">
      <ContextRing percent={percent} strokeClass={config.strokeClass} isWorking={isWorking} />
      <span>{activeSubId ? "子代理" : "已用"}</span>
      <span className="text-gray-400 font-medium">{used}</span>
      {contextUsage?.contextWindow ? (
        <>
          <span className="text-gray-700">/</span>
          <span>可用 {available}</span>
        </>
      ) : null}
    </div>
  );
});
