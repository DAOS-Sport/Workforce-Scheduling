import { describe, expect, it } from "vitest";
import { pickLineEmployee } from "./lineEmployee";

const emp = (id: number, regionId: number, status = "active") => ({ id, regionId, status });

describe("pickLineEmployee", () => {
  it("returns null when the LINE account has no employee record", () => {
    expect(pickLineEmployee([], 1)).toBeNull();
  });

  it("picks the active record over an older inactive one, whatever the order", () => {
    expect(pickLineEmployee([emp(3, 1, "inactive"), emp(9, 1)], 1)?.employee.id).toBe(9);
    expect(pickLineEmployee([emp(9, 1), emp(3, 1, "inactive")], 1)?.employee.id).toBe(9);
  });

  it("returns the lowest id when every record is inactive, so the caller can report it", () => {
    expect(pickLineEmployee([emp(9, 1, "inactive"), emp(3, 1, "inactive")], 1)).toEqual({ employee: emp(3, 1, "inactive"), fellBack: false });
  });

  it("with several active records picks the one in the venue's region", () => {
    expect(pickLineEmployee([emp(3, 1), emp(9, 2)], 2)).toEqual({ employee: emp(9, 2), fellBack: false });
  });

  it("with several active records and no region match falls back to the lowest id and says so", () => {
    expect(pickLineEmployee([emp(9, 2), emp(3, 1)], 5)).toEqual({ employee: emp(3, 1), fellBack: true });
    expect(pickLineEmployee([emp(9, 2), emp(3, 1)], null)).toEqual({ employee: emp(3, 1), fellBack: true });
  });
});
