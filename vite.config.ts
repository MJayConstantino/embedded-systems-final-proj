import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createBridge } from "./server/bridge.ts";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const bridge = createBridge(env.ARDUINO_HOST || undefined);
  const localApi: Plugin = {
    name: "local-arduino",
    configureServer(server) {
      server.middlewares.use(bridge);
    },
    configurePreviewServer(server) {
      server.middlewares.use(bridge);
    },
  };
  return {
    plugins: [react(), localApi],
    server: { host: "0.0.0.0", port: 5173, strictPort: true },
    preview: { host: "0.0.0.0", port: 5173, strictPort: true },
  };
});
