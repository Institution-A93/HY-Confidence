// TIN handling. TIN is the only identifier shared across all Armenian sources
// (source-access-spec.md §12) — it is the join key that turns name-matched (fuzzy) facts
// into TIN-confirmed (exact) ones. This module is the input pre-flight: catch typos before
// any network call.
//
// Format: 8 digits = a 7-digit serial + 1 check digit. The exact check-digit algorithm is
// NOT published (spec §3: "derive it from known-valid TINs or fall back to '8 digits +
// exists in SRC search'"). The demo fixtures use FICTIONAL TINs, so no real algorithm can
// be derived here — we validate format only and defer the checksum to recon. See checkDigit.

export function normalizeTin(input: string): string {
  return (input || "").replace(/\D+/g, "");
}

export function isValidTinFormat(input: string): boolean {
  return /^\d{8}$/.test(normalizeTin(input));
}

export type TinStatus =
  | { ok: true; tin: string }
  | { ok: false; reason: "empty" | "non_numeric" | "wrong_length" };

export function tinStatus(input: string): TinStatus {
  const raw = (input || "").trim();
  if (!raw) return { ok: false, reason: "empty" };
  const digits = normalizeTin(raw);
  if (digits.length === 0) return { ok: false, reason: "non_numeric" };
  if (digits.length !== 8) return { ok: false, reason: "wrong_length" };
  return { ok: true, tin: digits };
}

// Placeholder. The check-digit formula is unconfirmed; until recon derives it from a set
// of known-valid TINs (recon checklist), format + existence-in-SRC is the real gate.
// Returns null = "cannot verify the check digit", NOT "invalid".
export function checkDigit(_tin: string): boolean | null {
  return null;
}
