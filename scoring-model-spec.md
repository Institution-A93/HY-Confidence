# Counterparty Scoring Model — Facts, Signals, Verdicts

v0.1 demo spec. Armenian market, open-source-first, ACRA/KYC as v2 uplift.

Design principle that governs everything below: **only third-party-verified facts can carry strong grades.** Anything the counterparty controls (website, socials, email, self-reported data) is weak-grade and capped, so an adversary can't buy a GREEN with SEO and a landing page. Registries, courts, bailiffs, and the tax authority are the only sources allowed to move the verdict far.

---

## 1. Facts layer

A Fact is an atomic, sourced datum. Nothing enters the Signal layer or the narrative that is not a Fact.

```
Fact {
  id:          string          // e.g. F-REG-02
  subject:     TIN | person_id
  domain:      registry | graph | tax | court | enforcement |
               pledge | cadastre | notice | procurement |
               auction | web | contact | sanctions | representative
  field:       string
  value:       any
  source:      string          // human-readable source name
  url:         string          // deep link to the evidence
  fetched_at:  timestamp
  match:       exact | fuzzy   // TIN-keyed = exact; name-matched = fuzzy
}
```

`match: fuzzy` facts feed signals at reduced weight (×0.7) and are marked in the narrative ("name-matched, not TIN-confirmed").

### Fact catalog

| ID | Domain | What | Source |
|---|---|---|---|
| F-REG-01 | registry | Legal status (active / liquidation / bankrupt) | e-register |
| F-REG-02 | registry | Registration date | e-register |
| F-REG-03 | registry | Legal form, authorized capital, paid-in status | e-register |
| F-REG-04 | registry | Registered address | e-register |
| F-REG-05 | registry | Current director | e-register |
| F-REG-06 | registry | Founders + share percentages | e-register |
| F-REG-07 | registry | UBO chain (BODS) | e-register |
| F-REG-08 | registry | Change history: renames, address moves, director churn, capital changes | e-register |
| F-GRA-01 | graph | Person → other entity affiliations (1 hop) | e-register recursive |
| F-GRA-02 | graph | Status of each affiliated entity | e-register |
| F-TAX-01 | tax | TIN valid, name matches | SRC |
| F-TAX-02 | tax | VAT status + activation date | SRC |
| F-TAX-03 | tax | Top-1000 taxpayer membership | SRC annual list |
| F-CRT-01 | court | Cases as plaintiff: count, type, amounts, recency, outcomes | Datalex |
| F-CRT-02 | court | Cases as defendant: same breakdown | Datalex |
| F-CRT-03 | court | Bankruptcy-court appearances (target entity) | Datalex |
| F-CRT-04 | court | Personal cases of directors / UBOs | Datalex |
| F-ENF-01 | enforcement | Open DAHK proceedings against target | DAHK |
| F-PLG-01 | pledge | Movable property pledges: what, to whom, when registered | Pledge register |
| F-NTC-01 | notice | Liquidation / reorg / capital-reduction / creditor-call notices | Azdarar |
| F-PRC-01 | procurement | State contract wins, amounts, dates | armeps.am |
| F-AUC-01 | auction | Entity assets listed for public auction | eauction.am |
| F-WEB-01 | web | Domain age, first Wayback snapshot | WHOIS / Archive |
| F-WEB-02 | web | Site live, content matches claimed activity | fetch |
| F-WEB-03 | web | Social pages: age, post recency | FB / 2GL |
| F-WEB-04 | web | Review sentiment, grounded with URLs | agentic search |
| F-CON-01 | contact | Phone reachable (HLR/ping); landline vs mobile by prefix | lookup |
| F-CON-02 | contact | Email domain matches website domain | MX / string match |
| F-CON-03 | contact | Channel reverse attribution: which entity (if any) the phone/email is publicly tied to; presence in complaint contexts | Spyur reverse + agentic search |
| F-SAN-01 | sanctions | UBO/director screening: OFAC, EU, UK | consolidated lists |
| F-REP-01 | representative | Input person matched against directors / founders / UBOs. Match = bonus (WP-06); no match = neutral, never negative | derived from F-REG-05..07 |

---

## 2. Signals layer

```
Signal {
  id:        string
  grade:     blocker | strong | weak
  polarity:  + | −
  weight:    int                 // blockers carry no weight — they veto
  requires:  [fact_ids]
  fires_when: condition
  note:      template string     // becomes a narrative line, cites evidence URLs
}
```

Weights are **priors for the demo**, to be calibrated against 5–8 known counterparties before any sales conversation. Keep them in config, not code.

### Blockers — veto regardless of everything else

| ID | Fires when | Facts |
|---|---|---|
| B-01 | Target entity has open bankruptcy proceedings | F-CRT-03, F-REG-01 |
| B-02 | Target in liquidation (registry status or Azdarar notice) | F-REG-01, F-NTC-01 |
| B-03 | Open DAHK enforcement against target | F-ENF-01 |
| B-04 | VAT deregistered or tax status suspended | F-TAX-02 |
| B-05 | UBO or director on a sanctions list | F-SAN-01 |
| B-06 | **Phoenix pattern**: a director/UBO's previous entity went bankrupt or was abandoned with creditor claims, AND current entity registered ≤12 mo after, AND same activity profile or address | F-GRA-01, F-GRA-02, F-CRT-04, F-REG-02/04 |

Note what is *not* a blocker: a single old bankruptcy in a director's history (→ SN-03), defendant cases (→ SN-01), pledged assets (→ context-dependent). Blockers are reserved for conditions where no deal structure makes the counterparty acceptable.

### Identity failure — separate terminal state, not a blocker

| ID | Fires when |
|---|---|
| U-01 | TIN–name mismatch at SRC, or entity unresolvable across registries |

Produces verdict state `UNVERIFIABLE`, rendered differently from RED: "we could not confirm this entity exists as described" is a different message than "this entity is dangerous," and conflating them erodes trust in the RED verdicts.

### Strong negatives

| ID | W | Fires when | Facts |
|---|---|---|---|
| SN-01 | −10…−15 | Defendant in debt/contract cases ≤24 mo; scaled by count and aggregate amount | F-CRT-02 |
| SN-03 | −8 | Director/UBO has one past bankrupt entity (non-phoenix) | F-GRA-02, F-CRT-04 |
| SN-04 | −8 | Capital reduction or creditor-call notice ≤12 mo | F-NTC-01 |
| SN-05 | −12 | Entity assets currently on public auction | F-AUC-01 |
| SN-06 | −8 | Core operating assets freshly pledged (≤12 mo) AND entity ≤2 y old | F-PLG-01, F-REG-02 |
| SN-07 | −8 | Entity age <12 mo | F-REG-02 |
| SN-08 | −8 | Director changed ≥3 times in 24 mo | F-REG-08 |
| SN-10 | −8 | UBO chain terminates in a foreign entity with no natural person, or BO filing absent/contradictory | F-REG-07 |

### Weak negatives

| ID | W | Fires when |
|---|---|---|
| WN-01 | −3 | Entity age 1–3 y |
| WN-02 | −2 | Generic email (gmail/mail.ru) as primary B2B contact |
| WN-03 | −3 | No website, or domain first seen <6 mo ago |
| WN-04 | −3 | Phone unreachable |
| WN-05 | −3 | Negative review sentiment (URL-grounded) |
| WN-06 | −2 | Minimum authorized capital, no paid-in confirmation |
| WN-07 | −2 | Single defendant case older than 24 mo |

Deliberately absent: "representative not found in entity structure." Absence of a match is the base rate — logists, sales managers, and dispatchers hold no registered role — and must cost zero. See Channel attribution below: contact-derived signals fire only on positive evidence.

### Strong positives

| ID | W | Fires when | Facts |
|---|---|---|---|
| SP-01 | +10 | Entity ≥7 y, continuously active, no status interruptions | F-REG-01/02/08 |
| SP-02 | +12 | Top-1000 taxpayer | F-TAX-03 |
| SP-03 | +10 | State procurement wins ≤36 mo | F-PRC-01 |
| SP-05 | +8 | UBO track record clean: all affiliated entities active, oldest ≥5 y | F-GRA-01/02 |

### Weak positives

| ID | W | Fires when |
|---|---|---|
| WP-01 | +4 | Website with archive history ≥3 y, content matches activity |
| WP-02 | +2 | Phone reachable |
| WP-03 | +2 | Email domain matches website |
| WP-04 | +2 | Social pages active, posts ≤3 mo old |
| WP-05 | +3 | Positive review sentiment (URL-grounded) |
| WP-06 | +3 | Representative verified as registered principal |
| WP-07 | +2 | Registered address stable ≥3 y |
| WP-08 | +2 | Capital paid in above statutory minimum |
| WP-09 | +4 | Plaintiff in collection cases with wins (enforces own receivables) |

### Channel attribution — separate subject, neutral default

The contact channel (phone/email the user was reached through) is evidence about the *channel*, not the entity. Principle: **penalize contradiction, never absence.** No attribution found = no signal fires.

| ID | Grade | W | Fires when |
|---|---|---|---|
| CH-01 | weak + | +2 | Channel publicly tied to the target (Spyur listing, entity website, official socials) |
| CH-02 | strong − | −6 | Channel publicly tied to a **different** entity. Emits advisory + spawn offer: "This number is listed as belonging to Y LLC — run a check on Y?" Legitimate intermediary structures (broker, sister company) resolve through the second check, not through a penalty alone |
| CH-03 | strong − | −12 | Channel appears in fraud-complaint contexts: logistics blacklist groups, scam reports (URL-grounded only) |

### Deferred to v2 — culled from demo, IDs reserved

| ID | What | Why culled |
|---|---|---|
| FR-01…05 | Freight sector overlay (TIR, CMR insurance, fleet checks) | FR-02 requires insurer verification (counterparty cooperation); rest deferred with the module |
| SN-02 | Closed DAHK proceedings ≤36 mo | Public DAHK search shows **open** proceedings only; history not retrievable. Partially inferable later from Datalex case statuses |
| SN-09 + R-03 | Mass-registration address/phone + business-center neutralization | Requires bulk registry data and a curated business-center whitelist; separating shell farms from Elite Plaza is not viable per-query |
| SP-04, F-CAD-* | Real estate owned, unencumbered | Cadastre supports property→owner extracts, not owner→properties enumeration; owner-based search is gated without consent or standing |
| F-CON-01 (full) | Corporate vs personal vs VoIP line classification | Not a real distinction retrievable for Armenian numbers; demo keeps reachability + landline/mobile prefix only |
| ACRA report | Credit history via consent flow | Requires data-subject consent and ACRA user agreement; magic-link CTA is frontend mock at demo |

---

## 3. Composition rules — named interconnections

Signals fire independently; rules adjust the composition. Every rule that fires emits its own narrative line. Rules are the only place interaction logic lives — never inside signal weights.

| ID | Rule | Effect |
|---|---|---|
| R-01 | **Track-record offset.** SP-05 fired → halve SN-07/WN-01 | Young entity forgiven when the principal has a proven record. Narrative: "entity age concern partially offset by principal's 10-year clean record." |
| R-02 | **Channel contradiction escalation.** CH-02 and CH-03 both fired, or CH-03 + any of SN-07/WN-03 (young entity, fresh domain) | Escalate to prominent warning: "contact channel is associated with complaints and does not belong to this entity — verify through the entity's published contacts before proceeding." Fires only on positive contradiction, never on absence of attribution. |
| R-04 | **Plaintiff-side discount.** F-CRT-01 facts never feed SN-01 | A company suing its deadbeat customers is healthy, not litigious. |
| R-05 | **Pledge context.** Pledges registered >24 mo ago on a mature entity are neutral (working-capital financing); SN-06 fires only on the fresh-pledge + young-entity combination | |
| R-06 | **Recency decay.** Court and enforcement signal weights ×1.0 at ≤12 mo, ×0.6 at 12–24, ×0.3 at 24–36, 0 beyond. Exception: bankruptcy facts persist (feed SN-03/B-06 regardless of age) | |
| R-07 | **Weak-positive cap.** Sum of all WP-* contributions capped at +10 | Web presence and contact hygiene are counterparty-controlled; they can polish a score, never carry it. |
| R-08 | **Fuzzy-match damping.** Signals whose evidence is entirely `match: fuzzy` facts → weight ×0.7, flagged in narrative | |
| R-09 | **Coverage widening.** Each unverifiable domain widens the verdict band; it never moves the midpoint | Absence of evidence ≠ evidence of either kind. |

---

## 4. Verdict layer

```
Verdict {
  state:      BLOCKED | SCORED | UNVERIFIABLE
  blockers:   [signal_ids]            // when BLOCKED
  score:      int                     // Σ weights after rules; range ≈ −45…+50
  coverage:   verified_domains / 10   // registry, graph, tax, court, enforcement,
                                      // pledge, notice, procurement, web, contact
  band:       { midpoint_tier, width }
  narrative:  composed from signal + rule note templates, every line URL-grounded
  missing:    [items]                 // feeds the KYC / improve-accuracy CTA
}
```

### Exposure tiers (the heuristic scale, operationalized without money thresholds)

| Tier | Meaning |
|---|---|
| T1 | Prepaid / cash-on-delivery |
| T2 | Small credit exposure, short terms |
| T3 | Material credit exposure, standard terms |
| T4 | Large exposure or preferential terms |

The score maps to the highest comfortable tier; the UI renders this as the green→yellow→red gradient with the transition points placed accordingly:

| Score | Reading |
|---|---|
| ≥ +20 | Green through T3, yellow at T4 |
| +8 … +20 | Green through T2, yellow at T3, red at T4 |
| −5 … +8 | Green at T1 only, yellow T2–T3, red at T4 |
| −20 … −5 | Yellow at T1, red from T2 |
| < −20 | Red across all tiers even without blockers |

BLOCKED renders the same gradient strip fully red with blockers listed on top — same instrument, not a different screen. UNVERIFIABLE renders the strip gray with the identity-failure explanation.

### Band width (honesty about coverage)

`width = 1 transition-point blur per 2 missing domains.` Full coverage → crisp transitions. 5 of 10 domains verified → transitions rendered as wide fuzzy zones, and the narrative states it: "based on partial data — court and enforcement records could not be checked for this entity."

### Narrative assembly order

1. Blockers (if any) — one line each, with evidence link.
2. Strong negatives, recency-weighted, with amounts where available.
3. Composition-rule notes (offsets, escalations, neutralizations) — this is where the model visibly *reasons*.
4. Strong positives.
5. Weak signals rolled into one summary sentence per polarity.
6. Coverage statement: what was verified, what wasn't.
7. Tier recommendation in one sentence.

Hard constraint: the narrative generator may reference only Fact records. No line without a `fact_id` behind it.

### Missing-data → CTA mapping

All counterparty-cooperation CTAs are frontend mocks at demo — nothing in scoring depends on them.

| Gap | CTA |
|---|---|
| No ACRA consent | "Send KYC magic link" (v2; mock) |
| No financials | "Request last 2 years of statements" (v2; mock) |
| Court/enforcement domain unverified | "Manual Datalex/DAHK check recommended" |

---

## 5. Demo fixtures — what each vignette must exercise

| Vignette | Must fire | Demonstrates |
|---|---|---|
| Clear GREEN | SP-01, SP-03, WP-01/02/06, full coverage | Crisp narrow band, confident T3 |
| Clear RED | B-03 + SN-03 + SN-04 | Blocker short-circuit; gradient fully red with evidence links |
| Reasoning YELLOW | SN-07 + SP-05 + **R-01** | The offset rule producing a visible "concern, but…" narrative — the memorable one |
| (Optional 4th) | CH-02 + spawn offer | Channel resolves to a different entity; tool offers to check that entity too — dirty input handled in-house, not bounced back to the user |
