import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BashBackgroundProcessCard } from "../../../src/mainview/components/chat/BashBackgroundProcessCard";

afterEach(() => {
  cleanup();
});

describe("BashBackgroundProcessCard", () => {
  it("shows detailed background process information when expanded", () => {
    render(
      <BashBackgroundProcessCard
        data={{
          bashId: "bash-fabe60",
          toolCallId: "tool-123",
          command: '"/tmp/cumulative_sum_test.sh"',
          cwd: "/tmp/project",
          pid: 58809,
          status: "done",
          reason: "exit_zero",
          backgroundTrigger: "auto",
          exitCode: 0,
          duration: "1m0s",
          logPath: "/tmp/pi-bash-fabe60.log",
        }}
      />,
    );

    expect(screen.getByText("正常退出")).toBeInTheDocument();
    expect(screen.getByText(/自动后台/)).toBeInTheDocument();
    expect(screen.getByText(/cumulative_sum_test/)).toBeInTheDocument();
    expect(screen.getByText("/tmp/project")).toBeInTheDocument();
    expect(screen.getByText("bash-fabe60")).toBeInTheDocument();
    expect(screen.getByText("58809")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("/tmp/pi-bash-fabe60.log")).toBeInTheDocument();
  });

  it("keeps compact rendering to the summary row", () => {
    render(
      <BashBackgroundProcessCard
        compact
        data={{
          command: "npm run dev",
          status: "done",
          reason: "exit_zero",
          backgroundTrigger: "manual",
          exitCode: 0,
          cwd: "/tmp/project",
        }}
      />,
    );

    expect(screen.getByText("正常退出")).toBeInTheDocument();
    expect(screen.getByText(/手动后台/)).toBeInTheDocument();
    expect(screen.queryByText("命令")).not.toBeInTheDocument();
    expect(screen.queryByText("/tmp/project")).not.toBeInTheDocument();
  });

  it("renders structured log preview with omitted and repeated lines", () => {
    render(
      <BashBackgroundProcessCard
        data={{
          command: "run long task",
          status: "terminated",
          reason: "user_cancel",
          backgroundTrigger: "auto",
          exitCode: null,
          logPreview: {
            totalLines: 120,
            totalBytes: 4096,
            truncated: true,
            headLineCount: 24,
            tailLineCount: 24,
            segments: [
              { kind: "line", text: "tick 1" },
              { kind: "line", text: "same output", repeatCount: 5 },
              { kind: "omitted", lineCount: 72 },
              { kind: "line", text: "final tick" },
            ],
          },
        }}
      />,
    );

    expect(screen.getByText("日志预览")).toBeInTheDocument();
    expect(screen.getByText("120 行")).toBeInTheDocument();
    expect(screen.getByText("4.0 KB")).toBeInTheDocument();
    expect(screen.getByText("tick 1")).toBeInTheDocument();
    expect(screen.getByText("same output")).toBeInTheDocument();
    expect(screen.getByText("... 上一行重复 4 行 ...")).toBeInTheDocument();
    expect(screen.getByText("... 省略中间 72 行 ...")).toBeInTheDocument();
    expect(screen.getByText("final tick")).toBeInTheDocument();
  });
});
