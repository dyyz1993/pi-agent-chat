import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "src/mainview",
  publicDir: "public",
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
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
      "/api": {
        target: "http://localhost:3100",
        ws: true,
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:3100",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
