import { describe, it, expect } from "vitest";
import { parseNotices, titleNamesEntity } from "./azdarar";

// Minimal real-shape result markup (verified against azdarar.am 2026-06-24). Column order per row:
// [0] category, [1] TITLE/subject, [2] body snippet (may name OTHER parties), [3] —, [4] date.
function row(uuid: string, category: string, title: string, body: string, date: string): string {
  const cell = (s: string) =>
    `<td class="list__result-table-cell fs14"><span class="list__result-table-content dib">${s}</span></td>`;
  return (
    `<tr class="list__result-table-drow pr public-announcement-inner-page" data-href="https://azdarar.am/hy/public-announcement/view/${uuid}">` +
    cell(category) +
    cell(title) +
    cell(body) +
    cell("") +
    cell(date) +
    `</tr>`
  );
}

// (a) Ameriabank as CREDITOR on someone else's bankruptcy — title names Vardanyan, not the bank.
const CREDITOR_ROW = row(
  "a0ddce39-cc92-4abc-8bc4-af137b9d8562",
  "Ֆիզիկական անձինք",
  "Հայտարարություն ՍնԴ/0330/04/26 վճռով սնանկ ճանաչված Նարեկ Մարտիրոսի Վարդանյանի նկատմամբ",
  "Պարտատեր &laquo;ԱՄԵՐԻԱԲԱՆԿ&raquo; ՓԲԸ-ի կողմից ՍնԴ/0330/04/26 վճռով սնանկ ճանաչված",
  "19.06.2026 15:20:35",
);
// (b) The bank's OWN liquidation — title names «ԱՄԵՐԻԱԲԱՆԿ» (with genitive «-ի»).
const SUBJECT_ROW = row(
  "095f120e-8138-4765-83f0-dcbef73e5d15",
  "Իրավաբանական անձինք",
  "Հայտարարություն &laquo;ԱՄԵՐԻԱԲԱՆԿ&raquo; ՓԲԸ-ի լուծարման մասին",
  "Հրապարակվում է լուծարման ծանուցում",
  "15.06.2026 08:50:46",
);
// (c) Enforcement notice (category "Հարկադիր…") — classifies as "other", dropped by the type filter.
const OTHER_ROW = row(
  "11c6449f-eb11-4d43-9250-5893a9a1202f",
  "Հարկադիր կատարումն ապահովող ծառայություն",
  "Ծանուցում 12980053 Կատարողական վարույթով",
  "Պատասխանողներ Սուրեն Վարդանի Պողոսյանից",
  "16.06.2026 15:00:31",
);

describe("azdarar parseNotices", () => {
  it("reads the TITLE from cell [1] (not the body) and classifies on it", () => {
    const ns = parseNotices(CREDITOR_ROW + SUBJECT_ROW + OTHER_ROW);
    expect(ns.map((n) => n.uuid)).toHaveLength(3);
    expect(ns[0].title).toContain("Վարդանյանի");
    expect(ns[0].type).toBe("bankruptcy");
    expect(ns[1].type).toBe("liquidation");
    expect(ns[2].type).toBe("other");
  });
});

describe("azdarar titleNamesEntity (subject guard)", () => {
  it("rejects a notice where the entity is only a creditor in the body, not the subject", () => {
    const [creditor] = parseNotices(CREDITOR_ROW);
    expect(titleNamesEntity(creditor.title, "ԱՄԵՐԻԱԲԱՆԿ")).toBe(false);
  });

  it("accepts a notice whose title names the entity (its own liquidation), genitive included", () => {
    const [subject] = parseNotices(SUBJECT_ROW);
    expect(titleNamesEntity(subject.title, "ԱՄԵՐԻԱԲԱՆԿ")).toBe(true);
    // legal-form suffix on the query must not matter (stripLegal)
    expect(titleNamesEntity(subject.title, "«ԱՄԵՐԻԱԲԱՆԿ» ՓԲԸ")).toBe(true);
  });

  it("the fetch-time filter (distress + subject) keeps only the bank's own notice", () => {
    const kept = parseNotices(CREDITOR_ROW + SUBJECT_ROW + OTHER_ROW).filter(
      (n) => n.type !== "other" && titleNamesEntity(n.title, "ԱՄԵՐԻԱԲԱՆԿ"),
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].type).toBe("liquidation");
  });
});
