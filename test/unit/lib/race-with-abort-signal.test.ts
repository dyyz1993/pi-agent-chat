import { describe, expect, it, vi } from "vitest";
import { raceWithAbortSignal } from "../../../src/mainview/lib/race-with-abort-signal";

describe("raceWithAbortSignal", () => {
  it("resolves with the underlying value when signal stays intact", async () => {
    const controller = new AbortController();
    const promise = Promise.resolve("ok");

    await expect(raceWithAbortSignal(promise, controller.signal)).resolves.toBe("ok");
  });

  it("rejects immediately when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const promise = new Promise<string>(() => {});

    await expect(raceWithAbortSignal(promise, controller.signal)).rejects.toThrow(/aborted/i);
  });

  it("rejects when signal fires while the underlying promise is pending", async () => {
    const controller = new AbortController();
    let resolveUnderlying: (value: string) => void = () => {};
    const promise = new Promise<string>((resolve) => {
      resolveUnderlying = resolve;
    });

    const racePromise = raceWithAbortSignal(promise, controller.signal);
    controller.abort();

    await expect(racePromise).rejects.toThrow(/aborted/i);
    resolveUnderlying("never");
  });

  it("does not leak abort listener after the underlying promise resolves", async () => {
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener");
    const promise = Promise.resolve("ok");

    await raceWithAbortSignal(promise, controller.signal);

    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("rejects with the underlying error when promise rejects before abort", async () => {
    const controller = new AbortController();
    const promise = Promise.reject(new Error("rpc failed"));

    await expect(raceWithAbortSignal(promise, controller.signal)).rejects.toThrow("rpc failed");
  });
});
