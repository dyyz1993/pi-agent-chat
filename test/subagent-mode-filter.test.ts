/**
 * TDD Red Test: subagent-v2 should filter out mode=primary agents
 *
 * Bug: subagent-v2 uses discoverAgents() but never filters by mode.
 * Agents with mode="primary" (like pi-expert, project-gateway) can be
 * incorrectly dispatched as subagents.
 *
 * Expected: agents with mode="primary" should not appear in the
 * subagent tool's available agent list, and attempting to use one
 * should return "Unknown agent".
 *
 * This test verifies the static code pattern — that the subagent-v2
 * extension filters agents after discovery.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const MONO_ROOT = join(__dirname, "../../pi-momo-fork/packages/coding-agent");
const SUBAGENT_INDEX = join(MONO_ROOT, "extensions/subagent-v2/index.ts");
const AGENT_TYPES = join(MONO_ROOT, "src/core/agent-types.ts");
const HAS_MONO_ROOT = existsSync(MONO_ROOT);

function read(relPath: string): string {
  return readFileSync(relPath, "utf-8");
}

(HAS_MONO_ROOT ? describe : describe.skip)("Bug1: subagent-v2 mode filtering (TDD Red)", () => {
  const src = HAS_MONO_ROOT ? read(SUBAGENT_INDEX) : "";

  it("should filter agents by mode after discoverAgents()", () => {
    // Look for a filter on agents that excludes mode === "primary"
    const hasModeFilter =
      src.includes('mode !== "primary"') ||
      src.includes("mode !== 'primary'") ||
      src.includes('.mode === "subagent"') ||
      src.includes('.mode === "all"') ||
      (src.includes("filter") && src.includes("mode") && src.includes("primary"));

    // The code should have SOME form of filtering primary agents
    expect(hasModeFilter).toBe(true);
  });

  it("should reference AgentMode type for type safety", () => {
    const typesSrc = read(AGENT_TYPES);
    expect(typesSrc).toContain('"primary" | "subagent" | "all"');
  });

  it("agents list should NOT include mode=primary agents for subagent tool", () => {
    // After the fix, the code should have a .filter() call after discoverAgents
    const discoveryLine = src.match(/const agents = discovery\.agents/);
    expect(discoveryLine).not.toBeNull();

    // Check if there's filtering between discoverAgents result and usage
    const afterDiscovery = src.substring(
      src.indexOf("const agents = discovery.agents"),
      src.indexOf("const timeoutMs"),
    );

    // Currently this block is just: "const agents = discovery.agents;"
    // After fix it should have .filter() or similar
    const hasFilter = afterDiscovery.includes("filter") && afterDiscovery.includes("mode");
    expect(hasFilter).toBe(true);
  });
});
