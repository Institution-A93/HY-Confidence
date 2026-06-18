// Domain model shared by the scoring engine, the fetchers, and the render layer.
// Mirrors the records in scoring-model-spec.md and demo-fixtures.json. The frontend
// renders these; the backend (eventually) emits them — same contract either way.

export type Match = "exact" | "fuzzy";

export type Domain =
  | "registry"
  | "graph"
  | "tax"
  | "court"
  | "enforcement"
  | "pledge"
  | "cadastre"
  | "notice"
  | "procurement"
  | "auction"
  | "web"
  | "contact"
  | "sanctions"
  | "representative";

// An atomic, sourced datum. Nothing enters the Signal layer that is not a Fact.
export interface Fact {
  fact_id: string;
  catalog_id: string; // e.g. F-REG-02
  subject: string; // TIN or "person:Name" or "channel:..."
  domain: Domain;
  field: string;
  value: string;
  source: string;
  url: string; // deep link to evidence; "" when none
  fetched_at: string; // ISO timestamp
  match: Match;
}

export type Grade = "blocker" | "strong" | "weak";
export type Polarity = "+" | "-";

export interface Signal {
  id: string; // e.g. SN-01, SP-03, B-03, WP-06
  grade: Grade;
  polarity: Polarity;
  weight_base: number | null; // blockers carry null — they veto
  weight_effective: number | null; // after rules (e.g. R-01 halving, R-08 ×0.7)
  evidence: string[]; // fact_ids
  note: string; // becomes a narrative line
}

export interface Rule {
  id: string; // e.g. R-01, R-07
  effect: string;
  note: string;
}

export type TierColor = "green" | "yellow" | "red" | "gray";
export type TierKey = "T1" | "T2" | "T3" | "T4";
export type VerdictState = "SCORED" | "BLOCKED" | "UNVERIFIABLE";

export interface NarrativeLine {
  text: string;
  evidence: string[];
}

export interface MissingItem {
  gap: string;
  cta: string;
  mock: boolean;
}

export interface SpawnOffer {
  trigger: string;
  target_tin: string;
  target_name_en: string;
  target_name_hy: string;
  message: string;
}

export interface Verdict {
  state: VerdictState;
  blockers?: string[];
  score: number | null;
  coverage: { verified: number; total: number };
  tier_map: Partial<Record<TierKey, TierColor>>;
  band_blur: number; // 0–3, gradient width between differently-colored segments
  narrative: NarrativeLine[];
  missing: MissingItem[];
  spawn_offer?: SpawnOffer;
  rules_fired?: Rule[];
}

export interface Candidate {
  tin: string;
  name_hy: string;
  name_en: string;
  address?: string;
  director?: string;
  registration_date?: string;
  status?: string;
}

export interface Selected {
  tin: string;
  name_hy: string;
  name_en: string;
}

export interface Resolution {
  ambiguous: boolean;
  candidates?: Candidate[];
  selected?: Selected;
  candidates_reserve: string[];
}

export interface CheckInput {
  entity_name: string;
  tin: string | null;
  person_first_name: string | null;
  phone: string | null;
}

export interface Fixture {
  id: string;
  label: string;
  demonstrates: string[];
  input: CheckInput;
  resolution: Resolution;
  facts: Fact[];
  signals: Signal[];
  rules_fired: Rule[];
  verdict: Verdict | null;
}

export interface FixturesFile {
  _meta: {
    description: string;
    spec_version: string;
    generated_at: string;
    checked_at_render: string;
    coverage_domains: Domain[];
  };
  fixtures: Fixture[];
}
