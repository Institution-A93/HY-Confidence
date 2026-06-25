// Live smoke for the recon-free adapters. Run with:
//   node --experimental-strip-types tools/smoke-adapters.ts
// Uses REAL inputs (the fixtures are fictional, so they wouldn't resolve live). Proves the
// pipes return genuine Facts. Not part of `npm test` (that suite must stay deterministic).
import { whoisAdapter } from "../src/adapters/whois.ts";
import { mxAdapter } from "../src/adapters/mx.ts";
import { sanctionsAdapter } from "../src/adapters/sanctions.ts";
import { datalexAdapter } from "../src/adapters/datalex.ts";
import { eregisterAdapter } from "../src/adapters/eregister.ts";
import { pledgeAdapter } from "../src/adapters/pledge.ts";
import { procurementAdapter } from "../src/adapters/procurement.ts";
import { enforcementAdapter } from "../src/adapters/enforcement.ts";
import { resolveBySrc } from "../src/adapters/srcam.ts";
import { screenOwners } from "../src/adapters/sanctions.ts";
import type { Subject } from "../src/lib/adapter.ts";

const now = () => new Date().toISOString();

async function run(label: string, fn: () => Promise<unknown>) {
  process.stdout.write(`\n=== ${label} ===\n`);
  try {
    const r = await fn();
    console.log(JSON.stringify(r, null, 2));
  } catch (e) {
    console.log("ERROR:", e instanceof Error ? e.message : e);
  }
}

const real: Subject = { website: "spyur.am", email: "info@spyur.am", name: "Spyur" };

await run("WHOIS spyur.am", () => whoisAdapter.fetch(real, now()));
await run("MX info@spyur.am", () => mxAdapter.fetch(real, now()));
await run("Sanctions — Vladimir Putin (expect HIT)", () =>
  sanctionsAdapter.fetch({ person: "Vladimir Putin" }, now()),
);
await run("Sanctions — Vahram Petrosyan (expect clean)", () =>
  sanctionsAdapter.fetch({ person: "Vahram Petrosyan" }, now()),
);
// Court: name-keyed, so we pass canonical Armenian names directly (as the two-phase /check would).
await run("Datalex — Հայաստանի էլեկտրական ցանցեր (expect plaintiff F-CRT-01)", () =>
  datalexAdapter.fetch({ name: "Հայաստանի էլեկտրական ցանցեր" }, now()),
);
await run("Datalex — Թոփ Ավտո ՍՊԸ (expect bankruptcy F-CRT-03 → B-01)", () =>
  datalexAdapter.fetch({ name: "Թոփ Ավտո ՍՊԸ" }, now()),
);
// e-register: TIN-keyed. Grand Candy → expect beneficial owners (the Vardanyan brothers, 50/50).
await run("e-register — Grand Candy TIN 02226764 (expect F-REG-07 owners)", () =>
  eregisterAdapter.fetch({ tin: "02226764" }, now()),
);
// Pledge: name-keyed. Spayka (Սպայկա) carries many movable-property pledges (expect F-PLG-01).
await run("Pledge — Սպայկա (expect F-PLG-01 pledges)", () =>
  pledgeAdapter.fetch({ name: "Սպայկա" }, now()),
);
// Procurement: name-keyed, TIN confirms the supplier. Regard Travel has recent state contracts.
await run("Procurement — Regard Travel TIN 02252505 (expect F-PRC-01 win, exact)", () =>
  procurementAdapter.fetch({ name: "Regard Travel", tin: "02252505" }, now()),
);
// Enforcement: TIN-keyed (DAHK debtor search). Grand Candy is clean → verified_empty proves the
// token/captcha/POST pipe. Swap in a known debtor's TIN to see F-ENF-01 + the REMS structure.
await run("Enforcement — Grand Candy TIN 02226764 (expect clean / verified_empty)", () =>
  enforcementAdapter.fetch({ tin: "02226764" }, now()),
);

// spyur fallback: a Latin name whose Armenian spelling is phonetic (Mining → Մայնինգ). The direct
// transliteration search misses it; the DDG-Lite/spyur fallback re-keys src.am → expect «ՄԼ ՄԱՅՆԻՆԳ»
// (TIN 02569362) at the top.
await run("Resolve — ML Mining (Latin, expect spyur fallback → 02569362 «ՄԼ ՄԱՅՆԻՆԳ»)", () =>
  resolveBySrc("ML Mining", 3),
);
// Owner screening: screen a real beneficial-owner person name against OFAC (expect clean) and a
// sanctioned name (expect a strong hit) — the UBO path that gives single-token-named firms a status.
await run("Owner screen — [Դավիթ Սուքիասյան] clean + [Vladimir Putin] strong", () =>
  screenOwners(["Դավիթ Սուքիասյան", "Vladimir Putin"]),
);

console.log("\nsmoke done.");
