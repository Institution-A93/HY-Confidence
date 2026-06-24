import { describe, it, expect } from "vitest";
import { formatChecked, checkedAtOf } from "./components";
import type { Fixture } from "./types";

describe("formatChecked", () => {
  it("renders an ISO stamp's own wall-clock as '10 Jun 2026, 14:21' (no tz conversion)", () => {
    expect(formatChecked("2026-06-10T14:21:29+04:00", "en")).toBe("10 Jun 2026, 14:21");
    expect(formatChecked("2026-06-24T09:05:00Z", "en")).toBe("24 Jun 2026, 09:05");
  });
  it("localizes the month abbreviation", () => {
    expect(formatChecked("2026-06-10T14:30:00+04:00", "ru")).toBe("10 июн 2026, 14:30");
    expect(formatChecked("2026-01-03T08:00:00+04:00", "hy")).toBe("3 հնվ 2026, 08:00");
  });
  it("returns empty on an unparseable input", () => {
    expect(formatChecked("")).toBe("");
    expect(formatChecked("not-a-date")).toBe("");
  });
});

describe("checkedAtOf", () => {
  const fx = (over: Partial<Fixture>) => over as unknown as Fixture;

  it("prefers the backend-stamped verdict.checked_at", () => {
    expect(checkedAtOf(fx({ verdict: { checked_at: "2026-06-24T10:00:00Z" } as Fixture["verdict"] }))).toBe(
      "2026-06-24T10:00:00Z",
    );
  });
  it("falls back to the most recent fact's fetched_at", () => {
    const facts = [
      { fetched_at: "2026-06-10T14:21:03+04:00" },
      { fetched_at: "2026-06-10T14:21:29+04:00" },
      { fetched_at: "2026-06-10T14:21:14+04:00" },
    ] as Fixture["facts"];
    expect(checkedAtOf(fx({ facts }))).toBe("2026-06-10T14:21:29+04:00");
  });
  it("falls back to a non-empty 'now' when there is nothing to derive from", () => {
    expect(checkedAtOf(fx({ facts: [] }))).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
