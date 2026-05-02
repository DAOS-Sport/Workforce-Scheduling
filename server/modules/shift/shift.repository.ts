/**
 * Shift repository — the single data-access surface for the shift module.
 *
 * For now this file re-exports the storage methods that the shift module
 * needs. Keeping the API stable here lets future refactors (Task #69's
 * follow-ups) move the underlying logic out of storage.ts without forcing
 * every shift route to change its imports.
 *
 * IMPORTANT: the storage methods preserved here include the Task #50
 * shift-protection contract:
 *   - createShift(data, actor) — writes audit log
 *   - updateShift(id, data, actor, force) — refuses force=false on active
 *   - deleteShift(id, actor, reason, force) — refuses force=false on active
 *   - restoreShift(id, actor) — only un-cancels cancelled rows
 *   - getShiftAuditLog(id) — read audit history
 * Any new caller MUST go through this module so the protection chain is
 * consistent.
 */
import { storage } from "../../storage";

export const shiftRepository = {
  // Reads
  getShift: storage.getShift.bind(storage),
  getShiftsByEmployee: storage.getShiftsByEmployee.bind(storage),
  getShiftsByEmployeeAndDateRange: storage.getShiftsByEmployeeAndDateRange.bind(storage),
  getShiftsByEmployeesAndDateRange: storage.getShiftsByEmployeesAndDateRange.bind(storage),
  getShiftsByRegionAndDateRange: storage.getShiftsByRegionAndDateRange.bind(storage),
  getDispatchedShiftsToRegion: storage.getDispatchedShiftsToRegion.bind(storage),
  getCancelledShiftsByRegionAndDateRange: storage.getCancelledShiftsByRegionAndDateRange.bind(storage),
  getAllShiftsByDateRange: storage.getAllShiftsByDateRange.bind(storage),
  getShiftsByDate: storage.getShiftsByDate.bind(storage),

  // Writes (Task #50 protection lives in storage)
  createShift: storage.createShift.bind(storage),
  updateShift: storage.updateShift.bind(storage),
  deleteShift: storage.deleteShift.bind(storage),
  restoreShift: storage.restoreShift.bind(storage),

  // Audit
  getShiftAuditLog: storage.getShiftAuditLog.bind(storage),
};

export type ShiftRepository = typeof shiftRepository;
