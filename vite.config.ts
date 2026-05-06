import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
          "vendor-virtual": ["@tanstack/react-virtual"],
          "vendor-icons": ["lucide-react"],
          "vendor-state": ["zustand"],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    allowedHosts: true,
    proxy: {
      "/health": {
        target: "http://localhost:3100",
        // ws: true,
        changeOrigin: true,
      },
      "/info": {
        target: "http://localhost:3100",
        // ws: true,
        changeOrigin: true,
      },
      "/file": {
        target: "http://localhost:3100",
        // ws: true,
        changeOrigin: true,
      },
      "/fs": {
        target: "http://localhost:3100",
        changeOrigin: true,
      },
      "/api": {
        target: "http://localhost:3100",
        // ws: true,
        changeOrigin: true,
      },
      "/ws": {
        target: "http://localhost:3100",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
