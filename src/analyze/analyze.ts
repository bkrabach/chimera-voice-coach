/**
 * A recorded voice → what the singer was doing, frame by frame (every 10 ms).
 *
 * Everything read here is a measurement with a standard definition, checked on real, labelled
 * singing (docs/validation.md has the numbers, tools/eval/ the checks):
 *
 *  - pitch, by YIN's difference function and a path search (dsp.ts);
 *  - formants F1..F3, by linear prediction as Praat does it (formants.ts), and from the first two
 *    the vowel, as the nearest of the five sung vowels (vowels.ts);
 *  - the harmonics' levels, from a stretch re-timed to a steady pitch, and from them the source's
 *    spectral slope (how fast the harmonics fall away, once the formants are taken out) and the
 *    singing power ratio (the 2-4 kHz band over the band below it: "ring");
 *  - what is between the harmonics (noise over harmonics, low and high; a subharmonic): breath
 *    and roughness.
 *
 * One thing is not measured: the shape of the mouth. The head is drawn in the engine shape whose
 * formants are nearest the measured ones (codebook.ts): an illustration of the measurement.
 */
import { HarmonicAnalyser, PITCH_WINDOW, medianVoiced, resample, trackPitch } from "./dsp.ts";
import { nearestShape, type Codebook } from "./codebook.ts";
import { steadyFormants, trackFormants } from "./formants.ts";
import { interpret } from "./interpret.ts";
import { nameVowel, SUNG_VOWELS } from "./vowels.ts";

export const FS = 16000;
export const HOP = 160;

/** harsh: loud sound with no steady pitch that is not a hiss (a scream, a growl) */
export const KIND = { silence: 0, voiced: 1, noise: 2, breath: 3, harsh: 4 } as const;

export interface VoiceTrack {
  /** seconds per frame */
  hop: number;
  n: number;
  duration: number;
  keys: readonly string[];
  /** KIND per frame */
  kind: Uint8Array;
  /** dB re full scale */
  level: Float32Array;
  /** Hz; 0 where unvoiced */
  f0: Float32Array;
  /** Hz: the note's centre (vibrato smoothed out); 0 where unvoiced */
  note: Float32Array;
  periodicity: Float32Array;
  /** how much better the sound repeats every two periods than every one (see PitchTrack.doubling) */
  doubling: Float32Array;
  /** F1..F3 as measured (Hz), [n × 3]; 0 where there is none */
  formants: Float32Array;
  /**
   * How far the pitch lets the formants be read, 0..1: 1 up to 500 Hz, falling to 0 at 700 Hz,
   * where the harmonics are too far apart to show the first formant. The vowel and the shape
   * drawn are no surer than this.
   */
  sure: Float32Array;
  /** the vowel, as an index into `vowelNames` (255: none), steadied so a held vowel keeps one name */
  vowel: Uint8Array;
  /** the next nearest vowel when the formants sit between two (255 otherwise) */
  vowelNear: Uint8Array;
  /** the five sung vowels as a singer would spell them ("EE", "AH"…), and an IPA symbol for each */
  vowelNames: string[];
  vowelIpa: string[];
  /** the shape drawn (see Codebook), −1 where nothing is sung */
  shape: Int32Array;
  /** its articulation, [n × keys.length], smoothed; the last sung posture is held through gaps */
  artic: Float32Array;
  /** the voice source's spectral slope (dB per octave; steeper = softer, breathier) */
  slope: Float32Array;
  /** first harmonic over second at the source (dB; high = light or breathy, low = pressed) */
  h1h2: Float32Array;
  /** alpha ratio (dB): the harmonics' energy at 1-5 kHz over their energy below 1 kHz (the usual measure of spectral balance) */
  alphaRatio: Float32Array;
  /** singing power ratio (dB): the strongest harmonic at 2-4 kHz over the strongest below 2 kHz */
  spr: Float32Array;
  /** share of the harmonics' energy that lies at 2.4-3.8 kHz (dB) */
  ringDb: Float32Array;
  /** noise over harmonics (dB) below 1.5 kHz and from there to 5 kHz: 0 is as much noise as tone */
  nhrLow: Float32Array;
  nhrHigh: Float32Array;
  /** how much the half-way points between the low harmonics stand above their surroundings (dB): a subharmonic */
  sub: Float32Array;
  /** spectral centroid of unvoiced sound (Hz) */
  centroid: Float32Array;
  // ---- the scales, 0..1 (see interpret.ts)
  /** ring: how much of the sound is in the 2-4 kHz band, whatever makes it */
  ring: Float32Array;
  breath: Float32Array;
  /** how hard the voice is driven: light … firm … pressed (from the source's slope) */
  press: Float32Array;
  grit: Float32Array;
  /** the same as `press` (kept for older callers) */
  weight: Float32Array;
  /** vibrato rate (Hz) and extent (cents each way); 0 where there is none */
  vibRate: Float32Array;
  vibExtent: Float32Array;
}

export type Progress = (stage: string, fraction: number) => void;

export interface AnalyzeOptions {
  /** nothing quieter than this is voice (dB re full scale): a live microphone's room noise */
  floorDb?: number;
}

/** a frame that was sung: it has a pitch and a shape */
export const isSung = (t: VoiceTrack, i: number): boolean => t.f0[i] > 0 && t.shape[i] >= 0;

/** harmonics above this are left out of the source's slope (Hz) */
const FMAX_SOURCE = 4000;

/** The gain (dB) of one resonance at `f`: a two-pole resonator with centre `F` and bandwidth `B`. */
function resonance(f: number, F: number, B: number): number {
  const h = (B * B) / 4;
  return 10 * Math.log10(((F * F + h) * (F * F + h)) / (((F - f) * (F - f) + h) * ((F + f) * (F + f) + h)));
}

/** Analyse a mono recording. */
export function analyze(input: Float32Array, fsIn: number, cb: Codebook, progress?: Progress, opts: AnalyzeOptions = {}): VoiceTrack {
  progress?.("Preparing", 0);
  const x = resample(input, fsIn, FS);
  const n = Math.floor(x.length / HOP);
  const nKeys = cb.keys.length;
  const z = () => new Float32Array(n);
  const t: VoiceTrack = {
    hop: HOP / FS,
    n,
    duration: x.length / FS,
    keys: cb.keys,
    kind: new Uint8Array(n),
    level: z().fill(-120),
    f0: z(),
    note: z(),
    periodicity: z(),
    doubling: z(),
    formants: new Float32Array(n * 3),
    sure: z(),
    vowel: new Uint8Array(n).fill(255),
    vowelNear: new Uint8Array(n).fill(255),
    vowelNames: SUNG_VOWELS.map((v) => v.name),
    vowelIpa: SUNG_VOWELS.map((v) => v.ipa),
    shape: new Int32Array(n).fill(-1),
    artic: new Float32Array(n * nKeys),
    slope: z(),
    h1h2: z(),
    alphaRatio: z().fill(-30),
    spr: z().fill(-40),
    ringDb: z().fill(-60),
    nhrLow: z().fill(-30),
    nhrHigh: z().fill(-30),
    sub: z(),
    centroid: z(),
    ring: z(),
    breath: z(),
    press: z(),
    grit: z(),
    weight: z(),
    vibRate: z(),
    vibExtent: z(),
  };
  if (n === 0) return t;

  // ---- level
  const half = Math.round(0.015 * FS);
  const sq = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) sq[i + 1] = sq[i] + x[i] * x[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i * HOP - half), b = Math.min(x.length, i * HOP + half);
    t.level[i] = 10 * Math.log10((sq[b] - sq[a]) / Math.max(1, b - a) + 1e-12);
  }
  // "loud" for this recording: the level its louder frames reach
  const sorted = Array.from(t.level).sort((a, b) => a - b);
  const loud = sorted[Math.floor(sorted.length * 0.95)];
  const floor = Math.max(-72, loud - 50, opts.floorDb ?? -Infinity);

  // ---- pitch
  progress?.("Finding the pitch", 0.05);
  const pt = trackPitch(x, { fs: FS, hop: HOP });
  t.periodicity.set(pt.periodicity.subarray(0, n));
  t.doubling.set(pt.doubling.subarray(0, n));
  for (let i = 0; i < n; i++) t.f0[i] = t.level[i] > floor ? pt.f0[i] : 0;
  // a voiced run shorter than 40 ms is a blip, not a note
  for (let i = 0; i < n; ) {
    if (!(t.f0[i] > 0)) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && t.f0[j] > 0) j++;
    if (j - i < 4) for (let k = i; k < j; k++) t.f0[k] = 0;
    i = j;
  }

  // ---- formants, by linear prediction (the ceiling follows the body: 5000 Hz for a man, 5500 for a woman)
  progress?.("Measuring the formants", 0.15);
  const ceiling = 5000 + 500 * Math.max(0, Math.min(1, cb.body.female)) + 1000 * Math.max(0, Math.min(1, cb.body.child));
  const ft = trackFormants(x, FS, HOP, t.f0, ceiling);
  steadyFormants(ft, 2);
  t.formants.set(ft.f);

  // ---- the harmonics of every voiced frame, and what lies between them
  progress?.("Measuring the harmonics", 0.4);
  const an = new HarmonicAnalyser(FS, 2048);
  // the pitch at a sample position: between the frames' pitches, but never across a leap or into silence
  let f0Here = 100;
  const f0At = (pos: number): number => {
    const p = pos / HOP, a = Math.floor(p);
    const fa = a >= 0 && a < n ? t.f0[a] : 0, fb = a + 1 >= 0 && a + 1 < n ? t.f0[a + 1] : 0;
    if (fa > 0 && fb > 0 && Math.abs(Math.log2(fa / fb)) < 0.25) return fa + (fb - fa) * (p - a);
    const near = p - a < 0.5 ? fa || fb : fb || fa;
    return near > 0 && Math.abs(Math.log2(near / f0Here)) < 0.4 ? near : f0Here;
  };
  // the tract's upper resonances, about a thousand hertz apart (scaled with the formant ceiling):
  // left out, the resonance model falls away far faster above 2 kHz than a voice does
  const spacing = ceiling / 5;
  for (let i = 0; i < n; i++) {
    if (t.f0[i] > 0) {
      const f0 = t.f0[i];
      f0Here = f0;
      // the stretch around the frame, re-timed to a steady pitch: ten periods of it
      const st = an.steady(x, i * HOP, f0, f0At, 10);
      const f0w = FS / st.S; // the pitch of the re-timed stretch
      // harmonic levels from its middle five periods (short enough to follow a moving mouth)
      const mid = Math.min(5, st.periods);
      an.spectrumOf(st.buf, ((st.periods - mid) >> 1) * st.S, mid * st.S);
      const h = an.harmonics(f0w, FS / 2 - 200);
      // what lies between the harmonics, from the whole stretch (its peaks are narrow enough to leave the gaps clear)
      an.spectrumOf(st.buf, 0, st.periods * st.S);
      // (the bands meet half-way between two harmonics: a strong harmonic just under an edge would
      // otherwise spill its skirt over it and be counted as the upper band's noise)
      const split = (Math.max(1, Math.floor(1500 / f0w)) + 0.5) * f0w, upper = (Math.max(2, Math.floor(5000 / f0w)) + 0.5) * f0w;
      const lo = an.noiseOverHarmonics(f0w, 0.5 * f0w, split), hi = an.noiseOverHarmonics(f0w, split, upper);
      t.nhrLow[i] = Number.isFinite(lo) ? lo : -30;
      t.nhrHigh[i] = Number.isFinite(hi) ? hi : t.nhrLow[i];
      t.sub[i] = an.gaps(f0w, 0, 1800).sub;

      // ---- the source's slope: the harmonics' levels with the measured formants taken out
      const F1 = ft.f[i * 3] || 500, F2 = ft.f[i * 3 + 1] || 1500, F3 = ft.f[i * 3 + 2] || 2500;
      let top = -Infinity, topLow = -Infinity, topRing = -Infinity, all = 0, band = 0, below = 0, above = 0;
      for (let k = 0; k < h.n; k++) {
        const f = (k + 1) * f0, p = Math.pow(10, h.db[k] / 10);
        if (h.db[k] > top) top = h.db[k];
        if (f < 2000) topLow = Math.max(topLow, h.db[k]);
        else if (f < 4000) topRing = Math.max(topRing, h.db[k]);
        if (f < 5000) all += p;
        if (f >= 2400 && f <= 3800) band += p;
        if (f < 1000) below += p;
        else if (f < 5000) above += p;
      }
      if (topRing > -Infinity && topLow > -Infinity) t.spr[i] = topRing - topLow;
      if (all > 0 && band > 0) t.ringDb[i] = 10 * Math.log10(band / all);
      if (below > 0 && above > 0) t.alphaRatio[i] = 10 * Math.log10(above / below);
      let Sw = 0, Swx = 0, Swxx = 0, Swr = 0, Swxr = 0, r1 = NaN, r2 = NaN;
      for (let k = 0; k < h.n; k++) {
        const f = (k + 1) * f0;
        if (f > FMAX_SOURCE) break;
        let tract = resonance(f, F1, 60 + 0.04 * F1) + resonance(f, F2, 90 + 0.02 * F2) + resonance(f, F3, 150);
        for (let u = 1; u <= 8; u++) tract += resonance(f, Math.max(F3 + 600, 0.7 * ceiling) + (u - 1) * spacing, 200 + 50 * u);
        // a harmonic sitting right on a formant: how tall the peak is depends on a bandwidth that
        // is not measured, so no more than 14 dB of lift is taken out
        const r = h.db[k] - Math.min(14, tract);
        if (k === 0) r1 = r;
        if (k === 1) r2 = r;
        // a harmonic far below the strongest is mostly noise: it says little about the slope. And
        // the first harmonic is the source's own (a breathy voice lifts it alone): it is left out
        // when there are enough others
        let w = h.db[k] > top - 30 ? 1 : 0.2;
        if (k === 0 && f0 * 5 < FMAX_SOURCE) w = 0;
        const xk = Math.log2(f / 1000);
        Sw += w;
        Swx += w * xk;
        Swxx += w * xk * xk;
        Swr += w * r;
        Swxr += w * r * xk;
      }
      const den = Sw * Swxx - Swx * Swx;
      t.slope[i] = den > 1e-9 ? Math.max(-30, Math.min(6, (Sw * Swxr - Swx * Swr) / den)) : -9;
      t.h1h2[i] = Number.isFinite(r1) && Number.isFinite(r2) ? r1 - r2 : 0;
      // the vowel can be named up to about 550 Hz (checked on real singers); above that the harmonics are too far apart
      t.sure[i] = Math.max(0, Math.min(1, (700 - f0) / 150));
      if (ft.f[i * 3] > 0 && ft.f[i * 3 + 1] > 0) t.shape[i] = nearestShape(cb, ft.f[i * 3], ft.f[i * 3 + 1]);
    } else if (t.level[i] > floor) {
      an.spectrum(x, i * HOP, Math.round(0.03 * FS));
      let num = 0, den = 0;
      for (let b = 4; b <= 1024; b++) {
        num += b * an.power[b];
        den += an.power[b];
      }
      t.centroid[i] = den > 0 ? ((num / den) * FS) / 2048 : 0;
    }
    if ((i & 2047) === 0) progress?.("Measuring the harmonics", 0.4 + 0.5 * (i / n));
  }

  finish(t, cb, loud, floor);
  progress?.("Done", 1);
  return t;
}

/** Everything after the measuring: postures, vowel names, vibrato, kinds, and the scales. */
function finish(t: VoiceTrack, cb: Codebook, loud: number, floor: number): void {
  const n = t.n, nKeys = cb.keys.length;
  // postures: the nearest shape where sung, held through gaps, then smoothed over 70 ms
  const raw = new Float32Array(n * nKeys);
  let last = -1;
  for (let i = 0; i < n; i++)
    if (t.shape[i] >= 0) {
      last = t.shape[i];
      break;
    }
  for (let i = 0; i < n; i++) {
    if (t.shape[i] >= 0) last = t.shape[i];
    if (last >= 0) for (let k = 0; k < nKeys; k++) raw[i * nKeys + k] = cb.artic[last * nKeys + k];
  }
  const R = 3;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - R), b = Math.min(n - 1, i + R);
    for (let k = 0; k < nKeys; k++) {
      let s = 0;
      for (let j = a; j <= b; j++) s += raw[j * nKeys + k];
      t.artic[i * nKeys + k] = s / (b - a + 1);
    }
  }
  for (const v of [t.slope, t.h1h2, t.nhrLow, t.nhrHigh, t.sub, t.spr, t.ringDb, t.alphaRatio]) smoothVoiced(v, t.f0, 3);

  nameVowels(t, cb);

  // the note's centre and the vibrato around it
  vibrato(t);

  // kinds
  for (let i = 0; i < n; i++) t.kind[i] = t.f0[i] > 0 ? KIND.voiced : t.level[i] > Math.max(floor, loud - 45) ? KIND.noise : KIND.silence;
  for (let i = 0; i < n; ) {
    if (t.kind[i] !== KIND.noise) {
      i++;
      continue;
    }
    let j = i, cen = 0, lev = 0;
    while (j < n && t.kind[j] === KIND.noise) {
      cen += t.centroid[j];
      lev += t.level[j];
      j++;
    }
    const len = j - i;
    let leads = false;
    for (let k = j; k < Math.min(n, j + 30); k++) if (t.kind[k] === KIND.voiced) leads = true;
    // an in-breath: 150 ms to 1.2 s of soft, not-hissy noise that leads into singing
    if (len >= 15 && len <= 120 && cen / len < 3000 && lev / len < loud - 14 && leads) for (let k = i; k < j; k++) t.kind[k] = KIND.breath;
    // a harsh sound: at least 120 ms as loud as the singing, with no steady pitch and not a hiss
    else if (len >= 12 && cen / len < 3200 && lev / len > loud - 14) for (let k = i; k < j; k++) t.kind[k] = KIND.harsh;
    i = j;
  }
  interpret(t);
}

/**
 * Name each frame's vowel, steadily: the formants wander a little within one held vowel, so each
 * frame takes the name most frequent over the 200 ms around it, and a name that lasts under
 * 80 ms joins its longer neighbour.
 */
function nameVowels(t: VoiceTrack, cb: Codebook): void {
  const n = t.n;
  const female = Math.max(0, Math.min(1, cb.body.female + cb.body.child));
  const raw = new Uint8Array(n).fill(255), near = new Uint8Array(n).fill(255);
  for (let i = 0; i < n; i++) {
    if (t.shape[i] < 0) continue;
    const v = nameVowel(t.formants[i * 3], t.formants[i * 3 + 1], female);
    raw[i] = v.vowel;
    near[i] = v.near;
  }
  const count = new Uint16Array(SUNG_VOWELS.length);
  const R = 10;
  for (let i = 0; i < n; i++) {
    if (raw[i] === 255) continue;
    count.fill(0);
    let best = raw[i];
    for (let j = Math.max(0, i - R); j <= Math.min(n - 1, i + R); j++) {
      const v = raw[j];
      if (v === 255) continue;
      // nearer frames count for more
      count[v] += R + 1 - Math.abs(j - i);
      if (count[v] > count[best]) best = v;
    }
    t.vowel[i] = best;
    // "between two" only if this frame said so of the same pair
    t.vowelNear[i] = raw[i] === best ? near[i] : near[i] === best ? raw[i] : 255;
  }
  for (let i = 0; i < n; ) {
    if (t.vowel[i] === 255) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && t.vowel[j] === t.vowel[i]) j++;
    if (j - i < 8) {
      const before = i > 0 ? t.vowel[i - 1] : 255, after = j < n ? t.vowel[j] : 255;
      const to = before !== 255 ? before : after;
      if (to !== 255) for (let k = i; k < j; k++) t.vowel[k] = to;
    }
    i = j;
  }
}

/** Moving average over ±r frames, within voiced runs only. */
function smoothVoiced(v: Float32Array, f0: Float32Array, r: number): void {
  const src = v.slice();
  for (let i = 0; i < v.length; i++) {
    if (!(f0[i] > 0)) continue;
    let s = 0, c = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(v.length - 1, i + r); j++) {
      if (f0[j] > 0) {
        s += src[j];
        c++;
      }
    }
    v[i] = s / c;
  }
}

/**
 * Vibrato per frame, and the note's centre. Over the 700 ms around the frame the pitch (in cents,
 * with its slow drift taken out) must repeat itself at a period between 1/8 and 1/4.5 of a
 * second: its autocorrelation there at least 0.5. A pitch that merely wanders, or steps from note
 * to note, does not. The extent is the swing's size, each way. Where there is vibrato the note's
 * centre is the mean pitch over two whole swings (which cancels the swing exactly); elsewhere it
 * is the middle pitch of the 0.4 s around the frame.
 */
function vibrato(t: VoiceTrack): void {
  const n = t.n, R = 35;
  const dt = t.hop;
  const centre = medianVoiced(t.f0, 21);
  const cents = new Float32Array(n);
  for (let i = 0; i < n; i++) cents[i] = t.f0[i] > 0 ? 1200 * Math.log2(t.f0[i] / 440) : NaN;
  // drift out: the mean over a quarter of a second (longer than any vibrato's period)
  const flat = new Float32Array(n).fill(NaN);
  const D = 12;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(cents[i])) continue;
    let s = 0, c = 0;
    for (let j = Math.max(0, i - D); j <= Math.min(n - 1, i + D); j++)
      if (!Number.isNaN(cents[j])) {
        s += cents[j];
        c++;
      }
    flat[i] = cents[i] - s / c;
  }
  const lagMin = Math.round(1 / 8 / dt), lagMax = Math.round(1 / 4.5 / dt);
  const len = 2 * R + 1;
  const buf = new Float32Array(len);
  for (let i = 0; i < n; i++) {
    t.note[i] = centre[i];
    if (!(t.f0[i] > 0)) continue;
    const a = i - R, b = i + R;
    if (a < 0 || b >= n) continue;
    let ok = true, ss = 0;
    for (let j = a; j <= b; j++) {
      const v = flat[j];
      if (Number.isNaN(v)) {
        ok = false;
        break;
      }
      buf[j - a] = v;
      ss += v * v;
    }
    if (!ok || !(ss > 0)) continue;
    let best = 0, bestLag = 0;
    const rs = new Float32Array(lagMax + 2);
    for (let lag = lagMin - 1; lag <= lagMax + 1; lag++) {
      let num = 0, e1 = 0, e2 = 0;
      for (let j = 0; j + lag < len; j++) {
        num += buf[j] * buf[j + lag];
        e1 += buf[j] * buf[j];
        e2 += buf[j + lag] * buf[j + lag];
      }
      rs[lag] = num / Math.sqrt(e1 * e2 + 1e-9);
      if (lag >= lagMin && lag <= lagMax && rs[lag] > best) {
        best = rs[lag];
        bestLag = lag;
      }
    }
    if (best < 0.5) continue;
    // the period to a fraction of a frame: the top of a parabola through the best lag and its neighbours
    const y0 = rs[bestLag - 1], y1 = rs[bestLag], y2 = rs[bestLag + 1];
    const den = y0 - 2 * y1 + y2;
    const period = bestLag + (den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den)) : 0);
    // taking the drift out as a mean over W frames leaves a swing of period P larger by 1 − sinc(W/P): undo it
    // and each pitch estimate is a mean over the tracker's window, which shrinks the swing by sinc(window/P)
    const w = (Math.PI * (2 * D + 1)) / period, u = (Math.PI * PITCH_WINDOW) / (period * dt);
    const extent = Math.sqrt((2 * ss) / len) / (1 - Math.sin(w) / w) / (Math.sin(u) / u);
    if (extent < 15 || extent > 200) continue;
    t.vibRate[i] = 1 / (period * dt);
    t.vibExtent[i] = extent;
    // the centre: the mean over two whole swings (the ends weighted for the fraction of a frame)
    const half = period, k = Math.floor(half);
    let s = cents[i], c = 1;
    for (let j = 1; j <= k + 1; j++) {
      const wj = j <= k ? 1 : half - k;
      s += wj * (cents[i - j] + cents[i + j]);
      c += 2 * wj;
    }
    t.note[i] = 440 * Math.pow(2, s / c / 1200);
  }
}
