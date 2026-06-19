// Minimal live backend. Runs the recon-free adapters (sanctions, WHOIS, MX) for a subject,
// derives signals from the returned Facts, runs the scoring engine, and returns a
// Fixture-shaped result the frontend renders exactly like a demo vignette. This is the
// bridge from "fixtures demo" to "really checks something live".
//
// Honest scope: only 3 of the 10 coverage domains are live, so every verdict is low-coverage
// (wide band) by construction — the registry/court/etc. scrapers need a backend per
// recon/SOURCES-RECON.md. Run with: npx tsx server/index.ts
import { createServer } from "node:http";
import { sanctionsAdapter } from "../src/adapters/sanctions";
import { whoisAdapter } from "../src/adapters/whois";
import { mxAdapter } from "../src/adapters/mx";
import { srcAdapter, resolveBySrc } from "../src/adapters/srcam";
import { resilientFetch, TtlCache, CircuitBreaker } from "../src/lib/fetcher";
import { COVERAGE_DOMAINS } from "../src/lib/adapter";
import type { AdapterResult, Subject } from "../src/lib/adapter";
import { computeVerdict } from "../src/scoring/engine";
import { baseWeightFor } from "../src/scoring/weights";
import type { Fact, Signal, NarrativeLine, Fixture } from "../src/types";

const PORT = Number(process.env.PORT || 8080);
const cache = new TtlCache<AdapterResult>(6 * 60 * 60 * 1000); // 6h
const breaker = new CircuitBreaker();

const ADAPTERS = [srcAdapter, sanctionsAdapter, whoisAdapter, mxAdapter];

function mkSignal(id: string, grade: Signal["grade"], polarity: Signal["polarity"], evidence: string[], note: string): Signal {
  const w = grade === "blocker" ? null : baseWeightFor(id);
  return { id, grade, polarity, weight_base: w, weight_effective: w, evidence, note };
}

// Derive signals from the live Facts of the three domains we can actually query.
function deriveSignals(facts: Fact[]): Signal[] {
  const out: Signal[] = [];
  const f = (cat: string) => facts.find((x) => x.catalog_id === cat);

  const san = f("F-SAN-01");
  if (san && /POSSIBLE OFAC match/i.test(san.value)) {
    out.push(mkSignal("B-05", "blocker", "-", [san.fact_id], "Director/UBO appears on the OFAC sanctions list."));
  }

  const web = f("F-WEB-01");
  if (web) {
    const m = web.value.match(/registered (\d{4})/);
    if (m) {
      const age = new Date().getFullYear() - Number(m[1]);
      if (age >= 3) out.push(mkSignal("WP-01", "weak", "+", [web.fact_id], `Domain registered ${age} years ago — an established web presence.`));
      else if (age < 1) out.push(mkSignal("WN-03", "weak", "-", [web.fact_id], "Domain registered under a year ago — thin web history."));
    }
  }

  const con = f("F-CON-02");
  if (con) {
    if (/matches website domain/i.test(con.value)) out.push(mkSignal("WP-03", "weak", "+", [con.fact_id], "Email domain matches the website."));
    else if (/generic provider/i.test(con.value)) out.push(mkSignal("WN-02", "weak", "-", [con.fact_id], "Generic email provider as the primary B2B contact."));
  }

  // Registry facts (from the SRC taxpayer record): status + entity age.
  const status = f("F-REG-01");
  if (status && /լուծար|սնանկ/.test(status.value)) {
    out.push(mkSignal("B-02", "blocker", "-", [status.fact_id], "Registry status indicates liquidation or bankruptcy."));
  }
  const reg = f("F-REG-02");
  if (reg) {
    const yr = Number((reg.value.match(/(\d{4})/) || [])[1]);
    if (yr) {
      const age = new Date().getFullYear() - yr;
      const active = !!status && /Գործող/.test(status.value);
      if (age < 1) out.push(mkSignal("SN-07", "strong", "-", [reg.fact_id], "Entity is under a year old."));
      else if (age >= 7 && active) out.push(mkSignal("SP-01", "strong", "+", [reg.fact_id], `Registered ${age} years ago and still active — an established operator.`));
    }
  }
  return out;
}

function buildNarrative(signals: Signal[], verified: number): NarrativeLine[] {
  const lines: NarrativeLine[] = [];
  const blocker = signals.find((s) => s.grade === "blocker");
  if (blocker) lines.push({ text: "BLOCKED: " + blocker.note, evidence: blocker.evidence });
  for (const s of signals.filter((x) => x.grade !== "blocker")) lines.push({ text: s.note, evidence: s.evidence });
  lines.push({
    text: `Live check covered ${verified} of 10 sources (sanctions, web/domain, contact). The registry, court, enforcement, tax and other domains need the data backend and were not queried — treat this as a partial, low-confidence read.`,
    evidence: [],
  });
  return lines;
}

async function runCheck(input: Record<string, string>): Promise<Fixture> {
  const subject: Subject = {
    tin: input.tin || undefined,
    name: input.entity_name || undefined,
    person: input.person_first_name || input.entity_name || undefined,
    email: input.email || undefined,
    website: input.website || (input.email ? input.email.split("@")[1] : undefined),
  };

  const results = await Promise.all(ADAPTERS.map((a) => resilientFetch(a, subject, { cache, breaker })));
  const facts = results.flatMap((r) => r.facts);
  // Coverage is fact-driven: one adapter (src.am) yields facts in several coverage domains,
  // so count the distinct 10-model domains actually present in the returned facts.
  const present = new Set<string>();
  for (const fct of facts) if ((COVERAGE_DOMAINS as string[]).includes(fct.domain)) present.add(fct.domain);
  const coverage = { verified: present.size, total: 10 };

  const signals = deriveSignals(facts);
  const eng = computeVerdict({ signals, facts, coverage, fuzzyResolution: false });

  const name = input.entity_name || input.website || input.tin || "Counterparty";
  const fixture = {
    id: "live:" + (input.tin || input.entity_name || input.website || "q"),
    label: "Live check",
    demonstrates: [],
    input: {
      entity_name: input.entity_name || "",
      tin: input.tin || null,
      person_first_name: input.person_first_name || null,
      phone: input.phone || null,
    },
    resolution: { ambiguous: false, candidates_reserve: [], selected: { tin: input.tin || "—", name_hy: name, name_en: name } },
    facts,
    signals: eng.signals,
    rules_fired: eng.rulesFired.map((id) => ({ id, effect: "applied", note: "" })),
    verdict: {
      state: eng.state,
      blockers: eng.blockers,
      score: eng.score,
      coverage,
      tier_map: eng.tier_map,
      band_blur: eng.band_blur,
      narrative: buildNarrative(eng.signals, coverage.verified),
      missing: [{ gap: "Registry/court/tax not checked live", cta: "Manual check recommended", mock: false }],
    },
  };
  return fixture;
}

function send(res: import("node:http").ServerResponse, code: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(json);
}

createServer((req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true });
  if (req.method === "POST" && req.url === "/resolve") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const input = body ? JSON.parse(body) : {};
        const candidates = await resolveBySrc(String(input.name || input.entity_name || ""));
        send(res, 200, { candidates });
      } catch (e) {
        send(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
    });
    return;
  }
  if (req.method === "POST" && req.url === "/check") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const input = body ? JSON.parse(body) : {};
        const fixture = await runCheck(input);
        send(res, 200, fixture);
      } catch (e) {
        send(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
    });
    return;
  }
  send(res, 404, { error: "not found" });
}).listen(PORT, () => console.log(`live backend on :${PORT}`));
