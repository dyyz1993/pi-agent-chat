import type { DesktopEditCommand } from "./lib/desktop-edit-commands";

declare global {
  interface Window {
    __electrobun?: {
      receiveMessageFromBun: (msg: unknown) => void;
    };
    __electrobunBunBridge?: {
      postMessage: (msg: string) => void;
    };
    /** Desktop IPC receiver: Bun calls this via executeJavascript */
    __piAgentIPC?: (msg: unknown) => void;
    /** Desktop native menu/accelerator bridge into the WebView */
    __piAgentDesktopEditCommand?: (
      command: DesktopEditCommand,
      payload?: { text?: string; imageBase64?: string },
    ) => Promise<boolean> | boolean;
  }
}
export {};
