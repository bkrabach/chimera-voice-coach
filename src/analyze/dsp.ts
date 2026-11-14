/**
 * Signal processing for Analyze: an FFT, resampling, a pitch tracker (YIN's difference function
 * with a path search over its candidates) and harmonic measurement. Plain TypeScript with no DOM,
 * so it runs in a worker and in `bun test`.
 */

/** In-place radix-2 complex FFT. */
export class FFT {
  readonly n: number;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly rev: Uint32Array;
  constructor(n: number) {
    if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`FFT size must be a power of two, got ${n}`);
    this.n = n;
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
  }
  /** Forward transform; `inverse` gives the unscaled inverse. */
  transform(re: Float64Array, im: Float64Array, inverse = false): void {
    const n = this.n, rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        const tr = re[i];
        re[i] = re[j];
        re[j] = tr;
        const ti = im[i];
        im[i] = im[j];
        im[j] = ti;
      }
    }
    const sgn = inverse ? 1 : -1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step], wi = sgn * this.sin[k * step];
          const a = start + k, b = a + half;
          const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
  }
}

export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / n);
  return w;
}

/** Mix channels to mono. */
export function toMono(channels: ArrayLike<number>[]): Float32Array {
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (const c of channels) for (let i = 0; i < n; i++) out[i] += c[i];
  if (channels.length > 1) for (let i = 0; i < n; i++) out[i] /= channels.length;
  return out;
}

/** Resample with a Hann-windowed sinc, low-passed below the lower of the two Nyquist rates. */
export function resample(x: Float32Array, fsIn: number, fsOut: number): Float32Array {
  if (fsIn === fsOut) return x.slice();
  const ratio = fsIn / fsOut;
  const fc = 0.46 * Math.min(1, fsOut / fsIn); // cycles per input sample
  const half = Math.ceil(9 / (2 * fc));
  const n = Math.floor(x.length / ratio);
  const out = new Float32Array(n);
  // the kernel on a fine table (32 steps per input sample), looked up without interpolation
  const STEPS = 32;
  const table = new Float32Array((half + 1) * STEPS + 1);
  for (let i = 0; i < table.length; i++) {
    const t = i / STEPS;
    const s = t === 0 ? 1 : Math.sin(2 * Math.PI * fc * t) / (2 * Math.PI * fc * t);
    table[i] = t >= half ? 0 : 2 * fc * s * (0.5 + 0.5 * Math.cos((Math.PI * t) / half));
  }
  for (let i = 0; i < n; i++) {
    const c = i * ratio;
    const j0 = Math.max(0, Math.ceil(c - half)), j1 = Math.min(x.length - 1, Math.floor(c + half));
    let acc = 0;
    for (let j = j0; j <= j1; j++) acc += x[j] * table[Math.round(Math.abs(j - c) * STEPS)];
    out[i] = acc;
  }
  return out;
}

// ------------------------------------------------------------------ pitch

export interface PitchOptions {
  fs: number;
  hop: number;
  fmin?: number;
  fmax?: number;
}

export interface PitchTrack {
  /** Hz per frame; 0 where unvoiced */
  f0: Float32Array;
  /** 0 (noise) … 1 (perfectly periodic) per frame */
  periodicity: Float32Array;
  /**
   * How much better the sound repeats every two periods than every one (0 when no better): the
   * mark of period doubling, a subharmonic an octave below the note.
   */
  doubling: Float32Array;
}

const MAX_CAND = 5;

/**
 * Pitch per frame. Each frame's candidates are the dips of YIN's cumulative-mean-normalised
 * difference function; a path search (Viterbi) then picks one per frame, or "unvoiced", paying
 * for pitch jumps, so a single frame cannot leap an octave on its own.
 */
export function trackPitch(x: Float32Array, o: PitchOptions): PitchTrack {
  const { fs, hop } = o;
  const fmin = o.fmin ?? 62, fmax = o.fmax ?? 1250;
  const tauMin = Math.max(2, Math.floor(fs / fmax)), tauMax = Math.ceil(fs / fmin);
  const W = Math.round(0.04 * fs); // integration window
  const N = 1 << Math.ceil(Math.log2(W + tauMax + 1));
  const fft = new FFT(N);
  const nFrames = Math.max(0, Math.floor((x.length - (W + tauMax)) / hop) + 1);
  const total = Math.floor(x.length / hop);
  const f0 = new Float32Array(total), periodicity = new Float32Array(total), doubling = new Float32Array(total);
  if (nFrames <= 0) return { f0, periodicity, doubling };

  // squared-sample prefix sums for the energy terms
  const sq = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) sq[i + 1] = sq[i] + x[i] * x[i];

  const candF = new Float32Array(nFrames * MAX_CAND), candC = new Float32Array(nFrames * MAX_CAND), candN = new Uint8Array(nFrames);
  const ar = new Float64Array(N), ai = new Float64Array(N), br = new Float64Array(N), bi = new Float64Array(N);
  const d = new Float64Array(tauMax + 2);
  for (let fr = 0; fr < nFrames; fr++) {
    const s = fr * hop;
    ar.fill(0);
    ai.fill(0);
    br.fill(0);
    bi.fill(0);
    for (let i = 0; i < W; i++) ar[i] = x[s + i];
    for (let i = 0; i < W + tauMax; i++) br[i] = x[s + i];
    fft.transform(ar, ai);
    fft.transform(br, bi);
    // cross-correlation: conj(A)·B
    for (let i = 0; i < N; i++) {
      const re = ar[i] * br[i] + ai[i] * bi[i];
      const im = ar[i] * bi[i] - ai[i] * br[i];
      ar[i] = re;
      ai[i] = im;
    }
    fft.transform(ar, ai, true);
    const e0 = sq[s + W] - sq[s];
    let run = 0;
    d[0] = 1;
    for (let tau = 1; tau <= tauMax; tau++) {
      const et = sq[s + tau + W] - sq[s + tau];
      const diff = Math.max(0, e0 + et - (2 * ar[tau]) / N);
      run += diff;
      d[tau] = run > 0 ? (diff * tau) / run : 1;
    }
    // candidates: local minima, best few
    let n = 0;
    const base = fr * MAX_CAND;
    for (let tau = Math.max(tauMin, 2); tau < tauMax; tau++) {
      if (!(d[tau] < d[tau - 1] && d[tau] <= d[tau + 1]) || d[tau] > 0.7) continue;
      // parabolic refinement
      const a = d[tau - 1], b = d[tau], c = d[tau + 1];
      const den = a - 2 * b + c;
      const off = den > 1e-12 ? (0.5 * (a - c)) / den : 0;
      const cost = b - 0.25 * (a - c) * off;
      const f = fs / (tau + off);
      if (n < MAX_CAND) {
        candF[base + n] = f;
        candC[base + n] = cost;
        n++;
      } else {
        let worst = 0;
        for (let k = 1; k < MAX_CAND; k++) if (candC[base + k] > candC[base + worst]) worst = k;
        if (cost < candC[base + worst]) {
          candF[base + worst] = f;
          candC[base + worst] = cost;
        }
      }
    }
    candN[fr] = n;
  }

  // path search: states 0..MAX_CAND-1 are the candidates, MAX_CAND is "unvoiced"
  const S = MAX_CAND + 1;
  const UNVOICED_COST = 0.42, SWITCH = 0.18, JUMP = 0.9, HIGH_BIAS = 0.035;
  const acc = new Float32Array(nFrames * S).fill(Infinity);
  const back = new Int8Array(nFrames * S).fill(-1);
  const local = (fr: number, k: number) => (k === MAX_CAND ? UNVOICED_COST : candC[fr * MAX_CAND + k] + HIGH_BIAS * Math.log2(fmax / candF[fr * MAX_CAND + k]));
  for (let k = 0; k < S; k++) if (k === MAX_CAND || k < candN[0]) acc[k] = local(0, k);
  for (let fr = 1; fr < nFrames; fr++) {
    for (let k = 0; k < S; k++) {
      if (k !== MAX_CAND && k >= candN[fr]) continue;
      const fk = k === MAX_CAND ? 0 : candF[fr * MAX_CAND + k];
      let best = Infinity, bj = -1;
      for (let j = 0; j < S; j++) {
        const pa = acc[(fr - 1) * S + j];
        if (pa === Infinity) continue;
        let tr: number;
        if (j === MAX_CAND || k === MAX_CAND) tr = j === k ? 0 : SWITCH;
        else tr = Math.min(JUMP, 2.4 * Math.abs(Math.log2(fk / candF[(fr - 1) * MAX_CAND + j])));
        if (pa + tr < best) {
          best = pa + tr;
          bj = j;
        }
      }
      acc[fr * S + k] = best + local(fr, k);
      back[fr * S + k] = bj;
    }
  }
  let k = 0;
  for (let j = 1; j < S; j++) if (acc[(nFrames - 1) * S + j] < acc[(nFrames - 1) * S + k]) k = j;
  // the analysis window starts at the frame's first sample: its centre is half a window later
  const shift = Math.round((W + tauMax / 2) / 2 / hop);
  for (let fr = nFrames - 1; fr >= 0; fr--) {
    const at = fr + shift;
    if (at < total) {
      if (k !== MAX_CAND) {
        const f = candF[fr * MAX_CAND + k], c = candC[fr * MAX_CAND + k];
        f0[at] = f;
        periodicity[at] = Math.max(0, 1 - c);
        // a candidate an octave below that repeats better than the note itself
        for (let j = 0; j < candN[fr]; j++) {
          const r = f / candF[fr * MAX_CAND + j];
          if (r > 1.88 && r < 2.12) doubling[at] = Math.max(doubling[at], c - candC[fr * MAX_CAND + j]);
        }
      } else {
        let bestC = 1;
        for (let j = 0; j < candN[fr]; j++) bestC = Math.min(bestC, candC[fr * MAX_CAND + j]);
        periodicity[at] = Math.max(0, 1 - bestC);
      }
    }
    k = back[fr * S + k];
    if (k < 0) k = MAX_CAND;
  }
  return { f0, periodicity, doubling };
}

// ------------------------------------------------------------------ harmonics

export interface Harmonics {
  /** how many harmonics were measured */
  n: number;
  /** frequency (Hz) and level (dB) of each */
  freq: Float32Array;
  db: Float32Array;
}

export const MAX_HARMONICS = 64;

/**
 * Reusable harmonic analyser. Harmonic levels are read from a window five periods long (short
 * enough to follow a moving voice). What lies between the harmonics is read from a window ten
 * periods long, whose narrower peaks leave the gaps clear.
 */
export class HarmonicAnalyser {
  private readonly fft: FFT;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly windows = new Map<number, Float64Array>();
  /** power spectrum of the last frame (bins 0..N/2) */
  readonly power: Float64Array;
  readonly out: Harmonics = { n: 0, freq: new Float32Array(MAX_HARMONICS), db: new Float32Array(MAX_HARMONICS) };

  constructor(
    readonly fs: number,
    readonly N = 2048,
  ) {
    this.fft = new FFT(N);
    this.re = new Float64Array(N);
    this.im = new Float64Array(N);
    this.power = new Float64Array(N / 2 + 1);
  }

  /** Window length (samples) for `periods` periods of a pitch, between 30 ms and the FFT size. */
  windowFor(f0: number, periods = 5): number {
    const lo = Math.round(0.03 * this.fs);
    return Math.max(lo, Math.min(this.N, Math.round((periods * this.fs) / Math.max(40, f0))));
  }

  /** The power spectrum of `len` samples centred on `centre` (Hann window, unit gain for a sine). */
  spectrum(x: Float32Array, centre: number, len: number): Float64Array {
    let w = this.windows.get(len);
    if (!w) {
      w = hann(len);
      this.windows.set(len, w);
    }
    const { re, im, N } = this;
    re.fill(0);
    im.fill(0);
    const s = Math.round(centre - len / 2);
    for (let i = 0; i < len; i++) {
      const j = s + i;
      re[i] = j >= 0 && j < x.length ? x[j] * w[i] : 0;
    }
    this.fft.transform(re, im);
    const g = 4 / (len * len); // a sine of amplitude 1 reads 0 dB
    for (let i = 0; i <= N / 2; i++) this.power[i] = (re[i] * re[i] + im[i] * im[i]) * g;
    return this.power;
  }

  private warpBuf = new Float32Array(0);

  /**
   * The stretch around `centre` re-timed so that its pitch is constant: `periods` periods of
   * exactly `S` samples each, following the pitch `f0At` gives at each sample position. A voice's
   * pitch is always moving (vibrato, slides), which smears its upper harmonics across the gaps
   * between them; after this they are steady tones, and what is left between them is noise or a
   * subharmonic. Returns the buffer (valid until the next call), S and the periods that fitted.
   */
  steady(x: Float32Array, centre: number, f0c: number, f0At: (pos: number) => number, periods: number): { buf: Float32Array; S: number; periods: number } {
    const S = Math.max(8, Math.round(this.fs / f0c));
    const P = Math.max(2, Math.min(periods, Math.floor(this.N / S)));
    const n = P * S;
    if (this.warpBuf.length < this.N) this.warpBuf = new Float32Array(this.N);
    const out = this.warpBuf;
    const half = n >> 1;
    const at = (pos: number): number => {
      // Catmull-Rom through the four samples around pos
      const i = Math.floor(pos), u = pos - i;
      if (i < 1 || i + 2 >= x.length) return i >= 0 && i < x.length ? x[i] : 0;
      const a = x[i - 1], b = x[i], c = x[i + 1], d = x[i + 2];
      return b + 0.5 * u * (c - a + u * (2 * a - 5 * b + 4 * c - d + u * (3 * (b - c) + d - a)));
    };
    // one output sample is 1/S of a period: fs / (S · f0) input samples at the pitch there
    let pos = centre;
    for (let k = half; k < n; k++) {
      out[k] = at(pos);
      pos += this.fs / (S * f0At(pos));
    }
    pos = centre;
    for (let k = half - 1; k >= 0; k--) {
      pos -= this.fs / (S * f0At(pos));
      out[k] = at(pos);
    }
    return { buf: out, S, periods: P };
  }

  /** The power spectrum of `len` samples of `buf` from `start` (Hann window, unit gain for a sine). */
  spectrumOf(buf: Float32Array, start: number, len: number): Float64Array {
    let w = this.windows.get(len);
    if (!w) {
      w = hann(len);
      this.windows.set(len, w);
    }
    const { re, im, N } = this;
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < len; i++) re[i] = buf[start + i] * w[i];
    this.fft.transform(re, im);
    const g = 4 / (len * len);
    for (let i = 0; i <= N / 2; i++) this.power[i] = (re[i] * re[i] + im[i] * im[i]) * g;
    return this.power;
  }

  /** The strongest bin within `halfWidth` Hz of `f` in the spectrum computed last (dB). */
  peakDb(f: number, halfWidth: number): number {
    const { N, fs, power } = this;
    const b0 = Math.max(1, Math.floor(((f - halfWidth) / fs) * N)), b1 = Math.min(N / 2 - 1, Math.ceil(((f + halfWidth) / fs) * N));
    let m = 0;
    for (let b = b0; b <= b1; b++) if (power[b] > m) m = power[b];
    return 10 * Math.log10(m + 1e-14);
  }

  /** Measure the harmonics of `f0` up to `fmax` in the spectrum computed last. */
  harmonics(f0: number, fmax: number): Harmonics {
    const o = this.out;
    const kmax = Math.min(MAX_HARMONICS, Math.floor(Math.min(fmax, this.fs / 2 - f0) / f0));
    o.n = Math.max(0, kmax);
    for (let k = 1; k <= kmax; k++) {
      o.freq[k - 1] = k * f0;
      o.db[k - 1] = this.peakDb(k * f0, 0.18 * f0);
    }
    return o;
  }

  /**
   * How far the harmonics between `fa` and `fb` stand above what lies between them (dB), in the
   * spectrum computed last: `hnr` against the half-way points, and `sub`, how far the half-way
   * points themselves stand above the quarter points (a subharmonic an octave down puts a peak
   * exactly half-way; noise fills the gap evenly).
   */
  gaps(f0: number, fa: number, fb: number): { hnr: number; sub: number; n: number } {
    let top = -Infinity;
    const kmax = Math.min(MAX_HARMONICS, Math.floor(Math.min(fb, this.fs / 2 - f0) / f0));
    const lev: number[] = [];
    for (let k = 1; k <= kmax + 1; k++) {
      const v = this.peakDb(k * f0, 0.1 * f0);
      lev.push(v);
      if (v > top) top = v;
    }
    let hnr = 0, sub = 0, n = 0;
    for (let k = 1; k <= kmax; k++) {
      if (k * f0 < fa) continue;
      const pair = Math.min(lev[k - 1], lev[k]);
      if (pair < top - 38) continue; // too weak to tell from the floor
      const mid = this.peakDb((k + 0.5) * f0, 0.06 * f0);
      const quarter = Math.max(this.peakDb((k + 0.27) * f0, 0.03 * f0), this.peakDb((k + 0.73) * f0, 0.03 * f0));
      hnr += pair - Math.max(mid, quarter);
      sub += mid - quarter;
      n++;
    }
    return n ? { hnr: hnr / n, sub: sub / n, n } : { hnr: 30, sub: 0, n: 0 };
  }

  /** Energy (linear) between two frequencies in the spectrum computed last. */
  band(f0: number, f1: number): number {
    const { N, fs, power } = this;
    const b0 = Math.max(1, Math.round((f0 / fs) * N)), b1 = Math.min(N / 2, Math.round((f1 / fs) * N));
    let s = 0;
    for (let b = b0; b < b1; b++) s += power[b];
    return s;
  }
}

/** Median of a small window around each sample (odd `width`); zeros are skipped. */
export function medianVoiced(x: Float32Array, width: number): Float32Array {
  const out = new Float32Array(x.length);
  const half = width >> 1;
  const buf: number[] = [];
  for (let i = 0; i < x.length; i++) {
    if (!(x[i] > 0)) continue;
    buf.length = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(x.length - 1, i + half); j++) if (x[j] > 0) buf.push(x[j]);
    buf.sort((a, b) => a - b);
    out[i] = buf[buf.length >> 1];
  }
  return out;
}
