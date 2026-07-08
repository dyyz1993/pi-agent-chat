// @ts-expect-error electrobun Utils not exported in type definitions
import { BrowserWindow, BrowserView, Updater, ApplicationMenu, Utils } from "electrobun/bun";
import { RPCServer } from "@dyyz1993/rpc-core";
import { ElectrobunTransport } from "../gateway/ipc-transport";
import { registerAllHandlers } from "../shared/register-all-handlers";
import { createLogger, setLogSink } from "../shared/lib/logger";
import { configureLogDir, writeLogLine } from "../shared/lib/logger.node";
import { resolveDesktopDevServerUrl } from "../shared/lib/desktop-dev-server-url";
import { setOpenFolderFn } from "../shared/lib/native-dialog";
import {
  setCheckForUpdateFn,
  setDownloadUpdateFn,
  setApplyUpdateFn,
  setGetUpdateStatusFn,
} from "../shared/lib/desktop-updater";
import {
  setReadClipboardImageFn,
  setReadClipboardTextFn,
  setWriteClipboardTextFn,
} from "../shared/lib/native-clipboard";

const { openFileDialog, clipboardReadImage, clipboardReadText, clipboardWriteText } = Utils as {
  openFileDialog: (opts: {
    startingFolder: string;
    canChooseFiles: boolean;
    canChooseDirectory: boolean;
    allowsMultipleSelection: boolean;
  }) => Promise<string[]>;
  clipboardReadText: () => string | null;
  clipboardReadImage: () => Uint8Array | null;
  clipboardWriteText: (text: string) => void;
};

const desktopApplicationMenu = ApplicationMenu as unknown as {
  on: (name: "application-menu-clicked", handler: (event: unknown) => void) => void;
  setApplicationMenu: (menu: Array<Record<string, unknown>>) => void;
};

setOpenFolderFn(async (opts) => {
  return openFileDialog({
    startingFolder: opts.startingFolder ?? "~/",
    canChooseFiles: false,
    canChooseDirectory: true,
    allowsMultipleSelection: false,
  });
});

setWriteClipboardTextFn((text) => {
  clipboardWriteText(text);
});
setReadClipboardTextFn(() => clipboardReadText() ?? null);
setReadClipboardImageFn(() => {
  const image = clipboardReadImage();
  if (!image) return null;
  return Buffer.from(image).toString("base64");
});

configureLogDir("logs");
setLogSink(writeLogLine);
const log = createLogger("server");
const DEV_SERVER_URL = resolveDesktopDevServerUrl();

async function getMainViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();
  if (channel === "dev") {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" });
      log.info(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
      return DEV_SERVER_URL;
    } catch (e) {
      log.info("Vite dev server not running, falling back to bundled views.", { error: String(e) });
    }
  }
  return "views://mainview/index.html";
}

const url = await getMainViewUrl();

const transport = new ElectrobunTransport();
const server = new RPCServer(transport);

// --- 注册 RPC handlers（自动导入 handlers barrel） ---
registerAllHandlers(server, { platform: "desktop" });

// --- 创建窗口 ---

interface RpcDefinition {
  maxRequestTime: number;
  handlers: {
    requests: Record<string, unknown>;
    messages: Record<string, (data: unknown) => void>;
  };
}

const rpcConfig = BrowserView.defineRPC({
  maxRequestTime: 60000,
  handlers: {
    requests: {} as Record<string, unknown>,
    messages: {
      "rpc-message": (data: unknown) => {
        try {
          const message =
            typeof data === "string"
              ? (JSON.parse(data) as Record<string, unknown>)
              : (data as Record<string, unknown>);
          transport.handleMessage(message);
        } catch (error) {
          log.error("Failed to parse RPC message", { error });
        }
      },
    },
  },
}) as unknown as RpcDefinition;

const windowOptions = {
  title: "PiAgentChat",
  url,
  titleBarStyle: "hiddenInset",
  frame: {
    width: 1200,
    height: 800,
    x: 200,
    y: 200,
  },
  rpc: rpcConfig,
} satisfies ConstructorParameters<typeof BrowserWindow>[0];

const mainWindow = new BrowserWindow(windowOptions);

type DesktopEditCommand = "copy" | "cut" | "paste" | "selectAll" | "undo" | "redo";

function dispatchDesktopEditCommand(
  command: DesktopEditCommand,
  payload?: { text?: string; imageBase64?: string },
): void {
  const js = `window.__piAgentDesktopEditCommand?.(${JSON.stringify(command)}, ${JSON.stringify(payload ?? {})})`;
  mainWindow.webview.executeJavascript(js);
}

function syncViewportToWebview(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
  const roundedWidth = Math.round(width);
  const roundedHeight = Math.round(height);
  const js = `(() => {
    const root = document.documentElement;
    root.style.setProperty("--app-viewport-width", "${roundedWidth}px");
    root.style.setProperty("--app-viewport-height", "${roundedHeight}px");
    window.dispatchEvent(new Event("resize"));
  })();`;
  mainWindow.webview.executeJavascript(js);
}

mainWindow.webview.on("dom-ready", () => {
  const { width, height } = mainWindow.getSize();
  syncViewportToWebview(width, height);
});

mainWindow.on("resize", (event: { data?: { width?: number; height?: number } }) => {
  const width = event.data?.width;
  const height = event.data?.height;
  if (typeof width === "number" && typeof height === "number") {
    syncViewportToWebview(width, height);
  }
});

transport.setBrowserView(mainWindow.webview as Parameters<typeof transport.setBrowserView>[0]);

log.info("PiAgentChat desktop app started!");

// ── 自动更新设置 ──
const updater = Updater as unknown as {
  checkForUpdate: () => Promise<{
    version: string;
    hash: string;
    updateAvailable: boolean;
    updateReady: boolean;
    error: string;
  }>;
  downloadUpdate: () => Promise<void>;
  applyUpdate: () => Promise<void>;
  getStatusHistory: () => Array<{
    status: string;
    message: string;
    timestamp: number;
    details?: Record<string, unknown>;
  }>;
  onStatusChange: (callback: (entry: { status: string; message: string; timestamp: number; details?: Record<string, unknown> }) => void) => void;
};
setCheckForUpdateFn(async () => {
  const info = await updater.checkForUpdate();
  return {
    version: info?.version ?? "",
    hash: info?.hash ?? "",
    updateAvailable: info?.updateAvailable ?? false,
    updateReady: info?.updateReady ?? false,
    error: info?.error ?? "",
  };
});

setDownloadUpdateFn(async () => {
  try {
    await updater.downloadUpdate();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

setApplyUpdateFn(async () => {
  try {
    await updater.applyUpdate();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

setGetUpdateStatusFn(async () => {
  const history = updater.getStatusHistory();
  return {
    entries: history.map((entry) => ({
      status: entry.status,
      message: entry.message,
      timestamp: entry.timestamp,
      details: entry.details as Record<string, unknown> | undefined,
    })),
  };
});

// 启动后静默检查更新
setTimeout(async () => {
  try {
    const info = await updater.checkForUpdate();
    if (info?.updateAvailable) {
      log.info(`Update available: ${info.version}`);
      const msg = JSON.stringify({
        type: "__pi_update_available",
        version: info.version,
        hash: info.hash,
      });
      mainWindow.webview.executeJavascript(
        `(() => { try { window.__piAgentUpdateAvailable?.(${msg}); } catch(e) {} })()`,
      );
    } else {
      log.info("No update available");
    }
  } catch {
    // 静默失败 - 不影响启动
    log.info("Update check skipped (not critical)");
  }
}, 5000);

// 监听更新进度
updater.onStatusChange((entry) => {
  try {
    const msg = JSON.stringify({
      type: "__pi_update_status",
      status: entry.status,
      message: entry.message,
      timestamp: entry.timestamp,
    });
    mainWindow.webview.executeJavascript(
      `(() => { try { window.__piAgentUpdateStatus?.(${msg}); } catch(e) {} })()`,
    );
  } catch {
    // Ignore executeJavascript errors
  }
});

desktopApplicationMenu.on("application-menu-clicked", (event: unknown) => {
  const data = (event as { data?: { action?: string } }).data;
  const action = data?.action;
  if (!action?.startsWith("desktop.edit.")) return;
  const command = action.slice("desktop.edit.".length) as DesktopEditCommand;
  if (command === "paste") {
    const image = clipboardReadImage();
    dispatchDesktopEditCommand(command, {
      text: clipboardReadText() ?? "",
      imageBase64: image ? Buffer.from(image).toString("base64") : undefined,
    });
    return;
  }
  dispatchDesktopEditCommand(command);
});

desktopApplicationMenu.setApplicationMenu([
  {
    label: "PiAgentChat",
    submenu: [
      { role: "about" },
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "showAll" },
      { type: "separator" },
      { role: "quit" },
    ],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo", accelerator: "Command+Z" },
      { role: "redo", accelerator: "Command+Shift+Z" },
      { type: "separator" },
      { role: "cut", accelerator: "Command+X" },
      { role: "copy", accelerator: "Command+C" },
      { role: "paste", accelerator: "Command+V" },
      { role: "pasteAndMatchStyle", accelerator: "Command+Shift+V" },
      { role: "delete" },
      { type: "separator" },
      { role: "selectAll", accelerator: "Command+A" },
      { type: "separator" },
      { role: "startSpeaking" },
      { role: "stopSpeaking" },
    ],
  },
  { label: "View", submenu: [{ role: "toggleFullScreen" }] },
  { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }] },
]);
