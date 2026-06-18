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

// The three fixtures whose authored numbers follow the spec exactly. spawn-hrazdan is
// handled separately because the fixture lists R-08 as fired but did not apply the ×0.7
// to WP-07's weight — see the dedicated test below.
const EXACT = ["green-araks", "red-vanand", "yellow-sevan"];

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

describe("spawn-hrazdan: engine is spec-correct where the fixture is loose", () => {
  const f = fixtureById("spawn-hrazdan")!;
  const v = f.verdict!;
  const r = computeVerdict(inputFor(f));

  it("state, tier_map and band_blur still match the fixture", () => {
    expect(r.state).toBe(v.state);
    expect(r.tier_map).toEqual(v.tier_map); // same band despite the score delta
    expect(r.band_blur).toBe(v.band_blur);
  });

  // FINDING: the fixture lists R-08 as fired but left WP-07 at weight 2 (its evidence
  // s03 is a fuzzy registry fact, so R-08 should damp it ×0.7 → 1.4). The engine applies
  // the rule, yielding score −0.6 (→ −1) instead of the fixture's 0. The tier band is the
  // same (−5…+8), so nothing visual changes — but the fixture's number is internally
  // inconsistent. Flagged for the user to reconcile in demo-fixtures.json.
  it("applies R-08 to WP-07 (which the fixture did not)", () => {
    expect(r.rulesFired).toContain("R-08");
    expect(r.signals.find((s) => s.id === "WP-07")!.weight_effective).toBe(1.4);
    expect(r.score).toBe(-1);
    expect(v.score).toBe(0); // the fixture's authored, un-damped value
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
