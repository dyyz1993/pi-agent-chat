/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import {
  allScenarios,
  fullExtensionChainScenario,
  longRunningWithSubagentScenario,
} from "./helpers/event-fixtures";

describe("event fixtures barrel", () => {
  it("exports extended scenarios and keeps them in allScenarios", () => {
    expect(fullExtensionChainScenario().id).toBe("T30.1");
    expect(longRunningWithSubagentScenario().id).toBe("T30.4");

    const ids = allScenarios().map((scenario) => scenario.id);
    expect(ids).toContain("T30.1");
    expect(ids).toContain("T30.4");
  });
});
