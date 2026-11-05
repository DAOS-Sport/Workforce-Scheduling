import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { HttpError, httpError } from "./errors";

describe("httpError", () => {
  it("is an Error that carries its status and extra fields", () => {
    const err = httpError(409, "already handled", { code: "ALREADY_HANDLED" });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(HttpError);
    expect([err.status, err.message, err.extra]).toEqual([409, "already handled", { code: "ALREADY_HANDLED" }]);
  });
});

describe("one error type", () => {
  const SERVER = path.resolve(__dirname, "..");
  const sources = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return sources(full);
      return /\.tsx?$/.test(e.name) && !/\.(test|itest)\.tsx?$/.test(e.name) ? [full] : [];
    });

  it("no server file builds an error by setting .status on it, or keeps a private error helper", () => {
    const offenders = sources(SERVER).filter((file) => {
      const src = fs.readFileSync(file, "utf8");
      return /\b(err|e)\.status = (\d+|status)\b/.test(src) || /function httpErr\(/.test(src);
    });
    expect(offenders.map((f) => path.relative(SERVER, f).split(path.sep).join("/"))).toEqual([]);
  });
});
