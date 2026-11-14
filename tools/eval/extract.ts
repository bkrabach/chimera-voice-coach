/**
 * Run Analyze over a labelled dataset and write what it read, one JSON line per recording, for
 * tools/eval/report.py to set beside the labels (and beside Praat's readings of the same files).
 *
 * Usage: bun tools/eval/extract.ts <vocalset|emvd|ptdb> [--shard i/n] [--limit N] [--frames] [--every N] [--match re]
 *   --shard i/n   only every n-th recording, starting at i (run n of them side by side)
 *   --frames      also write each frame's pitch (for frame-by-frame checks): data/eval/<set>.frames.<i>.jsonl
 *   --every N     one recording in N (a quick look while changing something)
 *   --match re    only recordings whose path matches
 * Output: data/eval/<set>.<i>.jsonl. The datasets come from tools/data/fetch.sh.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { initEngine } from "../../tests/harness.ts";
import type { VoiceTrack } from "../../src/analyze/analyze.ts";
import type { Codebook } from "../../src/analyze/codebook.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DATA = join(ROOT, "data");

export interface Item {
  /** path under data/ */
  path: string;
  singer: string;
  /** "male" | "female": which body's shapes it is matched against */
  body: "male" | "female";
  labels: Record<string, string>;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(wav|flac|mp3|ogg)$/i.test(name) && !name.startsWith("._")) out.push(p);
  }
  return out;
}

/** VocalSet: …/<singer>/<context>/<technique>/<s>_<context>_<technique>_<vowel>.wav */
function vocalset(): Item[] {
  const base = join(DATA, "vocalset");
  const out: Item[] = [];
  for (const p of walk(base)) {
    const parts = relative(base, p).split("/");
    const i = parts.findIndex((s) => /^(fe)?male\d+$/.test(s));
    if (i < 0 || parts.length < i + 4) continue;
    const singer = parts[i];
    const file = parts[parts.length - 1].replace(/\.wav$/i, "");
    const vowel = /_([aeiou])$/.exec(file)?.[1] ?? "";
    out.push({ path: relative(DATA, p), singer, body: singer.startsWith("female") ? "female" : "male", labels: { context: parts[i + 1], technique: parts[i + 2], vowel } });
  }
  return out;
}

/** a tiny CSV reader (quoted fields, commas or semicolons) */
function csv(path: string): Record<string, string>[] {
  const text = readFileSync(path, "utf8").replace(/^﻿/, "");
  const sep = text.split("\n")[0].includes(";") && !text.split("\n")[0].includes(",") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) (row.push(cell), (cell = ""));
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell || row.length) (row.push(cell), rows.push(row));
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

/** EMVD: metadata_files.csv names each file, its singer and its technique; metadata_singers.csv the singers. */
function emvd(): Item[] {
  const base = join(DATA, "emvd");
  const files = csv(join(base, "metadata_files.csv"));
  const singers = new Map(csv(join(base, "metadata_singers.csv")).map((s) => [s.singer_id ?? s.id ?? Object.values(s)[0], s]));
  const audio = new Map(walk(base).map((p) => [p.split("/").pop()!.replace(/\.[^.]+$/, ""), p]));
  const out: Item[] = [];
  for (const f of files) {
    const name = (f.file_name ?? f.filename ?? f.file ?? Object.values(f)[0]).replace(/\.[^.]+$/, "");
    const p = audio.get(name);
    if (!p) continue;
    const sid = f.singer_id ?? f.singer ?? "";
    const s = singers.get(sid) ?? {};
    const sex = `${s.gender ?? s.sex ?? ""}`.toLowerCase();
    out.push({ path: relative(DATA, p), singer: `emvd${sid}`, body: sex.startsWith("f") || sex.startsWith("w") ? "female" : "male", labels: { type: f.type ?? "", technique: f.name ?? "", range: f.range ?? "", vowel: f.vowel ?? "", rank: f.authors_rank ?? "" } });
  }
  return out;
}

/** PTDB-TUG: MIC/<speaker>/mic_<speaker>_<sentence>.wav, with LAR/ and REF/ beside it. */
function ptdb(): Item[] {
  const base = join(DATA, "ptdb", "MIC");
  return walk(base).map((p) => {
    const spk = relative(base, p).split("/")[0];
    return { path: relative(DATA, p), singer: spk, body: spk.startsWith("F") ? "female" : "male", labels: { kind: "speech" } };
  });
}

export const DATASETS: Record<string, () => Item[]> = { vocalset, emvd, ptdb };

/** A recording as mono floats at 48 kHz (ffmpeg reads whatever it is). */
export function decode(path: string): Float32Array {
  const r = Bun.spawnSync(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", "48000", "-"], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`ffmpeg: ${r.stderr.toString().trim().split("\n").pop()}`);
  const b = r.stdout;
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength - (b.byteLength % 4)));
}

const q = (v: number[], p: number): number => {
  if (!v.length) return NaN;
  const s = v.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)))];
};
const r3 = (x: number) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);

/** What Analyze read from one recording, summed up over its sung frames. */
export function measures(t: VoiceTrack): Record<string, unknown> {
  const sung: number[] = [];
  let loudFrames = 0, harsh = 0;
  for (let i = 0; i < t.n; i++) {
    if (t.kind[i] !== 0) loudFrames++;
    if (t.kind[i] === 4) harsh++;
    if (t.f0[i] > 0 && t.shape[i] >= 0) sung.push(i);
  }
  const col = (a: Float32Array) => sung.map((i) => a[i]).filter((x) => Number.isFinite(x));
  const med = (a: Float32Array) => r3(q(col(a), 0.5));
  const vowels: Record<string, number> = {};
  for (const i of sung) if (t.vowel[i] !== 255) vowels[t.vowelNames[t.vowel[i]]] = (vowels[t.vowelNames[t.vowel[i]]] ?? 0) + 1;
  const vib = sung.filter((i) => t.vibExtent[i] > 0);
  const f1 = sung.map((i) => t.formants[i * 3]).filter((v) => v > 0), f2 = sung.map((i) => t.formants[i * 3 + 1]).filter((v) => v > 0), f3 = sung.map((i) => t.formants[i * 3 + 2]).filter((v) => v > 0);
  const midi = sung.map((i) => 69 + 12 * Math.log2(t.f0[i] / 440));
  return {
    seconds: r3(t.duration),
    sung: r3(sung.length * t.hop),
    /** share of the frames with sound in them that were read as sung, and as harsh (no pitch) */
    sungShare: r3(sung.length / Math.max(1, loudFrames)),
    harshShare: r3(harsh / Math.max(1, loudFrames)),
    f0: r3(q(sung.map((i) => t.f0[i]), 0.5)),
    midiLow: r3(q(midi, 0.05)),
    midiHigh: r3(q(midi, 0.95)),
    level: med(t.level),
    slope: med(t.slope),
    h1h2: med(t.h1h2),
    alphaRatio: med(t.alphaRatio),
    spr: med(t.spr),
    ringDb: med(t.ringDb),
    nhrLow: med(t.nhrLow),
    nhrLow90: r3(q(col(t.nhrLow), 0.9)),
    nhrHigh: med(t.nhrHigh),
    sub: med(t.sub),
    sub90: r3(q(col(t.sub), 0.9)),
    aper: r3(1 - q(col(t.periodicity), 0.5)),
    doubling: med(t.doubling),
    press: med(t.press),
    breath: med(t.breath),
    grit: med(t.grit),
    grit90: r3(q(col(t.grit), 0.9)),
    ring: med(t.ring),
    vibShare: r3(vib.length / Math.max(1, sung.length)),
    vibRate: r3(q(vib.map((i) => t.vibRate[i]), 0.5)),
    vibExtent: r3(q(vib.map((i) => t.vibExtent[i]), 0.5)),
    F1: r3(q(f1, 0.5)),
    F2: r3(q(f2, 0.5)),
    F3: r3(q(f3, 0.5)),
    vowels,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const set = args[0];
  if (!DATASETS[set]) {
    console.error("usage: bun tools/eval/extract.ts <vocalset|emvd|ptdb> [--shard i/n] [--limit N] [--frames]");
    process.exit(2);
  }
  const opt = (name: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
  const [si, sn] = (opt("shard") ?? "0/1").split("/").map(Number);
  const limit = Number(opt("limit") ?? Infinity);
  const frames = args.includes("--frames");
  const every = Number(opt("every") ?? 1);
  const match = opt("match") ? new RegExp(opt("match")!) : null;
  const all = DATASETS[set]();
  let items = all.filter((it) => !match || match.test(it.path)).filter((_, i) => i % every === 0).filter((_, i) => i % sn === si);
  if (Number.isFinite(limit)) items = items.slice(0, limit);
  await initEngine();
  const { buildCodebook } = await import("../../src/analyze/codebook.ts");
  const { analyze } = await import("../../src/analyze/analyze.ts");
  const books: Partial<Record<"male" | "female", Codebook>> = {};
  mkdirSync(join(DATA, "eval"), { recursive: true });
  const out = join(DATA, "eval", `${set}.${si}.jsonl`), fout = join(DATA, "eval", `${set}.frames.${si}.jsonl`);
  writeFileSync(out, "");
  if (frames) writeFileSync(fout, "");
  const t0 = performance.now();
  let done = 0, secs = 0;
  for (const it of items) {
    try {
      const x = decode(join(DATA, it.path));
      books[it.body] ??= await buildCodebook(it.body === "female" ? { female: 1, child: 0 } : { female: 0, child: 0 });
      const t = analyze(x, 48000, books[it.body]!);
      secs += t.duration;
      appendFileSync(out, JSON.stringify({ path: it.path, singer: it.singer, body: it.body, ...it.labels, ...measures(t) }) + "\n");
      if (frames) appendFileSync(fout, JSON.stringify({ path: it.path, hop: t.hop, f0: Array.from(t.f0, (v) => Math.round(v * 10) / 10), press: Array.from(t.press, (v) => Math.round(v * 100) / 100), slope: Array.from(t.slope, (v) => Math.round(v * 10) / 10) }) + "\n");
    } catch (e) {
      appendFileSync(out, JSON.stringify({ path: it.path, singer: it.singer, body: it.body, ...it.labels, error: e instanceof Error ? e.message : String(e) }) + "\n");
    }
    if (++done % 50 === 0) console.error(`[${si}/${sn}] ${done}/${items.length}`);
  }
  console.error(`[${si}/${sn}] ${done} recordings, ${(secs / 60).toFixed(1)} min of sound, in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
  if (!existsSync(out)) process.exit(1);
}
