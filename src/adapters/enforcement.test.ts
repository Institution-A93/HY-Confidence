// Pure-logic test for the enforcement adapter. The 3-step token/captcha/POST network flow is
// covered by tools/smoke-adapters.ts against the live cabinet.harkadir.am; this suite tests only
// the antiforgery-token extraction (the rest is HTTP + JSON the smoke validates).
import { describe, it, expect } from "vitest";
import { extractToken } from "./enforcement";

describe("extractToken", () => {
  it("pulls the ASP.NET antiforgery token from the hidden input", () => {
    const html = `<form><input name="__RequestVerificationToken" type="hidden" value="CfDJ8G_ZuAbC-123_xyz" /></form>`;
    expect(extractToken(html)).toBe("CfDJ8G_ZuAbC-123_xyz");
  });

  it("returns '' when no token is present (caller then errors out, not silently empties)", () => {
    expect(extractToken("<form></form>")).toBe("");
  });
});
