// Pure-logic test for the enforcement adapter. The 3-step token/captcha/POST network flow is
// covered by tools/smoke-adapters.ts against the live cabinet.harkadir.am; this suite tests only
// the antiforgery-token extraction (the rest is HTTP + JSON the smoke validates).
import { describe, it, expect } from "vitest";
import { extractToken, debtorProceedings } from "./enforcement";
import { enforcementWeight } from "../scoring/weights";

describe("extractToken", () => {
  it("pulls the ASP.NET antiforgery token from the hidden input", () => {
    const html = `<form><input name="__RequestVerificationToken" type="hidden" value="CfDJ8G_ZuAbC-123_xyz" /></form>`;
    expect(extractToken(html)).toBe("CfDJ8G_ZuAbC-123_xyz");
  });

  it("returns '' when no token is present (caller then errors out, not silently empties)", () => {
    expect(extractToken("<form></form>")).toBe("");
  });
});

describe("debtorProceedings role filter", () => {
  // Inecobank's real REMS: one where IT is the plaintiff (its own collection) + one genuine debt.
  const rems = [
    { PLAINTIFFNAME: "ԻՆԵԿՈԲԱՆԿ ՓԲԸ ՓԲԸ", INQUESTAMOUNT: 10800489 },
    { PLAINTIFFNAME: "Արտաշատ համայնքի ղեկավար ՀՄ", INQUESTAMOUNT: 923898 },
  ];
  it("drops proceedings where the entity is the plaintiff (creditor), keeps genuine debtor ones", () => {
    const kept = debtorProceedings(rems, "ԻՆԵԿՈԲԱՆԿ"); // legal-form suffix differences don't matter
    expect(kept).toHaveLength(1);
    expect(kept[0].PLAINTIFFNAME).toContain("Արտաշատ");
  });
  it("keeps everything when there is no name to compare (never silently drops debt)", () => {
    expect(debtorProceedings(rems, "")).toHaveLength(2);
  });
});

describe("enforcementWeight (SN-11 scaling)", () => {
  it("scales by total claimed amount and proceeding count", () => {
    expect(enforcementWeight(923_898, 1)).toBe(-8); // Inecobank: minor → caution, not veto
    expect(enforcementWeight(10_000_000, 1)).toBe(-12); // ≥5M
    expect(enforcementWeight(80_000_000, 1)).toBe(-15); // ≥50M
    expect(enforcementWeight(100_000, 5)).toBe(-15); // many proceedings
    expect(enforcementWeight(100_000, 3)).toBe(-12);
  });
});
