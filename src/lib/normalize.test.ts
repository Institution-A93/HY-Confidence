import { describe, it, expect } from "vitest";
import { translitHyToLatin, stripLegal, toLatinKey, nameVariants, sameEntity } from "./normalize";

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

describe("cross-script entity matching", () => {
  it("matches the same entity across Armenian and Latin", () => {
    expect(sameEntity("«Վանանդ Տրանս» ՍՊԸ", "Vanand Trans LLC")).toBe(true);
  });
  it("does not match unrelated names", () => {
    expect(sameEntity("Sevan Cargo", "Hrazdan Freight")).toBe(false);
  });
});
