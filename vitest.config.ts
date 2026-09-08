import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "node",
    // Only the pure engine is unit-tested. UI verification stays manual
    // (SPEC §15) — a deliberate trade, not an omission.
    include: ["src/**/*.test.ts"],
  },
});
