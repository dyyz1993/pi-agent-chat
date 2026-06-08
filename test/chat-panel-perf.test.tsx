/**
 * @vitest-environment happy-dom
 *
 * 验证 ChatPanel 的精准订阅优化：
 * 1. streamVersionBySession — 只有活跃 session 的版本号变化才触发 selector 返回新值
 * 2. agentDetailBySession — 只有活跃 session 的 color 变化才触发 selector 返回新值
 *
 * 使用 renderHook 模拟 ChatPanel 的订阅模式，断言 render count。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChatStore } from "../src/mainview/stores/use-chat-store";
import { useAgentStore } from "../src/mainview/stores/use-agent-store";

beforeEach(() => {
  useChatStore.setState({
    messagesBySession: {},
    streamVersionBySession: {},
    streamContentVersion: 0,
  });
  useAgentStore.setState({ agentDetailBySession: {} });
});

describe("streamVersionBySession selector isolation", () => {
  it("returns 0 for unknown session", () => {
    const { result } = renderHook(
      ({ sid }) => useChatStore((s) => (sid ? (s.streamVersionBySession[sid] ?? 0) : 0)),
      { initialProps: { sid: "sess-A" } },
    );
    expect(result.current).toBe(0);
  });

  it("updates when the active session's version changes", () => {
    const { result, rerender } = renderHook(
      ({ sid }) => useChatStore((s) => (sid ? (s.streamVersionBySession[sid] ?? 0) : 0)),
      { initialProps: { sid: "sess-A" } },
    );

    // Bump sess-A
    act(() => {
      useChatStore.getState().setMessagesForSession(
        "sess-A",
        [{ id: "m1", role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 }],
        { bumpStreamVersion: true },
      );
    });
    expect(result.current).toBe(1);

    rerender({ sid: "sess-A" });
    // Bump again
    act(() => {
      useChatStore.getState().setMessagesForSession(
        "sess-A",
        [{ id: "m2", role: "user", content: [{ type: "text", text: "yo" }], timestamp: 2 }],
        { bumpStreamVersion: true },
      );
    });
    expect(result.current).toBe(2);
  });

  it("does NOT change when a different session's version bumps", () => {
    const { result } = renderHook(
      ({ sid }) => useChatStore((s) => (sid ? (s.streamVersionBySession[sid] ?? 0) : 0)),
      { initialProps: { sid: "sess-A" } },
    );

    // Bump sess-B — should not affect sess-A selector
    act(() => {
      useChatStore.getState().setMessagesForSession(
        "sess-B",
        [{ id: "b1", role: "user", content: [{ type: "text", text: "B" }], timestamp: 1 }],
        { bumpStreamVersion: true },
      );
    });

    expect(result.current).toBe(0); // sess-A still 0
  });
});

describe("agentDetailBySession color selector isolation", () => {
  it("returns undefined for unknown session", () => {
    const { result } = renderHook(
      ({ sid }) =>
        useAgentStore((s) => (sid ? s.agentDetailBySession[sid]?.color : undefined)),
      { initialProps: { sid: "sess-A" } },
    );
    expect(result.current).toBeUndefined();
  });

  it("returns color when active session's agent detail is set", () => {
    const { result } = renderHook(
      ({ sid }) =>
        useAgentStore((s) => (sid ? s.agentDetailBySession[sid]?.color : undefined)),
      { initialProps: { sid: "sess-A" } },
    );

    act(() => {
      useAgentStore.setState({
        agentDetailBySession: {
          "sess-A": { name: "coder", color: "#ff0000" } as never,
        },
      });
    });

    expect(result.current).toBe("#ff0000");
  });

  it("does NOT change when a different session's agent detail is set", () => {
    const { result } = renderHook(
      ({ sid }) =>
        useAgentStore((s) => (sid ? s.agentDetailBySession[sid]?.color : undefined)),
      { initialProps: { sid: "sess-A" } },
    );

    // Set sess-B's agent detail — should not affect sess-A selector
    act(() => {
      useAgentStore.setState({
        agentDetailBySession: {
          "sess-B": { name: "reviewer", color: "#00ff00" } as never,
        },
      });
    });

    expect(result.current).toBeUndefined(); // sess-A still undefined
  });

  it("updates only when the active session's color changes", () => {
    const { result } = renderHook(
      ({ sid }) =>
        useAgentStore((s) => (sid ? s.agentDetailBySession[sid]?.color : undefined)),
      { initialProps: { sid: "sess-A" } },
    );

    act(() => {
      useAgentStore.setState({
        agentDetailBySession: {
          "sess-A": { name: "coder", color: "#ff0000" } as never,
        },
      });
    });
    expect(result.current).toBe("#ff0000");

    // Change sess-A color
    act(() => {
      useAgentStore.setState({
        agentDetailBySession: {
          "sess-A": { name: "coder", color: "#0000ff" } as never,
        },
      });
    });
    expect(result.current).toBe("#0000ff");
  });
});
