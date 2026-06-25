// Minimal live backend. Runs the recon-free adapters (sanctions, WHOIS, MX) for a subject,
// derives signals from the returned Facts, runs the scoring engine, and returns a
// Fixture-shaped result the frontend renders exactly like a demo vignette. This is the
// bridge from "fixtures demo" to "really checks something live".
//
// Honest scope: only 3 of the 10 coverage domains are live, so every verdict is low-coverage
// (wide band) by construction — the registry/court/etc. scrapers need a backend per
// recon/SOURCES-RECON.md. Run with: npx tsx server/index.ts
import { createServer } from "node:http";
import { sanctionsAdapter, screenOwners } from "../src/adapters/sanctions";
import { whoisAdapter } from "../src/adapters/whois";
import { mxAdapter } from "../src/adapters/mx";
import { srcAdapter, resolveBySrc } from "../src/adapters/srcam";
import { azdararAdapter } from "../src/adapters/azdarar";
import { datalexAdapter } from "../src/adapters/datalex";
import { eregisterAdapter, ownerNamesFromValue, parseOwnerLine } from "../src/adapters/eregister";
import { pledgeAdapter } from "../src/adapters/pledge";
import { procurementAdapter } from "../src/adapters/procurement";
import { enforcementAdapter } from "../src/adapters/enforcement";
import { top1000Adapter } from "../src/adapters/top1000";
import { resilientFetch, TtlCache, CircuitBreaker } from "../src/lib/fetcher";
import { COVERAGE_DOMAINS, makeFact } from "../src/lib/adapter";
import { stripLegal, translitHyToLatin } from "../src/lib/normalize";
import type { AdapterResult, Subject } from "../src/lib/adapter";
import { computeVerdict } from "../src/scoring/engine";
import { baseWeightFor, enforcementWeight } from "../src/scoring/weights";
import type { Fact, Signal, NarrativeLine, Fixture, I18nPiece } from "../src/types";

// Build one localized piece (key + params) for the i18n render layer.
const P = (key: string, params?: Record<string, string | number>): I18nPiece => ({ key, params });

const PORT = Number(process.env.PORT || 8080);
const cache = new TtlCache<AdapterResult>(6 * 60 * 60 * 1000); // 6h
const breaker = new CircuitBreaker();

// Keyed adapters run with the raw subject (TIN / email / website / person). e-register is
// TIN-keyed (beneficial owners by the confirmed TIN) — it enriches the registry domain src.am
// already covers, so it adds owner Facts without changing the coverage count.
const KEYED_ADAPTERS = [sanctionsAdapter, whoisAdapter, mxAdapter, eregisterAdapter, enforcementAdapter];
// Name-keyed adapters need the CANONICAL Armenian name, so they run after src.am resolves it.
// (procurement also reads the resolved TIN to CONFIRM the supplier match — see nameSubject below.)
// top1000 is name-keyed too (it matches the canonical Armenian name against the SRC snapshot).
const NAME_KEYED_ADAPTERS = [azdararAdapter, datalexAdapter, pledgeAdapter, procurementAdapter, top1000Adapter];

// weightOverride lets a detector pass a scaled base weight (e.g. SN-01 after R-06 recency decay);
// the engine still applies R-08/R-01 on top of whatever weight_base we hand it.
function mkSignal(id: string, grade: Signal["grade"], polarity: Signal["polarity"], evidence: string[], note: string, weightOverride?: number, i18n?: I18nPiece[]): Signal {
  const w = grade === "blocker" ? null : weightOverride ?? baseWeightFor(id);
  return { id, grade, polarity, weight_base: w, weight_effective: w, evidence, note, i18n };
}

// Derive signals from the live Facts of the three domains we can actually query.
function deriveSignals(facts: Fact[]): Signal[] {
  const out: Signal[] = [];
  const f = (cat: string) => facts.find((x) => x.catalog_id === cat);

  const NM = P("sig_name_matched"); // shared court "matched by name" suffix piece

  // Only a STRONG (confident) sanctions match vetoes — on the entity name (F-SAN-01) OR a
  // beneficial owner (F-SAN-02, the spec's UBO screen). A "Possible OFAC match" is surfaced as a
  // manual-review CTA in runCheck — it must never auto-BLOCK on a coincidence of common words.
  const sanStrong = facts.find((x) => /^F-SAN-0[12]$/.test(x.catalog_id) && /sanctions match \(strong\)/i.test(x.value));
  if (sanStrong) {
    out.push(mkSignal("B-05", "blocker", "-", [sanStrong.fact_id], "Director/UBO appears on the OFAC sanctions list (strong name match).", undefined, [P("sig_b05")]));
  }

  const web = f("F-WEB-01");
  if (web) {
    const m = web.value.match(/registered (\d{4})/);
    if (m) {
      const age = new Date().getFullYear() - Number(m[1]);
      if (age >= 3) out.push(mkSignal("WP-01", "weak", "+", [web.fact_id], `Domain registered ${age} years ago — an established web presence.`, undefined, [P("sig_wp01", { age })]));
      else if (age < 1) out.push(mkSignal("WN-03", "weak", "-", [web.fact_id], "Domain registered under a year ago — thin web history.", undefined, [P("sig_wn03")]));
    }
  }

  const con = f("F-CON-02");
  if (con) {
    if (/matches website domain/i.test(con.value)) out.push(mkSignal("WP-03", "weak", "+", [con.fact_id], "Email domain matches the website.", undefined, [P("sig_wp03")]));
    else if (/generic provider/i.test(con.value)) out.push(mkSignal("WN-02", "weak", "-", [con.fact_id], "Generic email provider as the primary B2B contact.", undefined, [P("sig_wn02")]));
  }

  // Registry facts (from the SRC taxpayer record): status + entity age.
  const status = f("F-REG-01");
  if (status && /լուծար|սնանկ/.test(status.value)) {
    out.push(mkSignal("B-02", "blocker", "-", [status.fact_id], "Registry status indicates liquidation or bankruptcy.", undefined, [P("sig_b02_status")]));
  }
  const reg = f("F-REG-02");
  if (reg) {
    const yr = Number((reg.value.match(/(\d{4})/) || [])[1]);
    if (yr) {
      const age = new Date().getFullYear() - yr;
      const active = !!status && /Գործող/.test(status.value);
      if (age < 1) out.push(mkSignal("SN-07", "strong", "-", [reg.fact_id], "Entity is under a year old.", undefined, [P("sig_sn07")]));
      else if (age >= 7 && active) out.push(mkSignal("SP-01", "strong", "+", [reg.fact_id], `Registered ${age} years ago and still active — an established operator.`, undefined, [P("sig_sp01", { age })]));
    }
  }

  // Top-1000 taxpayer (SRC snapshot): a major, demonstrably tax-paying entity → strong positive.
  // Name-matched (the list has no TIN) → R-08 damps it ×0.7.
  const top = f("F-TAX-03");
  if (top) out.push(mkSignal("SP-02", "strong", "+", [top.fact_id], `${top.value} — a major, demonstrably tax-paying entity.`, undefined, [P("sig_sp02")]));

  // Public notices (Azdarar): liquidation/bankruptcy veto; capital-reduction / creditor-call hurt.
  const notice = f("F-NTC-01");
  if (notice) {
    if (/Liquidation notice|Bankruptcy notice/.test(notice.value)) {
      out.push(mkSignal("B-02", "blocker", "-", [notice.fact_id], "Public notice of liquidation or bankruptcy (Azdarar).", undefined, [P("sig_b02_notice")]));
    } else if (/Capital-reduction notice/.test(notice.value)) {
      out.push(mkSignal("SN-04", "strong", "-", [notice.fact_id], "Capital-reduction notice published — equity being pulled out.", undefined, [P("sig_sn04_capital")]));
    } else if (/Creditor-call notice/.test(notice.value)) {
      out.push(mkSignal("SN-04", "strong", "-", [notice.fact_id], "Creditor-call notice published.", undefined, [P("sig_sn04_creditor")]));
    }
  }

  // Enforcement (DAHK). Open proceedings AGAINST this entity (the adapter already dropped ones where
  // it is the creditor). Reclassified from the old B-03 veto to a SCALED strong negative SN-11: a
  // flat veto wrongly blocked large solvent entities (a bank with one minor proceeding). Weight scales
  // by total claimed amount + count (enforcementWeight). Still serious — active bailiff collection.
  const enf = f("F-ENF-01");
  if (enf) {
    const count = Number((enf.value.match(/^(\d+) open/) || [])[1] || 1);
    const total = Number((enf.value.match(/total ([\d,]+) AMD/) || [])[1]?.replace(/,/g, "") || 0);
    out.push(mkSignal("SN-11", "strong", "-", [enf.fact_id], `Open compulsory enforcement at DAHK (active bailiff collection) — ${enf.value}.`, enforcementWeight(total, count), [P("sig_sn11", { count, amount: total.toLocaleString("en-US") })]));
  }

  // Procurement (armeps): F-PRC-01 only carries wins already filtered to the ≤36mo SP-03 window
  // (the adapter applies it), so its presence IS the signal — a positive credibility marker.
  const prc = f("F-PRC-01");
  if (prc) out.push(mkSignal("SP-03", "strong", "+", [prc.fact_id], `State-procurement wins in the last 36 months — a real, operating supplier. ${prc.value}`, undefined, [P("sig_sp03")]));

  // Pledge (registration.am). R-05: a movable-property pledge is normal working-capital financing
  // and is NEUTRAL on a mature entity. SN-06 fires ONLY on the distress pattern — a FRESH pledge
  // (≤12mo) on a YOUNG entity (≤2y) freshly encumbering its assets. Entity age comes from F-REG-02.
  const plg = f("F-PLG-01");
  if (plg) {
    const dm = plg.value.match(/most recent (\d{2})-(\d{2})-(\d{4})/);
    const regYr = reg ? Number((reg.value.match(/(\d{4})/) || [])[1]) : 0;
    const entityAge = regYr ? new Date().getFullYear() - regYr : 99;
    let pledgeMonthsAgo = 99;
    if (dm) {
      const d = new Date(`${dm[3]}-${dm[2]}-${dm[1]}T00:00:00Z`);
      pledgeMonthsAgo = (Date.now() - d.getTime()) / (30 * 24 * 3600 * 1000);
    }
    // Evidence is the pledge fact ALONE (fuzzy → R-08 ×0.7); entity age is a gating condition, not
    // evidence of the pledge — including the exact F-REG-02 fact would suppress the fuzzy damping.
    if (pledgeMonthsAgo <= 12 && entityAge <= 2) {
      out.push(mkSignal("SN-06", "strong", "-", [plg.fact_id], `Fresh asset pledge on a ${entityAge}-year-old entity — core assets encumbered early. ${plg.value}`, undefined, [P("sig_sn06", { age: entityAge })]));
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
  // Court data is matched by NAME (datalex has no TIN), so flag every court signal — the user must
  // see these may be a same-name entity (cf. the always-fuzzy / R-08 damping + guard in datalex.ts).
  const NAME_MATCHED = " (matched by name, not TIN — may be a same-name entity)";

  const def = f("F-CRT-02");
  const pla = f("F-CRT-01");
  const civilDef = def ? Number((def.value.match(/(\d+) civil case/) || [])[1] || 0) : 0;
  const payDef = def ? Number((def.value.match(/(\d+) payment-order/) || [])[1] || 0) : 0;
  const plaCount = pla ? Number((pla.value.match(/Plaintiff in (\d+)/) || [])[1] || 0) : 0;
  if (pla) {
    const i18n = [P("sig_wp09_main", { n: plaCount }), ...(civilDef ? [P("sig_wp09_vs", { def: civilDef })] : []), P("sig_wp09_tail"), NM];
    out.push(mkSignal("WP-09", "weak", "+", [pla.fact_id], `Plaintiff in ${plaCount} collection case(s) all-time${civilDef ? ` (vs ${civilDef} as defendant)` : ""} — actively enforces its own receivables.` + NAME_MATCHED, undefined, i18n));
  }
  if (def) {
    const yr = yearIn(def.value);
    const d = decay(yr);
    // SN-01 = the entity is a NET debt/litigation TARGET. Civil-defendant AND payment-order cases are
    // both "against it"; a company that sues at least as often as it is sued is enforcing receivables
    // (spec R-04), not distressed — so we net the total against its plaintiff activity. This keeps big,
    // litigation-heavy-but-healthy companies out of SN-01 (a single payment order must not sink them).
    // Payment orders are the clean unpaid-debt half → harsher band when they dominate. Case type/amount
    // are captcha-gated, hence the net proxy.
    const target = civilDef + payDef;
    const net = target - plaCount;
    if (net >= 1 && d > 0) {
      const base = (payDef >= 5 || net >= 10 ? -15 : net >= 3 ? -12 : -10) * d;
      const desc = payDef > 0
        ? `Net debt/litigation target (all-time): ${civilDef} civil + ${payDef} payment-order case(s) vs ${plaCount} as plaintiff`
        : `Net litigation target (all-time): ${civilDef} case(s) as defendant vs ${plaCount} as plaintiff`;
      const i18n = [P(payDef > 0 ? "sig_sn01_pay" : "sig_sn01_civil", { civil: civilDef, pay: payDef, pla: plaCount }), ...(yr ? [P("sig_sn01_recent", { yr })] : []), P("sig_period"), NM];
      out.push(mkSignal("SN-01", "strong", "-", [def.fact_id], `${desc}${yr ? `, most recent ${yr}` : ""}.` + NAME_MATCHED, base, i18n));
    } else if (net >= 1 && target === 1) {
      out.push(mkSignal("WN-07", "weak", "-", [def.fact_id], "A single, dated defendant case (>24 months old)." + NAME_MATCHED, undefined, [P("sig_wn07"), NM]));
    }
  }

  const bkr = f("F-CRT-03");
  if (bkr) {
    const yr = yearIn(bkr.value);
    // The captcha-solved detail (datalex.ts) appends "verdict: rejected" when the bankruptcy court
    // REJECTED the declare-bankrupt petition — the entity is NOT bankrupt (a creditor's petition
    // failed), so B-01 must not block (e.g. Araratcement). Only an explicit reject suppresses it.
    // Not bankrupt if the captcha-solved verdict says the petition was REJECTED or the proceedings
    // were TERMINATED/withdrawn (e.g. ML Mining ՍնԴ/1315/04/26 — terminated on the applicants'
    // withdrawal). Either suppresses the B-01 veto; only a genuinely open case should block.
    const closed = /verdict:\s*(rejected|terminated)/.test(bkr.value);
    // B-01 needs OPEN bankruptcy. We infer "open" from recency (≤4y): Armenian corporate
    // bankruptcies run multi-year, so a recent filing is almost certainly still live. Older ones
    // are NOT blocked — they could be discharged, which we cannot confirm behind the detail
    // captcha — so a stale bankruptcy stays visible as the F-CRT-03 fact without vetoing the score.
    if (!closed && yr !== null && nowYear - yr <= 4) {
      out.push(mkSignal("B-01", "blocker", "-", [bkr.fact_id], `Appears as the debtor in a bankruptcy case (filed ${yr}) — open insolvency proceedings.` + NAME_MATCHED, undefined, [P("sig_b01", { yr }), NM]));
    }
  }
  return out;
}

function buildNarrative(signals: Signal[], facts: Fact[], verified: number, sourcesText: string): NarrativeLine[] {
  const lines: NarrativeLine[] = [];
  const blocker = signals.find((s) => s.grade === "blocker");
  if (blocker) lines.push({ text: "BLOCKED: " + blocker.note, evidence: blocker.evidence, i18n: blocker.i18n ? [P("nar_blocked"), ...blocker.i18n] : undefined });
  for (const s of signals.filter((x) => x.grade !== "blocker")) lines.push({ text: s.note, evidence: s.evidence, i18n: s.i18n });
  // Surface the sanctions screening result. A STRONG match is already the blocker line above and a
  // POSSIBLE match is a missing-item CTA, so here we only show the reassuring CLEAN result — otherwise
  // "we checked OFAC and it's clean" is invisible (the user asked why nothing shows for a clean entity).
  const san = facts.find((fct) => fct.catalog_id === "F-SAN-01");
  if (san && /no matches/i.test(san.value)) lines.push({ text: "OFAC sanctions screened — no match.", evidence: [san.fact_id], i18n: [P("nar_sanctions_clean")] });
  // Same for the beneficial-owner screen (F-SAN-02) — for single-token-named entities this is the
  // ONLY sanctions result (the entity-name screen declined), so it must be visible when clean.
  const ownerScreen = facts.find((fct) => fct.catalog_id === "F-SAN-02");
  if (ownerScreen && /no matches/i.test(ownerScreen.value)) lines.push({ text: "Beneficial owners screened against OFAC — no match.", evidence: [ownerScreen.fact_id], i18n: [P("nar_owners_screened_clean")] });
  // Surface beneficial owners prominently. They carry no scored signal (ownership transparency is
  // context, not a risk weight), so without this they would sit only in the collapsed facts list.
  // Localize the scaffolding ("declared …/since …"); the owner display (name + transliteration +
  // share) is DATA and stays verbatim inside the {who} param.
  const owners = facts.find((fct) => fct.catalog_id === "F-REG-07");
  if (owners) {
    const parsed = parseOwnerLine(owners.value);
    const pieces: I18nPiece[] = [P("nar_owners_head", { date: parsed.date })];
    parsed.owners.forEach((o, i) => {
      if (i > 0) pieces.push(P("nar_list_sep"));
      pieces.push(o.since ? P("nar_owner_since", { who: o.who, year: o.since }) : P("nar_owner_nosince", { who: o.who }));
    });
    lines.push({ text: owners.value, evidence: [owners.fact_id], i18n: pieces });
  }
  // Surface pledges as context when they did not trip SN-06 (mature-entity working-capital pledges
  // are neutral per R-05, but still worth showing) — otherwise they'd sit only in the facts list.
  const pledge = facts.find((fct) => fct.catalog_id === "F-PLG-01");
  if (pledge && !signals.some((s) => s.id === "SN-06")) {
    const n = Number((pledge.value.match(/^(\d+)/) || [])[1] || 0);
    const date = (pledge.value.match(/most recent (\d{2}-\d{2}-\d{4})/) || [])[1] || "";
    const cred = (pledge.value.match(/\(creditor: (.+)\)\s*$/) || [])[1] || ""; // creditor names = DATA, kept verbatim
    const pieces: I18nPiece[] = [P("nar_pledge", { n, date })];
    if (cred) pieces.push(P("nar_pledge_creditor", { creditors: cred }));
    lines.push({ text: pledge.value, evidence: [pledge.fact_id], i18n: pieces });
  }
  lines.push({
    text: `Live check covered ${verified} of 10 domains (${sourcesText}). Auction is not wired yet — treat this as a partial read.`,
    evidence: [],
    i18n: [P("nar_coverage", { n: verified })],
  });
  return lines;
}

const DOMAIN_LABEL: Record<string, string> = { tax: "tax", registry: "registry", web: "web/domain", contact: "contact", notice: "notices", court: "courts", pledge: "pledges", procurement: "procurement", enforcement: "enforcement" };

async function runCheck(input: Record<string, string>): Promise<Fixture> {
  const now = new Date().toISOString();
  const subject: Subject = {
    tin: input.tin || undefined,
    name: input.entity_name || undefined,
    person: input.person_first_name || input.entity_name || undefined,
    email: input.email || undefined,
    website: input.website || (input.email ? input.email.split("@")[1] : undefined),
  };

  // Phase 1: src.am — identity + registry basics; yields the canonical Armenian name AND the TIN.
  const srcRes = await resilientFetch(srcAdapter, subject, { cache, breaker });
  const taxVal = srcRes.facts.find((f) => f.catalog_id === "F-TAX-01")?.value || "";
  const canonicalName = taxVal.includes(" — TIN") ? stripLegal(taxVal.split(" — TIN")[0]) : subject.name || "";
  // Propagate the TIN src.am resolved so the TIN-keyed adapters (e-register owners) work even when
  // the caller passed only a name — the resolver is the single place the TIN gets pinned.
  const resolvedTin = subject.tin || (taxVal.match(/— TIN (\d+)/) || [])[1] || undefined;
  // Carry the resolved canonical name onto the keyed subject so sanctions screens the entity name
  // even on a TIN-only check (sanctions screens person||name; whois/mx/e-register/enforcement key on
  // website/email/tin, so a name here is harmless to them). Without this, a TIN-only check screened ""
  // → no F-SAN-01 fact → the dossier showed nothing about sanctions.
  const keyedSubject: Subject = { ...subject, tin: resolvedTin, name: subject.name || canonicalName || undefined };
  const nameSubject: Subject = { ...subject, tin: resolvedTin, name: canonicalName };

  // Phase 2: keyed adapters (raw subject + resolved TIN) + name-keyed adapters (canonical name).
  const rest = await Promise.all([
    ...KEYED_ADAPTERS.map((a) => resilientFetch(a, keyedSubject, { cache, breaker })),
    ...NAME_KEYED_ADAPTERS.map((a) => resilientFetch(a, nameSubject, { cache, breaker })),
  ]);
  const results = [srcRes, ...rest];
  const facts = results.flatMap((r) => r.facts);

  // Sanctions screening of beneficial OWNERS (UBOs) — source-access-spec §1–2/§11, the spec's
  // intended director/UBO screen. Owners (F-REG-07) only resolve after the keyed adapters run, so
  // this is a post-step here, not inside an adapter (it also keeps the one-network-call-per-adapter
  // contract intact). It is what lets a single-token-named company (ML Mining, Inecobank) show a
  // sanctions status at all: the company name can't be screened, but its OWNER names have ≥2 tokens.
  const ownersFact = facts.find((ff) => ff.catalog_id === "F-REG-07");
  if (ownersFact) {
    try {
      const screen = await screenOwners(ownerNamesFromValue(ownersFact.value));
      if (screen) {
        const fmt = (h: { name: string; matches: string[] }) => `${h.name} → ${h.matches.join(", ")}`;
        let value: string;
        if (screen.strong.length) value = `OFAC sanctions match (strong) on beneficial owner: ${screen.strong.map(fmt).join("; ")}`;
        else if (screen.possible.length) value = `Possible OFAC match on beneficial owner — manual review: ${screen.possible.map(fmt).join("; ")}`;
        else value = `Beneficial owners screened — no matches (OFAC SDN): ${screen.screened.join("; ")}`;
        facts.push(
          makeFact({
            catalog_id: "F-SAN-02",
            subject: ownersFact.subject,
            domain: "sanctions",
            field: "owner_screening",
            value,
            source: "OFAC SDN",
            url: "", // OFAC search is a JS/POST app with no replayable per-name GET URL (disabled ↗)
            fetched_at: now,
            match: ownersFact.match, // owners are TIN-confirmed; the OFAC name-match strength lives in strong/possible
          }),
        );
      }
    } catch {
      // OFAC list could not be loaded → emit NO owner-screening fact ("could not query", not "clean").
    }
  }

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

  // The registered name as src.am returned it (F-TAX-01 = "«NAME» — TIN <n>"). When the user typed
  // ONLY a TIN, fall back to this resolved name for the dossier title — NOT the raw TIN number.
  const resolvedName = taxVal.includes(" — TIN") ? taxVal.split(" — TIN")[0].trim() : "";
  const nameHy = input.entity_name || resolvedName || input.website || input.tin || "Counterparty";
  const nameEn = input.entity_name || (resolvedName ? translitHyToLatin(resolvedName) : "") || input.website || input.tin || "Counterparty";
  // A non-blocking "possible" sanctions match surfaces as a review gap (the strong match already
  // vetoed via B-05 in deriveSignals; this is the soft path that must NOT block).
  const missing = [{ gap: "Auction not checked live", cta: "Manual check recommended", mock: false, gap_i18n: [P("miss_auction")], cta_i18n: [P("miss_cta_manual")] }];
  if (facts.some((ff) => /^F-SAN-0[12]$/.test(ff.catalog_id) && /Possible OFAC match/i.test(ff.value)))
    missing.unshift({ gap: "Possible sanctions name match (unconfirmed)", cta: "Verify the counterparty name against the OFAC SDN list manually", mock: false, gap_i18n: [P("miss_sanctions")], cta_i18n: [P("miss_cta_sanctions")] });
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
    resolution: { ambiguous: false, candidates_reserve: [], selected: { tin: resolvedTin || input.tin || "—", name_hy: nameHy, name_en: nameEn } },
    facts,
    signals: eng.signals,
    rules_fired: eng.rulesFired.map((id) => ({ id, effect: "applied", note: "" })),
    verdict: {
      state: eng.state,
      checked_at: now,
      blockers: eng.blockers,
      score: eng.score,
      coverage,
      tier_map: eng.tier_map,
      band_blur: eng.band_blur,
      narrative: buildNarrative(eng.signals, facts, coverage.verified, sourcesText),
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
