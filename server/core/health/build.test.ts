import { afterEach, describe, expect, it, vi } from "vitest";
import { getHealthBuild } from "./build";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("health build identity", () => {
  it("prefers the runtime release label over the build-time commit", () => {
    vi.stubEnv("HEALTH_BUILD_LABEL", "release-20261112");
    vi.stubGlobal("__HEALTH_BUILD_SHA__", "abc1234");
    expect(getHealthBuild()).toBe("release-20261112");
  });

  it("falls back to the embedded build-time commit when no label is set", () => {
    vi.stubEnv("HEALTH_BUILD_LABEL", "");
    vi.stubGlobal("__HEALTH_BUILD_SHA__", "abc1234");
    expect(getHealthBuild()).toBe("abc1234");
  });

  it("remains available in unbundled source without git metadata", () => {
    vi.stubEnv("HEALTH_BUILD_LABEL", "");
    expect(getHealthBuild()).toBe("unknown");
  });
});
