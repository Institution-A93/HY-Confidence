// Shared low-poly components + helpers, ported from the mockup's app1 module.
import { useT } from "./i18n";
import type { Fixture, Fact, Verdict, TierColor, TierKey } from "./types";

export const COVERAGE_DOMAINS = [
  { key: "registry", label: "Registry", source: "e-register" },
  { key: "graph", label: "Affiliations", source: "e-register" },
  { key: "tax", label: "Tax / SRC", source: "SRC" },
  { key: "court", label: "Courts", source: "Datalex" },
  { key: "enforcement", label: "Enforcement", source: "DAHK" },
  { key: "pledge", label: "Pledges", source: "Pledge register" },
  { key: "notice", label: "Notices", source: "Azdarar" },
  { key: "procurement", label: "Procurement", source: "armeps" },
  { key: "web", label: "Web & domain", source: "WHOIS / Archive" },
  { key: "contact", label: "Contact channel", source: "lookup" },
] as const;

export function truncate(s: unknown, n: number): string {
  const str = String(s == null ? "" : s);
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

export function isEmptyValue(v: unknown): boolean {
  return /^(none found|no matches|no records)/i.test(String(v || ""));
}

export interface DomainState {
  key: string;
  label: string;
  source: string;
  state: "ok" | "empty" | "fail";
  teaser: string;
}

// Derive each coverage domain's checking-screen state from the fixture's facts.
export function domainStates(fixture: Fixture): DomainState[] {
  const facts = fixture.facts || [];
  return COVERAGE_DOMAINS.map((d) => {
    const df = facts.filter((f) => f.domain === d.key);
    let state: DomainState["state"];
    let teaser: string;
    if (df.length === 0) {
      state = "empty";
      teaser = "none found";
    } else {
      const meaningful = df.find((f) => !isEmptyValue(f.value));
      if (meaningful) {
        state = "ok";
        teaser = truncate(meaningful.value, 76);
      } else {
        state = "empty";
        teaser = "none found";
      }
    }
    return { ...d, state, teaser };
  });
}

export function factById(fixture: Fixture, id: string): Fact | undefined {
  return (fixture.facts || []).find((f) => f.fact_id === id);
}

export function EvidenceLinks({ fixture, ids }: { fixture: Fixture; ids?: string[] }) {
  if (!ids || ids.length === 0) return null;
  return (
    <span className="ev-group">
      {ids.map((id, i) => {
        const f = factById(fixture, id);
        const url = f && f.url;
        return (
          <a
            key={i}
            className="ev"
            href={url || undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!url}
            title={f ? f.source + " — " + (url || "no link") : id}
            onClick={(e) => {
              if (!url) e.preventDefault();
            }}
          >
            ↗
          </a>
        );
      })}
    </span>
  );
}

export function StatusChip({ status }: { status?: string }) {
  const t = useT();
  const s = (status || "").toLowerCase();
  let cls = "chip";
  let label = status || "—";
  // src.am returns the status in Armenian (Գործող / Լուծարված / Սնանկ …), so each branch matches the
  // Armenian root as well as English/Russian, AND sets a translated label — otherwise non-active
  // statuses fell through and rendered the raw Armenian text. Bankrupt is tested before liquidated
  // (both are "danger"); the active root is the full word գործող, not just գործ, so it does not match
  // "լուծարման գործընթաց" (liquidation process).
  if (/active|գործող|активн/.test(s)) {
    cls += " active";
    label = t("st_active");
  } else if (/bankrupt|սնանկ|банкрот/.test(s)) {
    cls += " danger";
    label = t("st_bankrupt");
  } else if (/liquidat|լուծ|ликвид/.test(s)) {
    cls += " danger";
    label = t("st_liquidated");
  } else if (/reorg|suspend|վերակազմ|կասեց|реорг|приостан/.test(s)) {
    cls += " warn";
    label = t("st_reorg");
  }
  return (
    <span className={cls}>
      <span className="dot"></span>
      {label}
    </span>
  );
}

export const TIER_COLOR: Record<TierColor, string> = {
  green: "#5BAE77",
  yellow: "#E0B23E",
  red: "#C0533F",
  gray: "#9A958A",
};

export const TIER_DEF: { key: TierKey; label: string; desc: string }[] = [
  { key: "T1", label: "T1", desc: "Prepaid" },
  { key: "T2", label: "T2", desc: "Small credit" },
  { key: "T3", label: "T3", desc: "Material credit" },
  { key: "T4", label: "T4", desc: "Large / preferential" },
];

const TIER_STATE_WORD: Record<TierColor, string> = {
  green: "ts_clear",
  yellow: "ts_caution",
  red: "ts_stop",
  gray: "ts_unknown",
};

// Continuous gradient across the 4 tier segments; band_blur widens transitions between
// differently-colored neighbours. BLOCKED forces full red.
function buildScaleGradient(tierMap: Partial<Record<TierKey, TierColor>>, blur: number, blocked: boolean): string {
  const colors = TIER_DEF.map((t) => {
    const c = blocked ? "red" : tierMap[t.key] || "gray";
    return TIER_COLOR[c as TierColor] || TIER_COLOR.gray;
  });
  const halfBlur = Math.min(12, blur * 4);
  const stops: string[] = [];
  for (let i = 0; i < 4; i++) {
    const segStart = i * 25,
      segEnd = (i + 1) * 25;
    const prevDiff = i > 0 && colors[i] !== colors[i - 1];
    const nextDiff = i < 3 && colors[i] !== colors[i + 1];
    const a = prevDiff ? segStart + halfBlur : segStart;
    const b = nextDiff ? segEnd - halfBlur : segEnd;
    stops.push(`${colors[i]} ${a}%`);
    stops.push(`${colors[i]} ${b}%`);
  }
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

function tierColorKeys(tierMap: Partial<Record<TierKey, TierColor>>, blocked: boolean, unverif: boolean): TierColor[] {
  return TIER_DEF.map((seg) => {
    if (unverif) return "gray";
    if (blocked) return "red";
    return (tierMap[seg.key] || "gray") as TierColor;
  });
}

export function TierStrip({ verdict }: { verdict: Verdict }) {
  const t = useT();
  const blocked = verdict.state === "BLOCKED";
  const unverif = verdict.state === "UNVERIFIABLE";
  const tierMap = verdict.tier_map || {};
  const keys = tierColorKeys(tierMap, blocked, unverif);
  const bg = unverif ? TIER_COLOR.gray : buildScaleGradient(tierMap, verdict.band_blur || 0, blocked);
  const blurNote = (verdict.band_blur || 0) > 0;
  return (
    <div className="scale-block">
      <div className="scale-strip" style={{ background: bg }}>
        <div className="scale-ticks">
          {TIER_DEF.map((seg) => (
            <div key={seg.key} className="tk"></div>
          ))}
        </div>
      </div>
      <div className="scale-labels">
        {TIER_DEF.map((seg, i) => (
          <div key={seg.key} className="seg-label">
            <div className="seg-top">
              <span className="t">{seg.label}</span>
              <span className="seg-state" style={{ color: TIER_COLOR[keys[i]] }}>
                {t(TIER_STATE_WORD[keys[i]])}
              </span>
            </div>
            <div className="d">{t("tier_" + seg.key.toLowerCase())}</div>
          </div>
        ))}
      </div>
      <div className="scale-caption">
        {t("caption")}
        {blurNote ? " · " + t("band_partial") : ""}
      </div>
    </div>
  );
}
