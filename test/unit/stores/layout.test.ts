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
});
