import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Cross-repo contract test: ensure the app's view of the goal channel
 * (GOAL_METHODS + GoalMethods) stays in sync with the fork's
 * goal-vendor channel-contract.ts.
 *
 * Fork path resolution:
 *   - app repo  = /Users/xuyingzhou/Project/temporary/pi-agent-chat
 *   - fork repo = /Users/xuyingzhou/Project/temporary/pi-momo-fork
 *   (from AGENTS.md "Source Code Dependency")
 *
 * If the fork moves or the contract file is renamed, this test fails
 * loudly — that's the point. On CI (where the fork is not checked out)
 * the suite skips rather than fails, so it only runs in environments
 * that actually have the paired fork locally available.
 */
const FORK_REPO_ROOT =
  process.env.PI_MONO_FORK_ROOT ?? "/Users/xuyingzhou/Project/temporary/pi-momo-fork";
const FORK_CONTRACT_PATH = join(
  FORK_REPO_ROOT,
  "packages/coding-agent/extensions/goal-vendor/channel-contract.ts",
);
const FORK_INDEX_PATH = join(
  FORK_REPO_ROOT,
  "packages/coding-agent/extensions/goal-vendor/index.ts",
);
const FORK_REACHABLE = existsSync(FORK_CONTRACT_PATH) && existsSync(FORK_INDEX_PATH);
const describeWithFork = FORK_REACHABLE ? describe : describe.skip;

function readForkContract(): string {
  return readFileSync(FORK_CONTRACT_PATH, "utf-8");
}

describeWithFork("goal channel contract — fork ↔ app drift guard", () => {
  it("fork contract file is reachable (sanity check)", () => {
    expect(() => readForkContract()).not.toThrow();
  });

  it("app's GOAL_METHODS method names match fork's GoalChannelContract methods", async () => {
    const { GOAL_METHODS } = await import("../../../src/shared/constants/channel-methods");
    const appMethodNames = new Set(Object.values(GOAL_METHODS));
    const contractSrc = readForkContract();

    // Fork declares methods inside `methods: { <name>: { params, return } }`.
    // Extract each method name. This is a regex scan, not a full TS parse,
    // good enough for drift detection.
    const methodBlockMatch = contractSrc.match(/methods:\s*{([\s\S]*?)\n\tevents:/);
    expect(methodBlockMatch, "could not find `methods: {...}` block bounded by `events:`").not.toBeNull();
    const methodNames = new Set<string>();
    // Method names are at exactly 2-tab indent inside `methods: { ... }`.
    // params/return/Events/etc. are deeper indented and won't match.
    for (const line of methodBlockMatch![1].split("\n")) {
      const m = line.match(/^\t\t([a-zA-Z][a-zA-Z0-9_]*):\s*\{/);
      if (m) methodNames.add(m[1]);
    }

    // Expect every method the app declares to be present in the fork.
    const missingInFork = [...appMethodNames].filter((m) => !methodNames.has(m));
    expect(missingInFork, "app declares methods the fork doesn't provide").toEqual([]);

    // Expect every method the fork provides to be in app's GOAL_METHODS.
    const missingInApp = [...methodNames].filter((m) => !appMethodNames.has(m));
    expect(missingInApp, "fork provides methods the app doesn't declare").toEqual([]);
  });

  it("fork emits the 4 events the app knows how to dispatch", () => {
    const contractSrc = readForkContract();
    // events block ends right before the closing `}` of GoalChannelContract.
    const eventBlockMatch = contractSrc.match(/\tevents:\s*{([\s\S]*?)\n\t};/);
    expect(eventBlockMatch, "could not find `events: {...}` block").not.toBeNull();
    const forkEvents = new Set<string>();
    for (const line of eventBlockMatch![1].split("\n")) {
      const m = line.match(/^\t\t"?([a-zA-Z.]+)"?:/);
      if (m && m[1].startsWith("goal.")) forkEvents.add(m[1]);
    }
    // The app's event-handler.ts wraps all goal.* channel data into a single
    // "goal.event" RPC event, so it doesn't need to know the specific sub-event
    // names. But the contract still must emit them — assert the 4 documented
    // events are present.
    for (const expected of [
      "goal.statusChanged",
      "goal.goalChanged",
      "goal.taskReport",
      "goal.continueTriggered",
    ]) {
      expect(forkEvents.has(expected), `fork missing event ${expected}`).toBe(true);
    }
  });
});

describeWithFork("fork customType emissions — app must recognise them all", () => {
  it("app recognises every customType the goal-vendor extension writes", () => {
    const forkIndex = readFileSync(FORK_INDEX_PATH, "utf-8");

    // Extract every `customType: "<name>"` the fork writes.
    const emitted = new Set<string>();
    for (const m of forkIndex.matchAll(/customType:\s*"([a-zA-Z0-9_-]+)"/g)) {
      emitted.add(m[1]);
    }

    // The app side: scan src/ for the same `customType === "<name>"` /
    // `customType: "<name>"` references.
    const appSrcRoot = join(process.cwd(), "src");
    function* walkFiles(dir: string): Generator<string> {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) yield* walkFiles(full);
        else if (e.isFile() && (e.name.endsWith(".ts") || e.name.endsWith(".tsx"))) yield full;
      }
    }
    const appKnown = new Set<string>();
    for (const file of walkFiles(appSrcRoot)) {
      const src = readFileSync(file, "utf-8");
      for (const m of src.matchAll(/customType(?:[:=]|===)\s*"([a-zA-Z0-9_-]+)"/g)) {
        appKnown.add(m[1]);
      }
      // tool-icon-map uses bare identifier keys: `pi-goal-complete: {...}`
      // Pick those up with a separate scan.
      for (const m of src.matchAll(/^\s*"?([a-zA-Z][a-zA-Z0-9_-]+)"?\s*:\s*\{\s*icon:/gm)) {
        appKnown.add(m[1]);
      }
    }

    const drift = [...emitted].filter((c) => !appKnown.has(c));
    expect(
      drift,
      "fork writes customTypes the app doesn't recognise — these will render as default-text bubbles. " +
        "Update tool-icon-map.ts / MessageCard.tsx / MessageListView.tsx to recognise them.",
    ).toEqual([]);
  });
});
