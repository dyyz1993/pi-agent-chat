import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import {
  computeDelegationBadge,
  pickRevealSubagent,
  pickRevealDelegate,
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
  it("returns null when there are no subsessions and no delegates", () => {
    expect(computeDelegationBadge(undefined, undefined)).toBeNull();
    expect(computeDelegationBadge([], [])).toBeNull();
  });

  it("counts subagent subs and running (no completedAt)", () => {
    const subs = [
      makeSub({ sessionId: "a" }), // running
      makeSub({ sessionId: "b", completedAt: 2000 }), // done
    ];
    expect(computeDelegationBadge(subs, [])).toEqual({
      delegates: 0,
      delegateRunning: 0,
      subs: 2,
      subsRunning: 1,
    });
  });

  it("counts coordinator delegates and their streaming ones", () => {
    const delegates = [
      { sessionId: "sess_coord_1", delegateType: "coordinator", status: "streaming" },
      { sessionId: "sess_coord_2", delegateType: "coordinator", status: "idle" },
      { sessionId: "sess_coord_3", delegateType: "coordinator" },
    ];
    expect(computeDelegationBadge([], delegates)).toEqual({
      delegates: 3,
      delegateRunning: 1,
      subs: 0,
      subsRunning: 0,
    });
  });

  it("aggregates both kinds", () => {
    const subs = [makeSub({ sessionId: "s1" })];
    const delegates = [{ sessionId: "sess_coord_1", status: "streaming" }];
    expect(computeDelegationBadge(subs, delegates)).toEqual({
      delegates: 1,
      delegateRunning: 1,
      subs: 1,
      subsRunning: 1,
    });
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

describe("pickRevealDelegate", () => {
  it("returns null when there are no delegates", () => {
    expect(pickRevealDelegate(undefined)).toBeNull();
    expect(pickRevealDelegate([])).toBeNull();
  });

  it("prefers a streaming delegate, else the first one", () => {
    const delegates = [
      { sessionId: "d1", status: "idle" },
      { sessionId: "d2", status: "streaming" },
    ];
    expect(pickRevealDelegate(delegates)?.sessionId).toBe("d2");
    expect(pickRevealDelegate([{ sessionId: "d1" }])?.sessionId).toBe("d1");
  });
});

describe("DelegationBadge", () => {
  afterEach(() => cleanup());

  it("renders nothing when stats is null", () => {
    const { container } = render(<DelegationBadge stats={null} onClick={vi.fn()} />);
    expect(container.textContent).toBe("");
  });

  it("renders distinct delegate and subtask segments with their own counts", () => {
    const { getByTestId } = render(
      <DelegationBadge
        stats={{ delegates: 3, delegateRunning: 1, subs: 5, subsRunning: 2 }}
        onClick={vi.fn()}
      />,
    );
    const badge = getByTestId("delegation-badge");
    expect(badge.textContent).toContain("3");
    expect(badge.textContent).toContain("5");
    expect(badge.textContent).toContain("1");
    expect(badge.textContent).toContain("2");
    // Two segments → two distinct running markers.
    expect(badge.querySelectorAll("[data-testid='delegation-badge-running']").length).toBe(1);
    expect(badge.querySelectorAll("[data-testid='delegation-badge-subs-running']").length).toBe(1);
  });

  it("renders only the subtask segment when there are no delegates", () => {
    const { getByTestId } = render(
      <DelegationBadge stats={{ delegates: 0, delegateRunning: 0, subs: 2, subsRunning: 0 }} onClick={vi.fn()} />,
    );
    const badge = getByTestId("delegation-badge");
    expect(badge.textContent).toContain("2");
    expect(badge.querySelector("[data-testid='delegation-badge-running']")).toBeNull();
  });

  it("omits the running segment when nothing is running", () => {
    const { getByTestId } = render(
      <DelegationBadge stats={{ delegates: 2, delegateRunning: 0, subs: 1, subsRunning: 0 }} onClick={vi.fn()} />,
    );
    expect(getByTestId("delegation-badge").querySelector("[data-testid='delegation-badge-running']")).toBeNull();
  });

  it("invokes onClick when clicked", () => {
    const onClick = vi.fn();
    const { getByTestId } = render(
      <DelegationBadge stats={{ delegates: 1, delegateRunning: 1, subs: 0, subsRunning: 0 }} onClick={onClick} />,
    );
    fireEvent.click(getByTestId("delegation-badge"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});
