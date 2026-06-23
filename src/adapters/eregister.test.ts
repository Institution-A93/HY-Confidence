// Pure-logic tests for the e-register owner parser. Live fetches are covered by
// tools/smoke-adapters.ts; here we pin the HTML extraction that turns a BO declaration into
// structured beneficial owners (the part that breaks silently if the page markup drifts).
import { describe, it, expect } from "vitest";
import { extractCompanyId, extractDeclarationLinks, parseDeclaration } from "./eregister";

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
