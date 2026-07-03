import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../storage", () => ({
  storage: {
    getEmployee: vi.fn(),
    getEmployeeByLineId: vi.fn(),
    updateEmployee: vi.fn(),
  },
}));

vi.mock("../line/lineClock.service", () => ({
  processClockIn: vi.fn(),
  formatClockInMessage: vi.fn(() => "打卡成功訊息"),
}));

vi.mock("../line/linePush.service", () => ({
  pushToLine: vi.fn(),
  pushPendingGuidelinesIfAny: vi.fn(),
}));

vi.mock("../shift/shiftReview.service", () => ({
  shiftReviewService: {
    reviewClockRecordShiftForPush: vi.fn(),
  },
}));

import { storage } from "../../storage";
import { processClockIn } from "../line/lineClock.service";
import { pushToLine } from "../line/linePush.service";
import { shiftReviewService } from "../shift/shiftReview.service";
import { liffService } from "./liff.service";

const employee = {
  id: 1,
  name: "王小明",
  employeeCode: "E001",
  lineId: "U1234567890abcdef1234567890abcdef",
  status: "active",
};

const successResult = {
  status: "success",
  clockType: "in",
  venueName: "測試",
  distance: 0,
  time: "09:00",
  date: "2026-07-04",
  shiftInfo: "09:00-18:00",
  failReason: null,
  employeeName: "王小明",
  radius: 300,
  nearbyVenues: [],
  userLat: 25,
  userLng: 121,
  recordId: 99,
};

describe("liffService.processLiffClockIn shift review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.getEmployeeByLineId).mockResolvedValue(employee as any);
    vi.mocked(storage.getEmployee).mockResolvedValue(employee as any);
    vi.mocked(processClockIn).mockResolvedValue(successResult as any);
  });

  it("does not push a clock message when the reviewed shift is no longer valid", async () => {
    vi.mocked(shiftReviewService.reviewClockRecordShiftForPush).mockResolvedValue(null);

    const result = await liffService.processLiffClockIn({
      employeeId: 1,
      latitude: 25,
      longitude: 121,
    });

    expect(result).toEqual(successResult);
    expect(shiftReviewService.reviewClockRecordShiftForPush).toHaveBeenCalledWith(99);
    expect(pushToLine).not.toHaveBeenCalled();
  });

  it("pushes a clock message when the reviewed shift is valid", async () => {
    vi.mocked(shiftReviewService.reviewClockRecordShiftForPush).mockResolvedValue({ id: 10 } as any);

    await liffService.processLiffClockIn({
      employeeId: 1,
      latitude: 25,
      longitude: 121,
    });

    expect(pushToLine).toHaveBeenCalledWith(employee.lineId, "打卡成功訊息");
  });
});
