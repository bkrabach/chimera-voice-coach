/**
 * Analyze's formants beside Praat's, on the VocalSet recordings Praat has read
 * (data/eval/vocalset.praat.jsonl): the median F1..F3 of each recording, from each.
 *
 * Usage: bun tools/eval/formant-check.ts [--shard i/n]   → data/eval/formants.<i>.jsonl
 *        then tools/eval/.venv/bin/python tools/eval/formant_report.py
 */
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decode } from "./extract.ts";
import { initEngine } from "../../tests/harness.ts";
import type { Codebook } from "../../src/analyze/codebook.ts";

const DATA = join(fileURLToPath(new URL("../..", import.meta.url)), "data");
const args = process.argv.slice(2);
const [si, sn] = (args.includes("--shard") ? args[args.indexOf("--shard") + 1] : "0/1").split("/").map(Number);
const praat = readFileSync(join(DATA, "eval", "vocalset.praat.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.error && r.F1 && /_[aeiou]\.wav$/.test(r.path));
await initEngine();
const { buildCodebook } = await import("../../src/analyze/codebook.ts");
const { analyze } = await import("../../src/analyze/analyze.ts");
const books: Record<string, Codebook> = {};
const out = join(DATA, "eval", `formants.${si}.jsonl`);
writeFileSync(out, "");
const med = (v: number[]) => (v.length ? v.slice().sort((a, b) => a - b)[v.length >> 1] : null);
let k = 0;
for (const r of praat.filter((_, i) => i % sn === si)) {
  const female = /female/.test(r.path);
  books[female ? "f" : "m"] ??= await buildCodebook({ female: female ? 1 : 0, child: 0 });
  // the whole of Analyze, so this is the formant a singer is shown
  const t = analyze(decode(join(DATA, r.path)), 48000, books[female ? "f" : "m"]);
  const sung = (j: number) => Array.from({ length: t.n }, (_, i) => (t.f0[i] > 0 ? t.formants[i * 3 + j] : 0)).filter((v) => v > 0);
  appendFileSync(out, JSON.stringify({ path: r.path, f0: med(Array.from(t.f0).filter((v) => v > 0)), F1: med(sung(0)), F2: med(sung(1)), F3: med(sung(2)), pF1: r.F1, pF2: r.F2, pF3: r.F3, pf0: r.f0 }) + "\n");
  if (++k % 50 === 0) console.error(`[${si}] ${k}`);
}
