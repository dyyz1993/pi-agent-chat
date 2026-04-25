import { useSessionStore } from "../../stores/use-session-store";
import type { SessionStatus } from "../../types";

function formatTokens(tokens: number | null | undefined): string {
  if (tokens == null || tokens <= 0) return "--";
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}K`;
  return `${tokens}`;
}

function statusConfig(status: SessionStatus | undefined) {
  switch (status) {
    case "streaming":
    case "compacting":
      return {
        color: "#facc15",
        strokeClass: "text-yellow-400",
        animClass: "animate-pulse",
        label: "工作中",
      };
    case "permission":
      return {
        color: "#f87171",
        strokeClass: "text-red-400",
        animClass: "",
        label: "需要协助",
      };
    case "idle":
    default:
      return {
        color: "#4ade80",
        strokeClass: "text-green-400",
        animClass: "",
        label: "休闲中",
      };
  }
}

function ContextRing({ percent, color, isWorking }: { percent: number; color: string; isWorking: boolean }) {
  const size = 18;
  const stroke = 2.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(Math.max(percent, 0), 1);
  const offset = circumference - clamped * circumference;

  return (
    <svg width={size} height={size} className={`shrink-0 ${isWorking ? "animate-pulse" : ""}`} viewBox={`0 0 ${size} ${size}`}>
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
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 0.5s ease" }}
      />
    </svg>
  );
}

export function TokenStatusBar({ sessionId }: { sessionId: string }) {
  const contextUsage = useSessionStore((s) => s.sessionContextMap[sessionId]);
  const sessionStatus = useSessionStore((s) => s.sessionStatusMap[sessionId]);

  const config = statusConfig(sessionStatus);
  const used = formatTokens(contextUsage?.tokens);
  const available = formatTokens(contextUsage?.contextWindow);

  let percent = 0;
  if (contextUsage?.tokens && contextUsage?.contextWindow > 0) {
    percent = contextUsage.tokens / contextUsage.contextWindow;
  }

  const isWorking = sessionStatus === "streaming" || sessionStatus === "compacting";

  return (
    <div className="flex items-center gap-1.5">
      <ContextRing percent={percent} color={config.color} isWorking={isWorking} />
      <span>已用</span>
      <span className="text-gray-400 font-medium">{used}</span>
      <span className="text-gray-700">/</span>
      <span>可用 {available}</span>
    </div>
  );
}
