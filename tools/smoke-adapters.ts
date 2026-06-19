// Live smoke for the recon-free adapters. Run with:
//   node --experimental-strip-types tools/smoke-adapters.ts
// Uses REAL inputs (the fixtures are fictional, so they wouldn't resolve live). Proves the
// pipes return genuine Facts. Not part of `npm test` (that suite must stay deterministic).
import { whoisAdapter } from "../src/adapters/whois.ts";
import { mxAdapter } from "../src/adapters/mx.ts";
import { sanctionsAdapter } from "../src/adapters/sanctions.ts";
import { datalexAdapter } from "../src/adapters/datalex.ts";
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

console.log("\nsmoke done.");
