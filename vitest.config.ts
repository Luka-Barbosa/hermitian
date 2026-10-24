import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.join(import.meta.dirname, "src") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // Tests never make live calls: force replay regardless of .env.local.
    env: {
      DECIDE_BACKEND: "replay",
      SYSTEM2_BACKEND: "replay",
      HERMITIAN_NO_LIVE: "1",
    },
    testTimeout: 60_000,
    fileParallelism: false,
  },
});
