import { describe, expect, it } from "vitest";
import type { Employee } from "@shared/schema";
import { planEmployeeSync } from "./employeeSync";

const CODE = "H02-FIX-001";
const local = {
  id: 71001, employeeCode: CODE, name: "虛構角色甲", role: "行政專員", status: "active",
  regionId: 1, department: "新北高中", employmentType: "part_time", lineId: null,
} as Employee;
const record = (role: unknown, extra = {}) => ({
  員工編號: CODE, 姓名: "虛構角色甲", 應徵職務: role, 部門: "新北高中",
  在職狀態: "在職", 聘雇類別: "兼職", ...extra,
});

function plan(h01: Record<string, unknown>, h02: Record<string, unknown>, employee = local) {
  const input = {
    records: h01, h02Records: h02, locals: [employee], regionIdByCode: new Map([["A", 1]]),
    observed: new Map(), isValidLineId: () => false,
  };
  return planEmployeeSync(input);
}

describe("H02 employee roles", () => {
  it("retains the last valid H01 title when a later duplicate has a blank name and title", () => {
    const p = plan({ "1": record(["教練"]), "2": record([], { 姓名: "" }) }, { "81": record(["主管職"]) });
    expect(p.ops).toEqual([{ kind: "update", id: local.id, employeeCode: CODE, reason: "ragic", data: { role: "教練" } }]);
    expect(p.updated).toBe(1);
  });

  it("keeps a nonblank H01 title ahead of H02, even when H01 has a blank name", () => {
    const p = plan({ "1": record(["主管職"], { 姓名: "" }) }, { "81": record(["資訊工程師"]) });
    expect(p.ops).toEqual([{ kind: "update", id: local.id, employeeCode: CODE, reason: "ragic", data: { role: "主管職" } }]);
    expect(p.updated).toBe(1);
  });

  it("uses H02 by employee code when H01 does not list the employee, without importing other H02 fields", () => {
    const p = plan({}, { "81": record(["主管職"], { 員工編號: ["", ` ${CODE} `], 姓名: "虛構不同姓名", 在職狀態: "離職" }) });
    expect(p.ops).toEqual([{ kind: "update", id: local.id, employeeCode: CODE, reason: "ragic", data: { role: "主管職" } }]);
    expect([p.created, p.updated, p.deactivated, p.observed]).toEqual([0, 1, 0, []]);
  });

  it("uses H02 when the H01 title is blank and preserves H01 status decisions", () => {
    const h01 = { "1": record(["", "　"]) };
    const before = plan(h01, {});
    const p = plan(h01, { "81": record(["資訊工程師"]) });
    expect(p.ops).toEqual([{ ...before.ops[0], data: { status: "inactive", role: "資訊工程師" } }]);
    expect([p.updated, p.deactivated, p.observed]).toEqual([before.updated, before.deactivated, before.observed]);
  });

  it.each([
    [["主管職", "資訊工程師", "行政專員"], "行政專員"],
    [["教練", "行政櫃台", "體育署救生員"], "救生"],
    [["", " 資訊工程師 "], "資訊工程師"],
  ])("maps H02 multiselect %j with the existing H01 priority", (titles, role) => {
    const p = plan({}, { "81": record(titles) }, { ...local, role: "無職" });
    expect(p.ops).toEqual([{ kind: "update", id: local.id, employeeCode: CODE, reason: "ragic", data: { role } }]);
  });

  it("does not clear a role for blank titles, or match by name instead of employee code", () => {
    expect(plan({}, { "81": record(["", "　"]) }).ops).toEqual([]);
    expect(plan({}, { "81": record(["主管職"], { 員工編號: "H02-FIX-OTHER" }) }).ops).toEqual([]);
  });

  it("keeps a nonblank unmapped H01 title from falling back to H02 or clearing the local role", () => {
    const p = plan({ "1": record(["虛構未映射職務"], { 姓名: "" }) }, { "81": record(["主管職"]) });
    expect(p.ops).toEqual([]);
  });

  it("merges the role with a missing update once while retaining the H01 deactivation", () => {
    const p = plan({}, { "81": record(["主管職"]) }, { ...local, role: "教練" });
    expect(p.ops).toEqual([{ kind: "update", id: local.id, employeeCode: CODE, reason: "missing", data: { status: "inactive", role: "主管職" } }]);
    expect([p.updated, p.deactivated]).toEqual([1, 1]);
  });
});
