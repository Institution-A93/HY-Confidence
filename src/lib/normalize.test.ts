import { describe, it, expect } from "vitest";
import {
  translitHyToLatin,
  stripLegal,
  toLatinKey,
  nameVariants,
  sameEntity,
  latinToArmenian,
  armenianQueryCandidates,
  hasArmenian,
  latinToArmenianVariants,
  levenshtein,
  nameSimilarity,
} from "./normalize";

describe("HY→Latin transliteration (clean cases)", () => {
  it("maps the fixture entity roots", () => {
    expect(translitHyToLatin("Վանանդ")).toBe("vanand");
    expect(translitHyToLatin("Հրազդան")).toBe("hrazdan");
    expect(translitHyToLatin("Սևան")).toBe("sevan");
  });
});

describe("legal-name canonicalization", () => {
  it("strips «» and the legal-form suffix", () => {
    expect(stripLegal("«Արաքս Լոջիսթիքս» ՍՊԸ")).toBe("Արաքս Լոջիսթիքս");
    expect(stripLegal("Vanand Trans LLC")).toBe("Vanand Trans");
  });

  it("produces a cross-script comparable key", () => {
    expect(toLatinKey("«Վանանդ Տրանս» ՍՊԸ")).toBe("vanandtrans");
  });
});

describe("variant generation handles romanization ambiguity", () => {
  it("emits both q and k forms for ք", () => {
    const v = nameVariants("Արաքս");
    expect(v.has("araqs")).toBe(true);
    expect(v.has("araks")).toBe(true); // the form the English name actually used
  });
});

describe("Latin/Cyrillic → Armenian (best-effort query candidates)", () => {
  it("transliterates clean Latin roots to Armenian", () => {
    expect(latinToArmenian("grand")).toBe("գրանդ");
    expect(latinToArmenian("spyur")).toBe("սպյուր");
  });
  it("passes Armenian input through unchanged", () => {
    expect(hasArmenian("Սպյուր")).toBe(true);
    expect(armenianQueryCandidates("Սպյուր")).toEqual(["Սպյուր"]);
  });
  it("produces an Armenian candidate for Latin input", () => {
    expect(armenianQueryCandidates("Grand")).toEqual(["գրանդ"]);
  });
});

describe("fuzzy resolver building blocks", () => {
  it("variant set contains the clean transliteration of a token", () => {
    expect(latinToArmenianVariants("grand")).toContain("գրանդ");
  });
  it("variant set contains the conventional spelling (candy → քենդի)", () => {
    expect(latinToArmenianVariants("candy")).toContain("քենդի");
  });
  it("levenshtein basics", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("abc", "abc")).toBe(0);
  });
  it("ranks the right company high across scripts (Grand Candy)", () => {
    const good = nameSimilarity("Grand Candy", "«ԳՐԱՆԴ ՔԵՆԴԻ»");
    const bad = nameSimilarity("Grand Candy", "«Արարատ Ցեմենտ»");
    expect(good).toBeGreaterThan(0.6);
    expect(good).toBeGreaterThan(bad);
  });
});

describe("cross-script entity matching", () => {
  it("matches the same entity across Armenian and Latin", () => {
    expect(sameEntity("«Վանանդ Տրանս» ՍՊԸ", "Vanand Trans LLC")).toBe(true);
  });
  it("does not match unrelated names", () => {
    expect(sameEntity("Sevan Cargo", "Hrazdan Freight")).toBe(false);
  });
});
