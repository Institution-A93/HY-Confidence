// F-PLG-01 — movable-property pledge register (registration.am, "Շարժական Գույքի Նկատմամբ
// Ապահովված Իրավունքների Գրանցամատյան", MoJ State Register). Name-keyed source: query with the
// CANONICAL Armenian name (from the src.am resolver), since the register is Armenian-indexed.
//
// RECON CORRECTION (2026-06-23): the spec marked the pledge register "access tier unconfirmed,
// likely under the e-register umbrella / paid extract" — WRONG. It is its own site, fully PUBLIC
// (no login, no captcha, no fee for searching). The login box on the page is for FILERS
// (banks/notaries registering pledges), not a search gate. So this is a plain-HTTP adapter — no
// headless, no proxy — and the coverage denominator stays at 10 (it does not drop to 9).
//
// TRANSPORT: same BARL `?app=AppX` family as datalex.am. One GET of the search page seeds a
// PHPSESSID; each search is a server-rendered POST (NOT a JSON/jqGrid API — the results render as
// an HTML table into #result_grid). Org search uses the advSearch mode with the organization name
// (or the state-registry number). No CSRF token is required.
//
// Result columns (verified live): registration type | movable property | registration date |
// Պարտատեր (creditor) | Պարտապան (debtor/pledgor) | view icon. We score only "Ծանրաբեռնում"
// (encumbrance/pledge) rows; "Սահմանափակում" (restriction — e.g. tax-authority liens) is a
// DIFFERENT, second signal worth a follow-up, not part of SN-06.
import { request } from "node:https";
import type { AdapterResult, SourceAdapter, Subject } from "../lib/adapter";
import { makeFact } from "../lib/adapter";
import { stripLegal } from "../lib/normalize";

const HOST = "registration.am";
const SEARCH_PAGE = "/?app=AppSearch";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";

// Encumbrance type that means an actual pledge (vs "Սահմանափակում" = a restriction/lien).
const PLEDGE_TYPE = "Ծանրաբեռնում";

interface PledgeRow {
  regType: string; // column 2 — Ծանրաբեռնում / Սահմանափակում
  date: string; // column 4 — DD-MM-YYYY HH:MM:SS
  creditor: string; // column 5 — Պարտատեր
  debtor: string; // column 6 — Պարտապան (may be a comma-separated co-debtor list)
  caseUrl: string; // data-case_url (replayable AppCaseView detail link)
}

function httpsReq(opts: import("node:https").RequestOptions, body?: Buffer): Promise<{ headers: import("node:http").IncomingHttpHeaders; body: string }> {
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

async function getSession(): Promise<string> {
  const page = await httpsReq({ host: HOST, path: SEARCH_PAGE, method: "GET", headers: { "User-Agent": UA } });
  const cookie = (page.headers["set-cookie"] || []).map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error("no PHPSESSID");
  return cookie;
}

// Comparable key: drop legal forms + «»quotes (stripLegal) and every non-letter, so case, spacing,
// «», and ՍՊԸ/ՓԲԸ suffixes don't matter when deciding whether a listed debtor IS the queried entity.
// (Mirrors datalex.ts nameKey/partyMatchesQuery — kept local to avoid coupling the pledge adapter to
// the court adapter; consolidate into normalize.ts once both are stable.)
export function nameKey(s: string): string {
  return stripLegal(s).toLowerCase().replace(/[^a-z0-9ա-և]/g, "");
}

// The debtor column can list several co-debtors ("ՊՐԱՅՄՍՏՈՆ, ՍՊԱՅԿԱ"), and the name search is a
// substring match, so keep a row only if ONE listed debtor IS the queried entity — its key equals
// the query key (allowing a short unstripped form, ≤4 extra chars) — not merely contains it inside a
// longer, different name. (Cannot split two DIFFERENT firms sharing the identical name — needs a TIN.)
export function debtorMatchesQuery(debtorField: string, queryKey: string): boolean {
  if (!queryKey) return false;
  return debtorField.split(/[,،;]/).some((p) => {
    const k = nameKey(p);
    return k === queryKey || (k.startsWith(queryKey) && k.length - queryKey.length <= 4);
  });
}

export function parseRows(html: string): PledgeRow[] {
  const out: PledgeRow[] = [];
  for (const m of html.matchAll(/<tr class="case_row"[^>]*data-case_url="([^"]*)"[\s\S]*?<\/tr>/g)) {
    const tds = [...m[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) =>
      x[1].replace(/<[^>]+>/g, "").replace(/&laquo;|&raquo;/g, "«").replace(/\s+/g, " ").trim(),
    );
    if (tds.length < 6) continue;
    out.push({ regType: tds[1], date: tds[3], creditor: tds[4], debtor: tds[5], caseUrl: m[1] });
  }
  return out;
}

// "No results" renders a warning box ("...արդյունքներ չեն գտնվել..."), so an empty grid is a real
// verified_empty — distinguishable from a fetch failure (R-09: queried-empty ≠ could-not-query).
function isEmptyResult(html: string): boolean {
  return /չեն գտնվել/.test(html);
}

// "30-01-2026 11:33:12" → "30-01-2026" (date only; the time is noise for scoring).
function dateOnly(d: string): string {
  return (d.match(/(\d{2}-\d{2}-\d{4})/) || [])[1] || "";
}

export const pledgeAdapter: SourceAdapter = {
  domain: "pledge",
  source: "Pledge Register (registration.am)",
  async fetch(subject: Subject, now: string): Promise<AdapterResult> {
    const name = (subject.name || "").trim();
    if (!name) return { domain: "pledge", status: "verified_empty", facts: [], fetched_at: now, source: this.source };
    try {
      const cookie = await getSession();
      const form = new URLSearchParams({
        ModCaseSearchAction: "advSearch",
        "data[mode]": "m_adv_search",
        "data[burdensome_person][partner_display_type]": "organization",
        "data[burdensome_person][organization][organization_name]": name,
        "data[burdensome_person][organization][state_registry_number]": "",
        "data[pos_num]": "1",
        "data[reg_date_sort]": "desc", // newest first → row[0] is the most-recent pledge
      });
      const body = Buffer.from(form.toString(), "utf8");
      const res = await httpsReq(
        {
          host: HOST,
          path: SEARCH_PAGE,
          method: "POST",
          headers: {
            "User-Agent": UA,
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Content-Length": body.length,
            "X-Requested-With": "XMLHttpRequest",
            Referer: `https://${HOST}${SEARCH_PAGE}`,
            Cookie: cookie,
          },
        },
        body,
      );
      if (isEmptyResult(res.body)) {
        return { domain: "pledge", status: "verified_empty", facts: [], fetched_at: now, source: this.source };
      }
      // Keep only PLEDGE rows whose debtor IS this entity (drops co-debtors and same-substring
      // namesakes). Restriction/lien rows ("Սահմանափակում") are a separate signal — excluded here.
      const key = nameKey(name);
      const pledges = parseRows(res.body).filter((r) => r.regType === PLEDGE_TYPE && debtorMatchesQuery(r.debtor, key));
      if (pledges.length === 0) {
        return { domain: "pledge", status: "verified_empty", facts: [], fetched_at: now, source: this.source };
      }
      // reg_date_sort=desc already ordered them; row[0] is the most-recent pledge.
      const top = pledges[0];
      const creditors = Array.from(new Set(pledges.map((p) => p.creditor).filter(Boolean)));
      const credLabel = creditors.slice(0, 2).join(", ") + (creditors.length > 2 ? `, +${creditors.length - 2}` : "");
      const fact = makeFact({
        catalog_id: "F-PLG-01",
        subject: name,
        domain: "pledge",
        field: "pledges",
        value: `${pledges.length} movable-property pledge(s); most recent ${dateOnly(top.date)}${credLabel ? ` (creditor: ${credLabel})` : ""}`,
        source: this.source,
        // No deep link: the AppCaseView case URL is session-bound — opened cold it 302-redirects to
        // «session_expired» (verified 2026-06-24), not the pledge detail, so url:"" (disabled ↗).
        url: "",
        fetched_at: now,
        // Name-matched (the register has a TIN/registry-number field, but we key by name from the
        // resolver and cannot split two same-name firms) → R-08 damps SN-06 ×0.7. De-fuzzing via the
        // state-registry-number field (and the number shown on the detail page) is a follow-up.
        match: "fuzzy",
      });
      return { domain: "pledge", status: "verified", facts: [fact], fetched_at: now, source: this.source };
    } catch (e) {
      return { domain: "pledge", status: "unavailable", facts: [], fetched_at: now, source: this.source, error: e instanceof Error ? e.message : String(e) };
    }
  },
};
