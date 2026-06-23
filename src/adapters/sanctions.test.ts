// Pure-logic tests for the OFAC matcher. The live download is covered by tools/smoke-adapters.ts;
// here we pin the strength-based classification that decides strong (block) vs possible (review)
// vs clean — the logic that fixes the substring/dilution false-BLOCKED bugs.
import { describe, it, expect } from "vitest";
import { screenOfac } from "./sanctions";

const PUTIN = "PUTIN, VLADIMIR VLADIMIROVICH";
// Real SDN entry that the old substring matcher false-hit on «Թոփ Ավտո» (TOP+AVTO as substrings).
const TRAILER = "PUBLIC JOINT STOCK COMPANY ZAVOD AVTOMOBILNYKH PRITSEPOV URALAVTOPRITSEP";
const LONG_TRADING = "AL WASEL AND BABEL GENERAL TRADING LLC";
const EXACT_TRADING = "GENERAL TRADING LLC";
const LIST = [PUTIN, TRAILER, LONG_TRADING];

describe("screenOfac", () => {
  it("strong-matches a real person despite OFAC's 'Last, First patronymic' order", () => {
    const r = screenOfac("Vladimir Putin", LIST);
    expect(r.strong).toContain(PUTIN);
    expect(r.possible).toHaveLength(0);
  });

  it("does NOT match «Թոփ Ավտո» — TOP/AVTO are substrings, not whole words (the headline bug)", () => {
    const r = screenOfac("Թոփ Ավտո", LIST);
    expect(r.strong).toHaveLength(0);
    expect(r.possible).toHaveLength(0);
  });

  it("treats two common words buried in a long name as POSSIBLE, never strong", () => {
    const r = screenOfac("General Trading", [LONG_TRADING]);
    expect(r.strong).toHaveLength(0);
    expect(r.possible).toContain(LONG_TRADING);
  });

  it("still strong-matches an essentially identical sanctioned name", () => {
    const r = screenOfac("General Trading", [EXACT_TRADING]);
    expect(r.strong).toContain(EXACT_TRADING);
  });

  it("declines to screen a single-token name (floor: too noisy)", () => {
    expect(screenOfac("Madonna", LIST)).toEqual({ strong: [], possible: [] });
  });
});
