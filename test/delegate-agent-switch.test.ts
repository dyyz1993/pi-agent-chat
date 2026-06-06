/**
 * TDD Red Test: session_delegate_sync should switchAgent when agent param is provided
 *
 * Bug: handleCoordinatorDelegateSync destructures `agent` from msg but only
 * uses it as prompt text (line 2687: `**Agent 角色:** ${agent}`).
 * It never calls this.switchAgent() to actually activate the agent profile.
 *
 * Expected: after this.start(), if `agent` is set, call this.switchAgent()
 * to activate the agent (tools, hooks, systemPrompt all switch).
 *
 * This test verifies the static code pattern.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const DELEGATE_OPERATIONS_PATH = join(
  __dirname,
  "../src/shared/agent/coordinator-delegate-operations.ts",
);

function read(): string {
  return readFileSync(DELEGATE_OPERATIONS_PATH, "utf-8");
}

describe("Bug2: delegate_sync agent activation (TDD Red)", () => {
  const src = read();

  it("handleCoordinatorDelegateSync should call switchAgent when agent is set", () => {
    // Find the function body
    const funcStart = src.indexOf("export async function handleCoordinatorDelegateSyncOperation");
    expect(funcStart).toBeGreaterThan(0);

    const funcBody = src.substring(
      funcStart,
      src.indexOf("export async function handleCoordinatorDelegateForkOperation", funcStart),
    );

    // Should contain switchAgent call guarded by agent check
    const hasSwitchAgent = funcBody.includes("switchAgent") && funcBody.includes("agent");

    expect(hasSwitchAgent).toBe(true);
  });

  it("switchAgent should be called AFTER this.start() and BEFORE this.send()", () => {
    const funcStart = src.indexOf("export async function handleCoordinatorDelegateSyncOperation");
    const funcBody = src.substring(
      funcStart,
      src.indexOf("export async function handleCoordinatorDelegateForkOperation", funcStart),
    );

    const startIdx = funcBody.indexOf("await options.start(newSessionId");
    const sendIdx = funcBody.indexOf("options.send(newSessionId");
    const switchIdx = funcBody.indexOf("await options.switchAgent(newSessionId, agent)");

    expect(startIdx).toBeGreaterThan(0);
    expect(sendIdx).toBeGreaterThan(0);
    expect(switchIdx).toBeGreaterThan(0);

    // switchAgent must be between start and send
    expect(switchIdx).toBeGreaterThan(startIdx);
    expect(switchIdx).toBeLessThan(sendIdx);
  });

  it("switchAgent call should be wrapped in try/catch for graceful fallback", () => {
    const funcStart = src.indexOf("export async function handleCoordinatorDelegateSyncOperation");
    const funcBody = src.substring(
      funcStart,
      src.indexOf("export async function handleCoordinatorDelegateForkOperation", funcStart),
    );

    const switchIdx = funcBody.indexOf("await options.switchAgent(newSessionId, agent)");
    if (switchIdx < 0) {
      // Not yet implemented — this test will fail (Red phase)
      expect(funcBody).toContain("switchAgent");
      return;
    }

    // Check for try/catch around switchAgent
    const aroundSwitch = funcBody.substring(
      Math.max(0, switchIdx - 200),
      Math.min(funcBody.length, switchIdx + 300),
    );

    const hasTryCatch = aroundSwitch.includes("try") && aroundSwitch.includes("catch");
    expect(hasTryCatch).toBe(true);
  });
});
