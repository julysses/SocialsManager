import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const build = (process.env.GITHUB_SHA ?? "local").slice(0, 7);

export default defineConfig({
  plugins: [react()],
  define: { __BUILD__: JSON.stringify(build) },
  build: { sourcemap: false, target: "es2022" },
});
