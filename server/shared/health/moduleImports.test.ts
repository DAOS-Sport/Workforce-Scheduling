import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const databaseImported = vi.fn();

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", undefined);
  databaseImported.mockClear();
  vi.doMock("../../infra/db", () => {
    databaseImported();
    throw new Error("Importing a service must not load the database");
  });
});

afterEach(() => {
  vi.doUnmock("../../infra/db");
  vi.unstubAllEnvs();
});

describe("service imports without database configuration", () => {
  it.each([
    ["health state", () => import("./healthState")],
    ["health log parsing", () => import("../../modules/health/healthLogs")],
    ["region service", () => import("../../modules/region/region.service")],
    ["log persistence", () => import("../logging/persistence")],
  ] as const)("imports %s without loading the database", async (_name, load) => {
    expect(process.env.DATABASE_URL).toBeUndefined();
    await load();
    expect(databaseImported).not.toHaveBeenCalled();
  });
});
