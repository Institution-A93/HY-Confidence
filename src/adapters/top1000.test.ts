// Pure-logic test for the top-1000 name matcher. The data file (src/data/top1000.ts) is a
// quarterly snapshot and may be empty between refreshes, so we test the matcher against a fixture
// list — it must match on the normalized canonical name (legal form / «» / case-insensitive) and
// return the published 1-based rank.
import { describe, it, expect } from "vitest";
import { top1000Rank } from "./top1000";

describe("top1000Rank", () => {
  // Synthetic fixtures (NOT real list members) — just exercise the normalization + rank logic.
  const list = ["«Թեստ Ալֆա» ՍՊԸ", "Բետա Կորպ ՓԲԸ", "«Գամմա Հոլդինգ»"];

  it("matches ignoring legal form, « », and case, returning the 1-based rank", () => {
    expect(top1000Rank("ԹԵՍՏ ԱԼՖԱ", list)).toBe(1); // no «», no ՍՊԸ, upper vs title
    expect(top1000Rank("«Բետա Կորպ» ՍՊԸ", list)).toBe(2); // different legal form, still the same entity name
    expect(top1000Rank("Գամմա Հոլդինգ", list)).toBe(3);
  });

  it("returns null for a non-member and for empty input", () => {
    expect(top1000Rank("«Ուրիշ Ընկերություն» ՍՊԸ", list)).toBeNull();
    expect(top1000Rank("", list)).toBeNull();
    expect(top1000Rank("Թեստ Ալֆա", [])).toBeNull(); // empty snapshot → no match (safe no-op)
  });
});
