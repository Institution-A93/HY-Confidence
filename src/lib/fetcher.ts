// Fetcher resilience layer (source-access-spec.md §13). Wraps an adapter with a per-domain
// TTL cache, a circuit breaker (these gov sites are fragile — stop hammering a broken one),
// and a health canary (run a known input; if it stops returning, a selector drifted — alert
// instead of silently returning empty). The clock is injectable so this is deterministic to
// test without real time. Pure TS, browser- and node-safe.

import type { AdapterResult, SourceAdapter, Subject } from "./adapter";

export type Clock = () => number;
const wallClock: Clock = () => Date.now();

export class TtlCache<T> {
  private store = new Map<string, { value: T; at: number }>();
  constructor(
    private ttlMs: number,
    private now: Clock = wallClock,
  ) {}
  get(key: string): T | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (this.now() - e.at > this.ttlMs) {
      this.store.delete(key);
      return undefined;
    }
    return e.value;
  }
  set(key: string, value: T): void {
    this.store.set(key, { value, at: this.now() });
  }
}

type BreakerState = "closed" | "open" | "half-open";

export class CircuitBreaker {
  private fails = new Map<string, number>();
  private openedAt = new Map<string, number>();
  constructor(
    private threshold = 3,
    private cooldownMs = 60_000,
    private now: Clock = wallClock,
  ) {}
  state(key: string): BreakerState {
    const opened = this.openedAt.get(key);
    if (opened == null) return "closed";
    if (this.now() - opened >= this.cooldownMs) return "half-open";
    return "open";
  }
  allow(key: string): boolean {
    return this.state(key) !== "open";
  }
  success(key: string): void {
    this.fails.delete(key);
    this.openedAt.delete(key);
  }
  failure(key: string): void {
    const n = (this.fails.get(key) ?? 0) + 1;
    this.fails.set(key, n);
    if (n >= this.threshold) this.openedAt.set(key, this.now());
  }
}

function keyFor(adapter: SourceAdapter, subject: Subject): string {
  return `${adapter.domain}:${subject.tin || subject.name || subject.phone || subject.email || ""}`;
}

export interface ResilienceOpts {
  cache?: TtlCache<AdapterResult>;
  breaker?: CircuitBreaker;
  now?: Clock;
}

// Cache hit → return it. Breaker open → "unavailable" without calling. Otherwise call the
// adapter; success caches + closes the breaker, any throw trips the breaker and maps to
// "unavailable" (never a silent empty).
export async function resilientFetch(
  adapter: SourceAdapter,
  subject: Subject,
  opts: ResilienceOpts = {},
): Promise<AdapterResult> {
  const now = opts.now ?? wallClock;
  const key = keyFor(adapter, subject);
  const cached = opts.cache?.get(key);
  if (cached) return cached;

  const iso = new Date(now()).toISOString();
  if (opts.breaker && !opts.breaker.allow(key)) {
    return { domain: adapter.domain, status: "unavailable", facts: [], fetched_at: iso, source: adapter.source, error: "circuit_open" };
  }

  try {
    const result = await adapter.fetch(subject, iso);
    if (result.status === "unavailable") opts.breaker?.failure(key);
    else {
      opts.breaker?.success(key);
      opts.cache?.set(key, result);
    }
    return result;
  } catch (e) {
    opts.breaker?.failure(key);
    return {
      domain: adapter.domain,
      status: "unavailable",
      facts: [],
      fetched_at: iso,
      source: adapter.source,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export interface CanaryReport {
  domain: string;
  ok: boolean;
  detail: string;
}

// Run an adapter against a known-good subject. If it returns "unavailable" the source is
// down or its layout drifted — surface it loudly rather than letting checks read as clean.
export async function healthCanary(adapter: SourceAdapter, knownGood: Subject): Promise<CanaryReport> {
  const iso = new Date(wallClock()).toISOString();
  try {
    const r = await adapter.fetch(knownGood, iso);
    return { domain: adapter.domain, ok: r.status !== "unavailable", detail: r.status + (r.error ? ` (${r.error})` : "") };
  } catch (e) {
    return { domain: adapter.domain, ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
