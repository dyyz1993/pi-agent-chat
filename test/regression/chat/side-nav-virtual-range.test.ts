import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  getSideNavEffectiveScrollBehavior,
  getSideNavVirtualRange,
} from "../../../src/mainview/components/chat/SideNav";

const root = process.cwd();

function readSource(path: string) {
  return readFileSync(join(root, path), "utf-8");
}

describe("SideNav virtual range", () => {
  it("returns an empty range for empty item lists", () => {
    expect(
      getSideNavVirtualRange({
        scrollTop: 0,
        viewportHeight: 640,
        itemCount: 0,
        gap: 0,
      }),
    ).toEqual({
      startIndex: 0,
      endIndex: 0,
      topOffset: 0,
      totalSize: 0,
    });
  });

  it("renders only the visible window plus overscan for large lists", () => {
    const range = getSideNavVirtualRange({
      scrollTop: 0,
      viewportHeight: 640,
      itemCount: 5000,
      gap: 0,
      itemHeight: 32,
      overscan: 2,
    });

    expect(range.startIndex).toBe(0);
    expect(range.endIndex).toBe(23);
    expect(range.totalSize).toBe(160000);
  });

  it("preserves item position when scrolled into the middle", () => {
    const range = getSideNavVirtualRange({
      scrollTop: 3200,
      viewportHeight: 320,
      itemCount: 5000,
      gap: 0,
      itemHeight: 32,
      overscan: 4,
    });

    expect(range.startIndex).toBe(96);
    expect(range.endIndex).toBe(115);
    expect(range.topOffset).toBe(3072);
  });

  it("includes inter-item gaps in total size and offsets", () => {
    const range = getSideNavVirtualRange({
      scrollTop: 200,
      viewportHeight: 120,
      itemCount: 10,
      gap: 8,
      itemHeight: 32,
      overscan: 1,
    });

    expect(range.startIndex).toBe(4);
    expect(range.endIndex).toBe(10);
    expect(range.topOffset).toBe(160);
    expect(range.totalSize).toBe(392);
  });
});

describe("SideNav mobile history behavior", () => {
  it("does not enable the independent SideNav history window on mobile", () => {
    const source = readSource("src/mainview/components/chat/ChatPanel.tsx");

    expect(source).toContain("shouldUseIndependentSideNavHistory(breakpoint)");
    expect(source).toContain("if (!useIndependentSideNavHistory) return undefined");
    expect(source).toContain("compactMotion={isMobileOrTablet}");
  });

  it("uses compact motion for mobile SideNav follow behavior", () => {
    const source = readSource("src/mainview/components/chat/SideNav.tsx");

    expect(source).toContain('scrollSnapType: compactMotion ? "none" : "y mandatory"');
    expect(source).toContain("SIDE_NAV_COMPACT_SMOOTH_MAX_DISTANCE");
  });

  it("keeps short SideNav motion smooth but avoids long smooth jumps", () => {
    expect(getSideNavEffectiveScrollBehavior(100, 160, "smooth", 96)).toBe("smooth");
    expect(getSideNavEffectiveScrollBehavior(100, 600, "smooth", 96)).toBe("auto");
    expect(getSideNavEffectiveScrollBehavior(100, 600, "auto", 96)).toBe("auto");
  });
});
