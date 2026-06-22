import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../../../src/mainview/lib/api-client";
import {
  readPermissionRules,
  usePermissionRulesStore,
  type PermissionRule,
} from "../../../src/mainview/stores/use-permission-rules-store";

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(),
  },
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

const mockCall = apiClient.call as ReturnType<typeof vi.fn>;

const allowRule: PermissionRule = {
  id: "rule-allow",
  provider: "pi-hooks",
  subject: "hook.approval",
  pattern: "PreToolUse|Bash|Bash|echo%20ok|*",
  action: "allow",
  scope: "project",
  createdAt: "2026-06-21T10:00:00.000Z",
  metadata: { command: "echo ok", matchKind: "glob" },
};

const denyRule: PermissionRule = {
  id: "rule-deny",
  provider: "dangerous-command",
  subject: "bash.command",
  pattern: "rm -rf *",
  action: "deny",
  scope: "project",
  createdAt: "2026-06-21T10:05:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  usePermissionRulesStore.setState({
    bySession: {},
    activeProvider: "all",
    pendingDeleteId: null,
  });
});

describe("readPermissionRules", () => {
  it("returns only valid rules and clones metadata", () => {
    const settings = {
      permissions: {
        rules: [allowRule, { ...denyRule, action: "block" }, null, { id: "missing-fields" }],
      },
    };

    const rules = readPermissionRules(settings);

    expect(rules).toEqual([allowRule]);
    expect(rules[0].metadata).not.toBe(allowRule.metadata);
  });

  it("returns an empty array for malformed settings", () => {
    expect(readPermissionRules(null)).toEqual([]);
    expect(readPermissionRules({ permissions: { rules: "nope" } })).toEqual([]);
  });
});

describe("usePermissionRulesStore", () => {
  it("fetches project permission rules from agent settings", async () => {
    mockCall.mockResolvedValueOnce({ permissions: { rules: [allowRule, denyRule] } });

    await usePermissionRulesStore.getState().fetchRules("sess-1");

    expect(mockCall).toHaveBeenCalledWith("agent.getSettings", {
      sessionId: "sess-1",
      scope: "project",
    });
    expect(usePermissionRulesStore.getState().bySession["sess-1"].rules).toEqual([
      allowRule,
      denyRule,
    ]);
  });

  it("does not refetch an already loaded session unless forced", async () => {
    mockCall.mockResolvedValue({ permissions: { rules: [allowRule] } });

    await usePermissionRulesStore.getState().fetchRules("sess-1");
    await usePermissionRulesStore.getState().fetchRules("sess-1");
    await usePermissionRulesStore.getState().fetchRules("sess-1", true);

    expect(mockCall).toHaveBeenCalledTimes(2);
  });

  it("deletes a rule through project settings and updates local state", async () => {
    usePermissionRulesStore.setState({
      bySession: {
        "sess-1": {
          rules: [allowRule, denyRule],
          loading: false,
          error: null,
          loadedAt: Date.now(),
        },
      },
      pendingDeleteId: "rule-allow",
    });
    mockCall.mockResolvedValueOnce({ ok: true });

    await usePermissionRulesStore.getState().deleteRule("sess-1", "rule-allow");

    expect(mockCall).toHaveBeenCalledWith("agent.setSettings", {
      sessionId: "sess-1",
      scope: "project",
      settings: { permissions: { rules: [denyRule] } },
    });
    expect(usePermissionRulesStore.getState().pendingDeleteId).toBeNull();
    expect(usePermissionRulesStore.getState().bySession["sess-1"].rules).toEqual([denyRule]);
  });

  it("rolls back local delete when the settings update fails", async () => {
    usePermissionRulesStore.setState({
      bySession: {
        "sess-1": {
          rules: [allowRule, denyRule],
          loading: false,
          error: null,
          loadedAt: Date.now(),
        },
      },
    });
    mockCall.mockRejectedValueOnce(new Error("write failed"));

    await usePermissionRulesStore.getState().deleteRule("sess-1", "rule-allow");

    expect(usePermissionRulesStore.getState().bySession["sess-1"].rules).toEqual([
      allowRule,
      denyRule,
    ]);
    expect(usePermissionRulesStore.getState().bySession["sess-1"].error).toBe("write failed");
  });
});
