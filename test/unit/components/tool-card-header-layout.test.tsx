/**
 * @vitest-environment happy-dom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/mainview/components/chat/primitives/useToolDuration", () => ({
  useToolDuration: vi.fn(() => undefined),
}));

import { ToolCardHeader } from "../../../src/mainview/components/chat/primitives/ToolCardHeader";

describe("ToolCardHeader layout", () => {
  it("keeps the action pinned while long badges can shrink and scroll", () => {
    render(
      <ToolCardHeader
        toolName="subagent"
        status="running"
        description="A very long delegated task title that should not push the jump action away"
        badge={
          <span data-testid="wide-badge" className="shrink-0">
            very-long-agent-name very-long-worktree-name sub_1234567890 running
          </span>
        }
        action={<button data-testid="jump-action" type="button" />}
      />,
    );

    const badgeRail = screen.getByTestId("wide-badge").parentElement;
    const actionSlot = screen.getByTestId("jump-action").parentElement;

    expect(badgeRail).toHaveClass("min-w-0");
    expect(badgeRail).toHaveClass("overflow-x-auto");
    expect(badgeRail).toHaveClass("shrink");
    expect(actionSlot).toHaveClass("shrink-0");
  });
});
