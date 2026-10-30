import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
export default defineConfig({
  plugins: [solid()],
  server: { port: 1420, strictPort: true },
  clearScreen: false,
  build: { target: "es2022" },
  worker: { format: "es" },
});
