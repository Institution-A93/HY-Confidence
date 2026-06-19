// F-NTC-01 — Azdarar official public notifications (liquidation, bankruptcy, capital
// reduction, reorganization, creditor calls). Name-keyed source: query with the CANONICAL
// Armenian name (from the src.am resolver), since Azdarar indexes Armenian text.
//   GET azdarar.am/hy/public-announcement/search-result/?query=<name>
// returns an HTML result table; each row links to /view/<uuid>. Node-only (node:https).
import { get } from "node:https";
import type { AdapterResult, SourceAdapter, Subject } from "../lib/adapter";
import { makeFact } from "../lib/adapter";

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

function parseNotices(html: string): Notice[] {
  const out: Notice[] = [];
  const blocks = html.split(`data-href="https://azdarar.am/hy/public-announcement/view/`);
  for (const b of blocks.slice(1)) {
    const uuid = b.slice(0, 36);
    const cells = [...b.matchAll(/result-table-cell[^>]*>([\s\S]*?)<\/div>/g)]
      .map((m) => m[1].replace(/<[^>]+>/g, "").replace(/&laquo;|&raquo;/g, "«").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const title = cells.find((c) => c.length > 20) || cells[0] || "";
    const date = (b.match(/(\d{2}\.\d{2}\.\d{4})/) || [])[1] || "";
    if (title) out.push({ title, date, uuid, type: classify(title) });
  }
  return out;
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
      const notices = parseNotices(html).filter((n) => n.type !== "other");
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
