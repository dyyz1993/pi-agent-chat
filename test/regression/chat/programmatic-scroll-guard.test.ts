import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSource(path: string) {
  return readFileSync(join(root, path), "utf-8");
}

describe("programmatic scroll guard — prevents activeId flicker", () => {
  /**
   * Bug: When clicking a SideNav icon or calling scrollToMessage,
   * the smooth scroll animation fires multiple onScroll events.
   * Without protection, updateActiveFromScroll runs on every frame,
   * setting activeId to whatever message is visible at that moment —
   * causing rapid highlight flicker across messages.
   *
   * Fix: programmaticScrollRef + markProgrammatic (double-rAF release)
   * suppresses updateActiveFromScroll during programmatic scrolls.
   *
   * Reference: KB doc "消息列表与导航图标条的双向联动" 陷阱1
   */

  it("use-active-scroll-tracker has programmaticScrollRef", () => {
    const source = readSource("src/mainview/hooks/use-active-scroll-tracker.ts");
    expect(source).toContain("programmaticScrollRef");
  });

  it("markProgrammatic uses double-rAF release", () => {
    const source = readSource("src/mainview/hooks/use-active-scroll-tracker.ts");
    // Must contain nested requestAnimationFrame (double-rAF per KB spec)
    const rafCount = (source.match(/requestAnimationFrame/g) || []).length;
    expect(rafCount).toBeGreaterThanOrEqual(4); // at least 2 in markProgrammatic + others
    expect(source).toContain("programmaticScrollRef.current = true");
    expect(source).toContain("programmaticScrollRef.current = false");
  });

  it("handleScroll skips updateActiveFromScroll when programmaticScrollRef is true", () => {
    const source = readSource("src/mainview/hooks/use-active-scroll-tracker.ts");
    // The handleScroll callback must check programmaticScrollRef before calling updateActiveFromScroll
    expect(source).toContain("!programmaticScrollRef.current");
  });

  it("scrollToMessage wraps scrollToIndex with markProgrammatic", () => {
    const source = readSource("src/mainview/hooks/use-active-scroll-tracker.ts");
    const scrollToMessageSection = source.slice(
      source.indexOf("const scrollToMessage"),
      source.indexOf("const handleScroll"),
    );
    expect(scrollToMessageSection).toContain("markProgrammatic");
    expect(scrollToMessageSection).toContain("scrollToIndex");
  });

  it("doScrollToBottom wraps scrollToIndex with markProgrammatic", () => {
    const source = readSource("src/mainview/hooks/use-active-scroll-tracker.ts");
    const doScrollSection = source.slice(
      source.indexOf("const doScrollToBottom"),
      source.indexOf("const scrollToMessage"),
    );
    expect(doScrollSection).toContain("markProgrammatic");
  });

  it("scheduleScrollToBottom wraps scrollToIndex with markProgrammatic", () => {
    const source = readSource("src/mainview/hooks/use-active-scroll-tracker.ts");
    const scheduleSection = source.slice(
      source.indexOf("const scheduleScrollToBottom"),
      source.indexOf("const doScrollToBottom"),
    );
    expect(scheduleSection).toContain("markProgrammatic");
  });

  it("scrollToEdge wraps scrollToIndex with markProgrammatic", () => {
    const source = readSource("src/mainview/hooks/use-active-scroll-tracker.ts");
    const edgeSection = source.slice(
      source.indexOf("const scrollToEdge"),
      source.indexOf("const toggleAutoScroll"),
    );
    expect(edgeSection).toContain("markProgrammatic");
  });
});

describe("ChatPanel.handleNavDotClick — sets activeId immediately", () => {
  /**
   * Bug: handleNavDotClick called vlistRef.scrollToIndex directly without
   * calling setActive, meaning activeId only updated when scroll events
   * fired updateActiveFromScroll — leaving the target message un-highlighted
   * until the scroll animation completed.
   *
   * Fix: Explicitly call setActive(targetMsgId) before scrollToIndex.
   */

  it("handleNavDotClick calls setActive before scrollToIndex", () => {
    const source = readSource("src/mainview/components/chat/ChatPanel.tsx");
    const handleClickSection = source.slice(
      source.indexOf("const handleNavDotClick"),
      source.indexOf("const handleSend"),
    );
    expect(handleClickSection).toContain("setActive(targetMsgId)");
    expect(handleClickSection).toContain("scrollToIndex");
  });
});

describe("onInitComplete — enables navId sync after initial scroll", () => {
  /**
   * Bug: onInitComplete was destructured as _onInitComplete (unused),
   * so it was NEVER called. This meant:
   *   1. ChatPanel.initDoneRef stayed false forever
   *   2. The bridge setActive → setNavId was always skipped
   *   3. SideNav selectedNavId was never set by scroll events
   *   4. Icons never highlighted and never scrolled into view
   *
   * Fix: Actually call onInitComplete after scheduleScrollToBottom settles.
   */

  it("onInitComplete is NOT renamed to _onInitComplete (must be used)", () => {
    const source = readSource("src/mainview/hooks/use-active-scroll-tracker.ts");
    expect(source).not.toContain("_onInitComplete");
    expect(source).toContain("onInitComplete");
  });

  it("scheduleScrollToBottom calls onInitComplete on settle", () => {
    const source = readSource("src/mainview/hooks/use-active-scroll-tracker.ts");
    const scheduleSection = source.slice(
      source.indexOf("const scheduleScrollToBottom"),
      source.indexOf("const doScrollToBottom"),
    );
    expect(scheduleSection).toContain("onInitComplete?.()");
  });

  it("scheduleScrollToBottom includes onInitComplete in dependency array", () => {
    const source = readSource("src/mainview/hooks/use-active-scroll-tracker.ts");
    const scheduleSection = source.slice(
      source.indexOf("const scheduleScrollToBottom"),
      source.indexOf("const doScrollToBottom"),
    );
    expect(scheduleSection).toContain("onInitComplete]");
  });
});
