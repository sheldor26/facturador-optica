import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// La UI (renderer) vive en /renderer y se compila a /dist
export default defineConfig({
  root: "renderer",
  base: "./",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
});
