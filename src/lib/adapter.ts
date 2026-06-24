// Adapter contract + coverage accounting. Every source implements one interface and
// declares its coverage domain. The load-bearing rule (source-access-spec.md §13): a
// blocked/failed adapter reports "unavailable", NEVER a silent empty — the verdict layer
// treats "queried, none found" and "couldn't query" oppositely (R-09 widens the band on the
// latter; absence of evidence ≠ evidence). Pure types + helpers, browser- and node-safe.

import type { Domain, Fact, Match } from "../types";

// The 10 coverage domains the verdict's coverage fraction is measured against.
export const COVERAGE_DOMAINS: Domain[] = [
  "registry",
  "graph",
  "tax",
  "court",
  "enforcement",
  "pledge",
  "notice",
  "procurement",
  "web",
  "contact",
];

export interface Subject {
  tin?: string;
  name?: string; // legal name (any script)
  phone?: string;
  email?: string;
  person?: string; // contact first name
  website?: string; // bare domain, e.g. arakslogistics.am
}

export type AdapterStatus =
  | "verified" // queried successfully, found facts
  | "verified_empty" // queried successfully, nothing found (this IS a finding)
  | "unavailable"; // could not query (blocked/error/timeout) — NOT the same as empty

export interface AdapterResult {
  domain: Domain;
  status: AdapterStatus;
  facts: Fact[];
  fetched_at: string;
  source: string;
  error?: string; // populated only when status === "unavailable"
}

export interface SourceAdapter {
  /** coverage domain this adapter reports against */
  readonly domain: Domain;
  /** human-readable source label(s) */
  readonly source: string;
  /** at most one network round-trip per call; must map any failure to "unavailable" */
  fetch(subject: Subject, now: string): Promise<AdapterResult>;
}

let factSeq = 0;
export function makeFact(p: {
  catalog_id: string;
  subject: string;
  domain: Domain;
  field: string;
  value: string;
  source: string;
  url?: string;
  fetched_at: string;
  match?: Match;
}): Fact {
  return {
    fact_id: `${p.catalog_id}-${++factSeq}`,
    catalog_id: p.catalog_id,
    subject: p.subject,
    domain: p.domain,
    field: p.field,
    value: p.value,
    source: p.source,
    url: p.url ?? "",
    fetched_at: p.fetched_at,
    match: p.match ?? "exact",
  };
}

export interface Coverage {
  verified: number; // domains queried successfully (verified OR verified_empty)
  total: number; // coverage domains attempted
  unavailable: Domain[]; // domains we could not query
}

// Coverage counts successfully-queried domains. "unavailable" does NOT count as verified —
// it widens the band instead. This function is the single place that distinction lives.
export function coverageFrom(results: AdapterResult[]): Coverage {
  const byDomain = new Map<Domain, AdapterStatus>();
  for (const r of results) {
    // a domain counts as verified if ANY of its adapters succeeded
    const prev = byDomain.get(r.domain);
    if (prev === "verified" || prev === "verified_empty") continue;
    byDomain.set(r.domain, r.status);
  }
  let verified = 0;
  const unavailable: Domain[] = [];
  for (const [domain, status] of byDomain) {
    if (status === "verified" || status === "verified_empty") verified++;
    else unavailable.push(domain);
  }
  return { verified, total: byDomain.size, unavailable };
}
