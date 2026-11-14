/**
 * The shapes the head can be drawn in for a recorded voice: every calibrated vowel of the
 * engine's tract and blends between each pair, each with the formants the engine computes for it.
 *
 * A recording's formants are measured from its sound (formants.ts). The shape drawn is the one
 * here whose formants are nearest: a shape that would give those resonances, not the shape the
 * singer made. It is an illustration of the measurement, and the app says so.
 *
 * Import only after the engine has loaded (it calls into it).
 */
import { ARTIC_KEYS, airwayModel, airwayTransfer, type ArticKey, type BodyMix, type HumanArtic } from "../wasm/engine.ts";
import { VoiceModel } from "../ui/analysis.ts";
import { resolveShape } from "../coach/shape.ts";

export interface Codebook {
  body: BodyMix;
  keys: readonly ArticKey[];
  /** how many shapes */
  n: number;
  /** articulation, [n × keys.length] */
  artic: Float32Array;
  /** F1..F3 (Hz), [n × 3] */
  formants: Float32Array;
  /** per shape: the two vowels it lies between and how far along (0 = a, 1 = b) */
  base: { a: string; b: string; t: number }[];
}

/** vowels left out: r-colouring is a tongue-tip gesture, not a sung vowel shape */
const SKIP = new Set(["ɝ"]);

/**
 * Build the shapes for a body (a fraction of a second: one transfer function each);
 * `yieldNow`, if given, is awaited now and then.
 */
export async function buildCodebook(body: BodyMix, progress?: (done: number) => void, yieldNow?: () => Promise<void>): Promise<Codebook> {
  const vm = new VoiceModel(body, 48000);
  const model = airwayModel(body, 48000);
  const vowels = vm.vowels.filter((v) => !SKIP.has(v.ipa)).map((v) => v.ipa);
  const base: Codebook["base"] = [];
  for (const v of vowels) base.push({ a: v, b: v, t: 0 });
  for (let i = 0; i < vowels.length; i++) for (let j = i + 1; j < vowels.length; j++) for (const t of [1 / 3, 2 / 3]) base.push({ a: vowels[i], b: vowels[j], t });
  const n = base.length;
  const artic = new Float32Array(n * ARTIC_KEYS.length), formants = new Float32Array(n * 3);
  for (let b = 0; b < n; b++) {
    const a: HumanArtic = resolveShape(vm, base[b].a, { toward: [base[b].b, base[b].t], set: { epilarynx: 0.1 } });
    const t = airwayTransfer(model, a);
    ARTIC_KEYS.forEach((k, i) => (artic[b * ARTIC_KEYS.length + i] = a[k]));
    for (let i = 0; i < 3; i++) formants[b * 3 + i] = t.formants[i] ?? 0;
    if (b % 64 === 63) {
      progress?.((b + 1) / n);
      if (yieldNow) await yieldNow();
    }
  }
  progress?.(1);
  // the engine keeps one model per body: it is left for the next build (and any other user of it)
  return { body, keys: ARTIC_KEYS, n, artic, formants, base };
}

/** The shape whose first two formants are nearest (in log frequency; the first counts for more, as the ear weighs it). */
export function nearestShape(cb: Codebook, F1: number, F2: number): number {
  const l1 = Math.log(F1), l2 = Math.log(F2);
  let best = 0, bd = Infinity;
  for (let b = 0; b < cb.n; b++) {
    const f1 = cb.formants[b * 3], f2 = cb.formants[b * 3 + 1];
    if (!(f1 > 0 && f2 > 0)) continue;
    const d1 = 1.6 * (Math.log(f1) - l1), d2 = Math.log(f2) - l2;
    const d = d1 * d1 + d2 * d2;
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}
