import { describe, it, expect, beforeEach } from "vitest";

import { useNotificationStore } from "../../../src/mainview/stores/use-notification-store";

beforeEach(() => {
  useNotificationStore.setState({
    notifications: [],
    panelOpen: false,
  });
});

describe("useNotificationStore", () => {
  it("initial state: notifications=[], panelOpen=false", () => {
    const s = useNotificationStore.getState();
    expect(s.notifications).toEqual([]);
    expect(s.panelOpen).toBe(false);
  });

  it("push info → notifications increases", () => {
    useNotificationStore.getState().push({ message: "hello", level: "info" });
    expect(useNotificationStore.getState().notifications).toHaveLength(1);
    expect(useNotificationStore.getState().notifications[0].level).toBe("info");
  });

  it("push warning → notifications increases", () => {
    useNotificationStore.getState().push({ message: "careful", level: "warning" });
    expect(useNotificationStore.getState().notifications).toHaveLength(1);
    expect(useNotificationStore.getState().notifications[0].level).toBe("warning");
  });

  it("markRead → corresponding item read=true", () => {
    useNotificationStore.getState().push({ message: "m", level: "warning" });
    const id = useNotificationStore.getState().notifications[0].id;
    useNotificationStore.getState().markRead(id);
    expect(useNotificationStore.getState().notifications[0].read).toBe(true);
  });

  it("markAllRead → all read=true", () => {
    useNotificationStore.getState().push({ message: "a", level: "warning" });
    useNotificationStore.getState().push({ message: "b", level: "error" });
    useNotificationStore.getState().markAllRead();
    for (const n of useNotificationStore.getState().notifications) {
      expect(n.read).toBe(true);
    }
  });

  it("dismiss → removes corresponding item", () => {
    useNotificationStore.getState().push({ message: "x", level: "warning" });
    useNotificationStore.getState().push({ message: "y", level: "error" });
    const id = useNotificationStore.getState().notifications[0].id;
    useNotificationStore.getState().dismiss(id);
    expect(useNotificationStore.getState().notifications).toHaveLength(1);
    expect(useNotificationStore.getState().notifications[0].message).toBe("x");
  });

  it("clearAll → notifications=[]", () => {
    useNotificationStore.getState().push({ message: "a", level: "warning" });
    useNotificationStore.getState().push({ message: "b", level: "error" });
    useNotificationStore.getState().clearAll();
    expect(useNotificationStore.getState().notifications).toEqual([]);
  });

  it("togglePanel → panelOpen toggles", () => {
    expect(useNotificationStore.getState().panelOpen).toBe(false);
    useNotificationStore.getState().togglePanel();
    expect(useNotificationStore.getState().panelOpen).toBe(true);
    useNotificationStore.getState().togglePanel();
    expect(useNotificationStore.getState().panelOpen).toBe(false);
  });

  it("setPanelOpen(true) → panelOpen=true", () => {
    useNotificationStore.getState().setPanelOpen(true);
    expect(useNotificationStore.getState().panelOpen).toBe(true);
    useNotificationStore.getState().setPanelOpen(false);
    expect(useNotificationStore.getState().panelOpen).toBe(false);
  });
});
