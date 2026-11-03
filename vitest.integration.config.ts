import { defineConfig } from "vitest/config";
import path from "path";

// scripts/itest.sh starts a throwaway PostgreSQL and passes it as TEST_DATABASE_URL.
// Only that URL is used: a DATABASE_URL inherited from the shell never reaches the tests.
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("itest: TEST_DATABASE_URL is not set; run the suite through scripts/itest.sh");
process.env.DATABASE_URL = url;

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client/src"),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.itest.ts"],
    exclude: ["node_modules", ".cache", "dist"],
    globalSetup: ["./server/test/itest.globalSetup.ts"],
    setupFiles: ["./server/test/itest.setup.ts"],
    env: { DATABASE_URL: url, TZ: "UTC" },
    // Every file truncates the one shared database, so files run one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
