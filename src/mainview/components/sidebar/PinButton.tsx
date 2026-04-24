import { Pin, PinOff } from "lucide-react";
import { useSidebarStore } from "../../stores/use-sidebar-store";

export function PinButton() {
  const isPinned = useSidebarStore((s) => s.isPinned);
  const setPinned = useSidebarStore((s) => s.setPinned);
  const isMobile = useSidebarStore((s) => s.breakpoint) === "mobile";

  if (isMobile) return null;

  return (
    <button
      onClick={() => setPinned(!isPinned)}
      title={isPinned ? "Unpin sidebar" : "Pin sidebar"}
      className="text-gray-500 hover:text-white transition-colors"
    >
      {isPinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
    </button>
  );
}
