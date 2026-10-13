import type { Employee, Shift } from "./schema";

export type ScheduleEmployee = Pick<Employee, "id" | "name" | "employeeCode" | "role" | "employmentType" | "regionId" | "status">;

// History metadata never makes an inactive employee assignable to a new shift.
export function scheduleDisplayEmployees(active: ScheduleEmployee[], metadata: ScheduleEmployee[], shifts: Pick<Shift, "employeeId">[]): ScheduleEmployee[] {
  const scheduled = new Set(shifts.map(s => s.employeeId));
  const current = new Map(metadata.map(e => [e.id, e]));
  const rows = new Map<number, ScheduleEmployee>();
  for (const employee of active) {
    const e = current.get(employee.id) ?? employee;
    if (e.status === "active" || scheduled.has(e.id)) rows.set(e.id, e);
  }
  for (const e of metadata) if (scheduled.has(e.id)) rows.set(e.id, e);
  return [...rows.values()];
}
