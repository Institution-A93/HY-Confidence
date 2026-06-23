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
import { stripLegal } from "../lib/normalize";

const HOST = "datalex.am";
const SEARCH_PAGE = "/?app=AppCaseSearch";
const AJAX = "/json.php";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";

// Case-type configs (from the page's BARL.MODULE_PARAMS for each ?tab=…). The grid needs the
// matching gridSearchDescription/caseTypeID or it returns the wrong index.
const CIVIL = { gsd: "datalex_civ_case_info", caseType: "civil", caseTypeID: 2 } as const;
const BANKRUPTCY = { gsd: "datalex_bankr_case_info", caseType: "bankruptcy", caseTypeID: 3 } as const;
// Payment orders (Վճարման կարգադրություն): a creditor obtained an order against the respondant →
// an unambiguous "owes money" signal (cleaner than general civil litigation for SN-01).
const PAYMENT = { gsd: "datalex_paym_case_info", caseType: "payment_order", caseTypeID: 6 } as const;
type CaseConfig = typeof CIVIL | typeof BANKRUPTCY | typeof PAYMENT;

type Role = "defendant" | "plaintiff";
const ROLE_FIELD: Record<Role, { name: string; type: string }> = {
  defendant: { name: "respondant_organization_name", type: "resp_type" },
  plaintiff: { name: "claimant_organization_name", type: "claimant_type" },
};

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
  // 100 rows (not 20) so the token-containment guard below has a real sample to filter; totalCount
  // still carries the full count for scaling when there are more pages than this.
  const pagination = { page: 1, rows: 100, sidx: "", sord: "desc", _search: false, nd: 0 };
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

// Search one role on one case-type. Datalex PHRASE-matches the party name, so a trailing descriptor
// word in src.am's canonical name (ԳՐՈՒՊ "Group", ՀՈԼԴԻՆԳ "Holding") over-specifies vs how the
// courts name the party and returns 0 (e.g. «ԱՐԱՐԱՏ ՑԵՄԵՆՏ ԳՐՈՒՊ» → 0, «ԱՐԱՐԱՏ ՑԵՄԵՆՏ» → 20). So if a
// ≥3-word name finds nothing, retry once with the last word dropped — the distinctive tokens lead,
// descriptors trail; staying ≥2 words keeps it specific.
interface NamedResult extends GridResult {
  usedName: string; // the name actually searched (may be the retry-trimmed one) — what the guard checks against
}

async function gridSearchByName(cookie: string, role: Role, name: string, cfg: CaseConfig, retry = true): Promise<NamedResult> {
  const { name: nameField, type: typeField } = ROLE_FIELD[role];
  const run = (n: string) => gridSearch(cookie, { [nameField]: n, [typeField]: "organization" }, cfg);
  const first = await run(name);
  const words = name.split(/\s+/).filter(Boolean);
  // The retry trades precision for recall — fine for the non-blocking civil/payment signals, but the
  // caller DISABLES it for bankruptcy (retry=false): B-01 is a hard veto, and a broadened name could
  // match a namesake's old bankruptcy and falsely BLOCK an active company.
  if (retry && first.totalCount === 0 && words.length >= 3) {
    const trimmed = words.slice(0, -1).join(" ");
    return { ...(await run(trimmed)), usedName: trimmed };
  }
  return { ...first, usedName: name };
}

// Comparable key: drop legal forms + «»quotes (stripLegal) and every non-letter, so case, spacing,
// «», and ՍՊԸ/ՓԲԸ suffixes don't matter when deciding whether a party IS the queried entity.
export function nameKey(s: string): string {
  return stripLegal(s).toLowerCase().replace(/[^a-z0-9ա-և]/g, "");
}

// TOKEN-CONTAINMENT GUARD. Datalex name search is a normalized substring/token match, so a query
// over-matches: «ԱՊԱՎԵՆ» also returns «Ապավեն Տերմինալ» / «Հույսի Ապավեն» (different firms) and
// multi-party rows; «Գրանդ» returns 36 different "Grand …" companies. A datalex party field can
// list several co-parties ("A ՍՊԸ, B ՓԲԸ, …"), so we keep a row only if ONE listed party IS the
// queried entity — its key equals the query key (allowing an unstripped short form, ≤4 extra chars)
// — not merely contains it inside a longer, different name. (This still cannot split two DIFFERENT
// entities that share the IDENTICAL name, e.g. the active vs liquidated «ԱՊԱՎԵՆ» — that needs a TIN/graph.)
export function partyMatchesQuery(partyField: string, queryKey: string): boolean {
  if (!queryKey) return false;
  return partyField.split(/[,،;]/).some((p) => {
    const k = nameKey(p);
    return k === queryKey || (k.startsWith(queryKey) && k.length - queryKey.length <= 4);
  });
}

interface Guarded {
  count: number;
  rows: Row[];
}

// Filter a result to rows that really concern the queried entity, then project the full totalCount
// through the observed keep-ratio (datalex returns the true totalCount but only one page of rows).
// When totalCount ≤ the page we fetched, the guarded count is exact.
function applyGuard(res: NamedResult, side: "respondant_name" | "claimant_name"): Guarded {
  const key = nameKey(res.usedName);
  const rows = res.rows.filter((r) => partyMatchesQuery(r[side] || "", key));
  const count = res.rows.length === 0 ? 0 : res.totalCount <= res.rows.length ? rows.length : Math.round((res.totalCount * rows.length) / res.rows.length);
  return { count, rows };
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
    try {
      const cookie = await getSession();
      // Four independent searches share the one PHP session (getGridDataList is self-contained), so
      // they run in parallel: defendant + plaintiff (civil), debtor (bankruptcy), debtor (payment order).
      const [defR, plaR, bkrR, payR] = await Promise.all([
        gridSearchByName(cookie, "defendant", name, CIVIL),
        gridSearchByName(cookie, "plaintiff", name, CIVIL),
        gridSearchByName(cookie, "defendant", name, BANKRUPTCY, false), // strict: B-01 must not false-block on a namesake
        gridSearchByName(cookie, "defendant", name, PAYMENT),
      ]);
      // Token-containment guard: keep only the rows whose matched party IS this entity (drops
      // co-parties and same-substring namesakes like «Ապավեն Տերմինալ»), and scale the count.
      const def = applyGuard(defR, "respondant_name");
      const pla = applyGuard(plaR, "claimant_name");
      const bkr = applyGuard(bkrR, "respondant_name");
      const pay = applyGuard(payR, "respondant_name");
      // Court facts are ALWAYS name-matched: datalex has no TIN field, so even a TIN-resolved subject's
      // cases are found by name and can include a same-name entity (e.g. an active and a liquidated
      // «ԱՊԱՎԵՆ» share one case set). So we mark court "fuzzy" regardless of subject.tin → R-08 damps the
      // scored court signals (SN-01/WP-09) ×0.7, reflecting that the data may not be this exact TIN.
      // This is a stopgap until the affiliation graph (e-register login) can disambiguate by owner;
      // B-01 stays a veto (blockers aren't damped) but is gated on the debtor role + recency.
      const match = "fuzzy" as const;
      const facts = [];
      // F-CRT-02 folds civil-defendant + payment-order debt exposure into one fact; payment orders
      // are the clean "owes money" half (deriveSignals prefers them for SN-01).
      if (def.count > 0 || pay.count > 0) {
        const rows = def.rows.length ? def.rows : pay.rows;
        const yr = mostRecentCaseYear([...def.rows, ...pay.rows]);
        const parts: string[] = [];
        if (def.count > 0) parts.push(`${def.count} civil case(s)`);
        if (pay.count > 0) parts.push(`${pay.count} payment-order(s)`);
        facts.push(
          makeFact({
            catalog_id: "F-CRT-02",
            subject: name,
            domain: "court",
            field: "defendant_cases",
            value: `Defendant: ${parts.join(", ")}${yr ? `; most recent ${yr}` : ""} (${rows[0]?.case_number || "—"})`,
            source: this.source,
            url: caseUrl(rows[0]),
            fetched_at: now,
            match,
          }),
        );
      }
      if (pla.count > 0) {
        const yr = mostRecentCaseYear(pla.rows);
        facts.push(
          makeFact({
            catalog_id: "F-CRT-01",
            subject: name,
            domain: "court",
            field: "plaintiff_cases",
            value: `Plaintiff in ${pla.count} civil case(s)${yr ? `; most recent ${yr}` : ""}`,
            source: this.source,
            url: caseUrl(pla.rows[0]),
            fetched_at: now,
            match,
          }),
        );
      }
      if (bkr.count > 0) {
        const yr = mostRecentCaseYear(bkr.rows);
        facts.push(
          makeFact({
            catalog_id: "F-CRT-03",
            subject: name,
            domain: "court",
            field: "bankruptcy_cases",
            value: `Debtor in ${bkr.count} bankruptcy case(s)${yr ? `; most recent ${yr}` : ""} (${bkr.rows[0]?.case_number || "—"})`,
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
