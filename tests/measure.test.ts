/**
 * Analyze's measurements on signals whose answer is known exactly, with no engine involved: the
 * pitch of steady notes, the formants of a made-up vowel, the name given to a point in the vowel
 * space, noise between harmonics, and the scales file that tools/eval/fit.py writes. (How they do on real singers is docs/validation.md.)
 */
import { describe, expect, test } from "bun:test";
import { madeVowel, readFormants, REST, VOWELS } from "../tools/eval/formant-truth.ts";
import { nameVowel, SUNG_VOWELS } from "../src/analyze/vowels.ts";
import { HarmonicAnalyser, trackPitch } from "../src/analyze/dsp.ts";
import SCALES from "../src/analyze/scales.generated.json";

const FS = 16000;

describe("pitch", () => {
  // A perfectly steady note repeats just as well at twice and three times its period. Above
  // 330 Hz such notes read an octave or a twelfth low (466 Hz as 233, 659 as 220, 880 as 176):
  // the true period was dropped from the shortlist of candidates when some multiple of it fell
  // nearer a whole sample. And a note whose second harmonic towers over the first (a woman's mix
  // voice at 440 Hz) must not read an octave high.
  const spectra: [string, (h: number) => number][] = [
    ["falling", (h) => 1 / h],
    ["flat", () => 1],
    ["second harmonic 14 dB over the first", (h) => (h === 2 ? 3 : 0.6 / h)],
  ];
  for (const [name, amp] of spectra) {
    test(`steady notes from 110 to 1047 Hz are read within 8 cents, never an octave off (${name} spectrum)`, () => {
      for (const f0 of [110, 220, 330, 392, 440, 466, 523, 587, 659, 784, 880, 1047]) {
        const x = new Float32Array(FS);
        for (let i = 0; i < x.length; i++) {
          let s = 0;
          for (let h = 1; h * f0 < 7000; h++) s += amp(h) * Math.sin((2 * Math.PI * h * f0 * i) / FS + h);
          x[i] = 0.05 * s;
        }
        const f = Array.from(trackPitch(x, { fs: FS, hop: 160 }).f0).filter((v) => v > 0).sort((a, b) => a - b);
        expect(f.length).toBeGreaterThan(80);
        expect(Math.abs(1200 * Math.log2(f[f.length >> 1] / f0))).toBeLessThan(8);
        expect(Math.abs(1200 * Math.log2(f[0] / f0))).toBeLessThan(50);
        expect(Math.abs(1200 * Math.log2(f[f.length - 1] / f0))).toBeLessThan(50);
      }
    });
  }
});

describe("formants", () => {
  // pulse-train vowels whose formants are set exactly (tools/eval/formant-truth.ts has the whole table)
  const low = [98, 110, 131, 147];
  for (const [name, F] of VOWELS) {
    test(`${name}, on a man's low notes: F1 within 9 %, F2 within 4 %`, () => {
      for (const f0 of low) {
        const got = readFormants(madeVowel(f0, [...F, ...REST]), 5000);
        expect(Math.abs(got[0] / F[0][0] - 1)).toBeLessThan(0.09);
        expect(Math.abs(got[1] / F[1][0] - 1)).toBeLessThan(0.04);
        expect(Math.abs(got[2] / F[2][0] - 1)).toBeLessThan(0.03);
      }
    });
  }

  test("the error grows with the pitch as the harmonics thin out, and stays inside what the docs say", () => {
    const worst = (pitches: number[]) => {
      const e: number[] = [];
      for (const f0 of pitches) for (const [, F] of VOWELS) if (F[0][0] >= 0.85 * f0) e.push(Math.abs(readFormants(madeVowel(f0, [...F, ...REST]), 5000)[0] / F[0][0] - 1));
      return e.reduce((a, b) => a + b, 0) / e.length;
    };
    const lowMean = worst([98, 110, 131, 147, 175, 196]), highMean = worst([370, 392, 415, 440]);
    expect(lowMean).toBeLessThan(0.05);
    expect(highMean).toBeGreaterThan(lowMean);
    expect(highMean).toBeLessThan(0.2);
  });
});

describe("naming a sung vowel", () => {
  test("each centre is named as itself, for a man and for a woman", () => {
    SUNG_VOWELS.forEach((v, k) => {
      expect(nameVowel(v.male[0], v.male[1], 0)).toEqual({ vowel: k, near: 255 });
      expect(nameVowel(v.female[0], v.female[1], 1).vowel).toBe(k);
    });
  });

  test("a point between AH and OH is given as both; no formants, no name", () => {
    const ah = SUNG_VOWELS[2].male, oh = SUNG_VOWELS[3].male;
    const between = nameVowel(Math.sqrt(ah[0] * oh[0]) * 1.01, Math.sqrt(ah[1] * oh[1]), 0);
    expect([between.vowel, between.near].sort()).toEqual([2, 3]);
    expect(nameVowel(0, 0, 0)).toEqual({ vowel: 255, near: 255 });
  });
});

describe("noise between the harmonics", () => {
  const tone = (noise: number): Float32Array => {
    const x = new Float32Array(FS);
    let seed = 1;
    for (let i = 0; i < x.length; i++) {
      let s = 0;
      for (let h = 1; h <= 30; h++) s += Math.sin((2 * Math.PI * 200 * h * i) / FS) / h;
      seed = (seed * 1664525 + 1013904223) >>> 0;
      x[i] = 0.2 * s + noise * (seed / 2 ** 31 - 1);
    }
    return x;
  };
  // as Analyze does it: ten periods re-timed to a steady pitch, then the band from the note up to 1.5 kHz
  const read = (x: Float32Array) => {
    const an = new HarmonicAnalyser(FS, 2048);
    const st = an.steady(x, 8000, 200, () => 200, 10);
    an.spectrumOf(st.buf, 0, st.periods * st.S);
    const f0 = FS / st.S;
    return an.noiseOverHarmonics(f0, 0.5 * f0, 7.5 * f0);
  };

  test("a clean tone reads at the measure's floor, and ten times the hiss reads about 20 dB more", () => {
    const clean = read(tone(0)), a = read(tone(0.03)), b = read(tone(0.3));
    // the floor: what the analysis window itself leaks between the harmonics of a perfect tone (−34 dB)
    expect(clean).toBeLessThan(-32);
    expect(a).toBeGreaterThan(clean + 3);
    expect(Math.abs(b - a - 20)).toBeLessThan(3);
  });
});

describe("the scales fitted to real singing", () => {
  const MEASURES = ["slope", "alphaRatio", "h1h2", "spr", "ringDb", "nhrLow", "nhrHigh", "sub"];
  test("each model names measures Analyze makes, with as many numbers as measures", () => {
    for (const k of ["breath", "press", "ring", "grit"] as const) {
      const m = SCALES[k];
      expect(m.features.length).toBeGreaterThan(0);
      for (const f of m.features) expect(MEASURES).toContain(f);
      for (const v of [m.mean, m.scale, m.coef]) {
        expect(v.length).toBe(m.features.length);
        expect(v.every((x) => Number.isFinite(x))).toBe(true);
      }
      expect(m.scale.every((x) => x > 0)).toBe(true);
      // the score fit.py printed with every singer held out: a scale that cannot tell its techniques apart is not shipped
      expect(m.auc).toBeGreaterThan(0.75);
    }
  });
});
