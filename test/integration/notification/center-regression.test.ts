import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("notification center placement", () => {
  it("keeps app notifications behind the bell instead of rendering inline toasts", () => {
    const chatPanel = readFileSync(
      join(root, "src/mainview/components/chat/ChatPanel.tsx"),
      "utf8",
    );

    expect(chatPanel).toContain("NotificationCenter");
    expect(chatPanel).not.toContain("InlineErrorToast");
    expect(chatPanel).not.toContain("ToastViewport");
  });
});
