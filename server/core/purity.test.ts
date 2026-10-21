import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

// server/core/ 只放純規則：不碰資料庫、網路、HTTP 框架，才能單獨測試、搬到別處也不用改。
const CORE_DIR = path.resolve(__dirname);
const FORBIDDEN_IMPORTS = /from\s+["'](express|pg|drizzle-orm[^"']*|nodemailer|[^"']*\/(db|storage|adapters|modules|infra)(\/[^"']*)?)["']/;
const FORBIDDEN_CALLS = /\bfetch\(/;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [full] : [];
  });
}

describe("core purity", () => {
  it("server/core/ imports no database, network or framework code", () => {
    const offenders = sourceFiles(CORE_DIR).flatMap((file) => {
      const text = fs.readFileSync(file, "utf8");
      const rel = path.relative(CORE_DIR, file);
      return [
        ...(FORBIDDEN_IMPORTS.test(text) ? [`${rel}: ${text.match(FORBIDDEN_IMPORTS)![0]}`] : []),
        ...(FORBIDDEN_CALLS.test(text) ? [`${rel}: fetch()`] : []),
      ];
    });
    expect(offenders).toEqual([]);
  });
});
