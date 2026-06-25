// spyur.am — Armenian business directory that indexes companies by BOTH their Latin/English and
// Armenian names. It bridges the one gap our transliterator structurally cannot: an English word
// in a company name is registered by Armenian PHONETICS, not by letter mapping — "ML Mining" is
// «ՄԼ ՄԱՅՆԻՆԳ» (Mining → Մայնինգ / "Mayning"), which latinToArmenian renders as «մինինգ», so the
// src.am substring search misses the record entirely. The directory already knows the pairing.
//
// spyur.am itself is Cloudflare-walled: every direct GET 302s to /en/error (no bot clearance), so
// without a headless CF-solver we cannot scrape it directly. The reliable path is a SEARCH-ENGINE
// query scoped to the site — DuckDuckGo's Lite endpoint returns spyur result titles that carry the
// «…» Armenian company name verbatim (e.g. «ՄԼ ՄԱՅՆԻՆԳ» • ՀԱՅԱՍՏԱՆ (ԵՐԵՎԱՆ) • ՍՓՅՈՒՌ). We extract
// that name and hand it back to the src.am resolver to re-key the query in Armenian.
//
// This is a best-effort RECALL aid for LATIN input only. It emits no Facts and never blocks: if the
// search engine is unavailable, the resolver just keeps its direct (weak) transliteration results.
// Node-only (node:https).
import { get } from "node:https";

const DDG_HOST = "lite.duckduckgo.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";

function httpsGet(host: string, path: string, timeoutMs = 12000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = get({ host, path, headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "en,hy;q=0.8" } }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(data));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

// Pull the Armenian company names out of a DuckDuckGo-Lite result page. Spyur result titles use
// «…» guillemets around the Armenian name — extracting that group naturally selects the Armenian
// result row and ignores the English-titled one (which uses straight quotes). Pure + unit-tested:
// the SE markup can drift without silently returning a wrong name (we just get fewer/zero names).
export function extractSpyurNames(ddgHtml: string): string[] {
  const names: string[] = [];
  // Anchors whose href points at spyur.am (DDG wraps them as /l/?uddg=<urlencoded spyur url>).
  for (const m of ddgHtml.matchAll(/<a[^>]*href="([^"]*spyur[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const title = m[2].replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
    const arm = title.match(/«([^»]+)»/); // the Armenian name segment
    if (arm) names.push(arm[1].trim());
  }
  return Array.from(new Set(names.filter(Boolean)));
}

// Latin company name → Armenian directory name candidate(s), via the spyur-scoped SE query.
// Returns [] (never throws) when the directory/SE yields nothing or is unreachable.
export async function spyurNameCandidates(latinName: string): Promise<string[]> {
  const q = (latinName || "").trim();
  if (!q) return [];
  try {
    const html = await httpsGet(DDG_HOST, `/lite/?q=${encodeURIComponent(`${q} spyur.am`)}`);
    return extractSpyurNames(html);
  } catch {
    return [];
  }
}
