// F-SAN-01 — sanctions screening. The one source with a real, documented feed
// (source-access-spec.md §11). Downloads the OFAC SDN list and name-screens the director/UBO
// (or, until the ownership graph exists, the entity name). Names are Latin, so an Armenian query
// is transliterated first (normalize). Node-only (node:https).
//
// MATCHING IS BY STRENGTH, not mere token presence. Naive token-AND has two failure modes that
// both produced false BLOCKED:
//   • substring hits — «Թոփ Ավտո» (TOP+AVTO) matched "…URAL·AVTO·PRITSEP" because TOP and AVTO
//     are substrings of one long sanctioned name. → fixed by matching whole WORDS, not substrings.
//   • diluted hits — «General Trading» shares 2 words with 77 names like "AL WASEL AND BABEL
//     GENERAL TRADING LLC". Whole-word matching does NOT help (still 77). → a match only counts
//     as STRONG (block-worthy → B-05) when the shared words explain ≥STRONG_COVERAGE of BOTH names
//     (the names are essentially the same entity). A partial overlap is POSSIBLE → a manual-review
//     flag, NEVER an auto-veto: a hard BLOCKED must be a confident match, not a coincidence of
//     common words. The deeper fix — screening real director/UBO names instead of the company
//     name — waits on the ownership graph (BODS / e-register; source-access-spec §1–2).
import { get } from "node:https";
import type { AdapterResult, SourceAdapter, Subject } from "../lib/adapter";
import { makeFact } from "../lib/adapter";
import { toLatinTokens } from "../lib/normalize";

// The old www.treasury.gov/ofac/downloads/sdn.csv now 302-redirects here. node:https does
// not follow redirects, so query the canonical endpoint directly (and still follow redirects
// defensively in case it moves again).
const OFAC_SDN_URL = "https://sanctionslistservice.ofac.treas.gov/api/publicationpreview/exports/sdn.csv";

let cachedNames: string[] | null = null;

const UA = "HY-Confidence/0.1 (counterparty-check; +https://github.com/Institution-A93/HY-Confidence)";

const MIN_TOKEN_LEN = 3; // shorter tokens are too noisy to screen on
const MIN_SHARED_WORDS = 2; // need ≥2 shared whole words (drops single-common-surname hits)
const STRONG_COVERAGE = 0.6; // BLOCK only when shared words cover ≥60% of BOTH names
const MAX_POSSIBLE = 5; // a name weakly matching >5 entries is generic noise → treat as clean

// Significant whole words of an OFAC name (uppercased already). Splitting on non-alphanumerics
// is what makes the match word-level rather than substring-level.
function significantWords(name: string): string[] {
  return (name.toUpperCase().match(/[A-Z0-9]+/g) || []).filter((w) => w.length >= MIN_TOKEN_LEN);
}

// Classify a query name against the OFAC list into STRONG (block-worthy) and POSSIBLE (review)
// hits. Pure + deterministic → unit-tested in sanctions.test.ts. coverage = shared/total words
// for each side; a STRONG match needs the shared words to cover ≥STRONG_COVERAGE of BOTH names,
// so neither a substring nor a couple of common words buried in a long name can trip it.
export function screenOfac(queryName: string, ofacNames: string[]): { strong: string[]; possible: string[] } {
  const qWords = Array.from(new Set(toLatinTokens(queryName).map((t) => t.toUpperCase()).filter((t) => t.length >= MIN_TOKEN_LEN)));
  if (qWords.length < MIN_SHARED_WORDS) return { strong: [], possible: [] };
  const qSet = new Set(qWords);
  const strong: string[] = [];
  const possible: string[] = [];
  for (const n of ofacNames) {
    const nWords = significantWords(n);
    if (!nWords.length) continue;
    const nSet = new Set(nWords);
    let inter = 0;
    for (const w of qSet) if (nSet.has(w)) inter++;
    if (inter < MIN_SHARED_WORDS) continue;
    const coverage = Math.min(inter / qSet.size, inter / nSet.size);
    (coverage >= STRONG_COVERAGE ? strong : possible).push(n);
  }
  return { strong, possible };
}

function download(url: string, timeoutMs = 20000, redirects = 3): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = get(url, { headers: { "User-Agent": UA, Accept: "text/csv,*/*" } }, (res) => {
      const sc = res.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(sc) && res.headers.location && redirects > 0) {
        res.resume();
        resolve(download(new URL(res.headers.location, url).toString(), timeoutMs, redirects - 1));
        return;
      }
      if (sc >= 400) {
        reject(new Error(`HTTP ${sc}`));
        res.resume();
        return;
      }
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(data));
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("download timeout"));
    });
    req.on("error", reject);
  });
}

async function loadOfacNames(): Promise<string[]> {
  if (cachedNames) return cachedNames;
  const csv = await download(OFAC_SDN_URL);
  const names: string[] = [];
  for (const line of csv.split("\n")) {
    // SDN.csv row: ent_num (UNQUOTED) , "SDN_Name" , ... — capture the 2nd, quoted field
    const m = line.match(/^[^,]*,"([^"]*)"/);
    if (m) names.push(m[1].toUpperCase());
  }
  // A real list is thousands of names. A near-empty parse means the feed shape changed or
  // the download was intercepted — that is "could not query", not "no matches".
  if (names.length < 100) throw new Error(`OFAC list parse looked empty (${names.length} names)`);
  cachedNames = names;
  return names;
}

export const sanctionsAdapter: SourceAdapter = {
  domain: "sanctions",
  source: "OFAC SDN",
  async fetch(subject: Subject, now: string): Promise<AdapterResult> {
    const name = (subject.person || subject.name || "").trim();
    // Floor: need ≥2 distinct significant query words to screen safely (one common token → noise).
    const qWordCount = new Set(toLatinTokens(name).filter((t) => t.length >= MIN_TOKEN_LEN)).size;
    if (qWordCount < MIN_SHARED_WORDS) {
      return { domain: "sanctions", status: "verified_empty", facts: [], fetched_at: now, source: this.source };
    }
    try {
      const names = await loadOfacNames();
      const { strong, possible } = screenOfac(name, names);
      // strong → confident, vetoes (B-05); possible → manual-review flag only (never an auto-veto);
      // a name weakly matching a flood of entries (>MAX_POSSIBLE) is generic → treat as clean.
      let value: string;
      if (strong.length) value = `OFAC sanctions match (strong): ${strong.slice(0, 3).join("; ")}`;
      else if (possible.length && possible.length <= MAX_POSSIBLE) value = `Possible OFAC match — manual review: ${possible.slice(0, 3).join("; ")}`;
      else value = "no matches (OFAC SDN)";
      return {
        domain: "sanctions",
        status: "verified",
        source: this.source,
        fetched_at: now,
        facts: [
          makeFact({
            catalog_id: "F-SAN-01",
            subject: `person:${name}`,
            domain: "sanctions",
            field: "screening",
            value,
            source: this.source,
            url: "https://sanctionssearch.ofac.treas.gov/",
            fetched_at: now,
          }),
        ],
      };
    } catch (e) {
      return {
        domain: "sanctions",
        status: "unavailable",
        facts: [],
        fetched_at: now,
        source: this.source,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};
