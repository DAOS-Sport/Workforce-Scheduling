import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { clockRecords, overtimeRequests, shifts } from "@shared/schema";
import { db } from "../../infra/db";
import { taipeiInstant } from "../../core/time/taipei";
import { concurrently, createEmployee, createRegion, createShift, createVenue, resetDatabase, warmPool } from "../../test/itest";
import { clockService } from "../clock/clock.service";
import { overtimeService } from "../overtime/overtime.service";
import { systemService } from "./system.service";

/**
 * Behaviour snapshot of the payroll report. The expected values were captured on the code before
 * work order B3 and must not move; the one registered difference is the last test.
 */
const overtime = (employeeId: number, date: string, startTime: string, endTime: string, status: string) =>
  db.insert(overtimeRequests).values({ employeeId, date, startTime, endTime, reason: "測試", status }).returning();

let regionCode = "";
let lateLeaverId = 0;
let lateClockOutId = 0;

beforeAll(async () => {
  await resetDatabase();
  const region = await createRegion();
  regionCode = region.code;
  const venue = await createVenue({ regionId: region.id });
  const a = await createEmployee({ regionId: region.id });
  const b = await createEmployee({ regionId: region.id });
  const c = await createEmployee({ regionId: region.id });
  const at = (employeeId: number, date: string, startTime: string, endTime: string, role: string) =>
    createShift({ employeeId, venueId: venue.id, date, startTime, endTime, role });

  await at(a.id, "2026-07-06", "09:00", "18:00", "救生");
  await at(a.id, "2026-07-11", "08:00", "12:00", "櫃台");
  await at(a.id, "2026-07-12", "10:00", "14:00", "救生");
  await at(a.id, "2026-07-20", "22:00", "02:00", "救生");
  await at(a.id, "2026-07-21", "09:00", "18:00", "特休");
  const cancelled = await at(a.id, "2026-07-22", "09:00", "18:00", "救生");
  await db.update(shifts).set({ status: "cancelled" }).where(eq(shifts.id, cancelled.id));
  await overtime(a.id, "2026-07-20", "23:00", "03:00", "approved");

  await at(b.id, "2026-07-07", "13:00", "17:00", "教練");
  await overtime(b.id, "2026-07-07", "17:00", "19:00", "approved");
  await overtime(b.id, "2026-07-07", "16:00", "18:00", "approved");
  await overtime(b.id, "2026-07-08", "18:00", "20:00", "pending");
  await overtime(b.id, "2026-07-09", "18:00", "20:00", "rejected");

  const late = await at(c.id, "2026-07-08", "09:00", "18:00", "救生");
  const [out] = await db
    .insert(clockRecords)
    .values({ employeeId: c.id, venueId: venue.id, shiftId: late.id, clockType: "out", latitude: 25, longitude: 121.5, status: "success", clockTime: taipeiInstant("2026-07-08", 19 * 60 + 30) })
    .returning();
  lateLeaverId = c.id;
  lateClockOutId = out.id;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("payroll report behaviour snapshot (B3)", () => {
  it("the July salary report is unchanged", async () => {
    expect(await systemService.salaryReport(2026, 7, regionCode)).toMatchInlineSnapshot(`
      {
        "employees": [
          {
            "breakDeduction": 1.5,
            "employeeCode": "TEST0003",
            "hours": {
              "救生": 17,
              "櫃台": 4,
            },
            "id": 1,
            "leaves": {
              "特休": 1,
            },
            "name": "測試員工3",
            "overtimeHours": 1,
            "region": "測試區1",
            "shiftCount": 5,
            "totalLeaveDays": 1,
            "totalWorkHours": 20.5,
          },
          {
            "breakDeduction": 0,
            "employeeCode": "TEST0004",
            "hours": {
              "教練": 4,
            },
            "id": 2,
            "leaves": {},
            "name": "測試員工4",
            "overtimeHours": 3,
            "region": "測試區1",
            "shiftCount": 1,
            "totalLeaveDays": 0,
            "totalWorkHours": 7,
          },
          {
            "breakDeduction": 1,
            "employeeCode": "TEST0005",
            "hours": {
              "救生": 9,
            },
            "id": 3,
            "leaves": {},
            "name": "測試員工5",
            "overtimeHours": 0,
            "region": "測試區1",
            "shiftCount": 1,
            "totalLeaveDays": 0,
            "totalWorkHours": 8,
          },
        ],
        "hasOvertimeData": true,
        "leaveTypes": [
          "特休",
        ],
        "month": 7,
        "workRoles": [
          "救生",
          "教練",
          "櫃台",
        ],
        "year": 2026,
      }
    `);
  });

  it("the four-week compliance view is unchanged", async () => {
    expect(await systemService.fourWeekCompliance(2026, 7, regionCode)).toMatchInlineSnapshot(`
      {
        "normalLimit": 160,
        "overtimeLimit": 176,
        "periods": [
          {
            "employees": [
              {
                "combinedTotal": 17,
                "employeeCode": "TEST0003",
                "employeeId": 1,
                "employeeName": "測試員工3",
                "overtimeAbove160": 0,
                "overtimeHours": 0,
                "region": "測試區1",
                "scheduledHours": 17,
                "status": "normal",
              },
              {
                "combinedTotal": 9,
                "employeeCode": "TEST0005",
                "employeeId": 3,
                "employeeName": "測試員工5",
                "overtimeAbove160": 0,
                "overtimeHours": 0,
                "region": "測試區1",
                "scheduledHours": 9,
                "status": "normal",
              },
              {
                "combinedTotal": 8,
                "employeeCode": "TEST0004",
                "employeeId": 2,
                "employeeName": "測試員工4",
                "overtimeAbove160": 0,
                "overtimeHours": 4,
                "region": "測試區1",
                "scheduledHours": 4,
                "status": "normal",
              },
            ],
            "periodEnd": "2026-07-19",
            "periodStart": "2026-06-22",
          },
          {
            "employees": [
              {
                "combinedTotal": 8,
                "employeeCode": "TEST0003",
                "employeeId": 1,
                "employeeName": "測試員工3",
                "overtimeAbove160": 0,
                "overtimeHours": 4,
                "region": "測試區1",
                "scheduledHours": 4,
                "status": "normal",
              },
              {
                "combinedTotal": 0,
                "employeeCode": "TEST0004",
                "employeeId": 2,
                "employeeName": "測試員工4",
                "overtimeAbove160": 0,
                "overtimeHours": 0,
                "region": "測試區1",
                "scheduledHours": 0,
                "status": "normal",
              },
              {
                "combinedTotal": 0,
                "employeeCode": "TEST0005",
                "employeeId": 3,
                "employeeName": "測試員工5",
                "overtimeAbove160": 0,
                "overtimeHours": 0,
                "region": "測試區1",
                "scheduledHours": 0,
                "status": "normal",
              },
            ],
            "periodEnd": "2026-08-16",
            "periodStart": "2026-07-20",
          },
        ],
        "referenceDate": "2025-01-06",
      }
    `);
  });

  it("registered difference: 加班 filled twice at once for one clock-out is paid once, not twice", async () => {
    const read = overtimeService.getOvertimeRequestsByEmployeeAndDate;
    vi.spyOn(overtimeService, "getOvertimeRequestsByEmployeeAndDate").mockImplementation(async (...args) => {
      const rows = await read(...args);
      await new Promise((resolve) => setTimeout(resolve, 80));
      return rows;
    });
    await warmPool(4);
    await concurrently(2, () => clockService.updateRecordReason(lateClockOutId, undefined, "加班"));
    for (const ot of await db.select().from(overtimeRequests).where(eq(overtimeRequests.clockRecordId, lateClockOutId))) {
      await overtimeService.review(ot.id, "approved", undefined, 1, "測試管理員");
    }

    const report = await systemService.salaryReport(2026, 7, regionCode);

    expect(report.employees.find((e) => e.id === lateLeaverId)?.overtimeHours).toBe(1.5);
  });
});
