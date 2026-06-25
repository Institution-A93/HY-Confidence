# Source recon — fragile [R] adapters

Operationalizes `source-access-spec.md` §14 into a per-source build checklist. These are the
sources that need hands-on recon before an adapter can be written: forms, params, session
behavior, and exact selectors. **None of these can be safely scraped blind** — that is why
they are NOT in the overnight build (only the recon-free adapters — sanctions, WHOIS, MX —
are live). Status legend: ☐ to do · ⚠ known constraint · 🔎 capture during recon.

> Live probing (fetching each page and recording the real HTML/forms) is the next step and
> should run from the eventual production IP — DigitalOcean datacenter IPs (Frankfurt/
> Amsterdam) may be rate-limited or geo-filtered by .am government sites; verify, don't assume
> (source-access-spec.md §13 legal/politeness note).

---

## Geo/bot probe — from the production IP (2026-06-19)

Probed from the DigitalOcean Frankfurt droplet (159.65.120.201) with a browser User-Agent.
**Headline: no country geo-block. No anti-bot wall on the government sources.** A Frankfurt
datacenter IP reaches them fine — the "foreign IP" worry does not apply to gov sources.

| Source | From Frankfurt | Note |
|---|---|---|
| e-register.am (registry) | ✅ 200, nginx | `/en/companies` → 302; real search path needs recon |
| src.am (tax) | ✅ 200, Apache | reachable |
| datalex.am (court) | ✅ 200, nginx | even `?app=AppCaseSearch` → 200, no challenge — the hard one is open |
| **harkadir.am → cesa.am** (enforcement) | ✅ 302 → cesa.am | **enforcement moved to cesa.am** — retarget the adapter; harkadir cert is self-signed |
| azdarar.am (notices) | ✅ 200, nginx | reachable |
| armeps.am (procurement) | ✅ 200, Tomcat | reachable |
| gnumner.am (procurement) | ✅ 200 (with `-k`) | **expired TLS cert** — disable cert check for this host |
| ajurd.am (auctions) | ✅ 200, Apache | reachable |
| spyur.am (directory) | ⚠️ Cloudflare (every GET 302→`/en/error`) | ✅ BUILT around it — DuckDuckGo-Lite SE-fallback for Latin→Armenian name (`src/adapters/spyur.ts`); see section below |
| e-services.moj.am | 200 but empty/Access-denied | not needed — e-register.am is the registry surface |

**Implications for the build:** gov scrapers can run from the droplet over plain HTTP — no
residential proxy needed for government data (only spyur.am, a commercial directory, is
CF-walled, and the spec already routes around it). Two hosts need bad-TLS handling
(`rejectUnauthorized: false`): cesa.am/harkadir (self-signed) and gnumner (expired). Update the
enforcement target from harkadir.am to **cesa.am**.

### Deep recon — anti-automation per source (2026-06-19)

The landing-page 200s were misleading; the real content paths have protection:

- **src.am — ✅ BUILT & LIVE.** Laravel app. `POST /en/taxpayerSearchData` with a CSRF token
  (`<meta name="csrf-token">`) + the session cookie returns the **real taxpayer record as JSON**:
  TIN, name, status (`Գործող`=active), registration date, legal form, address, VAT. No captcha
  blocked us. **This one source covers F-TAX-01/02 AND registry basics F-REG-01/02/03/04** —
  which is most of what e-register was wanted for. Adapter: `src/adapters/srcam.ts`. Verified
  live: Grand Candy → TIN 02226764. (`/en/search` and `/en/searchInternalData` are decoys —
  site-wide search and customs data; `taxpayerSearchData` is the taxpayer one.)
- **e-register — ✅ PARTLY BUILT (owners), NO LONGER WALLED (re-recon 2026-06-23).** The old
  `e-register.am` was Radware-walled (perfdrive challenge). The registry has since moved to the
  justice-sector platform **`e-register.moj.am`**, which is **OPEN** — verified 200 / no challenge
  from BOTH an Armenian residential IP (Yerevan, AS207810) AND the Frankfurt datacenter, so it is
  neither geo- nor datacenter-blocked. **No proxy, no headless needed.** It is a server-rendered
  SPA (no JSON API; Network shows 0 XHR on search). Flow: `GET /en/search/companies?query=<TIN>`
  → `/en/companies/<internal-id>` → annual **BO declaration** links → `/declarations/<uuid>` whose
  Section B lists beneficial owners (name, citizenship, % participation, date became owner). **Built:
  `src/adapters/eregister.ts`** (F-REG-07, TIN-keyed) — verified live: Grand Candy → Mikayel & Karen
  Vardanyan, 50/50. ⚠ The site THROTTLES concurrent requests (parallel declaration fetches return
  empty) → fetch declarations SEQUENTIALLY. Name search is unreliable (Armenian exact-match) → key
  by TIN. **Still gated behind login = Armenian e-ID (Mobile-ID / ID-card, NOT email+password; team
  has none → blocked):** executive director (F-REG-05), founder/participant list + capital
  (F-REG-03/06), change history (F-REG-08), and PERSON search → so the cross-entity affiliation graph
  (F-GRA, phoenix B-06) is NOT public.
- **cesa.am — ✅ NOT a blocker after all (re-recon 2026-06-23).** The Cloudflare + reCAPTCHA (CSP
  references recaptcha.net) gate only the cesa.am *contact/appeal forms*. The enforcement DEBTOR
  SEARCH is not on cesa.am at all — `cesa.am/hy/service/hetakhuzumner` redirects to the separate,
  captcha-free `cabinet.harkadir.am` (built — see the enforcement section below).

**To unblock the remaining gated tiers later:** a Playwright headless pool on the droplet (+ a captcha
solver like 2captcha/CapSolver for src.am-style image codes, and/or an Armenian residential proxy for
Radware) — relevant for the **datalex case-detail captcha** (claim amounts/outcomes) and the
e-register login tier, NOT for enforcement (which turned out to be plain HTTP).

### The "open" sources — captcha-free but no quick win (recon 2026-06-19)

All three are reachable with no captcha/Cloudflare, but none exposes a clean simple search; each
needs a dedicated build (a src.am-style grind), not a one-shot scrape:

- **gnumner.minfin.am (procurement, F-PRC-01).** `POST /hy/search/` with `search=` returns a generic
  yearly-stats page, NOT supplier-specific contracts — supplier search is not exposed (matches the
  spec caveat). The real route is iterating award announcements / the armeps e-procurement surface
  into a local index. Deferred.
- **azdarar.am (notices, F-NTC-01).** Canonical host is `azdarar.am` (no www; www 301s). Search form:
  `GET /hy/public-announcement/search-result/?query=<text>` (+ `date_start/date_end`, `applicant_type[]`).
  The query is accepted (200) but the result list came back empty for test queries — results are likely
  AJAX-loaded or need exact entity names. Needs one more recon iteration to find the result feed.
- **ajurd.am (auctions, F-AUC-01) — ⛔ NOT NAME-ATTRIBUTABLE (recon 2026-06-19, building decision: SKIP).**
  ajurd.am IS the correct source — the official DAHK compulsory-auction site ("ՀԱՐԿԱԴԻՐ ԷԼԵԿՏՐՈՆԱՅԻՆ
  ԱՃՈՒՐԴՆԵՐԻ ՊԱՇՏՈՆԱԿԱՆ ԿԱՅՔ", MoJ Compulsory Enforcement Service). Search mechanics are fully worked
  out and unguarded: GET `/hy/` yields a Joomla session cookie + a per-session token `<32hex>=1`; POST
  to `/hy/` with `option=com_auction&task=auction.startSearch&search[q]=<text>&search[lot_id]=&search[cat]=&<token>=1`
  filters server-side (the bare GET `/hy/search?q=` is cosmetic — it ignores `q` and shows the default
  ~50 lots). Lots link to `/lot-item?i=<id>`. **The blocker is the DATA MODEL, not anti-bot:** lots
  publish only the ASSET (category, address, area, starting price, auction dates, and the handling
  enforcement division `Վարույթն իրականացնող`) — **never the debtor's name or TIN.** Proof: `search[q]=ՍՊԸ`
  (the legal-form suffix in almost every company name) returns **0 lots**; 5 sampled lot pages across
  categories show no `Պարտապան`/legal-form/TIN. So you cannot ask "is THIS counterparty's asset on
  auction?" by name. The only lot→debtor join lives in the enforcement proceeding (cesa.am/DAHK), which
  is the enforcement proceeding. **UPDATE (2026-06-23): enforcement is now BUILT (cabinet.harkadir.am
  DebtorRems), but keyed debtor→proceedings, NOT lot→debtor — so it can't hand ajurd the debtor a lot
  needs. SN-05 stays deferred on the DATA-MODEL gap (lots are anonymous), now DECOUPLED from the captcha
  question (resolved — enforcement was plain HTTP).** Building a name-keyed ajurd adapter now would return
  empty for every real query and mislabel it "auction: queried, none found" (verified_empty), violating
  the R-09 "could-not-query ≠ queried-empty" invariant — so it was deliberately NOT built.
  (`eauction.am` is unrelated — it's "LOT BORSA", a private commodity exchange; voluntary, also no debtor names.)

Recommendation: grind ONE properly in a focused session — **azdarar** is highest value (liquidation /
capital-reduction notices feed blocker B-02 and SN-04). **azdarar is now BUILT & LIVE** (`src/adapters/azdarar.ts`).
Next buildable high-value source is **datalex** (courts — names plaintiff/defendant, so unlike ajurd it
IS name-attributable). See the datalex section below.

---

## e-register.moj.am — State Register (registry, graph) · Epics B1, D3, E1
Facts: F-REG-01..08, seeds F-GRA-01/02. **Backbone of identity.** Recon answers (2026-06-23):
- ✅ **Canonical platform = `e-register.moj.am`** ("justice-sector digital services"). Company search:
  `GET /en/search/companies?query=<text>` (server-rendered, no JSON API, no captcha, no token).
  Search by **TIN** is exact and reliable; **Armenian name search is unreliable** (returns 0 for
  «ԳՐԱՆԴ ՔԵՆԴԻ») → always key by TIN.
- ✅ **Beneficial owners are PUBLIC & free** via the annual BO declarations → BUILT (`eregister.ts`,
  F-REG-07). The declaration also carries citizenship + % + date-became-owner (feeds a future SN-10
  "BO absent/foreign" and the owner-tenure positive).
- ⛔ **Login-gated (the full registry card):** executive director (F-REG-05), participant list +
  capital (F-REG-03/06), change history (F-REG-08), and **person search** (so F-GRA graph / phoenix
  B-06). **Login requires Armenian e-ID — Mobile-ID or a chip ID-card (EKENG), NOT email/password**
  (`/en/login` → 403, `/en/register` → 404: there is no public self-registration). **BLOCKED for us:
  the team has neither Mobile-ID nor an ID-card** (decided 2026-06-23 — do not attempt account
  creation). To unlock this tier later you need a person with Armenian e-ID credentials, or the paid
  per-company extract (~3000 AMD; may itself require e-ID for the e-signature/payment) → D3.
- ❌ **BODS bulk fallback is dead** (see the BODS finding above): no free bulk file exists; the
  per-company beneficial-owners route above is the way to owners now.

## src.am — State Revenue Committee (tax) · Epic B2
Facts: F-TAX-01 TIN+name, F-TAX-02 VAT, F-TAX-03 top-1000.
- Page: `src.am/en/taxpayerSearchSystemPage/112` (EN shell; HY parallel). **[V]** searchable by
  TIN / company name / director. Adapter `src/adapters/srcam.ts` uses `POST /en/taxpayerSearchData`
  (Laravel + CSRF + session cookie) → JSON record (F-TAX-01/02 + registry basics).
- **F-TAX-03 top-1000 → ✅ BUILT as a STATIC SNAPSHOT (2026-06-25).** The SRC publishes the list
  per-period with no stable URL; petekamutner.am is unreachable from our network, and src.am serves it
  only via a JS SPA (Ziggy) whose publication API needs per-period reverse-engineering. Sourced instead
  from **karg.am/top-1000**, a public aggregator that exposes each entry's **TIN** (`/company/<TIN>`) —
  so we key by TIN, an **EXACT** match (`match:"exact"`, no R-08 damping), not a fuzzy name guess. The
  full 1000-TIN snapshot (rank-ordered) lives in `src/data/top1000.ts`; adapter `src/adapters/top1000.ts`
  → SP-02 +12. SP-02 is positive-only, so a stale/partial snapshot only withholds a bonus — never harms.
  ⚠ Refresh `pulledAt`+`tins` each period by re-crawling karg.am (the data file is the single
  maintenance point). Verified live: ML Mining (TIN 02569362) is in the list → SP-02 fires.
- This + e-register is what **de-fuzzes** name-matched facts (locks the TIN).

## datalex.am — Judicial portal (court) · Epic F1 — ✅ BUILT & LIVE (no browser needed)
Facts: F-CRT-01 (plaintiff), F-CRT-02 (defendant), F-CRT-03 (bankruptcy debtor). Adapter:
`src/adapters/datalex.ts`. **Playwright turned out NOT to be needed** — the recon below replaced
the "hardest, headless" assumption with a plain JSON API.
- Page: `datalex.am/?app=AppCaseSearch` (PHP, PHPSESSID). 2M+ cases, Armenian-only. BARL framework.
- **Transport (the win):** the results grid is a **jqGrid backed by an Elasticsearch JSON API at
  `POST /json.php`**. One GET of the search page sets a PHPSESSID; each search is a POST with
  `function=getGridDataList`, `name=Common/ModGrid`, `type=modules`, and
  `arg=JSON([filterData, {page,rows,sidx,sord}, gridSearchDescription, false])` + a
  `module_params` JSON (gridSearchDescription/caseTypeID per case-type tab). Response is JSON:
  `result.totalCount` + `result.data[]` rows with STRUCTURED fields (`claimant_name`,
  `respondant_name`, `case_number`, `case_external_id`, `creation_datetime`). No headless, no
  postback, no frames. AJAXURL = `https://datalex.am:443/json.php`.
- **Role classification is structural (mandatory rule satisfied at the query):** the form has
  separate `data[claimant_organization_name]` / `data[respondant_organization_name]` fields, so we
  set the role by WHICH field carries the name — claimant=plaintiff (F-CRT-01→WP-09),
  respondant=defendant (F-CRT-02→SN-01). Confirmed on real data: tax authority as *claimant* on the
  bankruptcy tab → 6114 cases, each `respondant` = the bankrupt company (case# `ՍնԴ/…`); so
  **respondant-on-bankruptcy = the debtor → B-01**. Never parse role out of results.
- **Case-type tabs** (the first select; drives `gridSearchDescription`+`caseTypeID`): civil
  (`datalex_civ_case_info`, 2), criminal, administrative, payment_order (4), **bankruptcy**
  (`datalex_bankr_case_info`, 3), corruption_civil/criminal. Bankruptcy search REQUIRES a party
  filter (empty filter → 0).
- **Recency** comes from the case number's trailing 2-digit year (`ԵԴ/0254/02/26` → 2026) — more
  reliable than `creation_datetime`, which is null on bankruptcy rows. Feeds R-06 decay + the B-01
  "open" inference (≤4y).
- ⚠ **Case DETAIL (openCase) is CAPTCHA-GATED** ("Մուտքագրեք նկարի տեքստը", `ModCaptcha` image —
  POST `/json.php function=openCase arg=[row+case_type]` → `{html}` is just the captcha form on the
  first hit, per-case). So verdict OUTCOMES and explicit open/closed STATUS need a solver — but the
  claim AMOUNT does NOT: **the grid row's `claim` field already carries the plaintiff's full petitum
  text** (recon 2026-06-24). So no CapSolver is needed for amounts — `parseClaimAmount` (datalex.ts)
  pulls the demanded sum (first figure after «բռնագանձել»; payment orders have none) and surfaces it
  as a narrative EXAMPLE. SN-01 stays count+recency-scaled (the source's decimal/thousands separators
  are inconsistent — `945.274`=945k vs `15871536.20`=15.8M — so the parsed sum is display-only, not a
  scored number). B-01 infers "open" from recency. Case URLs `?app=AppCaseSearch&case_id=<external_id>`
  ARE replayable (link the user; they solve the captcha to read the full outcome).
- **Match precision (recon 2026-06-23) + token-containment guard (BUILT).** The name search is a
  NORMALIZED SUBSTRING/token match (case/spacing/«»/legal-form insensitive), so it OVER-matches:
  «ԱՊԱՎԵՆ» also returns «Ապավեն Տերմինալ» / «Հույսի Ապավեն» (different firms) + multi-party rows;
  «Գրանդ» → 36 distinct "Grand …" companies. A distinctive FULL name (Grand Candy, Ararat Cement) is
  precise (all results are spelling variants of the target). Mitigation built into `datalex.ts`:
  fetch 100 rows, then `partyMatchesQuery` keeps only rows where a comma-split party's `nameKey`
  EQUALS the query key (±4 chars for an unstripped form) — drops co-parties/namesakes — and scales
  totalCount by the keep-ratio. Verified: «ԱՊԱՎԵՆ» defendant 14→8. **Still cannot split two DIFFERENT
  entities with the IDENTICAL name** (active vs liquidated «ԱՊԱՎԵՆ» share the count) — that needs the
  TIN/graph; hence court facts are also always `match:"fuzzy"` (R-08 damps SN-01/WP-09 ×0.7).
- ✅ DONE: payment_order tab (debt-collection defendant → folded into SN-01); name retry for trailing
  descriptor words (ԳՐՈՒՊ); token-containment guard; claim-amount parsing from the grid `claim` field
  (no captcha). Follow-ups: person/sole-proprietor party search (first+last name fields); verdict
  OUTCOME + amount-scaling once the detail captcha is solved (CapSolver `ImageToTextTask` on ModCaptcha).

## cabinet.harkadir.am — DAHK / compulsory enforcement (enforcement) · Epic D1 — ✅ BUILT & LIVE (recon 2026-06-23)
Facts: F-ENF-01 open proceedings — strongest free "won't pay" signal (→ blocker B-03). Adapter:
`src/adapters/enforcement.ts`. TIN-keyed → `match: exact`.
- ✅ **The "Cloudflare + reCAPTCHA" wall was a false alarm** — it's on the cesa.am *contact forms*,
  not the debtor search. `cesa.am/hy/service/hetakhuzumner` → **`cabinet.harkadir.am/dahkcabinet/
  cabinet/debtorinfo/`**, a Microsoft-IIS / ASP.NET Core app, NO Cloudflare, NO real captcha, valid
  TLS. Plain HTTP like src.am — no headless, no solver, no proxy.
- **Flow (verified):** GET page → `__RequestVerificationToken` + `.AspNetCore.Antiforgery` cookie →
  GET `/DahkCabinet/Cabinet/RequestCaptcha` (a plain 32-char text NONCE the client echoes back, not a
  visual captcha; each search response returns the next nonce) → POST `/DahkCabinet/Cabinet/DebtorRems`
  `{PASSPORTORHVHH:<TIN>, CAPTCHA:<nonce>}` → `{CAPTCHA:<next>, REMS:[…]}`. Only OPEN proceedings are
  published, so any REMS row → B-03. (`/SSnPassportDebtorWantedList` is login-gated 401 — unused.)
- ⚠ v1 scores the REMS COUNT (load-bearing); per-proceeding fields (number/amount/date/officer) are a
  narrative enrichment **[R]** — no debtor-with-proceedings TIN captured during recon (src.am resolver
  was down); confirm the REMS object shape on the first real debtor. Verified: Grand Candy → REMS:[].

## azdarar.am — Official public notifications (notice) · Epic D2
Facts: F-NTC-01 liquidation / creditor-call / reorg / capital-reduction (→ B-02, SN-04).
- ⚠ Coverage complete by construction (statutory publication).
- 🔎 Does search cover full text or titles only? If titles only, pull category feeds and grep locally.
- 🔎 Classify into the four flag types by title keywords; TIN usually present in the notice text.

## armeps.am — Procurement (procurement) · Epic E2 — ✅ BUILT & LIVE (recon 2026-06-23)
Facts: F-PRC-01 award wins by supplier (→ SP-03 evidence). Adapter: `src/adapters/procurement.ts`.
- ✅ **armeps PPCM exposes a PUBLIC JSON API** (`https://armeps.am/ppcm/public/…`, no captcha/CF, valid
  TLS) that IS supplier-queryable → the "ingest award announcements into a local index" fallback is
  **RETIRED**. Two POSTs: `/autocomplete/get-supplier-list` `{value:<name>}` → `[{id, taxpayerId,
  name}]` (id is a UUID, not the TIN — autocomplete by name, then confirm `taxpayerId===subject.tin`
  → exact), then `/contracts/count` + `/contracts/list` → rows with `dateSigned` (epoch ms),
  `contractValue`, `supplierName/supplierTaxpayerId`, `tenderTitle(En)`, `authorityName(En/Hy)` (buyer in-row).
- ⚠ Gotchas (verified): `list` 500s without the FULL filter object (count is lenient); `order.field`
  is SNAKE_CASE (`date_signed`); the `dateSigned` range filter has an undocumented 500-prone format →
  the SP-03 ≤36-month window is applied IN CODE. **gnumner dropped** — aggregate stats only, no supplier search.
- ⚠ Name matching is dirty (free-form display names, some Latin-transliterated, occasional encoding
  corruption) → name-only queries are genuinely fuzzy; TIN-confirm is the de-fuzz. SP-03 is positive,
  so a false-empty only fails to award credit (safe) — never asserts "not a real company".

## ajurd.am — Compulsory auctions (auction) · Epic E3
Facts: F-AUC-01 assets under forced sale (→ SN-05).
- 🔎 Debtor-name search vs listing iteration; lot page structure (debtor field).
- ⚠ Low volume → daily full-listing ingest into a local index is simplest.

## registration.am — Pledge register (pledge) · Epic F2 — ✅ BUILT & LIVE (recon 2026-06-23)
Facts: F-PLG-01 movable pledges (→ SN-06, R-05). Adapter: `src/adapters/pledge.ts`.
- ✅ **PUBLIC** — the canonical register is its own site `registration.am` ("Շարժական Գույքի Նկատմամբ
  Ապահովված Իրավունքների Գրանցամատյան"), NOT under the e-register umbrella, NOT cda.am. No login, no
  captcha, no fee for searching (the login box is for FILERS — banks/notaries). **F-PLG-01/SN-06/R-05
  stay live; the coverage denominator stays 10** (does NOT drop to 9).
- Same **BARL `?app=AppX`** family as datalex (Apache/PHP 5.6). One GET seeds a PHPSESSID; org search
  is a server-rendered POST (`?app=AppSearch`, `ModCaseSearchAction=advSearch`,
  `data[burdensome_person][organization][organization_name]` or `…[state_registry_number]`). Results
  are an HTML table of `<tr class="case_row" data-case_url=…>`: cols = reg-type | movable property |
  reg date | Պարտատեր (creditor) | Պարտապան (debtor, comma-separated co-debtors) | view icon.
- We score only `Ծանրաբեռնում` (pledge) rows; `Սահմանափակում` (restriction/tax lien) is a separate
  follow-up signal. Same token-containment guard as datalex (debtor field can list co-debtors).
  Empty grid → `warning_box`/"…չեն գտնվել…" → verified_empty (R-09 distinguishable). Name-keyed →
  `match:"fuzzy"` (R-08 ×0.7); de-fuzz via the state-registry-number field is a follow-up.

## spyur.am — business directory (name resolution, not a Fact source) · ✅ BUILT & LIVE (recon 2026-06-25)
Adapter: `src/adapters/spyur.ts`. Used by the src.am resolver (`resolveBySrc`) as a phonetic-divergence
fallback for LATIN input — it emits no Facts and never blocks.
- **Why:** an English word in a company name is registered by Armenian PHONETICS, which our letter-map
  transliterator cannot predict. "ML Mining" is «ՄԼ ՄԱՅՆԻՆԳ» (Mining → Մայնինգ / "Mayning"), but
  `latinToArmenian("mining")` = «մինինգ» → the src.am substring search returns 0 of the real record.
  Verified: `resolveBySrc("ML Mining")` returned only namesake "Hamlet Min…" individuals; once the
  Armenian name is supplied, src.am returns TIN 02569362 «ՄԼ ՄԱՅՆԻՆԳ» as the #1 hit.
- **CF wall confirmed (2026-06-25):** every direct GET to `www.spyur.am` 302s to `/en/error` (no bot
  clearance) — so no direct scrape without a headless CF-solver.
- **The path that works:** `GET lite.duckduckgo.com/lite/?q=<name> spyur.am`. DDG-Lite returns spyur
  result rows whose Armenian-language title carries the «…» company name verbatim
  (`«ՄԼ ՄԱՅՆԻՆԳ» • ՀԱՅԱՍՏԱՆ (ԵՐԵՎԱՆ) • ՍՓՅՈՒՌ`). `extractSpyurNames` pulls the «…» group (naturally
  ignores the straight-quote English row), and the resolver re-keys src.am with it.
- **Trigger (keeps it cheap + safe):** only when the direct transliteration search's top
  `nameSimilarity` < 0.6 AND the input is Latin — so a good direct match (Grand Candy → «ԳՐԱՆԴ ՔԵՆԴԻ»)
  never incurs the SE round-trip. ⚠ DDG-Lite is a fragile dependency (rate-limit / markup drift); the
  fallback degrades to the direct (weak) results on any failure — no regression, but recall not guaranteed.

---

## Recon-free (DONE / live this build)
- **Sanctions** (OFAC SDN live; EU/UK next) — `src/adapters/sanctions.ts`
- **WHOIS .am** (AMNIC :43) — `src/adapters/whois.ts`
- **Email MX** (node:dns) — `src/adapters/mx.ts`
- Validated by `tools/smoke-adapters.ts` (real inputs), not the deterministic unit suite.
