import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoalVendorActionCard } from "../../../src/mainview/components/chat/GoalVendorActionCard";
import { useLayoutStore } from "../../../src/mainview/layouts/use-layout-store";
import { useGoalStore } from "../../../src/mainview/stores/use-goal-store";
import type { GoalVendorStatus } from "../../../src/shared/modules/goal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "goal.activeCardLabel": "Current Goal",
        "goal.cardTitle": "Goal",
        "goal.checklistProgress": `${String(params?.met ?? "")}/${String(params?.total ?? "")}`,
        "goal.edit": "Edit goal",
        "goal.openPanel": "Open Goal panel",
        "goal.pendingAuthoritySummary": `Waiting for ${String(params?.count ?? "")} authorization(s): ${String(params?.details ?? "")}`,
        "goal.state.awaiting_authority": "Waiting for authorization",
        "goal.state.blocked": "Blocked",
        "goal.state.complete": "Complete",
        "goal.state.running": "Running",
      };
      return translations[key] ?? key;
    },
  }),
}));

function makeStatus(overrides: Partial<GoalVendorStatus> = {}): GoalVendorStatus {
  return {
    enabled: true,
    state: "blocked",
    rawStatus: "interrupted",
    rawPhase: "blocked",
    continuationSequence: 2,
    turnCount: 5,
    objective: "Build a Tetris game",
    goalId: "goal-1",
    generation: 3,
    ...overrides,
  };
}

describe("GoalVendorActionCard", () => {
  beforeEach(() => {
    useGoalStore.setState({ bySession: {} });
    useLayoutStore.setState({ statusPanel: "hidden", activePanelTab: "status" });
  });

  afterEach(() => {
    cleanup();
    useGoalStore.setState({ bySession: {} });
  });

  it("renders the active goal status and task progress", () => {
    useGoalStore.setState({
      bySession: {
        "sess-1": {
          status: makeStatus(),
          taskReports: [
            { id: "ac-1", label: "Create playable board", status: "met", hasEvidence: true },
            { id: "ac-2", label: "Run browser validation", status: "pending", hasEvidence: false },
            { id: "ac-3", label: "Document residual risk", status: "pending", hasEvidence: false },
          ],
          triggerRecords: [],
        },
      },
    });

    render(<GoalVendorActionCard sessionId="sess-1" onEdit={vi.fn()} />);

    const card = screen.getByTestId("goal-vendor-action-card");
    expect(card).toHaveTextContent("Goal");
    expect(card).toHaveTextContent("Blocked");
    expect(card).toHaveTextContent("#3");
    expect(card).toHaveTextContent("1/3");
    expect(card).toHaveTextContent("Build a Tetris game");
    expect(card).toHaveTextContent("Run browser validation");
  });

  it("opens the Goal panel from the card", () => {
    useGoalStore.setState({
      bySession: {
        "sess-1": {
          status: makeStatus({ state: "running", rawStatus: "running", rawPhase: "execute" }),
          taskReports: [],
          triggerRecords: [],
        },
      },
    });

    render(<GoalVendorActionCard sessionId="sess-1" onEdit={vi.fn()} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Open Goal panel" })[0]);

    expect(useLayoutStore.getState().statusPanel).toBe("visible");
    expect(useLayoutStore.getState().activePanelTab).toBe("goal");
  });

  it("passes the current objective back to goal draft editing", () => {
    const onEdit = vi.fn();
    useGoalStore.setState({
      bySession: {
        "sess-1": {
          status: makeStatus(),
          taskReports: [],
          triggerRecords: [],
        },
      },
    });

    render(<GoalVendorActionCard sessionId="sess-1" onEdit={onEdit} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit goal" }));

    expect(onEdit).toHaveBeenCalledWith("Build a Tetris game");
  });

  it("explains pending authority amendments instead of a generic blocked label", () => {
    useGoalStore.setState({
      bySession: {
        "sess-1": {
          status: makeStatus({
            interrupt: {
              class: "RISK",
              message: "Narrow authority amendment requested",
              attempts: [],
              need: "Human approval for exact executable authorities.",
              recommendation: "Review and approve.",
              createdAt: "2026-07-30T00:00:00.000Z",
              pendingAuthorityAmendment: {
                rationale: "Tests require node",
                requestedAt: "2026-07-30T00:00:00.000Z",
                authorities: [
                  {
                    id: "AUTH_NODE_TEST",
                    label: "Run zero-dependency unit tests via node",
                    actionClass: "local_process",
                    toolName: "bash",
                    command: {
                      executable: "node",
                      argsPrefix: ["test/runner.mjs"],
                      trailingArgs: "none",
                    },
                    maxUses: 10,
                  },
                ],
              },
            },
          }),
          taskReports: [],
          triggerRecords: [],
        },
      },
    });

    render(<GoalVendorActionCard sessionId="sess-1" onEdit={vi.fn()} />);

    const card = screen.getByTestId("goal-vendor-action-card");
    expect(card).toHaveTextContent("Waiting for authorization");
    expect(card).toHaveTextContent("Run zero-dependency unit tests via node");
  });

  it("hides when there is no active goal", () => {
    useGoalStore.setState({
      bySession: {
        "sess-1": {
          status: makeStatus({ rawStatus: "none", rawPhase: "idle", goalId: undefined }),
          taskReports: [],
          triggerRecords: [],
        },
      },
    });

    render(<GoalVendorActionCard sessionId="sess-1" onEdit={vi.fn()} />);

    expect(screen.queryByTestId("goal-vendor-action-card")).toBeNull();
  });
});
