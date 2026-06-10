import { describe, it, expect, beforeEach, vi } from "vitest";
import type { RulesChannelEvent } from "../../../src/shared/modules/rules";

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  clearAgentStarted: () => {},
  useSessionStore: {
    getState: () => ({ activeSessionId: "test-session" }),
    subscribe: vi.fn(),
  },
}));

import { useRulesStore } from "../../../src/mainview/stores/use-rules-store";

beforeEach(() => {
  useRulesStore.setState({
    bySession: {},
    expandedRuleBySession: {},
    collapsedSections: new Set(["history", "lifecycle"]),
  });
});

describe("useRulesStore", () => {
  it("has correct initial state", () => {
    const s = useRulesStore.getState();
    expect(s.bySession).toEqual({});
    expect(s.collapsedSections.has("history")).toBe(true);
    expect(s.collapsedSections.has("lifecycle")).toBe(true);
  });

  it("handles snapshot event", () => {
    const event: RulesChannelEvent = {
      type: "snapshot",
      rules: [
        {
          name: "r1",
          title: "Rule 1",
          filePath: "/a",
          scope: "project",
          source: "s",
          severity: "high",
          isUnconditional: false,
          globs: ["*"],
        },
      ],
      injectedRuleNames: ["r1"],
      totalRules: 1,
      unconditionalCount: 0,
      conditionalCount: 1,
      matchHistory: [],
      lifecycleLog: [],
      loadedAt: 1000,
      cacheTTL: 60,
    };
    useRulesStore.getState().handleRulesEvent("s1", event);

    const session = useRulesStore.getState().bySession["s1"];
    expect(session).toBeDefined();
    expect(session!.rules).toHaveLength(1);
    expect(session!.totalRules).toBe(1);
    expect(session!.injectedRuleNames).toEqual(["r1"]);
    expect(session!.loadedAt).toBe(1000);
  });

  it("handles matched event — prepends to matchHistory", () => {
    useRulesStore.setState({
      bySession: {
        s1: {
          rules: [],
          injectedRuleNames: [],
          matchHistory: [],
          lifecycleLog: [],
          totalRules: 0,
          unconditionalCount: 0,
          conditionalCount: 0,
          loadedAt: 0,
          cacheTTL: 0,
        },
      },
    });

    const event: RulesChannelEvent = {
      type: "matched",
      filePath: "/foo.ts",
      matchedRules: [{ name: "r1", title: "R1", severity: "high", matchedGlob: "*" }],
      toolName: "edit",
      toolCallId: "tc1",
      severity: "info",
      timestamp: 2000,
    };
    useRulesStore.getState().handleRulesEvent("s1", event);

    const history = useRulesStore.getState().bySession["s1"]!.matchHistory;
    expect(history).toHaveLength(1);
    expect(history[0].filePath).toBe("/foo.ts");
    expect(history[0].ruleNames).toEqual(["r1"]);
  });

  it("preserves previous matchHistory when snapshot has empty matchHistory", () => {
    useRulesStore.setState({
      bySession: {
        s1: {
          rules: [],
          injectedRuleNames: [],
          matchHistory: [
            {
              filePath: "/old.ts",
              ruleNames: ["old"],
              toolName: "t",
              toolCallId: "c",
              severity: "info",
              timestamp: 1,
            },
          ],
          lifecycleLog: [],
          totalRules: 0,
          unconditionalCount: 0,
          conditionalCount: 0,
          loadedAt: 0,
          cacheTTL: 0,
        },
      },
    });

    const event: RulesChannelEvent = {
      type: "snapshot",
      rules: [],
      injectedRuleNames: [],
      totalRules: 0,
      unconditionalCount: 0,
      conditionalCount: 0,
      matchHistory: [],
      lifecycleLog: [],
      loadedAt: 3000,
      cacheTTL: 0,
    };
    useRulesStore.getState().handleRulesEvent("s1", event);

    const history = useRulesStore.getState().bySession["s1"]!.matchHistory;
    expect(history).toHaveLength(1);
    expect(history[0].filePath).toBe("/old.ts");
  });

  it("handles injected event", () => {
    useRulesStore.setState({
      bySession: {
        s1: {
          rules: [],
          injectedRuleNames: [],
          matchHistory: [],
          lifecycleLog: [],
          totalRules: 0,
          unconditionalCount: 0,
          conditionalCount: 0,
          loadedAt: 0,
          cacheTTL: 0,
        },
      },
    });

    const event: RulesChannelEvent = {
      type: "injected",
      ruleNames: ["a", "b"],
      systemPromptLength: 500,
    };
    useRulesStore.getState().handleRulesEvent("s1", event);

    expect(useRulesStore.getState().bySession["s1"]!.injectedRuleNames).toEqual(["a", "b"]);
  });

  it("handles reloaded event", () => {
    useRulesStore.setState({
      bySession: {
        s1: {
          rules: [],
          injectedRuleNames: [],
          matchHistory: [],
          lifecycleLog: [],
          totalRules: 0,
          unconditionalCount: 0,
          conditionalCount: 0,
          loadedAt: 0,
          cacheTTL: 0,
        },
      },
    });

    const event: RulesChannelEvent = {
      type: "reloaded",
      rules: [
        {
          name: "new",
          title: "New",
          filePath: "/b",
          scope: "user",
          source: "s",
          severity: "medium",
          isUnconditional: true,
          globs: [],
        },
      ],
      loadedAt: 4000,
    };
    useRulesStore.getState().handleRulesEvent("s1", event);

    const session = useRulesStore.getState().bySession["s1"]!;
    expect(session.rules).toHaveLength(1);
    expect(session.loadedAt).toBe(4000);
  });

  it("handles unloaded event — clears rules but keeps matchHistory", () => {
    useRulesStore.setState({
      bySession: {
        s1: {
          rules: [
            {
              name: "r1",
              title: "R",
              filePath: "/",
              scope: "project",
              source: "",
              severity: "low",
              isUnconditional: false,
              globs: [],
            },
          ],
          injectedRuleNames: ["r1"],
          matchHistory: [
            {
              filePath: "/f",
              ruleNames: ["r1"],
              toolName: "t",
              toolCallId: "c",
              severity: "info",
              timestamp: 1,
            },
          ],
          lifecycleLog: [{ event: "loaded", message: "ok", timestamp: 1 }],
          totalRules: 1,
          unconditionalCount: 0,
          conditionalCount: 1,
          loadedAt: 100,
          cacheTTL: 0,
        },
      },
    });

    const event: RulesChannelEvent = { type: "unloaded", reason: "shutdown" };
    useRulesStore.getState().handleRulesEvent("s1", event);

    const session = useRulesStore.getState().bySession["s1"]!;
    expect(session.rules).toHaveLength(0);
    expect(session.totalRules).toBe(0);
    expect(session.matchHistory).toHaveLength(1);
    expect(session.lifecycleLog).toHaveLength(1);
  });

  it("setExpandedRule updates expandedRuleBySession", () => {
    useRulesStore.getState().setExpandedRule("rule-a");
    expect(useRulesStore.getState().expandedRuleBySession["test-session"]).toBe("rule-a");

    useRulesStore.getState().setExpandedRule(null);
    expect(useRulesStore.getState().expandedRuleBySession["test-session"]).toBeNull();
  });

  it("toggleSection removes existing section", () => {
    useRulesStore.getState().toggleSection("history");
    expect(useRulesStore.getState().collapsedSections.has("history")).toBe(false);
    expect(useRulesStore.getState().collapsedSections.has("lifecycle")).toBe(true);
  });

  it("toggleSection adds new section", () => {
    useRulesStore.getState().toggleSection("custom");
    expect(useRulesStore.getState().collapsedSections.has("custom")).toBe(true);
  });

  it("clearSession removes the session data", () => {
    useRulesStore.setState({
      bySession: {
        s1: {
          rules: [],
          injectedRuleNames: [],
          matchHistory: [],
          lifecycleLog: [],
          totalRules: 0,
          unconditionalCount: 0,
          conditionalCount: 0,
          loadedAt: 0,
          cacheTTL: 0,
        },
        s2: {
          rules: [],
          injectedRuleNames: [],
          matchHistory: [],
          lifecycleLog: [],
          totalRules: 0,
          unconditionalCount: 0,
          conditionalCount: 0,
          loadedAt: 0,
          cacheTTL: 0,
        },
      },
    });

    useRulesStore.getState().clearSession("s1");
    expect(useRulesStore.getState().bySession["s1"]).toBeUndefined();
    expect(useRulesStore.getState().bySession["s2"]).toBeDefined();
  });

  it("keeps multiple sessions independent", () => {
    const snapshot1: RulesChannelEvent = {
      type: "snapshot",
      rules: [],
      injectedRuleNames: ["a"],
      totalRules: 0,
      unconditionalCount: 0,
      conditionalCount: 0,
      matchHistory: [],
      lifecycleLog: [],
      loadedAt: 100,
      cacheTTL: 0,
    };
    const snapshot2: RulesChannelEvent = {
      type: "snapshot",
      rules: [],
      injectedRuleNames: ["b"],
      totalRules: 0,
      unconditionalCount: 0,
      conditionalCount: 0,
      matchHistory: [],
      lifecycleLog: [],
      loadedAt: 200,
      cacheTTL: 0,
    };

    useRulesStore.getState().handleRulesEvent("s1", snapshot1);
    useRulesStore.getState().handleRulesEvent("s2", snapshot2);

    expect(useRulesStore.getState().bySession["s1"]!.injectedRuleNames).toEqual(["a"]);
    expect(useRulesStore.getState().bySession["s2"]!.injectedRuleNames).toEqual(["b"]);
  });
});
