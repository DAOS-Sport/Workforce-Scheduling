import { defineConfig } from "vitest/config";
import path from "path";

// Integration tests run against a real throwaway PostgreSQL; scripts/itest.sh starts one.
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is not set; run `bash scripts/itest.sh` to start a throwaway PostgreSQL and the suite");
// Set on this process so globalSetup and the forked test workers all see the same database and zone.
process.env.DATABASE_URL = url;
process.env.TZ = "UTC";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
  test: {
    include: ["server/**/*.itest.ts"],
    environment: "node",
    // Every file shares one database and empties it in beforeAll, so files must not overlap.
    fileParallelism: false,
    globalSetup: ["./server/test/itest.globalSetup.ts"],
    setupFiles: ["./server/test/itest.setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
