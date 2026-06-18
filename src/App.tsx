// App root — state machine, language, tabs, modals, export, spawn. Ported from the
// mockup's app3 module. Difference vs the mockup: Export is wired (buildMemo/buildCsv +
// download) instead of a disabled button.
import { useState, useEffect } from "react";
import { LangContext, useT, LANGS, translate } from "./i18n";
import type { LangCode } from "./i18n";
import { FIXTURES } from "./fixtures";
import { factById } from "./components";
import { InputScreen, ResolveScreen, CheckingScreen, VerdictScreen } from "./screens";
import type { CheckInput, Fixture, MissingItem, SpawnOffer } from "./types";

type Screen = "INPUT" | "RESOLVE" | "CHECKING" | "VERDICT";
type Tab = { key: string; kind: "verdict"; fixture: Fixture } | { key: string; kind: "stub"; target: SpawnOffer };

/* match free input to a fixture (demo: by entity name or TIN) */
function matchFixture(input: CheckInput): Fixture | null {
  const name = (input.entity_name || "").trim().toLowerCase();
  const tin = (input.tin || "").trim();
  return (
    FIXTURES.find(
      (f) =>
        (tin && f.resolution.selected && f.resolution.selected.tin === tin) ||
        (name && f.input.entity_name.toLowerCase() === name) ||
        (name && f.input.entity_name.toLowerCase().includes(name)),
    ) || null
  );
}

/* synthetic "no registered match" object for the U-01 entry point */
function makeNoMatch(input: CheckInput): Fixture {
  return {
    id: "nomatch:" + (input.tin || input.entity_name || Math.random()),
    label: "",
    demonstrates: [],
    input,
    resolution: {
      ambiguous: true,
      candidates: [],
      candidates_reserve: [],
      selected: { tin: input.tin || "—", name_hy: input.entity_name || input.tin || "—", name_en: input.entity_name || "" },
    },
    facts: [],
    signals: [],
    rules_fired: [],
    verdict: null,
  };
}

/* synthesize the UNVERIFIABLE terminal verdict (U-01) — no fabricated facts */
function synthesizeUnverifiable(input: CheckInput): Fixture {
  const q = input.entity_name || input.tin || "—";
  return {
    id: "unverif:" + (input.tin || input.entity_name || "q"),
    label: "",
    demonstrates: [],
    input,
    resolution: {
      ambiguous: false,
      candidates_reserve: [],
      selected: { tin: input.tin || "—", name_hy: q, name_en: "" },
    },
    facts: [],
    signals: [],
    rules_fired: [],
    verdict: {
      state: "UNVERIFIABLE",
      score: null,
      coverage: { verified: 0, total: 10 },
      tier_map: {},
      band_blur: 3,
      narrative: [],
      missing: input.tin ? [] : [{ gap: "No TIN provided", cta: "Add a TIN to retry", mock: false }],
    },
  };
}

/* ---------------- Export (real, client-side) ---------------- */
function download(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function buildMemo(fixture: Fixture): string {
  const v = fixture.verdict!;
  const sel = fixture.resolution.selected!;
  const L: string[] = [];
  L.push(`# Counterparty Check — ${sel.name_en}`);
  L.push(`**${sel.name_hy}**  ·  TIN ${sel.tin}  ·  Checked 10 Jun 2026, 14:30`);
  L.push("");
  L.push(`**Verdict state:** ${v.state}${v.state === "BLOCKED" ? "  ⛔" : ""}`);
  L.push(`**Score:** ${v.score}   ·   **Coverage:** ${v.coverage.verified}/${v.coverage.total} domains`);
  L.push(`**Tier map:** ` + Object.entries(v.tier_map).map(([k, c]) => `${k}=${c}`).join("  "));
  L.push("");
  L.push("## Reading");
  (v.narrative || []).forEach((line) => {
    const urls = (line.evidence || []).map((id) => factById(fixture, id)?.url).filter(Boolean);
    L.push(`- ${line.text}` + (urls.length ? `  \n  Evidence: ${urls.join(" , ")}` : ""));
  });
  L.push("");
  L.push("## Signals");
  L.push("| ID | Grade | Note | Weight | Evidence |");
  L.push("|----|-------|------|--------|----------|");
  (fixture.signals || []).forEach((s) => {
    const w =
      s.grade === "blocker"
        ? "VETO"
        : s.weight_base !== s.weight_effective
          ? `${s.weight_base} → ${s.weight_effective}`
          : `${s.weight_effective}`;
    const urls = (s.evidence || []).map((id) => factById(fixture, id)?.url).filter(Boolean);
    L.push(`| ${s.id} | ${s.grade} ${s.polarity} | ${s.note.replace(/\|/g, "/")} | ${w} | ${urls.join(" ")} |`);
  });
  const rules = v.rules_fired || fixture.rules_fired || [];
  if (rules.length) {
    L.push("");
    L.push("## Composition rules applied");
    rules.forEach((r) => L.push(`- **${r.id}** — ${r.effect}. ${r.note}`));
  }
  L.push("");
  L.push("## Facts");
  L.push("| Domain | Field | Value | Source | Fetched | Match | URL |");
  L.push("|--------|-------|-------|--------|---------|-------|-----|");
  (fixture.facts || []).forEach((f) => {
    L.push(
      `| ${f.domain} | ${f.field} | ${String(f.value).replace(/\|/g, "/")} | ${f.source} | ${f.fetched_at} | ${f.match} | ${f.url || ""} |`,
    );
  });
  return L.join("\n");
}

function buildCsv(fixture: Fixture): string {
  const esc = (x: unknown) => `"${String(x == null ? "" : x).replace(/"/g, '""')}"`;
  const rows: string[] = [];
  rows.push(
    ["type", "id", "grade/domain", "note/field", "value", "weight_base", "weight_effective", "source", "fetched_at", "match", "url"]
      .map(esc)
      .join(","),
  );
  (fixture.signals || []).forEach((s) => {
    rows.push(["signal", s.id, s.grade + " " + s.polarity, s.note, "", s.weight_base, s.weight_effective, "", "", "", ""].map(esc).join(","));
  });
  (fixture.facts || []).forEach((f) => {
    rows.push(["fact", f.fact_id, f.domain, f.field, f.value, "", "", f.source, f.fetched_at, f.match, f.url].map(esc).join(","));
  });
  return rows.join("\n");
}

function slugFor(fixture: Fixture): string {
  const sel = fixture.resolution.selected;
  return (sel?.name_en || sel?.tin || fixture.id || "counterparty").replace(/[^\w.-]+/g, "_");
}

/* ---------------- Language switcher ---------------- */
function LangSwitch({ lang, setLang }: { lang: LangCode; setLang: (l: LangCode) => void }) {
  return (
    <div className="lang-switch" role="group" aria-label="Language">
      {LANGS.map((l) => (
        <button key={l.code} className={"lang-opt" + (lang === l.code ? " on" : "")} onClick={() => setLang(l.code)}>
          {l.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- KYC modal (mock) ---------------- */
function KycModal({ fixture, onClose }: { fixture: Fixture; onClose: () => void }) {
  const t = useT();
  const sel = fixture.resolution.selected!;
  const link = `https://check.am/kyc/${sel.tin}/${Math.random().toString(36).slice(2, 10)}`;
  const [copied, setCopied] = useState(false);
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal pos-rel" onClick={(e) => e.stopPropagation()}>
        <button className="close-x" onClick={onClose}>
          ×
        </button>
        <div className="m-head">
          <h2>{t("kyc_title")}</h2>
          <div className="m-sub">{t("kyc_sub")}</div>
        </div>
        <div className="m-body">
          <div className="link-box">
            <input readOnly value={link} onFocus={(e) => e.target.select()} />
            <button
              className="btn sm"
              onClick={() => {
                if (navigator.clipboard) navigator.clipboard.writeText(link);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? t("kyc_copied") : t("kyc_copy")}
            </button>
          </div>
          <div className="preview-pane">
            <div className="pp-label">{t("kyc_sees")}</div>
            <div className="pp-consent">{t("kyc_consent", { name: sel.name_en + " (" + sel.name_hy + ")" })}</div>
          </div>
        </div>
        <div className="m-foot">
          <button className="btn ghost" onClick={onClose}>
            {t("kyc_close")}
          </button>
          <button className="btn" onClick={onClose}>
            {t("kyc_send")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Stub verdict (spawned, no fixture) ---------------- */
function StubVerdict({ target }: { target: SpawnOffer }) {
  const t = useT();
  return (
    <div className="stub">
      <div className="eyebrow" style={{ marginBottom: 16 }}>
        {t("spawned")}
      </div>
      <div className="s-name hy">{target.target_name_hy}</div>
      <div className="s-en">{target.target_name_en}</div>
      <div className="s-tin">
        {t("k_tin")} {target.target_tin}
      </div>
      <div className="s-note">{t("stub_note")}</div>
    </div>
  );
}

/* ---------------- Top bar ---------------- */
function TopBar({
  t,
  tabs,
  activeKey,
  onHome,
  onView,
  onClose,
  onClearAll,
  onNew,
  lang,
  setLang,
}: {
  t: ReturnType<typeof useT>;
  tabs: Tab[];
  activeKey: string | null;
  onHome: () => void;
  onView: (k: string) => void;
  onClose: (k: string) => void;
  onClearAll: () => void;
  onNew: () => void;
  lang: LangCode;
  setLang: (l: LangCode) => void;
}) {
  return (
    <header className="topbar">
      <button className="brand" onClick={onHome} title={t("brand")}>
        <span className="glyph">◬</span>
        <span className="brand-name">{t("brand")}</span>
      </button>

      <div className="tabs">
        {tabs.map((tab) => {
          const nameHy = tab.kind === "stub" ? tab.target.target_name_hy : tab.fixture.resolution.selected!.name_hy;
          return (
            <div key={tab.key} className={"tab" + (activeKey === tab.key ? " active" : "")}>
              <button className="tab-main" onClick={() => onView(tab.key)}>
                <span className="tab-hy hy">{nameHy}</span>
              </button>
              <button
                className="tab-x"
                title={t("close")}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.key);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      <div className="topbar-right">
        {tabs.length > 0 && (
          <button className="linkish clear-all" onClick={onClearAll}>
            {t("clear_all")}
          </button>
        )}
        <button className="btn ghost sm" onClick={onNew}>
          + {t("new_check")}
        </button>
        <LangSwitch lang={lang} setLang={setLang} />
      </div>
    </header>
  );
}

/* ---------------- Scenario switcher (discreet, demo only) ---------------- */
const SCENARIO_META: Record<string, { label: string; sw: string }> = {
  "green-araks": { label: "Clear GREEN", sw: "#5BAE77" },
  "red-vanand": { label: "Clear RED", sw: "#C0533F" },
  "yellow-sevan": { label: "Reasoning YELLOW", sw: "#E0B23E" },
  "spawn-hrazdan": { label: "Channel / SPAWN", sw: "#3F5468" },
};
function ScenarioSwitcher({ t, onPick, onLive }: { t: ReturnType<typeof useT>; onPick: (fx: Fixture) => void; onLive: () => void }) {
  const [open, setOpen] = useState(true);
  if (!open) {
    return (
      <button className="ss-reopen" onClick={() => setOpen(true)} title={t("ss_title")}>
        ⌗ 1–5
      </button>
    );
  }
  return (
    <div className="scenario-switcher">
      <div className="ss-head">
        <span className="ss-title">{t("ss_title")}</span>
        <button className="ss-x" onClick={() => setOpen(false)} title="Hide">
          ×
        </button>
      </div>
      <div className="ss-list">
        {FIXTURES.map((fx, i) => {
          const m = SCENARIO_META[fx.id] || { label: "", sw: "#999" };
          return (
            <button key={fx.id} className="ss-item" onClick={() => onPick(fx)}>
              <span className="ss-key">{i + 1}</span>
              <span className="ss-sw" style={{ background: m.sw }}></span>
              <span className="ss-name">{fx.input.entity_name}</span>
              <span className="ss-tag">{m.label}</span>
            </button>
          );
        })}
        <div className="ss-divider"></div>
        <button className="ss-item ss-live" onClick={onLive}>
          <span className="ss-key">5</span>
          <span className="ss-sw live"></span>
          <span className="ss-name">{t("ss_live")}</span>
          <span className="ss-tag">{t("ss_backend")}</span>
        </button>
      </div>
    </div>
  );
}

/* ---------------- ROOT ---------------- */
export default function App() {
  const [lang, setLang] = useState<LangCode>(() => {
    try {
      return (localStorage.getItem("cc_lang") as LangCode) || "en";
    } catch {
      return "en";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("cc_lang", lang);
    } catch {
      /* ignore */
    }
  }, [lang]);
  const t = (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars);

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>("INPUT");
  const [run, setRun] = useState<Fixture | null>(null);
  const [prefill, setPrefill] = useState<CheckInput | null>(null);
  const [modal, setModal] = useState<string | null>(null);
  const [liveMode, setLiveMode] = useState(false);

  function startCheck(fixture: Fixture) {
    setRun(fixture);
    setActiveKey(null);
    setScreen(fixture.resolution.ambiguous ? "RESOLVE" : "CHECKING");
  }
  function onSubmit(input: CheckInput) {
    const fx = matchFixture(input);
    if (fx) {
      startCheck(fx);
    } else {
      setRun(makeNoMatch(input));
      setActiveKey(null);
      setScreen("RESOLVE");
    }
  }
  function onPrefill(fx: Fixture) {
    setLiveMode(false);
    setPrefill(fx.input);
    setRun(null);
    setActiveKey(null);
    setScreen("INPUT");
  }
  function selectLive() {
    setLiveMode(true);
    setPrefill({ entity_name: "", tin: "", person_first_name: "", phone: "" });
    setRun(null);
    setActiveKey(null);
    setScreen("INPUT");
  }
  function onResolved() {
    setScreen("CHECKING");
  }

  function openVerdict(fx: Fixture) {
    const key = "v:" + fx.id;
    setTabs((ts) => (ts.find((x) => x.key === key) ? ts : [...ts, { key, kind: "verdict", fixture: fx }]));
    setRun(fx);
    setActiveKey(key);
    setScreen("VERDICT");
  }
  function onCheckDone() {
    if (run) openVerdict(run);
  }
  function onProceedUnverifiable() {
    if (run) openVerdict(synthesizeUnverifiable(run.input));
  }
  function onRefineFromResolve() {
    if (run) setPrefill(run.input);
    setScreen("INPUT");
  }

  function onSpawn(offer: SpawnOffer) {
    const key = "s:" + offer.target_tin;
    setTabs((ts) => (ts.find((x) => x.key === key) ? ts : [...ts, { key, kind: "stub", target: offer }]));
    setActiveKey(key);
    setRun(null);
    setScreen("VERDICT");
  }

  function viewTab(key: string) {
    const tab = tabs.find((x) => x.key === key);
    if (!tab) return;
    setActiveKey(key);
    setRun(tab.kind === "verdict" ? tab.fixture : null);
    setScreen("VERDICT");
  }

  function closeTab(key: string) {
    setTabs((ts) => {
      const next = ts.filter((x) => x.key !== key);
      if (activeKey === key) {
        if (next.length) {
          const last = next[next.length - 1];
          setActiveKey(last.key);
          setRun(last.kind === "verdict" ? last.fixture : null);
          setScreen("VERDICT");
        } else {
          setActiveKey(null);
          setRun(null);
          setScreen("INPUT");
          setPrefill(null);
        }
      }
      return next;
    });
  }

  function clearAll() {
    setLiveMode(false);
    setTabs([]);
    setActiveKey(null);
    setRun(null);
    setPrefill(null);
    setScreen("INPUT");
  }
  function home() {
    setLiveMode(false);
    setActiveKey(null);
    setRun(null);
    setScreen("INPUT");
    setPrefill(null);
  }
  function newCheck() {
    setLiveMode(false);
    setActiveKey(null);
    setRun(null);
    setPrefill(null);
    setScreen("INPUT");
  }

  function exportVerdict(kind: "memo" | "csv") {
    if (!run || !run.verdict) return;
    const slug = slugFor(run);
    if (kind === "memo") download(`${slug}.md`, buildMemo(run), "text/markdown;charset=utf-8");
    else download(`${slug}.csv`, buildCsv(run), "text/csv;charset=utf-8");
  }

  const activeTab = tabs.find((x) => x.key === activeKey);
  const showStub = screen === "VERDICT" && activeTab && activeTab.kind === "stub";
  const isCentered = (screen === "INPUT" || screen === "RESOLVE" || screen === "CHECKING") && !showStub;

  // keyboard 1–4 load a fixture, 5 = live input (ignored while typing)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement;
      if (el && /^(input|textarea|select)$/i.test(el.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key >= "1" && e.key <= "4") {
        const fx = FIXTURES[+e.key - 1];
        if (fx) onPrefill(fx);
      } else if (e.key === "5") {
        selectLive();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <LangContext.Provider value={lang}>
      <div className="app">
        <TopBar
          t={t}
          tabs={tabs}
          activeKey={activeKey}
          onHome={home}
          onView={viewTab}
          onClose={closeTab}
          onClearAll={clearAll}
          onNew={newCheck}
          lang={lang}
          setLang={setLang}
        />

        <div className={"stage" + (isCentered ? " center" : "")}>
          {showStub && activeTab.kind === "stub" && <StubVerdict target={activeTab.target} />}

          {!showStub && screen === "INPUT" && <InputScreen initial={prefill} onSubmit={onSubmit} live={liveMode} />}
          {!showStub && screen === "RESOLVE" && run && (
            <ResolveScreen
              fixture={run}
              onPick={onResolved}
              onRefine={onRefineFromResolve}
              onAddTin={onRefineFromResolve}
              onProceed={onProceedUnverifiable}
            />
          )}
          {!showStub && screen === "CHECKING" && run && <CheckingScreen fixture={run} onDone={onCheckDone} />}
          {!showStub && screen === "VERDICT" && run && (
            <VerdictScreen
              fixture={run}
              onExport={exportVerdict}
              onKyc={(_m: MissingItem) => setModal("kyc")}
              onAddTin={() => {
                setPrefill(run.input);
                setActiveKey(null);
                setScreen("INPUT");
              }}
              onSpawn={onSpawn}
              onSwitch={() => setScreen("RESOLVE")}
            />
          )}
        </div>

        {modal === "kyc" && run && <KycModal fixture={run} onClose={() => setModal(null)} />}

        <ScenarioSwitcher t={t} onPick={onPrefill} onLive={selectLive} />
        <div className="proto-tag">interactive prototype · S1–S4</div>
      </div>
    </LangContext.Provider>
  );
}
