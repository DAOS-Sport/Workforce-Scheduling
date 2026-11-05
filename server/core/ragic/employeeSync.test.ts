import { describe, expect, it } from "vitest";
import type { Employee } from "@shared/schema";
import { SnapshotRejected, assertSnapshotComplete, planEmployeeSync, type ImpliedStatus } from "./employeeSync";

const isValidLineId = (id: string) => /^U[0-9a-f]{32}$/.test(id);
const VALID_LINE = "U" + "a".repeat(32);

function employee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 1,
    name: "虛構員工",
    employeeCode: "E001",
    phone: "0900000001",
    email: "e001@example.invalid",
    lineId: null,
    regionId: 1,
    status: "active",
    role: "救生",
    employmentType: "part_time",
    isAdmin: false,
    department: "新北高中",
    isException: false,
    ...overrides,
  } as Employee;
}

function ragicRecord(overrides: Record<string, unknown> = {}) {
  return {
    姓名: "虛構員工",
    員工編號: "E001",
    部門: ["新北高中"],
    應徵職務: ["救生員"],
    聘雇類別: "兼職",
    在職狀態: "在職",
    手機: "0900000001",
    電子郵件信箱: "e001@example.invalid",
    "個人LINE ID": "",
    ...overrides,
  };
}

const snapshot = (...records: Array<Record<string, unknown>>) => Object.fromEntries(records.map((r, i) => [String(i + 1), r]));

function plan(records: Record<string, unknown>, locals: Employee[] = [], observed: Array<[string, ImpliedStatus]> = []) {
  return planEmployeeSync({ records, locals, regionIdByCode: new Map([["A", 1]]), observed: new Map(observed), isValidLineId });
}

describe("planEmployeeSync", () => {
  it("deactivates an existing active employee when H01 marks the employee inactive", () => {
    const p = plan(snapshot(ragicRecord({ 在職狀態: "離職" })), [employee()]);

    expect([p.updated, p.deactivated]).toEqual([1, 1]);
    expect(p.ops).toEqual([{ kind: "update", id: 1, employeeCode: "E001", data: { status: "inactive" }, reason: "ragic" }]);
  });

  it("deactivates active synced-role employees that H01 no longer lists, and only those", () => {
    const listed = employee({ id: 1, employeeCode: "E001" });
    const gone = employee({ id: 2, employeeCode: "E999", role: "櫃台" });
    const alreadyInactive = employee({ id: 3, employeeCode: "E998", status: "inactive" });
    const outOfScope = employee({ id: 4, employeeCode: "E997", role: "清潔" });

    const p = plan(snapshot(ragicRecord()), [listed, gone, alreadyInactive, outOfScope]);

    expect([p.updated, p.deactivated]).toEqual([1, 1]);
    expect(p.ops).toEqual([{ kind: "update", id: 2, employeeCode: "E999", data: { status: "inactive" }, reason: "missing" }]);
  });

  it("creates an active coach from H01", () => {
    const p = plan(snapshot(ragicRecord({ 應徵職務: ["教練"] })));

    expect([p.created, p.skipped]).toEqual([1, 0]);
    expect(p.ops[0]).toMatchObject({ kind: "create", data: { employeeCode: "E001", role: "教練", status: "active" } });
  });

  it("deactivates an existing employee whose H01 role is outside the sync scope", () => {
    const p = plan(snapshot(ragicRecord({ 應徵職務: ["清潔人員"] })), [employee()]);

    expect([p.updated, p.deactivated]).toEqual([1, 1]);
    expect(p.ops).toEqual([{ kind: "update", id: 1, employeeCode: "E001", data: { status: "inactive" }, reason: "ragic" }]);
  });

  it("does not count an already inactive employee when H01 is also not active", () => {
    const p = plan(snapshot(ragicRecord({ 在職狀態: "離職" })), [employee({ status: "inactive" })]);

    expect([p.updated, p.deactivated, p.ops]).toEqual([0, 0, []]);
  });

  it("counts an unchanged in-scope employee as updated but writes nothing for it", () => {
    const p = plan(snapshot(ragicRecord()), [employee()]);

    expect([p.updated, p.ops]).toEqual([1, []]);
  });

  it("writes only the fields that differ, and never clears a field Ragic leaves blank", () => {
    const p = plan(snapshot(ragicRecord({ 手機: "0900000002", 電子郵件信箱: "" })), [employee({ email: "old@example.invalid" })]);

    expect(p.ops).toEqual([{ kind: "update", id: 1, employeeCode: "E001", data: { phone: "0900000002" }, reason: "ragic" }]);
  });

  describe("LINE id", () => {
    it("keeps a valid bound id when Ragic carries a value that is not a LINE user id", () => {
      const p = plan(snapshot(ragicRecord({ "個人LINE ID": "not-an-id" })), [employee({ lineId: VALID_LINE })]);

      expect(p.ops).toEqual([]);
    });

    it("takes a valid id from Ragic over a valid bound one, and any id over an invalid one", () => {
      const fromRagic = "U" + "b".repeat(32);
      expect(plan(snapshot(ragicRecord({ "個人LINE ID": fromRagic })), [employee({ lineId: VALID_LINE })]).ops[0]).toMatchObject({ data: { lineId: fromRagic } });
      expect(plan(snapshot(ragicRecord({ "個人LINE ID": "typed-by-hand" })), [employee({ lineId: "old-text" })]).ops[0]).toMatchObject({ data: { lineId: "typed-by-hand" } });
    });
  });

  describe("records that share an employee code", () => {
    it("lets the record with the highest Ragic id decide, and counts the others as skipped", () => {
      const p = plan(snapshot(ragicRecord(), ragicRecord({ 在職狀態: "離職" })), [employee()]);

      expect([p.deactivated, p.skipped, p.skipReasons]).toEqual([1, 1, { 同員工編號有較新的紀錄: 1 }]);
    });
  });

  describe("a record without a name", () => {
    it("is skipped, yet its code still protects the employee from the missing rule", () => {
      const p = plan(snapshot(ragicRecord({ 姓名: "" })), [employee()]);

      expect([p.skipped, p.listedCodeCount, p.ops]).toEqual([1, 1, []]);
    });
  });

  describe("who owns the status", () => {
    it("leaves a manual resignation alone while Ragic still implies what it implied last time", () => {
      const p = plan(snapshot(ragicRecord()), [employee({ status: "inactive" })], [["E001", "active"]]);

      expect(p.ops).toEqual([]);
    });

    it("reactivates when Ragic changed its mind, and when Ragic has not reported on the employee before", () => {
      const reopened = plan(snapshot(ragicRecord()), [employee({ status: "inactive" })], [["E001", "inactive"]]);
      expect(reopened.ops).toEqual([{ kind: "update", id: 1, employeeCode: "E001", data: { status: "active" }, reason: "ragic" }]);
      expect(reopened.observed).toEqual([{ employeeCode: "E001", status: "active" }]);

      const unseen = plan(snapshot(ragicRecord()), [employee({ status: "inactive" })]);
      expect(unseen.ops).toEqual([{ kind: "update", id: 1, employeeCode: "E001", data: { status: "active" }, reason: "ragic" }]);
    });

    it("leaves a manual reinstatement alone while Ragic still says the employee has left", () => {
      const p = plan(snapshot(ragicRecord({ 在職狀態: "離職" })), [employee({ status: "active" })], [["E001", "inactive"]]);

      expect([p.ops, p.deactivated]).toEqual([[], 0]);
    });

    it("stores an observation only when it differs from the one stored", () => {
      expect(plan(snapshot(ragicRecord()), [employee()], [["E001", "active"]]).observed).toEqual([]);
      expect(plan(snapshot(ragicRecord()), [employee()]).observed).toEqual([{ employeeCode: "E001", status: "active" }]);
    });
  });
});

describe("assertSnapshotComplete", () => {
  const locals = (n: number) => Array.from({ length: n }, (_, i) => employee({ id: i + 1, employeeCode: `E${String(i + 1).padStart(3, "0")}` }));
  const listing = (n: number) => snapshot(...locals(n).map((e) => ragicRecord({ 員工編號: e.employeeCode })));

  it("rejects an empty snapshot and one without a single employee code", () => {
    expect(() => assertSnapshotComplete(plan({}, locals(3)))).toThrow(SnapshotRejected);
    expect(() => assertSnapshotComplete(plan(snapshot(ragicRecord({ 員工編號: "" })), locals(3)))).toThrow(SnapshotRejected);
  });

  it("accepts a short list and plans to deactivate everyone it leaves out, however many that is", () => {
    const p = plan(listing(5), locals(10));

    expect(() => assertSnapshotComplete(p)).not.toThrow();
    expect(p.deactivated).toBe(5);
    expect(p.ops.filter((op) => op.kind === "update" && op.reason === "missing")).toHaveLength(5);
  });
});
