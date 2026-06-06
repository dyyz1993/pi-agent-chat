import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("chat input readiness", () => {
  it("keeps the composer usable while session startup is still settling", () => {
    const source = readFileSync(
      join(root, "src/mainview/components/chat/ChatPanel.tsx"),
      "utf-8",
    );

    expect(source).not.toContain("disabled={!sessionReady}");
    expect(source).not.toContain("!sessionReady ||");
    expect(source).toContain("<AttachmentBar />");
    expect(source).toContain("<InputBar");
  });
});
