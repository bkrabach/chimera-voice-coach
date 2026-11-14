/**
 * Analyze reads the engine's own singing back: notes rendered with known settings come out with
 * the right pitch, vowel and formants, and its scales (drive, grit, air), which are fitted to real
 * singers, order the engine's voices as they were sung. A tone with a known vibrato is read to
 * the cent. Needs the wasm build (`bun run wasm`). How it does on real singers: docs/validation.md.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { initEngine } from "./harness.ts";
import { OfflineVoice, concat } from "../tools/lib/voice.ts";
import type { Codebook } from "../src/analyze/codebook.ts";
import type { VoiceTrack } from "../src/analyze/analyze.ts";
import type { VoiceSource } from "../src/wasm/types.ts";

const FS = 48000;
const CLIP = 1.5;
const body = { female: 0, child: 0 };

interface Case {
  name: string;
  vowel: string;
  hz: number;
  source?: Partial<VoiceSource>;
}

let cb: Codebook;
let track: VoiceTrack;
let cases: Case[];
let vm: InstanceType<typeof import("../src/ui/analysis.ts").VoiceModel>;
let shapeOf: (ipa: string) => import("../src/wasm/engine.ts").HumanArtic;

/** the median of a measure over the middle of a case's note */
function med(name: string, pick: (t: VoiceTrack, i: number) => number): number {
  const at = cases.findIndex((c) => c.name === name);
  if (at < 0) throw new Error(`no case ${name}`);
  const f0 = Math.round(at * CLIP * 100);
  const v: number[] = [];
  for (let i = f0 + 45; i < f0 + 105; i++) if (track.f0[i] > 0 && track.shape[i] >= 0) v.push(pick(track, i));
  v.sort((a, b) => a - b);
  return v.length ? v[v.length >> 1] : NaN;
}
const word = (name: string): string => {
  const i = med(name, (t, k) => t.vowel[k]);
  return track.vowelNames[i];
};

beforeAll(async () => {
  await initEngine();
  const { buildCodebook } = await import("../src/analyze/codebook.ts");
  const { analyze } = await import("../src/analyze/analyze.ts");
  const { VoiceModel } = await import("../src/ui/analysis.ts");
  const { resolveShape } = await import("../src/coach/shape.ts");
  const { BASE_SOURCE, Q } = await import("../src/coach/lessons.ts");
  cb = await buildCodebook(body);
  vm = new VoiceModel(body, FS);
  shapeOf = (ipa) => resolveShape(vm, ipa, undefined);
  cases = [
    { name: "ee low", vowel: "i", hz: 147 },
    { name: "eh", vowel: "ɛ", hz: 196 },
    { name: "ah", vowel: "ɑ", hz: 220 },
    { name: "oh", vowel: "o", hz: 196 },
    { name: "oo", vowel: "u", hz: 220 },
    { name: "ah high", vowel: "ɑ", hz: 330 },
    { name: "falsetto", vowel: "ɑ", hz: 330, source: Q.falsetto },
    { name: "pressed", vowel: "ɑ", hz: 220, source: Q.pressed },
    { name: "edge", vowel: "ɑ", hz: 330, source: { ...Q.mix, distortion: 0.36 } },
    { name: "rasp", vowel: "ɑ", hz: 330, source: { ...Q.mix, distortion: 0.56 } },
    { name: "vibrato", vowel: "ɑ", hz: 220, source: { vibratoDepth: 40, vibratoRate: 5.5 } },
  ];
  const clips = cases.map((c) => {
    const v = new OfflineVoice(FS, body);
    v.setArtic(resolveShape(vm, c.vowel, undefined), true);
    v.setSource({ ...BASE_SOURCE, ...c.source, f0: c.hz, glide: 0.005, drift: 3 } as Partial<VoiceSource>);
    const parts = [v.render(0.2)];
    v.gate(1);
    parts.push(v.render(1.0));
    v.gate(0);
    parts.push(v.render(CLIP - 1.2));
    v.free();
    return concat(parts);
  });
  track = analyze(concat(clips), FS, cb);
}, 120_000);

describe("analyze", () => {
  test("the shapes to draw cover every calibrated vowel and the blends between them", () => {
    expect(cb.n).toBeGreaterThan(300);
    expect(cb.formants.every((x) => Number.isFinite(x) && x > 0)).toBe(true);
  });

  test("pitch is within a quarter of a semitone", () => {
    for (const c of cases) {
      const f = med(c.name, (t, i) => t.f0[i]);
      expect(Math.abs(1200 * Math.log2(f / c.hz))).toBeLessThan(25);
    }
  });

  test("vowels are named as sung", () => {
    expect(word("ee low")).toBe("EE");
    expect(word("eh")).toBe("EH");
    expect(word("ah")).toBe("AH");
    expect(word("oh")).toBe("OH");
    expect(word("oo")).toBe("OO");
  });

  test("the formants measured are the tract's own, within what linear prediction can do", () => {
    // the truth: the resonances the engine's geometry gives for the shape it sang
    for (const [name, ipa] of [["ee low", "i"], ["eh", "ɛ"], ["ah", "ɑ"], ["oh", "o"]] as const) {
      const truth = vm.transfer(shapeOf(ipa)).formants;
      const F1 = med(name, (t, i) => t.formants[i * 3]), F2 = med(name, (t, i) => t.formants[i * 3 + 1]);
      expect(Math.abs(F1 / truth[0] - 1)).toBeLessThan(0.15);
      expect(Math.abs(F2 / truth[1] - 1)).toBeLessThan(0.08);
    }
  });

  test("drive orders falsetto, an easy voice and a pressed one", () => {
    const press = (n: string) => med(n, (t, i) => t.press[i]);
    expect(press("falsetto")).toBeLessThan(0.25);
    expect(press("ah")).toBeGreaterThan(press("falsetto") + 0.1);
    expect(press("pressed")).toBeGreaterThan(0.8);
  });

  test("grit reads a rasp and an edge well above a clean note, and a vibrato is not grit", () => {
    const grit = (n: string) => med(n, (t, i) => t.grit[i]);
    expect(grit("ah high")).toBeLessThan(0.3);
    expect(grit("edge")).toBeGreaterThan(0.7);
    expect(grit("rasp")).toBeGreaterThan(0.7);
    expect(grit("ah")).toBeLessThan(0.35);
    expect(grit("vibrato")).toBeLessThan(grit("ah") + 0.1);
  });

  test("a falsetto is airier than a pressed voice", () => {
    const air = (n: string) => med(n, (t, i) => t.breath[i]);
    expect(air("falsetto")).toBeGreaterThan(0.45);
    expect(air("pressed")).toBeLessThan(0.15);
  });

  test("the engine's vibrato is read at its rate and its extent; a straight note has none", () => {
    expect(Math.abs(med("vibrato", (t, i) => t.vibRate[i]) - 5.5)).toBeLessThan(0.3);
    expect(Math.abs(med("vibrato", (t, i) => t.vibExtent[i]) - 40)).toBeLessThan(6);
    expect(med("ah", (t, i) => t.vibExtent[i])).toBe(0);
  });

  test("a tone with a known vibrato: the rate to a tenth, the extent to a tenth of its size, the centre to 5 cents", async () => {
    // the note's centre used to swing with the vibrato (a median over a window that is not a whole
    // number of swings), which made the extent read 25 to 35 % large
    const { analyze } = await import("../src/analyze/analyze.ts");
    const fs = 16000;
    for (const [rate, cents] of [[5.8, 36], [5, 100], [6.5, 80], [7.5, 25]]) {
      const x = new Float32Array(fs * 3);
      let ph = 0;
      for (let i = 0; i < x.length; i++) {
        ph += (2 * Math.PI * 220 * Math.pow(2, (cents / 1200) * Math.sin((2 * Math.PI * rate * i) / fs))) / fs;
        let v = 0;
        for (let h = 1; h <= 20; h++) v += Math.sin(h * ph) / h;
        x[i] = 0.2 * v * Math.min(1, i / 800, (x.length - i) / 800);
      }
      const t = analyze(x, fs, cb);
      const rates: number[] = [], extents: number[] = [], centres: number[] = [];
      for (let i = 0; i < t.n; i++)
        if (t.vibExtent[i] > 0) {
          rates.push(t.vibRate[i]);
          extents.push(t.vibExtent[i]);
          centres.push(Math.abs(1200 * Math.log2(t.note[i] / 220)));
        }
      const mid = (v: number[]) => v.sort((a, b) => a - b)[v.length >> 1];
      expect(rates.length).toBeGreaterThan(150);
      expect(Math.abs(mid(rates) - rate)).toBeLessThan(0.1);
      expect(Math.abs(mid(extents) / cents - 1)).toBeLessThan(0.1);
      expect(Math.max(...centres)).toBeLessThan(5);
    }
  });
});
