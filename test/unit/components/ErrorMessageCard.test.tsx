/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ErrorMessageCard } from "../../../src/mainview/components/chat/ErrorMessageCard";
import type { ChatMessage } from "../../../src/mainview/types";

vi.mock("../../../src/mainview/components/primitives", () => ({
  useCopyFeedback: () => vi.fn(() => Promise.resolve(true)),
}));

afterEach(() => {
  cleanup();
});

describe("ErrorMessageCard", () => {
  it("shows a context compaction hint for large generic provider 400 errors", () => {
    const message: ChatMessage = {
      id: "error-400-large-context",
      role: "error",
      content: [
        {
          type: "text",
          text: "LLM 响应失败\n400 Error from provider (Console Go): Upstream request failed",
        },
      ],
      timestamp: Date.now(),
      stopReason: "error",
      providerRequest: {
        version: 1,
        provider: "opencode-go",
        modelId: "deepseek-v4-flash",
        api: "openai-completions",
        timestamp: new Date().toISOString(),
        payloadChars: 423283,
        payloadTokens: 105821,
        topLevelKeys: ["messages", "model", "tools", "thinking"],
        sections: [
          {
            id: "messages",
            label: "Messages",
            chars: 389425,
            tokens: 97357,
            count: 386,
          },
          {
            id: "tools",
            label: "Tools",
            chars: 33695,
            tokens: 8424,
            count: 47,
          },
        ],
      },
    };

    render(
      <ErrorMessageCard
        message={message}
        title="LLM 响应失败"
        detail="400 Error from provider (Console Go): Upstream request failed"
        stopReason="error"
      />,
    );

    expect(screen.queryByText(/疑似上下文过大/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { expanded: false }));

    expect(screen.getByText(/疑似上下文过大/)).toBeInTheDocument();
    expect(screen.getByText(/106K tokens/)).toBeInTheDocument();
    expect(screen.getByText(/386 条消息/)).toBeInTheDocument();
    expect(screen.getByText(/47 个工具/)).toBeInTheDocument();
    expect(screen.getByText("/compact-force")).toBeInTheDocument();
  });

  it("keeps provider error details collapsed until the card is expanded", () => {
    const message: ChatMessage = {
      id: "error-expanded",
      role: "error",
      content: [
        {
          type: "text",
          text: "LLM 响应失败\n400 Error from provider (Console Go): Upstream request failed",
        },
      ],
      timestamp: Date.now(),
      stopReason: "error",
      providerRequest: {
        version: 1,
        provider: "opencode-go",
        modelId: "deepseek-v4-flash",
        api: "openai-completions",
        timestamp: new Date().toISOString(),
        payloadChars: 2_000_000,
        payloadTokens: 552_000,
        topLevelKeys: ["messages", "model", "tools"],
        sections: [
          {
            id: "messages",
            label: "Messages",
            chars: 1_800_000,
            tokens: 500_000,
            count: 2002,
          },
          {
            id: "tools",
            label: "Tools",
            chars: 120_000,
            tokens: 30_000,
            count: 47,
          },
        ],
      },
    };

    render(
      <ErrorMessageCard
        message={message}
        title="LLM 响应失败"
        detail="400 Error from provider (Console Go): Upstream request failed"
        stopReason="error"
      />,
    );

    expect(screen.queryByText("查看详情")).not.toBeInTheDocument();
    expect(screen.queryByText("收起详情")).not.toBeInTheDocument();
    expect(
      screen.queryByText("400 Error from provider (Console Go): Upstream request failed"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { expanded: false }));

    expect(
      screen.getByText("400 Error from provider (Console Go): Upstream request failed"),
    ).toBeInTheDocument();

    const text = document.body.textContent ?? "";
    expect(text.indexOf("疑似上下文过大")).toBeLessThan(
      text.indexOf("400 Error from provider"),
    );
  });
});
