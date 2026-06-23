# Source Access Specification — Facts Acquisition Layer

Technical companion to `scoring-model-spec.md`. For every Fact in the catalog: where it lives, which page, how the request works, and how to parse it. Confidence is marked per source: **[V]** verified at spec time, **[R]** needs hands-on recon during build (form fields, session behavior, exact selectors). Nothing here has a real API unless stated; assume HTML scraping as the default and treat every selector as fragile.

## 0. Summary map

| Facts | Source | Access class | Method |
|---|---|---|---|
| F-REG-01…08 | e-register.am (MoJ State Register) | free search + paid extracts (account) | HTML scrape + paid PDF/HTML |
| F-REG-07 bulk | BODS open data (register + Open Ownership mirror) | free, bulk JSON | JSON ingest |
| F-GRA-01/02 | e-register.am recursive | same as registry | recursive scrape |
| F-TAX-01/02 | src.am taxpayer search | free, anonymous | HTML scrape |
| F-TAX-03 | src.am top-1000 publication | free, anonymous | table/PDF parse |
| F-CRT-01…04 | datalex.am | free, anonymous | headless browser, session-bound |
| F-ENF-01 | cabinet.harkadir.am (DAHK debtor search) | PUBLIC, no captcha | ✅ BUILT — plain-HTTP, TIN-keyed |
| F-PLG-01 | registration.am (movable-property secured-rights register) | PUBLIC, no login/captcha | ✅ BUILT — plain-HTTP BARL POST |
| F-NTC-01 | azdarar.am | free, anonymous | HTML scrape + keyword monitor |
| F-PRC-01 | armeps.am (PPCM public JSON API) | free, anonymous | ✅ BUILT — JSON API (gnumner dropped) |
| F-AUC-01 | ajurd.am (compulsory auctions) | free, anonymous | HTML scrape [R] |
| F-WEB-01/02 | AMNIC WHOIS, Wayback, live fetch | free | WHOIS query + CDX API + fetch |
| F-WEB-03/04 | Spyur, FB, search engines | free | scrape + agentic search |
| F-CON-01/02/03 | HLR lookup, MX/DNS, Spyur reverse | free/cheap | API + scrape |
| F-SAN-01 | OFAC, EU, UK consolidated lists | free, real APIs/files | API + file ingest |

Cross-cutting reality: every government source is Armenian-first (some have partial EN shells but data — names, addresses, case texts — is Armenian only). Build the normalization layer (§12) before any adapter.

---

## 1. e-register.am — State Register of Legal Entities (MoJ)

**What we get:** F-REG-01 status, F-REG-02 registration date, F-REG-03 legal form/capital, F-REG-04 address, F-REG-05 director, F-REG-06 founders+shares, F-REG-07 UBO, F-REG-08 change history. Seed for the whole graph (F-GRA-*).

**Pages.**
- Search: `e-register.am` "search existing companies" — the site's own description: search companies and purchase full information about any company. A newer MoJ services platform exists at `e-services.moj.am` (sole-proprietor services have already migrated there; banner on the old site says so) — expect the old UI to migrate during the product's lifetime. **[V]** that both exist; **[R]** which one is canonical for search at build time.
- Company card: free tier shows the basic card (name, TIN/registration number, legal form, address, status, director).
- Paid extract: full dossier — charter, founders with shares, change history, registered pledges — behind a per-document state duty (historically ~3,000 AMD per extract). Requires a registered account and online payment. **[R]**: current fee schedule, whether extracts return as PDF or HTML, and whether an account needs an Armenian e-signature (older flow did not for mere extracts).
- Beneficial owners: per-company BO declarations are published on the company's register page in BODS-aligned form, with a visualizer. Basic BO info is free; enhanced detail may sit behind the paid tier.

**Request mechanics.** Search is a server-rendered form **[R: confirm GET vs POST and param names]**. Armenian input expected; the search handles Armenian names natively and is unreliable for transliterations — always query in Armenian script (see §12). No captcha historically on search **[R]**.

**Parsing.** Server-rendered HTML; straightforward DOM extraction. Paid extracts: if PDF, run text extraction (they are generated, not scanned — no OCR needed); structure is templated and stable. Change history (F-REG-08) lives in the paid extract — parse the chronological table of registered amendments; each row gives date + amendment type, which is exactly what SN-08 (director churn) and address-stability checks consume.

**Recursive graph (F-GRA-01/02).** The register search supports lookup by person (participant/BO name) **[R: exact capability and whether it requires the paid tier]**. If person-search proves gated, the fallback is the bulk BODS route (§2): build a local person→entities index from the bulk file and refresh nightly. The fallback is honestly better for the graph anyway — one download replaces N scrapes.

**Cost model.** Free tier covers F-REG-01/02/04/05 and basic BO. F-REG-06 full shares, F-REG-08 history, and pledge detail need the paid extract — budget 1 extract per deep check, with caching (§13).

## 2. Beneficial ownership bulk data (BODS)

**What we get:** F-REG-07 at scale; the person→entity index powering F-GRA-01/02 without per-query scraping.

Armenia publishes BO declarations in Beneficial Ownership Data Standard (BODS) JSON via the business register; coverage extended economy-wide (~120k entities). Open Ownership republished Armenian data and, after sunsetting its Register, keeps datasets downloadable at `bods-data.openownership.org`. **[R]**: freshness of the mirror vs. the register's own export; if the mirror lags, scrape per-company BO pages from the register and maintain our own accumulating store.

**Parsing.** BODS is well-specified JSON (entity statements, person statements, ownership-or-control statements, linked by statement IDs). Ingest into a local graph store; resolving the UBO chain = walking ownership statements to natural-person leaves. Flag chains terminating in foreign entities without person statements → SN-10.

## 3. src.am — State Revenue Committee

**What we get:** F-TAX-01 TIN validity + name match, F-TAX-02 VAT status, F-TAX-03 top-1000.

**Pages.**
- Taxpayer search system: `src.am/en/taxpayerSearchSystemPage/112` (EN shell; HY at the parallel path). Searchable by TIN, company name, or director name; returns data reliably for legal entities and registered IEs (private individuals' TINs are suppressed). **[V]**
- Top-1000 taxpayers: published periodically as a news/announcement item with an attached table or PDF — no stable URL; locate by site search each period. **[R]**: current period's location and format.
- Legacy portal `petekamutner.am` still hosts some lists and announcements; check both when hunting publications.

**Request mechanics.** Search form, server-rendered **[R: param names; the page may be an ASP.NET app with viewstate, in which case replay the full postback or use headless]**.

**TIN validation (free, offline).** TIN = 8 digits: 7-digit serial + 1 check digit computed from the first seven. Implement the checksum as a pre-flight input validator — catches typos before any network call. **[R]**: the exact checksum algorithm isn't published in the OECD note; derive it from known-valid TINs or fall back to "8 digits + exists in SRC search."

**Parsing.** Result card → name (HY), TIN, VAT payer flag, status. Exact-match by TIN is canonical identity resolution; name search returns candidate lists for the S2 resolution screen.

## 4. datalex.am — Judicial Information Portal

**What we get:** F-CRT-01…04 — all litigation, all three instances, civil/criminal/administrative/bankruptcy, with verdict texts for concluded non-confidential cases.

**Pages.** Case search: `datalex.am/?app=AppCaseSearch`. **[V]** Search parameters include case number, party details, dates, and verdict; all public cases across the judicial system are searchable except in-camera/confidential ones. Built on the CAST court-management system, 2M+ case files.

**Request mechanics — the hard one.** Datalex is an old portal-style app: frame/app-parameter navigation, session-bound state, no stable deep links to search results, Armenian-only interface. Plan for a **headless browser adapter** (Playwright): open search app → fill party-name field (Armenian script) → submit → paginate → extract. Case detail pages may be reachable only within the session; store extracted content, not URLs, and link users to the search page with instructions rather than to a case URL. **[R]**: whether case-view URLs are replayable across sessions (if yes, store them; the fixtures assume a query-style link as a placeholder).

**Query strategy per check.** Run the party-name search 2–4 times per entity: (a) full Armenian legal name with quotes/ՍՊԸ stripped, (b) name variant without legal-form suffix, (c) each director/UBO personal name for F-CRT-04. Classify every hit: target's role (plaintiff/defendant/third party), court (flag bankruptcy court — its own column/court name), case type, status, claim amount where stated, dates. Role classification is what feeds SN-01 vs WP-09 vs B-01 — never pass unclassified counts downstream.

**Parsing.** Table extraction from result grid; verdict texts are HTML/attached docs — extract amounts and outcomes with regex over Armenian legal boilerplate (claim amounts appear in predictable formulae; build a small pattern library from 20–30 sample verdicts during recon).

**Politeness.** This is the slowest, most fragile source. Cache aggressively (12–24h), throttle to human-ish rates, run checks asynchronously.

## 5. cabinet.harkadir.am — DAHK (Compulsory Enforcement Service) — ✅ BUILT & LIVE (recon 2026-06-23)

**What we get:** F-ENF-01 open enforcement proceedings — the strongest free "won't pay" signal (→ B-03). Adapter: `src/adapters/enforcement.ts`. TIN-keyed → `match: exact` (no R-08 damping).

**The captcha scare was misplaced.** The "Cloudflare + reCAPTCHA" wall is on the cesa.am *contact forms*, NOT the debtor search. `cesa.am/hy/service/hetakhuzumner` redirects to **`cabinet.harkadir.am/dahkcabinet/cabinet/debtorinfo/`** — a Microsoft-IIS / ASP.NET Core app, NO Cloudflare, NO real captcha. So this is plain HTTP (like src.am): no headless, no solver, no proxy.

**Transport (3 round-trips, verified live):** (1) GET the page → antiforgery token (`__RequestVerificationToken`) + `.AspNetCore.Antiforgery` cookie; (2) GET `/DahkCabinet/Cabinet/RequestCaptcha` (token header + cookie) → a plain 32-char text nonce — NOT a visual challenge; the client just echoes it, and each search response returns the next nonce (anti-replay, not human verification); (3) POST `/DahkCabinet/Cabinet/DebtorRems` `{PASSPORTORHVHH:<TIN>, CAPTCHA:<nonce>}` → `{CAPTCHA:<next>, REMS:[…]}`. Only **open** proceedings are published (closed history isn't retrievable — why SN-02 was culled), so any REMS row = an open proceeding → B-03.

**Parsing.** v1 reports the proceeding COUNT (the load-bearing B-03 signal). Per-proceeding fields (number / claim amount / opening date / enforcement officer) are a narrative enrichment **[R]** — the src.am resolver was down during recon so no debtor-with-proceedings TIN could be captured; confirm the REMS object shape on the first real debtor. (The sibling `/SSnPassportDebtorWantedList` is login-gated (401) — unused.)

## 6. azdarar.am — Official Public Notifications

**What we get:** F-NTC-01 — liquidation announcements, creditor calls, reorganizations, capital reductions.

**Pages.** `azdarar.am`, the official public-notification site of RA (publication there is the statutory requirement, so coverage is complete by construction). Site search by company name; notices are categorized by type.

**Request mechanics.** Plain site search **[R: whether search covers full text or titles only — if titles only, fetch the relevant category feeds and grep locally]**. Notices are short templated texts.

**Parsing.** Notice page → type, entity name, TIN (usually present in the text), publication date. Regex over templated Armenian boilerplate works; classify into the four flag-relevant types (liquidation / creditor call / reorganization / capital reduction) by title keywords.

## 7. armeps.am — State Procurement — ✅ BUILT & LIVE (recon 2026-06-23)

**What we get:** F-PRC-01 — contract awards by supplier (SP-03's evidence). Adapter: `src/adapters/procurement.ts`.

**Transport (the win).** armeps PPCM exposes a PUBLIC JSON API under `https://armeps.am/ppcm/public/…` — no captcha, no Cloudflare, valid TLS — that IS supplier-queryable, so the "iterate award announcements into a local index" fallback is RETIRED. Two POSTs (`Content-Type: application/json`):
- `/autocomplete/get-supplier-list` `{value:<name>}` → `[{id, taxpayerId, name, …}]`. The `id` is a UUID (NOT the TIN); the contracts filter takes the id. So we autocomplete by NAME, then CONFIRM the match by `taxpayerId === subject.tin` (→ `match: exact`; name-only → `fuzzy`).
- `/contracts/count` + `/contracts/list` `{filter, order, page}` → rows with `dateSigned` (epoch ms), `contractValue`, `supplierName/supplierTaxpayerId`, `tenderTitle(En)`, `authorityName(En/Hy)` (buyer — already in the row), `number`.

**Gotchas (verified live, encoded in the adapter):** `list` 500s unless the filter carries ALL keys (count is lenient); the `order.field` is SNAKE_CASE (`date_signed`, not `dateSigned`); the `dateSigned` RANGE filter has an undocumented, 500-prone format, so the SP-03 "≤36 months" window is applied IN CODE against each row's `dateSigned`. **gnumner is dropped** — it only serves aggregate stats, no supplier search.

## 8. ajurd.am — Compulsory Auctions

**What we get:** F-AUC-01 — counterparty assets under forced sale (SN-05).

**Pages.** `ajurd.am`, the CES compulsory-auction platform (linked from MoJ alongside harkadir). Lots identify the debtor whose property is being auctioned. **[R]**: debtor-name search vs. listing iteration; lot pages structure.

**Parsing.** Lot → debtor name, asset description, auction status/date. Low volume; a daily full-listing ingest into a local index is simplest.

## 9. Spyur.am — business directory

**What we get:** F-WEB-03 partially, and critically F-CON-03 — reverse phone attribution.

**Pages.** Company profiles at `spyur.am/en/companies/<slug>/<id>/` (HY/EN/RU mirrors). Profiles list phones, address, activity, self-reported staff/years.

**Request mechanics.** Spyur's own search takes phone numbers; additionally, profile pages are indexed by search engines, so `"<phone>" site:spyur.am` via the agentic search layer is a robust reverse-lookup path that avoids scraping Spyur's search at all. Normalize the number into the several formats Spyur prints (+374-XX-..., (0XX) ...) and query all.

**Parsing.** Profile page → company name, listed phones, address. Spyur is a commercial directory: respect robots.txt, keep volume low, and treat it as corroborating (self-reported) data — it feeds weak signals and channel attribution only.

## 10. Domain & web history

**What we get:** F-WEB-01 domain vintage, F-WEB-02 live-site check.

- **.am WHOIS:** AMNIC (the .am registry) runs whois at `whois.amnic.net` (port 43) and a web lookup on `amnic.net`. Returns registration date, registrant, status. Standard whois protocol — use a whois library, no scraping.
- **Wayback:** CDX API (`web.archive.org/cdx/search/cdx?url=<domain>&limit=1`) for first-snapshot date — real API, JSON/text output.
- **Live fetch:** GET the site, confirm it resolves, language(s), and that content plausibly matches claimed activity (feed the text to the agentic layer for the match judgment, grounded in the fetched URL).

## 11. Contact channel & sanctions

- **F-CON-01 reachability:** HLR lookup via any commercial API (per-query cents) → number live/dead; landline-vs-mobile from the +374 prefix table (10 = Yerevan landline; 9x/4x/7x = mobile ranges — encode the table locally).
- **F-CON-02:** MX lookup on the email domain + string match against the entity's website domain. Pure DNS, free.
- **F-SAN-01:** the one place with real APIs. OFAC: Sanctions List Search API / bulk SDN files (treasury.gov). EU: consolidated financial sanctions list, XML/CSV download. UK: OFSI consolidated list, CSV/JSON. Ingest all three on a weekly cron into a local index; screen Armenian names in both Armenian and transliterated forms (§12) — sanctions lists are Latin/Cyrillic, so screening happens post-transliteration with fuzzy matching (normalized Levenshtein on token sets, threshold tuned to avoid false hits on common Armenian surnames).

## 12. Cross-cutting: Armenian text normalization (build first)

Every adapter depends on this layer:

- **Script handling.** Government sources index in Armenian script. User input may arrive in Armenian, Latin transliteration, or Russian Cyrillic. Implement HY↔Latin transliteration both directions (ISO 9985 plus the pragmatic variants: ղ→gh, ճ→ch/j, յ→y/h dropped finally, օ/ո→o…). Generate a variant set per name and query sources in Armenian script, post-filtering results against the variant set.
- **Legal-name canonicalization.** Strip/normalize «», quotes, ՍՊԸ/ՓԲԸ/ԲԲԸ/ԱՁ suffixes and their EN equivalents (LLC/CJSC/OJSC/IE) before matching; store both raw and canonical.
- **TIN as join key.** TIN is the only identifier shared across all sources — propagate it into every Fact; where a source returns only names (Datalex, Azdarar text), the match is `fuzzy` by definition and the Fact record must say so (feeds rule R-08).

## 13. Fetcher architecture

- **One adapter per source**, all implementing `fetch(subject) -> [Fact]`; adapters declare their domain for coverage accounting. A failed/blocked adapter reports domain-unverified — never silently empty (the Verdict layer treats "queried, none found" and "couldn't query" oppositely).
- **Headless browser pool** (Playwright) for Datalex and any postback-style forms; plain HTTP for the rest.
- **Cache per domain:** registry/BO 7 days, courts/enforcement 24h, notices/auctions 24h, web/whois 30 days, sanctions index weekly cron. Every Fact carries `fetched_at`; the UI shows staleness.
- **Politeness:** per-source rate limits (1 req / 2–5 s on gov sources), identifying User-Agent with a contact address, exponential backoff, circuit breaker per source. These are public records, but the sites are fragile and goodwill is an asset — especially if you later want formal data agreements.
- **Legal note (not legal advice):** all sources here are public records or open publications; still, before commercial launch, review each site's terms, the RA Law on Personal Data Protection as it applies to processing directors'/UBOs' names, and consider the formal route (some registers offer official bulk/interface agreements) once volume justifies it. Cache + show-with-source is a defensible pattern; wholesale republication of dossiers is a different conversation.

## 14. Recon checklist (first build sprint)

- [ ] e-register: confirm canonical search platform (e-register.am vs e-services.moj.am), form params, paid-extract flow + current fee, person-search availability
- [ ] BODS: locate the register's own bulk export; compare freshness vs bods-data.openownership.org
- [ ] src.am: capture search request (viewstate?), locate current top-1000 publication
- [ ] Datalex: session/deep-link behavior, result-grid selectors, build the claim-amount regex library from ~30 sample verdicts
- [x] harkadir.am: **DONE** — debtor search is at `cabinet.harkadir.am/.../DebtorRems` (plain HTTP, TIN-keyed, no captcha); the cesa.am captcha wall is only on contact forms. ✅ BUILT (`src/adapters/enforcement.ts`)
- [x] Pledge register: **PUBLIC** — canonical register is `registration.am` (NOT under the e-register umbrella), name+regnumber-searchable, debtor-attributable, plain-HTTP BARL POST. F-PLG-01/SN-06/R-05 stay live; coverage denominator stays 10. ✅ BUILT (`src/adapters/pledge.ts`)
- [x] gnumner/armeps: **armeps PPCM public JSON API** is supplier-searchable (no local-index ingest needed); gnumner dropped (aggregate stats only). ✅ BUILT (`src/adapters/procurement.ts`)
- [ ] ajurd.am: lot listing structure, debtor field
- [ ] Derive/confirm TIN check-digit algorithm from known-valid TINs
- [ ] Transliteration variant generator: test against 50 real company names across all three scripts
