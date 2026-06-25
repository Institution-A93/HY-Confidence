// F-REG-07 — beneficial ownership from the State Register (e-register.moj.am). TIN-keyed.
//
// RECON CORRECTION (2026-06-23): the old `e-register.am` was Radware-walled; the registry has
// since moved to the justice-sector platform `e-register.moj.am`, which is OPEN — verified 200,
// no challenge, from both an Armenian residential IP and the Frankfurt datacenter. So owners need
// NEITHER a residential proxy NOR a headless browser (the whole paid-infra step the plan assumed).
//
// What is PUBLIC & free here: registry basics + the annual BO declarations (beneficial owners,
// citizenship, % participation, date became owner). What is NOT public (login/paid extract only):
// the executive director, the founder/participant list, capital, change history, and — crucially —
// PERSON search, so the cross-entity affiliation graph (F-GRA, phoenix B-06) is still gated.
//
// Flow (plain server-rendered HTML, no JSON API, no token):
//   GET /en/search/companies?query=<TIN>     → the company's internal id (/en/companies/<id>)
//   GET /en/companies/<id>                    → links to annual BO declarations
//   GET /en/companies/<id>/declarations/<uuid>→ Section B "Real Owner Personal data" blocks
// Node-only (node:https).
import { get } from "node:https";
import type { AdapterResult, SourceAdapter, Subject } from "../lib/adapter";
import { makeFact } from "../lib/adapter";
import { translitHyToLatin } from "../lib/normalize";

const HOST = "e-register.moj.am";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";

function httpsGet(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = get({ host: HOST, path, headers: { "User-Agent": UA } }, (res) => {
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
    req.setTimeout(20000, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

function visibleText(html: string): string {
  const noScript = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ");
  return noScript.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}

// The search result links to /en/companies/<numeric-id> (the registry's internal id, distinct
// from the TIN). Exclude the /declarations/ sub-links.
export function extractCompanyId(searchHtml: string): string | null {
  // id must be the whole company link (followed by a quote/query/end) — not a truncation of a
  // /companies/<id>/declarations/<uuid> path (where the id is followed by "/").
  const m = searchHtml.match(/\/en\/companies\/(\d+)(?![\d/])/);
  return m ? m[1] : null;
}

export function extractDeclarationLinks(detailHtml: string): string[] {
  return Array.from(new Set([...detailHtml.matchAll(/\/en\/companies\/\d+\/declarations\/[0-9a-f-]{8,}/g)].map((m) => m[0])));
}

export interface Owner {
  name: string; // Armenian, as registered
  citizenship: string;
  share: string; // e.g. "50%"
  since: string; // year became owner
}

// Section B repeats "First name X Last name Y Citizenship Z Date of becoming real owner DD/MM/YYYY
// … Participation size N %" per natural-person beneficial owner. We parse the visible text so the
// markup can change without breaking us. (Legal-entity owners use a "Name …" block — v1 covers the
// natural-person rows, which is the common case and the one the signals care about.)
export function parseDeclaration(declHtml: string): { date: string; owners: Owner[] } {
  const t = visibleText(declHtml);
  const date = (t.match(/Declaration date (\d{2}\/\d{2}\/\d{4})/) || [])[1] || "";
  const owners: Owner[] = [];
  const re = /First name (.+?) Last name (.+?) Citizenship (.+?) Date of becoming real owner (\d{2}\/\d{2}\/\d{4})([\s\S]*?)(?=First name |Section C|$)/g;
  for (const m of t.matchAll(re)) {
    const first = m[1].trim();
    const last = m[2].trim();
    const share = (m[5].match(/Participation size\s*(\d+)\s*%/) || [])[1];
    owners.push({
      name: `${first} ${last}`,
      citizenship: m[3].trim(),
      since: m[4].slice(-4),
      share: share ? `${share}%` : "—",
    });
  }
  return { date, owners };
}

// Owner person-names back out of an F-REG-07 value, for downstream UBO sanctions screening.
// Parses OUR OWN ownerSummary format ("NAME (LAT) SHARE, since YYYY"), so it is stable and
// unit-tested — not the fragile registry-HTML parsing parseDeclaration does. Keeps the Armenian
// NAME (sanctions transliterates it); drops the Latin paren, the share and the "since" tail.
export function ownerNamesFromValue(value: string): string[] {
  const colon = value.indexOf("):"); // skip the "Beneficial owners (declared DATE):" prefix
  const list = colon >= 0 ? value.slice(colon + 2) : value;
  return list
    .split(";")
    .map((seg) =>
      seg
        .replace(/\([^)]*\)/g, " ") // drop the Latin transliteration paren
        .replace(/\s+(?:\d+%|—).*$/, "") // drop the "SHARE, since YYYY" tail
        .trim(),
    )
    .filter(Boolean);
}

// Split an F-REG-07 value into the declaration date + per-owner display segments, so the narrative
// can be localized (the scaffolding "declared …/since …" translates; the owner display — name,
// transliteration, share — is DATA and stays verbatim). Parses our own ownerSummary format; unit-tested.
export function parseOwnerLine(value: string): { date: string; owners: { who: string; since: string }[] } {
  const date = (value.match(/\(declared ([^)]+)\)/) || [])[1] || "";
  const colon = value.indexOf("):");
  const list = colon >= 0 ? value.slice(colon + 2) : "";
  const owners = list
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((seg) => {
      const m = seg.match(/^(.*?)(?:,\s*since\s+(\d{4}))?\s*$/);
      return { who: (m?.[1] || seg).trim(), since: m?.[2] || "" };
    });
  return { date, owners };
}

function ownerSummary(o: Owner): string {
  const lat = translitHyToLatin(o.name);
  const latPart = lat && lat.toLowerCase() !== o.name.toLowerCase() ? ` (${lat})` : "";
  return `${o.name}${latPart} ${o.share}${o.since ? `, since ${o.since}` : ""}`;
}

export const eregisterAdapter: SourceAdapter = {
  domain: "registry",
  source: "State Register (e-register.moj.am)",
  async fetch(subject: Subject, now: string): Promise<AdapterResult> {
    // TIN-keyed: the name search is unreliable (Armenian exact-match), but the TIN is exact and is
    // what we have after src.am resolution. No TIN → nothing to query (registry basics already
    // come from src.am; e-register's unique add here is the owners, which need the id lookup).
    const tin = (subject.tin || "").trim();
    if (!/^\d{6,}$/.test(tin)) {
      return { domain: "registry", status: "verified_empty", facts: [], fetched_at: now, source: this.source };
    }
    try {
      const search = await httpsGet(`/en/search/companies?query=${encodeURIComponent(tin)}`);
      const id = extractCompanyId(search);
      if (!id) {
        // Queried successfully, company not found in the register (a real finding, not an error).
        return { domain: "registry", status: "verified_empty", facts: [], fetched_at: now, source: this.source };
      }
      const detail = await httpsGet(`/en/companies/${id}`);
      const declLinks = extractDeclarationLinks(detail);
      if (declLinks.length === 0) {
        return { domain: "registry", status: "verified_empty", facts: [], fetched_at: now, source: this.source };
      }
      // e-register THROTTLES concurrent requests — parallel declaration fetches come back empty
      // (only the first of a burst succeeds). So walk them SEQUENTIALLY. Declarations are listed
      // oldest→newest, so go newest-first and take the first that carries owners: normally a single
      // request, and always the most recent declaration that actually has a beneficial-owner block.
      let latest: { link: string; date: string; owners: Owner[] } | null = null;
      for (const link of [...declLinks].reverse()) {
        const parsed = parseDeclaration(await httpsGet(link).catch(() => ""));
        if (parsed.owners.length > 0) {
          latest = { link, ...parsed };
          break;
        }
      }
      if (!latest) {
        return { domain: "registry", status: "verified_empty", facts: [], fetched_at: now, source: this.source };
      }
      const fact = makeFact({
        catalog_id: "F-REG-07",
        subject: tin,
        domain: "registry",
        field: "beneficial_owners",
        value: `Beneficial owners (declared ${latest.date}): ${latest.owners.map(ownerSummary).join("; ")}`,
        source: this.source,
        url: `https://${HOST}${latest.link}`,
        fetched_at: now,
        match: "exact", // TIN-confirmed
      });
      return { domain: "registry", status: "verified", facts: [fact], fetched_at: now, source: this.source };
    } catch (e) {
      return { domain: "registry", status: "unavailable", facts: [], fetched_at: now, source: this.source, error: e instanceof Error ? e.message : String(e) };
    }
  },
};
