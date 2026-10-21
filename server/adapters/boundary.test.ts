import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

// 對外呼叫只能經過 server/adapters/：要加逾時、重試或健康紀錄時才只需要改一個地方。
const SERVER_DIR = path.resolve(__dirname, "..");
const ADAPTERS_DIR = path.resolve(__dirname);
const FORBIDDEN = [/\bfetch\(/, /from\s+["']nodemailer["']/];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(full);
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [full] : [];
  });
}

describe("external call boundary", () => {
  it("only server/adapters/ talks to external services", () => {
    const offenders = sourceFiles(SERVER_DIR)
      .filter((file) => !file.startsWith(ADAPTERS_DIR + path.sep))
      .flatMap((file) => {
        const text = fs.readFileSync(file, "utf8");
        return FORBIDDEN.filter((re) => re.test(text)).map((re) => `${path.relative(SERVER_DIR, file)} matches ${re}`);
      });
    expect(offenders).toEqual([]);
  });
});
