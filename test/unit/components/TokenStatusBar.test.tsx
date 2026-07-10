/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TokenStatusBar } from "../../../src/mainview/components/chat/TokenStatusBar";
import { useSessionStore } from "../../../src/mainview/stores/use-session-store";
import { useSubagentStore } from "../../../src/mainview/stores/use-subagent-store";

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(() => Promise.resolve({ tokens: 25000, contextWindow: 128000, percent: 20 })),
    onReconnect: vi.fn(),
    subscribe: vi.fn(() => Promise.resolve("sub-id")),
    unsubscribe: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

afterEach(() => {
  cleanup();
  useSessionStore.setState({
    sessionContextMap: {},
    sessionStatsMap: {},
    sessionStatusMap: {},
  });
  useSubagentStore.setState({
    activeSubsessionId: null,
    subagentContextMap: {},
    subagentStatusMap: {},
  });
});

describe("TokenStatusBar", () => {
  it("keeps cumulative session token stats inside the details dialog", () => {
    useSessionStore.setState({
      sessionContextMap: {
        "sess-ctx": { tokens: 12000, contextWindow: 200000, percent: 6 },
      },
      sessionStatsMap: {
        "sess-ctx": {
          tokens: {
            input: 58000,
            output: 23000,
            cacheRead: 14000,
            cacheWrite: 1000,
            total: 96000,
          },
          cost: 0.0123,
          toolCalls: 7,
          totalMessages: 11,
        },
      },
      sessionStatusMap: { "sess-ctx": "idle" },
    });

    render(<TokenStatusBar sessionId="sess-ctx" />);

    expect(document.body.textContent ?? "").not.toContain("tokenStatus.sessionInput");

    fireEvent.click(screen.getByRole("button", { name: "tokenStatus.breakdown" }));

    const text = document.body.textContent ?? "";
    expect(text).toContain("tokenStatus.cumulative");
    expect(text).toContain("tokenStatus.sessionInput");
    expect(text).toContain("58K");
    expect(text).toContain("tokenStatus.sessionOutput");
    expect(text).toContain("23K");
    expect(text).toContain("tokenStatus.sessionCache");
    expect(text).toContain("15K");
    expect(text).toContain("tokenStatus.sessionCost");
    expect(text).toContain("$0.012");
    expect(text).toContain("tokenStatus.sessionTools");
    expect(text).toContain("7");
    expect(text).toContain("tokenStatus.sessionMessages");
    expect(text).toContain("11");
  });

  it("formats million-scale context windows as M instead of 1000K", () => {
    useSessionStore.setState({
      sessionContextMap: {
        "sess-ctx": { tokens: 131000, contextWindow: 1000000, percent: 13 },
      },
      sessionStatusMap: { "sess-ctx": "idle" },
    });

    render(<TokenStatusBar sessionId="sess-ctx" />);

    const text = document.body.textContent ?? "";
    expect(text).toContain("131K");
    expect(text).toContain("1M");
    expect(text).not.toContain("1000K");
  });

  it("keeps mobile token usage compact while preserving the full accessible label", () => {
    useSessionStore.setState({
      sessionContextMap: {
        "sess-ctx": { tokens: 131000, contextWindow: 1000000, percent: 13 },
      },
      sessionStatusMap: { "sess-ctx": "idle" },
    });

    render(<TokenStatusBar sessionId="sess-ctx" />);

    expect(
      screen.getByTitle("tokenStatus.used 131K / tokenStatus.available 1M (13%)"),
    ).toBeTruthy();
    expect(screen.getByText("131K / 1M")).toBeTruthy();
    expect(screen.getByText("13%")).toBeTruthy();
  });

  it("groups memory, rules, and LSP context under message history", () => {
    useSessionStore.setState({
      sessionContextMap: {
        "sess-ctx": {
          tokens: 25000,
          contextWindow: 128000,
          percent: 20,
          breakdown: [
            {
              id: "conversation",
              label: "Conversation",
              tokens: 3000,
              source: "core",
              estimated: true,
            },
            {
              id: "memory",
              label: "Memory",
              tokens: 900,
              source: "extension",
              estimated: true,
            },
            {
              id: "rules",
              label: "Rules",
              tokens: 1200,
              source: "extension",
              estimated: true,
            },
            {
              id: "lsp",
              label: "LSP diagnostics",
              tokens: 700,
              source: "extension",
              estimated: true,
            },
            {
              id: "system_base",
              label: "System prompt",
              tokens: 500,
              source: "core",
              estimated: true,
            },
          ],
        },
      },
      sessionStatusMap: { "sess-ctx": "idle" },
    });

    render(<TokenStatusBar sessionId="sess-ctx" />);

    fireEvent.click(screen.getByRole("button", { name: "tokenStatus.breakdown" }));

    const messageHistory = screen.getByText("tokenStatus.breakdownGroups.messageHistory");
    const systemContext = screen.getByText("tokenStatus.breakdownGroups.systemContext");
    const dialogText = document.body.textContent ?? "";
    const messageHistoryIndex = dialogText.indexOf(messageHistory.textContent ?? "");
    const systemContextIndex = dialogText.indexOf(systemContext.textContent ?? "");

    expect(messageHistoryIndex).toBeGreaterThanOrEqual(0);
    expect(systemContextIndex).toBeGreaterThan(messageHistoryIndex);
    for (const label of [
      "tokenStatus.breakdownItems.memory",
      "tokenStatus.breakdownItems.rules",
      "tokenStatus.breakdownItems.lsp",
    ]) {
      const itemIndex = dialogText.indexOf(label);
      expect(itemIndex).toBeGreaterThan(messageHistoryIndex);
      expect(itemIndex).toBeLessThan(systemContextIndex);
    }
  });
});
