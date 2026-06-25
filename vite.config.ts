import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 支持通过环境变量覆盖 API 代理目标，方便 worktree 共存
// 主仓库默认 3100，worktree 可设为: VITE_API_TARGET=http://localhost:3101
const API_TARGET = process.env.VITE_API_TARGET || "http://localhost:3100";

// Vite 端口也可通过环境变量覆盖（dev 脚本自动分配）
const VITE_PORT = parseInt(process.env.VITE_PORT || "5173", 10);
const VITE_STRICT_PORT = process.env.VITE_STRICT_PORT !== "false";

export default defineConfig({
  plugins: [react()],
  root: "src/mainview",
  publicDir: "public",
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom"],
          "vendor-markdown": [
            "unified",
            "remark-parse",
            "remark-rehype",
            "hast-util-to-jsx-runtime",
            "vfile",
          ],
          "vendor-highlight": ["prism-react-renderer"],
          "vendor-diff": ["react-diff-viewer-continued"],
          "vendor-virtual": ["virtua"],
          "vendor-icons": ["lucide-react"],
          "vendor-state": ["zustand"],
        },
      },
    },
  },
  server: {
    port: VITE_PORT,
    strictPort: VITE_STRICT_PORT,
    host: true,
    allowedHosts: true,
    proxy: {
      "/health": {
        target: API_TARGET,
        changeOrigin: true,
      },
      "/info": {
        target: API_TARGET,
        changeOrigin: true,
      },
      "/file": {
        target: API_TARGET,
        changeOrigin: true,
      },
      "/fs": {
        target: API_TARGET,
        changeOrigin: true,
      },
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
      },
      "/ws": {
        target: API_TARGET,
        ws: true,
        changeOrigin: true,
      },
      "/__proxy__/": {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
});
