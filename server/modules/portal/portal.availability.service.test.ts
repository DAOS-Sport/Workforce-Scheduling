import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../infra/db", () => ({ db: {}, pool: {} }));

const { mockData, mockRepo, mockPortal } = vi.hoisted(() => ({
  mockData: { getSystemConfig: vi.fn(), getEmployee: vi.fn(), getVenuesByRegion: vi.fn() },
  mockRepo: { existsOnDate: vi.fn(), create: vi.fn(), countOffRequestsByNoteAndYear: vi.fn() },
  mockPortal: { verifyCaller: vi.fn() },
}));

vi.mock("../system/system.repository", () => ({ systemRepository: mockData }));
vi.mock("../employee/employee.repository", () => ({ employeeRepository: mockData }));
vi.mock("../venue/venue.repository", () => ({ venueRepository: mockData }));
vi.mock("../availability/availability.repository", () => ({ availabilityRepository: mockRepo }));
vi.mock("./portal.service", () => ({ portalService: mockPortal }));

import { submitAvailability } from "./portal.availability.service";

const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
const date = `${today.slice(0, 7)}-15`;

beforeEach(() => {
  vi.clearAllMocks();
  mockData.getSystemConfig.mockImplementation(async (key: string) =>
    key === "availability_window"
      ? { value: JSON.stringify({ targetYearMonth: date.slice(0, 7), windows: [{ openFrom: "2000-01-01", openUntil: "2999-12-31" }] }) }
      : undefined,
  );
  mockPortal.verifyCaller.mockResolvedValue({ ok: true });
  mockData.getEmployee.mockResolvedValue({ id: 5, employmentType: "part_time", regionId: 1 });
  mockData.getVenuesByRegion.mockResolvedValue([{ id: 1, openTime: "06:00", closeTime: "22:00" }]);
  mockRepo.existsOnDate.mockResolvedValue(false);
  mockRepo.create.mockImplementation(async (row: unknown) => ({ id: 1, ...(row as object) }));
});

describe("submitAvailability", () => {
  it("a part-timer who is free all day (note 都可以, no times) is saved even when the region has opening hours", async () => {
    const saved = await submitAvailability({ employeeId: 5, date, note: "都可以" }, "U5");
    expect(saved).toMatchObject({ employeeId: 5, date, entryType: "available", startTime: undefined, endTime: undefined, note: "都可以" });
  });

  it("a time range outside the region's opening hours is still rejected", async () => {
    const error: any = await submitAvailability({ employeeId: 5, date, startTime: "05:00", endTime: "09:00" }, "U5").catch((e) => e);
    expect([error.status, error.message]).toEqual([400, "時段超出場館開放時間（06:00–22:00）"]);
    expect(mockRepo.create).not.toHaveBeenCalled();
  });
});
