// Pure-logic tests for the e-register owner parser. Live fetches are covered by
// tools/smoke-adapters.ts; here we pin the HTML extraction that turns a BO declaration into
// structured beneficial owners (the part that breaks silently if the page markup drifts).
import { describe, it, expect } from "vitest";
import { extractCompanyId, extractDeclarationLinks, parseDeclaration, ownerNamesFromValue, parseOwnerLine } from "./eregister";

describe("extractCompanyId", () => {
  it("pulls the company id from a search result link", () => {
    expect(extractCompanyId('<a href="/en/companies/37478370">…</a>')).toBe("37478370");
  });
  it("does not partial-match a /declarations/ sub-path", () => {
    // The detail/declaration URL must not yield a truncated id.
    expect(extractCompanyId('<a href="/en/companies/37478370/declarations/2840af03-a56d">x</a>')).toBeNull();
  });
  it("returns null when no company link is present", () => {
    expect(extractCompanyId("<div>no results</div>")).toBeNull();
  });
});

describe("extractDeclarationLinks", () => {
  it("collects unique declaration links", () => {
    const html = `
      <a href="/en/companies/37478370/declarations/2840af03-a56d-4589-a329-c9352a2fd6e8">2026</a>
      <a href="/en/companies/37478370/declarations/41f14906-9773-4177-8b09-de7a06a297b1">2025</a>
      <a href="/en/companies/37478370/declarations/2840af03-a56d-4589-a329-c9352a2fd6e8">dup</a>`;
    expect(extractDeclarationLinks(html)).toHaveLength(2);
  });
});

describe("parseDeclaration", () => {
  // Markup modelled on the real Grand Candy BO declaration (Section B repeats per owner).
  const html = `
    <h1>Owners Declaration</h1><div>Declaration date 14/01/2026</div>
    <h2>Section B</h2><div>Real Owner Personal data</div>
    <span>First name</span> <b>Միքայել</b> <span>Last name</span> <b>Վարդանյան</b>
    <span>Citizenship</span> Հայաստան <span>Date of becoming real owner</span> 11/03/2014
    <p>Base of beneficial ownership 1. … Yes</p><span>Participation size</span> 50 %
    <span>First name</span> Կարեն <span>Last name</span> Վարդանյան
    <span>Citizenship</span> Հայաստան <span>Date of becoming real owner</span> 07/02/2012
    <p>Base of beneficial ownership 1. … Yes</p><span>Participation size</span> 50 %`;

  it("extracts the declaration date and both beneficial owners with shares", () => {
    const { date, owners } = parseDeclaration(html);
    expect(date).toBe("14/01/2026");
    expect(owners).toHaveLength(2);
    expect(owners[0]).toMatchObject({ name: "Միքայել Վարդանյան", citizenship: "Հայաստան", share: "50%", since: "2014" });
    expect(owners[1]).toMatchObject({ name: "Կարեն Վարդանյան", share: "50%", since: "2012" });
  });

  it("returns no owners for a declaration without a Section B", () => {
    expect(parseDeclaration("<div>Declaration date 01/01/2025</div><p>nothing</p>").owners).toHaveLength(0);
  });
});

describe("ownerNamesFromValue (UBO names back out of an F-REG-07 value, for sanctions screening)", () => {
  it("extracts the Armenian names, dropping the Latin paren, share and since-tail", () => {
    const value =
      "Beneficial owners (declared 14/01/2026): Միքայել Վարդանյան (Mikayel Vardanyan) 50%, since 2014; Կարեն Վարդանյան (Karen Vardanyan) 50%, since 2012";
    expect(ownerNamesFromValue(value)).toEqual(["Միքայել Վարդանյան", "Կարեն Վարդանյան"]);
  });
  it("handles a missing share (—) and a missing transliteration paren", () => {
    const value = "Beneficial owners (declared 01/01/2025): Անի Հակոբյան —; Արամ Պետրոսյան 100%, since 2020";
    expect(ownerNamesFromValue(value)).toEqual(["Անի Հակոբյան", "Արամ Պետրոսյան"]);
  });
});

describe("parseOwnerLine (split an F-REG-07 value for localization; owner display stays verbatim)", () => {
  it("splits the declaration date and per-owner display + since-year", () => {
    const v = "Beneficial owners (declared 19/02/2026): Դավիթ Սուքիասյան (davit suqiasyan) 100%, since 2010";
    expect(parseOwnerLine(v)).toEqual({
      date: "19/02/2026",
      owners: [{ who: "Դավիթ Սուքիասյան (davit suqiasyan) 100%", since: "2010" }],
    });
  });
  it("handles multiple owners and a missing since-year", () => {
    const v = "Beneficial owners (declared 14/01/2026): Միքայել Վարդանյան 50%, since 2014; Կարեն Վարդանյան 50%";
    expect(parseOwnerLine(v)).toEqual({
      date: "14/01/2026",
      owners: [
        { who: "Միքայել Վարդանյան 50%", since: "2014" },
        { who: "Կարեն Վարդանյան 50%", since: "" },
      ],
    });
  });
});
