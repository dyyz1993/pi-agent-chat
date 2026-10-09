import { describe, expect, it } from "vitest";
import {
  flattenIonMessage,
  flattenIonMessages,
} from "../../../src/shared/agent/ion-backend/ion-flatten";
import { createEventMapper } from "../../../src/shared/agent/ion-backend/ion-event-map";
import type { AgentEvent } from "../../../node_modules//pi-agent-core/dist/index";

describe("flattenIonMessages", () => {
  it("flattens User enum variant (get_messages shape with id)", () => {
    const result = flattenIonMessage({
      id: "e1",
      message: { User: { role: "user", content: [{ Text: { text: "hello" } }], timestamp: 123 } },
    });
    expect(result).toMatchObject({
      role: "user",
      entryId: "e1",
      content: [{ type: "text", text: "hello" }],
      timestamp: 123,
    });
  });

  it("flattens Assistant variant (get_full_messages shape, direct variant)", () => {
    const result = flattenIonMessage({
      Assistant: {
        role: "assistant",
        content: [
          { Text: { text: "answer" } },
          { ToolCall: { id: "c1", name: "read", arguments: { path: "a.ts" } } },
        ],
        model: "glm-4.6",
        provider: "zhipuai",
        usage: { input: 10, output: 5 },
        stopReason: "toolUse",
        timestamp: 456,
      },
    });
    expect(result?.role).toBe("assistant");
    expect(result?.content).toEqual([
      { type: "text", text: "answer" },
      { type: "toolCall", id: "c1", name: "read", arguments: { path: "a.ts" } },
    ]);
    expect(result?.usage).toEqual({ input: 10, output: 5, cacheRead: 0, cacheWrite: 0 });
    expect(result?.stopReason).toBe("toolUse");
  });

  it("flattens ToolResult variant", () => {
    const result = flattenIonMessage({
      id: "e2",
      message: {
        ToolResult: {
          role: "toolResult",
          toolCallId: "c1",
          toolName: "read",
          content: [{ Text: { text: "file body" } }],
          isError: false,
          timestamp: 789,
        },
      },
    });
    expect(result).toMatchObject({
      role: "toolResult",
      toolCallId: "c1",
      toolName: "read",
      isError: false,
      entryId: "e2",
    });
  });

  it("returns null for unknown variants and skips them in batch", () => {
    expect(flattenIonMessage({ SomethingNew: { role: "x" } })).toBeNull();
    expect(
      flattenIonMessages([
        { SomethingNew: { role: "x" } },
        { id: "e3", message: { User: { role: "user", content: [{ Text: { text: "hi" } }] } } },
      ]),
    ).toHaveLength(1);
  });

  it("handles plain string content", () => {
    const result = flattenIonMessage({
      User: { role: "user", content: "plain string", timestamp: 1 },
    });
    expect(result?.content).toEqual([{ type: "text", text: "plain string" }]);
  });

  it("returns empty array for non-array input", () => {
    expect(flattenIonMessages(undefined)).toEqual([]);
    expect(flattenIonMessages("nope")).toEqual([]);
  });
});

describe("createEventMapper", () => {
  function collect(): { events: AgentEvent[]; emit: (e: AgentEvent) => void } {
    const events: AgentEvent[] = [];
    return { events, emit: (e) => events.push(e) };
  }

  it("maps agent_start/agent_end lifecycle and synthesizes turn boundaries", () => {
    const { events, emit } = collect();
    const mapper = createEventMapper(emit);
    mapper({ type: "agent_start" });
    mapper({ type: "agent_end" });
    const types = events.map((e) => e.type);
    expect(types).toEqual(["agent_start", "agent_end"]);
  });

  it("accumulates text_delta into cumulative message_update events", () => {
    const { events, emit } = collect();
    const mapper = createEventMapper(emit);
    mapper({ type: "text_delta", delta: "Hel", timestamp: 1 });
    mapper({ type: "text_delta", delta: "lo", timestamp: 2 });

    const types = events.map((e) => e.type);
    // 首个 delta 惰性开启 assistant 流式：message_start + turn_start + 2×message_update
    expect(types).toEqual(["message_start", "turn_start", "message_update", "message_update"]);

    const first = events[2] as Extract<AgentEvent, { type: "message_update" }>;
    const second = events[3] as Extract<AgentEvent, { type: "message_update" }>;
    const textOf = (e: typeof first): string =>
      (e.message as { content: Array<{ type: string; text?: string }> }).content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
    expect(textOf(first)).toBe("Hel");
    expect(textOf(second)).toBe("Hello");
    expect(first.assistantMessageEvent).toMatchObject({ type: "text_delta", delta: "Hel" });
    expect(second.assistantMessageEvent).toMatchObject({ type: "text_delta", delta: "lo" });
  });

  it("finalizes assistant stream on tool_execution_start with toolUse stopReason", () => {
    const { events, emit } = collect();
    const mapper = createEventMapper(emit);
    mapper({ type: "text_delta", delta: "let me read" });
    mapper({
      type: "tool_execution_start",
      toolCallId: "c1",
      toolName: "read",
      args: { file_path: "a" },
      timestamp: 5,
    });

    const types = events.map((e) => e.type);
    expect(types).toContain("message_end");
    const end = events.find((e) => e.type === "message_end") as Extract<
      AgentEvent,
      { type: "message_end" }
    >;
    expect((end.message as { stopReason: string | null }).stopReason).toBe("toolUse");
    expect(types).toContain("tool_execution_start");
  });

  it("finalizes on message_end (usage passthrough) and agent_end", () => {
    const { events, emit } = collect();
    const mapper = createEventMapper(emit);
    mapper({ type: "text_delta", delta: "done" });
    mapper({ type: "message_end", usage: { input: 3, output: 7 } });
    mapper({ type: "agent_end" });

    const end = events.find((e) => e.type === "message_end") as Extract<
      AgentEvent,
      { type: "message_end" }
    >;
    expect((end.message as { usage: { input: number; output: number } }).usage).toMatchObject({
      input: 3,
      output: 7,
    });
    // message_end 只发一次（agent_end 不再重复 finalize）
    expect(events.filter((e) => e.type === "message_end")).toHaveLength(1);
    expect(events[events.length - 1]?.type).toBe("agent_end");
  });

  it("passes through tool_execution_update/end with field defaults", () => {
    const { events, emit } = collect();
    const mapper = createEventMapper(emit);
    mapper({
      type: "tool_execution_update",
      toolCallId: "c1",
      toolName: "read",
      partialResult: "partial",
    });
    mapper({ type: "tool_execution_end", toolCallId: "c1", toolName: "read", result: "final" });
    const update = events.find((e) => e.type === "tool_execution_update") as Extract<
      AgentEvent,
      { type: "tool_execution_update" }
    >;
    expect(update.partialResult).toBe("partial");
    const end = events.find((e) => e.type === "tool_execution_end") as Extract<
      AgentEvent,
      { type: "tool_execution_end" }
    >;
    expect(end.result).toEqual({ content: [{ type: "text", text: "final" }] });
    expect(end.isError).toBe(false);
    expect(end.durationMs).toBe(0);
  });

  it("ignores tool_call_delta and unknown event types", () => {
    const { events, emit } = collect();
    const mapper = createEventMapper(emit);
    mapper({ type: "tool_call_delta", delta: "{}", toolName: "" });
    mapper({ type: "extension_event", extension: "x", customType: "y" });
    expect(events).toHaveLength(0);
  });
});

import {
  ION_CHANNEL_MAP,
  lookupIonChannel,
} from "../../../src/shared/agent/ion-backend/channel-map";

describe("ION_CHANNEL_MAP（声明式映射表）", () => {
  it("maps the six app change-review methods to ion file-approval RPCs", () => {
    const fr = ION_CHANNEL_MAP["file-review"];
    expect(Object.keys(fr).sort()).toEqual(
      [
        "review.approve",
        "review.approveAll",
        "review.approvals",
        "review.pending",
        "review.reject",
        "review.rejectAll",
      ].sort(),
    );
    expect(fr["review.pending"]).toMatchObject({ kind: "rpc", method: "review_pending" });
    expect(fr["review.approve"]).toMatchObject({ kind: "rpc", method: "review_approve" });
  });

  it("adapts review.pending/result and review.approvals shapes", () => {
    const pending = ION_CHANNEL_MAP["file-review"]["review.pending"];
    if (pending.kind !== "rpc") throw new Error("expected rpc mapping");
    const pendingOut = pending.adaptResult?.({ pending: [{ path: "a" }] }) as {
      result: Array<Record<string, unknown>>;
    };
    expect(pendingOut.result[0]).toMatchObject({ path: "a", status: "pending" });
    const approvals = ION_CHANNEL_MAP["file-review"]["review.approvals"];
    expect(approvals.kind === "rpc" && approvals.adaptResult?.({ approvals: [] })).toEqual({
      result: [],
    });
  });

  it("maps bash-ext list/write_stdin via extension_rpc", () => {
    const list = lookupIonChannel("bash-ext", "list");
    expect(list).toMatchObject({ kind: "extension", extension: "bash", method: "list" });
    expect(list?.kind === "extension" && list.adaptResult?.({ processes: [1] })).toEqual([1]);
    expect(lookupIonChannel("bash-ext", "write_stdin")).toMatchObject({
      kind: "extension",
      extension: "bash",
      method: "send",
    });
  });

  it("maps rules-engine getSnapshot", () => {
    expect(lookupIonChannel("rules-engine", "getSnapshot")).toMatchObject({
      kind: "extension",
      extension: "rules-engine",
      method: "list",
    });
  });

  it("returns undefined for unmapped channels/methods (explicit gap)", () => {
    expect(lookupIonChannel("goal", "getStatus")).toBeUndefined();
    expect(lookupIonChannel("file-review", "review.live")).toBeUndefined();
    expect(lookupIonChannel("nope", "x")).toBeUndefined();
  });
});

import {
  piCapabilities,
  ionCapabilities,
  PANEL_TAB_CHANNEL,
} from "../../../src/shared/agent/ion-backend/capability";

describe("capability 动态发现（壳模式）", () => {
  it("pi 后端恒全有（UI 行为不变）", () => {
    const caps = piCapabilities();
    expect(caps.backend).toBe("pi");
    expect(Object.values(caps.channels).every((c) => c.available)).toBe(true);
  });

  it("ion：已映射且扩展加载 → available", () => {
    const caps = ionCapabilities(["file-approval", "bash", "rules-engine"]);
    expect(caps.backend).toBe("ion");
    expect(caps.channels["file-review"].available).toBe(true);
    expect(caps.channels["bash-ext"].available).toBe(true);
    expect(caps.channels["rules-engine"].available).toBe(true);
  });

  it("ion：有映射但扩展没加载 → extension-not-loaded", () => {
    const caps = ionCapabilities([]);
    expect(caps.channels["file-review"].available).toBe(false);
    expect(caps.channels["file-review"].reason).toBe("extension-not-loaded");
  });

  it("ion：无映射的 channel（goal/coordinator）→ not-mapped", () => {
    const caps = ionCapabilities(["goal_supervisor"]);
    expect(caps.channels.goal.available).toBe(false);
    expect(caps.channels.goal.reason).toBe("not-mapped");
  });

  it("PANEL_TAB_CHANNEL 只覆盖插件 tab，壳 tab 不在内", () => {
    expect(PANEL_TAB_CHANNEL.goal).toBe("goal");
    expect(PANEL_TAB_CHANNEL.changeReview).toBe("file-review");
    expect(PANEL_TAB_CHANNEL.git).toBeUndefined();
    expect(PANEL_TAB_CHANNEL.status).toBeUndefined();
  });
});

import { flattenIonMessage } from "../../../src/shared/agent/ion-backend/ion-flatten";
import { createEventMapper } from "../../../src/shared/agent/ion-backend/ion-event-map";

describe("真实形状回归（2026-10-09 真模型探针：Output 为空的根因）", () => {
  it("flattens ion ToolResult variant (role:'tool' + snake_case fields)", () => {
    // 实测 JSONL 原文：role:"tool"、tool_call_id/tool_name/is_error
    const result = flattenIonMessage({
      id: "26a53bd0",
      message: {
        ToolResult: {
          role: "tool",
          content: [{ Text: { text: "hello-ion-tool\n" } }],
          is_error: false,
          tool_call_id: "call_7994",
          tool_name: "bash",
          timestamp: 1791515105593,
        },
      },
    });
    expect(result).toMatchObject({
      role: "toolResult",
      toolCallId: "call_7994",
      toolName: "bash",
      isError: false,
      entryId: "26a53bd0",
    });
    expect(result?.content).toEqual([{ type: "text", text: "hello-ion-tool\n" }]);
  });

  it("wraps string tool result into pi AgentToolResult shape (Output 渲染修复)", () => {
    const events: AgentEvent[] = [];
    const mapper = createEventMapper((e) => events.push(e));
    mapper({ type: "text_delta", delta: "using tool" });
    mapper({
      type: "tool_execution_end",
      toolCallId: "c1",
      toolName: "bash",
      result: "hello-ion-tool\n",
      isError: false,
      timestamp: 1,
      durationMs: 9,
    });
    const end = events.find((e) => e.type === "tool_execution_end") as Extract<
      AgentEvent,
      { type: "tool_execution_end" }
    >;
    expect(end.result).toEqual({ content: [{ type: "text", text: "hello-ion-tool\n" }] });
  });

  it("wraps object result without content array into text content + details", () => {
    const events: AgentEvent[] = [];
    const mapper = createEventMapper((e) => events.push(e));
    mapper({
      type: "tool_execution_end",
      toolCallId: "c2",
      toolName: "read",
      result: { path: "a.txt", lines: 3 },
    });
    const end = events.find((e) => e.type === "tool_execution_end") as Extract<
      AgentEvent,
      { type: "tool_execution_end" }
    >;
    const r = end.result as { content: Array<{ type: string; text: string }>; details: unknown };
    expect(r.content[0].type).toBe("text");
    expect(r.details).toEqual({ path: "a.txt", lines: 3 });
  });
});

describe("review.pending 条目形状适配（审核面板整树崩溃回归）", () => {
  it("maps ion {diffStat, path, status:'added'} to pi PendingChangeResult", () => {
    const pending = ION_CHANNEL_MAP["file-review"]["review.pending"];
    if (pending?.kind !== "rpc") throw new Error("expected rpc mapping");
    const out = pending.adaptResult({
      pending: [{ diffStat: "test/x.ts | 341+", path: "test/x.ts", status: "added" }],
    }) as { result: Array<Record<string, unknown>> };
    expect(out.result[0]).toMatchObject({
      path: "test/x.ts",
      fileStatus: "added",
      status: "pending",
      addedLines: 341,
      oldContent: null,
    });
  });

  it("unknown ion status coerces to modified fileStatus, never leaks raw enum", () => {
    const pending = ION_CHANNEL_MAP["file-review"]["review.pending"];
    if (pending?.kind !== "rpc") throw new Error("expected rpc mapping");
    const out = pending.adaptResult({ pending: [{ path: "a", status: "weird-status" }] }) as {
      result: Array<Record<string, unknown>>;
    };
    expect(out.result[0].fileStatus).toBe("modified");
    expect(out.result[0].status).toBe("pending");
  });

  it("approvals items get required pi fields", () => {
    const approvals = ION_CHANNEL_MAP["file-review"]["review.approvals"];
    if (approvals?.kind !== "rpc") throw new Error("expected rpc mapping");
    const out = approvals.adaptResult({ approvals: [{ path: "b" }] }) as {
      result: Array<Record<string, unknown>>;
    };
    expect(out.result[0]).toMatchObject({ path: "b", status: "approved" });
  });
});
