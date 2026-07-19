import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import { readClipboardImage, readClipboardText, writeClipboardText } from "../lib/native-clipboard";
import { openExternal } from "../lib/native-open-external";

export function register(server: RPCServer, options: HandlerOptions): void {
  const r = createRegister(server);

  r("system.ping", async () => ({
    pong: true,
    timestamp: Date.now(),
    platform: options.platform,
  }));

  r("system.hello", async (params) => ({
    message: `Hello ${params.name ?? "World"}!`,
    timestamp: Date.now(),
  }));

  r("system.echo", async (params) => params);

  r("system.writeClipboard", async (params) => {
    if (options.platform !== "desktop") {
      return { ok: false };
    }
    return { ok: await writeClipboardText(params.text) };
  });

  r("system.readClipboard", async () => {
    if (options.platform !== "desktop") {
      return { text: null };
    }
    return { text: await readClipboardText() };
  });

  r("system.readClipboardImage", async () => {
    if (options.platform !== "desktop") {
      return { pngBase64: null };
    }
    return { pngBase64: await readClipboardImage() };
  });

  r("system.openExternal", async (params) => {
    const ok = await openExternal(params.url);
    return { ok };
  });
}
