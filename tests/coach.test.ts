/** Coach's lessons are well formed: every take resolves to a posture the engine accepts, for each body. */
import { beforeAll, describe, expect, test } from "bun:test";
import { initEngine } from "./harness.ts";
import { OfflineVoice } from "../tools/lib/voice.ts";
import type { Lesson } from "../src/coach/types.ts";

let LESSONS: Lesson[];
let E: typeof import("../src/wasm/engine.ts");
let shape: typeof import("../src/coach/shape.ts");
let lessons: typeof import("../src/coach/lessons.ts");
let demo: typeof import("../src/analyze/demo.ts");
let VoiceModel: typeof import("../src/ui/analysis.ts").VoiceModel;

beforeAll(async () => {
  await initEngine();
  E = await import("../src/wasm/engine.ts");
  shape = await import("../src/coach/shape.ts");
  lessons = await import("../src/coach/lessons.ts");
  demo = await import("../src/analyze/demo.ts");
  VoiceModel = (await import("../src/ui/analysis.ts")).VoiceModel;
  LESSONS = lessons.LESSONS;
});

describe("coach lessons", () => {
  test("ids are unique and every lesson has something to aim for or compare", () => {
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(LESSONS.length);
    for (const l of LESSONS) {
      expect(new Set(l.takes.map((t) => t.id)).size).toBe(l.takes.length);
      expect(l.takes.length).toBeGreaterThanOrEqual(2);
      expect(l.what.length && l.feel.length && l.practice.length).toBeTruthy();
    }
  });

  test("every take and step resolves to a posture inside the engine's ranges, for each body", () => {
    for (const body of [{ female: 0, child: 0 }, { female: 1, child: 0 }]) {
      const vm = new VoiceModel(body, 48000);
      const known = new Set(vm.vowels.map((v) => v.ipa));
      for (const l of LESSONS) {
        expect(known.has(l.vowel)).toBe(true);
        for (const t of l.takes) {
          const shapes = [t.shape, ...(t.steps ?? []).filter((s) => s.shape).map((s) => shape.mergeShape(t.shape, s.shape))];
          for (const s of shapes) {
            if (s?.vowel) expect(known.has(s.vowel)).toBe(true);
            if (s?.toward) expect(known.has(s.toward[0])).toBe(true);
            const a = shape.resolveShape(vm, l.vowel, s);
            for (const k of E.ARTIC_KEYS) {
              expect(Number.isFinite(a[k])).toBe(true);
              expect(a[k]).toBeGreaterThanOrEqual(E.ARTIC_SPECS[k].min);
              expect(a[k]).toBeLessThanOrEqual(E.ARTIC_SPECS[k].max);
            }
          }
        }
      }
    }
  });

  test("every take sings: it makes sound, and none of it is NaN", () => {
    const body = { female: 0, child: 0 };
    const vm = new VoiceModel(body, 48000);
    for (const l of LESSONS) {
      for (const t of l.takes) {
        const v = new OfflineVoice(48000, body);
        const note = lessons.HOME.male + lessons.REGISTER[l.register] + (t.semis ?? 0);
        const x = demo.renderTake(v, vm, l, t, note, 0.7);
        v.free();
        let peak = 0;
        for (const s of x) {
          expect(Number.isNaN(s)).toBe(false);
          peak = Math.max(peak, Math.abs(s));
        }
        expect(peak).toBeGreaterThan(0.02);
      }
    }
  }, 120_000);
});
