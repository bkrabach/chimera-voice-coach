/**
 * The singer beside the take: a take summed up in a few numbers, two of them compared, and a
 * live voice read a chunk at a time giving the same answer as the whole. The "singer" here is the
 * engine singing another take. Needs the wasm build (`bun run wasm`).
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { initEngine } from "./harness.ts";
import { OfflineVoice } from "../tools/lib/voice.ts";
import type { Codebook } from "../src/analyze/codebook.ts";
import type { VoiceTrack } from "../src/analyze/analyze.ts";
import type { Summary } from "../src/coach/compare.ts";

const FS = 48000;
const body = { female: 0, child: 0 };
let cb: Codebook;
let analyze: typeof import("../src/analyze/analyze.ts").analyze;
let C: typeof import("../src/coach/compare.ts");
let sung: Record<string, { x: Float32Array; note: number; track: VoiceTrack; sum: Summary }>;

beforeAll(async () => {
  await initEngine();
  const { buildCodebook } = await import("../src/analyze/codebook.ts");
  analyze = (await import("../src/analyze/analyze.ts")).analyze;
  C = await import("../src/coach/compare.ts");
  const { VoiceModel } = await import("../src/ui/analysis.ts");
  const { lessonById, HOME, REGISTER } = await import("../src/coach/lessons.ts");
  const { renderTake } = await import("../src/analyze/demo.ts");
  cb = await buildCodebook(body);
  const vm = new VoiceModel(body, FS);
  sung = {};
  for (const [lid, tid] of [["twang", "plain"], ["twang", "twang"], ["closure", "breathy"], ["closure", "clean"], ["grit", "rasp"]]) {
    const l = lessonById(lid);
    const t = l.takes.find((k) => k.id === tid)!;
    const note = HOME.male + REGISTER[l.register] + (t.semis ?? 0);
    const v = new OfflineVoice(FS, body);
    const x = renderTake(v, vm, l, t, note);
    v.free();
    const track = analyze(x, FS, cb);
    sung[`${lid}/${tid}`] = { x, note, track, sum: C.summarize(track)! };
  }
}, 120_000);

describe("the singer beside the take", () => {
  test("a pitch is compared whatever the octave", () => {
    expect(C.centsOff(57.3, 45)).toBeCloseTo(30, 5);
    expect(C.centsOff(56.8, 57)).toBeCloseTo(-20, 5);
    expect(C.centsOff(69, 57)).toBeCloseTo(0, 5);
  });

  test("a take's summary has its note, its vowel and its length", () => {
    const s = sung["twang/twang"];
    expect(Math.abs(s.sum.midi - s.note)).toBeLessThan(0.3);
    expect(s.sum.vowel.length).toBeGreaterThan(0);
    expect(s.sum.seconds).toBeGreaterThan(1.5);
  });

  test("the takes differ where their lessons say they do", () => {
    expect(sung["twang/twang"].sum.ring).toBeGreaterThan(sung["twang/plain"].sum.ring + 0.2);
    expect(sung["closure/breathy"].sum.breath).toBeGreaterThan(sung["closure/clean"].sum.breath + 0.3);
    expect(sung["closure/breathy"].sum.press).toBeLessThan(sung["closure/clean"].sum.press - 0.15);
    expect(sung["grit/rasp"].sum.grit).toBeGreaterThan(0.7);
    // a clean take reads well under the line below which grit is "none" (see NONE in compare.ts)
    expect(sung["closure/clean"].sum.grit).toBeLessThan(0.35);
    expect(sung["twang/twang"].sum.grit).toBeLessThan(0.35);
  });

  test("the advice names what is far from the take, and says when it is close", () => {
    const twang = sung["twang/twang"].sum, plain = sung["twang/plain"].sum;
    expect(C.advise(twang, plain, true).join(" ")).toMatch(/Less ring/);
    expect(C.advise(plain, twang, true).join(" ")).toMatch(/More ring/);
    expect(C.advise(twang, twang, true)).toEqual([expect.stringMatching(/^Close to the take/)]);
    expect(C.advise(sung["closure/clean"].sum, sung["closure/breathy"].sum, true).join(" ")).toMatch(/Airier than the take/);
    expect(C.advise(sung["grit/rasp"].sum, twang, true).join(" ")).toMatch(/Cleaner than the take/);
    expect(C.advise(twang, sung["grit/rasp"].sum, true).join(" ")).toMatch(/More rattle than the take/);
  });

  test("two clean voices are never told apart by grit or air: the scales read anything low down there", () => {
    // a trained singer's straight tone reads grit 0.09 and air 0.14; the synthesizer's clean takes up to 0.28 and 0.41
    const take = { ...sung["twang/twang"].sum, grit: 0.4, breath: 0.25 };
    const you = { ...take, grit: 0.03, breath: 0.02 };
    expect(C.advise(take, you, true)).toEqual([expect.stringMatching(/^Close to the take/)]);
    expect(C.advise(you, take, true)).toEqual([expect.stringMatching(/^Close to the take/)]);
    // but a singer who is airy or gritty over a clean take hears about it
    expect(C.advise(take, { ...take, breath: 0.6 }, true).join(" ")).toMatch(/Airier/);
    expect(C.advise(take, { ...take, grit: 0.75 }, true).join(" ")).toMatch(/More rattle/);
  });

  test("a held note half a semitone under is called flat; a moving take's pitch is not judged", () => {
    const t = sung["twang/twang"].sum;
    const flat = { ...t, midi: t.midi - 0.5 };
    expect(C.advise(t, flat, true).join(" ")).toMatch(/50 cents flat/);
    expect(C.advise(t, flat, false).join(" ")).not.toMatch(/flat/);
  });

  test("a live voice read in overlapping chunks gives the whole's reading", () => {
    // as the microphone does it: 1.6 s of sound every 100 ms, the last 100 ms of each left for the next
    const { x, sum } = sung["twang/twang"];
    const CHUNK = Math.round(1.6 * FS), FRAME = 480, LOOKBACK = 10;
    const g = new C.Gather();
    let last = -1;
    for (let end = Math.round(0.6 * FS); end <= x.length; end += Math.round(0.1 * FS)) {
      const e = end - (end % FRAME), s = Math.max(0, e - CHUNK);
      const t = analyze(x.subarray(s, e), FS, cb, undefined, { floorDb: -58 });
      const base = s / FRAME, final = base + t.n - 1 - LOOKBACK;
      for (let abs = Math.max(last + 1, base); abs <= final; abs++) g.push(t, abs - base);
      last = Math.max(last, final);
    }
    const live = g.summary()!;
    expect(live.seconds).toBeGreaterThan(sum.seconds - 0.4);
    for (const m of C.MEASURES) expect(Math.abs(live[m] - sum[m])).toBeLessThan(0.12);
    expect(Math.abs(live.midi - sum.midi)).toBeLessThan(0.2);
    expect(live.vowel).toBe(sum.vowel);
  });
});
