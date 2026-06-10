import { describe, it, expect } from "vitest";
import { messageToChatMessage, extractContent } from "../../../src/mainview/lib/message-mapper";
import type { UserMessage, ImageContent, TextContent } from "@dyyz1993/pi-ai";

const FAKE_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("Image rendering in messages", () => {
  describe("extractContent handles image blocks", () => {
    it("converts ImageContent to imageBlock", () => {
      const msg = {
        role: "user" as const,
        content: [
          { type: "text" as const, text: "Look at this" },
          { type: "image" as const, data: FAKE_B64, mimeType: "image/png" },
        ],
        timestamp: Date.now(),
      };

      const blocks = extractContent(msg);

      expect(blocks).toHaveLength(2);
      expect(blocks[0]).toEqual({ type: "text", text: "Look at this" });
      expect(blocks[1]).toEqual({
        type: "imageBlock",
        url: `data:image/png;base64,${FAKE_B64}`,
        alt: "uploaded image",
      });
    });

    it("skips image blocks with missing data or mimeType", () => {
      const msg = {
        role: "user" as const,
        content: [
          { type: "image" as const, data: "", mimeType: "image/png" },
          { type: "image" as const, data: FAKE_B64, mimeType: "" },
          { type: "text" as const, text: "hello" },
        ],
        timestamp: Date.now(),
      };

      const blocks = extractContent(msg);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe("text");
    });

    it("handles image-only user message", () => {
      const msg = {
        role: "user" as const,
        content: [{ type: "image" as const, data: FAKE_B64, mimeType: "image/jpeg" }],
        timestamp: Date.now(),
      };

      const blocks = extractContent(msg);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe("imageBlock");
    });
  });

  describe("messageToChatMessage preserves images for user role", () => {
    it("returns ChatMessage with imageBlock for user message with image", () => {
      const raw: UserMessage = {
        role: "user",
        content: [
          { type: "text", text: "What do you see?" } as TextContent,
          { type: "image", data: FAKE_B64, mimeType: "image/png" } as ImageContent,
        ],
        timestamp: Date.now(),
      };

      const result = messageToChatMessage(raw, "msg-test-1");

      expect(result).not.toBeNull();
      expect(result!.role).toBe("user");
      expect(result!.content).toHaveLength(2);
      expect(result!.content[1].type).toBe("imageBlock");
    });

    it("returns null for empty content after filtering", () => {
      const raw: UserMessage = {
        role: "user",
        content: [],
        timestamp: Date.now(),
      };

      const result = messageToChatMessage(raw);
      expect(result).toBeNull();
    });
  });
});
