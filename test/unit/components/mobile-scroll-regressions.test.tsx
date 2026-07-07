/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApiCall = vi.fn();
const sessionStoreState = {
  activeSessionId: "session-1",
  availableModels: [],
  fetchModelState: vi.fn(),
  sessionsByProject: {
    "/project": [
      {
        sessionId: "session-1",
        projectPath: "/project",
        sessionPath: "/tmp/session-1.jsonl",
      },
    ],
  },
};
const tierStoreState = {
  dataBySession: {
    "session-1": {
      projectPath: "/project",
      currentTier: "fast",
      tierModels: {
        fast: "session-fast",
        pro: "session-pro",
        max: "session-max",
      },
    },
  },
  globalDefaults: {
    fast: "global-fast",
    pro: "global-pro",
    max: "global-max",
  },
  fetchTierConfig: vi.fn(),
  saveGlobalTierModels: vi.fn(async () => undefined),
  setSessionTierModels: vi.fn(),
  saveTierModelsForSession: vi.fn(),
  switchToTier: vi.fn(),
};
const settingsStoreState = {
  showToolCalls: true,
  showToolResults: true,
  showThinking: true,
  collapseThinking: false,
  collapseToolCards: false,
  showTimeline: true,
  showMemoryEntries: true,
  chatViewMode: "comfortable",
  fontPreset: "default",
  setViewMode: vi.fn(),
  setFontPreset: vi.fn(),
  toggle: vi.fn(),
  reset: vi.fn(),
};
const retryStoreState = {
  maxRetries: 3,
  baseDelayMs: 5000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
  jitterRatio: 0.2,
  setRetryConfig: vi.fn(),
  resetRetryConfig: vi.fn(),
};

vi.mock("react-i18next", () => ({
  useTranslation: (ns?: string) => ({
    t: (key: string) => `${ns ?? "common"}:${key}`,
  }),
}));

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: (...args: unknown[]) => mockApiCall(...args),
  },
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  useSessionStore: (selector: (state: typeof sessionStoreState) => unknown) =>
    selector(sessionStoreState),
}));

vi.mock("../../../src/mainview/stores/use-tier-store", () => ({
  TIER_KEYS: ["fast", "pro", "max"],
  useTierStore: Object.assign(
    (selector: (state: typeof tierStoreState) => unknown) => selector(tierStoreState),
    {
      getState: () => tierStoreState,
    },
  ),
}));

vi.mock("../../../src/mainview/stores/use-settings-store", () => ({
  FONT_PRESET_OPTIONS: [{ value: "default", label: "Default" }],
  RETRY_DEFAULTS: {
    maxRetries: 3,
    baseDelayMs: 5000,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
    jitterRatio: 0.2,
  },
  useSettingsStore: Object.assign(
    (selector?: ((state: typeof settingsStoreState) => unknown) | undefined) =>
      selector ? selector(settingsStoreState) : settingsStoreState,
    {
      getState: () => settingsStoreState,
    },
  ),
  useRetryConfigStore: Object.assign(
    (selector?: ((state: typeof retryStoreState) => unknown) | undefined) =>
      selector ? selector(retryStoreState) : retryStoreState,
    {
      getState: () => retryStoreState,
    },
  ),
}));

vi.mock("../../../src/mainview/lib/proxy", () => ({
  getProxyStatus: () => ({ preferred: false, enabled: false, source: "direct" }),
  refreshProxyStatus: vi.fn(async () => ({ preferred: false, enabled: false, source: "direct" })),
  setProxyPreference: vi.fn(async () => undefined),
}));

vi.mock("../../../src/mainview/hooks/use-focus-trap", () => ({
  useFocusTrap: vi.fn(),
}));

vi.mock("../../../src/mainview/components/model-picker/ModelPickerButton", () => ({
  ModelPickerButton: ({ value }: { value?: string }) => (
    <button type="button">model-picker:{value ?? ""}</button>
  ),
}));

vi.mock("../../../src/mainview/components/usage-panel/UsagePanel", () => ({
  UsagePanel: () => <div data-testid="usage-panel">usage</div>,
}));

vi.mock("../../../src/mainview/components/primitives", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  DropdownSelect: ({ value }: { value?: string }) => (
    <div data-testid="dropdown-select">{value ?? "dropdown"}</div>
  ),
  IconButton: ({
    children,
    label,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) => (
    <button type="button" aria-label={label} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { WelcomePage } from "../../../src/mainview/components/welcome/WelcomePage";
import { SettingsPanel } from "../../../src/mainview/components/settings/SettingsPanel";

describe("mobile scroll regressions", () => {
  beforeEach(() => {
    mockApiCall.mockReset();
    mockApiCall.mockResolvedValue({ projects: [] });
    tierStoreState.fetchTierConfig.mockReset();
    tierStoreState.fetchModelState?.mockReset?.();
    tierStoreState.saveGlobalTierModels.mockReset();
    tierStoreState.saveTierModelsForSession.mockReset();
    sessionStoreState.fetchModelState.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps WelcomePage vertically scrollable on mobile", async () => {
    mockApiCall.mockResolvedValue({
      projects: Array.from({ length: 6 }, (_, index) => ({
        path: `/project-${index}`,
        name: `Project ${index}`,
        runtime: "local",
      })),
    });

    const { container } = render(
      <WelcomePage
        onOpenLocalProject={vi.fn()}
        onOpenRemoteProject={vi.fn()}
        onSelectRecentProject={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText("Project 0")).toBeInTheDocument());

    const root = container.firstElementChild;
    expect(root).not.toBeNull();
    expect(root?.className).toContain("overflow-y-auto");
    expect(root?.className).toContain("h-screen");
    expect(root?.className).not.toMatch(/\bmin-h-screen\b/);
  });

  it("keeps SettingsPanel content area flex-driven on mobile so main content can scroll", () => {
    render(<SettingsPanel onClose={vi.fn()} />);

    const panel = screen.getByTestId("settings-panel");
    const contentRow = panel.querySelector(
      ".min-h-0.flex.flex-1.flex-col.bg-bg-primary.md\\:flex-row",
    );
    const mainScroller = panel.querySelector("main.min-h-0.flex-1.overflow-y-auto");

    expect(contentRow).not.toBeNull();
    expect(mainScroller).not.toBeNull();
  });

  it("keeps settings tier mapping global-scoped instead of leaking session overrides", async () => {
    render(<SettingsPanel onClose={vi.fn()} />);

    fireEvent.click(screen.getAllByText("模型")[0]);

    expect(screen.getByText("model-picker:global-fast")).toBeInTheDocument();
    expect(screen.getByText("model-picker:global-pro")).toBeInTheDocument();
    expect(screen.queryByText("model-picker:session-fast")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("settings:saveTier"));

    await waitFor(() => {
      expect(tierStoreState.saveGlobalTierModels).toHaveBeenCalledWith("session-1", {
        fast: "global-fast",
        pro: "global-pro",
        max: "global-max",
      });
    });
    expect(tierStoreState.saveTierModelsForSession).not.toHaveBeenCalled();
  });
});
