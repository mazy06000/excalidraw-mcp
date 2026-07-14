import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    minify: true,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    outDir: "dist/editor",
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "src/board-editor.html"),
    },
  },
});
