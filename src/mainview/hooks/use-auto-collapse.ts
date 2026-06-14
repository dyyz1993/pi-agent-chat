import { useEffect, useRef, useState } from "react";
import { useSettingsStore } from "../stores/use-settings-store";

export function useAutoCollapse(isRunning: boolean): [boolean, (v: boolean) => void] {
  const collapseToolCards = useSettingsStore((s) => s.collapseToolCards);
  const [collapsed, setCollapsed] = useState(() => !isRunning && collapseToolCards);
  const wasRunningRef = useRef(isRunning);

  useEffect(() => {
    if (wasRunningRef.current && !isRunning && collapseToolCards) {
      setCollapsed(true);
    }
    wasRunningRef.current = isRunning;
  }, [isRunning, collapseToolCards]);

  return [collapsed, setCollapsed];
}
