// F-WEB-01 — .am domain vintage via AMNIC WHOIS (source-access-spec.md §10). Standard
// whois protocol over TCP:43 to whois.amnic.net — no scraping, no library. Node-only
// (node:net); kept out of the browser bundle. Returns the registration date when present.
import { connect } from "node:net";
import type { AdapterResult, SourceAdapter, Subject } from "../lib/adapter";
import { makeFact } from "../lib/adapter";

const WHOIS_HOST = "whois.amnic.net";
const WHOIS_PORT = 43;

function whoisQuery(domain: string, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = connect({ host: WHOIS_HOST, port: WHOIS_PORT });
    let data = "";
    sock.setTimeout(timeoutMs);
    sock.on("connect", () => sock.write(domain + "\r\n"));
    sock.on("data", (chunk) => (data += chunk.toString("utf8")));
    sock.on("end", () => resolve(data));
    sock.on("timeout", () => {
      sock.destroy();
      reject(new Error("whois timeout"));
    });
    sock.on("error", reject);
  });
}

function parseRegistered(raw: string): string | null {
  // AMNIC prints a "registered:" line (date). Fall back to a generic date label.
  const m = raw.match(/registered:\s*([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9.]{8,10})/i);
  return m ? m[1] : null;
}

export const whoisAdapter: SourceAdapter = {
  domain: "web",
  source: "AMNIC WHOIS",
  async fetch(subject: Subject, now: string): Promise<AdapterResult> {
    const domain = (subject.website || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    if (!domain) {
      return { domain: "web", status: "verified_empty", facts: [], fetched_at: now, source: this.source };
    }
    try {
      const raw = await whoisQuery(domain);
      const notFound = /no entries found|not found|no match/i.test(raw);
      if (notFound) {
        return { domain: "web", status: "verified_empty", facts: [], fetched_at: now, source: this.source };
      }
      const registered = parseRegistered(raw);
      const value = registered ? `${domain} registered ${registered}` : `${domain} is registered (date not parsed)`;
      return {
        domain: "web",
        status: "verified",
        source: this.source,
        fetched_at: now,
        facts: [
          makeFact({
            catalog_id: "F-WEB-01",
            subject: domain,
            domain: "web",
            field: "domain_history",
            value,
            source: this.source,
            url: `https://whois.amnic.net/?domain=${domain}`,
            fetched_at: now,
          }),
        ],
      };
    } catch (e) {
      return {
        domain: "web",
        status: "unavailable",
        facts: [],
        fetched_at: now,
        source: this.source,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};
