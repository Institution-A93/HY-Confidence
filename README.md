# HY-Confidence

Counterparty solvency/risk check for the Armenian market. Enter what you know about a
counterparty (ideally a TIN, often just a name + contact + phone) and get a sourced dossier,
a traffic-light verdict across deal-exposure tiers, and a narrative where every flag links to
its evidence.

This repo is the working build. See [CLAUDE.md](CLAUDE.md) for the working contract, the
authoritative specs (`scoring-model-spec.md`, `source-access-spec.md`, `build-handoff.md`),
and the model invariants. `demo-fixtures.json` is the four-vignette demo data.

## Run

```bash
npm install
npm run dev        # Vite dev server
npm run build      # production build → dist/
npm run preview    # serve the production build
npm test           # vitest — deterministic suite (engine + lib)
npm run typecheck  # tsc --noEmit (strict)
```

Live adapter smoke (real network; not part of `npm test`):

```bash
node --experimental-strip-types tools/smoke-adapters.ts
```

## What's in here

```
src/
  App.tsx, screens.tsx, components.tsx   UI (ported from the Claude Design mockup; Export wired)
  i18n.tsx                               EN / RU / HY shell strings
  types.ts, fixtures.ts                  domain model + typed import of demo-fixtures.json
  scoring/                               the engine — Facts/Signals → rules → Verdict
    weights.ts                           weight priors (config, not code)
    engine.ts                            R-01/07/08, score, tier map, band, state
    engine.test.ts                       reproduces all four fixtures
  lib/                                   foundation (shared, browser- and node-safe)
    normalize.ts                         Armenian HY↔Latin translit + legal-name canonicalization
    tin.ts                               TIN format validation (check digit deferred to recon)
    adapter.ts                           fetch(subject)→Fact[] contract + coverage accounting
    fetcher.ts                           TTL cache + circuit breaker + health canary
  adapters/                              live sources (node-only; NOT bundled in the UI)
    sanctions.ts, whois.ts, mx.ts        OFAC SDN, AMNIC WHOIS, email MX (recon-free)
    srcam.ts                             SRC tax + registry basics + identity resolver (source of truth)
    azdarar.ts                           Azdarar public notices → liquidation/bankruptcy (name-keyed)
    datalex.ts                           Datalex courts → plaintiff/defendant/bankruptcy (name-keyed)
    eregister.ts                         State Register beneficial owners (e-register.moj.am, TIN-keyed)
recon/SOURCES-RECON.md                   per-source build checklist for the fragile [R] scrapers
tools/                                   one-shot scripts (CSS extraction, adapter smoke)
Counterparty Check (standalone).html     the original Claude Design mockup (reference)
```

## Status

| Real (works now) | Live data sources (≈6/10 domains) | Pending (needs recon / your input) |
|---|---|---|
| Scoring engine over all 4 fixtures | Sanctions (OFAC), WHOIS (.am), Email MX | Enforcement (cesa.am — captcha), |
| Fixture-driven UI (S1–S4) | SRC tax + registry + resolver (src.am) | auction (debtor not public → via cesa), |
| Live `/check` + `/resolve` end-to-end | Notices (Azdarar), Courts (Datalex) | procurement, pledge; affiliation graph |
| | Beneficial owners (e-register.moj.am) | + director/founders/history (login-gated) |

The frontend renders the Fact/Verdict JSON contract; the scoring engine is pure logic over
Facts (client- or server-side). Data acquisition for the fragile sources needs a backend and
per-source recon — those adapters are deliberately not built blind.

## Deploy

Push to `main` runs the suite once and, if green, deploys both targets via
`.github/workflows/deploy.yml`: the **frontend** to GitHub Pages and the **backend** to the
DigitalOcean droplet over SSH (`git pull` + service restart). `main` is production — there is
no dev/staging. One-time setup: repo Settings → Pages → Source → **GitHub Actions**, and add the
droplet SSH private key as the repo secret **`DROPLET_SSH_KEY`** (Settings → Secrets and variables
→ Actions) so the backend job can deploy.
