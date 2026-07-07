/**
 * @vitest-environment happy-dom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentBlock } from "../../../src/mainview/types";

const hoisted = vi.hoisted(() => ({
  subagentCard: vi.fn(() => null),
}));

vi.mock("../../../src/mainview/stores/use-settings-store", () => ({
  useSettingsStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      showToolCalls: true,
      showToolResults: true,
      showThinking: true,
    }),
  ),
}));

vi.mock("../../../src/mainview/components/chat/tool-renderers/SubagentRenderer", () => ({
  SubagentExecutionCard: hoisted.subagentCard,
}));

vi.mock("../../../src/mainview/components/chat/ToolExecutionCard", () => ({
  ToolExecutionCard: vi.fn(() => null),
}));

vi.mock("../../../src/mainview/components/chat/tool-renderers", () => ({
  getToolRenderer: vi.fn(() => undefined),
}));

import { ContentBlockRenderer } from "../../../src/mainview/components/chat/ContentBlockRenderer";

function renderBlock(block: ContentBlock) {
  return render(
    <ContentBlockRenderer block={block} msgId="msg-1" blockIndex={0} uiBlockMap={new Map()} />,
  );
}

describe("ContentBlockRenderer subagent_resume dispatch", () => {
  afterEach(() => {
    cleanup();
    hoisted.subagentCard.mockClear();
  });

  it("routes subagent_resume toolExecution blocks to the shared subagent card", () => {
    renderBlock({
      type: "toolExecution",
      toolCallId: "resume-1",
      toolName: "subagent_resume",
      args: "{}",
      status: "done",
      output: "done",
    });

    expect(hoisted.subagentCard).toHaveBeenCalledTimes(1);
    expect(hoisted.subagentCard.mock.calls[0]?.[0].block.toolName).toBe("subagent_resume");
  });

  it("routes subagent_resume toolResult blocks to the shared subagent card after reload", () => {
    renderBlock({
      type: "toolResult",
      toolCallId: "resume-1",
      toolName: "subagent_resume",
      args: "{}",
      content: "done",
    });

    expect(hoisted.subagentCard).toHaveBeenCalledTimes(1);
    expect(hoisted.subagentCard.mock.calls[0]?.[0].block).toMatchObject({
      toolName: "subagent_resume",
      status: "done",
      output: "done",
    });
  });
});
