// Screens S1–S4, ported from the mockup's app2 module. Difference vs the mockup: the
// Export button is wired to onExport (the mockup shipped it disabled). All shell copy via
// t(); entity/fixture data stays bilingual.
import { useState, useEffect, useRef, useContext } from "react";
import { useT, LangContext, joinPieces } from "./i18n";
import { EvidenceLinks, StatusChip, TierStrip, TIER_COLOR, domainStates, isEmptyValue, checkedAtOf, formatChecked } from "./components";
import type { CheckInput, Fixture, MissingItem, NarrativeLine, Signal, SpawnOffer, TierKey, Verdict } from "./types";

/* ---------------- S1 — INPUT ---------------- */
export function InputScreen({
  initial,
  onSubmit,
  live,
}: {
  initial: CheckInput | null;
  onSubmit: (v: CheckInput) => void;
  live: boolean;
}) {
  const t = useT();
  const blank: CheckInput = { entity_name: "", tin: "", person_first_name: "", phone: "", website: "", email: "" };
  const [v, setV] = useState<CheckInput>(initial || blank);
  useEffect(() => {
    setV(initial || blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);
  const set = (k: keyof CheckInput) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setV((s) => ({ ...s, [k]: e.target.value }));
  const canSubmit = (["entity_name", "tin", "person_first_name", "phone", "website", "email"] as (keyof CheckInput)[]).some(
    (k) => (v[k] || "").toString().trim(),
  );
  const submit = () => {
    if (canSubmit) onSubmit(v);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") submit();
  };

  return (
    <div className="input-wrap">
      <div className={"card input-card" + (live ? " live" : "")}>
        {live ? (
          <div className="live-badge">
            <span className="lb-dot"></span>
            {t("s1_live_badge")}
          </div>
        ) : (
          <div className="eyebrow" style={{ marginBottom: 14 }}>
            {t("s1_eyebrow")}
          </div>
        )}
        <h1>{t("s1_title")}</h1>
        <p className="sub">{t("s1_sub")}</p>

        <div className="field primary">
          <label>{t("s1_company")}</label>
          <input value={v.entity_name} onChange={set("entity_name")} onKeyDown={onKey} placeholder={t("s1_company_ph")} />
        </div>

        <div className="field tin">
          <label>
            {t("s1_tin")}
            <span className="tin-badge">{t("s1_tin_badge")}</span>
            <span className="tip" data-tip={t("s1_tin_tip")}>
              i
            </span>
          </label>
          <input value={v.tin ?? ""} onChange={set("tin")} onKeyDown={onKey} placeholder={t("s1_tin_ph")} inputMode="numeric" />
        </div>

        <div className="field">
          <label>{t("s1_contact")}</label>
          <input
            value={v.person_first_name ?? ""}
            onChange={set("person_first_name")}
            onKeyDown={onKey}
            placeholder={t("s1_contact_ph")}
          />
        </div>

        <div className="field">
          <label>
            {t("s1_phone")}
            {/* Phone is collected but not yet wired into the check (reverse-lookup / channel
                attribution per the spec are not live) — flag it honestly rather than imply it scores. */}
            <span className="soon-badge">{t("soon")}</span>
            <span className="tip" data-tip={t("s1_phone_soon_tip")}>
              i
            </span>
          </label>
          <input value={v.phone ?? ""} onChange={set("phone")} onKeyDown={onKey} placeholder={t("s1_phone_ph")} />
        </div>

        {live && (
          <>
            <div className="field">
              <label>{t("s1_website")}</label>
              <input value={v.website ?? ""} onChange={set("website")} onKeyDown={onKey} placeholder={t("s1_website_ph")} />
            </div>
            <div className="field">
              <label>{t("s1_email")}</label>
              <input value={v.email ?? ""} onChange={set("email")} onKeyDown={onKey} placeholder={t("s1_email_ph")} />
            </div>
          </>
        )}

        <div className="input-foot">
          <p className="micro">{t("s1_micro")}</p>
          <div className="submit-row">
            <button className="btn" disabled={!canSubmit} onClick={submit}>
              {t("s1_cta")}
            </button>
          </div>
        </div>
      </div>

      {live && <p className="live-note">{t("s1_live_note")}</p>}
    </div>
  );
}

/* ---------------- S2 — RESOLVE ---------------- */
export function ResolveScreen({
  fixture,
  onPick,
  onRefine,
  onAddTin,
  onProceed,
}: {
  fixture: Fixture;
  onPick: (tin: string) => void;
  onRefine: () => void;
  onAddTin: () => void;
  onProceed: () => void;
}) {
  const t = useT();
  const cands = (fixture.resolution && fixture.resolution.candidates) || [];
  const q = fixture.input.entity_name || fixture.input.tin || "—";
  const hasTin = !!(fixture.input.tin || "").trim();

  if (cands.length === 0) {
    return (
      <div className="resolve-wrap">
        <div className="nomatch">
          <div className="nm-mark">∅</div>
          <h1>{t("nm_title")}</h1>
          <p className="nm-sub">{t("nm_sub", { q })}</p>
          <ul className="nm-hints">
            <li>{t("nm_hint_name")}</li>
            {!hasTin && <li>{t("nm_hint_tin")}</li>}
          </ul>
          <div className="nm-actions">
            <button className="btn" onClick={onRefine}>
              {t("nm_refine")}
            </button>
            {!hasTin && (
              <button className="btn ghost" onClick={onAddTin}>
                {t("nm_addtin")}
              </button>
            )}
          </div>
          <div className="nm-proceed">
            <button className="linkish" onClick={onProceed}>
              {t("nm_proceed")} →
            </button>
            <p className="nm-note">{t("nm_proceed_note")}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="resolve-wrap">
      <h1>{t("s2_title")}</h1>
      <p className="sub">{t("s2_sub", { name: fixture.input.entity_name })}</p>
      <div className="cand-list">
        {cands.map((c) => (
          <button key={c.tin} className="cand" onClick={() => onPick(c.tin)}>
            <div className="cand-body">
              <div className="cand-head">
                <div>
                  <div className="c-name hy">{c.name_hy}</div>
                  <div className="c-en">{c.name_en}</div>
                </div>
                <StatusChip status={c.status} />
              </div>
              <div className="c-meta">
                <div>
                  <span className="k">{t("k_tin")}</span>
                  <span className="mono">{c.tin}</span>
                </div>
                <div>
                  <span className="k">{t("k_director")}</span>
                  {c.director}
                </div>
                <div>
                  <span className="k">{t("k_registered")}</span>
                  <span className="mono">{c.registration_date}</span>
                </div>
                <div>
                  <span className="k">{t("k_address")}</span>
                  {c.address}
                </div>
              </div>
            </div>
            <span className="cand-select">{t("s2_select")} →</span>
          </button>
        ))}
      </div>
      <div className="resolve-foot">
        <button className="linkish" onClick={onRefine}>
          {t("s2_none")}
        </button>
      </div>
    </div>
  );
}

/* ---------------- S3 — CHECKING ---------------- */
export function CheckingScreen({ fixture, onDone }: { fixture: Fixture; onDone: () => void }) {
  const t = useT();
  const domains = useRef(domainStates(fixture)).current;
  const [revealed, setRevealed] = useState(0);
  const sel = fixture.resolution.selected!;
  const total = domains.length;

  useEffect(() => {
    setRevealed(0);
    const stepMs = 480;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i <= total; i++) {
      timers.push(setTimeout(() => setRevealed(i), i * stepMs));
    }
    timers.push(setTimeout(onDone, total * stepMs + 1100));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixture.id]);

  const allDone = revealed >= total;
  const pct = Math.round((revealed / total) * 100);

  return (
    <div className="check-wrap">
      <div className="head">
        <div className="eyebrow">{t("s3_eyebrow")}</div>
        <div className="c-name hy">{sel.name_hy}</div>
        <div className="c-tin">
          {t("k_tin")} {sel.tin}
        </div>
      </div>

      <div className="check-progress">
        <div className="cp-bar">
          <span style={{ width: pct + "%" }}></span>
        </div>
        <div className="cp-count">
          {allDone ? (
            t("s3_compiling")
          ) : (
            <>
              <span className="cp-n">{revealed}</span>/{total} {t("s3_checked")}
            </>
          )}
        </div>
      </div>

      <div className="card cov-card">
        <div className="cov-list">
          {domains.map((d, i) => {
            const done = i < revealed;
            const teaser = isEmptyValue(d.teaser) ? t("v_none_found") : d.teaser;
            return (
              <div key={d.key} className={"cov-row " + (done ? "settled " + d.state : "pending")}>
                <div className="ic">
                  {done ? (
                    d.state === "ok" ? (
                      <span className="tick">✓</span>
                    ) : d.state === "empty" ? (
                      <span className="tick empty">∅</span>
                    ) : (
                      <span className="tick fail">✕</span>
                    )
                  ) : (
                    <span className="spinner"></span>
                  )}
                </div>
                <div className="cov-main">
                  <div className="domain">{t("dom_" + d.key)}</div>
                  <div className="cov-src">{d.source}</div>
                </div>
                <div className="teaser">{done ? teaser : t("st_querying", { src: d.source })}</div>
                <div className="rstate">
                  {done ? (d.state === "ok" ? t("st_verified") : d.state === "empty" ? t("st_empty") : t("st_unavailable")) : ""}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="check-foot">{t("s3_foot")}</div>
    </div>
  );
}

/* ---------------- S4 — VERDICT ---------------- */
function reasoningClass(text: string): string {
  if (/^BLOCKED:/i.test(text)) return "blocked-line";
  if (/^(Offset:|However:)/i.test(text)) return "reasoning";
  return "";
}
function reasoningTag(text: string): string | null {
  if (/^Offset:/i.test(text)) return "reasoning";
  if (/^However:/i.test(text)) return "caveat";
  return null;
}

const STATE_WORD_KEY: Record<string, string> = {
  green: "ts_clear",
  yellow: "ts_caution",
  red: "ts_stop",
  gray: "ts_unknown",
};

function tierGroups(verdict: Verdict): { ck: string; label: string }[] {
  const blocked = verdict.state === "BLOCKED",
    unverif = verdict.state === "UNVERIFIABLE";
  const tm = verdict.tier_map || {};
  const keys = (["T1", "T2", "T3", "T4"] as TierKey[]).map((k) => (unverif ? "gray" : blocked ? "red" : tm[k] || "gray"));
  const groups: { ck: string; start: number; end: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const ck = keys[i],
      last = groups[groups.length - 1];
    if (last && last.ck === ck) last.end = i;
    else groups.push({ ck, start: i, end: i });
  }
  return groups.map((g) => ({
    ck: g.ck,
    label: g.start === g.end ? "T" + (g.start + 1) : "T" + (g.start + 1) + "–T" + (g.end + 1),
  }));
}

function lineMarker(fixture: Fixture, line: NarrativeLine): string {
  const ev = new Set(line.evidence || []);
  const sigs = (fixture.signals || []).filter((s) => (s.evidence || []).some((e) => ev.has(e)));
  if (sigs.some((s) => s.grade === "blocker")) return "■";
  if (sigs.length === 0) return "·";
  const net = sigs.reduce((a, s) => a + (s.weight_effective || 0), 0);
  return net > 0 ? "+" : net < 0 ? "–" : "·";
}

function ruleForSignal(fixture: Fixture, sigId: string) {
  const rules = fixture.verdict?.rules_fired || fixture.rules_fired || [];
  return rules.find((r) => (r.effect + " " + r.note).includes(sigId));
}

function CoverageMeter({ coverage, t }: { coverage: { verified: number; total: number }; t: ReturnType<typeof useT> }) {
  const total = (coverage && coverage.total) || 10;
  const verified = (coverage && coverage.verified) || 0;
  return (
    <span className="cov-meter" title={t("s4_coverage") + " " + verified + "/" + total}>
      <span className="cov-dots">
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className={"cd" + (i < verified ? " on" : "")}></span>
        ))}
      </span>
      <span className="cov-label">
        {t("s4_coverage")} {verified}/{total}
      </span>
    </span>
  );
}

function SignalRow({
  fixture,
  sig,
  maxW,
  highlight,
  onHover,
  onLeave,
}: {
  fixture: Fixture;
  sig: Signal;
  maxW: number;
  highlight: boolean;
  onHover: () => void;
  onLeave: () => void;
}) {
  const t = useT();
  const mod = sig.weight_base !== sig.weight_effective && sig.weight_effective != null;
  const rule = mod ? ruleForSignal(fixture, sig.id) : null;
  const wcls = sig.grade === "blocker" ? "blk" : sig.polarity === "+" ? "pos" : "neg";
  const fmt = (n: number) => (n > 0 ? "+" + n : "" + n);
  const pct = sig.grade === "blocker" ? 100 : Math.min(100, Math.round((Math.abs(sig.weight_effective || 0) / maxW) * 100));
  return (
    <div className={"sig-row" + (highlight ? " hl-highlight" : "")} onMouseEnter={onHover} onMouseLeave={onLeave}>
      <div className="sid">{sig.id}</div>
      <div className="snote">
        {joinPieces(t, sig.i18n) ?? sig.note} <EvidenceLinks fixture={fixture} ids={sig.evidence} />
        {rule && (
          <span>
            {" "}
            ·{" "}
            <span className="rule-ref" title={rule.id + " — " + rule.note}>
              {t("via")} {rule.id}
            </span>
          </span>
        )}
      </div>
      <div className={"sweight " + wcls}>
        <div className="w-num">
          {sig.grade === "blocker" ? (
            t("s4_veto")
          ) : (
            <>
              {mod && <span className="base">{fmt(sig.weight_base as number)}</span>}
              {fmt(sig.weight_effective as number)}
            </>
          )}
        </div>
        <div className="w-bar">
          <span style={{ width: pct + "%" }}></span>
        </div>
      </div>
    </div>
  );
}

export function VerdictScreen({
  fixture,
  onExport,
  onKyc,
  onAddTin,
  onSpawn,
  onSwitch,
}: {
  fixture: Fixture;
  onExport: (kind: "memo" | "csv") => void;
  onKyc: (m: MissingItem) => void;
  onAddTin: () => void;
  onSpawn: (offer: SpawnOffer) => void;
  onSwitch: () => void;
}) {
  const t = useT();
  const lang = useContext(LangContext);
  const v = fixture.verdict!;
  const sel = fixture.resolution.selected!;
  const [hlSig, setHlSig] = useState<string[] | null>(null);
  const [showFacts, setShowFacts] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const regFact = (fixture.facts || []).find((f) => f.field === "legal_status");
  const regStatus = regFact ? regFact.value : "active";

  const blocked = v.state === "BLOCKED";
  const unverif = v.state === "UNVERIFIABLE";
  const hasReserves = (fixture.resolution.candidates_reserve || []).length > 0;

  const signals = fixture.signals || [];
  const hard = signals.filter((s) => s.grade === "blocker");
  const neg = signals.filter((s) => s.grade !== "blocker" && s.polarity === "-");
  const pos = signals.filter((s) => s.polarity === "+");
  const maxW = Math.max(1, ...signals.map((s) => Math.abs(s.weight_effective || 0)));
  const rules = v.rules_fired || fixture.rules_fired || [];
  const r07 = rules.find((r) => r.id === "R-07");

  const narr = v.narrative || [];
  const groups = tierGroups(v);

  function sigsForLine(line: NarrativeLine): string[] {
    const ev = new Set(line.evidence || []);
    return signals.filter((s) => (s.evidence || []).some((e) => ev.has(e))).map((s) => s.id);
  }
  const hlSet = hlSig ? new Set(hlSig) : null;

  return (
    <div className="verdict-wrap">
      <div className="v-header">
        <div className="v-id">
          <div className="v-masthead-top">
            <span className="eyebrow">{t("s4_dossier")}</span>
            <span className="v-ref mono">
              {t("k_tin")} {sel.tin} · {t("s4_checked")} {formatChecked(checkedAtOf(fixture), lang)}
            </span>
          </div>
          <div className="v-name hy">{sel.name_hy}</div>
          {sel.name_en && <div className="v-en">{sel.name_en}</div>}
          <div className="v-line">
            {regFact && <StatusChip status={regStatus} />}
            <CoverageMeter coverage={v.coverage} t={t} />
          </div>
        </div>
        <div className="v-actions">
          {hasReserves && (
            <button className="linkish switch-link" onClick={onSwitch}>
              {t("s4_switch")}
            </button>
          )}
          <div className="pos-rel">
            <button className="btn ghost sm" onClick={() => setExportOpen((o) => !o)}>
              {t("s4_export")} ▾
            </button>
            {exportOpen && (
              <div className="export-menu">
                <button
                  onClick={() => {
                    onExport("memo");
                    setExportOpen(false);
                  }}
                >
                  {t("s4_export_memo")}
                  <span className="e-kind">.md</span>
                </button>
                <button
                  onClick={() => {
                    onExport("csv");
                    setExportOpen(false);
                  }}
                >
                  {t("s4_export_csv")}
                  <span className="e-kind">.csv</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {blocked && (
        <div className="banner blocked">
          <div className="b-ic">■</div>
          <div className="b-body">
            <div className="b-title">{t("s4_blocked")}</div>
            <ul className="b-list">
              {(v.blockers || []).map((bid) => {
                const s = signals.find((x) => x.id === bid);
                return s ? (
                  <li key={bid}>
                    {joinPieces(t, s.i18n) ?? s.note} <EvidenceLinks fixture={fixture} ids={s.evidence} />
                  </li>
                ) : null;
              })}
            </ul>
          </div>
        </div>
      )}
      {unverif && (
        <div className="banner unverif">
          <div className="b-ic">?</div>
          <div className="b-body">
            <div className="b-title" style={{ color: "var(--gray-v)" }}>
              {t("s4_unverif")}
            </div>
            <ul className="b-list">
              <li>{t("s4_unverif_msg")}</li>
            </ul>
          </div>
        </div>
      )}

      <div className="scale-wrap">
        <div className="scale-head">
          <div className="s-title">{t("s4_exposure")}</div>
          <div className="score-block">
            {typeof v.score === "number" && (
              <span className="score-num">
                {v.score > 0 ? "+" : ""}
                {v.score}
              </span>
            )}
            {typeof v.score === "number" && <span className="score-label">{t("s4_score")}</span>}
          </div>
        </div>
        <TierStrip verdict={v} />
      </div>

      {!unverif && (
        <div className="rec-block">
          <div className="rec-eyebrow">{t("s4_recommendation")}</div>
          <div className="rec-tiers">
            {groups.map((g, i) => (
              <span key={i} className="rec-tier">
                <span className="rt-label">{g.label}</span>
                <span className="rt-state" style={{ color: TIER_COLOR[g.ck as keyof typeof TIER_COLOR] }}>
                  {t(STATE_WORD_KEY[g.ck])}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {narr.length > 0 && (
        <div className="section">
          <div className="s-title">{t("s4_reading")}</div>
          <div className="narrative">
            {narr.map((line, i) => {
              const tag = reasoningTag(line.text);
              const isReason = !!reasoningClass(line.text);
              return (
                <div
                  key={i}
                  className={"read-line" + (isReason ? " reasoning" : "")}
                  onMouseEnter={() => setHlSig(sigsForLine(line))}
                  onMouseLeave={() => setHlSig(null)}
                >
                  <span className="rl-marker">{lineMarker(fixture, line)}</span>
                  <p className="rl-text">
                    {tag && <span className="tag-reason">{t("tag_" + tag)}</span>}
                    {joinPieces(t, line.i18n) ?? line.text} <EvidenceLinks fixture={fixture} ids={line.evidence} />
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {signals.length > 0 && (
        <div className="section">
          <div className="s-title">{t("s4_signals")}</div>
          {rules.length > 0 && (
            <div className="rules-wrap">
              <div className="rules-label">{t("s4_rules")}</div>
              <div className="rules-fired">
                {rules.map((r) => (
                  <span key={r.id} className="rule-pill" title={r.note}>
                    <span className="rid">{r.id}</span>
                    {r.effect}
                  </span>
                ))}
              </div>
            </div>
          )}

          {hard.length > 0 && (
            <div className="sig-group">
              <div className="g-title" style={{ color: "var(--red)" }}>
                {t("s4_hard")} <span className="count">{hard.length}</span>
              </div>
              {hard.map((s) => (
                <SignalRow
                  key={s.id}
                  fixture={fixture}
                  sig={s}
                  maxW={maxW}
                  highlight={!!(hlSet && hlSet.has(s.id))}
                  onHover={() => setHlSig([s.id])}
                  onLeave={() => setHlSig(null)}
                />
              ))}
            </div>
          )}
          {neg.length > 0 && (
            <div className="sig-group">
              <div className="g-title">
                {t("s4_neg")} <span className="count">{neg.length}</span>
              </div>
              {neg.map((s) => (
                <SignalRow
                  key={s.id}
                  fixture={fixture}
                  sig={s}
                  maxW={maxW}
                  highlight={!!(hlSet && hlSet.has(s.id))}
                  onHover={() => setHlSig([s.id])}
                  onLeave={() => setHlSig(null)}
                />
              ))}
            </div>
          )}
          {pos.length > 0 && (
            <div className="sig-group">
              <div className="g-title">
                {t("s4_pos")} <span className="count">{pos.length}</span>
              </div>
              {pos.map((s) => (
                <SignalRow
                  key={s.id}
                  fixture={fixture}
                  sig={s}
                  maxW={maxW}
                  highlight={!!(hlSet && hlSet.has(s.id))}
                  onHover={() => setHlSig([s.id])}
                  onLeave={() => setHlSig(null)}
                />
              ))}
              {r07 && <div className="cap-note">{t("s4_cap")}</div>}
            </div>
          )}
        </div>
      )}

      {(fixture.facts || []).length > 0 && (
        <div className="section">
          <button className="linkish facts-toggle" onClick={() => setShowFacts((f) => !f)} style={{ textAlign: "left" }}>
            {showFacts ? t("s4_hide_facts") : t("s4_view_facts", { n: (fixture.facts || []).length })} {showFacts ? "▴" : "▾"}
          </button>
          {showFacts && (
            <table className="facts-table">
              <thead>
                <tr>
                  <th>{t("fc_domain")}</th>
                  <th>{t("fc_field")}</th>
                  <th>{t("fc_value")}</th>
                  <th>{t("fc_source")}</th>
                  <th>{t("fc_fetched")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(fixture.facts || []).map((f) => (
                  <tr key={f.fact_id}>
                    <td className="f-domain">{t("dom_" + f.domain)}</td>
                    <td>{f.field}</td>
                    <td className="f-val">
                      {f.value}{" "}
                      {f.match === "fuzzy" && <span className="badge-fuzzy">{t("name_matched")}</span>}
                    </td>
                    <td>{f.source}</td>
                    <td className="f-when">{(f.fetched_at || "").slice(11, 16)}</td>
                    <td>
                      <EvidenceLinks fixture={fixture} ids={[f.fact_id]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {(v.missing || []).length > 0 && (
        <div className="section">
          <div className="s-title">{t("s4_improve")}</div>
          <div className="rail">
            {v.missing.map((m, i) => (
              <div key={i} className="gap-card">
                <div className="g-gap">{joinPieces(t, m.gap_i18n) ?? m.gap}</div>
                <div className="g-cta">
                  <button className="btn ghost sm" onClick={() => (m.mock ? onKyc(m) : onAddTin())}>
                    {joinPieces(t, m.cta_i18n) ?? m.cta}
                  </button>
                </div>
                <div className="mocktag">{m.mock ? t("mock") : t("live")}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {v.spawn_offer && (
        <div className="spawn-card">
          <div className="s-body">
            <div className="s-msg">{v.spawn_offer.message}</div>
            <div className="s-target hy">
              {v.spawn_offer.target_name_hy}{" "}
              <span className="mono" style={{ fontSize: 13, color: "var(--ink-3)" }}>
                · {v.spawn_offer.target_tin}
              </span>
            </div>
          </div>
          <button className="btn" onClick={() => onSpawn(v.spawn_offer!)}>
            {t("spawn_check", { name: v.spawn_offer.target_name_en })}
          </button>
        </div>
      )}
    </div>
  );
}
