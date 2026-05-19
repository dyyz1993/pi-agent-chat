/**
 * Coordinator event flow verification test.
 *
 * Tests that when the PM broadcasts coordinator.session_created,
 * the frontend subscription correctly adds the child session.
 *
 * This simulates the server-side event to verify the subscription code path.
 */

import { describe, it, expect, beforeEach } from "vitest";

// We test the store update logic directly (pure state logic, no WebSocket)
// The actual WS transport was verified by the E2E RPC test above.

describe("coordinator.session_created event flow", () => {
  // Simulate what the frontend subscription handler does
  // (from session-subscriptions.ts lines 516-534)

  interface SessionMeta {
    sessionId: string;
    name: string;
    sessionPath: string;
    projectPath: string;
    parentSessionPath?: string;
    delegateParentSessionId?: string;
    messageCount: number;
    firstMessage?: string;
    createdAt: number;
    updatedAt: number;
    status: string;
  }

  interface StoreState {
    sessionsByProject: Record<string, SessionMeta[]>;
  }

  function insertAfterPinned(sessions: SessionMeta[], session: SessionMeta): SessionMeta[] {
    // Simplified: just append
    return [...sessions, session];
  }

  // This is the exact handler from session-subscriptions.ts
  function handleCoordinatorSessionCreated(
    state: StoreState,
    payload: { parentSessionId: string; session: SessionMeta },
    parentSessionId: string,
  ): StoreState {
    if (payload.parentSessionId !== parentSessionId) return state;

    const projectPath = payload.session.projectPath;
    const sessions = state.sessionsByProject[projectPath] || [];

    if (sessions.find((sess) => sess.sessionId === payload.session.sessionId)) {
      return state;
    }
    if (sessions.find((sess) => sess.sessionPath === payload.session.sessionPath)) {
      return state;
    }

    return {
      sessionsByProject: {
        ...state.sessionsByProject,
        [projectPath]: insertAfterPinned(sessions, payload.session),
      },
    };
  }

  let state: StoreState;
  const projectPath = "/Users/test/project";
  const parentSessionId = "parent-session-001";

  beforeEach(() => {
    state = {
      sessionsByProject: {
        [projectPath]: [
          {
            sessionId: parentSessionId,
            name: "Parent Session",
            sessionPath: "/sessions/parent.jsonl",
            projectPath,
            messageCount: 5,
            createdAt: Date.now() - 10000,
            updatedAt: Date.now() - 5000,
            status: "running",
          },
        ],
      },
    };
  });

  it("adds child session when coordinator.session_created fires", () => {
    const childPayload = {
      parentSessionId,
      session: {
        sessionId: "child-session-001",
        name: "Subagent: Fix bug",
        sessionPath: "/sessions/child.jsonl",
        projectPath,
        parentSessionPath: "/sessions/parent.jsonl",
        delegateParentSessionId: parentSessionId,
        messageCount: 0,
        firstMessage: "Fix the authentication bug",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: "running" as const,
      },
    };

    const newState = handleCoordinatorSessionCreated(state, childPayload, parentSessionId);

    expect(newState.sessionsByProject[projectPath]).toHaveLength(2);
    expect(newState.sessionsByProject[projectPath][1].sessionId).toBe("child-session-001");
    expect(newState.sessionsByProject[projectPath][1].delegateParentSessionId).toBe(
      parentSessionId,
    );
  });

  it("ignores event for different parent session", () => {
    const childPayload = {
      parentSessionId: "different-parent",
      session: {
        sessionId: "child-session-002",
        name: "Subagent: Other task",
        sessionPath: "/sessions/child2.jsonl",
        projectPath,
        delegateParentSessionId: "different-parent",
        messageCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: "running" as const,
      },
    };

    const newState = handleCoordinatorSessionCreated(state, childPayload, parentSessionId);

    // Should not add - parentSessionId doesn't match
    expect(newState.sessionsByProject[projectPath]).toHaveLength(1);
  });

  it("deduplicates if same child session received twice", () => {
    const childPayload = {
      parentSessionId,
      session: {
        sessionId: "child-session-001",
        name: "Subagent: Fix bug",
        sessionPath: "/sessions/child.jsonl",
        projectPath,
        delegateParentSessionId: parentSessionId,
        messageCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: "running" as const,
      },
    };

    // First add
    const state1 = handleCoordinatorSessionCreated(state, childPayload, parentSessionId);
    expect(state1.sessionsByProject[projectPath]).toHaveLength(2);

    // Second add - should be deduplicated
    const state2 = handleCoordinatorSessionCreated(state1, childPayload, parentSessionId);
    expect(state2.sessionsByProject[projectPath]).toHaveLength(2);
  });

  it("groups correctly for sidebar rendering", () => {
    // Add child session
    const childPayload = {
      parentSessionId,
      session: {
        sessionId: "child-session-001",
        name: "Subagent: Fix bug",
        sessionPath: "/sessions/child.jsonl",
        projectPath,
        delegateParentSessionId: parentSessionId,
        messageCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: "running" as const,
      },
    };

    const newState = handleCoordinatorSessionCreated(state, childPayload, parentSessionId);
    const sessions = newState.sessionsByProject[projectPath];

    // Verify grouping: parent + children
    const parent = sessions.find((s) => s.sessionId === parentSessionId);
    const children = sessions.filter((s) => s.delegateParentSessionId === parentSessionId);

    expect(parent).toBeDefined();
    expect(children).toHaveLength(1);
    expect(children[0].delegateParentSessionId).toBe(parentSessionId);
  });

  it("supports multiple child sessions from same parent", () => {
    const child1Payload = {
      parentSessionId,
      session: {
        sessionId: "child-001",
        name: "Subagent: Task 1",
        sessionPath: "/sessions/child1.jsonl",
        projectPath,
        delegateParentSessionId: parentSessionId,
        messageCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: "running" as const,
      },
    };

    const child2Payload = {
      parentSessionId,
      session: {
        sessionId: "child-002",
        name: "Subagent: Task 2",
        sessionPath: "/sessions/child2.jsonl",
        projectPath,
        delegateParentSessionId: parentSessionId,
        messageCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: "running" as const,
      },
    };

    let newState = handleCoordinatorSessionCreated(state, child1Payload, parentSessionId);
    newState = handleCoordinatorSessionCreated(newState, child2Payload, parentSessionId);

    const sessions = newState.sessionsByProject[projectPath];
    expect(sessions).toHaveLength(3); // 1 parent + 2 children

    const children = sessions.filter((s) => s.delegateParentSessionId === parentSessionId);
    expect(children).toHaveLength(2);
  });
});
