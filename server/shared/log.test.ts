import { describe, expect, it } from "vitest";
import { maskId } from "./log";

describe("maskId (GitHub #5)", () => {
  it("keeps only the ends of a LINE ID", () => {
    expect(maskId("U1234567890abcdef1234567890abcdef")).toBe("U12…cdef");
    expect(maskId("short")).toBe("***");
    expect(maskId(null)).toBe("none");
  });
});
