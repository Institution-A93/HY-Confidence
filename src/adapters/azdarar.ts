// F-NTC-01 — Azdarar official public notifications (liquidation, bankruptcy, capital
// reduction, reorganization, creditor calls). Name-keyed source: query with the CANONICAL
// Armenian name (from the src.am resolver), since Azdarar indexes Armenian text.
//   GET azdarar.am/hy/public-announcement/search-result/?query=<name>
// returns an HTML result table; each row links to /view/<uuid>. Node-only (node:https).
import { get } from "node:https";
import type { AdapterResult, SourceAdapter, Subject } from "../lib/adapter";
import { makeFact } from "../lib/adapter";
import { legalNameKey } from "../lib/normalize";

const HOST = "azdarar.am";
const SEARCH = "/hy/public-announcement/search-result/";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";

type NoticeType = "bankruptcy" | "liquidation" | "capital_reduction" | "reorganization" | "creditor_call" | "other";
const SEVERITY: NoticeType[] = ["bankruptcy", "liquidation", "capital_reduction", "creditor_call", "reorganization", "other"];

interface Notice {
  title: string;
  date: string;
  uuid: string;
  type: NoticeType;
}

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

function classify(t: string): NoticeType {
  if (/սնանկ/.test(t)) return "bankruptcy";
  if (/լուծար/.test(t)) return "liquidation";
  if (/կապիտալ/.test(t) && /նվազ/.test(t)) return "capital_reduction";
  if (/վերակազմակերպ/.test(t)) return "reorganization";
  if (/պարտատեր/.test(t)) return "creditor_call";
  return "other";
}

// Each result row is a <tr ... data-href=".../view/<uuid>"> of <td class="…result-table-cell…">
// cells. Column order (verified live 2026-06-24): [0] category, [1] TITLE/subject, [2] body
// snippet, [3] —, [4] date. The title names the notice's SUBJECT (the bankrupt/liquidated party);
// the body snippet may name OTHER parties (e.g. a creditor) — so the subject guard below keys on
// the title cell, never the body. (The old parser keyed cells on </div>; the markup uses <span>.)
export function parseNotices(html: string): Notice[] {
  const out: Notice[] = [];
  const rowRe = /<tr class="list__result-table-drow[^"]*"[^>]*data-href="https:\/\/azdarar\.am\/hy\/public-announcement\/view\/([0-9a-f-]{36})">([\s\S]*?)<\/tr>/g;
  for (const m of html.matchAll(rowRe)) {
    const uuid = m[1];
    const cells = [...m[2].matchAll(/<td class="list__result-table-cell[^"]*">([\s\S]*?)<\/td>/g)].map((c) =>
      c[1].replace(/<[^>]+>/g, " ").replace(/&laquo;|&raquo;/g, "«").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim(),
    );
    const title = cells[1] || cells.find((c) => c.length > 20) || cells[0] || "";
    const date = (m[2].match(/(\d{2}\.\d{2}\.\d{4})/) || [])[1] || "";
    if (title) out.push({ title, date, uuid, type: classify(title) });
  }
  return out;
}

// Azdarar's search is FULL-TEXT, so it also returns notices where the entity is merely mentioned in
// the body — most damagingly as a CREDITOR (Պարտատեր) on someone else's bankruptcy. Attributing
// those to the entity falsely fires B-02/SN-04 (e.g. Ameriabank, listed as creditor on a debtor's
// bankruptcy, read as bankrupt itself — and likewise every large lender). A distress notice is the
// entity's own ONLY when the entity is its SUBJECT, i.e. named in the TITLE. Armenian declension
// appends the genitive «-ի» to the name, so substring-on-normalized-key matches «ԱՄԵՐԻԱԲԱՆԿ» inside
// the title's «ԱՄԵՐԻԱԲԱՆԿ»-ի; a false negative (truncated title) only fails to flag — the safe side.
export function titleNamesEntity(title: string, name: string): boolean {
  const qKey = legalNameKey(name);
  return !!qKey && legalNameKey(title).includes(qKey);
}

const LABEL: Record<NoticeType, string> = {
  bankruptcy: "Bankruptcy notice",
  liquidation: "Liquidation notice",
  capital_reduction: "Capital-reduction notice",
  creditor_call: "Creditor-call notice",
  reorganization: "Reorganization notice",
  other: "Notice",
};

export const azdararAdapter: SourceAdapter = {
  domain: "notice",
  source: "Azdarar",
  async fetch(subject: Subject, now: string): Promise<AdapterResult> {
    const name = (subject.name || "").trim();
    if (!name) return { domain: "notice", status: "verified_empty", facts: [], fetched_at: now, source: this.source };
    try {
      const html = await httpsGet(`${SEARCH}?query=${encodeURIComponent(name)}`);
      // F-NTC-01 is about distress notices (liquidation/bankruptcy/capital/creditor/reorg);
      // unrelated "other" notices (e.g. court summonses) are not scored → queried-empty.
      // titleNamesEntity drops notices where the entity is only a mentioned party (e.g. creditor),
      // keeping only ones where it is the SUBJECT — see the guard's rationale above.
      const notices = parseNotices(html).filter((n) => n.type !== "other" && titleNamesEntity(n.title, name));
      if (notices.length === 0) {
        return { domain: "notice", status: "verified_empty", facts: [], fetched_at: now, source: this.source };
      }
      notices.sort((a, b) => SEVERITY.indexOf(a.type) - SEVERITY.indexOf(b.type));
      const top = notices[0];
      const value = `${LABEL[top.type]}${top.date ? ` (${top.date})` : ""}: ${top.title.slice(0, 140)}`;
      const fact = makeFact({
        catalog_id: "F-NTC-01",
        subject: name,
        domain: "notice",
        field: "notices",
        value,
        source: this.source,
        url: `https://azdarar.am/hy/public-announcement/view/${top.uuid}`,
        fetched_at: now,
        match: subject.tin ? "exact" : "fuzzy",
      });
      return { domain: "notice", status: "verified", facts: [fact], fetched_at: now, source: this.source };
    } catch (e) {
      return { domain: "notice", status: "unavailable", facts: [], fetched_at: now, source: this.source, error: e instanceof Error ? e.message : String(e) };
    }
  },
};
