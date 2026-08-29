import { describe, expect, it, vi } from "vitest";
import {
  defaultProcessDeps,
  readClientPid,
  reapChildProcess,
  type ProcessSignalDeps,
} from "../../../src/shared/agent/child-process-reaper";

function makeDeps(overrides?: Partial<ProcessSignalDeps>): {
  deps: ProcessSignalDeps;
  signals: Array<{ pid: number; signal: "SIGTERM" | "SIGKILL" }>;
  sleeps: number[];
} {
  const signals: Array<{ pid: number; signal: "SIGTERM" | "SIGKILL" }> = [];
  const sleeps: number[] = [];
  const deps: ProcessSignalDeps = {
    isAlive: () => false,
    kill: (pid, signal) => {
      signals.push({ pid, signal });
    },
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    ...overrides,
  };
  return { deps, signals, sleeps };
}

describe("reapChildProcess", () => {
  it("no-ops for missing or invalid pids", async () => {
    const { deps, signals } = makeDeps();
    await expect(reapChildProcess(undefined, deps)).resolves.toBe(false);
    await expect(reapChildProcess(null, deps)).resolves.toBe(false);
    await expect(reapChildProcess(0, deps)).resolves.toBe(false);
    await expect(reapChildProcess(1, deps)).resolves.toBe(false);
    await expect(reapChildProcess(Number.NaN, deps)).resolves.toBe(false);
    expect(signals).toEqual([]);
  });

  it("no-ops when the child is already dead", async () => {
    const { deps, signals } = makeDeps({ isAlive: () => false });
    await expect(reapChildProcess(1234, deps)).resolves.toBe(false);
    expect(signals).toEqual([]);
  });

  it("sends SIGTERM only when the child dies from it", async () => {
    let dead = false;
    const { deps, signals, sleeps } = makeDeps({
      isAlive: () => !dead,
      kill: (pid, signal) => {
        signals.push({ pid, signal });
        if (signal === "SIGTERM") dead = true;
      },
    });
    await expect(reapChildProcess(1234, deps)).resolves.toBe(true);
    expect(signals).toEqual([{ pid: 1234, signal: "SIGTERM" }]);
    expect(sleeps).toEqual([500]);
  });

  it("escalates to SIGKILL when SIGTERM is not enough", async () => {
    const aliveUntilKill = vi.fn<(pid: number) => boolean>();
    let killed = false;
    const { deps, signals } = makeDeps({
      isAlive: (pid) => {
        aliveUntilKill(pid);
        return !killed;
      },
      kill: (pid, signal) => {
        signals.push({ pid, signal });
        if (signal === "SIGKILL") killed = true;
      },
    });
    await expect(reapChildProcess(4321, deps)).resolves.toBe(true);
    expect(signals).toEqual([
      { pid: 4321, signal: "SIGTERM" },
      { pid: 4321, signal: "SIGKILL" },
    ]);
    expect(aliveUntilKill).toHaveBeenCalled();
  });

  it("never throws when kill fails", async () => {
    const { deps, signals } = makeDeps({
      isAlive: () => true,
      kill: () => {
        throw new Error("ESRCH");
      },
    });
    await expect(reapChildProcess(1234, deps)).resolves.toBe(true);
    expect(signals).toEqual([]);
  });

  it("default deps use process signals without throwing on dead pids", async () => {
    // A pid that cannot exist in this test process context; the default
    // isAlive must return false rather than throw.
    await expect(reapChildProcess(3_999_999, defaultProcessDeps)).resolves.toBe(false);
  });
});

describe("readClientPid", () => {
  it("reads pid from a getProcessSnapshot-bearing client", () => {
    expect(readClientPid({ getProcessSnapshot: () => ({ pid: 777, exitCode: null }) })).toBe(777);
  });

  it("returns undefined for clients without the helper", () => {
    expect(readClientPid({})).toBeUndefined();
    expect(readClientPid(null)).toBeUndefined();
    expect(readClientPid(undefined)).toBeUndefined();
  });

  it("returns undefined when the snapshot throws or has no pid", () => {
    expect(
      readClientPid({
        getProcessSnapshot: () => {
          throw new Error("gone");
        },
      }),
    ).toBeUndefined();
    expect(readClientPid({ getProcessSnapshot: () => ({}) })).toBeUndefined();
  });
});
