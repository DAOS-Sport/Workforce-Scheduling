import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: { deleteVenueShiftTemplatesByVenue: vi.fn(), createVenueShiftTemplate: vi.fn() },
}));

vi.mock("../../storage", () => ({ storage: mockStorage }));

import { scheduleSlotService } from "./scheduleSlot.service";

const template = (over: Record<string, unknown> = {}) => ({ dayType: "weekday", shiftLabel: "早班", startTime: "06:00", endTime: "14:00", role: "救生", requiredCount: 1, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  mockStorage.createVenueShiftTemplate.mockImplementation(async (row: object) => ({ id: 1, ...row }));
});

describe("batchReplaceTemplates", () => {
  it("a bad template anywhere in the batch leaves the venue's existing templates untouched", async () => {
    const error: any = await scheduleSlotService.batchReplaceTemplates(7, [template(), template({ startTime: undefined })]).catch((e) => e);
    expect(error.name).toBe("ZodError");
    expect(mockStorage.deleteVenueShiftTemplatesByVenue).not.toHaveBeenCalled();
    expect(mockStorage.createVenueShiftTemplate).not.toHaveBeenCalled();
  });

  it("a valid batch replaces the venue's templates", async () => {
    const result = await scheduleSlotService.batchReplaceTemplates(7, [template(), template({ shiftLabel: "晚班", startTime: "14:00", endTime: "22:00" })]);
    expect(mockStorage.deleteVenueShiftTemplatesByVenue).toHaveBeenCalledWith(7);
    expect(result.map((t: any) => [t.venueId, t.shiftLabel])).toEqual([[7, "早班"], [7, "晚班"]]);
  });
});
