// src.am — State Revenue Committee taxpayer search. Our primary source of truth / identity
// resolver: name (any script) → candidates → TIN + canonical Armenian name + status/date/
// form/address/VAT. POST /en/taxpayerSearchData (CSRF + session cookie) returns the record.
// e-register is Radware-walled, so this also supplies the registry basics. Node-only.
import { request } from "node:https";
import type { AdapterResult, SourceAdapter, Subject } from "../lib/adapter";
import { makeFact } from "../lib/adapter";
import type { Candidate } from "../types";
import {
  hasArmenian,
  toLatinTokens,
  latinToArmenian,
  latinToArmenianVariants,
  translitHyToLatin,
  nameSimilarity,
} from "../lib/normalize";

const HOST = "src.am";
const PAGE = "/en/taxpayerSearchSystemPage/112";
const SEARCH = "/en/taxpayerSearchData";
const URL = `https://src.am${PAGE}`;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";

interface Rec {
  tin: string;
  name: string;
  status?: string;
  submitDate?: string;
  legalStatus?: string;
  address?: string;
  isVATPayer?: number;
  ModeTaxation?: string;
}

function httpsReq(opts: import("node:https").RequestOptions, body?: string): Promise<{ status: number; headers: import("node:http").IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(opts, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }));
    });
    req.setTimeout(20000, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

interface Session {
  csrf: string;
  cookie: string;
}

// One GET gets a CSRF token + session cookie reusable for many search POSTs.
async function getSession(): Promise<Session> {
  const page = await httpsReq({ host: HOST, path: PAGE, method: "GET", headers: { "User-Agent": UA } });
  const csrf = page.body.match(/name="csrf-token"[^>]*content="([^"]+)"/i)?.[1];
  const cookie = (page.headers["set-cookie"] || []).map((c) => c.split(";")[0]).join("; ");
  if (!csrf || !cookie) throw new Error("could not obtain CSRF/session");
  return { csrf, cookie };
}

async function searchByForm(s: Session, form: string): Promise<Rec[]> {
  const resp = await httpsReq(
    {
      host: HOST,
      path: SEARCH,
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(form),
        "X-CSRF-TOKEN": s.csrf,
        "X-Requested-With": "XMLHttpRequest",
        Cookie: s.cookie,
      },
    },
    form,
  );
  return (JSON.parse(resp.body) as { data?: Rec[] }).data || [];
}

// Resolver: name in any script → ranked candidate companies. Fuzzy happens ONCE here; the
// query branches ambiguous Latin letters to surface the entity from src.am's substring
// search, then candidates are re-ranked by Latin-space similarity (HY→Latin is reliable).
export async function resolveBySrc(name: string, max = 8): Promise<Candidate[]> {
  const q = (name || "").trim();
  if (!q) return [];

  // build a small set of Armenian-script query strings
  const queries = new Set<string>();
  if (hasArmenian(q)) {
    queries.add(q);
  } else {
    queries.add(latinToArmenian(q)); // whole-name single guess
    for (const tok of toLatinTokens(q)) for (const v of latinToArmenianVariants(tok, 4)) queries.add(v);
  }
  const queryList = Array.from(queries).slice(0, 8);

  const session = await getSession();
  const byTin = new Map<string, Rec>();
  for (const form of queryList.map((x) => `name=${encodeURIComponent(x)}`)) {
    try {
      for (const rec of await searchByForm(session, form)) byTin.set(rec.tin, rec);
    } catch {
      /* skip a failed sub-query */
    }
  }

  return Array.from(byTin.values())
    .map((rec) => ({ rec, score: nameSimilarity(q, rec.name) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ rec }) => ({
      tin: rec.tin,
      name_hy: rec.name,
      name_en: translitHyToLatin(rec.name),
      status: rec.status,
      registration_date: rec.submitDate,
      address: rec.address,
    }));
}

function factsFromRecord(rec: Rec, now: string, match: "exact" | "fuzzy") {
  const facts = [
    makeFact({ catalog_id: "F-TAX-01", subject: rec.tin, domain: "tax", field: "tin_name_match", value: `${rec.name} — TIN ${rec.tin}`, source: "SRC (src.am)", url: URL, fetched_at: now, match }),
    makeFact({ catalog_id: "F-TAX-02", subject: rec.tin, domain: "tax", field: "vat_status", value: rec.isVATPayer ? `VAT payer (${rec.ModeTaxation || "ԱԱՀ"})` : "not a VAT payer", source: "SRC (src.am)", url: URL, fetched_at: now, match }),
    makeFact({ catalog_id: "F-REG-01", subject: rec.tin, domain: "registry", field: "legal_status", value: rec.status || "unknown", source: "SRC (src.am)", url: URL, fetched_at: now, match }),
  ];
  if (rec.submitDate) facts.push(makeFact({ catalog_id: "F-REG-02", subject: rec.tin, domain: "registry", field: "registration_date", value: rec.submitDate, source: "SRC (src.am)", url: URL, fetched_at: now, match }));
  if (rec.legalStatus) facts.push(makeFact({ catalog_id: "F-REG-03", subject: rec.tin, domain: "registry", field: "legal_form", value: rec.legalStatus, source: "SRC (src.am)", url: URL, fetched_at: now, match }));
  if (rec.address) facts.push(makeFact({ catalog_id: "F-REG-04", subject: rec.tin, domain: "registry", field: "address", value: rec.address, source: "SRC (src.am)", url: URL, fetched_at: now, match }));
  return facts;
}

export const srcAdapter: SourceAdapter = {
  domain: "tax",
  source: "SRC (src.am)",
  async fetch(subject: Subject, now: string): Promise<AdapterResult> {
    const query = (subject.tin || subject.name || "").trim();
    if (!query) return { domain: "tax", status: "verified_empty", facts: [], fetched_at: now, source: this.source };
    try {
      const session = await getSession();
      const queries = subject.tin
        ? [`tin=${encodeURIComponent(subject.tin)}`]
        : (hasArmenian(query) ? [query] : [latinToArmenian(query)]).map((c) => `name=${encodeURIComponent(c)}`);
      let data: Rec[] = [];
      for (const form of queries) {
        data = await searchByForm(session, form);
        if (data.length) break;
      }
      if (data.length === 0) {
        const f = makeFact({ catalog_id: "F-TAX-01", subject: query, domain: "tax", field: "tin_name_match", value: "no taxpayer found", source: this.source, url: URL, fetched_at: now });
        return { domain: "tax", status: "verified_empty", facts: [f], fetched_at: now, source: this.source };
      }
      const match = subject.tin || data.length === 1 ? "exact" : "fuzzy";
      return { domain: "tax", status: "verified", facts: factsFromRecord(data[0], now, match), fetched_at: now, source: this.source };
    } catch (e) {
      return { domain: "tax", status: "unavailable", facts: [], fetched_at: now, source: this.source, error: e instanceof Error ? e.message : String(e) };
    }
  },
};
