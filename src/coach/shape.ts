/** A lesson's `Shape` → the articulation the engine is given, for one body. */
import { ARTIC_KEYS, ARTIC_SPECS, NEUTRAL, type HumanArtic } from "../wasm/engine.ts";
import type { VoiceModel } from "../ui/analysis.ts";
import type { Shape } from "./types.ts";

/** What a vowel target leaves alone, and every take starts from: palate shut, throat at rest. */
const REST: Partial<HumanArtic> = { velum: -0.15, epilarynx: 0.15, ventricular: 0, labiodental: 0, lateral: 0, dorsum: 0, ttCurl: 0 };

function vowelArtic(m: VoiceModel, ipa: string): HumanArtic {
  const v = m.vowels.find((x) => x.ipa === ipa) ?? m.vowels.find((x) => x.ipa === "ɑ") ?? m.vowels[0];
  return { ...NEUTRAL, ...REST, ...(v?.artic ?? {}) };
}

/** A step's shape over the take's: its vowel and blend replace, its nudges merge. */
export function mergeShape(base: Shape | undefined, over: Shape | undefined): Shape {
  if (!over) return base ?? {};
  if (!base) return over;
  return { vowel: over.vowel ?? base.vowel, toward: over.toward ?? base.toward, add: { ...base.add, ...over.add }, set: { ...base.set, ...over.set } };
}

/** The whole posture for a shape (every articulator), kept inside the engine's ranges. */
export function resolveShape(m: VoiceModel, lessonVowel: string, shape: Shape | undefined): HumanArtic {
  const s = shape ?? {};
  const a = vowelArtic(m, s.vowel ?? lessonVowel);
  if (s.toward) {
    const [ipa, amt] = s.toward;
    const b = vowelArtic(m, ipa);
    const u = Math.max(0, Math.min(1, amt));
    for (const k of ARTIC_KEYS) a[k] = a[k] + (b[k] - a[k]) * u;
  }
  for (const [k, v] of Object.entries(s.add ?? {})) a[k as keyof HumanArtic] += v as number;
  for (const [k, v] of Object.entries(s.set ?? {})) a[k as keyof HumanArtic] = v as number;
  for (const k of ARTIC_KEYS) {
    const sp = ARTIC_SPECS[k];
    a[k] = Math.max(sp.min, Math.min(sp.max, a[k]));
  }
  return a;
}
