import { beforeEach, describe, expect, it, vi } from "vitest";

const { deleteBefore, purgeOldLogs } = vi.hoisted(() => ({
  deleteBefore: vi.fn(),
  purgeOldLogs: vi.fn(),
}));
vi.mock("./errors.repository", () => ({ errorsRepository: { deleteBefore } }));
vi.mock("../../shared/logging/persistence", () => ({ purgeOldLogs }));
import { ERROR_RETENTION_DAYS, purgeOldErrors } from "./errors.service";

beforeEach(() => {
  deleteBefore.mockReset();
  purgeOldLogs.mockReset();
});

describe("error retention", () => {
  it("returns the errors deletion result when secondary log cleanup fails", async () => {
    const now = new Date("2026-11-11T04:00:00Z");
    deleteBefore.mockResolvedValue(3);
    purgeOldLogs.mockRejectedValue(new Error("log cleanup unavailable"));

    await expect(purgeOldErrors(now)).resolves.toEqual({ deleted: 3 });
    expect(deleteBefore).toHaveBeenCalledWith(new Date(now.getTime() - ERROR_RETENTION_DAYS * 86_400_000));
    expect(purgeOldLogs).toHaveBeenCalledWith(now);
  });

  it("still rejects when the errors deletion fails", async () => {
    const failure = new Error("errors deletion unavailable");
    deleteBefore.mockRejectedValue(failure);

    await expect(purgeOldErrors()).rejects.toBe(failure);
    expect(purgeOldLogs).not.toHaveBeenCalled();
  });
});
