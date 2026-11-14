/**
 * From the measurements to the four scales a singer reads, each 0..1: air, drive, ring, grit.
 *
 * Each is a logistic model over two or three measures, fitted to singing whose technique is
 * known: 20 trained singers (VocalSet) and 27 metal vocalists (EMVD). tools/eval/fit.py fits them
 * and writes scales.generated.json; docs/validation.md says how well each then tells the
 * techniques apart with the singer held out. So 0.5 on a scale means "half-way between the two
 * kinds of singing it was fitted to tell apart", for those singers: a reading is best compared
 * with other moments of the same voice.
 */
import type { VoiceTrack } from "./analyze.ts";
import SCALES from "./scales.generated.json";

interface Model {
  features: string[];
  mean: number[];
  scale: number[];
  coef: number[];
  intercept: number;
}

type Measure = "slope" | "alphaRatio" | "h1h2" | "spr" | "ringDb" | "nhrLow" | "nhrHigh" | "sub";

/** A model's reading of frame `i`, 0..1. */
function read(m: Model, t: VoiceTrack, i: number): number {
  let z = m.intercept;
  for (let k = 0; k < m.features.length; k++) z += (m.coef[k] * (t[m.features[k] as Measure][i] - m.mean[k])) / m.scale[k];
  return 1 / (1 + Math.exp(-z));
}

/** Median over ±r frames within voiced runs: a reading must last to count (a consonant's edge is not grit). */
function steady(v: Float32Array, f0: Float32Array, r: number): void {
  const src = v.slice();
  const buf: number[] = [];
  for (let i = 0; i < v.length; i++) {
    if (!(f0[i] > 0)) continue;
    buf.length = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(v.length - 1, i + r); j++) if (f0[j] > 0) buf.push(src[j]);
    buf.sort((a, b) => a - b);
    v[i] = buf[buf.length >> 1];
  }
}

export function interpret(t: VoiceTrack): void {
  const air: Model = SCALES.breath, drive: Model = SCALES.press, ring: Model = SCALES.ring, grit: Model = SCALES.grit;
  for (let i = 0; i < t.n; i++) {
    if (!(t.f0[i] > 0)) continue;
    t.press[i] = read(drive, t, i);
    t.ring[i] = read(ring, t, i);
    t.grit[i] = read(grit, t, i);
    // air and grit both put noise between the harmonics; a rasp is not breathiness, so grit takes its share
    t.breath[i] = read(air, t, i) * (1 - 0.8 * t.grit[i]);
  }
  steady(t.grit, t.f0, 4);
  steady(t.ring, t.f0, 3);
  steady(t.breath, t.f0, 3);
  steady(t.press, t.f0, 2);
  t.weight.set(t.press);
}
