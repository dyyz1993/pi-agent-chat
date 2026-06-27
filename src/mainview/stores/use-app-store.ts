import { create } from "zustand";
import { apiClient } from "../lib/api-client";
import type { RPCMethods } from "../lib/api-client";
import type { MethodResult } from "@dyyz1993/rpc-core";
import type { DemoMethod } from "../types";
import { createLogger } from "../../shared/lib/logger";
import { createStartupTrace } from "../lib/startup-monitor";

const log = createLogger("system");

let connectionInitPromise: Promise<void> | null = null;
let connectionListenerInstalled = false;

type DemoResult =
  | MethodResult<RPCMethods, "system.ping">
  | MethodResult<RPCMethods, "system.hello">
  | MethodResult<RPCMethods, "system.echo">;

interface AppState {
  mode: "desktop" | "web";
  ready: boolean;
  initError: string | null;
  restored: boolean;
  logs: string[];
  method: DemoMethod;
  result: DemoResult | null;
  tickEvents: string[];
  tickCount: number;
  subscriptionId: string | null;
  timerRunning: boolean;
  connectionStatus: "connected" | "disconnected";

  initializeConnection: () => Promise<void> | void;
  addLog: (msg: string) => void;
  setMethod: (method: DemoMethod) => void;
  callRPC: (inputText: string) => Promise<void>;
  handleSubscribe: () => Promise<void>;
  handleUnsubscribe: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  mode: "web",
  ready: false,
  initError: null,
  restored: false,
  logs: [],
  method: "system.ping",
  result: null,
  tickEvents: [],
  tickCount: 0,
  subscriptionId: null,
  timerRunning: false,
  connectionStatus: "connected",

  initializeConnection: () => {
    if (get().ready && apiClient.isConnected()) return connectionInitPromise ?? undefined;
    if (connectionInitPromise) return connectionInitPromise;

    const MAX_RETRIES = 5;
    let retries = 0;
    const trace = createStartupTrace("connection.initialize");

    if (!connectionListenerInstalled) {
      connectionListenerInstalled = true;
      apiClient.onConnectionChange((status) => {
        set({ connectionStatus: status });
        get().addLog(`Connection: ${status}`);
      });
    }

    const init = async () => {
      try {
        trace.mark("api-client.initialize.begin", { attempt: retries + 1 });
        await apiClient.initialize();
        const transport = apiClient.getTransport();
        trace.done("api-client.initialize.done", { transport });
        set({
          mode: transport === "ipc" ? "desktop" : "web",
          ready: true,
          initError: null,
        });
        get().addLog(
          `${transport === "ipc" ? "Desktop" : "Web"} mode - ${transport.toUpperCase()}`,
        );
      } catch (e) {
        trace.error("api-client.initialize.failed", e, { attempt: retries + 1 });
        log.warn("API client initialization failed", { retries, error: String(e) });
        retries++;
        if (retries < MAX_RETRIES) {
          setTimeout(init, 1000);
        } else {
          set({ ready: false, initError: `Failed to connect after ${MAX_RETRIES} retries` });
          get().addLog(`Failed to connect after ${MAX_RETRIES} retries`);
          connectionInitPromise = null;
        }
      }
    };
    set({ initError: null });
    connectionInitPromise = init();
    return connectionInitPromise;
  },

  addLog: (msg: string) => {
    const time = new Date().toLocaleTimeString();
    set((s) => ({ logs: [...s.logs.slice(-50), `[${time}] ${msg}`] }));
  },

  setMethod: (method) => set({ method }),

  callRPC: async (_inputText: string) => {
    const { method, addLog } = get();
    addLog(`RPC call: ${method}`);
    try {
      addLog(`Calling: ${method}...`);
      let res: DemoResult;
      if (method === "system.ping") {
        res = await apiClient.call("system.ping", {});
      } else if (method === "system.hello") {
        res = await apiClient.call("system.hello", {});
      } else if (method === "system.echo") {
        res = await apiClient.call("system.echo", {});
      }
      set({ result: res });
      addLog(`Result: ${JSON.stringify(res)}`);
    } catch (err) {
      addLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  },

  handleSubscribe: async () => {
    const { addLog } = get();
    try {
      addLog("Subscribing to tick events...");
      await apiClient.call("timer.start", {});
      set({ timerRunning: true });
      addLog("Timer started");

      const subId = await apiClient.subscribe(
        "timer.tick",
        (payload) => {
          const time = new Date(payload.timestamp).toLocaleTimeString();
          set((s) => ({
            tickEvents: [...s.tickEvents.slice(-19), `#${payload.count} @ ${time}`],
            tickCount: s.tickCount + 1,
          }));
        },
        {},
      );
      set({ subscriptionId: subId });
      addLog(`Subscribed: ${subId}`);
    } catch (err) {
      addLog(`Subscribe error: ${err instanceof Error ? err.message : String(err)}`);
    }
  },

  handleUnsubscribe: async () => {
    const { subscriptionId, addLog } = get();
    try {
      if (subscriptionId) {
        apiClient.unsubscribe(subscriptionId);
        set({ subscriptionId: null });
        addLog("Unsubscribed");
      }
      await apiClient.call("timer.stop", {});
      set({ timerRunning: false });
      addLog("Timer stopped");
    } catch (err) {
      addLog(`Unsubscribe error: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
}));
