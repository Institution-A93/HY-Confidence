// F-ENF-01 — open compulsory-enforcement proceedings at DAHK (the MoJ Compulsory Enforcement
// Service). The single strongest free "won't pay" signal → blocker B-03. TIN-keyed.
//
// RECON CORRECTION (2026-06-23): the spec feared this source was "Cloudflare + reCAPTCHA-walled"
// and bundled it with a paid headless+captcha step. That wall is on the cesa.am *contact forms*,
// NOT here. The actual debtor search redirects (cesa.am/hy/service/hetakhuzumner →) to
// `cabinet.harkadir.am/dahkcabinet/cabinet/debtorinfo/`, a Microsoft-IIS / ASP.NET Core app with NO
// Cloudflare and NO real captcha — so this is a plain-HTTP adapter, like src.am. No solver, no
// headless, no proxy. Only OPEN proceedings are exposed (closed history isn't retrievable — why
// SN-02 was culled), so any returned proceeding IS an open one → B-03.
//
// TRANSPORT (3 GET/POST round-trips, all verified live):
//   1. GET /dahkcabinet/cabinet/debtorinfo/ → an antiforgery token (hidden __RequestVerificationToken)
//      + a `.AspNetCore.Antiforgery` cookie.
//   2. GET /DahkCabinet/Cabinet/RequestCaptcha (with the token header + cookie) → a plain 32-char
//      text token. This "CAPTCHA" is NOT a visual challenge — the server issues a nonce that the
//      client echoes straight back; each search RESPONSE returns the NEXT nonce. So it is anti-replay
//      bookkeeping, not human verification — we just thread the token through.
//   3. POST /DahkCabinet/Cabinet/DebtorRems  {PASSPORTORHVHH:<TIN>, CAPTCHA:<token>}
//      → {CAPTCHA:<next nonce>, REMS:[...]}. REMS non-empty = open proceedings exist.
//   (The sibling /SSnPassportDebtorWantedList endpoint is login-gated (401) — we don't use it;
//    DebtorRems carries the proceedings and is public.)
import { request } from "node:https";
import type { AdapterResult, SourceAdapter, Subject } from "../lib/adapter";
import { makeFact } from "../lib/adapter";

const HOST = "cabinet.harkadir.am";
const PAGE = "/dahkcabinet/cabinet/debtorinfo/";
const CAPTCHA_EP = "/DahkCabinet/Cabinet/RequestCaptcha";
const REMS_EP = "/DahkCabinet/Cabinet/DebtorRems";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";

function httpsReq(
  opts: import("node:https").RequestOptions,
  body?: string,
): Promise<{ headers: import("node:http").IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(opts, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ headers: res.headers, body: data }));
    });
    req.setTimeout(25000, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

export function extractToken(html: string): string {
  return (html.match(/name="__RequestVerificationToken"[^>]*value="([^"]*)"/) || [])[1] || "";
}

interface Rem {
  [k: string]: unknown;
}

export const enforcementAdapter: SourceAdapter = {
  domain: "enforcement",
  source: "DAHK Enforcement (cabinet.harkadir.am)",
  async fetch(subject: Subject, now: string): Promise<AdapterResult> {
    // TIN-keyed: the search field is PASSPORTORHVHH (ՀՎՀՀ = the company TIN), pinned by src.am in
    // phase 1. No TIN → nothing to query (mirrors eregister): a missing key is not a source failure.
    const tin = (subject.tin || "").trim();
    if (!/^\d{6,}$/.test(tin)) {
      return { domain: "enforcement", status: "verified_empty", facts: [], fetched_at: now, source: this.source };
    }
    try {
      // 1) seed the antiforgery token + cookie.
      const page = await httpsReq({ host: HOST, path: PAGE, method: "GET", headers: { "User-Agent": UA } });
      const token = extractToken(page.body);
      const cookie = (page.headers["set-cookie"] || []).map((c) => c.split(";")[0]).join("; ");
      if (!token || !cookie) throw new Error("no antiforgery token/cookie");
      const authHeaders = {
        "User-Agent": UA,
        RequestVerificationToken: token,
        "X-Requested-With": "XMLHttpRequest",
        Cookie: cookie,
      };
      // 2) fetch the anti-replay nonce the search expects echoed back.
      const captcha = (await httpsReq({ host: HOST, path: CAPTCHA_EP, method: "GET", headers: authHeaders })).body.trim();
      // 3) the actual proceedings lookup by TIN.
      const payload = JSON.stringify({ PASSPORTORHVHH: tin, CAPTCHA: captcha });
      const res = await httpsReq(
        {
          host: HOST,
          path: REMS_EP,
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
        },
        payload,
      );
      const rems = (JSON.parse(res.body) as { REMS?: Rem[] }).REMS ?? [];
      if (rems.length === 0) {
        // Queried successfully, no open proceedings (a real finding, not an error).
        return { domain: "enforcement", status: "verified_empty", facts: [], fetched_at: now, source: this.source };
      }
      // Only OPEN proceedings are published here, so any row is an active enforcement → feeds B-03.
      // v1 reports the COUNT (the load-bearing fact); per-proceeding fields (number/amount/date/
      // bailiff) are a narrative enrichment to confirm against a real non-empty REMS sample — the
      // src.am resolver was down during recon so no debtor-with-proceedings could be captured. [TODO]
      const fact = makeFact({
        catalog_id: "F-ENF-01",
        subject: tin,
        domain: "enforcement",
        field: "enforcement_proceedings",
        value: `${rems.length} open compulsory-enforcement proceeding(s) registered with DAHK`,
        source: this.source,
        url: `https://${HOST}${PAGE}`,
        fetched_at: now,
        match: "exact", // TIN-confirmed (queried by ՀՎՀՀ, not by name)
      });
      return { domain: "enforcement", status: "verified", facts: [fact], fetched_at: now, source: this.source };
    } catch (e) {
      return { domain: "enforcement", status: "unavailable", facts: [], fetched_at: now, source: this.source, error: e instanceof Error ? e.message : String(e) };
    }
  },
};
