import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In dev the WebSocket lives on the backend workspace; in production the
    // same Node process serves this bundle, so the client always talks to
    // /ws on its own origin and never needs to know the difference.
    proxy: {
      "/ws": { target: "ws://localhost:8080", ws: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
