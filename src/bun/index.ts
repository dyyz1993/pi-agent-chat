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
import { setOpenExternalFn } from "../shared/lib/native-open-external";

const { openFileDialog, clipboardReadImage, clipboardReadText, clipboardWriteText, openExternal } = Utils as {
  openFileDialog: (opts: {
    startingFolder: string;
    canChooseFiles: boolean;
    canChooseDirectory: boolean;
    allowsMultipleSelection: boolean;
  }) => Promise<string[]>;
  clipboardReadText: () => string | null;
  clipboardReadImage: () => Uint8Array | null;
  clipboardWriteText: (text: string) => void;
  openExternal: (url: string) => boolean;
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

setOpenExternalFn((url) => {
  try {
    return openExternal(url);
  } catch {
    return false;
  }
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

// 主视图初始加载的 URL，用于被外部链接覆盖后拉回
const mainViewUrl = url;

/**
 * 判断目标 URL 是否属于"内部导航"（不应交给系统浏览器）。
 * 包括：自有 scheme（views://）、dev server、about/blob/data 等本地资源。
 */
function isInternalNavigation(targetUrl: string): boolean {
  if (!targetUrl) return true;
  if (
    targetUrl.startsWith("views://") ||
    targetUrl.startsWith("about:") ||
    targetUrl.startsWith("blob:") ||
    targetUrl.startsWith("data:")
  ) {
    return true;
  }
  try {
    const u = new URL(targetUrl);
    // dev server（Vite HMR 端口）
    if (
      (u.hostname === "localhost" || u.hostname === "127.0.0.1") &&
      u.port === "5173"
    ) {
      return true;
    }
  } catch {
    // 非 http(s) 标准 URL（如 mailto:、自定义 scheme）—— 不视为内部 webview 导航，
    // 交给 openExternal 由系统处理
  }
  return false;
}

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

// ── 外部链接拦截 ──
// Electrobun 的 will-navigate / new-window-open 事件无法阻止导航（导航决策在 native
// 侧同步完成），因此这里在检测到外部 URL 时：1) 用系统默认浏览器打开；2) 把 webview
// 拉回主视图，避免外部网页覆盖当前 UI。内部导航（dev server / views://）放行。
// will-navigate: 普通 <a href> 点击 / location 跳转
// new-window-open: target=_blank 链接 / window.open() —— 这类是当前覆盖问题的主因
function interceptExternalUrl(targetUrl: string, source: string): void {
  if (!targetUrl || isInternalNavigation(targetUrl)) return;
  log.info("Intercepting external navigation, opening in system browser", { source, targetUrl });
  try {
    openExternal(targetUrl);
  } catch (err) {
    log.warn("openExternal failed", { source, targetUrl, err: err instanceof Error ? err.message : String(err) });
  }
  // 拉回主视图，防止外部网页覆盖当前页面
  (mainWindow.webview as unknown as { loadURL: (url: string) => void }).loadURL(mainViewUrl);
}

mainWindow.webview.on("will-navigate", (event: unknown) => {
  const detail = (event as { detail?: unknown }).detail;
  const targetUrl = typeof detail === "string" ? detail : (detail as { url?: string })?.url ?? "";
  interceptExternalUrl(targetUrl, "will-navigate");
});

// new-window-open 不在 BrowserView.on 的公开类型签名里，但 native 侧会广播
(mainWindow.webview as unknown as { on: (name: string, handler: (event: unknown) => void) => void }).on(
  "new-window-open",
  (event: unknown) => {
    const detail = (event as { detail?: unknown }).detail;
    // detail 可能是 string 或 { url, isCmdClick, ... }
    const targetUrl =
      typeof detail === "string"
        ? detail
        : (detail as { url?: string })?.url ?? "";
    interceptExternalUrl(targetUrl, "new-window-open");
  },
);

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
      { label: "Undo", action: "desktop.edit.undo", accelerator: "Command+Z" },
      { label: "Redo", action: "desktop.edit.redo", accelerator: "Command+Shift+Z" },
      { type: "separator" },
      { label: "Cut", action: "desktop.edit.cut", accelerator: "Command+X" },
      { label: "Copy", action: "desktop.edit.copy", accelerator: "Command+C" },
      { label: "Paste", action: "desktop.edit.paste", accelerator: "Command+V" },
      { role: "pasteAndMatchStyle", accelerator: "Command+Shift+V" },
      { role: "delete" },
      { type: "separator" },
      { label: "Select All", action: "desktop.edit.selectAll", accelerator: "Command+A" },
      { type: "separator" },
      { role: "startSpeaking" },
      { role: "stopSpeaking" },
    ],
  },
  { label: "View", submenu: [{ role: "toggleFullScreen" }] },
  { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }] },
]);
