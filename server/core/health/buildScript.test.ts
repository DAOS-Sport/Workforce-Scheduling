import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { git, esbuild, viteBuild, rm, readFile } = vi.hoisted(() => ({
  git: vi.fn(), esbuild: vi.fn(), viteBuild: vi.fn(), rm: vi.fn(), readFile: vi.fn(),
}));
vi.mock("node:child_process", () => ({ execFileSync: git }));
vi.mock("esbuild", () => ({ build: esbuild }));
vi.mock("vite", () => ({ build: viteBuild }));
vi.mock("fs/promises", () => ({ rm, readFile }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  readFile.mockResolvedValue(JSON.stringify({ dependencies: { express: "5.0.1", other: "1" } }));
  vi.stubEnv("HEALTH_BUILD_LABEL", "build-environment-label");
});
afterEach(() => vi.unstubAllEnvs());

describe("existing build entry embeds the health commit", () => {
  it.each([
    ["available git", "abc1234\n", "abc1234"],
    ["unavailable git", null, "unknown"],
  ])("finishes with %s", async (_name, commit, expected) => {
    git.mockImplementation(() => {
      if (commit === null) throw new Error("git unavailable");
      return commit;
    });
    await import("../../../script/build");
    await vi.waitFor(() => expect(esbuild).toHaveBeenCalledOnce());
    expect(git).toHaveBeenCalledWith("git", ["rev-parse", "--short", "HEAD"], expect.objectContaining({ encoding: "utf8" }));
    expect(viteBuild).toHaveBeenCalledOnce();
    expect(esbuild.mock.calls[0][0]).toMatchObject({
      entryPoints: ["server/index.ts"],
      define: { "process.env.NODE_ENV": '"production"', __HEALTH_BUILD_SHA__: JSON.stringify(expected) },
    });
  });
});
