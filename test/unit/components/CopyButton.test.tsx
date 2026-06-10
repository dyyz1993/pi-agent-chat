import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { CopyButton } from "../../../src/mainview/components/chat/CopyButton";
import { CopyAction } from "../../../src/mainview/components/primitives";
import { useNotificationStore } from "../../../src/mainview/stores/use-notification-store";

const mockCopy = vi.fn(() => Promise.resolve(true));

vi.mock("../../../src/mainview/utils/clipboard", () => ({
  copyToClipboard: (...args: unknown[]) => mockCopy(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("CopyButton", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    useNotificationStore.setState({
      notifications: [],
      panelOpen: false,
    });
  });

  it("renders a button", () => {
    render(<CopyButton text="hello" />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("uses custom title as accessible label before copied state", () => {
    render(<CopyButton text="hello" title="Copy payload" />);
    expect(screen.getByRole("button", { name: "Copy payload" })).toBeInTheDocument();
    expect(screen.getByTitle("Copy payload")).toBeInTheDocument();
  });

  it("click calls copyToClipboard with the text prop", async () => {
    render(<CopyButton text="copy me" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
      await Promise.resolve();
    });
    expect(mockCopy).toHaveBeenCalledWith("copy me");
  });

  it("shows check icon after copy (copied state)", async () => {
    render(<CopyButton text="test" />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(screen.getByTitle("copied")).toBeInTheDocument();
    });
  });

  it("reverts to copy icon after timeout", async () => {
    vi.useFakeTimers();
    render(<CopyButton text="test" />);
    fireEvent.click(screen.getByRole("button"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTitle("copied")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByTitle("copy")).toBeInTheDocument();
    vi.useRealTimers();
  });
});

describe("CopyAction", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    useNotificationStore.setState({
      notifications: [],
      panelOpen: false,
    });
  });

  it("pushes a success toast after copy", async () => {
    render(<CopyAction text="copy me" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
      await Promise.resolve();
    });

    expect(useNotificationStore.getState().notifications[0]).toMatchObject({
      level: "info",
      message: "copiedToClipboard",
    });
  });

  it("pushes an error toast when copy fails", async () => {
    mockCopy.mockResolvedValueOnce(false);
    render(<CopyAction text="copy me" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
      await Promise.resolve();
    });

    expect(useNotificationStore.getState().notifications[0]).toMatchObject({
      level: "error",
      message: "copyFailed",
    });
  });
});
