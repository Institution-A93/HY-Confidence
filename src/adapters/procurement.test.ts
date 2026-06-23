// Pure-logic tests for the procurement adapter. The two-step armeps PPCM network flow
// (autocomplete → count/list) is covered by tools/smoke-adapters.ts against the live API; this
// suite tests only pickSupplier — the match/confirm logic that decides exact vs fuzzy.
import { describe, it, expect } from "vitest";
import { pickSupplier } from "./procurement";

const LIST = [
  { id: "id-regard", taxpayerId: "02252505", name: "Regard Travel" },
  { id: "id-good", taxpayerId: "00469154", name: "Travel Good" },
  { id: "id-mix", taxpayerId: "02554366", name: "Management Mix LLC" },
];

describe("pickSupplier", () => {
  it("prefers an authoritative TIN match → exact", () => {
    const r = pickSupplier(LIST, { tin: "02554366", name: "anything at all" });
    expect(r?.supplier.id).toBe("id-mix");
    expect(r?.match).toBe("exact");
  });

  it("falls back to a name-key match when no TIN matches → fuzzy", () => {
    const r = pickSupplier(LIST, { name: "Regard Travel" });
    expect(r?.supplier.id).toBe("id-regard");
    expect(r?.match).toBe("fuzzy");
  });

  it("matches by containment either way (registered name carries an extra token)", () => {
    const r = pickSupplier(LIST, { name: "Management Mix" });
    expect(r?.supplier.id).toBe("id-mix");
    expect(r?.match).toBe("fuzzy");
  });

  it("a TIN that is absent from the list falls through to the name match", () => {
    const r = pickSupplier(LIST, { tin: "99999999", name: "Travel Good" });
    expect(r?.supplier.id).toBe("id-good");
    expect(r?.match).toBe("fuzzy"); // TIN did not confirm, so not exact
  });

  it("returns null when nothing plausibly matches", () => {
    expect(pickSupplier(LIST, { name: "Completely Unrelated Co" })).toBeNull();
    expect(pickSupplier([], { tin: "02252505", name: "Regard Travel" })).toBeNull();
  });
});
