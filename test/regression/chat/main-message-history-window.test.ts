import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  MAIN_MESSAGE_HISTORY_WINDOW_SIZE,
  limitLoadedHistoryWindow,
} from "../../../src/mainview/stores/use-chat-store";
import type { ChatMessage } from "../../../src/mainview/types";

const root = process.cwd();

function msg(index: number): ChatMessage {
  return {
    id: `m${index}`,
    role: index % 2 === 0 ? "assistant" : "user",
    content: [{ type: "text", text: `message ${index}` }],
    timestamp: index,
  };
}

function readSource(path: string) {
  return readFileSync(join(root, path), "utf-8");
}

describe("main message history window", () => {
  it("keeps the older side of a prepended history window and trims newest tail", () => {
    const messages = Array.from({ length: MAIN_MESSAGE_HISTORY_WINDOW_SIZE + 25 }, (_, index) =>
      msg(index),
    );

    const result = limitLoadedHistoryWindow(messages);

    expect(result.trimmedTail).toBe(true);
    expect(result.messages).toHaveLength(MAIN_MESSAGE_HISTORY_WINDOW_SIZE);
    expect(result.messages[0].id).toBe("m0");
    expect(result.messages[result.messages.length - 1].id).toBe(
      `m${MAIN_MESSAGE_HISTORY_WINDOW_SIZE - 1}`,
    );
  });

  it("does not allocate a new window when the loaded messages fit", () => {
    const messages = Array.from({ length: 3 }, (_, index) => msg(index));

    const result = limitLoadedHistoryWindow(messages);

    expect(result.trimmedTail).toBe(false);
    expect(result.messages).toBe(messages);
  });

  it("bottom scroll reloads the latest tail after a trimmed history window", () => {
    const source = readSource("src/mainview/components/chat/ChatPanel.tsx");
    const handlerSection = source.slice(
      source.indexOf("const handleScrollToEdge"),
      source.indexOf("const scrollBlockIntoViewWhenRendered"),
    );

    expect(handlerSection).toContain("hasTrimmedTailMessages");
    expect(handlerSection).toContain("loadSessionMessages(activeSessionId, { force: true })");
    expect(handlerSection).toContain('scrollToEdge("bottom")');
  });
});
