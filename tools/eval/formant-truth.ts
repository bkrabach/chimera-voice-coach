/**
 * Formants against the truth. Real recordings cannot say whether a formant was read right, since
 * nobody knows a singer's true formants; these two can:
 *
 *   1. vowels made by a pulse train through resonators whose frequencies are set exactly (the
 *      kindest case: the source is the one the method assumes);
 *   2. the synthesizer singing vowels whose tract resonances its geometry gives
 *      (VoiceModel.transfer): a voice-like source, with breath, and folds that load the tract.
 *
 * Each is sung from a bass's low G up to a soprano's range and read the way Analyze reads
 * formants (src/analyze/formants.ts). docs/validation.md quotes this table.
 *
 * Usage: bun tools/eval/formant-truth.ts
 */
import { initEngine } from "../../tests/harness.ts";
import { OfflineVoice } from "../lib/voice.ts";
import { resample, trackPitch } from "../../src/analyze/dsp.ts";
import { steadyFormants, trackFormants } from "../../src/analyze/formants.ts";
import type { VoiceSource } from "../../src/wasm/types.ts";

const FS = 16000;

/** A pulse train at `f0` through resonators (Hz, bandwidth Hz), with a little hiss: a vowel with known formants. */
export function madeVowel(f0: number, formants: [number, number][], seconds = 0.8, hiss = 0.002): Float32Array {
  const n = Math.round(seconds * FS);
  let x = new Float64Array(n);
  for (let t = 0; t < n; t += FS / f0) x[Math.floor(t)] = 1;
  // the source falls 6 dB per octave, which the method's pre-emphasis takes out exactly
  for (let i = 1; i < n; i++) x[i] += 0.99 * x[i - 1];
  for (const [F, B] of formants) {
    const r = Math.exp((-Math.PI * B) / FS), c = 2 * r * Math.cos((2 * Math.PI * F) / FS);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = x[i] + c * (i > 0 ? y[i - 1] : 0) - r * r * (i > 1 ? y[i - 2] : 0);
    x = y;
  }
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  let seed = 7;
  return Float32Array.from(x, (v) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (0.5 * v) / peak + hiss * (seed / 2 ** 31 - 1);
  });
}

const median = (v: number[]) => v.slice().sort((a, b) => a - b)[v.length >> 1];

/** F1..F3 of a signal at 16 kHz as Analyze reads them: the middle of its voiced frames. */
export function readFormants(x: Float32Array, ceiling: number, voiced?: Float32Array): number[] {
  const hop = 160, frames = Math.floor(x.length / hop);
  const t = trackFormants(x, FS, hop, voiced ?? new Float32Array(frames).fill(1), ceiling);
  steadyFormants(t, 2);
  return [0, 1, 2].map((k) => median(Array.from({ length: frames - 30 }, (_, i) => t.f[(i + 20) * 3 + k]).filter((v) => v > 0)));
}

export const VOWELS: [string, [number, number][]][] = [
  ["EE", [[320, 60], [2100, 100], [2900, 140]]],
  ["EH", [[540, 70], [1650, 90], [2500, 120]]],
  ["AH", [[700, 80], [1100, 90], [2500, 120]]],
  ["OH", [[550, 70], [930, 80], [2500, 120]]],
  ["OO", [[430, 60], [950, 80], [2400, 120]]],
];
export const REST: [number, number][] = [[3500, 180], [4500, 250]];

const show = (e: number[][]) => ["F1", "F2", "F3"].map((n, k) => `${n} ${(e[k].reduce((a, b) => a + b, 0) / e[k].length).toFixed(1)} % (middle ${median(e[k]).toFixed(1)}, worst ${Math.max(...e[k]).toFixed(0)})`).join("   ");

if (import.meta.main) {
  console.log("1. pulse-train vowels with set formants: how far off each is read (mean; the middle and worst case)");
  const bands: [string, number[]][] = [
    ["98-196 Hz (a man's low and middle notes)", [98, 110, 123, 131, 147, 165, 175, 196]],
    ["220-349 Hz (a tenor's upper notes, a woman's middle)", [220, 247, 262, 294, 330, 349]],
    ["370-440 Hz (high tenor, belt)", [370, 392, 415, 440]],
    ["466-698 Hz (soprano)", [466, 523, 587, 659, 698]],
  ];
  for (const [name, pitches] of bands) {
    const e: number[][] = [[], [], []];
    for (const f0 of pitches)
      for (const [, F] of VOWELS) {
        // a first formant under the note itself has no harmonic near it: nothing can read it
        if (F[0][0] < 0.85 * f0) continue;
        const got = readFormants(madeVowel(f0, [...F, ...REST]), 5000);
        for (let k = 0; k < 3; k++) e[k].push(Math.abs(got[k] / F[k][0] - 1) * 100);
      }
    console.log(`   ${name}, ${e[0].length} vowels:   ${show(e)}`);
  }

  console.log("\n2. the synthesizer singing shapes whose resonances its geometry gives");
  await initEngine();
  const { VoiceModel } = await import("../../src/ui/analysis.ts");
  const { resolveShape } = await import("../../src/coach/shape.ts");
  const { BASE_SOURCE, Q } = await import("../../src/coach/lessons.ts");
  const fs = 48000;
  for (const who of ["man", "woman"] as const) {
    const body = who === "woman" ? { female: 1, child: 0 } : { female: 0, child: 0 };
    const ceiling = who === "woman" ? 5500 : 5000;
    const vm = new VoiceModel(body, fs);
    const ranges: [string, number[]][] = who === "man" ? [["98-196 Hz", [98, 110, 131, 147, 165, 196]], ["220-349 Hz", [220, 262, 294, 330]], ["370-440 Hz", [370, 392, 440]]] : [["175-262 Hz", [175, 196, 220, 262]], ["294-440 Hz", [294, 330, 392, 440]], ["466-587 Hz", [466, 494, 523, 587]]];
    for (const [name, pitches] of ranges) {
      const e: number[][] = [[], [], []];
      for (const f0 of pitches)
        for (const vowel of ["i", "ɪ", "ɛ", "æ", "ɑ", "ʌ", "o", "u"])
          for (const q of [Q.flow, Q.chest, Q.head]) {
            const artic = resolveShape(vm, vowel, undefined);
            const truth = vm.transfer(artic).formants;
            if (truth[0] < 0.85 * f0) continue;
            const v = new OfflineVoice(fs, body);
            v.setArtic(artic, true);
            v.setSource({ ...BASE_SOURCE, ...q, f0, glide: 0.005, drift: 3 } as Partial<VoiceSource>);
            v.render(0.15);
            v.gate(1);
            const x = resample(v.render(0.9), fs, FS);
            v.free();
            const pt = trackPitch(x, { fs: FS, hop: 160 });
            const got = readFormants(x, ceiling, pt.f0.subarray(0, Math.floor(x.length / 160)));
            for (let k = 0; k < 3; k++) e[k].push(Math.abs(got[k] / truth[k] - 1) * 100);
          }
      console.log(`   a ${who}, ${name}, ${e[0].length} notes:   ${show(e)}`);
    }
  }
}
