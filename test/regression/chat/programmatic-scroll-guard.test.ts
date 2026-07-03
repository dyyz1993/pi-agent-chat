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

describe("ChatPanel.handleNavDotClick — uses guarded message scroll", () => {
  /**
   * Bug: handleNavDotClick called vlistRef.scrollToIndex directly, bypassing
   * useActiveScrollTracker.scrollToMessage and its programmatic-scroll guard.
   * That let intermediate scroll frames fight with activeId.
   *
   * Fix: route SideNav clicks through scrollToMessage.
   */

  it("handleNavDotClick calls scrollToMessage with explicit SideNav target", () => {
    const source = readSource("src/mainview/components/chat/ChatPanel.tsx");
    const handleClickSection = source.slice(
      source.indexOf("const handleNavDotClick"),
      source.indexOf("const handleSend"),
    );
    expect(handleClickSection).toContain("(target: SideNavTarget)");
    expect(handleClickSection).toContain("scrollToMessage(target.messageId");
    expect(handleClickSection).toContain("smooth: !target.blockId");
    expect(handleClickSection).toContain("scrollBlockIntoViewWhenRendered(blockId)");
    expect(handleClickSection).not.toContain("vlistRef.current?.scrollToIndex(index");
    expect(handleClickSection).not.toContain("lastIndexOf");
  });

  it("block navigation waits long enough for virtualized content to mount", () => {
    const source = readSource("src/mainview/components/chat/ChatPanel.tsx");
    expect(source).toContain("BLOCK_NAV_MAX_RENDER_ATTEMPTS = 60");
    expect(source).toContain("attempt >= BLOCK_NAV_MAX_RENDER_ATTEMPTS");
  });
});

describe("scroll tracking — does not mutate SideNav selection", () => {
  /**
   * Interaction rule from docs/design-sidenav-interaction.md:
   * SideNav selection is click-owned only. Message-list scrolling may update
   * activeId for the read-only left bar and keep that icon visible, but must
   * never write selectedNavId.
   *
   * Historical bug: onInitComplete was destructured as _onInitComplete and
   * never called, leaving the initial activeId state incomplete.
   */

  it("onInitComplete is NOT renamed to _onInitComplete (must be used)", () => {
    const source = readSource("src/mainview/hooks/use-active-scroll-tracker.ts");
    expect(source).not.toContain("_onInitComplete");
    expect(source).toContain("onInitComplete");
  });

  it("scheduleScrollToBottom calls onInitComplete on settle", () => {
    const source = readSource("src/mainview/hooks/use-active-scroll-tracker.ts");
    const completeSection = source.slice(
      source.indexOf("const completeInitialScroll"),
      source.indexOf("const findVisibleIndex"),
    );
    const scheduleSection = source.slice(
      source.indexOf("const scheduleScrollToBottom"),
      source.indexOf("const doScrollToBottom"),
    );
    expect(completeSection).toContain("onInitComplete?.()");
    expect(scheduleSection).toContain("completeInitialScroll()");
  });

  it("scheduleScrollToBottom includes onInitComplete in dependency array", () => {
    const source = readSource("src/mainview/hooks/use-active-scroll-tracker.ts");
    const completeSection = source.slice(
      source.indexOf("const completeInitialScroll"),
      source.indexOf("const findVisibleIndex"),
    );
    const scheduleSection = source.slice(
      source.indexOf("const scheduleScrollToBottom"),
      source.indexOf("const doScrollToBottom"),
    );
    expect(completeSection).toContain("onInitComplete");
    expect(scheduleSection).toContain("completeInitialScroll");
  });

  it("ChatPanel does not bridge scroll activeId into selectedNavId", () => {
    const source = readSource("src/mainview/components/chat/ChatPanel.tsx");
    const trackerSection = source.slice(
      source.indexOf("useActiveScrollTracker"),
      source.indexOf("const handleScrollToEdge"),
    );

    expect(trackerSection).toContain("setActive(id)");
    expect(trackerSection).not.toContain("setNavId(id)");
    expect(trackerSection).not.toContain("setNavId(lastIconId)");
    expect(source).not.toContain("initDoneRef");
    expect(source).toContain("navClickScrollingRef");
  });

  it("SideNav scrolling does not load or mutate message history", () => {
    const source = readSource("src/mainview/components/chat/SideNav.tsx");
    expect(source).not.toContain("loadMoreMessages");
    expect(source).not.toContain("hasMoreMessagesBySession");
    expect(source).not.toContain("isLoadingMoreBySession");
  });
});
