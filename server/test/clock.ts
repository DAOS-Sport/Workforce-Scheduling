import { vi } from "vitest";
import type { Employee, InsertEmployee, Region, Shift, Venue } from "@shared/schema";
import { taipeiClock } from "../core/time/taipei";
import { clockService } from "../modules/clock/clock.service";
import { createEmployee, createRegion, createShift, createVenue } from "./itest";

export const LAT = 25.0;
export const LNG = 121.5;

export const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** A LINE user id in the format the system accepts. */
export const lineUserId = (n: number) => `U${n.toString(16).padStart(32, "0")}`;

export interface OnShiftNow {
  region: Region;
  venue: Venue;
  employee: Employee;
  shift: Shift;
}

/**
 * A venue at (LAT, LNG) and an employee whose shift there started a moment ago and runs two more hours,
 * built around the real Taipei time so a clock-in now lands inside the shift window.
 */
export async function employeeOnShiftNow(employee: Partial<InsertEmployee> = {}, region?: Region, venue?: Venue): Promise<OnShiftNow> {
  const { date, minutes } = taipeiClock(new Date());
  const theRegion = region ?? (await createRegion());
  const theVenue = venue ?? (await createVenue({ regionId: theRegion.id, latitude: LAT, longitude: LNG, radius: 200 }));
  const theEmployee = await createEmployee({ regionId: theRegion.id, ...employee });
  const shift = await createShift({
    employeeId: theEmployee.id,
    venueId: theVenue.id,
    date,
    startTime: hhmm(minutes),
    endTime: hhmm(Math.min(minutes + 120, 23 * 60 + 59)),
  });
  return { region: theRegion, venue: theVenue, employee: theEmployee, shift };
}

/**
 * Make every clock-in pause for `ms` between reading today's rows and deciding. A race that needs
 * two requests to read before either writes then happens on every run instead of most of them.
 */
export function widenReadToWriteWindow(ms = 80): void {
  const read = clockService.getClockRecordsByEmployee;
  vi.spyOn(clockService, "getClockRecordsByEmployee").mockImplementation(async (...args) => {
    const rows = await read(...args);
    await new Promise((resolve) => setTimeout(resolve, ms));
    return rows;
  });
}
