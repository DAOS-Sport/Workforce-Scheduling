import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

// 路由只負責讀請求、呼叫 service、寫回應；查資料庫的流程放在 service，才能單獨測試、換掉資料來源也不用改路由（P2-2D）。
const MODULES_DIR = path.resolve(__dirname);
const DATA_ACCESS_IMPORT = /from\s+["']([^"']*\/(db|storage)|[^"']*\.repository)["']/;
// MCP 是給內部工具查資料的端點，每個工具本身就是一次資料查詢；它的驗證方式另案重做（安全問題 S5）。
const ALLOWED = new Set(["mcp/mcp.routes.ts"]);

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return /\.routes\.ts$/.test(entry.name) ? [full] : [];
  });
}

describe("module layering", () => {
  it("route files do not import the database, storage or a repository", () => {
    const offenders = routeFiles(MODULES_DIR)
      .map((file) => path.relative(MODULES_DIR, file).split(path.sep).join("/"))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) => DATA_ACCESS_IMPORT.test(fs.readFileSync(path.join(MODULES_DIR, rel), "utf8")));
    expect(offenders).toEqual([]);
  });
});
