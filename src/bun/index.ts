// @ts-expect-error electrobun Utils not exported in type definitions
import { BrowserWindow, BrowserView, Updater, ApplicationMenu, Utils } from "electrobun/bun";
import { RPCServer } from "@dyyz1993/rpc-core";
import { ElectrobunTransport } from "../gateway/ipc-transport";
import { registerAllHandlers } from "../shared/register-all-handlers";
import { createLogger, setLogSink } from "../shared/lib/logger";
import { configureLogDir, writeLogLine } from "../shared/lib/logger.node";
import { setOpenFolderFn } from "../shared/lib/native-dialog";

const { openFileDialog } = Utils as {
  openFileDialog: (opts: {
    startingFolder: string;
    canChooseFiles: boolean;
    canChooseDirectory: boolean;
    allowsMultipleSelection: boolean;
  }) => Promise<string[]>;
};

setOpenFolderFn(async (opts) => {
  return openFileDialog({
    startingFolder: opts.startingFolder ?? "~/",
    canChooseFiles: false,
    canChooseDirectory: true,
    allowsMultipleSelection: false,
  });
});

configureLogDir("logs");
setLogSink(writeLogLine);
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
  frame: {
    width: 1200,
    height: 800,
    x: 200,
    y: 200,
  },
  rpc: rpcConfig,
} satisfies ConstructorParameters<typeof BrowserWindow>[0];

const mainWindow = new BrowserWindow(windowOptions);

transport.setBrowserView(mainWindow.webview as Parameters<typeof transport.setBrowserView>[0]);

log.info("PiAgentChat desktop app started!");

ApplicationMenu.setApplicationMenu([
  {
    label: "PiAgentChat",
    submenu: [
      { role: "about" },
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
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  },
  { label: "View", submenu: [{ role: "toggleFullScreen" }] },
  { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }] },
]);
