// F-PRC-01 — state procurement wins (armeps.am PPCM). Feeds SP-03 (a POSITIVE signal: a company
// that wins public tenders is real, operating, and passed a buyer's due diligence).
//
// RECON CORRECTION (2026-06-23): the spec/recon planned to "iterate award announcements into a local
// index" because gnumner exposes no supplier search. That fallback is RETIRED — armeps PPCM exposes
// a clean PUBLIC JSON API (no captcha, no Cloudflare, valid TLS) that IS supplier-queryable and
// returns the winner name + TIN. gnumner is dropped from F-PRC-01 (it only serves aggregate stats).
//
// TRANSPORT (two steps, both POST application/json under https://armeps.am/ppcm/public/…):
//   1. /autocomplete/get-supplier-list  {value:<name fragment>}  → [{id, taxpayerId, name, …}]
//      The `id` is a UUID, NOT the TIN; the filter below takes the id. So we autocomplete by NAME,
//      then CONFIRM the match by taxpayerId === subject.tin (match=exact) — autocomplete cannot be
//      queried by TIN directly. Names are free-form (often Latin transliteration) with occasional
//      encoding corruption, so a name-only query (no TIN) is genuinely fuzzy.
//   2. /contracts/count + /contracts/list  {filter:<full filter>, order, page}
//      The list endpoint 500s unless the filter carries ALL keys (count is lenient); the order field
//      uses SNAKE_CASE column names ("date_signed", not "dateSigned"). The dateSigned RANGE filter
//      has an undocumented format that 500s, so we DON'T use it — we fetch newest-first and apply the
//      SP-03 "≤36 months" window in code against each row's dateSigned (epoch ms).
import { request } from "node:https";
import type { AdapterResult, SourceAdapter, Subject } from "../lib/adapter";
import { makeFact } from "../lib/adapter";
import { toLatinKey } from "../lib/normalize";

const HOST = "armeps.am";
const BASE = "/ppcm/public";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";
const RECENT_PAGE = 50; // newest-first window scanned for the ≤36mo SP-03 test (binary signal — exact count beyond this doesn't matter)

interface Supplier {
  id: string; // UUID — what the contracts filter takes
  taxpayerId: string;
  name: string;
}

interface Contract {
  dateSigned: number; // epoch ms
  contractValue: number;
  procurementSubject: string;
  tenderTitle?: string;
  tenderTitleEn?: string;
  authorityNameEn?: string;
  authorityNameHy?: string;
  number?: string;
  supplierTaxpayerId?: string;
}

function postJson<T>(path: string, payload: unknown): Promise<T> {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  return new Promise((resolve, reject) => {
    const req = request(
      { host: HOST, path: `${BASE}${path}`, method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/json", "Content-Length": body.length } },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const json = JSON.parse(data) as { status: number; data: T };
            // PPCM wraps errors as {status:500,data:null} with HTTP 200 — treat as a failure.
            if (json.status !== 0) reject(new Error(`PPCM status ${json.status}`));
            else resolve(json.data);
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        });
      },
    );
    req.setTimeout(25000, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// The list endpoint rejects a partial filter — send the full shape the frontend sends, with only
// `suppliers` populated.
function fullFilter(supplierId: string) {
  return {
    periods: [],
    contracts: [],
    authorities: [],
    suppliers: [supplierId],
    forms: [],
    totalValue: { min: null, max: null },
    latestValue: { min: null, max: null },
    dateSigned: { min: null, max: null },
    dateSubmitted: { min: null, max: null },
    number: null,
    procurementSubject: null,
    procurementSubjectCode: null,
    procurementSubjectObj: null,
    year: null,
  };
}

// Pick the supplier that best matches the subject. A TIN match is authoritative (→ exact); else fall
// back to the closest name (→ fuzzy). Returns null when nothing plausibly matches.
export function pickSupplier(list: Supplier[], subject: Subject): { supplier: Supplier; match: "exact" | "fuzzy" } | null {
  if (subject.tin) {
    const byTin = list.find((s) => s.taxpayerId === subject.tin);
    if (byTin) return { supplier: byTin, match: "exact" };
  }
  const qKey = toLatinKey(subject.name || "");
  if (!qKey) return null;
  // Closest by normalized Latin key: prefer an exact key equality, else a containment either way.
  const exact = list.find((s) => toLatinKey(s.name) === qKey);
  if (exact) return { supplier: exact, match: "fuzzy" };
  const contains = list.find((s) => {
    const k = toLatinKey(s.name);
    return k && (k.includes(qKey) || qKey.includes(k));
  });
  return contains ? { supplier: contains, match: "fuzzy" } : null;
}

function amount(n: number): string {
  return n ? `${n.toLocaleString("en-US")} AMD` : "—";
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export const procurementAdapter: SourceAdapter = {
  domain: "procurement",
  source: "Procurement (armeps.am)",
  async fetch(subject: Subject, now: string): Promise<AdapterResult> {
    const name = (subject.name || "").trim();
    if (!name && !subject.tin) {
      return { domain: "procurement", status: "verified_empty", facts: [], fetched_at: now, source: this.source };
    }
    try {
      // Autocomplete is a NAME substring match (can't query by TIN), so seed it with the name.
      const list = await postJson<Supplier[]>("/autocomplete/get-supplier-list", { value: name });
      const picked = pickSupplier(list || [], subject);
      if (!picked) {
        // Queried successfully, no supplier matched. SP-03 is a positive signal, so a false-empty only
        // FAILS TO AWARD credit (conservative/safe) — it must never be read as "not a real company".
        return { domain: "procurement", status: "verified_empty", facts: [], fetched_at: now, source: this.source };
      }
      const filter = fullFilter(picked.supplier.id);
      const total = await postJson<number>("/contracts/count", { filter });
      const rows = await postJson<Contract[]>("/contracts/list", {
        filter,
        order: { field: "date_signed", ascending: false }, // snake_case column; newest first
        page: { index: 0, size: RECENT_PAGE },
      });
      // SP-03 window = wins signed in the last 36 months (spec §3). Apply it in code (the API's date
      // range filter has an undocumented, 500-prone format).
      const cut = new Date(now);
      cut.setMonth(cut.getMonth() - 36);
      const cutMs = cut.getTime();
      const recent = (rows || []).filter((r) => r.dateSigned >= cutMs);
      if (recent.length === 0) {
        // Has (old) contracts but none in the SP-03 window → no positive signal, but record nothing
        // negative either (old wins aren't a risk). Queried-empty for the signal layer.
        return { domain: "procurement", status: "verified_empty", facts: [], fetched_at: now, source: this.source };
      }
      const top = recent[0]; // newest
      const recentLabel = recent.length === RECENT_PAGE ? `${RECENT_PAGE}+` : `${recent.length}`;
      const buyer = top.authorityNameEn || top.authorityNameHy || "";
      const title = top.tenderTitleEn || top.tenderTitle || top.procurementSubject || "";
      const fact = makeFact({
        catalog_id: "F-PRC-01",
        subject: name || subject.tin || "",
        domain: "procurement",
        field: "procurement_wins",
        value:
          `${recentLabel} state-procurement win(s) in the last 36 months${total > recent.length ? ` (${total} all-time)` : ""}; ` +
          `most recent: ${title ? `${title.slice(0, 80)} — ` : ""}${amount(top.contractValue)}, ${isoDate(top.dateSigned)}${buyer ? `, buyer ${buyer}` : ""}`,
        source: this.source,
        url: `https://${HOST}/ppcm/#/public/contracts`,
        fetched_at: now,
        match: picked.match, // exact only when the supplier's taxpayerId === subject.tin
      });
      return { domain: "procurement", status: "verified", facts: [fact], fetched_at: now, source: this.source };
    } catch (e) {
      return { domain: "procurement", status: "unavailable", facts: [], fetched_at: now, source: this.source, error: e instanceof Error ? e.message : String(e) };
    }
  },
};
