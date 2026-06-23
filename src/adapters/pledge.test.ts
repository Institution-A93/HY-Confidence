// Pure-logic tests for the pledge adapter. Network (getSession + advSearch POST) is covered by
// tools/smoke-adapters.ts against the live registration.am; this suite tests only the row parsing
// and the debtor-match guard. The HTML below is a real row captured from a live search.
import { describe, it, expect } from "vitest";
import { parseRows, debtorMatchesQuery, nameKey } from "./pledge";

const ROW = `
<tr class="case_row" data-case_url="https://registration.am:443/?app=AppCaseView&public_case_number=PUB61697C5EF740B69A43&case_name=overload_case">
  <td>1</td>
  <td>Ծանրաբեռնում</td>
  <td>Այլ</td>
  <td>30-01-2026 11:33:12</td>
  <td>Ամերիաբանկ</td>
  <td>ՊՐԱՅՄՍՏՈՆ, ՍՊԱՅԿԱ</td>
  <td><img src="https://registration.am:443/view.png" /></td>
</tr>`;

// A restriction (lien) row — same shape, different registration type. Must NOT be scored as a pledge.
const RESTRICTION_ROW = `
<tr class="case_row" data-case_url="https://registration.am:443/?app=AppCaseView&public_case_number=PUBABC&case_name=overload_case">
  <td>2</td><td>Սահմանափակում</td><td>Տրանսպորտ</td><td>11-02-2025 09:00:00</td>
  <td>ՀՀ ԿԱ պետական եկամուտների կոմիտե</td><td>ՍՊԱՅԿԱ</td><td><img src="x" /></td>
</tr>`;

describe("parseRows", () => {
  it("extracts type, date, creditor, debtor and the replayable detail URL", () => {
    const rows = parseRows(ROW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      regType: "Ծանրաբեռնում",
      date: "30-01-2026 11:33:12",
      creditor: "Ամերիաբանկ",
      debtor: "ՊՐԱՅՄՍՏՈՆ, ՍՊԱՅԿԱ",
      caseUrl: "https://registration.am:443/?app=AppCaseView&public_case_number=PUB61697C5EF740B69A43&case_name=overload_case",
    });
  });

  it("parses multiple rows and keeps each registration type distinct", () => {
    const rows = parseRows(ROW + RESTRICTION_ROW);
    expect(rows.map((r) => r.regType)).toEqual(["Ծանրաբեռնում", "Սահմանափակում"]);
  });
});

describe("debtor-match guard", () => {
  const spayka = nameKey("ՍՊԱՅԿԱ");

  it("keeps the queried entity even as one of several comma-separated co-debtors", () => {
    expect(debtorMatchesQuery("ՊՐԱՅՄՍՏՈՆ, ՍՊԱՅԿԱ", spayka)).toBe(true);
    expect(debtorMatchesQuery("ՍՊԱՅԿԱ ՍՊԸ", spayka)).toBe(true);
  });

  it("rejects a different, longer name that merely contains the query substring", () => {
    expect(debtorMatchesQuery("ՍՊԱՅԿԱ ԼՈՋԻՍՏԻԿ ՀՈԼԴԻՆԳ", spayka)).toBe(false); // different firm
  });

  it("nameKey ignores legal form, «» quotes, case and spacing", () => {
    expect(nameKey("«Սպայկա» ՍՊԸ")).toBe(nameKey("ՍՊԱՅԿԱ"));
  });
});
