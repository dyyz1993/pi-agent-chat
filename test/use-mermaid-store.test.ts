import { describe, it, expect, beforeEach } from "vitest";

import { useMermaidStore } from "../src/mainview/stores/use-mermaid-store";

describe("useMermaidStore", () => {
  beforeEach(() => {
    useMermaidStore.setState({ code: null });
  });

  it("initial code is null", () => {
    expect(useMermaidStore.getState().code).toBeNull();
  });

  it("openFullscreen sets code", () => {
    useMermaidStore.getState().openFullscreen("graph TD; A-->B");
    expect(useMermaidStore.getState().code).toBe("graph TD; A-->B");
  });

  it("closeFullscreen resets code to null", () => {
    useMermaidStore.getState().openFullscreen("graph TD; A-->B");
    useMermaidStore.getState().closeFullscreen();
    expect(useMermaidStore.getState().code).toBeNull();
  });

  it("multiple open/close cycles work correctly", () => {
    useMermaidStore.getState().openFullscreen("code1");
    expect(useMermaidStore.getState().code).toBe("code1");

    useMermaidStore.getState().closeFullscreen();
    expect(useMermaidStore.getState().code).toBeNull();

    useMermaidStore.getState().openFullscreen("code2");
    expect(useMermaidStore.getState().code).toBe("code2");

    useMermaidStore.getState().closeFullscreen();
    expect(useMermaidStore.getState().code).toBeNull();
  });
});
