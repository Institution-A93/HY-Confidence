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
// verdict OUTCOMES and open/closed STATUS are not retrievable. The claim AMOUNT, however, IS in the
// free grid — the row's `claim` field carries the plaintiff's full petitum text (recon 2026-06-24),
// so amounts need no captcha; only the awarded result does. Consequences:
//   • SN-01 is scaled by count + recency (NOT amount — separators in `claim` are ambiguous); the
//     demanded sum is surfaced as a narrative EXAMPLE only (see parseClaimAmount). [outcome: follow-up]
//   • WP-09 is "plaintiff in collection cases" — wins can't be confirmed (captcha); demanded sum shown.
//   • B-01 needs an OPEN bankruptcy; we infer "open" from recency (see datalex.ts caller), since
//     Armenian corporate bankruptcies run multi-year — a recent filing is almost certainly live.
import { request } from "node:https";
import type { AdapterResult, SourceAdapter, Subject } from "../lib/adapter";
import { makeFact } from "../lib/adapter";
import { stripLegal } from "../lib/normalize";
import { solveImageToText } from "../lib/capsolver";

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
  // The grid's Elasticsearch _source carries the plaintiff's full petitum text (the DEMANDED sum)
  // in `claim` — so claim AMOUNTS are free here. Only the OUTCOME (awarded/dismissed) is behind the
  // detail-view captcha (ModCaptcha "Մուտքագրեք նկարի տեքստը"), which we deliberately do not touch.
  claim?: string;
}

// Pull the principal demanded sum from a petitum. The amount we want follows the verb «բռնագանձել»
// (to collect/award); payment orders have no verb ("945.274 դրամի պ/մ") so we scan from the start.
// The number BEFORE «բռնագանձ» (law-article refs like "120-122-րդ հոդված") is thus skipped. Decimal
// vs thousands separators are inconsistent in the source (945.274 = 945k; 18,836,876,70 = ~18.8M),
// so we keep the grouping verbatim and only drop a 2-digit minor-unit tail — this is a DISPLAY
// example (demanded, not awarded), never a scored number; scoring stays on count + recency.
// Amount = digit groups separated by space/comma/dot (thousands) + optional 2-digit minor tail; OR a
// plain run. Grouped alt FIRST so "10 000 000" is taken whole (else it captures only the trailing "000").
const NUM = String.raw`\d{1,3}(?:[ .,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
// Currency unit, NOT the adjective «դրամային» ("dram-denominated", used for account/card descriptions
// like «...7001 դրամային քարտային հաշվին...»): the (?!ային) guard skips a masked card number's
// trailing digits and lands on the real «… ՀՀ դրամ» amount. Genitive «դրամի» (payment orders) still matches.
const CCY = String.raw`ՀՀ\s*դրամ(?!ային)|ԱՄՆ\s*դոլար|դրամ(?!ային)|դոլար`;
const CLAIM_RE = new RegExp(`(${NUM})\\D{0,80}?(${CCY})`);
export function parseClaimAmount(raw: string): string {
  const t = (raw || "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const verb = t.match(/բռնագանձ\S*/);
  const seg = verb ? t.slice(verb.index) : t;
  const m = seg.match(CLAIM_RE);
  if (!m) return "";
  const code = /դոլար/.test(m[2]) ? "USD" : "AMD";
  const num = m[1].replace(/[.,]\d{2}$/, ""); // drop a trailing lumas/cents group; keep digit grouping as-is
  return `${num} ${code}`;
}

// First parseable demanded sum across rows (already recency-desc), as a one-line "e.g." example.
function claimExampleFrom(rows: Row[]): string {
  for (const r of rows) {
    const a = parseClaimAmount(r.claim || "");
    if (a) return a;
  }
  return "";
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

// Binary GET (the captcha GIF). Reuses the session cookie that holds the case + captcha state.
function httpsGetBuffer(path: string, cookie: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = request({ host: HOST, path, method: "GET", headers: { "User-Agent": UA, Cookie: cookie } }, (res) => {
      const ch: Buffer[] = [];
      res.on("data", (c) => ch.push(c));
      res.on("end", () => resolve(Buffer.concat(ch)));
    });
    req.setTimeout(20000, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

function ajaxPost(cookie: string, params: Record<string, string>): Promise<{ headers: import("node:http").IncomingHttpHeaders; body: string }> {
  const form = new URLSearchParams(params).toString();
  return httpsReq(
    { host: HOST, path: AJAX, method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "Content-Length": Buffer.byteLength(form), "X-Requested-With": "XMLHttpRequest", Referer: `https://${HOST}${SEARCH_PAGE}`, Cookie: cookie } },
    form,
  );
}

// Read a bankruptcy case's merits verdict via the captcha-gated detail view (recon 2026-06-24):
// openCase sets the case in session + returns a captcha → GET the GIF (section_name=userRegKey) →
// solve (CapSolver) → showCase(ModCaseViewer, [text]) returns the detail HTML → parse the verdict.
// Best-effort: returns "unknown" without a CAPSOLVER_API_KEY or on ANY error, so the caller keeps the
// conservative recency-based B-01. One captcha per call; bankruptcies are few per entity. 3 retries
// (CapSolver isn't 100%). The openCase→showCase shape is non-obvious — see the recon notes.
async function bankruptcyVerdict(cookie: string, row: Row): Promise<"rejected" | "declared" | "unknown"> {
  if (!process.env.CAPSOLVER_API_KEY) return "unknown";
  try {
    const cd = { ...row, case_type: BANKRUPTCY.caseType, case_type_id: BANKRUPTCY.caseTypeID, search_description: BANKRUPTCY.gsd };
    const ocBody = (
      await ajaxPost(cookie, {
        appName: "AppCaseSearch", appPage: "default", moduleID: "Common/ModGrid", class: "", function: "openCase",
        name: "Common/ModGrid", type: "modules", dataType: "json", arg: JSON.stringify([cd]), module_params: JSON.stringify(moduleParams(BANKRUPTCY)),
      })
    ).body;
    const oc = JSON.parse(ocBody) as { result?: { html?: string }; module_params?: { ModCaseViewer?: Record<string, unknown> }; module_hierarchy?: { id: string; jsParams?: { captchaUrl?: string } }[] };
    let html = oc.result?.html || "";
    if (!/mod-captcha/.test(html)) return parseBankruptcyOutcome(html); // session already unlocked
    const mcv = oc.module_params?.ModCaseViewer;
    const captchaUrl = oc.module_hierarchy?.find((mm) => mm.id === "ModCaptcha")?.jsParams?.captchaUrl;
    if (!mcv || !captchaUrl) return "unknown";
    const capPath = captchaUrl.replace(/^https?:\/\/[^/]+/, ""); // path+query of file.php?...&section_name=userRegKey
    for (let attempt = 0; attempt < 3; attempt++) {
      const gif = await httpsGetBuffer(capPath, cookie);
      const text = (await solveImageToText(gif.toString("base64"))).trim();
      html =
        (
          JSON.parse(
            (
              await ajaxPost(cookie, {
                appName: "AppCaseSearch", appPage: "default", moduleID: String(mcv.moduleID), class: "", function: "showCase",
                name: "ModCaseViewer", type: "modules", dataType: "json", arg: JSON.stringify([text]), module_params: JSON.stringify(mcv),
              })
            ).body,
          ) as { result?: { html?: string } }
        ).result?.html || "";
      if (!/mod-captcha/.test(html)) return parseBankruptcyOutcome(html);
    }
    return "unknown";
  } catch {
    return "unknown";
  }
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

// datalex case URL via the external id. NOTE: facts currently carry url:"" (disabled ↗) — verified
// 2026-06-24 that ?app=AppCaseSearch&case_id=… only opens the search APP shell (no autoload; the
// detail is captcha-gated), i.e. a blank-search experience, not the case. Kept (+ tested) for when
// the detail captcha is solved (CapSolver), at which point facts can link here again.
export function caseUrl(row: Row | undefined): string {
  return row?.case_external_id ? `https://${HOST}/?app=AppCaseSearch&case_id=${row.case_external_id}` : `https://${HOST}${SEARCH_PAGE}`;
}

// Read the bankruptcy outcome from a (captcha-solved) case-detail page. We parse ONLY the merits
// VERDICT — the bankruptcy court's «Վ Ճ Ռ Ե Ց» (decided) operative clause — NOT the procedural
// «ՈՐՈՇԵՑ» rulings (admit-to-proceedings / appeal decisions), which also mention «սնանկ ճանաչ» and
// would mislead. In a verdict on a "declare bankrupt" petition: «…մերժել» = REJECTED (entity NOT
// bankrupt → B-01 must not block); otherwise it granted it → DECLARED. "declared" wins if both appear
// across verdicts (safe — keep the block); we only ACT on "rejected" (un-block). Conservative by
// design: a false "rejected" would hide a real bankruptcy, so anything unclear stays "unknown".
export function parseBankruptcyOutcome(detailHtml: string): "rejected" | "declared" | "unknown" {
  const txt = detailHtml.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ");
  const verdict = /[ՎV]\s?Ճ\s?Ռ\s?Ե\s?Ց/g; // «ՎՃՌԵՑ» — the merits verdict only
  let m: RegExpExecArray | null;
  let declared = false;
  let rejected = false;
  while ((m = verdict.exec(txt))) {
    const seg = txt.slice(m.index, m.index + 280);
    if (!/սնանկ\s*ճանաչ/.test(seg)) continue; // a verdict on a declare-bankrupt petition
    if (/մերժ/.test(seg)) rejected = true;
    else declared = true;
  }
  return declared ? "declared" : rejected ? "rejected" : "unknown";
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
        // Civil petita first (the «բռնագանձել <sum>» form anchored on); payment orders are a
        // fallback — their dotted-thousands form ("945.274") reads ambiguously as a decimal.
        const claim = claimExampleFrom([...def.rows, ...pay.rows]);
        facts.push(
          makeFact({
            catalog_id: "F-CRT-02",
            subject: name,
            domain: "court",
            field: "defendant_cases",
            value: `Defendant: ${parts.join(", ")}${yr ? `; most recent ${yr}` : ""}${claim ? `; claim e.g. ${claim}` : ""} (${rows[0]?.case_number || "—"})`,
            source: this.source,
            url: "", // disabled ↗ — case_id link opens the search app, not the (captcha-gated) case
            fetched_at: now,
            match,
          }),
        );
      }
      if (pla.count > 0) {
        const yr = mostRecentCaseYear(pla.rows);
        const claim = claimExampleFrom(pla.rows);
        facts.push(
          makeFact({
            catalog_id: "F-CRT-01",
            subject: name,
            domain: "court",
            field: "plaintiff_cases",
            value: `Plaintiff in ${pla.count} civil case(s)${yr ? `; most recent ${yr}` : ""}${claim ? `; claim e.g. ${claim}` : ""}`,
            source: this.source,
            url: "", // disabled ↗ — see caseUrl note
            fetched_at: now,
            match,
          }),
        );
      }
      if (bkr.count > 0) {
        const yr = mostRecentCaseYear(bkr.rows);
        // Read the newest bankruptcy case's verdict via the captcha-gated detail (CapSolver). A
        // REJECTED declare-bankrupt petition means the entity is NOT bankrupt → the caller suppresses
        // B-01 (avoids a false block, e.g. Araratcement). No key / unclear → "unknown" → B-01 as before.
        const outcome = bkr.rows[0] ? await bankruptcyVerdict(cookie, bkr.rows[0]) : "unknown";
        facts.push(
          makeFact({
            catalog_id: "F-CRT-03",
            subject: name,
            domain: "court",
            field: "bankruptcy_cases",
            value: `Debtor in ${bkr.count} bankruptcy case(s)${yr ? `; most recent ${yr}` : ""}${outcome !== "unknown" ? `; verdict: ${outcome}` : ""} (${bkr.rows[0]?.case_number || "—"})`,
            source: this.source,
            url: "", // disabled ↗ — see caseUrl note
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
