// Pure-logic test for the spyur name extractor. The live DuckDuckGo-Lite fetch is covered by
// tools/smoke-adapters.ts; here we pin the title parsing that turns a search result into the
// Armenian company name we re-key src.am with (the phonetic-divergence fix for Latin input).
import { describe, it, expect } from "vitest";
import { extractSpyurNames } from "./spyur";

describe("extractSpyurNames", () => {
  // Real DDG-Lite shape for "ML Mining spyur.am": an English-titled row (straight quotes) and an
  // Armenian-titled row (« » guillemets), both linking to spyur.am via the /l/?uddg= redirect.
  const html = `
    <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.spyur.am%2Fen%2Fcompanies%2Fml-mini" class="result-link">&quot;Ml Mining&quot; • Armenia (Yerevan) • Spyur</a>
    <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.spyur.am%2Fam%2Fcompanies%2Fml-mini" class="result-link">«ՄԼ ՄԱՅՆԻՆԳ» • ՀԱՅԱՍՏԱՆ (ԵՐԵՎԱՆ) • ՍՓՅՈՒՌ</a>`;

  it("extracts the « » Armenian company name from a spyur result, ignoring the English-titled row", () => {
    expect(extractSpyurNames(html)).toEqual(["ՄԼ ՄԱՅՆԻՆԳ"]);
  });

  it("dedupes and skips non-spyur or quote-less results", () => {
    const noisy = `
      <a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com">«Ուրիշ» Company</a>
      <a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.spyur.am%2Fam%2Fx">«Մայնինգ» ՍՊԸ • ՍՓՅՈՒՌ</a>
      <a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.spyur.am%2Fam%2Fy">«Մայնինգ» ՍՊԸ • ՍՓՅՈՒՌ</a>`;
    expect(extractSpyurNames(noisy)).toEqual(["Մայնինգ"]);
  });

  it("returns [] when there are no spyur results", () => {
    expect(extractSpyurNames("<div>no results</div>")).toEqual([]);
  });
});
