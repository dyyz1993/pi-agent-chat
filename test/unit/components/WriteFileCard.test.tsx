import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WriteFileCard } from "../../../src/mainview/components/chat/tool-renderers/WriteFileCard";
import type { ContentBlock } from "../../../src/mainview/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

type ToolExecutionBlock = Extract<ContentBlock, { type: "toolExecution" }>;

function makeRunningWrite(args: string): ToolExecutionBlock {
  return {
    type: "toolExecution",
    toolCallId: "write-streaming-card",
    toolName: "write",
    args,
    status: "running",
  };
}

describe("WriteFileCard streaming header", () => {
  it("shows the file path while the write tool is still running", () => {
    const { rerender } = render(<WriteFileCard block={makeRunningWrite("{}")} />);

    rerender(
      <WriteFileCard block={makeRunningWrite('{"path":"src/components/StreamingCard.tsx"}')} />,
    );

    expect(screen.getByTitle("src/components/StreamingCard.tsx")).toBeInTheDocument();
    expect(screen.getByText("writeFile.writing")).toBeInTheDocument();
  });
});
