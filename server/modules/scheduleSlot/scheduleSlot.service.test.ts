import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockData } = vi.hoisted(() => ({
  mockData: { deleteVenueShiftTemplatesByVenue: vi.fn(), createVenueShiftTemplate: vi.fn() },
}));

const { fakeTx, lockXact } = vi.hoisted(() => ({ fakeTx: { name: "tx" }, lockXact: vi.fn(async () => undefined) }));

vi.mock("../../infra/db/tx", () => ({
  LOCK_NS: { venueSlots: 105 },
  lockXact,
  lockXactAscending: vi.fn(async () => undefined),
  withTx: (fn: (tx: unknown) => unknown) => fn(fakeTx),
}));
vi.mock("../venue/venue.repository", () => ({ venueRepository: mockData }));

import { scheduleSlotService } from "./scheduleSlot.service";

const template = (over: Record<string, unknown> = {}) => ({ dayType: "weekday", shiftLabel: "早班", startTime: "06:00", endTime: "14:00", role: "救生", requiredCount: 1, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  mockData.createVenueShiftTemplate.mockImplementation(async (row: object) => ({ id: 1, ...row }));
});

describe("batchReplaceTemplates", () => {
  it("a bad template anywhere in the batch leaves the venue's existing templates untouched", async () => {
    const error: any = await scheduleSlotService.batchReplaceTemplates(7, [template(), template({ startTime: undefined })]).catch((e) => e);
    expect(error.name).toBe("ZodError");
    expect(lockXact).not.toHaveBeenCalled();
    expect(mockData.deleteVenueShiftTemplatesByVenue).not.toHaveBeenCalled();
    expect(mockData.createVenueShiftTemplate).not.toHaveBeenCalled();
  });

  it("a valid batch replaces the venue's templates", async () => {
    const result = await scheduleSlotService.batchReplaceTemplates(7, [template(), template({ shiftLabel: "晚班", startTime: "14:00", endTime: "22:00" })]);
    expect(lockXact).toHaveBeenCalledWith(fakeTx, 105, 7);
    expect(mockData.deleteVenueShiftTemplatesByVenue).toHaveBeenCalledWith(7, fakeTx);
    expect(mockData.createVenueShiftTemplate).toHaveBeenCalledTimes(2);
    expect(mockData.createVenueShiftTemplate.mock.calls.every((call) => call[1] === fakeTx)).toBe(true);
    expect(result.map((t: any) => [t.venueId, t.shiftLabel])).toEqual([[7, "早班"], [7, "晚班"]]);
  });
});
