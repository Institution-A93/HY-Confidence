import { describe, it, expect } from "vitest";
import { normalizeTin, isValidTinFormat, tinStatus, checkDigit } from "./tin";

describe("TIN format validation", () => {
  it("accepts the fixtures' 8-digit TINs", () => {
    for (const tin of ["01857342", "04219876", "09134527", "06778215"]) {
      expect(isValidTinFormat(tin)).toBe(true);
    }
  });

  it("strips separators before validating", () => {
    expect(normalizeTin("0185 7342")).toBe("01857342");
    expect(isValidTinFormat("0185-7342")).toBe(true);
  });

  it("rejects wrong length and non-numeric", () => {
    expect(isValidTinFormat("123")).toBe(false);
    expect(isValidTinFormat("123456789")).toBe(false);
    expect(isValidTinFormat("1234567a")).toBe(false);
  });

  it("classifies failure reasons", () => {
    expect(tinStatus("")).toEqual({ ok: false, reason: "empty" });
    expect(tinStatus("abc")).toEqual({ ok: false, reason: "non_numeric" });
    expect(tinStatus("1234")).toEqual({ ok: false, reason: "wrong_length" });
    expect(tinStatus("01857342")).toEqual({ ok: true, tin: "01857342" });
  });

  it("check digit is unverifiable until recon (null, not false)", () => {
    expect(checkDigit("01857342")).toBeNull();
  });
});
