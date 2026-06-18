// F-SAN-01 — sanctions screening. The one source with a real, documented feed
// (source-access-spec.md §11). Downloads the OFAC SDN list and token-screens the
// director/UBO name. Names are Latin, so an Armenian query is transliterated first
// (normalize). Token-AND matching with a ≥2-token floor avoids false hits on common
// surnames. Node-only (node:https).
//
// SCOPE TONIGHT: OFAC live. EU (consolidated XML) and UK (OFSI CSV) are the same pattern
// on different feeds — wired next so the demo doesn't hinge on three formats at once.
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
    const tokens = toLatinTokens(name)
      .map((t) => t.toUpperCase())
      .filter((t) => t.length >= 3);
    if (tokens.length < 2) {
      // not enough to screen safely (single common token → too many false hits)
      return { domain: "sanctions", status: "verified_empty", facts: [], fetched_at: now, source: this.source };
    }
    try {
      const names = await loadOfacNames();
      const hits = names.filter((n) => tokens.every((tok) => n.includes(tok))).slice(0, 3);
      const value = hits.length ? `POSSIBLE OFAC match: ${hits.join("; ")}` : "no matches (OFAC SDN)";
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
