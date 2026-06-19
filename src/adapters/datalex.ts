// F-CRT-01/02/03 — datalex.am judicial portal (courts). Name-keyed source: query with the
// CANONICAL Armenian name (from the src.am resolver), since datalex is Armenian-indexed.
//
// ROLE CLASSIFICATION IS STRUCTURAL, not parsed. The search form has separate claimant_* and
// respondant_* fields, so we set the role by WHICH field we put the name in:
//   claimant_organization_name   → the entity is the PLAINTIFF   → F-CRT-01 → WP-09
//   respondant_organization_name → the entity is the DEFENDANT   → F-CRT-02 → SN-01
//   respondant_* on the bankruptcy case-type → the entity is the DEBTOR → F-CRT-03 → B-01
// This satisfies the spec's mandatory role-classification at the query layer — we never pass an
// unclassified count downstream (source-access-spec/recon: "never pass unclassified counts").
// R-04 (plaintiff cases never feed SN-01) is therefore enforced by construction: plaintiff hits
// come only from the claimant query and can never be counted as defendant cases.
//
// TRANSPORT: the results grid is a jqGrid backed by an Elasticsearch JSON API at /json.php — no
// browser needed. One GET of the search page yields a PHPSESSID; each search is a POST to
// /json.php with function=getGridDataList and arg=[filterData, pagination, gridSearchDescription,
// false]. The per-case DETAIL view (openCase) is captcha-gated ("Մուտքագրեք նկարի տեքստը"), so
// claim AMOUNTS, verdict OUTCOMES, and open/closed STATUS are not retrievable — we use only the
// freely-readable grid: counts + party names + case numbers + filing year. Consequences:
//   • SN-01 is scaled by count + recency only (not amount — captcha-gated). [follow-up]
//   • WP-09 is "plaintiff in collection cases" — wins can't be confirmed (captcha). [follow-up]
//   • B-01 needs an OPEN bankruptcy; we infer "open" from recency (see datalex.ts caller), since
//     Armenian corporate bankruptcies run multi-year — a recent filing is almost certainly live.
import { request } from "node:https";
import type { AdapterResult, SourceAdapter, Subject } from "../lib/adapter";
import { makeFact } from "../lib/adapter";

const HOST = "datalex.am";
const SEARCH_PAGE = "/?app=AppCaseSearch";
const AJAX = "/json.php";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";

// Case-type configs (from the page's BARL.MODULE_PARAMS for each ?tab=…). The grid needs the
// matching gridSearchDescription/caseTypeID or it returns the wrong index.
const CIVIL = { gsd: "datalex_civ_case_info", caseType: "civil", caseTypeID: 2 } as const;
const BANKRUPTCY = { gsd: "datalex_bankr_case_info", caseType: "bankruptcy", caseTypeID: 3 } as const;
type CaseConfig = typeof CIVIL | typeof BANKRUPTCY;

interface Row {
  claimant_name?: string;
  respondant_name?: string;
  case_number?: string;
  case_external_id?: string;
  creation_datetime?: string | null;
}

function httpsReq(opts: import("node:https").RequestOptions, body?: string): Promise<{ headers: import("node:http").IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(opts, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ headers: res.headers, body: data }));
    });
    req.setTimeout(20000, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// One GET yields a PHPSESSID cookie reusable for many search POSTs.
async function getSession(): Promise<string> {
  const page = await httpsReq({ host: HOST, path: SEARCH_PAGE, method: "GET", headers: { "User-Agent": UA } });
  const cookie = (page.headers["set-cookie"] || []).map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error("no PHPSESSID");
  return cookie;
}

function moduleParams(cfg: CaseConfig) {
  return {
    gridSearchDescription: cfg.gsd,
    filterParams: [],
    caseType: cfg.caseType,
    caseTypeID: cfg.caseTypeID,
    sortByPrecedent: false,
    showViewCaseIcon: true,
    showCaseIcons: true,
    parentModuleID: "Common/ModCaseGrid",
    moduleID: "Common/ModGrid",
    viewID: "common-mod-grid",
    currIndex: 0,
    identName: null,
    hasError: false,
    useScrollToErrorField: true,
  };
}

interface GridResult {
  totalCount: number;
  rows: Row[];
}

// One filtered search → { totalCount, first page of rows }. The grid sorts recency-descending,
// so row[0] / the page is enough to read the most-recent case number for the recency signal;
// totalCount carries the true total across all pages.
async function gridSearch(cookie: string, filterData: Record<string, string>, cfg: CaseConfig): Promise<GridResult> {
  const pagination = { page: 1, rows: 20, sidx: "", sord: "desc", _search: false, nd: 0 };
  const arg = JSON.stringify([filterData, pagination, cfg.gsd, false]);
  const form = new URLSearchParams({
    appName: "AppCaseSearch",
    appPage: "default",
    moduleID: "Common/ModGrid",
    class: "",
    function: "getGridDataList",
    name: "Common/ModGrid",
    type: "modules",
    dataType: "json",
    arg,
    module_params: JSON.stringify(moduleParams(cfg)),
  }).toString();
  const res = await httpsReq(
    {
      host: HOST,
      path: AJAX,
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Content-Length": Buffer.byteLength(form),
        "X-Requested-With": "XMLHttpRequest",
        Referer: `https://${HOST}${SEARCH_PAGE}`,
        Cookie: cookie,
      },
    },
    form,
  );
  const json = JSON.parse(res.body) as { result?: { totalCount?: number; data?: Row[] } };
  return { totalCount: json.result?.totalCount ?? 0, rows: json.result?.data ?? [] };
}

// Most-recent filing year across a page of rows. Armenian case numbers end in the 2-digit year:
// "ԵԴ/0254/02/26" → 2026, "ՍնԴ/1818/04/26" → 2026. Returns null if none parse (caller then
// declines the recency-dependent blocker rather than guessing — see B-01 note above).
export function mostRecentCaseYear(rows: Row[]): number | null {
  let max: number | null = null;
  for (const r of rows) {
    const m = (r.case_number || "").match(/\/(\d{2})$/);
    if (m) {
      const y = 2000 + Number(m[1]);
      if (max === null || y > max) max = y;
    }
  }
  return max;
}

// datalex cases are session-bound but expose a replayable case URL via the external id. The
// detail page is captcha-gated, but the link still lets a human find the case (recon: "link
// users to the search page; store extracted content, not URLs").
export function caseUrl(row: Row | undefined): string {
  return row?.case_external_id ? `https://${HOST}/?app=AppCaseSearch&case_id=${row.case_external_id}` : `https://${HOST}${SEARCH_PAGE}`;
}

export const datalexAdapter: SourceAdapter = {
  domain: "court",
  source: "Datalex",
  async fetch(subject: Subject, now: string): Promise<AdapterResult> {
    const name = (subject.name || "").trim();
    if (!name) return { domain: "court", status: "verified_empty", facts: [], fetched_at: now, source: this.source };
    // Org-name search (sole-proprietor/person parties are a follow-up — src.am gives us org names).
    const asDefendant = { respondant_organization_name: name, resp_type: "organization" };
    const asPlaintiff = { claimant_organization_name: name, claimant_type: "organization" };
    try {
      const cookie = await getSession();
      // Three independent searches share the one PHP session; getGridDataList is self-contained
      // (filter lives in arg), so they run in parallel.
      const [def, pla, bkr] = await Promise.all([
        gridSearch(cookie, asDefendant, CIVIL),
        gridSearch(cookie, asPlaintiff, CIVIL),
        gridSearch(cookie, asDefendant, BANKRUPTCY),
      ]);
      // Court is matched by NAME (datalex has no TIN field); when the subject was TIN-resolved the
      // canonical name is authoritative, so we mirror azdarar's exact/fuzzy convention. Name
      // collisions remain possible → noted for the user; B-01 is gated on the debtor role + recency.
      const match = subject.tin ? "exact" : "fuzzy";
      const facts = [];
      if (def.totalCount > 0) {
        const yr = mostRecentCaseYear(def.rows);
        facts.push(
          makeFact({
            catalog_id: "F-CRT-02",
            subject: name,
            domain: "court",
            field: "defendant_cases",
            value: `Defendant in ${def.totalCount} civil case(s)${yr ? `; most recent ${yr}` : ""} (${def.rows[0]?.case_number || "—"})`,
            source: this.source,
            url: caseUrl(def.rows[0]),
            fetched_at: now,
            match,
          }),
        );
      }
      if (pla.totalCount > 0) {
        const yr = mostRecentCaseYear(pla.rows);
        facts.push(
          makeFact({
            catalog_id: "F-CRT-01",
            subject: name,
            domain: "court",
            field: "plaintiff_cases",
            value: `Plaintiff in ${pla.totalCount} civil case(s)${yr ? `; most recent ${yr}` : ""}`,
            source: this.source,
            url: caseUrl(pla.rows[0]),
            fetched_at: now,
            match,
          }),
        );
      }
      if (bkr.totalCount > 0) {
        const yr = mostRecentCaseYear(bkr.rows);
        facts.push(
          makeFact({
            catalog_id: "F-CRT-03",
            subject: name,
            domain: "court",
            field: "bankruptcy_cases",
            value: `Debtor in ${bkr.totalCount} bankruptcy case(s)${yr ? `; most recent ${yr}` : ""} (${bkr.rows[0]?.case_number || "—"})`,
            source: this.source,
            url: caseUrl(bkr.rows[0]),
            fetched_at: now,
            match,
          }),
        );
      }
      return { domain: "court", status: facts.length ? "verified" : "verified_empty", facts, fetched_at: now, source: this.source };
    } catch (e) {
      return { domain: "court", status: "unavailable", facts: [], fetched_at: now, source: this.source, error: e instanceof Error ? e.message : String(e) };
    }
  },
};
