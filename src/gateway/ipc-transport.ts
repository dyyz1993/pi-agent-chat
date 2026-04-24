import type { Transport, MessageHandler, ErrorHandler } from "@dyyz1993/rpc-core";

/**
 * Transport that bridges between Bun and Webview via:
 * - Bun → Browser: executeJavascript calls window.__piAgentIPC()
 * - Browser → Bun: __electrobunBunBridge.postMessage with Electrobun message format
 */
export class ElectrobunTransport implements Transport {
  private messageHandlers: Set<MessageHandler> = new Set();
  private errorHandlers: Set<ErrorHandler> = new Set();
  private browserView: { executeJavascript: (js: string) => void } | null = null;
  private closed = false;

  setBrowserView(view: { executeJavascript: (js: string) => void }): void {
    this.browserView = view;
    // eslint-disable-next-line no-console
    console.log("[IPC Transport] BrowserView set");
  }

  async send(message: unknown): Promise<void> {
    if (this.closed) {
      throw new Error("Transport is closed");
    }
    if (!this.browserView) {
      throw new Error("BrowserView not set");
    }

    // Pass JSON directly as a JS expression — JSON is valid JavaScript
    const msgJson = JSON.stringify(message);
    this.browserView.executeJavascript(
      `if(typeof window.__piAgentIPC==="function"){window.__piAgentIPC(${msgJson})}`
    );
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  onError(handler: ErrorHandler): () => void {
    this.errorHandlers.add(handler);
    return () => {
      this.errorHandlers.delete(handler);
    };
  }

  onDisconnect(): () => void {
    return () => {};
  }

  isConnected(): boolean {
    return this.browserView !== null && !this.closed;
  }

  close(): void {
    this.closed = true;
    this.messageHandlers.clear();
    this.errorHandlers.clear();
    this.browserView = null;
  }

  handleMessage(message: unknown): void {
    if (this.closed) return;
    for (const handler of this.messageHandlers) {
      handler(message);
    }
  }
}
