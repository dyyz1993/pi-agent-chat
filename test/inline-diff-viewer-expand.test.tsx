import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import React from "react";

const { setGitStateMock, openDiffMock, openExpandMock } = vi.hoisted(() => ({
  setGitStateMock: vi.fn(),
  openDiffMock: vi.fn(),
  openExpandMock: vi.fn(),
}));

vi.mock("../src/mainview/stores/use-git-store", () => ({
  useGitStore: Object.assign(
    vi.fn(() => ({ currentDiff: null, loadingDiff: false })),
    {
      getState: vi.fn(() => ({ currentDiff: null, loadingDiff: false })),
      setState: setGitStateMock,
      subscribe: vi.fn(),
      state: {},
    },
  ),
}));

vi.mock("../src/mainview/stores/use-chat-overlay-store", () => ({
  useChatOverlayStore: Object.assign(
    vi.fn((selector?: (s: unknown) => unknown) => {
      const state = { openDiff: openDiffMock, openExpand: openExpandMock, overlay: null };
      return selector ? selector(state) : state;
    }),
    {
      getState: vi.fn(() => ({ openDiff: openDiffMock, openExpand: openExpandMock })),
      subscribe: vi.fn(),
      state: {},
    },
  ),
}));

vi.mock("../src/mainview/stores/use-theme-store", () => ({
  useThemeStore: vi.fn(() => "light"),
  isDarkGroup: () => false,
}));

vi.mock("../src/mainview/layouts/use-layout-store", () => ({
  useLayoutStore: vi.fn(() => "desktop"),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key,
  }),
}));

import { InlineDiffViewer } from "../src/mainview/components/chat/tool-renderers/InlineDiffViewer";

describe("InlineDiffViewer expand", () => {
  beforeEach(() => {
    setGitStateMock.mockClear();
    openDiffMock.mockClear();
    openExpandMock.mockClear();
  });

  it("uses openDiff + git store currentDiff instead of openExpand", () => {
    const { container } = render(
      <InlineDiffViewer
        oldValue={"a\nb\nc"}
        newValue={"a\nB\nc"}
        filePath="src/example.ts"
        expandable
      />,
    );

    const expandBtn = container.querySelector("button[title='Expand']") as HTMLButtonElement;
    expect(expandBtn).toBeTruthy();
    fireEvent.click(expandBtn);

    expect(openDiffMock).toHaveBeenCalledTimes(1);
    expect(openExpandMock).not.toHaveBeenCalled();
    expect(setGitStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        currentDiff: expect.objectContaining({
          filePath: "src/example.ts",
          oldContent: "a\nb\nc",
          newContent: "a\nB\nc",
        }),
        loadingDiff: false,
      }),
    );
  });

  it("falls back to 'Diff' as title when filePath is missing", () => {
    const { container } = render(
      <InlineDiffViewer oldValue="a" newValue="b" expandable />,
    );

    const expandBtn = container.querySelector("button[title='Expand']") as HTMLButtonElement;
    fireEvent.click(expandBtn);

    expect(setGitStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        currentDiff: expect.objectContaining({
          filePath: "Diff",
        }),
      }),
    );
  });
});
