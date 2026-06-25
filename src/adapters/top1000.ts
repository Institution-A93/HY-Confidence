// F-TAX-03 — membership in the SRC's "1000 largest taxpayers" list → SP-02 (+12), a strong
// positive credibility marker (a major, demonstrably tax-paying entity). TIN-keyed: the snapshot
// (src/data/top1000.ts, sourced from karg.am) carries each entry's TIN, so we match the resolved
// TIN EXACTLY — no fuzzy name guesswork, no R-08 damping. No network call (a local snapshot lookup),
// but it implements the adapter contract so it slots into the keyed phase uniformly.
import type { AdapterResult, SourceAdapter, Subject } from "../lib/adapter";
import { makeFact } from "../lib/adapter";
import { TOP1000 } from "../data/top1000";

// Published rank (1-based) of a TIN in the snapshot, or null if absent. Pure → unit-tested with a
// fixture list (the real data file may be empty between quarterly refreshes).
export function top1000Rank(tin: string, tins: string[]): number | null {
  const t = (tin || "").trim();
  if (!t) return null;
  const i = tins.indexOf(t);
  return i < 0 ? null : i + 1;
}

export const top1000Adapter: SourceAdapter = {
  domain: "tax", // enriches the tax domain src.am already covers — does not change the coverage count
  source: TOP1000.source,
  async fetch(subject: Subject, now: string): Promise<AdapterResult> {
    const rank = top1000Rank(subject.tin || "", TOP1000.tins);
    if (rank === null) {
      // Not on the list (or no snapshot loaded yet) → queried-empty, SP-02 simply does not fire.
      return { domain: "tax", status: "verified_empty", facts: [], fetched_at: now, source: this.source };
    }
    const fact = makeFact({
      catalog_id: "F-TAX-03",
      subject: subject.tin!,
      domain: "tax",
      field: "top1000_membership",
      value: `Among the SRC's 1000 largest taxpayers — rank #${rank}`,
      source: this.source,
      url: "", // per-period publication has no stable replayable URL (see data/top1000.ts)
      fetched_at: now,
      match: "exact", // TIN-confirmed against the snapshot
    });
    return { domain: "tax", status: "verified", facts: [fact], fetched_at: now, source: this.source };
  },
};
