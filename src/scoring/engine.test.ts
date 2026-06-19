import { describe, it, expect } from "vitest";
import { fixtureById } from "../fixtures";
import { computeVerdict, tierMapFromScore } from "./engine";
import type { EngineInput } from "./engine";
import type { Fixture } from "../types";

function inputFor(f: Fixture): EngineInput {
  return {
    signals: f.signals,
    facts: f.facts,
    coverage: f.verdict!.coverage,
    // registry facts marked fuzzy ⇒ entity was resolved by name, not TIN
    fuzzyResolution: f.facts.some((x) => x.domain === "registry" && x.match === "fuzzy"),
  };
}

// All four fixtures now follow the spec exactly (spawn-hrazdan's WP-07 was reconciled to
// the R-08 ×0.7 damping: weight 2 → 1.4, score → −1).
const EXACT = ["green-araks", "red-vanand", "yellow-sevan", "spawn-hrazdan"];

describe("scoring engine reproduces fixtures", () => {
  for (const id of EXACT) {
    const f = fixtureById(id)!;
    const v = f.verdict!;
    const r = computeVerdict(inputFor(f));

    it(`${id}: state + score + tier_map + band_blur`, () => {
      expect(r.state).toBe(v.state);
      expect(r.score).toBe(v.score);
      expect(r.tier_map).toEqual(v.tier_map);
      expect(r.band_blur).toBe(v.band_blur);
    });

    it(`${id}: per-signal effective weights match`, () => {
      for (const sig of f.signals) {
        const got = r.signals.find((s) => s.id === sig.id)!;
        expect(got.weight_effective).toBe(sig.weight_effective);
      }
    });
  }

  it("green-araks fires R-07 (weak-positive cap)", () => {
    const r = computeVerdict(inputFor(fixtureById("green-araks")!));
    expect(r.rulesFired).toContain("R-07");
  });

  it("red-vanand is BLOCKED by B-03", () => {
    const r = computeVerdict(inputFor(fixtureById("red-vanand")!));
    expect(r.state).toBe("BLOCKED");
    expect(r.blockers).toContain("B-03");
  });

  it("yellow-sevan fires R-01 and halves SN-07 (−8 → −4)", () => {
    const r = computeVerdict(inputFor(fixtureById("yellow-sevan")!));
    expect(r.rulesFired).toContain("R-01");
    expect(r.signals.find((s) => s.id === "SN-07")!.weight_effective).toBe(-4);
  });
});

describe("spawn-hrazdan: R-08 fuzzy damping", () => {
  const r = computeVerdict(inputFor(fixtureById("spawn-hrazdan")!));
  it("fires R-08 and damps WP-07 from 2 to 1.4 (name-matched registry evidence)", () => {
    expect(r.rulesFired).toContain("R-08");
    expect(r.signals.find((s) => s.id === "WP-07")!.weight_effective).toBe(1.4);
    expect(r.score).toBe(-1);
  });
});

describe("tier mapping boundaries", () => {
  it("maps representative scores to the spec table", () => {
    expect(tierMapFromScore(30, false)).toEqual({ T1: "green", T2: "green", T3: "green", T4: "yellow" });
    expect(tierMapFromScore(2, false)).toEqual({ T1: "green", T2: "yellow", T3: "yellow", T4: "red" });
    expect(tierMapFromScore(-28, false)).toEqual({ T1: "red", T2: "red", T3: "red", T4: "red" });
    expect(tierMapFromScore(5, true)).toEqual({ T1: "red", T2: "red", T3: "red", T4: "red" }); // BLOCKED override
  });
});
