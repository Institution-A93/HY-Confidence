// Pure-logic tests for the datalex adapter. Network calls (getSession/gridSearch) are covered
// by tools/smoke-adapters.ts against the live portal; the deterministic suite tests only the
// parsing helpers that turn grid rows into the recency signal.
import { describe, it, expect } from "vitest";
import { mostRecentCaseYear, caseUrl } from "./datalex";

describe("mostRecentCaseYear", () => {
  it("parses the 2-digit year suffix of Armenian case numbers", () => {
    expect(mostRecentCaseYear([{ case_number: "ԵԴ/0254/02/26" }])).toBe(2026);
    expect(mostRecentCaseYear([{ case_number: "ՍնԴ/1818/04/24" }])).toBe(2024);
  });

  it("returns the most recent year across a page of rows", () => {
    expect(
      mostRecentCaseYear([
        { case_number: "ԵԴ/0001/02/19" },
        { case_number: "ԵԴ/0002/02/26" },
        { case_number: "ԵԴ/0003/02/22" },
      ]),
    ).toBe(2026);
  });

  it("returns null when no case number carries a parseable year (caller declines the recency rule)", () => {
    expect(mostRecentCaseYear([])).toBeNull();
    expect(mostRecentCaseYear([{ case_number: "" }, { case_number: "no-year-here" }])).toBeNull();
  });
});

describe("caseUrl", () => {
  it("builds a replayable case link from the external id", () => {
    expect(caseUrl({ case_external_id: "27303072741163068" })).toBe(
      "https://datalex.am/?app=AppCaseSearch&case_id=27303072741163068",
    );
  });

  it("falls back to the search page when there is no row/id", () => {
    expect(caseUrl(undefined)).toBe("https://datalex.am/?app=AppCaseSearch");
    expect(caseUrl({})).toBe("https://datalex.am/?app=AppCaseSearch");
  });
});
