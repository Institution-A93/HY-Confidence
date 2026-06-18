// F-CON-02 — email domain check. Pure DNS, free, no scraping (source-access-spec.md §11).
// Resolves MX for the email's domain and string-matches it against the entity website
// domain. Node-only (node:dns); the frontend never imports this, so it stays out of the
// browser bundle.
import { resolveMx } from "node:dns/promises";
import type { AdapterResult, SourceAdapter, Subject } from "../lib/adapter";
import { makeFact } from "../lib/adapter";

function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase().trim() : null;
}

export const mxAdapter: SourceAdapter = {
  domain: "contact",
  source: "MX check",
  async fetch(subject: Subject, now: string): Promise<AdapterResult> {
    const email = (subject.email || "").trim();
    const emailDomain = email ? domainOf(email) : null;
    if (!emailDomain) {
      return { domain: "contact", status: "verified_empty", facts: [], fetched_at: now, source: this.source };
    }
    try {
      const mx = await resolveMx(emailDomain);
      const hasMx = mx.length > 0;
      const site = (subject.website || "").toLowerCase().replace(/^www\./, "").trim();
      const matchesSite = site ? emailDomain === site : false;
      const generic = /(^|@)(gmail|mail|yandex|outlook|hotmail|yahoo)\./.test(emailDomain);
      const value = !hasMx
        ? `${emailDomain}: no MX records (mail not deliverable)`
        : matchesSite
          ? `matches website domain (${emailDomain})`
          : generic
            ? `generic provider (${emailDomain}) as primary B2B contact`
            : `${emailDomain}: MX present (${mx.length}), site=${site || "unknown"}`;
      return {
        domain: "contact",
        status: "verified",
        source: this.source,
        fetched_at: now,
        facts: [
          makeFact({
            catalog_id: "F-CON-02",
            subject: `channel:${email}`,
            domain: "contact",
            field: "email_domain_match",
            value,
            source: this.source,
            fetched_at: now,
          }),
        ],
      };
    } catch (e) {
      return {
        domain: "contact",
        status: "unavailable",
        facts: [],
        fetched_at: now,
        source: this.source,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};
