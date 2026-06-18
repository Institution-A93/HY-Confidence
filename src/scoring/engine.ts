// Scoring engine — Facts/Signals → Composition rules → Verdict. Pure logic, no DOM,
// so it runs client-side (Pages) and is unit-tested against the four fixtures.
//
// SCOPE: this layer owns the COMPOSITION (rules R-01/07/08 etc.), the score math, the
// score→tier mapping, the verdict state, and band width. Signal DETECTION from raw facts
// (which signals fire, with what base weight) is a separate layer that needs structured
// facts; here the engine takes signals with weight_base already set (from the detector or,
// in the demo, from the fixtures) and computes everything downstream. The curated
// narrative prose stays authored in the fixtures; template-generated narrative is future.

import type { Fact, Signal, TierColor, TierKey, VerdictState } from "../types";
import { FUZZY_DAMPING, TRACK_RECORD_OFFSET, WEAK_POSITIVE_CAP } from "./weights";

export interface EngineInput {
  signals: Signal[]; // each carries weight_base
  facts: Fact[];
  coverage: { verified: number; total: number };
  fuzzyResolution: boolean; // entity resolved by name, not TIN-confirmed
}

export interface EngineResult {
  state: VerdictState;
  score: number; // rounded integer (display)
  scoreRaw: number; // before rounding (exposes rule arithmetic)
  tier_map: Record<TierKey, TierColor>;
  band_blur: number;
  coverage: { verified: number; total: number };
  blockers: string[];
  signals: Signal[]; // copies with weight_effective + ruleRefs filled
  rulesFired: string[];
}

const TIERS: TierKey[] = ["T1", "T2", "T3", "T4"];

function isWeakPositive(s: Signal): boolean {
  return s.grade === "weak" && s.polarity === "+";
}

function allEvidenceFuzzy(s: Signal, byId: Map<string, Fact>): boolean {
  if (!s.evidence || s.evidence.length === 0) return false;
  return s.evidence.every((id) => byId.get(id)?.match === "fuzzy");
}

// R-01/R-08 act per-signal; returns copies with weight_effective set and the rule ids
// that touched each signal recorded for the UI's "−8 → −4 via R-01" affordance.
function applyPerSignalRules(
  signals: Signal[],
  byId: Map<string, Fact>,
): { signals: Signal[]; rulesFired: Set<string> } {
  const rulesFired = new Set<string>();
  const hasSP05 = signals.some((s) => s.id === "SP-05");

  const out = signals.map((s) => {
    const copy: Signal = { ...s };
    if (copy.grade === "blocker") {
      copy.weight_effective = null; // blockers veto, no weight
      return copy;
    }
    let eff = copy.weight_base ?? 0;

    // R-08 fuzzy-match damping: evidence entirely name-matched → ×0.7
    if (allEvidenceFuzzy(copy, byId)) {
      eff *= FUZZY_DAMPING;
      rulesFired.add("R-08");
    }
    // R-01 track-record offset: SP-05 present halves the young-entity penalties
    if (hasSP05 && (copy.id === "SN-07" || copy.id === "WN-01")) {
      eff *= TRACK_RECORD_OFFSET;
      rulesFired.add("R-01");
    }

    copy.weight_effective = round2(eff);
    return copy;
  });

  return { signals: out, rulesFired };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// R-07 weak-positive cap is applied at the SUM level (matches the fixtures: individual
// WP weights stay at base, only their combined contribution to the score is capped).
function computeScore(signals: Signal[], rulesFired: Set<string>): number {
  let weakPos = 0;
  let rest = 0;
  for (const s of signals) {
    if (s.grade === "blocker") continue;
    const w = s.weight_effective ?? 0;
    if (isWeakPositive(s)) weakPos += w;
    else rest += w;
  }
  let cappedWeakPos = weakPos;
  if (weakPos > WEAK_POSITIVE_CAP) {
    cappedWeakPos = WEAK_POSITIVE_CAP;
    rulesFired.add("R-07");
  }
  return rest + cappedWeakPos;
}

// Score → tier colors. Spec table (scoring-model-spec.md §4); BLOCKED overrides to all-red.
export function tierMapFromScore(score: number, blocked: boolean): Record<TierKey, TierColor> {
  if (blocked) return fill("red");
  let cols: TierColor[];
  if (score >= 20) cols = ["green", "green", "green", "yellow"];
  else if (score >= 8) cols = ["green", "green", "yellow", "red"];
  else if (score >= -5) cols = ["green", "yellow", "yellow", "red"];
  else if (score >= -20) cols = ["yellow", "red", "red", "red"];
  else cols = ["red", "red", "red", "red"];
  return { T1: cols[0], T2: cols[1], T3: cols[2], T4: cols[3] };
}

function fill(c: TierColor): Record<TierKey, TierColor> {
  return { T1: c, T2: c, T3: c, T4: c };
}

// band width = 1 blur per 2 missing domains (R-09), plus 1 when the entity was resolved
// by name not TIN (fuzzy resolution widens confidence — see the spawn fixture). Clamp 0–3.
export function bandBlur(coverage: { verified: number; total: number }, fuzzyResolution: boolean): number {
  const missing = Math.max(0, coverage.total - coverage.verified);
  const blur = Math.floor(missing / 2) + (fuzzyResolution ? 1 : 0);
  return Math.min(3, blur);
}

export function computeVerdict(input: EngineInput): EngineResult {
  const byId = new Map(input.facts.map((f) => [f.fact_id, f]));
  const { signals, rulesFired } = applyPerSignalRules(input.signals, byId);

  const blockers = signals.filter((s) => s.grade === "blocker").map((s) => s.id);
  const blocked = blockers.length > 0;
  const state: VerdictState = blocked ? "BLOCKED" : "SCORED";

  const scoreRaw = computeScore(signals, rulesFired);
  const score = Math.round(scoreRaw);
  const tier_map = tierMapFromScore(scoreRaw, blocked);

  return {
    state,
    score,
    scoreRaw,
    tier_map,
    band_blur: bandBlur(input.coverage, input.fuzzyResolution),
    coverage: input.coverage,
    blockers,
    signals,
    rulesFired: Array.from(rulesFired).sort(),
  };
}

export { TIERS };
