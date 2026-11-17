import { resolve } from "node:path";
import { foldkit } from "@foldkit/vite-plugin";
import { defineConfig } from "vite";

const root = resolve(process.cwd(), "client");

export default defineConfig({
  root,
  plugins: [foldkit()],
  build: {
    outDir: resolve(process.cwd(), "public/app"),
    emptyOutDir: true,
    manifest: true,
    rollupOptions: { input: resolve(root, "src/entry.ts") },
  },
});
