import { describe, it, expect } from "vitest";
import { TtlCache, CircuitBreaker, resilientFetch } from "./fetcher";
import type { AdapterResult, SourceAdapter, Subject } from "./adapter";

function fakeAdapter(behavior: () => AdapterResult["status"], counter: { n: number }): SourceAdapter {
  return {
    domain: "tax",
    source: "fake",
    async fetch(_s: Subject, now: string): Promise<AdapterResult> {
      counter.n++;
      const status = behavior();
      if (status === "unavailable") throw new Error("boom");
      return { domain: "tax", status, facts: [], fetched_at: now, source: "fake" };
    },
  };
}

describe("resilientFetch caching", () => {
  it("serves a cached result without re-calling the adapter", async () => {
    let t = 1000;
    const now = () => t;
    const counter = { n: 0 };
    const adapter = fakeAdapter(() => "verified_empty", counter);
    const cache = new TtlCache<AdapterResult>(5000, now);

    await resilientFetch(adapter, { tin: "01857342" }, { cache, now });
    await resilientFetch(adapter, { tin: "01857342" }, { cache, now });
    expect(counter.n).toBe(1); // second call hit the cache

    t = 7000; // past TTL
    await resilientFetch(adapter, { tin: "01857342" }, { cache, now });
    expect(counter.n).toBe(2); // cache expired → re-queried
  });
});

describe("circuit breaker", () => {
  it("opens after the failure threshold and short-circuits to unavailable", async () => {
    let t = 0;
    const now = () => t;
    const counter = { n: 0 };
    const adapter = fakeAdapter(() => "unavailable", counter);
    const breaker = new CircuitBreaker(3, 60_000, now);
    const subj = { tin: "04219876" };

    for (let i = 0; i < 3; i++) {
      const r = await resilientFetch(adapter, subj, { breaker, now });
      expect(r.status).toBe("unavailable");
    }
    expect(counter.n).toBe(3);

    const blocked = await resilientFetch(adapter, subj, { breaker, now });
    expect(blocked.status).toBe("unavailable");
    expect(blocked.error).toBe("circuit_open");
    expect(counter.n).toBe(3); // adapter was NOT called — breaker is open

    t = 61_000; // cooldown elapsed → half-open, adapter tried again
    await resilientFetch(adapter, subj, { breaker, now });
    expect(counter.n).toBe(4);
  });
});
