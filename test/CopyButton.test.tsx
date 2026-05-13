import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { CopyButton } from "../src/mainview/components/chat/CopyButton";

const mockCopy = vi.fn(() => Promise.resolve(true));

vi.mock("../src/mainview/utils/clipboard", () => ({
  copyToClipboard: (...args: unknown[]) => mockCopy(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("CopyButton", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders a button", () => {
    render(<CopyButton text="hello" />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("click calls copyToClipboard with the text prop", () => {
    render(<CopyButton text="copy me" />);
    fireEvent.click(screen.getByRole("button"));
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
