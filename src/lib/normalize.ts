// Armenian text normalization — the layer every name-based source depends on
// (source-access-spec.md §12). Government sources index in Armenian script; user input
// arrives in Armenian, Latin, or Cyrillic. We transliterate HY→Latin, canonicalize legal
// forms, and generate a variant set so a name typed one way still matches a record stored
// another way. Pure, deterministic, browser-safe.
//
// NOTE: transliteration is inherently lossy (ք→q vs k, ճ→ch vs j, ղ→gh vs g, ո→o vs vo).
// We pick a canonical mapping AND emit branch variants for the ambiguous letters so recall
// does not depend on guessing which romanization a source used.

// Pragmatic HY→Latin (Mesropian + the spec's variants). Digraphs handled before singles.
const DIGRAPHS: [string, string][] = [
  ["ու", "u"],
  ["ՈՒ", "u"],
  ["և", "ev"],
  ["եւ", "ev"],
];

const MAP: Record<string, string> = {
  ա: "a", բ: "b", գ: "g", դ: "d", ե: "e", զ: "z", է: "e", ը: "e", թ: "t",
  ժ: "zh", ի: "i", լ: "l", խ: "kh", ծ: "ts", կ: "k", հ: "h", ձ: "dz", ղ: "gh",
  ճ: "ch", մ: "m", յ: "y", ն: "n", շ: "sh", ո: "o", չ: "ch", պ: "p", ջ: "j",
  ռ: "r", ս: "s", վ: "v", տ: "t", ր: "r", ց: "ts", փ: "p", ք: "q", օ: "o", ֆ: "f",
  ւ: "v",
};

// Letters whose romanization sources disagree on → emit alternates for the variant set.
const AMBIGUOUS: Record<string, string[]> = {
  ք: ["q", "k"],
  ճ: ["ch", "j"],
  ղ: ["gh", "g"],
  ո: ["o", "vo"],
  խ: ["kh", "x"],
};

const LEGAL_SUFFIXES = [
  // Armenian
  "ՍՊԸ", "ՓԲԸ", "ԲԲԸ", "ԱՁ", "ԱԿ", "ՊԿ",
  // Latin equivalents
  "LLC", "CJSC", "OJSC", "JSC", "IE", "LTD", "CO",
];

export function translitHyToLatin(input: string): string {
  let s = input;
  for (const [hy, lat] of DIGRAPHS) s = s.split(hy).join(lat);
  let out = "";
  for (const ch of s) {
    const lower = ch.toLowerCase();
    out += MAP[lower] ?? (MAP[ch] ?? ch);
  }
  return out;
}

// Strip legal-form suffixes, «»/quotes, and surrounding punctuation. Keeps the script.
export function stripLegal(name: string): string {
  let s = name.replace(/[«»"'`]/g, " ");
  const re = new RegExp("\\b(" + LEGAL_SUFFIXES.join("|") + ")\\b\\.?", "gi");
  s = s.replace(re, " ");
  // also catch suffixes glued without a word boundary (Armenian has no case fold boundary)
  for (const suf of LEGAL_SUFFIXES) s = s.split(suf).join(" ");
  return s.replace(/\s+/g, " ").trim();
}

// A comparable Latin key: stripped → transliterated → lowercased → alnum only.
export function toLatinKey(name: string): string {
  return translitHyToLatin(stripLegal(name))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

// Latin tokens (words) for token-overlap matching.
export function toLatinTokens(name: string): string[] {
  return translitHyToLatin(stripLegal(name))
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Generate a set of canonical Latin keys, branching on ambiguous Armenian letters so a
// record romanized either way is reachable. Capped to avoid combinatorial blow-up.
export function nameVariants(name: string, maxVariants = 16): Set<string> {
  const stripped = stripLegal(name);
  let forms: string[] = [""];
  const pushChar = (alts: string[]) => {
    const next: string[] = [];
    for (const f of forms) for (const a of alts) next.push(f + a);
    forms = next.length > maxVariants ? next.slice(0, maxVariants) : next;
  };
  let i = 0;
  const lowered = stripped;
  while (i < lowered.length) {
    // digraphs first
    const two = lowered.slice(i, i + 2);
    const dg = DIGRAPHS.find(([hy]) => hy === two || hy.toLowerCase() === two.toLowerCase());
    if (dg) {
      pushChar([dg[1]]);
      i += 2;
      continue;
    }
    const ch = lowered[i];
    const lower = ch.toLowerCase();
    if (AMBIGUOUS[lower]) pushChar(AMBIGUOUS[lower]);
    else pushChar([MAP[lower] ?? ch]);
    i++;
  }
  return new Set(forms.map((f) => f.toLowerCase().replace(/[^a-z0-9]+/g, "")).filter(Boolean));
}

// Best-effort Latin/Cyrillic → Armenian, so a name typed in Latin can be queried against
// Armenian-indexed sources (src.am etc.). LOW RECALL by nature — transliteration is lossy
// and conventional spellings diverge (e.g. "Candy" is registered «Քենդի», not «Քանդի»). TIN
// stays the reliable identifier; this only widens name-search reach.
const LAT_DIGRAPHS: [string, string][] = [
  ["gh", "ղ"], ["ch", "չ"], ["sh", "շ"], ["ts", "ց"], ["dz", "ձ"], ["zh", "ժ"],
  ["kh", "խ"], ["ph", "փ"], ["th", "թ"], ["yu", "յու"], ["ya", "յա"],
];
const LAT_SINGLE: Record<string, string> = {
  a: "ա", b: "բ", c: "կ", d: "դ", e: "ե", f: "ֆ", g: "գ", h: "հ", i: "ի", j: "ջ",
  k: "կ", l: "լ", m: "մ", n: "ն", o: "ո", p: "պ", q: "ք", r: "ր", s: "ս", t: "տ",
  u: "ու", v: "վ", w: "վ", x: "խ", y: "յ", z: "զ",
};
// Pragmatic Cyrillic → Latin first (then reuse the Latin map), for RU input.
const CYR_TO_LAT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ы: "i", э: "e",
  ю: "yu", я: "ya", ь: "", ъ: "",
};

function cyrToLat(s: string): string {
  let out = "";
  for (const ch of s) out += CYR_TO_LAT[ch.toLowerCase()] ?? ch;
  return out;
}

export function latinToArmenian(input: string): string {
  let s = cyrToLat(input).toLowerCase();
  let out = "";
  let i = 0;
  while (i < s.length) {
    const two = s.slice(i, i + 2);
    const dg = LAT_DIGRAPHS.find(([l]) => l === two);
    if (dg) {
      out += dg[1];
      i += 2;
      continue;
    }
    const ch = s[i];
    out += LAT_SINGLE[ch] ?? ch;
    i++;
  }
  return out;
}

const ARMENIAN_RE = /[԰-֏]/;
export function hasArmenian(s: string): boolean {
  return ARMENIAN_RE.test(s);
}

// Query candidates in Armenian script for a name in any script. Armenian input passes
// through unchanged; Latin/Cyrillic input is transliterated (best-effort).
export function armenianQueryCandidates(name: string): string[] {
  const n = (name || "").trim();
  if (!n) return [];
  if (hasArmenian(n)) return [n];
  return [latinToArmenian(n)];
}

// Token-overlap similarity in [0,1] between two names across scripts.
export function sameEntityScore(a: string, b: string): number {
  const ta = new Set(toLatinTokens(a));
  const tb = new Set(toLatinTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let hit = 0;
  for (const x of ta) if (tb.has(x)) hit++;
  return hit / Math.max(ta.size, tb.size);
}

export function sameEntity(a: string, b: string, threshold = 0.5): boolean {
  return sameEntityScore(a, b) >= threshold;
}
