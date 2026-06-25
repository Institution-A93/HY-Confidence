// Pure-logic tests for the datalex adapter. Network calls (getSession/gridSearch) are covered
// by tools/smoke-adapters.ts against the live portal; the deterministic suite tests only the
// parsing helpers that turn grid rows into the recency signal.
import { describe, it, expect } from "vitest";
import { mostRecentCaseYear, caseUrl, nameKey, partyMatchesQuery, isSoleParty, parseClaimAmount, parseBankruptcyOutcome } from "./datalex";

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

describe("isSoleParty (bankruptcy debtor = sole respondant only)", () => {
  const ineco = nameKey("Ինեկոբանկ");
  it("accepts the entity when it is the only respondant (a genuine debtor)", () => {
    expect(isSoleParty("«Ինեկոբանկ» ՓԲԸ", ineco)).toBe(true);
  });
  it("REJECTS the entity when it is one of several co-respondents (a creditor bank, not the bankrupt)", () => {
    // real case ԱՐԴ/0046/04/18: an individual's petition naming every creditor bank as a co-respondent.
    const field = "«Յունիբանկ» ԲԲԸ, «Ինեկոբանկ» ՓԲԸ, «Հայէկոնոմբանկ» ԲԲԸ, «ՎՏԲ Հայաստան բանկ» ՓԲԸ, «Գուդկրեդիտ» ՈւՎԿ ՓԲԸ";
    expect(isSoleParty(field, ineco)).toBe(false);
    // ...whereas the loose guard would have wrongly matched it → false "debtor in bankruptcy"
    expect(partyMatchesQuery(field, ineco)).toBe(true);
  });
});

describe("parseClaimAmount (demanded sum from the petitum)", () => {
  it("payment order: amount before «դրամ», no verb", () => {
    expect(parseClaimAmount("945.274 դրամի պ/մ")).toBe("945.274 AMD"); // .274 is a 3-digit group → kept
  });
  it("civil: first sum after «բռնագանձել», drops a 2-digit lumas tail", () => {
    expect(parseClaimAmount("...բռնագանձել 15871536.20 /տասնհինգ միլիոն.../ ՀՀ դրամ, ինչպես նաև")).toBe("15871536 AMD");
    expect(parseClaimAmount("հօգուտ Բանկի բռնագանձել 18,836,876,70 ՀՀ դրամ, որից")).toBe("18,836,876 AMD");
  });
  it("takes the principal (first after the verb), not later interest/penalty figures", () => {
    expect(parseClaimAmount("ԽՆԴՐՈՒՄ ԵՆՔ բռնագանձել ընդհանուր 2,518,180.80 (երկու միլիոն ... դրամ) ՀՀ դրամ և 26,034.68 ԱՄՆ դոլար")).toBe("2,518,180 AMD");
  });
  it("handles space-separated thousands as one number (not the trailing group)", () => {
    expect(parseClaimAmount("բռնագանձել 10 000 000 ՀՀ դրամ")).toBe("10 000 000 AMD");
    expect(parseClaimAmount("բռնագանձել 5 000 000.50 ՀՀ դրամ")).toBe("5 000 000 AMD");
  });
  it("USD claims are labelled USD", () => {
    expect(parseClaimAmount("բռնագանձել 26,034.68 ԱՄՆ դոլար")).toBe("26,034 USD");
  });
  it("skips law-article numbers before the verb", () => {
    expect(parseClaimAmount("ղեկավարվելով 120-122-րդ հոդվածներով բռնագանձել 15871536.20 ՀՀ դրամ")).toBe("15871536 AMD");
  });
  it("skips a masked card/account number ('…7001 դրամային') and takes the real « ՀՀ դրամ» amount", () => {
    const claim =
      "Խնդրում եմ ... բռնագանձել 1. Թիվ 20501******7001 դրամային քարտային հաշվին ձևավորված գերածախսի գումարը՝ 195,420.69 ՀՀ դրամ";
    expect(parseClaimAmount(claim)).toBe("195,420 AMD");
  });
  it("returns empty when there is no monetary demand (e.g. an executive-writ request)", () => {
    expect(parseClaimAmount("խնդրում ենք տրամադրել կատարողական թերթ")).toBe("");
    expect(parseClaimAmount("")).toBe("");
  });
  it("drops a sub-threshold figure (<100k AMD: fee / fragment / too-small-to-matter)", () => {
    // real Apaven plaintiff petitum (no «բռնագանձ» verb) scanned from start → a stray "150 դրամ".
    expect(parseClaimAmount("ղեկավարվելով ՀՀ ... 120-122-րդ հոդվածների դրույթներով ԽՆԴՐՈՒՄ ԵՆՔ ... 150 ՀՀ դրամ")).toBe("");
    expect(parseClaimAmount("բռնագանձել 50 000 ՀՀ դրամ")).toBe(""); // below the 100k AMD floor (~$250)
    expect(parseClaimAmount("բռնագանձել 150 000 ՀՀ դրամ")).toBe("150 000 AMD"); // above the floor — kept
  });
});

describe("parseBankruptcyOutcome (operative verdict only)", () => {
  it("reads a rejected declare-bankrupt petition from the merits verdict", () => {
    // real shape: Araratcement — a creditor's petition to bankrupt it was rejected.
    expect(parseBankruptcyOutcome("Վ Ճ Ռ Ե Ց դիմումը՝ «Արարատցեմենտ» սնանկ ճանաչելու պահանջի մասին, մերժել:")).toBe("rejected");
  });
  it("reads a granted (declared bankrupt) verdict", () => {
    expect(parseBankruptcyOutcome("Վ Ճ Ռ Ե Ց «X» ՍՊԸ-ն սնանկ ճանաչել, կառավարիչ նշանակել:")).toBe("declared");
  });
  it("ignores procedural ՈՐՈՇԵՑ rulings (admit-to-proceedings is not a verdict)", () => {
    expect(parseBankruptcyOutcome("ՈՐՈՇԵՑԻ դիմումն ընդդեմ «X»՝ սնանկ ճանաչելու պահանջի մասին, ընդունել վարույթ:")).toBe("unknown");
  });
  it("returns unknown when there is no bankruptcy verdict", () => {
    expect(parseBankruptcyOutcome("some case text without a verdict")).toBe("unknown");
    expect(parseBankruptcyOutcome("")).toBe("unknown");
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
