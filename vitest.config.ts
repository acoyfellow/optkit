import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "cloudflare:email": resolve(process.cwd(), "test/cloudflare-email.ts"),
    },
  },
});
