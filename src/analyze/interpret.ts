/**
 * From the measurements to what a singer would call them, each 0..1.
 *
 * The scales were set by analysing the engine singing with known settings
 * (`bun tools/analyze-calibrate.ts` prints the measurements beside what went in). A real voice,
 * a room and a separated stem all add their own noise, so these are relative readings (more or
 * less than elsewhere in the same recording) more than absolute ones.
 */
import type { VoiceTrack } from "./analyze.ts";

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** 0 at `a`, 1 at `b` (either order) */
export const ramp = (v: number, a: number, b: number) => clamp01((v - a) / (b - a));

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
  for (let i = 0; i < t.n; i++) {
    if (!(t.f0[i] > 0) || t.entry[i] < 0) continue;
    // How firmly the folds close, from how fast the source's harmonics fall away: a pressed voice
    // falls 2-4 dB per octave, a chest voice 4-7, an easy one 8-10, head and falsetto 11-13.
    const press = ramp(t.slope[i], -13, -2.5);
    t.press[i] = press;
    t.weight[i] = press;
    // Grit: energy between the low harmonics, whether a subharmonic (the half-way points alone)
    // or noise (everywhere). `sub` is negative when the quarter points are the louder.
    const mid = t.hnrLow[i] - Math.min(0, t.sub[i]);
    // (a soft, airy voice hisses there too, without being gritty: its part is taken off)
    t.grit[i] = ramp(mid, 22, 6) * (0.3 + 0.7 * ramp(t.slope[i], -11.5, -8.5));
    // Ring: the 3 kHz band over what this vowel gives by itself. Twang adds 3-7 dB, a firm chest
    // voice 8, both together (a belt) 10-14.
    t.ring[i] = ramp(t.ringExcess[i], 1, 13);
    // Air: a soft source, with more hiss between the upper harmonics than a clean voice has at this pitch
    // (a clean voice's upper harmonics stand 11-19 dB above what is between them; a breathy one's 8 or less)
    const hiss = Number.isFinite(t.hnrHigh[i]) ? ramp(t.hnrHigh[i], 12, 4) : 0.2;
    const soft = ramp(t.slope[i], -9.5, -13.5);
    const light = ramp(t.h1h2[i], 5, 12);
    t.breath[i] = clamp01((0.45 * soft + 0.35 * light + 0.5 * hiss) * (1 - 0.7 * t.grit[i]));
  }
  steady(t.grit, t.f0, 4);
  steady(t.ring, t.f0, 3);
  steady(t.breath, t.f0, 3);
  steady(t.press, t.f0, 2);
  t.weight.set(t.press);
}
