/**
 * How Analyze reads the engine's own singing: render notes with known settings (vowel, pitch,
 * voice quality, twang, larynx), analyse each, and print what came back beside what went in.
 * The scales in src/analyze/interpret.ts were set from this table.
 *
 * Usage: bun tools/analyze-calibrate.ts [male|female] [--wav dir]
 */
import { initEngine } from "../tests/harness.ts";
import { OfflineVoice } from "./lib/voice.ts";
import { writeWav } from "./lib/wav.ts";

await initEngine();
const { buildCodebook, baseVowel } = await import("../src/analyze/codebook.ts");
const { analyze } = await import("../src/analyze/analyze.ts");
const { VoiceModel } = await import("../src/ui/analysis.ts");
const { resolveShape } = await import("../src/coach/shape.ts");
const { BASE_SOURCE, Q } = await import("../src/coach/lessons.ts");

const bodyName = process.argv[2] === "female" ? "female" : "male";
const body = bodyName === "female" ? { female: 1, child: 0 } : { female: 0, child: 0 };
const wavDir = process.argv.includes("--wav") ? process.argv[process.argv.indexOf("--wav") + 1] : null;
const fs = 48000;

let t0 = performance.now();
const cb = await buildCodebook(body);
console.log(`codebook: ${cb.nBase} shapes × ${cb.nVar} variants in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
const vm = new VoiceModel(body, fs);

const median = (v: number[]) => {
  const s = v.slice().sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : NaN;
};

interface Case {
  name: string;
  vowel: string;
  hz: number;
  source?: Record<string, number>;
  twang?: number;
  larynx?: number;
}

const CLIP = 1.6;

function render(c: Case): Float32Array {
  const v = new OfflineVoice(fs, body);
  const artic = resolveShape(vm, c.vowel, { add: { larynx: c.larynx ?? 0 }, set: { epilarynx: c.twang ?? 0.1 } });
  v.setArtic(artic, true);
  v.setSource({ ...BASE_SOURCE, ...c.source, f0: c.hz, glide: 0.005, drift: 3 });
  const pre = v.render(0.2);
  v.gate(1);
  const sung = v.render(1.1);
  v.gate(0);
  const tail = v.render(CLIP - 1.3);
  v.free();
  const x = new Float32Array(Math.round(CLIP * fs));
  x.set(pre);
  x.set(sung, pre.length);
  x.set(tail.subarray(0, x.length - pre.length - sung.length), pre.length + sung.length);
  if (wavDir) writeWav(`${wavDir}/${c.name.replace(/[^\w.-]+/g, "_")}.wav`, [x], fs);
  return x;
}

function report(c: Case, t: Awaited<ReturnType<typeof analyze>>, at: number) {
  const f0 = Math.round(at * CLIP * 100);
  const idx: number[] = [];
  let frames = 0;
  for (let i = f0 + 45; i < f0 + 115; i++) {
    frames++;
    if (t.f0[i] > 0 && t.entry[i] >= 0) idx.push(i);
  }
  const med = (a: Float32Array) => median(idx.map((i) => a[i]));
  const vowels = new Map<string, number>();
  for (const i of idx) vowels.set(baseVowel(cb, t.shape[i]), (vowels.get(baseVowel(cb, t.shape[i])) ?? 0) + 1);
  const top = [...vowels.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    case: c.name,
    voiced: `${idx.length}/${frames}`,
    f0: +med(t.f0).toFixed(0),
    vowel: top ? `${top[0]} ${Math.round((100 * top[1]) / idx.length)}%` : "-",
    twang: +med(t.twang).toFixed(2),
    ringDb: +med(t.ringDb).toFixed(1),
    ringX: +med(t.ringExcess).toFixed(1),
    larynx: +med(t.larynx).toFixed(2),
    fit: +med(t.fit).toFixed(1),
    slope: +med(t.slope).toFixed(1),
    h1h2: +med(t.h1h2).toFixed(1),
    hnrLo: +med(t.hnrLow).toFixed(1),
    hnrHi: +med(t.hnrHigh).toFixed(1),
    sub: +med(t.sub).toFixed(1),
    aper: +(100 * (1 - med(t.periodicity))).toFixed(1),
    dbl: +(100 * med(t.doubling)).toFixed(1),
    breath: +med(t.breath).toFixed(2),
    press: +med(t.press).toFixed(2),
    grit: +med(t.grit).toFixed(2),
    weight: +med(t.weight).toFixed(2),
  };
}

const base = bodyName === "female" ? 220 : 147;
const cases: Case[] = [];
for (const vowel of ["i", "ɛ", "ɑ", "o", "u"]) for (const mult of [1, 1.5, 2, 3]) cases.push({ name: `${vowel} ${Math.round(base * mult)}Hz`, vowel, hz: base * mult });
const qualities: [string, Record<string, number>][] = [
  ["flow", Q.flow],
  ["breathy", Q.breathy],
  ["pressed", Q.pressed],
  ["chest", Q.chest],
  ["head", Q.head],
  ["falsetto", Q.falsetto],
  ["mix", Q.mix],
  ["edge", { ...Q.mix, distortion: 0.36 }],
  ["rasp", { ...Q.mix, distortion: 0.56 }],
  ["grind", { ...Q.pressed, distortion: 0.82, roughness: 0.6 }],
];
for (const [qn, q] of qualities) for (const mult of [1.5, 2.5]) cases.push({ name: `ɑ ${Math.round(base * mult)}Hz ${qn}`, vowel: "ɑ", hz: base * mult, source: q });
for (const tw of [0.1, 0.5, 0.9]) for (const vowel of ["ɛ", "ɑ"]) cases.push({ name: `${vowel} ${base * 2}Hz twang ${tw}`, vowel, hz: base * 2, twang: tw });
for (const hz of [base * 0.75, base * 1.5]) for (const depth of [40, 90]) cases.push({ name: `ɑ ${Math.round(hz)}Hz vibrato ${depth}`, vowel: "ɑ", hz, source: { vibratoDepth: depth, vibratoRate: 5.5 } });
for (const lx of [-0.9, 0, 0.9]) cases.push({ name: `ɑ ${base * 1.5}Hz larynx ${lx}`, vowel: "ɑ", hz: base * 1.5, larynx: lx });

const clips = cases.map(render);
const all = new Float32Array(clips.length * Math.round(CLIP * fs));
clips.forEach((c, i) => all.set(c, i * Math.round(CLIP * fs)));
t0 = performance.now();
const track = analyze(all, fs, cb);
const secs = (performance.now() - t0) / 1000;
console.table(cases.map((c, i) => report(c, track, i)));
console.log(`tract factor ${track.alpha.toFixed(2)}; analysed ${(all.length / fs).toFixed(0)} s of sound in ${secs.toFixed(1)} s`);
