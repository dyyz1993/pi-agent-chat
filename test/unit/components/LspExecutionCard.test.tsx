import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LspExecutionCard } from "../../../src/mainview/components/chat/tool-renderers/LspExecutionCard";
import type { ContentBlock } from "../../../src/mainview/types";

type LspBlock = Extract<ContentBlock, { type: "toolExecution" }>;

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock("../../../src/mainview/stores/use-settings-store", () => ({
  useSettingsStore: (selector: (state: { collapseToolCards: boolean }) => unknown) =>
    selector({ collapseToolCards: false }),
}));

vi.mock("../../../src/mainview/components/primitives", () => ({
  CopyAction: ({ title }: { title?: string }) => <button type="button">{title ?? "copy"}</button>,
}));

function makeBlock(overrides: Partial<LspBlock> = {}): LspBlock {
  return {
    type: "toolExecution",
    toolCallId: "lsp-call-1",
    toolName: "lsp",
    args: "{}",
    status: "done",
    startedAt: 1_000,
    endedAt: 2_000,
    ...overrides,
  };
}

describe("LspExecutionCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders parsed diagnostics with severity counts and location metadata", () => {
    const block = makeBlock({
      output: [
        "LSP action: diagnostics",
        "",
        JSON.stringify([
          {
            severity: 1,
            code: "TS1005",
            source: "ts",
            message: "Expected semicolon.",
            range: { start: { line: 12, character: 4 } },
          },
          {
            severity: 2,
            code: "W001",
            source: "eslint",
            message: "Prefer const.",
            range: { start: { line: 20, character: 2 } },
          },
        ]),
      ].join("\n"),
    });

    render(<LspExecutionCard block={block} />);

    expect(screen.getByText("diagnostics")).toBeInTheDocument();
    expect(screen.getByText("1E")).toBeInTheDocument();
    expect(screen.getByText("1W")).toBeInTheDocument();
    expect(screen.getByText("2 issues")).toBeInTheDocument();
    expect(screen.getByText("L12:4")).toBeInTheDocument();
    expect(screen.getByText("[ts]")).toBeInTheDocument();
    expect(screen.getByText("(TS1005)")).toBeInTheDocument();
    expect(screen.getByText("Expected semicolon.")).toBeInTheDocument();
    expect(screen.getByText("L20:2")).toBeInTheDocument();
    expect(screen.getByText("Prefer const.")).toBeInTheDocument();
  });

  it("shows a waiting placeholder while the LSP action is running", () => {
    render(<LspExecutionCard block={makeBlock({ status: "running", output: "" })} />);

    expect(screen.getByText("waitingOutput")).toBeInTheDocument();
    expect(screen.getByText("waiting")).toBeInTheDocument();
  });

  it("can collapse and re-expand parsed diagnostics", () => {
    const block = makeBlock({
      output: [
        "LSP action: diagnostics",
        JSON.stringify([
          {
            severity: 1,
            message: "Broken type.",
            range: { start: { line: 2, character: 8 } },
          },
        ]),
      ].join("\n"),
    });

    render(<LspExecutionCard block={block} />);

    const header = screen.getByText("diagnostics").closest('[role="button"]');
    expect(header).toBeTruthy();
    expect(screen.getByText("Broken type.")).toBeInTheDocument();

    fireEvent.click(header!);
    expect(screen.queryByText("Broken type.")).not.toBeInTheDocument();

    fireEvent.click(header!);
    expect(screen.getByText("Broken type.")).toBeInTheDocument();
  });
});
