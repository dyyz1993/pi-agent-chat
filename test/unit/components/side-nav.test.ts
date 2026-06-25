import { describe, expect, it } from "vitest";
import {
  getSideNavViewportMetrics,
  getSideNavViewportPadding,
} from "../../../src/mainview/components/chat/SideNav";

describe("SideNav viewport metrics", () => {
  it("keeps sparse nav items grouped near the top", () => {
    const metrics = getSideNavViewportMetrics(640, 4);

    expect(metrics.visibleItemCount).toBe(20);
    expect(metrics.viewportHeight).toBe(640);
    expect(metrics.gap).toBe(8);
    expect(getSideNavViewportPadding(640, 4)).toBe(8);
  });

  it("only distributes spacing when items overflow the visible viewport", () => {
    const metrics = getSideNavViewportMetrics(650, 30);

    expect(metrics.visibleItemCount).toBe(20);
    expect(metrics.viewportHeight).toBe(640);
    expect(metrics.gap).toBe(0);
  });
});
