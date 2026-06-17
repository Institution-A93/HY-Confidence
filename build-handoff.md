# Counterparty Check — Demo Build Handoff

Brief for Claude Design (visual direction, screens) and Claude Code (implementation). Read together with the two companion files, which are authoritative:

- `scoring-model-spec.md` — Facts / Signals / Verdicts logic, weights, composition rules
- `demo-fixtures.json` — four synthetic vignettes; the UI renders ONLY this data and never invents anything

## 1. Product context (one paragraph)

A counterparty solvency check for the Armenian market. A logistics operator (or any B2B seller) enters whatever they know about a counterparty — ideally a TIN, often just a company name, a first name, and the phone they were contacted from — and gets back a sourced dossier, a traffic-light verdict rendered across deal-exposure tiers, and a narrative that explains every flag with a link to evidence. The demo is fixtures-driven: no backend, no live registry calls, but everything on screen corresponds to data that is genuinely retrievable from Armenian open sources today.

## 2. Stack and constraints

- Vite + React, single-page app, client-side state machine (no router needed; four states + modals)
- Tailwind for styling; no component library dependency unless it earns its keep
- `demo-fixtures.json` imported statically; "checking" progress simulated with timed reveals (see S3)
- Export = client-side generation (Markdown and CSV) from the fixture's facts + signals arrays
- UI language: **English** for the demo shell; entity data rendered bilingually (Armenian name primary, English transliteration secondary). Structure copy for easy RU localization later — no hardcoded strings in components
- Armenian text must render correctly: specify a font stack with full Armenian script support and test «» quotes and ՍՊԸ glyphs
- Must look right at 1280–1440px (sales-call screen share); responsive below that is nice-to-have, not required

## 3. User path — state machine

```
INPUT ──(submit)──► RESOLVE? ──(unambiguous: skip)──► CHECKING ──► VERDICT
                       │                                              │
                       └──(user picks candidate)──► CHECKING          ├──► [KYC modal]   (mock)
                                                                      ├──► [Export]      (real, client-side)
                                                                      └──► [Spawn check] (pushes a new
                                                                            INPUT►CHECKING►VERDICT cycle,
                                                                            prefilled with target TIN;
                                                                            previous verdict stays in a
                                                                            breadcrumb / tab stack)
```

Demo driver: a discreet scenario switcher (bottom-left, or keyboard 1–4) loads each fixture's `input` into the INPUT screen so the presenter can run any vignette from the top. Never visible in screenshots — small and dismissible.

## 4. Screens

### S1 — Input

One centered card. Four fields, all optional, at least one required to submit:

| Field | Notes |
|---|---|
| Company name | Primary field, largest. Placeholder: "Company name — Armenian or Latin" |
| TIN | Visually distinguished (accent border or badge "best match"). Tooltip: "TIN gives an exact match — everything else is best-effort." |
| Contact person | Placeholder: "First name is enough" |
| Phone | Placeholder: "The number you were contacted from" |

Microcopy under the card: "The more you provide, the sharper the result. Nothing here is shared with the counterparty."
Submit CTA: "Run check".

### S2 — Resolve (conditional; shown only when fixture `resolution.ambiguous = true`)

Headline: "Which company did you mean?"
Candidate cards, one per entry in `resolution.candidates`: Armenian name + transliteration, TIN, registered address, director, registration date, status chip. Click selects and proceeds. Footer link: "None of these — refine input" (returns to S1). Unselected candidates are kept in `candidates_reserve`; VERDICT screen shows a quiet "Not the right company? Switch" link that reopens this screen.

### S3 — Checking (progress)

The 10 coverage domains as rows (registry, graph, tax, court, enforcement, pledge, notice, procurement, web, contact), each animating spinner → result state: ✓ verified / ∅ verified-empty ("none found" is still verified) / ✕ unavailable. Stagger reveals over ~4–6 seconds total — long enough to read, short enough not to bore. Each completed row may show a one-line teaser of what was found (from facts). Auto-advance to VERDICT when all rows settle.

This screen is theater, but honest theater: every row corresponds to a real queryable source.

### S4 — Verdict (the product)

Layout top to bottom:

**Header bar** — entity Armenian name + transliteration, TIN, registry status chip, "Checked 10 Jun 2026, 14:30" timestamp, Export button, "Switch company" link if reserves exist.

**Blocker banner** — only when `state = BLOCKED`: full-width red banner listing each blocker with its evidence link. When `state = UNVERIFIABLE` (no fixture ships this, but build the variant): gray banner, "We could not confirm this entity exists as described."

**The scale** — the centerpiece. A horizontal strip with four tier segments labeled:
T1 Prepaid · T2 Small credit · T3 Material credit · T4 Large / preferential terms.
Each segment colored per `verdict.tier_map` (green / yellow / red). Transitions between differently-colored segments render as gradients; `band_blur` (0–3) controls gradient width — 0 = crisp edge, higher = wide fuzzy zone. When BLOCKED: entire strip red regardless of tier_map, banner above explains. Caption under the strip: "Further right = more money and softer terms at stake."

**Narrative panel** — `verdict.narrative` lines in order, rendered as readable prose paragraphs (not bullets). Each line with evidence shows a small source-link affordance (↗) opening the fact's URL; hovering highlights the corresponding rows in the signal table below. Composition-rule lines (e.g. the R-01 offset in the yellow fixture) get a subtle "reasoning" accent — this is the moment the product visibly thinks; design should make it findable without shouting.

**Signals breakdown** — three groups: Hard flags / Negative signals / Positive signals. Row: signal id, plain-language note, effective weight (show `−8 → −4` strikethrough form when a rule modified it, with the rule name on hover), evidence links. Below the groups, one line: "Weak positives capped at +10 — counterparty-controlled signals polish the score, never carry it" (render only when R-07 fired).

**Facts table** — collapsed by default ("View all 17 facts"). Columns: domain, field, value, source, fetched-at, link. `match: fuzzy` rows carry a "name-matched" badge.

**Improve-accuracy rail** — from `verdict.missing`: each gap as a card with its CTA. "Send KYC magic link" opens S5. Mocked CTAs are functional-looking but lead to the mock modal; the non-mock one in the spawn fixture ("Add TIN") returns to S1 prefilled.

**Spawn card** — only when `verdict.spawn_offer` exists: highlighted card with the message and a "Check Lori Trans Service →" button that starts a new check cycle prefilled with the target TIN. Previous verdict remains reachable via a breadcrumb/tab at the top ("Hrazdan Freight ← → Lori Trans Service"). For the demo, the spawned check can resolve to a stub verdict screen with a "fixture not included" placeholder — the point is the mechanic, not the second dossier.

### S5 — KYC magic-link modal (mock)

Generated-looking link (clipboard-copyable), plus a small preview pane of what the counterparty would see: consent text for an ACRA credit-report request with their entity name filled in. Footer note visible to the presenter only in code comments: entire flow is frontend mock, v2 feature.

## 5. Rendering rules that must match the spec

- Tier colors come ONLY from `verdict.tier_map` — never recompute from score in the UI
- BLOCKED overrides everything visually; same screen, not a different layout
- Narrative lines may only display text present in fixtures; no generated copy at runtime
- Every evidence link must resolve to the fact's `url`; facts with empty url render the link affordance disabled
- Weight modifications (rules) always shown as base → effective, never silently
- Coverage "verified-empty" (none found) renders as verified, with the "none found" value visible — absence of findings is a finding

## 6. Mocked vs real — keep this boundary visible in code

| Real (works in demo) | Mocked (frontend only) |
|---|---|
| Fixture-driven scoring display, all four vignettes | Live registry/Datalex/DAHK fetching |
| Export to Markdown / CSV | ACRA KYC magic link + consent flow |
| Spawn-check navigation mechanic | The spawned entity's actual dossier |
| Candidate resolution flow | Financials-request CTA |

## 7. Visual direction (for Claude Design)

Instrument, not dashboard. The reference feeling is a lab report or a credit-committee memo, not a SaaS analytics tool: generous whitespace, strong typographic hierarchy, restrained chrome. Traffic-light color appears ONLY in the scale strip, the status chips, and the blocker banner — never as decorative accents; everything else stays neutral so the verdict colors carry full semantic weight. Evidence links are a first-class visual element (the product's credibility is "every claim has a source"), so give the ↗ affordance a consistent, quiet, repeated treatment. Armenian entity names are display-level content, not metadata — set them large, with transliteration secondary. Avoid gamified score-gauge clichés (no semicircular speedometers); the tier strip IS the verdict visualization.

## 8. Acceptance checklist

- [ ] All four fixtures run end-to-end from the scenario switcher
- [ ] RED fixture: resolution picker appears (2 candidates), blocker banner renders, strip fully red
- [ ] YELLOW fixture: R-01 offset visible in both narrative and signal table (−8 → −4)
- [ ] GREEN fixture: R-07 cap note renders; all 10 domains verified in S3
- [ ] SPAWN fixture: CH-02 card + spawn button push a new check with breadcrumb back
- [ ] Export produces a Markdown memo containing narrative + signal table + facts with URLs
- [ ] Fuzzy-match badges appear on name-matched facts (spawn fixture)
- [ ] Armenian text renders correctly everywhere, including «» and ՍՊԸ
- [ ] No string in the verdict screen that does not originate from demo-fixtures.json
