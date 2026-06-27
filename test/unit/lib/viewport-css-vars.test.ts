/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { installViewportCssVarSync, syncViewportCssVars } from "../../../src/mainview/lib/viewport-css-vars";

describe("viewport css vars", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("style");
    vi.restoreAllMocks();
  });

  it("writes rounded viewport dimensions to document css variables", () => {
    syncViewportCssVars({ width: 1199.6, height: 521.2 });

    expect(document.documentElement.style.getPropertyValue("--app-viewport-width")).toBe("1200px");
    expect(document.documentElement.style.getPropertyValue("--app-viewport-height")).toBe("521px");
  });

  it("ignores invalid dimensions", () => {
    syncViewportCssVars({ width: 1000, height: 600 });
    syncViewportCssVars({ width: 0, height: 420 });
    syncViewportCssVars({ width: 800, height: Number.NaN });

    expect(document.documentElement.style.getPropertyValue("--app-viewport-width")).toBe("1000px");
    expect(document.documentElement.style.getPropertyValue("--app-viewport-height")).toBe("600px");
  });

  it("updates variables when window resize fires", async () => {
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    vi.stubGlobal("innerWidth", 900);
    vi.stubGlobal("innerHeight", 500);

    const cleanup = installViewportCssVarSync();

    expect(document.documentElement.style.getPropertyValue("--app-viewport-width")).toBe("900px");
    expect(document.documentElement.style.getPropertyValue("--app-viewport-height")).toBe("500px");

    vi.stubGlobal("innerWidth", 760);
    vi.stubGlobal("innerHeight", 420);
    window.dispatchEvent(new Event("resize"));

    expect(document.documentElement.style.getPropertyValue("--app-viewport-width")).toBe("760px");
    expect(document.documentElement.style.getPropertyValue("--app-viewport-height")).toBe("420px");

    cleanup();
    expect(requestAnimationFrameSpy).toHaveBeenCalled();
  });

  it("writes variables immediately on install before the first animation frame", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    vi.stubGlobal("innerWidth", 390);
    vi.stubGlobal("innerHeight", 744);

    const cleanup = installViewportCssVarSync();

    expect(document.documentElement.style.getPropertyValue("--app-viewport-width")).toBe("390px");
    expect(document.documentElement.style.getPropertyValue("--app-viewport-height")).toBe("744px");

    cleanup();
  });
});
