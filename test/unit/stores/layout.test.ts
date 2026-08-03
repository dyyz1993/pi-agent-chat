import { beforeEach, describe, expect, it } from "vitest";
import { useLayoutStore } from "../../../src/mainview/layouts/use-layout-store";

describe("useLayoutStore", () => {
  beforeEach(() => {
    useLayoutStore.setState({
      statusPanel: "hidden",
      activePanelTab: "status",
      breakpoint: "desktop",
    });
  });

  it("uses status as the default right panel tab", () => {
    expect(useLayoutStore.getState().activePanelTab).toBe("status");
  });

  it("opens the right status panel and switches to the requested tab", () => {
    useLayoutStore.getState().openStatusPanel("status");

    expect(useLayoutStore.getState().statusPanel).toBe("visible");
    expect(useLayoutStore.getState().activePanelTab).toBe("status");
  });

  it("opens the right status panel without changing tab when no tab is provided", () => {
    useLayoutStore.setState({ activePanelTab: "hooks" });

    useLayoutStore.getState().openStatusPanel();

    expect(useLayoutStore.getState().statusPanel).toBe("visible");
    expect(useLayoutStore.getState().activePanelTab).toBe("hooks");
  });

  it("preserves pinned state when opening status panel", () => {
    useLayoutStore.setState({ statusPanel: "pinned", activePanelTab: "status" });

    useLayoutStore.getState().openStatusPanel("changeReview");

    expect(useLayoutStore.getState().statusPanel).toBe("pinned");
    expect(useLayoutStore.getState().activePanelTab).toBe("changeReview");
  });

  it("preserves visible state when opening status panel", () => {
    useLayoutStore.setState({ statusPanel: "visible", activePanelTab: "git" });

    useLayoutStore.getState().openStatusPanel("supervisor");

    expect(useLayoutStore.getState().statusPanel).toBe("visible");
    expect(useLayoutStore.getState().activePanelTab).toBe("supervisor");
  });

  it("forces status panel to visible on mobile when it was pinned (so RightSidebar renders)", () => {
    useLayoutStore.setState({ statusPanel: "pinned", breakpoint: "mobile" });

    useLayoutStore.getState().openStatusPanel("goal");

    expect(useLayoutStore.getState().statusPanel).toBe("visible");
    expect(useLayoutStore.getState().activePanelTab).toBe("goal");
  });

  it("forces status panel to visible on tablet when it was pinned", () => {
    useLayoutStore.setState({ statusPanel: "pinned", breakpoint: "tablet" });

    useLayoutStore.getState().openStatusPanel("goal");

    expect(useLayoutStore.getState().statusPanel).toBe("visible");
  });

  it("forces status panel to visible on mobile when it was hidden", () => {
    useLayoutStore.setState({ statusPanel: "hidden", breakpoint: "mobile" });

    useLayoutStore.getState().openStatusPanel("goal");

    expect(useLayoutStore.getState().statusPanel).toBe("visible");
  });
});
