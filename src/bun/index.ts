import { BrowserWindow, BrowserView, Updater, ApplicationMenu } from "electrobun/bun";
import { RPCServer } from "@dyyz1993/rpc-core";
import { ElectrobunTransport } from "../gateway/ipc-transport";
import { registerAllHandlers } from "../shared/register-all-handlers";
import { createLogger, configureLogDir } from "../shared/lib/logger";

configureLogDir("logs");
const log = createLogger("server");

async function getMainViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();
  const DEV_SERVER_URL = "http://localhost:5173";
  if (channel === "dev") {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" });
      log.info(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
      return DEV_SERVER_URL;
    } catch {
      log.info("Vite dev server not running.");
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

const mainWindow = new BrowserWindow({
  title: "PiAgentChat",
  url,
  frame: {
    width: 1200,
    height: 800,
    x: 200,
    y: 200,
  },
  rpc: BrowserView.defineRPC({
    maxRequestTime: 60000,
    handlers: {
      requests: {},
      messages: {
        // @ts-expect-error Electrobun's messages schema doesn't support custom keys at compile time
        "rpc-message": (data: unknown) => {
          try {
            const message = typeof data === "string" ? JSON.parse(data) : data;
            transport.handleMessage(message);
          } catch (error) {
            log.error("Failed to parse RPC message", { error });
          }
        },
      },
    },
  }),
});

transport.setBrowserView(mainWindow.webview);

log.info("PiAgentChat desktop app started!");

ApplicationMenu.setApplicationMenu([
  { label: "PiAgentChat", submenu: [{ role: "about" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "showAll" }, { type: "separator" }, { role: "quit" }] },
  { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
  { label: "View", submenu: [{ role: "toggleFullScreen" }] },
  { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }] },
]);
