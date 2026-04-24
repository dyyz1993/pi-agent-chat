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
  }
}
export {};
