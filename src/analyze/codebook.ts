/**
 * The shapes a recorded voice is matched against: several thousand postures of the engine's
 * vocal tract (every calibrated vowel, blends between each pair, each at several larynx heights
 * and twang settings), with the transfer function the engine computes for each.
 *
 * Import only after the engine has loaded (it calls into it).
 */
import { ARTIC_KEYS, airwayModel, airwayTransfer, type ArticKey, type BodyMix, type HumanArtic } from "../wasm/engine.ts";
import { VoiceModel } from "../ui/analysis.ts";
import { resolveShape } from "../coach/shape.ts";

export interface Variant {
  /** larynx offset from the vowel's own height (cm) */
  larynx: number;
  /** epilarynx narrowing 0..1 */
  twang: number;
}

export interface Codebook {
  body: BodyMix;
  keys: readonly ArticKey[];
  /** the transfer functions' frequency grid: 0, df, 2·df … (Hz) */
  df: number;
  nf: number;
  nBase: number;
  nVar: number;
  /** transfer function (dB), [entry × nf]; entry = base · nVar + variant */
  H: Float32Array;
  /** articulation, [entry × keys.length] */
  artic: Float32Array;
  /** F1..F3 (Hz), [entry × 3] */
  formants: Float32Array;
  /** per base shape: the two vowels it lies between and how far along (0 = a, 1 = b) */
  base: { a: string; b: string; t: number }[];
  variants: Variant[];
  /** the variant with the vowel's own larynx height and no twang */
  plain: number;
}

export const CB_DF = 25;
export const CB_FMAX = 5500;

const LARYNX = [-0.9, -0.45, 0, 0.45, 0.9];
const TWANG = [0.1, 0.5, 0.9];
/** vowels left out: r-colouring is a tongue-tip gesture, not a sung vowel shape */
const SKIP = new Set(["ɝ"]);

/** Sample a transfer function given on log-spaced frequencies onto the linear grid. */
function toGrid(freqs: number[], db: number[], out: Float32Array, at: number, nf: number): void {
  let j = 0;
  for (let i = 0; i < nf; i++) {
    const f = Math.max(freqs[0], i * CB_DF);
    while (j < freqs.length - 2 && freqs[j + 1] < f) j++;
    const u = Math.min(1, Math.max(0, (Math.log(f) - Math.log(freqs[j])) / (Math.log(freqs[j + 1]) - Math.log(freqs[j]))));
    out[at + i] = db[j] + (db[j + 1] - db[j]) * u;
  }
}

/**
 * Build the codebook for a body. Takes a few seconds (one transfer function per entry);
 * `progress` is called with 0..1, and `yieldNow`, if given, is awaited between batches.
 */
export async function buildCodebook(body: BodyMix, progress?: (done: number) => void, yieldNow?: () => Promise<void>): Promise<Codebook> {
  const vm = new VoiceModel(body, 48000);
  const model = airwayModel(body, 48000);
  const vowels = vm.vowels.filter((v) => !SKIP.has(v.ipa)).map((v) => v.ipa);
  const base: Codebook["base"] = [];
  for (const v of vowels) base.push({ a: v, b: v, t: 0 });
  for (let i = 0; i < vowels.length; i++) for (let j = i + 1; j < vowels.length; j++) for (const t of [1 / 3, 2 / 3]) base.push({ a: vowels[i], b: vowels[j], t });
  const variants: Variant[] = [];
  for (const larynx of LARYNX) for (const twang of TWANG) variants.push({ larynx, twang });
  const plain = variants.findIndex((v) => v.larynx === 0 && v.twang === TWANG[0]);
  const nBase = base.length, nVar = variants.length, n = nBase * nVar;
  const nf = Math.floor(CB_FMAX / CB_DF) + 1;
  const H = new Float32Array(n * nf), artic = new Float32Array(n * ARTIC_KEYS.length), formants = new Float32Array(n * 3);
  for (let b = 0; b < nBase; b++) {
    for (let v = 0; v < nVar; v++) {
      const e = b * nVar + v;
      const a: HumanArtic = resolveShape(vm, base[b].a, { toward: [base[b].b, base[b].t], add: { larynx: variants[v].larynx }, set: { epilarynx: variants[v].twang } });
      const t = airwayTransfer(model, a);
      toGrid(t.freqs, t.db, H, e * nf, nf);
      ARTIC_KEYS.forEach((k, i) => (artic[e * ARTIC_KEYS.length + i] = a[k]));
      for (let i = 0; i < 3; i++) formants[e * 3 + i] = t.formants[i] ?? 0;
    }
    if (b % 8 === 7) {
      progress?.((b + 1) / nBase);
      if (yieldNow) await yieldNow();
    }
  }
  progress?.(1);
  // the engine keeps one model per body: it is left for the next build (and any other user of it)
  return { body, keys: ARTIC_KEYS, df: CB_DF, nf, nBase, nVar, H, artic, formants, base, variants, plain };
}

/** The vowel a base shape is nearest to. */
export function baseVowel(cb: Codebook, b: number): string {
  const s = cb.base[b];
  return s.t < 0.5 ? s.a : s.b;
}
