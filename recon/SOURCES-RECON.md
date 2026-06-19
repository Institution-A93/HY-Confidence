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
| spyur.am (directory) | ⚠️ 403 Cloudflare "Just a moment" | behind CF bot-challenge → use the search-engine fallback (`"<phone>" site:spyur.am`) or headless; anticipated |
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
- **e-register.am — ⛔ BLOCKED.** Behind **Radware Bot Manager**: real content paths 302-redirect
  a datacenter IP to `validate.perfdrive.com` (our IP is base64'd into the challenge URL). Needs a
  headless browser that solves the JS challenge, or a residential proxy. Not buildable as plain HTTP.
  Mitigated for now by src.am covering the registry basics; founders/UBO/history still need this
  (or the paid extract).
- **cesa.am — ⛔ BLOCKED (likely).** Cloudflare + CodeIgniter; CSP references **reCAPTCHA**, so the
  proceedings search is probably captcha-gated. Needs a captcha-solving service or headless. Content
  is reachable at `/en/` but the search itself is the wall.

**To unblock e-register + cesa.am later:** a Playwright headless pool on the droplet (+ a captcha
solver like 2captcha for src.am-style image codes and cesa reCAPTCHA, and/or an Armenian residential
proxy for Radware). That is a deliberate cost/infra step — not plain HTTP.

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
  is Cloudflare+reCAPTCHA-walled. **Therefore SN-05 is unlocked together with cesa.am** (same paid
  headless+captcha step as e-register) — not before. Building a name-keyed ajurd adapter now would return
  empty for every real query and mislabel it "auction: queried, none found" (verified_empty), violating
  the R-09 "could-not-query ≠ queried-empty" invariant — so it was deliberately NOT built.
  (`eauction.am` is unrelated — it's "LOT BORSA", a private commodity exchange; voluntary, also no debtor names.)

Recommendation: grind ONE properly in a focused session — **azdarar** is highest value (liquidation /
capital-reduction notices feed blocker B-02 and SN-04). **azdarar is now BUILT & LIVE** (`src/adapters/azdarar.ts`).
Next buildable high-value source is **datalex** (courts — names plaintiff/defendant, so unlike ajurd it
IS name-attributable). See the datalex section below.

---

## e-register.am — State Register (registry, graph) · Epics B1, D3, E1
Facts: F-REG-01..08, seeds F-GRA-01/02. **Backbone of identity.**
- 🔎 Canonical search platform: `e-register.am` vs the newer `e-services.moj.am` (sole-proprietor
  services already migrated). Which one serves company search at build time?
- 🔎 Search request: GET vs POST, param names, viewstate/CSRF. Captcha on search? (historically none).
- 🔎 Person/participant search availability and whether it is gated to the paid tier (if gated →
  fall back to the BODS bulk route for the graph, E1).
- ⚠ Query in **Armenian script** — transliteration search is unreliable (use `normalize.ts`).
- ⚠ Free tier = basic card (F-REG-01/02/04/05 + basic BO). F-REG-06 shares, F-REG-08 history,
  pledge detail need a **paid extract** (~3000 AMD, account + online payment) → D3.
  - 🔎 Extract format (PDF vs HTML), whether an Armenian e-signature is required for mere extracts.

## src.am — State Revenue Committee (tax) · Epic B2
Facts: F-TAX-01 TIN+name, F-TAX-02 VAT, F-TAX-03 top-1000.
- Page: `src.am/en/taxpayerSearchSystemPage/112` (EN shell; HY parallel). **[V]** searchable by
  TIN / company name / director.
- ⚠ Likely an ASP.NET app — 🔎 capture the full postback (viewstate) or drive headless.
- 🔎 Top-1000 publication: no stable URL, posted per-period as news/PDF — locate current period
  (check `petekamutner.am` too).
- This + e-register is what **de-fuzzes** name-matched facts (locks the TIN).

## datalex.am — Judicial portal (court) · Epic F1 — HARDEST
Facts: F-CRT-01..04 (litigation, all instances, bankruptcy).
- Page: `datalex.am/?app=AppCaseSearch`. **[V]** 2M+ cases, Armenian-only.
- ⚠ Old portal: frame/app-parameter nav, **session-bound**, no stable deep links → **Playwright**.
  Store extracted content, NOT URLs; link users to the search page.
- ⚠ **Role classification is mandatory**: plaintiff vs defendant vs bankruptcy court drives
  SN-01 vs WP-09 vs B-01 — never pass unclassified counts downstream.
- 🔎 Build the claim-amount regex library from ~30 sample verdicts (Armenian legal boilerplate).
- 🔎 Are case-view URLs replayable across sessions? (fixtures assume a query-style placeholder).
- ⚠ Slowest, most fragile source — cache 12–24h, throttle, run async.

## harkadir.am — DAHK / compulsory enforcement (enforcement) · Epic D1
Facts: F-ENF-01 open proceedings — strongest free "won't pay" signal (→ blocker B-03).
- 🔎 Locate the proceedings-search section (site restructured ≥ once) — path + params.
- ⚠ Only **open** proceedings are exposed; closed history is not retrievable (why SN-02 was culled).
- 🔎 Match by TIN where the form allows, else Armenian name + fuzzy post-filter.

## azdarar.am — Official public notifications (notice) · Epic D2
Facts: F-NTC-01 liquidation / creditor-call / reorg / capital-reduction (→ B-02, SN-04).
- ⚠ Coverage complete by construction (statutory publication).
- 🔎 Does search cover full text or titles only? If titles only, pull category feeds and grep locally.
- 🔎 Classify into the four flag types by title keywords; TIN usually present in the notice text.

## armeps.am / gnumner.am — Procurement (procurement) · Epic E2
Facts: F-PRC-01 award wins by supplier (→ SP-03 evidence).
- 🔎 Which surface exposes a **supplier-name search** vs requiring iteration over award notices?
  (gnumner historically lists machine-readable announcements.)
- Fallback: periodically ingest award announcements into a local index, query locally.

## ajurd.am — Compulsory auctions (auction) · Epic E3
Facts: F-AUC-01 assets under forced sale (→ SN-05).
- 🔎 Debtor-name search vs listing iteration; lot page structure (debtor field).
- ⚠ Low volume → daily full-listing ingest into a local index is simplest.

## Pledge register (pledge) · Epic F2 — may be deferred
Facts: F-PLG-01 movable pledges (→ SN-06, R-05).
- ⚠ Access tier **unconfirmed**. 🔎 Determine if public or gated to banks/notaries.
- If gated → move F-PLG-01 / SN-06 / R-05 to deferred and **drop the coverage denominator to 9**
  (the engine's coverage accounting already supports a dynamic total).

---

## Recon-free (DONE / live this build)
- **Sanctions** (OFAC SDN live; EU/UK next) — `src/adapters/sanctions.ts`
- **WHOIS .am** (AMNIC :43) — `src/adapters/whois.ts`
- **Email MX** (node:dns) — `src/adapters/mx.ts`
- Validated by `tools/smoke-adapters.ts` (real inputs), not the deterministic unit suite.
