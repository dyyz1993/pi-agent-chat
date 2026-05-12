import { describe, it, expect, beforeEach } from "vitest";

import { useExpandStore } from "../src/mainview/stores/use-expand-store";

describe("useExpandStore", () => {
  beforeEach(() => {
    useExpandStore.setState({ expandedContent: null, expandedTitle: "" });
  });

  it("initial state: expandedContent=null, expandedTitle=''", () => {
    const s = useExpandStore.getState();
    expect(s.expandedContent).toBeNull();
    expect(s.expandedTitle).toBe("");
  });

  it("openExpand with content only uses default title", () => {
    useExpandStore.getState().openExpand("some code");
    const s = useExpandStore.getState();
    expect(s.expandedContent).toBe("some code");
    expect(s.expandedTitle).toBe("展开内容");
  });

  it("openExpand with custom title", () => {
    useExpandStore.getState().openExpand("some code", "自定义标题");
    const s = useExpandStore.getState();
    expect(s.expandedContent).toBe("some code");
    expect(s.expandedTitle).toBe("自定义标题");
  });

  it("closeExpand resets all state", () => {
    useExpandStore.getState().openExpand("code", "Title");
    useExpandStore.getState().closeExpand();
    const s = useExpandStore.getState();
    expect(s.expandedContent).toBeNull();
    expect(s.expandedTitle).toBe("");
  });

  it("multiple opens — last one wins", () => {
    useExpandStore.getState().openExpand("first", "T1");
    useExpandStore.getState().openExpand("second", "T2");
    const s = useExpandStore.getState();
    expect(s.expandedContent).toBe("second");
    expect(s.expandedTitle).toBe("T2");
  });
});
