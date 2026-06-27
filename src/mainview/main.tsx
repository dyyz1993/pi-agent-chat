import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { apiClient } from "./lib/api-client";
import "./lib/i18n";
import "./index.css";
import App from "./App";
import { installViewportCssVarSync } from "./lib/viewport-css-vars";
import { installDesktopEditCommandBridge } from "./lib/desktop-edit-commands";
import "./lib/channels/in-app-channel";
import "./lib/channels/pwa-channel";
import "./stores/use-theme-store";
import "./stores/use-settings-store";

if (typeof globalThis.crypto !== "undefined" && !globalThis.crypto.randomUUID) {
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    value: () =>
      "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      }),
    configurable: true,
    writable: true,
  });
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* service worker registration fails in non-PWA contexts */
    });
  });
}

const isElectrobun = typeof window !== "undefined" && !!window.__electrobunBunBridge;

if (isElectrobun) {
  document.documentElement.classList.add("electrobun-desktop");
  installViewportCssVarSync();
  installDesktopEditCommandBridge();
  apiClient.initSyncForDesktop();
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
