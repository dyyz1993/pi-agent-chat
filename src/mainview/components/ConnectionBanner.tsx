import { useAppStore } from "../stores/use-app-store";

export function ConnectionBanner() {
  const connectionStatus = useAppStore((s) => s.connectionStatus);

  if (connectionStatus === "connected") return null;

  return (
    <div
      data-testid="connection-banner"
      className="fixed top-0 left-0 right-0 z-[100] h-8 bg-red-600/90 flex items-center justify-center gap-2 animate-in slide-in-from-top-2 duration-300"
    >
      <div className="w-2 h-2 rounded-full bg-white/80 animate-pulse" />
      <span className="text-[11px] text-white font-medium">连接已断开，正在重连...</span>
    </div>
  );
}
