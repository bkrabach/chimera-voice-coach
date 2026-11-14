/**
 * Analyze reads the engine's own singing back: notes rendered with known settings come out with
 * the right pitch and vowel, and its scales (closure, grit, air, vibrato) order them as sung.
 * Needs the wasm build (`bun run wasm`).
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

/** the median of a measure over the middle of a case's note */
function med(name: string, pick: (t: VoiceTrack, i: number) => number): number {
  const at = cases.findIndex((c) => c.name === name);
  if (at < 0) throw new Error(`no case ${name}`);
  const f0 = Math.round(at * CLIP * 100);
  const v: number[] = [];
  for (let i = f0 + 45; i < f0 + 105; i++) if (track.f0[i] > 0 && track.entry[i] >= 0) v.push(pick(track, i));
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
  const vm = new VoiceModel(body, FS);
  cases = [
    { name: "ee low", vowel: "i", hz: 147 },
    { name: "ah", vowel: "ɑ", hz: 220 },
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
  test("the codebook has every calibrated vowel, blended and varied", () => {
    expect(cb.nBase).toBeGreaterThan(300);
    expect(cb.nVar).toBe(15);
    expect(cb.H.every((x) => Number.isFinite(x))).toBe(true);
  });

  test("pitch is within a quarter of a semitone", () => {
    for (const c of cases) {
      const f = med(c.name, (t, i) => t.f0[i]);
      expect(Math.abs(1200 * Math.log2(f / c.hz))).toBeLessThan(25);
    }
  });

  test("vowels are named as sung", () => {
    expect(word("ee low")).toBe("EE");
    expect(word("oo")).toBe("OO");
    expect(["AH", "AW", "UH"]).toContain(word("ah"));
  });

  test("closure orders falsetto, an easy voice and a pressed one", () => {
    const press = (n: string) => med(n, (t, i) => t.press[i]);
    expect(press("falsetto")).toBeLessThan(0.25);
    expect(press("ah")).toBeGreaterThan(press("falsetto") + 0.1);
    expect(press("pressed")).toBeGreaterThan(0.8);
  });

  test("grit reads rasp over edge over clean, and a vibrato is not grit", () => {
    const grit = (n: string) => med(n, (t, i) => t.grit[i]);
    expect(grit("ah high")).toBeLessThan(0.08);
    expect(grit("edge")).toBeGreaterThan(0.2);
    expect(grit("rasp")).toBeGreaterThan(grit("edge"));
    expect(grit("vibrato")).toBeLessThan(0.08);
  });

  test("a falsetto is airier than a pressed voice", () => {
    const air = (n: string) => med(n, (t, i) => t.breath[i]);
    expect(air("falsetto")).toBeGreaterThan(0.45);
    expect(air("pressed")).toBeLessThan(0.15);
  });

  test("vibrato's rate and extent are measured", () => {
    expect(Math.abs(med("vibrato", (t, i) => t.vibRate[i]) - 5.5)).toBeLessThan(0.8);
    const extent = med("vibrato", (t, i) => t.vibExtent[i]);
    expect(extent).toBeGreaterThan(25);
    expect(extent).toBeLessThan(60);
    expect(med("ah", (t, i) => t.vibExtent[i])).toBe(0);
  });
});
