/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

import {
  asAgentCommandClient,
  getResponseData,
  normalizeAgentList,
} from "../../../src/shared/agent/agent-command-response";

describe("agent command response helpers", () => {
  it("adapts unknown clients to the command send interface", async () => {
    const send = vi.fn().mockResolvedValue({ data: { ok: true } });
    const client = asAgentCommandClient({ send });

    await expect(client.send({ type: "ping" })).resolves.toEqual({ data: { ok: true } });
    expect(send).toHaveBeenCalledWith({ type: "ping" });
  });

  it("extracts response data only from object responses", () => {
    expect(getResponseData<{ ok: boolean }>({ data: { ok: true } })).toEqual({ ok: true });
    expect(getResponseData("not an object")).toBeUndefined();
    expect(getResponseData({ result: { ok: true } })).toBeUndefined();
  });

  it("normalizes agent list defaults without changing explicit values", () => {
    expect(
      normalizeAgentList([
        { name: "builtin-agent" },
        { name: "user-agent", source: "user", filePath: "/agents/user.md", tools: ["bash"] },
      ]),
    ).toEqual([
      { name: "builtin-agent", source: "builtin", filePath: "" },
      { name: "user-agent", source: "user", filePath: "/agents/user.md", tools: ["bash"] },
    ]);
  });
});
