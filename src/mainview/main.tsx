import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { apiClient } from "./lib/api-client";
import "./index.css";
import App from "./App";

const isElectrobun = typeof window !== "undefined" && !!window.__electrobunBunBridge;

if (isElectrobun) {
  // 桌面端：同步初始化 IPC（Electrobun 要求桥接在页面加载时同步设置）
  apiClient.initSyncForDesktop();
}
// Web 端 WS 初始化由 App.tsx 统一管理，避免竞争

// eslint-disable-next-line no-console
console.log("[Main] Application starting, isElectrobun:", isElectrobun);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
