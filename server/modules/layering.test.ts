import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

// 分層規則（目標架構.md）：route 只讀請求、呼叫 service、寫回應；資料存取只在 repository；
// 跨模組讀寫走對方 service；交易要能從 service 一路傳到 repository，所以不准有人繞過去直接用 db。
const ROOT = path.resolve(__dirname, "../..");

/** Files that still break a rule, each with the batch that removes the exception. */
const DB_ALLOWED: Record<string, string> = {
  "server/modules/health/health.service.ts": "U7：健康報告重做時把跨表統計移進 shift/clock repository",
  "server/modules/internal/internal.service.ts": "B4：internal／MCP 入口（S5）整理時補 dispatch、shift 稽核的 repository 讀取",
  "server/modules/mcp/mcp.routes.ts": "B4：MCP 的任意 SQL 工具隨 S5 關閉或移到 infra",
  "server/modules/summerSchedule/summerSchedule.service.ts": "B5：暑假發布包交易＋週次鎖時補 summerSchedule repository",
  "server/modules/system/system.service.ts": "B7：系統設定與薪資讀取整理時改用 dispatchService",
  "server/seed.ts": "B1／B7：seed 改成只補不存在的列（H4，T98、T99）",
};
const CROSS_REPOSITORY_ALLOWED: Record<string, string> = {
  "server/modules/shift/shift.repository.ts": "B5：班表查詢改成單句 SQL（子查詢取員工、場館），不再呼叫 employee、venue repository",
  "server/modules/scheduleSlot/scheduleSlot.repository.ts": "B5：班格與模板整理時改成單句 SQL，不再呼叫 venue repository",
  "server/shared/health/healthState.ts": "B6：健康紀錄改單句 jsonb upsert 時移進 system 模組（adapters 經 system.service 會形成循環）",
};

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");
const isTest = (file: string) => /\.(test|itest)\.tsx?$/.test(file) || file.startsWith("server/test/");
const moduleOf = (file: string) => file.match(/^server\/modules\/(\w+)\//)?.[1] ?? null;

/** Every relative import of a file, resolved to a repository-root path without extension or /index. */
function importsOf(file: string): string[] {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const specs = [...src.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["'](\.[^"']*)["']/g)].map((m) => m[1]);
  return specs.map((spec) => rel(path.resolve(path.join(ROOT, path.dirname(file)), spec)).replace(/\.tsx?$/, "").replace(/\/index$/, ""));
}

const files = [...sourceFiles(path.join(ROOT, "server")), ...sourceFiles(path.join(ROOT, "scripts"))].map(rel);
const serverCode = files.filter((f) => f.startsWith("server/") && !isTest(f));

const isDb = (target: string) => target === "server/infra/db";
const repositoryOwner = (target: string) => target.match(/^server\/modules\/(\w+)\/[\w.]+\.repository$/)?.[1] ?? null;
const isRoute = (file: string) => /\.routes\.ts$/.test(file) || file === "server/routes.ts";
const mayUseDb = (file: string) =>
  /\.repository\.ts$/.test(file) || file.startsWith("server/infra/") || file.startsWith("server/bootstrap/");

const violations = (candidates: string[], breaks: (file: string, target: string) => boolean) =>
  candidates.filter((file) => importsOf(file).some((target) => breaks(file, target)));

describe("module layering", () => {
  it("nothing imports the removed storage façade", () => {
    expect(violations(files, (_f, target) => target === "server/storage")).toEqual([]);
  });

  it("route files do not import the database or a repository", () => {
    const offenders = violations(serverCode.filter(isRoute), (_f, target) => isDb(target) || repositoryOwner(target) !== null);
    expect(offenders.filter((f) => !(f in DB_ALLOWED))).toEqual([]);
  });

  it("a module imports only its own repositories; other modules are reached through their service", () => {
    const offenders = violations(serverCode, (file, target) => {
      const owner = repositoryOwner(target);
      return owner !== null && owner !== moduleOf(file);
    });
    expect(offenders.filter((f) => !(f in CROSS_REPOSITORY_ALLOWED))).toEqual([]);
    expect(Object.keys(CROSS_REPOSITORY_ALLOWED).filter((f) => !offenders.includes(f))).toEqual([]);
  });

  it("only repositories, infra and bootstrap import db", () => {
    const offenders = violations(serverCode.filter((f) => !mayUseDb(f)), (_f, target) => isDb(target));
    expect(offenders.filter((f) => !(f in DB_ALLOWED))).toEqual([]);
    expect(Object.keys(DB_ALLOWED).filter((f) => !offenders.includes(f))).toEqual([]);
  });
});
