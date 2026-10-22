import { storage } from "../../storage";
import { httpError } from "../../shared/http/response";
import { summerAvailabilityRepository } from "./summerAvailability.repository";
import { summerScheduleService } from "./summerSchedule.service";

async function employeeForLine(lineId: string) {
  if (!lineId) throw httpError(401, "需要 LINE 身份");
  const employee = await storage.getEmployeeByLineId(lineId);
  if (!employee) throw httpError(404, "找不到員工資料");
  return employee;
}

export async function getMySummerAvailability(lineId: string, weekNoParam: string) {
  const employee = await employeeForLine(lineId);
  const weekNo = parseInt(weekNoParam, 10);
  if (!weekNo || weekNo < 1 || weekNo > 9) throw httpError(400, "weekNo 只允許 1-9");
  const record = await summerAvailabilityRepository.getByEmployeeAndWeek(employee.id, weekNo);
  if (!record) throw httpError(404, "尚無填報資料");
  return record;
}

export async function saveMySummerAvailability(lineId: string, body: any) {
  const employee = await employeeForLine(lineId);
  const { weekNo, venueNames = [], weekdayDays = [], weekdaySlots = [], satSlots = [], sunSlots = [], notes } = body;
  if (!weekNo || weekNo < 1 || weekNo > 9) throw httpError(400, "weekNo 只允許 1-9");
  return summerAvailabilityRepository.upsert({
    employeeId: employee.id,
    weekNo,
    venueNames,
    weekdayDays,
    weekdaySlots,
    satSlots,
    sunSlots,
    notes: notes || null,
  });
}

export async function listSummerAvailability(weekNo: number) {
  // 1. 取得暑假排班員工清單（與前台同一份資料）；回傳值為 { items: [] }
  const summerEmpsResult = await summerScheduleService.getEmployeesForSchedule();
  const summerEmps: { id: number; name: string }[] = Array.isArray(summerEmpsResult)
    ? summerEmpsResult
    : (summerEmpsResult as any)?.items ?? [];
  // 2. 取得本週已填報紀錄
  const rows = await summerAvailabilityRepository.getAllByWeek(weekNo);
  const submittedMap = new Map(rows.map((r) => [r.employeeId, r]));
  // 3. 組合：已填報員工展開欄位，未填報員工補 null + submitted:false
  const items = summerEmps.map((emp: { id: number; name: string }) => {
    const record = submittedMap.get(emp.id);
    if (record) {
      return {
        ...record,
        employeeName: emp.name,
        submitted: true,
      };
    }
    return {
      id: null,
      employeeId: emp.id,
      employeeName: emp.name,
      weekNo,
      venueNames: [],
      weekdayDays: [],
      weekdaySlots: [],
      satSlots: [],
      sunSlots: [],
      notes: null,
      submitted: false,
      submittedAt: null,
      updatedAt: null,
    };
  });
  return { items };
}

export async function deleteSummerAvailability(employeeIdParam: string, weekNoParam: string) {
  const employeeId = parseInt(employeeIdParam, 10);
  const weekNo = parseInt(weekNoParam, 10);
  if (!Number.isInteger(employeeId) || employeeId <= 0) throw httpError(400, "employeeId 格式錯誤");
  if (!Number.isInteger(weekNo) || weekNo < 1 || weekNo > 9) throw httpError(400, "weekNo 只允許 1-9");
  const deleted = await summerAvailabilityRepository.deleteByEmployeeAndWeek(employeeId, weekNo);
  return { success: true, deleted };
}
