import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSource(path: string) {
  return readFileSync(join(root, path), "utf-8");
}

describe("chat initial scroll hydration regression", () => {
  it("gates initial scroll until the active session messages are hydrated", () => {
    const hookSource = readSource("src/mainview/hooks/use-active-scroll-tracker.ts");
    expect(hookSource).toContain("initialScrollReady?: boolean");
    expect(hookSource).toContain("if (!initialScrollReady) return;");

    const chatPanelSource = readSource("src/mainview/components/chat/ChatPanel.tsx");
    expect(chatPanelSource).toContain("messageHydrationBySession");
    expect(chatPanelSource).toContain("historyLoadVersionBySession");
    expect(chatPanelSource).toContain("initialScrollReady");
  });
});
