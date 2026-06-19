// src.am — State Revenue Committee taxpayer search. Live, real data. The site is a Laravel
// app; POST /en/taxpayerSearchData (CSRF + session cookie) returns the taxpayer record.
// Recon (2026-06-19) found it returns far more than tax: status, registration date, legal
// form and address too — so this single source covers F-TAX-01/02 AND the registry basics
// (F-REG-01/02/03/04), which matters because e-register itself is behind a Radware bot wall.
// Node-only (node:https).
import { request } from "node:https";
import type { AdapterResult, SourceAdapter, Subject } from "../lib/adapter";
import { makeFact } from "../lib/adapter";

const HOST = "src.am";
const PAGE = "/en/taxpayerSearchSystemPage/112";
const SEARCH = "/en/taxpayerSearchData";
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

function cookieHeader(setCookie: string[] | undefined): string {
  if (!setCookie) return "";
  return setCookie.map((c) => c.split(";")[0]).join("; ");
}

export const srcAdapter: SourceAdapter = {
  domain: "tax",
  source: "SRC (src.am)",
  async fetch(subject: Subject, now: string): Promise<AdapterResult> {
    const query = (subject.tin || subject.name || "").trim();
    if (!query) return { domain: "tax", status: "verified_empty", facts: [], fetched_at: now, source: this.source };
    try {
      // 1. GET the page for the CSRF token + session cookie
      const page = await httpsReq({ host: HOST, path: PAGE, method: "GET", headers: { "User-Agent": UA } });
      const csrf = page.body.match(/name="csrf-token"[^>]*content="([^"]+)"/i)?.[1];
      const cookie = cookieHeader(page.headers["set-cookie"]);
      if (!csrf || !cookie) throw new Error("could not obtain CSRF/session");

      // 2. POST the search (by TIN if given, else by name)
      const form = subject.tin ? `tin=${encodeURIComponent(subject.tin)}` : `name=${encodeURIComponent(query)}`;
      const resp = await httpsReq(
        {
          host: HOST,
          path: SEARCH,
          method: "POST",
          headers: {
            "User-Agent": UA,
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": Buffer.byteLength(form),
            "X-CSRF-TOKEN": csrf,
            "X-Requested-With": "XMLHttpRequest",
            Cookie: cookie,
          },
        },
        form,
      );
      const json = JSON.parse(resp.body) as { data?: Rec[] };
      const data = json.data || [];
      if (data.length === 0) {
        // queried successfully, nothing matched — a finding, not a failure
        const f = makeFact({ catalog_id: "F-TAX-01", subject: query, domain: "tax", field: "tin_name_match", value: "no taxpayer found", source: this.source, url: `https://src.am${PAGE}`, fetched_at: now });
        return { domain: "tax", status: "verified_empty", facts: [f], fetched_at: now, source: this.source };
      }

      const rec = data[0];
      const exact = !!subject.tin || data.length === 1;
      const match = exact ? "exact" : "fuzzy";
      const url = `https://src.am${PAGE}`;
      const facts = [
        makeFact({ catalog_id: "F-TAX-01", subject: rec.tin, domain: "tax", field: "tin_name_match", value: `${rec.name} — TIN ${rec.tin}`, source: this.source, url, fetched_at: now, match }),
        makeFact({ catalog_id: "F-TAX-02", subject: rec.tin, domain: "tax", field: "vat_status", value: rec.isVATPayer ? `VAT payer (${rec.ModeTaxation || "ԱԱՀ"})` : "not a VAT payer", source: this.source, url, fetched_at: now, match }),
        makeFact({ catalog_id: "F-REG-01", subject: rec.tin, domain: "registry", field: "legal_status", value: rec.status || "unknown", source: this.source, url, fetched_at: now, match }),
      ];
      if (rec.submitDate) facts.push(makeFact({ catalog_id: "F-REG-02", subject: rec.tin, domain: "registry", field: "registration_date", value: rec.submitDate, source: this.source, url, fetched_at: now, match }));
      if (rec.legalStatus) facts.push(makeFact({ catalog_id: "F-REG-03", subject: rec.tin, domain: "registry", field: "legal_form", value: rec.legalStatus, source: this.source, url, fetched_at: now, match }));
      if (rec.address) facts.push(makeFact({ catalog_id: "F-REG-04", subject: rec.tin, domain: "registry", field: "address", value: rec.address, source: this.source, url, fetched_at: now, match }));

      return { domain: "tax", status: "verified", facts, fetched_at: now, source: this.source };
    } catch (e) {
      return { domain: "tax", status: "unavailable", facts: [], fetched_at: now, source: this.source, error: e instanceof Error ? e.message : String(e) };
    }
  },
};
