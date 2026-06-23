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
import { azdararAdapter } from "../src/adapters/azdarar";
import { datalexAdapter } from "../src/adapters/datalex";
import { resilientFetch, TtlCache, CircuitBreaker } from "../src/lib/fetcher";
import { COVERAGE_DOMAINS } from "../src/lib/adapter";
import { stripLegal } from "../src/lib/normalize";
import type { AdapterResult, Subject } from "../src/lib/adapter";
import { computeVerdict } from "../src/scoring/engine";
import { baseWeightFor } from "../src/scoring/weights";
import type { Fact, Signal, NarrativeLine, Fixture } from "../src/types";

const PORT = Number(process.env.PORT || 8080);
const cache = new TtlCache<AdapterResult>(6 * 60 * 60 * 1000); // 6h
const breaker = new CircuitBreaker();

// Keyed adapters run with the raw subject (TIN / email / website / person).
const KEYED_ADAPTERS = [sanctionsAdapter, whoisAdapter, mxAdapter];
// Name-keyed adapters need the CANONICAL Armenian name, so they run after src.am resolves it.
const NAME_KEYED_ADAPTERS = [azdararAdapter, datalexAdapter];

// weightOverride lets a detector pass a scaled base weight (e.g. SN-01 after R-06 recency decay);
// the engine still applies R-08/R-01 on top of whatever weight_base we hand it.
function mkSignal(id: string, grade: Signal["grade"], polarity: Signal["polarity"], evidence: string[], note: string, weightOverride?: number): Signal {
  const w = grade === "blocker" ? null : weightOverride ?? baseWeightFor(id);
  return { id, grade, polarity, weight_base: w, weight_effective: w, evidence, note };
}

// Derive signals from the live Facts of the three domains we can actually query.
function deriveSignals(facts: Fact[]): Signal[] {
  const out: Signal[] = [];
  const f = (cat: string) => facts.find((x) => x.catalog_id === cat);

  const san = f("F-SAN-01");
  // Only a STRONG (confident) sanctions name match vetoes. A "Possible OFAC match" is surfaced as
  // a manual-review CTA in runCheck — it must never auto-BLOCK on a coincidence of common words.
  if (san && /sanctions match \(strong\)/i.test(san.value)) {
    out.push(mkSignal("B-05", "blocker", "-", [san.fact_id], "Director/UBO appears on the OFAC sanctions list (strong name match)."));
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

  // Public notices (Azdarar): liquidation/bankruptcy veto; capital-reduction / creditor-call hurt.
  const notice = f("F-NTC-01");
  if (notice) {
    if (/Liquidation notice|Bankruptcy notice/.test(notice.value)) {
      out.push(mkSignal("B-02", "blocker", "-", [notice.fact_id], "Public notice of liquidation or bankruptcy (Azdarar)."));
    } else if (/Capital-reduction notice/.test(notice.value)) {
      out.push(mkSignal("SN-04", "strong", "-", [notice.fact_id], "Capital-reduction notice published — equity being pulled out."));
    } else if (/Creditor-call notice/.test(notice.value)) {
      out.push(mkSignal("SN-04", "strong", "-", [notice.fact_id], "Creditor-call notice published."));
    }
  }

  // Court (Datalex). Role is already classified by the adapter's role-keyed queries, so we map
  // facts straight to signals: defendant → SN-01, plaintiff → WP-09 (R-04 keeps them separate by
  // construction), bankruptcy debtor → B-01 when open. Amounts/outcomes are captcha-gated, so
  // SN-01 scales by count + recency only.
  const nowYear = new Date().getFullYear();
  // R-06 court recency decay: ×1.0 ≤12mo, ×0.6 ≤24mo, ×0.3 ≤36mo, 0 beyond. Unknown year → mid.
  const decay = (yr: number | null) => (yr === null ? 0.6 : nowYear - yr <= 1 ? 1 : nowYear - yr <= 2 ? 0.6 : nowYear - yr <= 3 ? 0.3 : 0);
  const yearIn = (v: string) => Number((v.match(/most recent (\d{4})/) || [])[1]) || null;

  const def = f("F-CRT-02");
  const pla = f("F-CRT-01");
  const defCount = def ? Number((def.value.match(/Defendant in (\d+)/) || [])[1] || 0) : 0;
  const plaCount = pla ? Number((pla.value.match(/Plaintiff in (\d+)/) || [])[1] || 0) : 0;

  if (pla) {
    out.push(mkSignal("WP-09", "weak", "+", [pla.fact_id], `Plaintiff in ${plaCount} collection case(s)${defCount ? ` (vs ${defCount} as defendant)` : ""} — actively enforces its own receivables.`));
  }
  if (def) {
    const yr = yearIn(def.value);
    const d = decay(yr);
    // SN-01 should reflect debt/contract cases where the entity is the TARGET. Case TYPE and
    // AMOUNT live behind the detail captcha, so v1 uses the NET defendant excess as the proxy: a
    // company that sues at least as often as it is sued is enforcing its receivables (spec R-04's
    // stated philosophy — "suing deadbeat customers is healthy"), and its raw defendant count just
    // tracks its size. Only a NET litigation target trips SN-01; magnitude + R-06 recency scale it.
    // [follow-up: filter to debt/contract + scale by amount once the detail captcha is solved.]
    const net = defCount - plaCount;
    if (net >= 1 && d > 0) {
      const base = (net >= 10 ? -15 : net >= 3 ? -12 : -10) * d;
      out.push(mkSignal("SN-01", "strong", "-", [def.fact_id], `Net litigation target: ${defCount} case(s) as defendant vs ${plaCount} as plaintiff${yr ? `, most recent ${yr}` : ""}.`, base));
    } else if (net >= 1 && defCount === 1) {
      out.push(mkSignal("WN-07", "weak", "-", [def.fact_id], "A single, dated defendant case (>24 months old)."));
    }
  }

  const bkr = f("F-CRT-03");
  if (bkr) {
    const yr = yearIn(bkr.value);
    // B-01 needs OPEN bankruptcy. We infer "open" from recency (≤4y): Armenian corporate
    // bankruptcies run multi-year, so a recent filing is almost certainly still live. Older ones
    // are NOT blocked — they could be discharged, which we cannot confirm behind the detail
    // captcha — so a stale bankruptcy stays visible as the F-CRT-03 fact without vetoing the score.
    if (yr !== null && nowYear - yr <= 4) {
      out.push(mkSignal("B-01", "blocker", "-", [bkr.fact_id], `Appears as the debtor in a bankruptcy case (filed ${yr}) — open insolvency proceedings.`));
    }
  }
  return out;
}

function buildNarrative(signals: Signal[], verified: number, sourcesText: string): NarrativeLine[] {
  const lines: NarrativeLine[] = [];
  const blocker = signals.find((s) => s.grade === "blocker");
  if (blocker) lines.push({ text: "BLOCKED: " + blocker.note, evidence: blocker.evidence });
  for (const s of signals.filter((x) => x.grade !== "blocker")) lines.push({ text: s.note, evidence: s.evidence });
  lines.push({
    text: `Live check covered ${verified} of 10 domains (${sourcesText}). Enforcement, procurement, auction and pledge are not wired yet — treat this as a partial read.`,
    evidence: [],
  });
  return lines;
}

const DOMAIN_LABEL: Record<string, string> = { tax: "tax", registry: "registry", web: "web/domain", contact: "contact", notice: "notices", court: "courts" };

async function runCheck(input: Record<string, string>): Promise<Fixture> {
  const subject: Subject = {
    tin: input.tin || undefined,
    name: input.entity_name || undefined,
    person: input.person_first_name || input.entity_name || undefined,
    email: input.email || undefined,
    website: input.website || (input.email ? input.email.split("@")[1] : undefined),
  };

  // Phase 1: src.am — identity + registry basics; yields the canonical Armenian name.
  const srcRes = await resilientFetch(srcAdapter, subject, { cache, breaker });
  const taxVal = srcRes.facts.find((f) => f.catalog_id === "F-TAX-01")?.value || "";
  const canonicalName = taxVal.includes(" — TIN") ? stripLegal(taxVal.split(" — TIN")[0]) : subject.name || "";
  const nameSubject: Subject = { ...subject, name: canonicalName };

  // Phase 2: keyed adapters (raw subject) + name-keyed adapters (canonical name), in parallel.
  const rest = await Promise.all([
    ...KEYED_ADAPTERS.map((a) => resilientFetch(a, subject, { cache, breaker })),
    ...NAME_KEYED_ADAPTERS.map((a) => resilientFetch(a, nameSubject, { cache, breaker })),
  ]);
  const results = [srcRes, ...rest];
  const facts = results.flatMap((r) => r.facts);

  // Coverage = domains that produced facts OR were queried successfully (queried-empty still
  // counts as covered; one adapter like src.am spans several coverage domains).
  const present = new Set<string>();
  for (const fct of facts) if ((COVERAGE_DOMAINS as string[]).includes(fct.domain)) present.add(fct.domain);
  for (const r of results)
    if ((r.status === "verified" || r.status === "verified_empty") && (COVERAGE_DOMAINS as string[]).includes(r.domain))
      present.add(r.domain);
  const coverage = { verified: present.size, total: 10 };
  const sourceLabels = Array.from(present).map((d) => DOMAIN_LABEL[d] || d);
  if (facts.some((f) => f.domain === "sanctions")) sourceLabels.push("sanctions");
  const sourcesText = sourceLabels.join(", ") || "none";

  const signals = deriveSignals(facts);
  const eng = computeVerdict({ signals, facts, coverage, fuzzyResolution: false });

  const name = input.entity_name || input.website || input.tin || "Counterparty";
  // A non-blocking "possible" sanctions match surfaces as a review gap (the strong match already
  // vetoed via B-05 in deriveSignals; this is the soft path that must NOT block).
  const missing = [{ gap: "Enforcement, procurement, auction and pledge not checked live", cta: "Manual check recommended", mock: false }];
  if (facts.some((ff) => ff.catalog_id === "F-SAN-01" && /Possible OFAC match/i.test(ff.value)))
    missing.unshift({ gap: "Possible sanctions name match (unconfirmed)", cta: "Verify the counterparty name against the OFAC SDN list manually", mock: false });
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
      narrative: buildNarrative(eng.signals, coverage.verified, sourcesText),
      missing,
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
