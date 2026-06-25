// F-TAX-03 — SRC "1000 largest taxpayers" snapshot (feeds SP-02, +12).
//
// WHY A STATIC SNAPSHOT, not a live fetch: the SRC publishes this list per-QUARTER as an
// article/PDF with no stable URL (source-access-spec.md §3, [R]); petekamutner.am is unreachable
// from our network and src.am serves it only through a JS SPA whose publication API needs
// per-period reverse-engineering. A quarterly-refreshed snapshot is reliable, testable, and
// Pages-compatible — and SP-02 is POSITIVE-only, so a stale/partial list only fails to award a
// bonus, it can never harm a verdict.
//
// FORMAT: the official list carries NAME + amount, NO TIN — so membership is matched by the
// normalized canonical Armenian name (legalNameKey), against `names` IN PUBLISHED RANK ORDER
// (rank = index + 1). Names are stored as published (with legal form / «»); the matcher strips
// those. Do NOT invent entries — populate ONLY from the authoritative SRC publication.
//
// REFRESH: replace `period` + `names` from each new SRC quarterly list. Until populated with the
// real list, `names` is empty and the adapter is a safe no-op (SP-02 never fires).
export const TOP1000: { period: string; source: string; names: string[] } = {
  period: "", // e.g. "2025 H1" — set from the SRC publication this snapshot is taken from
  source: "SRC (State Revenue Committee) — 1000 largest taxpayers",
  names: [
    // Paste the published company names here, in rank order. Example shape (REMOVE — illustrative):
    // "«Գազպրոմ Արմենիա» ՓԲԸ",
    // "«Զանգեզուրի պղնձամոլիբդենային կոմբինատ» ՓԲԸ",
  ],
};
