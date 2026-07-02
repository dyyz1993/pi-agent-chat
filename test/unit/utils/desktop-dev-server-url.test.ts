import { describe, expect, it } from "vitest";
import { resolveDesktopDevServerUrl } from "../../../src/shared/lib/desktop-dev-server-url";

describe("resolveDesktopDevServerUrl", () => {
  it("uses PI_AGENT_CHAT_DEV_SERVER_URL before the local dev fallback", () => {
    expect(
      resolveDesktopDevServerUrl({
        PI_AGENT_CHAT_DEV_SERVER_URL: "https://public.example.com",
        VITE_DEV_SERVER_URL: "https://vite.example.com",
      }),
    ).toBe("https://public.example.com");
  });

  it("keeps VITE_DEV_SERVER_URL as a compatibility override", () => {
    expect(resolveDesktopDevServerUrl({ VITE_DEV_SERVER_URL: "https://vite.example.com" })).toBe(
      "https://vite.example.com",
    );
  });

  it("defaults to the local Vite dev server", () => {
    expect(resolveDesktopDevServerUrl({})).toBe("http://localhost:5173");
  });
});
