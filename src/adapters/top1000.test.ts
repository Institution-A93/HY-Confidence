// Pure-logic test for the top-1000 TIN matcher. The data file (src/data/top1000.ts) is a quarterly
// snapshot and may be empty between refreshes, so we test the matcher against a fixture list — it
// must return the published 1-based rank for a member TIN and null otherwise.
import { describe, it, expect } from "vitest";
import { top1000Rank } from "./top1000";

describe("top1000Rank", () => {
  const tins = ["01850138", "02216066", "09400818"]; // synthetic order, rank = index + 1

  it("returns the 1-based rank of a member TIN", () => {
    expect(top1000Rank("01850138", tins)).toBe(1);
    expect(top1000Rank("09400818", tins)).toBe(3);
  });

  it("returns null for a non-member, empty TIN, and empty snapshot", () => {
    expect(top1000Rank("99999999", tins)).toBeNull();
    expect(top1000Rank("", tins)).toBeNull();
    expect(top1000Rank("01850138", [])).toBeNull(); // empty snapshot → safe no-op
  });
});
