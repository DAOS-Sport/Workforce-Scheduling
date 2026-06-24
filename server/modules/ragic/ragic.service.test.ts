import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Employee, Region } from "@shared/schema";

const { mockStorage, mockFetchAllRagicRecords } = vi.hoisted(() => ({
  mockStorage: {
    getRegions: vi.fn(),
    getEmployeeByCode: vi.fn(),
    getAllEmployees: vi.fn(),
    updateEmployee: vi.fn(),
    createEmployee: vi.fn(),
  },
  mockFetchAllRagicRecords: vi.fn(),
}));

vi.mock("../../storage", () => ({
  storage: mockStorage,
}));

vi.mock("./ragicClient", () => ({
  fetchAllRagicRecords: mockFetchAllRagicRecords,
}));

import { syncFromRagic } from "./ragic.service";

function region(overrides: Partial<Region> = {}): Region {
  return {
    id: 1,
    name: "三蘆戰區",
    code: "A",
    ...overrides,
  } as Region;
}

function employee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 1,
    name: "測試員工",
    employeeCode: "E001",
    phone: null,
    email: null,
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
    "姓名": "測試員工",
    "員工編號": "E001",
    "部門": ["新北高中"],
    "應徵職務": ["救生員"],
    "聘雇類別": "兼職",
    "在職狀態": "在職",
    "手機": "0912345678",
    "電子郵件信箱": "test@example.com",
    "個人LINE ID": "",
    ...overrides,
  };
}

describe("syncFromRagic", () => {
  beforeEach(() => {
    process.env.RAGIC_API_KEY = "test-ragic-key";
    vi.clearAllMocks();
    mockStorage.getRegions.mockResolvedValue([region()]);
    mockStorage.getAllEmployees.mockResolvedValue([]);
    mockStorage.updateEmployee.mockImplementation(async (id: number, data: Partial<Employee>) =>
      employee({ id, ...data }),
    );
    mockStorage.createEmployee.mockImplementation(async (data: Partial<Employee>) =>
      employee({ id: 100, ...data }),
    );
  });

  it("counts an existing active employee as deactivated when H01 marks the employee inactive", async () => {
    mockFetchAllRagicRecords.mockResolvedValue({
      "1": ragicRecord({ 在職狀態: "離職" }),
    });
    mockStorage.getEmployeeByCode.mockResolvedValue(employee({ status: "active" }));

    const result = await syncFromRagic();

    expect(result.updated).toBe(1);
    expect(result.deactivated).toBe(1);
    expect(mockStorage.updateEmployee).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ status: "inactive" }),
    );
  });

  it("soft-deactivates active synced-role local employees that no longer exist in H01", async () => {
    const existingInH01 = employee({ id: 1, employeeCode: "E001", role: "救生" });
    const missingFromH01 = employee({ id: 2, employeeCode: "E999", role: "櫃台" });
    const inactiveMissing = employee({ id: 3, employeeCode: "E998", role: "救生", status: "inactive" });
    const outOfScopeMissing = employee({ id: 4, employeeCode: "E997", role: "清潔" });

    mockFetchAllRagicRecords.mockResolvedValue({
      "1": ragicRecord({ 員工編號: "E001" }),
    });
    mockStorage.getEmployeeByCode.mockResolvedValue(existingInH01);
    mockStorage.getAllEmployees.mockResolvedValue([
      existingInH01,
      missingFromH01,
      inactiveMissing,
      outOfScopeMissing,
    ]);

    const result = await syncFromRagic();

    expect(result.updated).toBe(1);
    expect(result.deactivated).toBe(1);
    expect(mockStorage.updateEmployee).toHaveBeenCalledWith(
      missingFromH01.id,
      { status: "inactive" },
    );
    expect(mockStorage.updateEmployee).not.toHaveBeenCalledWith(
      inactiveMissing.id,
      expect.anything(),
    );
    expect(mockStorage.updateEmployee).not.toHaveBeenCalledWith(
      outOfScopeMissing.id,
      expect.anything(),
    );
  });

  it("creates active coach employees from H01", async () => {
    mockFetchAllRagicRecords.mockResolvedValue({
      "1": ragicRecord({ 應徵職務: ["教練"] }),
    });
    mockStorage.getEmployeeByCode.mockResolvedValue(undefined);

    const result = await syncFromRagic();

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
    expect(mockStorage.createEmployee).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeCode: "E001",
        role: "教練",
        status: "active",
      }),
    );
  });

  it("soft-deactivates an existing employee when H01 changes the role outside the sync scope", async () => {
    mockFetchAllRagicRecords.mockResolvedValue({
      "1": ragicRecord({ 應徵職務: ["清潔人員"] }),
    });
    mockStorage.getEmployeeByCode.mockResolvedValue(employee({ id: 1, status: "active", role: "救生" }));

    const result = await syncFromRagic();

    expect(result.updated).toBe(1);
    expect(result.deactivated).toBe(1);
    expect(mockStorage.updateEmployee).toHaveBeenCalledWith(1, { status: "inactive" });
  });

  it("does not count an already inactive employee as updated when H01 is also not active", async () => {
    mockFetchAllRagicRecords.mockResolvedValue({
      "1": ragicRecord({ 在職狀態: "離職" }),
    });
    mockStorage.getEmployeeByCode.mockResolvedValue(employee({ id: 1, status: "inactive" }));

    const result = await syncFromRagic();

    expect(result.updated).toBe(0);
    expect(result.deactivated).toBe(0);
    expect(mockStorage.updateEmployee).not.toHaveBeenCalled();
  });
});
