import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { afterEach } from "vitest";
import {
  computeDelegationBadge,
  pickRevealSubagent,
  DelegationBadge,
} from "../../../src/mainview/components/chat/ChatPanel";
import type { SubagentSessionInfo } from "../../../src/mainview/types";

function makeSub(overrides: Partial<SubagentSessionInfo> & { sessionId: string }): SubagentSessionInfo {
  return {
    sessionPath: `/tmp/${overrides.sessionId}.jsonl`,
    description: "sub task",
    instruction: "do the thing",
    startedAt: 1000,
    ...overrides,
  } as SubagentSessionInfo;
}

describe("computeDelegationBadge", () => {
  it("returns null when there are no subsessions", () => {
    expect(computeDelegationBadge(undefined)).toBeNull();
    expect(computeDelegationBadge([])).toBeNull();
  });

  it("counts total and running (no completedAt)", () => {
    const subs = [
      makeSub({ sessionId: "a" }), // running
      makeSub({ sessionId: "b", completedAt: 2000 }), // done
      makeSub({ sessionId: "c" }), // running
    ];
    expect(computeDelegationBadge(subs)).toEqual({ total: 3, running: 2 });
  });

  it("reports zero running when all completed", () => {
    const subs = [
      makeSub({ sessionId: "a", completedAt: 2000 }),
      makeSub({ sessionId: "b", completedAt: 3000 }),
    ];
    expect(computeDelegationBadge(subs)).toEqual({ total: 2, running: 0 });
  });
});

describe("pickRevealSubagent", () => {
  it("returns null when there is nothing to reveal", () => {
    expect(pickRevealSubagent(undefined)).toBeNull();
    expect(pickRevealSubagent([])).toBeNull();
  });

  it("prefers the earliest-started running subsession", () => {
    const subs = [
      makeSub({ sessionId: "done-old", startedAt: 500, completedAt: 900 }),
      makeSub({ sessionId: "running-late", startedAt: 3000 }),
      makeSub({ sessionId: "running-early", startedAt: 2000 }),
    ];
    expect(pickRevealSubagent(subs)?.sessionId).toBe("running-early");
  });

  it("falls back to the latest-started subsession when nothing is running", () => {
    const subs = [
      makeSub({ sessionId: "a", startedAt: 1000, completedAt: 1500 }),
      makeSub({ sessionId: "b", startedAt: 4000, completedAt: 5000 }),
    ];
    expect(pickRevealSubagent(subs)?.sessionId).toBe("b");
  });
});

describe("DelegationBadge", () => {
  afterEach(() => cleanup());

  it("renders nothing when stats is null", () => {
    const { container } = render(<DelegationBadge stats={null} onClick={vi.fn()} />);
    expect(container.textContent).toBe("");
  });

  it("renders total and running counts", () => {
    const { getByTestId } = render(<DelegationBadge stats={{ total: 5, running: 2 }} onClick={vi.fn()} />);
    const badge = getByTestId("delegation-badge");
    expect(badge.textContent).toContain("5");
    expect(badge.textContent).toContain("2");
  });

  it("omits the running segment when nothing is running", () => {
    const { getByTestId } = render(<DelegationBadge stats={{ total: 3, running: 0 }} onClick={vi.fn()} />);
    const badge = getByTestId("delegation-badge");
    expect(badge.textContent).toContain("3");
    expect(badge.querySelector("[data-testid='delegation-badge-running']")).toBeNull();
  });

  it("invokes onClick when clicked", () => {
    const onClick = vi.fn();
    const { getByTestId } = render(<DelegationBadge stats={{ total: 1, running: 1 }} onClick={onClick} />);
    fireEvent.click(getByTestId("delegation-badge"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});
