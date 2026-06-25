// Refresh the SRC top-1000 snapshot (src/data/top1000.ts) for F-TAX-03 / SP-02.
// Run per-period (the SRC list changes quarterly):
//   node tools/refresh-top1000.mjs
//
// Source: karg.am/top-1000, a public aggregator of the official SRC "1000 largest taxpayers" list.
// It paginates 20 rows/page (×50 = 1000) and exposes each entry's TIN via `/company/<TIN>` plus the
// rank `#N` — so we key by TIN (exact). We crawl every page, collect (rank → TIN), and rewrite the
// data file in rank order. Sanity-gated: bails if it didn't get a full, contiguous 1..N ranking.
import { writeFileSync } from "node:fs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";

async function get(url) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 20000);
  const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": UA, "Accept-Language": "hy" } });
  clearTimeout(to);
  return r.text().catch(() => "");
}

const byRank = new Map();
for (let page = 1; page <= 60; page++) {
  const html = await get(`https://karg.am/top-1000?lang=hy&page=${page}`);
  const rows = [...html.matchAll(/<a class="k-row" href="\/company\/(\d+)[^"]*"[\s\S]*?#(\d+)<\/span>/g)];
  if (!rows.length) break; // ran past the last page
  for (const m of rows) byRank.set(Number(m[2]), m[1]);
  process.stderr.write(`page ${page}: ${rows.length} rows (total ${byRank.size})\n`);
}

const ranks = [...byRank.keys()].sort((a, b) => a - b);
const tins = ranks.map((r) => byRank.get(r));
if (tins.length < 900 || ranks.some((r, i) => r !== i + 1) || tins.length !== new Set(tins).size) {
  console.error(`SANITY FAIL: ${tins.length} TINs, contiguous=${!ranks.some((r, i) => r !== i + 1)}, dupes=${tins.length - new Set(tins).size}`);
  process.exit(1);
}

const pulledAt = new Date().toISOString().slice(0, 10);
const rows = [];
for (let i = 0; i < tins.length; i += 10) rows.push("  " + tins.slice(i, i + 10).map((t) => `"${t}"`).join(", ") + ",");

const file = `// F-TAX-03 — SRC "1000 largest taxpayers" snapshot (feeds SP-02, +12).
//
// WHY A STATIC SNAPSHOT, not a live fetch: the SRC publishes this list per-period as an
// article/PDF with no stable URL (source-access-spec.md §3, [R]); petekamutner.am is unreachable
// from our network and src.am serves it only through a JS SPA. A quarterly-refreshed snapshot is
// reliable, testable, and Pages-compatible — and SP-02 is POSITIVE-only, so a stale/partial list
// only fails to award a bonus, it can never harm a verdict.
//
// SOURCE: karg.am/top-1000 (a public aggregator of the official SRC list). karg.am exposes each
// entry's TIN (\`/company/<TIN>\`), so we key by TIN — an EXACT match (no fuzzy name guesswork, no
// R-08 damping). \`tins\` is in published RANK ORDER (rank = index + 1).
//
// REFRESH: re-run \`node tools/refresh-top1000.mjs\` each period (it rewrites this file).
export const TOP1000: { pulledAt: string; source: string; tins: string[] } = {
  pulledAt: "${pulledAt}",
  source: "SRC 1000 largest taxpayers (via karg.am)",
  tins: [
${rows.join("\n")}
  ],
};
`;

writeFileSync(new URL("../src/data/top1000.ts", import.meta.url), file, "utf8");
console.error(`WROTE src/data/top1000.ts: ${tins.length} TINs, pulledAt=${pulledAt}`);
