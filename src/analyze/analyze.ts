/**
 * A recorded voice → what the singer was doing, frame by frame (every 10 ms).
 *
 * Measured directly: level, pitch, the level of each harmonic, and what lies between the
 * harmonics (noise, subharmonics). Inferred by matching: the tract shape. Each voiced frame's
 * harmonic levels are compared with the engine's transfer function for every shape in the
 * codebook, with the voice source's overall level and spectral slope left free, and the best
 * path through the candidates is taken (a mouth cannot jump between frames). The match works on
 * the harmonics as they are, so it does not need to find formant peaks, which a high note's few,
 * widely spaced harmonics do not show.
 *
 * It is an estimate from sound alone: many shapes give nearly the same resonances, and a real
 * throat is not the model's. See `VoiceTrack.fit` for how well each frame matched.
 */
import { HarmonicAnalyser, MAX_HARMONICS, medianVoiced, resample, trackPitch } from "./dsp.ts";
import type { Codebook } from "./codebook.ts";
import { vowelWord } from "./describe.ts";
import { interpret } from "./interpret.ts";

export const FS = 16000;
export const HOP = 160;

export const KIND = { silence: 0, voiced: 1, noise: 2, breath: 3 } as const;

export interface VoiceTrack {
  /** seconds per frame */
  hop: number;
  n: number;
  duration: number;
  /** tract-length factor: the singer's resonances sit at `alpha` × the model body's */
  alpha: number;
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
  /** matched codebook entry, −1 where none */
  entry: Int32Array;
  /** matched base shape (see Codebook.base), −1 where none */
  shape: Int32Array;
  /** the vowel, as an index into `vowelNames` (255: none), steadied so a held vowel keeps one name */
  vowel: Uint8Array;
  /** the vowels as a singer would spell them ("EE", "AH"…), and an IPA symbol for each */
  vowelNames: string[];
  vowelIpa: string[];
  /** articulation, [n × keys.length], smoothed; the last voiced posture is held through gaps */
  artic: Float32Array;
  /** F1..F3 of the matched shape scaled by alpha (Hz), [n × 3] */
  formants: Float32Array;
  /** how far the frame's harmonics were from the matched shape (dB rms): lower is surer */
  fit: Float32Array;
  /** the voice source's spectral slope (dB per octave; steeper = softer, breathier) */
  slope: Float32Array;
  /** first harmonic over second at the source (dB; high = light or breathy, low = pressed) */
  h1h2: Float32Array;
  /** harmonics over what lies between them, below 1.8 kHz and from there to 4.5 kHz (dB) */
  hnrLow: Float32Array;
  hnrHigh: Float32Array;
  /** how much the half-way points stand above their surroundings (dB): a subharmonic */
  sub: Float32Array;
  /** spectral centroid of unvoiced sound (Hz) */
  centroid: Float32Array;
  /** share of the harmonics' energy that lies at 2.4-3.8 kHz (dB): the band that carries over a band */
  ringDb: Float32Array;
  /** how much more of it there is than the matched vowel shape gives with an easy, speech-like source (dB) */
  ringExcess: Float32Array;
  // ---- interpreted, 0..1 (see interpret.ts)
  /** ring: how much of the sound is in the 3 kHz band, whatever makes it */
  ring: Float32Array;
  breath: Float32Array;
  press: Float32Array;
  grit: Float32Array;
  twang: Float32Array;
  /** fold weight: 0 light (head-like) … 1 heavy (chest-like) */
  weight: Float32Array;
  /** larynx offset from the singer's usual height (cm) */
  larynx: Float32Array;
  /** vibrato rate (Hz) and extent (cents each way); 0 where there is none */
  vibRate: Float32Array;
  vibExtent: Float32Array;
}

export type Progress = (stage: string, fraction: number) => void;

const TOP = 6;
const STAGE_A = 5;
const FMAX_MATCH = 5000;

/** The harmonic levels of one frame against the codebook's entries. */
class Matcher {
  private readonly idx = new Int32Array(MAX_HARMONICS);
  private readonly frac = new Float32Array(MAX_HARMONICS);
  private readonly x = new Float32Array(MAX_HARMONICS);
  private readonly w = new Float32Array(MAX_HARMONICS);
  private y: Float32Array = new Float32Array(0);
  private K = 0;
  private Sw = 0;
  private Swx = 0;
  private Swxx = 0;
  /** slope (dB/oct) and offset (dB at 1 kHz) of the last `cost` call */
  slope = 0;
  offset = 0;

  constructor(private readonly cb: Codebook) {}

  /** Set the frame: its pitch, the levels of its harmonics, and the tract-length factor. Returns the harmonics used. */
  prepare(f0: number, db: Float32Array, n: number, alpha: number): number {
    const { df, nf } = this.cb;
    let K = 0, top = -Infinity;
    for (let k = 0; k < n; k++) {
      const f = ((k + 1) * f0) / alpha;
      if (f > FMAX_MATCH || f / df >= nf - 1) break;
      const p = f / df;
      this.idx[k] = Math.floor(p);
      this.frac[k] = p - Math.floor(p);
      this.x[k] = Math.log2(((k + 1) * f0) / 1000);
      if (db[k] > top) top = db[k];
      K = k + 1;
    }
    let Sw = 0, Swx = 0, Swxx = 0;
    for (let k = 0; k < K; k++) {
      // strong harmonics count for more: a weak one's level is mostly noise
      let w = Math.max(0.12, Math.min(1, (db[k] - (top - 46)) / 30));
      if (k === 0) w *= 0.6; // the first harmonic's level is the source's as much as the tract's
      this.w[k] = w;
      Sw += w;
      Swx += w * this.x[k];
      Swxx += w * this.x[k] * this.x[k];
    }
    this.y = db;
    this.K = K;
    this.Sw = Sw;
    this.Swx = Swx;
    this.Swxx = Swxx;
    return K;
  }

  /** Mean squared distance (dB²) between the frame and an entry, with the source's level and slope fitted. */
  cost(entry: number): number {
    const { H, nf } = this.cb;
    const off = entry * nf;
    const { idx, frac, x, w, y, K, Sw, Swx, Swxx } = this;
    let Swr = 0, Swxr = 0, Swrr = 0;
    for (let k = 0; k < K; k++) {
      const i = off + idx[k];
      const r = y[k] - (H[i] + (H[i + 1] - H[i]) * frac[k]);
      const wr = w[k] * r;
      Swr += wr;
      Swxr += wr * x[k];
      Swrr += wr * r;
    }
    const den = Sw * Swxx - Swx * Swx;
    let s = den > 1e-9 ? (Sw * Swxr - Swx * Swr) / den : -9;
    // a voice source falls between about 0 and −26 dB per octave: no shape may borrow more
    if (s > 0) s = 0;
    else if (s < -26) s = -26;
    const c = (Swr - s * Swx) / Sw;
    this.slope = s;
    this.offset = c;
    const sse = Swrr - 2 * s * Swxr - 2 * c * Swr + s * s * Swxx + 2 * s * c * Swx + c * c * Sw;
    return Math.max(0, sse / Sw);
  }

  /**
   * The ring band (2.4-3.8 kHz): its share of the frame's harmonic energy (dB), and how far that
   * is above the share `entry`'s shape would have with an easy, speech-like source (one falling
   * 9.5 dB per octave). The second is the ring the singer adds, by twang or by pressing, on top
   * of what the vowel gives by itself ("ee" rings more than "oo" whoever sings it). NaN when no
   * harmonic falls in the band.
   */
  ring(entry: number): { share: number; boost: number } {
    const { H, nf } = this.cb;
    let inBand = 0, all = 0, refBand = 0, refAll = 0, cnt = 0;
    for (let k = 0; k < this.K; k++) {
      const f = 1000 * Math.pow(2, this.x[k]);
      const p = Math.pow(10, this.y[k] / 10);
      const i = entry * nf + this.idx[k];
      const ref = Math.pow(10, (H[i] + (H[i + 1] - H[i]) * this.frac[k] - 9.5 * this.x[k]) / 10);
      all += p;
      refAll += ref;
      if (f < 2400 || f > 3800) continue;
      inBand += p;
      refBand += ref;
      cnt++;
    }
    if (!cnt || !(all > 0) || !(refAll > 0)) return { share: NaN, boost: NaN };
    const share = 10 * Math.log10(inBand / all + 1e-12);
    return { share, boost: share - 10 * Math.log10(refBand / refAll + 1e-12) };
  }

  /** The source's first harmonic over its second (dB), once the entry's tract is taken out. */
  h1h2(entry: number): number {
    if (this.K < 2) return 0;
    const { H, nf } = this.cb;
    const at = (k: number) => {
      const i = entry * nf + this.idx[k];
      return this.y[k] - (H[i] + (H[i + 1] - H[i]) * this.frac[k]);
    };
    return at(0) - at(1);
  }
}

/** What a variant costs before the sound is heard (dB²): plain shapes are preferred when the fit is equal. */
const prior = (cb: Codebook, v: number): number => 0.6 * Math.abs(cb.variants[v].larynx) + 0.7 * Math.max(0, cb.variants[v].twang - 0.1);

/** Insert (cost, entry, slope) into a frame's top list (ascending by cost). */
function keep(costs: Float32Array, entries: Int32Array, slopes: Float32Array, at: number, cost: number, entry: number, slope: number): void {
  if (cost >= costs[at + TOP - 1]) return;
  let i = TOP - 1;
  while (i > 0 && costs[at + i - 1] > cost) {
    costs[at + i] = costs[at + i - 1];
    entries[at + i] = entries[at + i - 1];
    slopes[at + i] = slopes[at + i - 1];
    i--;
  }
  costs[at + i] = cost;
  entries[at + i] = entry;
  slopes[at + i] = slope;
}

export interface AnalyzeOptions {
  /** the singer's tract-length factor, when it is already known (a live voice: it is sized once, not per chunk) */
  alpha?: number;
  /** nothing quieter than this is voice (dB re full scale): a live microphone's room noise */
  floorDb?: number;
}

/** Analyse a mono recording. */
export function analyze(input: Float32Array, fsIn: number, cb: Codebook, progress?: Progress, opts: AnalyzeOptions = {}): VoiceTrack {
  progress?.("Preparing", 0);
  const x = resample(input, fsIn, FS);
  const n = Math.floor(x.length / HOP);
  const nKeys = cb.keys.length;
  const t: VoiceTrack = {
    hop: HOP / FS,
    n,
    duration: x.length / FS,
    alpha: 1,
    keys: cb.keys,
    kind: new Uint8Array(n),
    level: new Float32Array(n).fill(-120),
    f0: new Float32Array(n),
    note: new Float32Array(n),
    periodicity: new Float32Array(n),
    doubling: new Float32Array(n),
    entry: new Int32Array(n).fill(-1),
    shape: new Int32Array(n).fill(-1),
    vowel: new Uint8Array(n).fill(255),
    vowelNames: [],
    vowelIpa: [],
    artic: new Float32Array(n * nKeys),
    formants: new Float32Array(n * 3),
    fit: new Float32Array(n),
    slope: new Float32Array(n),
    h1h2: new Float32Array(n),
    hnrLow: new Float32Array(n),
    hnrHigh: new Float32Array(n),
    sub: new Float32Array(n),
    centroid: new Float32Array(n),
    ringDb: new Float32Array(n).fill(-60),
    ringExcess: new Float32Array(n),
    ring: new Float32Array(n),
    breath: new Float32Array(n),
    press: new Float32Array(n),
    grit: new Float32Array(n),
    twang: new Float32Array(n),
    weight: new Float32Array(n),
    larynx: new Float32Array(n),
    vibRate: new Float32Array(n),
    vibExtent: new Float32Array(n),
  };
  if (n === 0) return t;

  // ---- level
  const half = Math.round(0.015 * FS);
  const sq = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) sq[i + 1] = sq[i] + x[i] * x[i];
  let peak = -120;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i * HOP - half), b = Math.min(x.length, i * HOP + half);
    const db = 10 * Math.log10((sq[b] - sq[a]) / Math.max(1, b - a) + 1e-12);
    t.level[i] = db;
    if (db > peak) peak = db;
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

  // ---- harmonics of every voiced frame
  progress?.("Measuring the harmonics", 0.15);
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
  const hdb = new Float32Array(n * MAX_HARMONICS), hn = new Uint8Array(n);
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
      hn[i] = h.n;
      hdb.set(h.db.subarray(0, h.n), i * MAX_HARMONICS);
      // what lies between the harmonics, from the whole stretch (its peaks are narrow enough to
      // leave the gaps clear): hiss up high is breath, a subharmonic or noise low down is grit
      an.spectrumOf(st.buf, 0, st.periods * st.S);
      const hi = an.gaps(f0w, 1800, 4500);
      const lo = an.gaps(f0w, 0, 1800);
      t.hnrLow[i] = lo.hnr;
      t.sub[i] = lo.sub;
      // (no harmonic up there strong enough to measure against: unknown)
      t.hnrHigh[i] = hi.n ? hi.hnr : NaN;
    } else if (t.level[i] > floor) {
      an.spectrum(x, i * HOP, Math.round(0.03 * FS));
      let num = 0, den = 0;
      for (let b = 4; b <= 1024; b++) {
        num += b * an.power[b];
        den += an.power[b];
      }
      t.centroid[i] = den > 0 ? ((num / den) * FS) / 2048 : 0;
    }
  }

  // ---- the singer's tract length: the factor that lets the plain shapes fit best overall
  progress?.("Sizing the vocal tract", 0.3);
  const m = new Matcher(cb);
  const strong: number[] = [];
  for (let i = 0; i < n; i++) if (t.f0[i] > 0 && t.periodicity[i] > 0.8 && t.level[i] > loud - 22 && hn[i] >= 6) strong.push(i);
  const pick = strong.length > 320 ? strong.filter((_, i) => i % Math.ceil(strong.length / 320) === 0) : strong;
  let alpha = opts.alpha ?? 1;
  if (opts.alpha === undefined && pick.length >= 12) {
    let best = Infinity;
    for (let a = 0.82; a <= 1.241; a += 0.02) {
      let sum = 0;
      for (const i of pick) {
        m.prepare(t.f0[i], hdb.subarray(i * MAX_HARMONICS, (i + 1) * MAX_HARMONICS), hn[i], a);
        let mn = Infinity;
        for (let b = 0; b < cb.nBase; b++) {
          const c = m.cost(b * cb.nVar + cb.plain);
          if (c < mn) mn = c;
        }
        sum += Math.sqrt(mn);
      }
      if (sum < best) {
        best = sum;
        alpha = a;
      }
    }
  }
  t.alpha = alpha;

  // ---- candidates per voiced frame: the best plain shapes, then their larynx and twang variants
  progress?.("Matching mouth shapes", 0.4);
  const cCost = new Float32Array(n * TOP).fill(Infinity), cEntry = new Int32Array(n * TOP).fill(-1), cSlope = new Float32Array(n * TOP);
  const aCost = new Float32Array(STAGE_A), aBase = new Int32Array(STAGE_A);
  for (let i = 0; i < n; i++) {
    if (!(t.f0[i] > 0)) continue;
    const K = m.prepare(t.f0[i], hdb.subarray(i * MAX_HARMONICS, (i + 1) * MAX_HARMONICS), hn[i], alpha);
    if (K < 3) continue;
    aCost.fill(Infinity);
    aBase.fill(-1);
    for (let b = 0; b < cb.nBase; b++) {
      const c = m.cost(b * cb.nVar + cb.plain);
      if (c >= aCost[STAGE_A - 1]) continue;
      let j = STAGE_A - 1;
      while (j > 0 && aCost[j - 1] > c) {
        aCost[j] = aCost[j - 1];
        aBase[j] = aBase[j - 1];
        j--;
      }
      aCost[j] = c;
      aBase[j] = b;
    }
    for (let j = 0; j < STAGE_A; j++) {
      if (aBase[j] < 0) continue;
      for (let v = 0; v < cb.nVar; v++) {
        const e = aBase[j] * cb.nVar + v;
        // a small price on moving the larynx from the singer's usual height, and on twang: each must earn its place
        const c = m.cost(e) + prior(cb, v);
        keep(cCost, cEntry, cSlope, i * TOP, c, e, m.slope);
      }
    }
    if ((i & 1023) === 0) progress?.("Matching mouth shapes", 0.4 + 0.4 * (i / n));
  }

  // ---- one path through the candidates: shapes change smoothly
  progress?.("Following the movement", 0.82);
  const MOVE = 7;
  const move = [1, 1, 1, 0, 0, 0, 0.5, 1, 1, 0.5, 0, 0, 0.7, 0.8, 0, 0, 0]; // per articulator key
  const range = [2.7, 3.8, 4.4, 1, 1, 1, 2, 2.8, 1.7, 1, 1, 1, 3.2, 1, 1, 1, 1];
  const dist = (e1: number, e2: number): number => {
    let sum = 0;
    for (let k = 0; k < nKeys; k++) {
      if (!move[k]) continue;
      const d = (cb.artic[e1 * nKeys + k] - cb.artic[e2 * nKeys + k]) / range[k];
      sum += move[k] * d * d;
    }
    return Math.sqrt(sum);
  };
  // runs of matched frames; a gap of more than 150 ms starts a new one (the mouth had time to go anywhere)
  const runs: number[][] = [];
  let last = -1000;
  for (let i = 0; i < n; i++) {
    if (cEntry[i * TOP] < 0) continue;
    if (i - last > 15) runs.push([]);
    runs[runs.length - 1].push(i);
    last = i;
  }
  for (const run of runs) {
    const L = run.length;
    const acc = new Float32Array(L * TOP).fill(Infinity), back = new Int8Array(L * TOP).fill(-1);
    for (let k = 0; k < TOP; k++) acc[k] = cCost[run[0] * TOP + k];
    for (let s = 1; s < L; s++) {
      const i = run[s], pi = run[s - 1];
      for (let k = 0; k < TOP; k++) {
        const e = cEntry[i * TOP + k];
        if (e < 0) continue;
        let best = Infinity, bj = -1;
        for (let j = 0; j < TOP; j++) {
          const pa = acc[(s - 1) * TOP + j];
          if (pa === Infinity) continue;
          const c = pa + MOVE * dist(cEntry[pi * TOP + j], e);
          if (c < best) {
            best = c;
            bj = j;
          }
        }
        acc[s * TOP + k] = best + cCost[i * TOP + k];
        back[s * TOP + k] = bj;
      }
    }
    let k = 0;
    for (let j = 1; j < TOP; j++) if (acc[(L - 1) * TOP + j] < acc[(L - 1) * TOP + k]) k = j;
    for (let s = L - 1; s >= 0; s--) {
      const i = run[s];
      const e = cEntry[i * TOP + k];
      t.entry[i] = e;
      t.shape[i] = Math.floor(e / cb.nVar);
      t.fit[i] = Math.sqrt(Math.max(0, cCost[i * TOP + k] - prior(cb, e % cb.nVar)));
      t.slope[i] = cSlope[i * TOP + k];
      if (s > 0) k = back[s * TOP + k];
    }
  }

  finish(t, cb, m, hdb, hn, loud, floor);
  progress?.("Done", 1);
  return t;
}

/** Everything after the path is chosen: postures, formants, source measures, vibrato, kinds. */
function finish(t: VoiceTrack, cb: Codebook, m: Matcher, hdb: Float32Array, hn: Uint8Array, loud: number, floor: number): void {
  const n = t.n, nKeys = cb.keys.length;
  // source measures against the chosen shape
  for (let i = 0; i < n; i++) {
    const e = t.entry[i];
    if (e < 0) continue;
    m.prepare(t.f0[i], hdb.subarray(i * MAX_HARMONICS, (i + 1) * MAX_HARMONICS), hn[i], t.alpha);
    t.h1h2[i] = m.h1h2(e);
    for (let k = 0; k < 3; k++) t.formants[i * 3 + k] = cb.formants[e * 3 + k] * t.alpha;
    t.twang[i] = cb.variants[e % cb.nVar].twang;
    t.larynx[i] = cb.variants[e % cb.nVar].larynx;
    // ring: measured, and against the same shape and larynx height without twang
    const lx = cb.variants[e % cb.nVar].larynx;
    const noTwang = cb.variants.findIndex((v) => v.larynx === lx && v.twang <= 0.11);
    const r = m.ring(Math.floor(e / cb.nVar) * cb.nVar + noTwang);
    t.ringDb[i] = Number.isNaN(r.share) ? -60 : r.share;
    t.ringExcess[i] = Number.isNaN(r.boost) ? 0 : r.boost;
  }
  // postures: the matched one where voiced, held through gaps, then smoothed over 50 ms
  const raw = new Float32Array(n * nKeys);
  let lastE = -1;
  for (let i = 0; i < n; i++) if (t.entry[i] >= 0) {
    lastE = t.entry[i];
    break;
  }
  for (let i = 0; i < n; i++) {
    if (t.entry[i] >= 0) lastE = t.entry[i];
    if (lastE >= 0) for (let k = 0; k < nKeys; k++) raw[i * nKeys + k] = cb.artic[lastE * nKeys + k];
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
  smoothVoiced(t.twang, t.f0, 6);
  smoothVoiced(t.ringDb, t.f0, 4);
  smoothVoiced(t.ringExcess, t.f0, 6);
  smoothVoiced(t.larynx, t.f0, 8);
  smoothVoiced(t.slope, t.f0, 3);
  smoothVoiced(t.h1h2, t.f0, 3);
  smoothVoiced(t.hnrLow, t.f0, 3);
  for (let i = 0; i < n; i++) if (Number.isNaN(t.hnrHigh[i])) t.hnrHigh[i] = t.f0[i] > 0 ? -1000 : 0;
  smoothVoiced(t.hnrHigh, t.f0, 3);
  for (let i = 0; i < n; i++) if (t.hnrHigh[i] < -100) t.hnrHigh[i] = NaN;
  smoothVoiced(t.sub, t.f0, 3);

  nameVowels(t, cb);

  // the note's centre and the vibrato around it
  const centre = medianVoiced(t.f0, 21);
  vibrato(t, centre);

  // kinds
  for (let i = 0; i < n; i++) t.kind[i] = t.f0[i] > 0 ? KIND.voiced : t.level[i] > Math.max(floor, loud - 45) ? KIND.noise : KIND.silence;
  // an in-breath: 150 ms to 1.2 s of soft, not-hissy noise that leads into singing
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
    if (len >= 15 && len <= 120 && cen / len < 3000 && lev / len < loud - 14 && leads) for (let k = i; k < j; k++) t.kind[k] = KIND.breath;
    i = j;
  }
  interpret(t);
}

/**
 * Name each frame's vowel, steadily: neighbouring shapes take turns as the best match within one
 * held vowel, so each frame takes the name most frequent over the 200 ms around it, and a name
 * that lasts under 80 ms joins its longer neighbour.
 */
function nameVowels(t: VoiceTrack, cb: Codebook): void {
  const n = t.n;
  const names: string[] = [], ipas: string[] = [];
  const raw = new Uint8Array(n).fill(255);
  for (let i = 0; i < n; i++) {
    if (t.shape[i] < 0) continue;
    const s = cb.base[t.shape[i]];
    const ipa = s.t < 0.5 ? s.a : s.b;
    const w = vowelWord(ipa);
    let k = names.indexOf(w);
    if (k < 0) {
      k = names.length;
      names.push(w);
      ipas.push(ipa);
    }
    raw[i] = k;
  }
  const count = new Uint16Array(Math.max(1, names.length));
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
  t.vowelNames = names;
  t.vowelIpa = ipas;
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

/** Vibrato per frame from the pitch's swing around the note's centre over half a second. */
function vibrato(t: VoiceTrack, centre: Float32Array): void {
  const n = t.n, R = 25;
  const cents = new Float32Array(n);
  for (let i = 0; i < n; i++) cents[i] = t.f0[i] > 0 && centre[i] > 0 ? 1200 * Math.log2(t.f0[i] / centre[i]) : NaN;
  for (let i = 0; i < n; i++) {
    t.note[i] = centre[i];
    if (!(t.f0[i] > 0)) continue;
    const a = Math.max(0, i - R), b = Math.min(n - 1, i + R);
    let cnt = 0, mean = 0;
    for (let j = a; j <= b; j++) if (!Number.isNaN(cents[j])) {
      mean += cents[j];
      cnt++;
    }
    if (cnt < 0.85 * (b - a + 1) || cnt < 30) continue;
    mean /= cnt;
    let ss = 0, cross = 0, prev = 0;
    for (let j = a; j <= b; j++) {
      if (Number.isNaN(cents[j])) continue;
      const d = cents[j] - mean;
      ss += d * d;
      if (prev !== 0 && d !== 0 && Math.sign(d) !== Math.sign(prev)) cross++;
      if (d !== 0) prev = d;
    }
    const rate = cross / 2 / (cnt * t.hop);
    const extent = Math.sqrt((2 * ss) / cnt);
    // a regular swing between 4 and 8.5 times a second, at least an eighth of a semitone each way
    if (rate >= 4 && rate <= 8.5 && extent >= 12 && extent <= 150) {
      t.vibRate[i] = rate;
      t.vibExtent[i] = extent;
    }
  }
}
