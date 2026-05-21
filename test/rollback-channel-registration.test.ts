import { describe, it, expect } from "vitest";
import { readFile } from "fs/promises";
import { join } from "path";

describe("process-manager channel registration", () => {
  it("includes file-snapshot in channelNames array", async () => {
    const filePath = join(__dirname, "../src/shared/agent/process-manager.ts");
    const content = await readFile(filePath, "utf-8");

    const match = content.match(/const channelNames\s*=\s*\[([\s\S]*?)\]\s*as\s*const/);
    expect(match, "channelNames array not found in process-manager.ts").not.toBeNull();

    const arrayContent = match![1];
    expect(arrayContent).toContain('"file-snapshot"');
  });

  it("file-snapshot is listed as a string literal (not commented out)", async () => {
    const filePath = join(__dirname, "../src/shared/agent/process-manager.ts");
    const content = await readFile(filePath, "utf-8");

    const match = content.match(/const channelNames\s*=\s*\[([\s\S]*?)\]\s*as\s*const/);
    expect(match).not.toBeNull();

    const arrayContent = match![1];
    const lines = arrayContent.split("\n");
    const snapshotLine = lines.find((l) => l.includes("file-snapshot"));
    expect(snapshotLine, "file-snapshot line not found").toBeDefined();
    expect(snapshotLine!.trim().startsWith("//")).toBe(false);
  });
});
