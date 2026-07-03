import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../storage", () => ({
  storage: {
    getEmployee: vi.fn(),
    getShiftsByEmployeeAndDateRange: vi.fn(),
    getDispatchShiftsByLinkedEmployee: vi.fn(),
    getVenue: vi.fn(),
    getShiftsByVenueAndDate: vi.fn(),
    getDispatchShifts: vi.fn(),
  },
}));

import { storage } from "../../storage";
import { portalService } from "./portal.service";

const employee = {
  id: 1,
  name: "本人",
  employeeCode: "E001",
  lineId: "U1234567890abcdef1234567890abcdef",
  phone: "0900000000",
  status: "active",
  role: "救生",
};

const coworker = {
  id: 2,
  name: "同事",
  employeeCode: "E002",
  lineId: "Uabcdefabcdefabcdefabcdefabcdefab",
  phone: "0911111111",
  status: "active",
  role: "救生",
};

const venue = {
  id: 5,
  name: "測試館",
  shortName: "測試",
  regionId: 1,
};

const myShift = {
  id: 10,
  employeeId: 1,
  venueId: 5,
  date: "2026-07-04",
  startTime: "09:00",
  endTime: "18:00",
  role: "救生",
  notes: null,
  status: "active",
};

describe("portalService.computeWorkmates shift review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.getEmployee).mockImplementation(async (id: number) => {
      if (id === 1) return employee as any;
      if (id === 2) return coworker as any;
      return undefined;
    });
    vi.mocked(storage.getVenue).mockResolvedValue(venue as any);
    vi.mocked(storage.getShiftsByEmployeeAndDateRange).mockResolvedValue([myShift as any]);
    vi.mocked(storage.getDispatchShiftsByLinkedEmployee).mockResolvedValue([]);
  });

  it("returns only coworkers with reviewable active work shifts", async () => {
    vi.mocked(storage.getShiftsByVenueAndDate).mockResolvedValue([
      myShift,
      {
        ...myShift,
        id: 11,
        employeeId: 2,
        startTime: "09:00",
        endTime: "18:00",
        role: "救生",
      },
      {
        ...myShift,
        id: 12,
        employeeId: 3,
        startTime: "09:00",
        endTime: "18:00",
        role: "休假",
      },
    ] as any);
    vi.mocked(storage.getDispatchShifts).mockResolvedValue([
      {
        id: 20,
        regionId: 1,
        venueId: 5,
        date: "2026-07-04",
        startTime: "09:00",
        endTime: "18:00",
        dispatchName: "取消派遣",
        role: "救生",
        status: "cancelled",
        linkedEmployeeId: null,
      },
    ] as any);

    const result = await portalService.computeWorkmates(1, "2026-07-04");

    expect(result.myShift?.id).toBe(10);
    expect(result.coworkers).toHaveLength(1);
    expect(result.coworkers[0]).toMatchObject({ employeeId: 2, name: "同事" });
  });

  it("returns no shift when the employee only has a leave row", async () => {
    vi.mocked(storage.getShiftsByEmployeeAndDateRange).mockResolvedValue([
      { ...myShift, role: "休假", startTime: "00:00", endTime: "00:00" },
    ] as any);
    vi.mocked(storage.getShiftsByVenueAndDate).mockResolvedValue([]);
    vi.mocked(storage.getDispatchShifts).mockResolvedValue([]);

    const result = await portalService.computeWorkmates(1, "2026-07-04");

    expect(result.myShift).toBeNull();
    expect(result.coworkers).toEqual([]);
    expect(result.message).toBe("當日無排班");
  });
});
