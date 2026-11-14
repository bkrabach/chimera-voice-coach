/**
 * Formants: the resonances of the vocal tract, measured from the sound by linear prediction, the
 * way Praat's "To Formant (burg)" does it (so the two can be set side by side on the same
 * recordings: tools/eval). The signal is resampled to twice the formant ceiling, pre-emphasised,
 * and in each 50 ms Gaussian window Burg's method fits an all-pole filter whose poles are the
 * resonances.
 *
 * How right it is (docs/validation.md, tools/eval/formant-truth.ts): it agrees with Praat within
 * about 1 % on real singers, and both are pulled toward the nearest harmonic. On vowels whose
 * formants are known (the synthesizer singing shapes whose resonances its geometry gives), F1 is
 * off by about 4 % up to a pitch of 200 Hz, 9 % up to 350 Hz and 15 % by 440 Hz; F2 by 2 to 6 %.
 * Above that the harmonics are too far apart to say where a resonance lies between them:
 * `VoiceTrack.sure` says where.
 *
 * Tried and not kept: fitting the all-pole filter to the harmonics' levels alone (discrete
 * all-pole modelling, El-Jaroudi & Makhoul 1991). On pulse-train vowels it was three times closer
 * (F1 off 1 to 6 % where this is off 3 to 16 %); on the synthesizer's singing it was no closer,
 * and on real singers it named the vowel a little less often (73.9 % against 75.9 %). The error
 * that is left comes from the voice's source colouring the spectrum, which no fit to the
 * spectrum can undo.
 */
import { resample } from "./dsp.ts";

export interface FormantTrack {
  /** F1..F3 (Hz) per frame, [n × 3]; 0 where there is none */
  f: Float32Array;
  /** their bandwidths (Hz), [n × 3] */
  bw: Float32Array;
}

const TWO_PI = 2 * Math.PI;

/** Burg's method: prediction coefficients a[1..order] of x[0..n) (a[0] = 1), in `a`. */
function burg(x: Float64Array, n: number, order: number, a: Float64Array, f: Float64Array, b: Float64Array, tmp: Float64Array): void {
  for (let i = 0; i < n; i++) {
    f[i] = x[i];
    b[i] = x[i];
  }
  a.fill(0);
  a[0] = 1;
  for (let m = 1; m <= order; m++) {
    let num = 0, den = 0;
    for (let i = m; i < n; i++) {
      num += f[i] * b[i - 1];
      den += f[i] * f[i] + b[i - 1] * b[i - 1];
    }
    const k = den > 1e-30 ? (-2 * num) / den : 0;
    for (let i = 1; i < m; i++) tmp[i] = a[i] + k * a[m - i];
    for (let i = 1; i < m; i++) a[i] = tmp[i];
    a[m] = k;
    for (let i = n - 1; i >= m; i--) {
      const fi = f[i];
      f[i] = fi + k * b[i - 1];
      b[i] = b[i - 1] + k * fi;
    }
  }
}

/**
 * Roots of z^p + a[1] z^(p-1) + … + a[p] (Durand–Kerner), as interleaved (re, im) in `roots`.
 * The filter is stable (Burg guarantees it), so the roots lie inside the unit circle.
 */
function polyRoots(a: Float64Array, p: number, roots: Float64Array): void {
  // start on a circle of radius 0.9, at angles that are not symmetric about the real axis
  for (let i = 0; i < p; i++) {
    const ang = (TWO_PI * i) / p + 0.4;
    roots[2 * i] = 0.9 * Math.cos(ang);
    roots[2 * i + 1] = 0.9 * Math.sin(ang);
  }
  for (let it = 0; it < 80; it++) {
    let move = 0;
    for (let i = 0; i < p; i++) {
      const zr = roots[2 * i], zi = roots[2 * i + 1];
      // the polynomial at z (Horner)
      let pr = 1, pi = 0;
      for (let k = 1; k <= p; k++) {
        const nr = pr * zr - pi * zi + a[k];
        pi = pr * zi + pi * zr;
        pr = nr;
      }
      // the product of (z − other roots)
      let dr = 1, di = 0;
      for (let j = 0; j < p; j++) {
        if (j === i) continue;
        const er = zr - roots[2 * j], ei = zi - roots[2 * j + 1];
        const nr = dr * er - di * ei;
        di = dr * ei + di * er;
        dr = nr;
      }
      const d2 = dr * dr + di * di;
      if (d2 < 1e-300) continue;
      const qr = (pr * dr + pi * di) / d2, qi = (pi * dr - pr * di) / d2;
      roots[2 * i] = zr - qr;
      roots[2 * i + 1] = zi - qi;
      move += Math.abs(qr) + Math.abs(qi);
    }
    if (move < 1e-10) break;
  }
}

/**
 * Formants of a signal (mono, at `fs`) at each frame centre `i · hop` (in samples of `fs`) where
 * `voiced[i]` is positive. `ceiling`: the highest formant frequency looked for (5000 Hz for an
 * adult man, 5500 for a woman, as in Praat's manual).
 */
export function trackFormants(x: Float32Array, fs: number, hop: number, voiced: Float32Array, ceiling: number): FormantTrack {
  const n = voiced.length;
  const out: FormantTrack = { f: new Float32Array(n * 3), bw: new Float32Array(n * 3) };
  const fsr = 2 * ceiling;
  const y = resample(x, fs, fsr);
  // pre-emphasis from 50 Hz: +6 dB per octave, so the upper formants weigh as much as the first
  const pre = Math.exp((-TWO_PI * 50) / fsr);
  for (let i = y.length - 1; i > 0; i--) y[i] -= pre * y[i - 1];
  const order = 10;
  const len = Math.round(0.05 * fsr); // Praat's "window length 0.025 s" is the Gaussian's effective half
  const win = new Float64Array(len);
  const edge = Math.exp(-12);
  for (let i = 0; i < len; i++) {
    const u = (i + 0.5) / len - 0.5;
    win[i] = (Math.exp(-48 * u * u) - edge) / (1 - edge);
  }
  const seg = new Float64Array(len), a = new Float64Array(order + 1), fb = new Float64Array(len), bb = new Float64Array(len), tmp = new Float64Array(order + 1), roots = new Float64Array(2 * order);
  const cand: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (!(voiced[i] > 0)) continue;
    const c = Math.round(((i * hop) / fs) * fsr);
    const s = c - (len >> 1);
    if (s < 0 || s + len > y.length) continue;
    for (let k = 0; k < len; k++) seg[k] = y[s + k] * win[k];
    burg(seg, len, order, a, fb, bb, tmp);
    polyRoots(a, order, roots);
    cand.length = 0;
    for (let k = 0; k < order; k++) {
      const re = roots[2 * k], im = roots[2 * k + 1];
      if (!(im > 0)) continue;
      const freq = (Math.atan2(im, re) * fsr) / TWO_PI;
      const bw = (-Math.log(Math.max(1e-9, Math.hypot(re, im))) * fsr) / Math.PI;
      if (freq > 50 && freq < ceiling - 50) cand.push([freq, bw]);
    }
    cand.sort((p, q) => p[0] - q[0]);
    for (let k = 0; k < Math.min(3, cand.length); k++) {
      out.f[i * 3 + k] = cand[k][0];
      out.bw[i * 3 + k] = cand[k][1];
    }
  }
  return out;
}

/** Median of each formant over ±r frames (voiced frames only): a pole that jumps for one frame is not the mouth moving. */
export function steadyFormants(t: FormantTrack, r: number): void {
  const n = t.f.length / 3;
  const src = t.f.slice();
  const buf: number[] = [];
  for (let k = 0; k < 3; k++) {
    for (let i = 0; i < n; i++) {
      if (!(src[i * 3 + k] > 0)) continue;
      buf.length = 0;
      for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) if (src[j * 3 + k] > 0) buf.push(src[j * 3 + k]);
      buf.sort((p, q) => p - q);
      t.f[i * 3 + k] = buf[buf.length >> 1];
    }
  }
}
