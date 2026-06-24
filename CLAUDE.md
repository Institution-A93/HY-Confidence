# HY-Confidence — CLAUDE.md

Counterparty solvency/risk check for the **Armenian market**. A B2B seller (typically a
logistics operator) enters whatever they know about a counterparty — ideally a TIN, often
just a company name, a contact first name, and the phone they were contacted from — and gets
back a sourced dossier, a traffic-light verdict across deal-exposure tiers, and a narrative
where every flag links to its evidence.

This file is the project's working contract for any contributor (human or AI). Read it before
touching the repo. Keep it accurate — see "Sync docs in the same commit as the code".

> ⚠️ **No dev/staging environment. A push to `main` deploys straight to production.**
> There is no safety net between your push and live. Always work on a branch, run the full
> verification suite locally, and merge to `main` only when it is genuinely deploy-ready.
> Treat every `main` push as a production release.
>
> _Bootstrap exception (current): GitHub Pages is not enabled yet, so `main` serves no live
> traffic — direct commits are acceptable during bootstrap. The moment the Pages deploy is live,
> switch to branch → verify → merge._

---

## Repository layout (current)

The repo is still pre-implementation: a **mockup** plus the **authoritative specs** it was built from.

| Path | What it is |
|---|---|
| `Counterparty Check (standalone).html` | Claude Design **mockup** — a fixtures-driven, single-file React/Babel bundle. UI only; no backend, no real data. Treat as a visual/UX reference, NOT the app. |
| `scoring-model-spec.md` | **Authoritative** — Facts → Signals → Rules → Verdict logic, weights, composition rules. |
| `source-access-spec.md` | **Authoritative** — per-Fact data acquisition: where each datum lives, how to fetch/parse, confidence markers. |
| `build-handoff.md` | Screen spec (S1 Input → S2 Resolve → S3 Checking → S4 Verdict) and rendering rules. |
| `demo-fixtures.json` | **Authoritative** demo data — four synthetic vignettes (green-araks, red-vanand, yellow-sevan, spawn-hrazdan). All entities/TINs/URLs are fictional. The UI renders ONLY this data and invents nothing. |

When a question is about the scoring model, the source of truth is `scoring-model-spec.md` +
`demo-fixtures.json` — not the mockup's rendering of it.

The implemented app lives in `src/` (Vite + React + TS; the standalone `.html` is now reference
only). Scoring engine: `src/scoring/`. Data-acquisition foundation (normalization, TIN, adapter
contract, fetcher): `src/lib/`. Live recon-free adapters: `src/adapters/`. Fragile-source recon
checklist: `recon/SOURCES-RECON.md`. See `README.md` for the full layout and run commands.

---

## Architecture (the shape we are building toward)

- **Frontend** stays client-side and is hostable on GitHub Pages. The *render* layer recomputes
  nothing: tier colors come only from `verdict.tier_map`, narrative lines only from Fact records
  (build-handoff §5). This render boundary is already how the mockup works, deliberately.
- **The scoring engine** (Facts → Signals → Rules → Verdict) is a layer distinct from both the
  fetchers and the render. It is pure logic over Facts, so it can run **client-side** (the planned
  demo engine — Pages-compatible, Epic G) or server-side once live Facts exist. The spec pins the
  render rules and the model itself, not where scoring executes.
- **Backend is mandatory for the Facts, not for scoring.** Data acquisition cannot run on Pages or
  in-browser (CORS, scraping — incl. headless for Datalex/postback forms — caching, sanctions cron).
  It is a set of per-source adapters, each implementing `fetch(subject) -> Fact[]` and declaring its
  coverage domain. It emits the same Fact/verdict JSON the frontend already consumes — so a live
  response is a drop-in replacement for a fixture.
- **The JSON contract is the seam.** Anything that widens or breaks it is an architectural change,
  not a local one — flag it (see "Look for hidden architectural issues").

Hard model invariants (from the specs — do not silently violate):
- Only **third-party-verified** facts (registry, courts, bailiffs, tax) may move the verdict far.
  Counterparty-controlled signals (website, socials, email) are weak-grade and capped (R-07, +10).
- `match: exact` = TIN-confirmed; `match: fuzzy` = name-matched, damped ×0.7 (R-08). De-fuzzing =
  pin the TIN via registry/tax, then re-key queries.
- Coverage distinguishes "queried, none found" from "could not query" — they are treated
  oppositely (R-09 widens the band; absence of evidence ≠ evidence).
- BLOCKED (bankruptcy, liquidation, sanctions) vetoes the score. Open DAHK enforcement is NOT a
  blocker — it is a scaled strong negative (SN-11; was B-03), since a large solvent entity can carry
  a minor proceeding. UNVERIFIABLE (identity could not be confirmed) is a separate state, NOT RED.

---

## Roadmap & workflow

Work is tracked on the org Project board **HY-Confidence Roadmap**:
https://github.com/orgs/Institution-A93/projects/4 — issues #1–#21, grouped by an `Epic` field:

- **A. Foundation** (#1–#4) — Fact schema + adapter interface, Armenian text normalization,
  TIN validator / de-fuzzing, fetcher infra (cache, rate-limit, health canary).
- **B. Identity** (#5–#7) — e-register, src.am, resolve-screen wiring (name → TIN).
- **C. Easy wave** (#8–#10) — sanctions, WHOIS/Wayback, email MX. Real APIs/files; build first.
- **D. Scrapers** (#11–#13) — DAHK, Azdarar, e-register paid extract.
- **E. Bulk indexes** (#14–#16) — BODS graph, procurement, auctions.
- **F. Hard** (#17–#18) — Datalex (headless), pledge-register recon.
- **G. Scoring** (#19–#21) — signals, composition rules, verdict assembly.

### Reasoning vs Implementation

Per the principle below, an issue gets one or both reasoning passes BEFORE any code:
**Product Reasoning** (scope/UX/acceptance) and **Technical Reasoning** (architecture, root cause,
ranked options + LOC estimates). Reasoning artifacts are **issue comments** (or chat for small
tasks) — not a branch, not a draft PR. Implementation starts only after a direction is approved.

---

## Working principles

These govern how we work in this repo. They are load-bearing; follow them and call out when a
task forces a deviation.

### Conversation in Russian, artifacts in English
Synchronous team conversation is in **Russian**. Everything committed to the repo — code,
comments, commit messages, issue comments, docs (including this file) — is in **English**. Keeps
spoken collaboration natural while keeping the codebase accessible to external collaborators and
tooling.

### Research first, verify before asserting
Before calling any unfamiliar API, hitting any unfamiliar endpoint, or asserting a fact about the
codebase: read the docs, read the existing code, run a directed grep. Memory and prior
conversations are point-in-time observations and may be stale — verify against current state
before recommending an action. (Especially true for the Armenian government sources: selectors
and search forms are fragile and marked `[R]` "needs recon" in `source-access-spec.md`.)

### Reasoning vs Implementation discipline
Two reasoning stages exist. **Product Reasoning** defines scope, requirements, UX, and acceptance
criteria — the "what" and "why". **Technical Reasoning** investigates architecture, traces code,
identifies root causes, proposes ranked options with LOC estimates — the "how". Both are
investigation only: NEVER write production code in either reasoning stage. Implementation begins
only after the user approves a direction. An issue may need one or both stages — skip Product when
scope is already clear, skip Technical when the solution is obvious.

### Look for hidden architectural issues
Every reasoning pass asks: "is this bug a symptom of an architectural smell, or self-contained?"
Trace the call lifecycle, compare against parallel flows in the same codebase (e.g. one source
adapter vs another, fixture-render vs live-render), look for duplication the fix would delete or
worsen. The `fetch(subject) -> Fact[]` contract and the frontend JSON seam are the usual suspects.
Surface findings as part of Reasoning so the user can choose the scope.

### Opportunistic refactor on touch
When implementing a task, micro-refactors that improve quality or reduce LOC are encouraged for
code already in scope of the change. Prefer deletion to addition; a fix that nets −10 LOC beats one
that nets +10, all else equal. Document the refactor's reasoning in the issue (auditable). Do NOT
scope-creep into unrelated files — the refactor stays within "what this task touches anyway".

### Comments explain WHY, not WHAT or HOW
Comments carry context the code can't. Write WHY (especially when an obvious alternative was
rejected, with reason), issue references ("per #11"), surprising external constraints, and
load-bearing invariants (ordering/idempotency/coverage semantics). For this project those
constraints are real and worth a comment, e.g.: "Datalex has no replayable deep links — store
extracted content, not URLs"; "query e-register in Armenian script — transliteration search is
unreliable"; "coverage denominator drops to 9 if the pledge register is access-gated (F2)";
"fuzzy facts feed signals ×0.7 — do not double-apply the damping". Don't restate what the code
does or write empty JSDoc. **Stale comments are bugs** — audit surrounding comments when you change
code.

### Sync docs in the same commit as the code
`CLAUDE.md` / `README.md` updates ride along in the **same commit** as the code change that affects
them. Documentation drift is treated as a bug. If a change renames a file or changes a flow, the doc
edit is part of the diff, not a follow-up. The repo currently has a single root `CLAUDE.md`; as the
codebase splits (frontend app, backend adapters), add a per-area doc next to the code it describes
and edit the one that matches the code you changed.

### Static verification before push
No trial-and-error on prod. **There is no dev/staging — a push to `main` is a production deploy**, so
local verification is the only safety net. Run the project's check suite locally BEFORE every push;
CI/CD deploy is not a debugger. The frontend is Vite + React + TS; the pre-push suite is
`npm run typecheck` (tsc strict), `npm test` (vitest — engine + lib), and `npm run build`. The
same three run in CI before deploy (`.github/workflows/deploy.yml`), which gates BOTH targets on
that one build: the frontend → GitHub Pages, and the backend → the DigitalOcean droplet over SSH
(`git pull` + `systemctl restart hy-confidence`, using the `DROPLET_SSH_KEY` repo secret). So a
push to `main` now deploys both — no manual droplet step. eslint / prettier
/ madge are not wired yet — add them as the codebase grows. The scraping backend (plain HTTP for
most sources; a Playwright headless pool only for Datalex/postback-style forms per
`source-access-spec.md` §13) is not built yet; its tooling lands with it. If a check fails, fix it
locally and rerun. Adapter network calls are validated by `tools/smoke-adapters.ts`, not the
deterministic unit suite.

---

## Environment & setup notes

- **Identity is repo-local.** The machine's global git identity belongs to another user; commit
  author for this repo is set **locally** (`costubasthesavage`). Never rely on or overwrite the
  global identity.
- **Auth:** SSH remote `git@github.com:Institution-A93/HY-Confidence.git` using a dedicated key
  (`~/.ssh/id_ed25519_hyconf`, pinned in `~/.ssh/config`). GitHub CLI is installed portable at
  `C:\Users\admin\gh\bin\gh.exe`; authenticate non-interactively via `$env:GH_TOKEN`.
- **Windows / PowerShell 5.1 trap:** PS 5.1 reads `.ps1` files as ANSI and mangles non-ASCII
  (em-dash, Armenian, ×, →) before any request is sent. Keep script source ASCII-only, put
  non-ASCII payload in a separate file read with `Get-Content -Encoding UTF8`, and send bodies as
  UTF-8 bytes or `gh api --input <utf8-file>` (`@file` reads need `-F`, not `-f`). The Armenian
  font stack must render «» and ՍՊԸ correctly.
- **Commits & deploy:** commit/push only when asked. **`main` = production** (no dev/staging), so
  never push WIP to `main` — branch, verify locally, merge only when deploy-ready.
