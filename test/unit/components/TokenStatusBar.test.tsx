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
    sessionStatusMap: {},
  });
  useSubagentStore.setState({
    activeSubsessionId: null,
    subagentContextMap: {},
    subagentStatusMap: {},
  });
});

describe("TokenStatusBar", () => {
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
