import { describe, expect, it } from "vitest";
import {
  getSideNavViewportMetrics,
  getSideNavViewportPadding,
} from "../../../src/mainview/components/chat/SideNav";

describe("SideNav viewport metrics", () => {
  it("keeps sparse nav items grouped near the top", () => {
    const metrics = getSideNavViewportMetrics(640, 4);

    expect(metrics.visibleItemCount).toBe(4);
    expect(metrics.viewportHeight).toBe(152);
    expect(metrics.gap).toBe(8);
    expect(getSideNavViewportPadding(640, 4)).toBe(8);
  });

  it("distributes spacing across complete visible icons when items overflow the viewport", () => {
    const metrics = getSideNavViewportMetrics(650, 30);

    expect(metrics.visibleItemCount).toBe(20);
    expect(metrics.viewportHeight).toBe(650);
    expect(metrics.gap).toBeCloseTo(10 / 19);
  });

  it("keeps overflowing edge icons complete with equal interior gaps", () => {
    const metrics = getSideNavViewportMetrics(100, 30);

    expect(metrics.visibleItemCount).toBe(3);
    expect(metrics.viewportHeight).toBe(100);
    expect(metrics.gap).toBe(2);
  });

  it("handles an empty nav without reserving slots", () => {
    const metrics = getSideNavViewportMetrics(640, 0);

    expect(metrics.visibleItemCount).toBe(0);
    expect(metrics.viewportHeight).toBe(0);
    expect(metrics.gap).toBe(0);
  });
});
