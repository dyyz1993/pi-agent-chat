import { describe, it, expect, beforeEach } from "vitest";
import { useNotificationStore } from "../src/mainview/stores/use-notification-store";

describe("useNotificationStore", () => {
  beforeEach(() => {
    useNotificationStore.getState().clearAll();
  });

  describe("permission_request dedup", () => {
    it("should deduplicate notifications with the same requestId", () => {
      const store = useNotificationStore.getState();

      store.push({
        message: "权限请求：Allow bash?",
        level: "warning",
        sessionId: "sess-1",
        requestId: "req-123",
      });

      store.push({
        message: "权限请求：Allow bash?",
        level: "warning",
        sessionId: "sess-1",
        requestId: "req-123",
      });

      const notifs = useNotificationStore.getState().notifications;
      const withReqId = notifs.filter((n) => n.requestId === "req-123");
      expect(withReqId).toHaveLength(1);
    });

    it("should allow notifications with different requestId", () => {
      const store = useNotificationStore.getState();

      store.push({
        message: "权限请求：Allow bash?",
        level: "warning",
        sessionId: "sess-1",
        requestId: "req-123",
      });

      store.push({
        message: "权限请求：Allow write?",
        level: "warning",
        sessionId: "sess-1",
        requestId: "req-456",
      });

      const notifs = useNotificationStore.getState().notifications;
      expect(notifs).toHaveLength(2);
    });

    it("should allow notifications without requestId", () => {
      const store = useNotificationStore.getState();

      store.push({ message: "Hello", level: "info" });
      store.push({ message: "World", level: "info" });

      expect(useNotificationStore.getState().notifications).toHaveLength(2);
    });
  });
});
