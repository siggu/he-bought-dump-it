import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    // `npm run dev:web`로 프론트만 띄울 때 API/WebSocket은 wrangler dev(8787)로 넘긴다.
    proxy: { "/api": { target: "http://localhost:8787", ws: true } },
  },
});
