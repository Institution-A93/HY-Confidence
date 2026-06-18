// Signal weight priors — config, NOT code (scoring-model-spec.md §2: "Keep them in
// config, not code"). These are demo priors to be calibrated against 5–8 known
// counterparties before any real use. The live signal-detection layer assigns a base
// weight from here; the fixtures already carry their own weight_base, so the engine
// uses the weight_base it is given and only the COMPOSITION (rules) lives in code.
//
// Blockers carry no weight — they veto (null). Ranges in the spec (e.g. SN-01 −10…−15)
// are represented by a single representative prior here; the real detector scales them.

export const BASE_WEIGHTS: Record<string, number | null> = {
  // Blockers (veto)
  "B-01": null,
  "B-02": null,
  "B-03": null,
  "B-04": null,
  "B-05": null,
  "B-06": null,
  // Strong negatives
  "SN-01": -12,
  "SN-03": -8,
  "SN-04": -8,
  "SN-05": -12,
  "SN-06": -8,
  "SN-07": -8,
  "SN-08": -8,
  "SN-10": -8,
  // Weak negatives
  "WN-01": -3,
  "WN-02": -2,
  "WN-03": -3,
  "WN-04": -3,
  "WN-05": -3,
  "WN-06": -2,
  "WN-07": -2,
  // Strong positives
  "SP-01": 10,
  "SP-02": 12,
  "SP-03": 10,
  "SP-05": 8,
  // Weak positives
  "WP-01": 4,
  "WP-02": 2,
  "WP-03": 2,
  "WP-04": 2,
  "WP-05": 3,
  "WP-06": 3,
  "WP-07": 2,
  "WP-08": 2,
  "WP-09": 4,
  // Channel attribution
  "CH-01": 2,
  "CH-02": -6,
  "CH-03": -12,
};

export function baseWeightFor(signalId: string): number | null {
  return signalId in BASE_WEIGHTS ? BASE_WEIGHTS[signalId] : 0;
}

// R-07: the sum of all weak-positive (WP-*) contributions is capped at this value.
export const WEAK_POSITIVE_CAP = 10;

// R-08: signals whose evidence is entirely name-matched (fuzzy) facts are damped by this.
export const FUZZY_DAMPING = 0.7;

// R-01: track-record offset halves the young-entity penalties when SP-05 fired.
export const TRACK_RECORD_OFFSET = 0.5;
