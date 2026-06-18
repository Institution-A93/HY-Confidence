// One-shot: lift the design-system CSS out of the Claude Design standalone bundle into
// src/styles.css. Strips the bundler @font-face blocks (they referenced inlined assets);
// fonts are loaded from Google Fonts in index.html instead. Scratch tool — safe to delete.
import { readFileSync, writeFileSync } from "node:fs";

const html = readFileSync("Counterparty Check (standalone).html", "utf8");
const open = '<script type="__bundler/template">';
const s = html.indexOf(open) + open.length;
const e = html.indexOf("</script>", s);
const tpl = JSON.parse(html.slice(s, e).trim()); // the block is already a quoted JSON string

const st = tpl.indexOf("<style>") + 7;
const se = tpl.indexOf("</style>", st);
let css = tpl.slice(st, se);

css = css.replace(/@font-face\s*\{[^}]*\}/g, "");
css = css.replace(/^[ \t]*\/\*\s*(cyrillic|cyrillic-ext|latin|latin-ext|greek|greek-ext|vietnamese|devanagari|math|armenian)\s*\*\/[ \t]*$/gm, "");
css = css.replace(/(\r?\n){3,}/g, "\n\n").trim();

const header =
  "/* Design system ported from the Claude Design standalone mockup.\n" +
  "   Fonts load from Google Fonts in index.html; the bundler's @font-face blocks\n" +
  "   referenced inlined assets and were stripped on port. */\n\n";

writeFileSync("src/styles.css", header + css + "\n", "utf8");
console.log("styles.css written:", (header + css).length, "chars");
