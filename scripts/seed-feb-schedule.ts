import { db } from "../server/db";
import { employees, scheduleSlots, shifts } from "../shared/schema";
import { eq, and, gte, lte } from "drizzle-orm";

async function seedFebSchedule() {
  console.log("=== 開始建立 2 月排班資料 ===");

  // Step 1: Create 5 counter + 10 lifeguard employees in region 1
  const counterNames = [
    { name: "蔡佩琪", code: "CT001" },
    { name: "鄭雅文", code: "CT002" },
    { name: "陳怡君", code: "CT003" },
    { name: "劉宛如", code: "CT004" },
    { name: "黃詩涵", code: "CT005" },
  ];

  const lifeguardNames = [
    { name: "張皓翔", code: "LG001" },
    { name: "林冠廷", code: "LG002" },
    { name: "吳承恩", code: "LG003" },
    { name: "陳柏翰", code: "LG004" },
    { name: "李宗翰", code: "LG005" },
    { name: "楊鎮宇", code: "LG006" },
    { name: "許育誠", code: "LG007" },
    { name: "蔡宗霖", code: "LG008" },
    { name: "鄭凱文", code: "LG009" },
    { name: "洪建志", code: "LG010" },
  ];

  // Delete old test employees and any existing shifts in Feb
  await db.delete(shifts).where(
    and(gte(shifts.date, "2026-02-01"), lte(shifts.date, "2026-02-28"))
  );
  console.log("已清除 2 月所有班表");

  // Delete existing schedule slots for Feb
  await db.delete(scheduleSlots).where(
    and(gte(scheduleSlots.date, "2026-02-01"), lte(scheduleSlots.date, "2026-02-28"))
  );
  console.log("已清除 2 月所有排班需求");

  // Insert counter employees
  const counterIds: number[] = [];
  for (const c of counterNames) {
    const existing = await db.select().from(employees).where(eq(employees.employeeCode, c.code));
    if (existing.length > 0) {
      counterIds.push(existing[0].id);
      console.log(`櫃檯 ${c.name} (${c.code}) 已存在, id=${existing[0].id}`);
    } else {
      const [emp] = await db.insert(employees).values({
        name: c.name,
        employeeCode: c.code,
        phone: `09${Math.floor(10000000 + Math.random() * 90000000)}`,
        email: `${c.code.toLowerCase()}@example.com`,
        regionId: 1,
        status: "active",
        role: "counter",
      }).returning();
      counterIds.push(emp.id);
      console.log(`✅ 新增櫃檯 ${c.name} (${c.code}), id=${emp.id}`);
    }
  }

  // Insert lifeguard employees
  const lifeguardIds: number[] = [];
  for (const lg of lifeguardNames) {
    const existing = await db.select().from(employees).where(eq(employees.employeeCode, lg.code));
    if (existing.length > 0) {
      lifeguardIds.push(existing[0].id);
      console.log(`救生 ${lg.name} (${lg.code}) 已存在, id=${existing[0].id}`);
    } else {
      const [emp] = await db.insert(employees).values({
        name: lg.name,
        employeeCode: lg.code,
        phone: `09${Math.floor(10000000 + Math.random() * 90000000)}`,
        email: `${lg.code.toLowerCase()}@example.com`,
        regionId: 1,
        status: "active",
        role: "lifeguard",
      }).returning();
      lifeguardIds.push(emp.id);
      console.log(`✅ 新增救生 ${lg.name} (${lg.code}), id=${emp.id}`);
    }
  }

  console.log(`\n櫃檯 IDs: ${counterIds}`);
  console.log(`救生 IDs: ${lifeguardIds}`);

  // Step 2: Create schedule slots for Feb 2026
  // Venues: 1=三重商工, 2=新北高中, 3=三民高中
  // Slot structure per venue:
  // 三重商工: 早班 06:00-14:00, 晚班 14:00-22:00
  // 新北高中: 早班 05:30-14:00, 晚班 14:00-22:30
  // 三民高中: 早班 07:00-15:00, 晚班 15:00-22:00

  interface SlotDef {
    venueId: number;
    startTime: string;
    endTime: string;
    role: string;
    weekdayCount: number;
    weekendCount: number;
  }

  const slotDefs: SlotDef[] = [
    // 三重商工 (venue 1)
    { venueId: 1, startTime: "06:00", endTime: "14:00", role: "救生", weekdayCount: 2, weekendCount: 3 },
    { venueId: 1, startTime: "06:00", endTime: "14:00", role: "櫃檯", weekdayCount: 1, weekendCount: 1 },
    { venueId: 1, startTime: "14:00", endTime: "22:00", role: "救生", weekdayCount: 2, weekendCount: 2 },
    { venueId: 1, startTime: "14:00", endTime: "22:00", role: "櫃檯", weekdayCount: 1, weekendCount: 1 },
    // 新北高中 (venue 2)
    { venueId: 2, startTime: "05:30", endTime: "14:00", role: "救生", weekdayCount: 2, weekendCount: 3 },
    { venueId: 2, startTime: "05:30", endTime: "14:00", role: "櫃檯", weekdayCount: 1, weekendCount: 1 },
    { venueId: 2, startTime: "14:00", endTime: "22:30", role: "救生", weekdayCount: 2, weekendCount: 2 },
    { venueId: 2, startTime: "14:00", endTime: "22:30", role: "櫃檯", weekdayCount: 1, weekendCount: 1 },
    // 三民高中 (venue 3)
    { venueId: 3, startTime: "07:00", endTime: "15:00", role: "救生", weekdayCount: 1, weekendCount: 2 },
    { venueId: 3, startTime: "07:00", endTime: "15:00", role: "櫃檯", weekdayCount: 1, weekendCount: 1 },
    { venueId: 3, startTime: "15:00", endTime: "22:00", role: "救生", weekdayCount: 1, weekendCount: 1 },
    { venueId: 3, startTime: "15:00", endTime: "22:00", role: "櫃檯", weekdayCount: 0, weekendCount: 1 },
  ];

  const slotsToInsert: any[] = [];
  for (let day = 1; day <= 28; day++) {
    const dateStr = `2026-02-${String(day).padStart(2, "0")}`;
    const dow = new Date(dateStr).getDay(); // 0=Sun, 6=Sat
    const isWeekend = dow === 0 || dow === 6;

    for (const sd of slotDefs) {
      const count = isWeekend ? sd.weekendCount : sd.weekdayCount;
      if (count > 0) {
        slotsToInsert.push({
          venueId: sd.venueId,
          date: dateStr,
          startTime: sd.startTime,
          endTime: sd.endTime,
          role: sd.role,
          requiredCount: count,
        });
      }
    }
  }

  // Batch insert slots
  for (let i = 0; i < slotsToInsert.length; i += 50) {
    const batch = slotsToInsert.slice(i, i + 50);
    await db.insert(scheduleSlots).values(batch);
  }
  console.log(`\n✅ 建立 ${slotsToInsert.length} 個排班需求 (schedule slots)`);

  // Step 3: Assign shifts - rotate employees across venues/shifts
  // Strategy:
  //   - Each employee works ~22 days/month (weekdays + some weekends), gets ~6 days off
  //   - Counter staff rotate across venue counter slots
  //   - Lifeguard staff rotate across venue lifeguard slots
  //   - Respect: max 8 hours/shift, at least 1 rest day per 7 days

  // Build daily slot requirements
  interface DailySlot {
    date: string;
    venueId: number;
    startTime: string;
    endTime: string;
    role: string;
    count: number;
  }

  const dailySlots: DailySlot[] = slotsToInsert.map(s => ({
    date: s.date,
    venueId: s.venueId,
    startTime: s.startTime,
    endTime: s.endTime,
    role: s.role,
    count: s.requiredCount,
  }));

  // Track employee assignments: empId -> Set of dates worked
  const empDays = new Map<number, Set<string>>();
  [...counterIds, ...lifeguardIds].forEach(id => empDays.set(id, new Set()));

  // Track consecutive work days for rest day enforcement
  const empConsecutive = new Map<number, number>();
  [...counterIds, ...lifeguardIds].forEach(id => empConsecutive.set(id, 0));

  // Track if employee already has a shift on a given date
  const empDateShift = new Map<string, boolean>(); // "empId-date" -> has shift
  function empDateKey(empId: number, date: string) { return `${empId}-${date}`; }

  // Sort daily slots by date for sequential assignment
  dailySlots.sort((a, b) => a.date.localeCompare(b.date) || a.venueId - b.venueId || a.startTime.localeCompare(b.startTime));

  const shiftsToInsert: any[] = [];

  // Counter rotation index
  let counterIdx = 0;
  // Lifeguard rotation index
  let lifeguardIdx = 0;

  // Rest day pattern: every employee gets day off every 6-7 days
  // Pre-compute rest days for each employee
  const restDays = new Map<number, Set<string>>();
  [...counterIds, ...lifeguardIds].forEach((id, idx) => {
    const rests = new Set<string>();
    // Stagger rest days: each employee gets different rest days
    // Give 1 rest day per week, staggered by employee index
    for (let day = 1; day <= 28; day++) {
      const dateStr = `2026-02-${String(day).padStart(2, "0")}`;
      // Each employee rests on a different day of the week, cycling
      const dayOfWeek = new Date(dateStr).getDay();
      // Stagger: employee idx % 7 determines their rest day of week
      // But also add extra rest days to reach ~6 days off
      const restDow = idx % 7;
      const restDow2 = (idx + 3) % 7;
      if (dayOfWeek === restDow || (day > 14 && dayOfWeek === restDow2)) {
        rests.add(dateStr);
      }
    }
    restDays.set(id, rests);
  });

  // Process each date
  const allDates: string[] = [];
  for (let day = 1; day <= 28; day++) {
    allDates.push(`2026-02-${String(day).padStart(2, "0")}`);
  }

  for (const date of allDates) {
    const dateSlots = dailySlots.filter(s => s.date === date);

    // Separate counter and lifeguard slots
    const counterSlots = dateSlots.filter(s => s.role === "櫃檯");
    const lifeguardSlots = dateSlots.filter(s => s.role === "救生");

    // Assign counter staff
    for (const slot of counterSlots) {
      for (let i = 0; i < slot.count; i++) {
        // Find next available counter employee
        let assigned = false;
        for (let attempt = 0; attempt < counterIds.length; attempt++) {
          const empId = counterIds[counterIdx % counterIds.length];
          counterIdx++;

          // Check rest day
          if (restDays.get(empId)?.has(date)) continue;
          // Check if already assigned today
          if (empDateShift.get(empDateKey(empId, date))) continue;

          shiftsToInsert.push({
            employeeId: empId,
            venueId: slot.venueId,
            date,
            startTime: slot.startTime,
            endTime: slot.endTime,
            isDispatch: false,
          });
          empDateShift.set(empDateKey(empId, date), true);
          empDays.get(empId)!.add(date);
          assigned = true;
          break;
        }
        if (!assigned) {
          // Fallback: assign any available counter
          for (const empId of counterIds) {
            if (!empDateShift.get(empDateKey(empId, date)) && !restDays.get(empId)?.has(date)) {
              shiftsToInsert.push({
                employeeId: empId,
                venueId: slot.venueId,
                date,
                startTime: slot.startTime,
                endTime: slot.endTime,
                isDispatch: false,
              });
              empDateShift.set(empDateKey(empId, date), true);
              empDays.get(empId)!.add(date);
              break;
            }
          }
        }
      }
    }

    // Assign lifeguard staff
    for (const slot of lifeguardSlots) {
      for (let i = 0; i < slot.count; i++) {
        let assigned = false;
        for (let attempt = 0; attempt < lifeguardIds.length; attempt++) {
          const empId = lifeguardIds[lifeguardIdx % lifeguardIds.length];
          lifeguardIdx++;

          if (restDays.get(empId)?.has(date)) continue;
          if (empDateShift.get(empDateKey(empId, date))) continue;

          shiftsToInsert.push({
            employeeId: empId,
            venueId: slot.venueId,
            date,
            startTime: slot.startTime,
            endTime: slot.endTime,
            isDispatch: false,
          });
          empDateShift.set(empDateKey(empId, date), true);
          empDays.get(empId)!.add(date);
          assigned = true;
          break;
        }
        if (!assigned) {
          for (const empId of lifeguardIds) {
            if (!empDateShift.get(empDateKey(empId, date)) && !restDays.get(empId)?.has(date)) {
              shiftsToInsert.push({
                employeeId: empId,
                venueId: slot.venueId,
                date,
                startTime: slot.startTime,
                endTime: slot.endTime,
                isDispatch: false,
              });
              empDateShift.set(empDateKey(empId, date), true);
              empDays.get(empId)!.add(date);
              break;
            }
          }
        }
      }
    }
  }

  // Batch insert shifts
  for (let i = 0; i < shiftsToInsert.length; i += 50) {
    const batch = shiftsToInsert.slice(i, i + 50);
    await db.insert(shifts).values(batch);
  }
  console.log(`✅ 建立 ${shiftsToInsert.length} 個班表 (shifts)`);

  // Summary
  console.log("\n=== 排班統計 ===");
  console.log("櫃檯員工出勤天數:");
  for (const id of counterIds) {
    const days = empDays.get(id)!;
    const emp = await db.select().from(employees).where(eq(employees.id, id));
    console.log(`  ${emp[0].name} (${emp[0].employeeCode}): ${days.size} 天`);
  }
  console.log("救生員工出勤天數:");
  for (const id of lifeguardIds) {
    const days = empDays.get(id)!;
    const emp = await db.select().from(employees).where(eq(employees.id, id));
    console.log(`  ${emp[0].name} (${emp[0].employeeCode}): ${days.size} 天`);
  }

  console.log("\n=== 完成！===");
  process.exit(0);
}

seedFebSchedule().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
