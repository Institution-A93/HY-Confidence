// F-TAX-03 — membership in the SRC's "1000 largest taxpayers" list → SP-02 (+12), a strong
// positive credibility marker (a major, demonstrably tax-paying entity). NAME-keyed: the published
// list has no TIN (see src/data/top1000.ts), so we match the canonical Armenian name the src.am
// resolver already pinned, normalized via legalNameKey. No network call — a local snapshot lookup —
// but it implements the adapter contract so it slots into the name-keyed phase uniformly.
//
// match: "fuzzy" — the list carries no TIN, so we cannot rule out a same-name collision with a
// listed major (R-08 damps SP-02 ×0.7). That is the conservative choice for a positive signal.
import type { AdapterResult, SourceAdapter, Subject } from "../lib/adapter";
import { makeFact } from "../lib/adapter";
import { legalNameKey } from "../lib/normalize";
import { TOP1000 } from "../data/top1000";

// Published rank (1-based) of a name in the snapshot, or null if absent. Pure → unit-tested with a
// fixture list (the real data file may be empty between quarterly refreshes).
export function top1000Rank(name: string, names: string[]): number | null {
  const key = legalNameKey(name);
  if (!key) return null;
  const i = names.findIndex((n) => legalNameKey(n) === key);
  return i < 0 ? null : i + 1;
}

export const top1000Adapter: SourceAdapter = {
  domain: "tax", // enriches the tax domain src.am already covers — does not change the coverage count
  source: TOP1000.source,
  async fetch(subject: Subject, now: string): Promise<AdapterResult> {
    const name = (subject.name || "").trim();
    const rank = name ? top1000Rank(name, TOP1000.names) : null;
    if (rank === null) {
      // Not on the list (or no snapshot loaded yet) → queried-empty, SP-02 simply does not fire.
      return { domain: "tax", status: "verified_empty", facts: [], fetched_at: now, source: this.source };
    }
    const fact = makeFact({
      catalog_id: "F-TAX-03",
      subject: name,
      domain: "tax",
      field: "top1000_membership",
      value: `Among the SRC's 1000 largest taxpayers${TOP1000.period ? ` (${TOP1000.period})` : ""} — rank #${rank}`,
      source: this.source,
      url: "", // per-period publication has no stable replayable URL (see data/top1000.ts)
      fetched_at: now,
      match: "fuzzy", // name-matched, no TIN in the list → R-08 ×0.7
    });
    return { domain: "tax", status: "verified", facts: [fact], fetched_at: now, source: this.source };
  },
};
