// Pure-logic tests for the datalex adapter. Network calls (getSession/gridSearch) are covered
// by tools/smoke-adapters.ts against the live portal; the deterministic suite tests only the
// parsing helpers that turn grid rows into the recency signal.
import { describe, it, expect } from "vitest";
import { mostRecentCaseYear, caseUrl, nameKey, partyMatchesQuery } from "./datalex";

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

describe("token-containment guard", () => {
  // nameKey strips legal form / «» / case / spacing so the same entity keys identically.
  it("nameKey normalizes form, quotes, case and spacing", () => {
    expect(nameKey("«Ապավեն» ՍՊԸ")).toBe(nameKey("ԱՊԱՎԵՆ"));
    expect(nameKey("ԱՐԱՐԱՏ ՑԵՄԵՆՏ")).toBe(nameKey("<<Արարատցեմենտ>> ՓԲԸ")); // 2 words vs glued
  });

  const apaven = nameKey("ԱՊԱՎԵՆ");
  it("keeps the queried entity (incl. as one of several co-parties)", () => {
    expect(partyMatchesQuery("«Ապավեն» ՍՊԸ", apaven)).toBe(true);
    expect(partyMatchesQuery("Դարֆ ՍՊԸ, Միկմետալ ՓԲԸ, Ապավեն ՍՊԸ, Էյչ-Էս-Բի բանկ", apaven)).toBe(true);
  });
  it("rejects a different, longer name that merely contains the query", () => {
    expect(partyMatchesQuery("«Ապավեն Տերմինալ» ՓԲԸ", apaven)).toBe(false); // Apaven Terminal — different firm
    expect(partyMatchesQuery(",,Հույսի Ապավեն,, ԲՀ", apaven)).toBe(false); // Huysi Apaven — different firm
  });
  it("rejects a same-prefix but different company (Grand Candy vs Grand Tobacco)", () => {
    const gc = nameKey("Գրանդ Քենդի");
    expect(partyMatchesQuery("Գրանդ Քենդի ՍՊԸ", gc)).toBe(true);
    expect(partyMatchesQuery("Գրանդ Տոբակո ՍՊԸ", gc)).toBe(false);
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
